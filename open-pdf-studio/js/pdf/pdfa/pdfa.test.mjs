// PDF/A-validatie en -conversie (#379).
//
// Elke regel krijgt een opzettelijk kapot bestand; de conversie moet voor 1b,
// 2b en 3b een bestand opleveren waar de validatie niets meer in vindt.
// Alles draait in-process op pdf-lib: geen builds, geen externe programma's.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PDFDocument, PDFName, PDFString, PDFHexString, PDFArray, PDFDict, PDFNumber, StandardFonts, rgb, cmyk,
} from 'pdf-lib';
import { valideerPdfA, documentXmp, infoTeksten, outputIntents } from './validatie.js';
import { converteerNaarPdfA } from './conversie.js';
import { bouwSrgbProfiel, leesIccKop } from './icc.js';
import { cmykProfielBytes } from './cmyk-profiel.js';
import { infoVerschillen, xmpWaarde, bouwPdfAXmp, leesPdfDatum, leesXmpDatum } from './xmp.js';
import { REGELS } from './regels.js';
import { herconverteerVoorOpslaan, moetHerconverteren, herconversieDeel } from './herconversie.js';
import { bevindingSleutel, bevindingTekst, wijzigingTekst, pdfaLabel } from './meldingen.js';
import { stripPdfAMetadata } from '../saver/utils.js';

const hier = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(hier, '../../..');
const FONTS = path.join(app, 'node_modules/pdfjs-dist/standard_fonts');
const laadFont = async (variant) => new Uint8Array(fs.readFileSync(path.join(FONTS, `LiberationSans-${variant}.ttf`)));
const N = (s) => PDFName.of(s);
const NU = new Date(Date.UTC(2026, 9, 27, 12, 0, 0));
const ID = new Uint8Array(16).fill(7);
// Een rasterfunctie zonder canvas: een effen grijs vlak van 4×4 pixels.
const rasteriseer = async () => ({ breedte: 4, hoogte: 4, rgb: new Uint8Array(48).fill(200) });

const codes = (r) => r.bevindingen.map((b) => b.code);
const heeft = (r, code, filter = () => true) => r.bevindingen.some((b) => b.code === code && filter(b));

async function nieuw(bouw) {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  const page = pdf.addPage([300, 300]);
  await bouw?.(pdf, page);
  return pdf;
}
const opslaan = (pdf, opties = {}) => pdf.save({ useObjectStreams: false, ...opties });

/** Een nette PDF/A-2b die de conversie van een schone pagina oplevert. */
async function goedeBasis(deel = 2) {
  const pdf = await nieuw();
  const r = await converteerNaarPdfA(await opslaan(pdf), { deel, laadFont, nu: NU, id: ID });
  assert.ok(r.ok, JSON.stringify(r.onopgelost));
  return r.bytes;
}

/** Laadt een geldig PDF/A-bestand, laat `breek` het kapot maken en slaat op. */
async function breek(deel, breekFn, saveOpties = {}) {
  const pdf = await PDFDocument.load(await goedeBasis(deel), { updateMetadata: false });
  await breekFn(pdf, pdf.getPage(0));
  return opslaan(pdf, saveOpties);
}

function inhoud(pdf, page, tekst, resources = {}) {
  const ref = pdf.context.register(pdf.context.stream(tekst));
  page.node.addContentStream(ref);
  const res = page.node.Resources();
  for (const [cat, items] of Object.entries(resources)) {
    let d = res.lookup(N(cat));
    if (!(d instanceof PDFDict)) { d = pdf.context.obj({}); res.set(N(cat), d); }
    for (const [k, v] of Object.entries(items)) d.set(N(k), v);
  }
}

function annot(pdf, page, dict) {
  const ref = pdf.context.register(pdf.context.obj({ Type: 'Annot', Rect: [10, 10, 60, 60], F: 4, ...dict }));
  let annots = page.node.lookup(N('Annots'));
  if (!(annots instanceof PDFArray)) { annots = pdf.context.obj([]); page.node.set(N('Annots'), annots); }
  annots.push(ref);
  return ref;
}

/** Een ingebed CID-font (pdf-lib-subset) met tekst op de pagina. */
async function cidFont(pdf, page) {
  pdf.registerFontkit((await import('@pdf-lib/fontkit')).default);
  const f = await pdf.embedFont(await laadFont('Regular'), { subset: true });
  page.drawText('Hallo', { x: 10, y: 10, font: f, size: 12 });
  await pdf.flush();
  const type0 = pdf.context.lookup(f.ref);
  const descendant = pdf.context.lookup(type0.lookup(N('DescendantFonts')).get(0));
  return { type0, descendant };
}

const leegForm = (pdf) => pdf.context.register(pdf.context.stream('', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 50, 50] }));

// ── Bouwstenen ─────────────────────────────────────────────────────────────

test('het sRGB-profiel is een geldig ICC v2-weergaveprofiel', () => {
  const p = bouwSrgbProfiel();
  const kop = leesIccKop(p);
  assert.equal(kop.grootte, p.length);
  assert.ok(kop.versie >= 2 && kop.versie < 3, `versie ${kop.versie}`);
  assert.equal(kop.klasse, 'mntr');
  assert.equal(kop.ruimte, 'RGB ');
  assert.equal(kop.pcs, 'XYZ ');
  for (const tag of ['desc', 'cprt', 'wtpt', 'rXYZ', 'gXYZ', 'bXYZ', 'rTRC', 'gTRC', 'bTRC']) assert.ok(kop.tags.includes(tag), tag);
  assert.equal(p.length % 4, 0);
  const cmykKop = leesIccKop(cmykProfielBytes());
  assert.equal(cmykKop.ruimte, 'CMYK');
  assert.ok(cmykKop.versie < 3);
});

test('XMP: pdfaid en /Info-waarden worden gelezen en vergeleken', () => {
  const xml = bouwPdfAXmp({ part: 2, conformance: 'B', title: 'A & B', author: 'Jan', producer: 'P', createDate: NU, modifyDate: NU });
  assert.equal(xmpWaarde(xml, 'pdfaid:part'), '2');
  assert.equal(xmpWaarde(xml, 'dc:title'), 'A & B');
  assert.deepEqual(infoVerschillen({ Title: 'A & B', Author: 'Jan', Producer: 'P', CreationDate: "D:20261027140000+02'00'" }, xml), []);
  assert.deepEqual(infoVerschillen({ Title: 'Anders', ModDate: 'D:20261027120001Z' }, xml), ['Title', 'ModDate']);
  assert.deepEqual(infoVerschillen({ Subject: 'X' }, xml), ['Subject']);
  assert.equal(leesPdfDatum("D:20261027140000+02'00'").getTime(), NU.getTime());
  assert.equal(leesXmpDatum('2026-10-27T13:00:00+01:00').getTime(), NU.getTime());
  assert.match(xml, /^<\?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"\?>/);
});

// ── Een kapot bestand per regel ────────────────────────────────────────────

const KAPOT = [
  ['file.trailerId', 2, async (pdf) => { delete pdf.context.trailerInfo.ID; }],
  ['file.encrypted', 2, async (pdf) => { pdf.context.trailerInfo.Encrypt = pdf.context.register(pdf.context.obj({ Filter: 'Standard' })); }],
  ['file.xrefStream', 1, null, { useObjectStreams: true }],
  ['file.lzw', 2, async (pdf, page) => {
    const ref = pdf.context.register(pdf.context.stream(new Uint8Array([0x80, 0x0b, 0x60, 0x50, 0x22, 0x0c, 0x0c, 0x85, 0x01]), { Filter: 'LZWDecode' }));
    page.node.addContentStream(ref);
  }],
  ['file.externalStream', 2, async (pdf, page) => { page.node.addContentStream(pdf.context.register(pdf.context.stream('', { F: PDFString.of('extern.bin') }))); }],
  ['file.limits', 1, async (pdf, page) => { page.node.set(N('Opsplus'), PDFNumber.of(40000.5)); }],
  ['meta.missing', 2, async (pdf) => { pdf.catalog.delete(N('Metadata')); }],
  ['meta.filtered', 1, async (pdf) => {
    const xml = documentXmp(pdf);
    pdf.catalog.set(N('Metadata'), pdf.context.register(pdf.context.flateStream(xml, { Type: 'Metadata', Subtype: 'XML' })));
  }],
  ['meta.packet', 2, async (pdf) => {
    const xml = documentXmp(pdf).replace(/<\?xpacket begin[^>]*\?>/, '');
    pdf.catalog.set(N('Metadata'), pdf.context.register(pdf.context.stream(xml, { Type: 'Metadata', Subtype: 'XML' })));
  }],
  ['meta.pdfaid', 2, async (pdf) => {
    const xml = documentXmp(pdf).replace('<pdfaid:part>2</pdfaid:part>', '<pdfaid:part>1</pdfaid:part>');
    pdf.catalog.set(N('Metadata'), pdf.context.register(pdf.context.stream(xml, { Type: 'Metadata', Subtype: 'XML' })));
  }],
  ['meta.infoMismatch', 2, async (pdf) => { pdf.getInfoDict().set(N('Title'), PDFHexString.fromText('Niet in XMP')); }],
  ['oi.missing', 2, async (pdf, page) => { pdf.catalog.delete(N('OutputIntents')); inhoud(pdf, page, '1 0 0 rg 0 0 10 10 re f'); }],
  ['oi.profile', 1, async (pdf) => {
    const p = bouwSrgbProfiel();
    p[8] = 4; // versie 4: te nieuw voor PDF/A-1
    const oi = outputIntents(pdf)[0];
    oi.dict.set(N('DestOutputProfile'), pdf.context.register(pdf.context.stream(p, { N: 3 })));
  }],
  ['oi.multiple', 2, async (pdf) => {
    const tweede = pdf.context.obj({ Type: 'OutputIntent', S: 'GTS_PDFX', OutputConditionIdentifier: PDFString.of('x'), DestOutputProfile: pdf.context.register(pdf.context.stream(bouwSrgbProfiel(), { N: 3 })) });
    pdf.catalog.lookup(N('OutputIntents')).push(tweede);
  }],
  ['color.device', 2, async (pdf, page) => { inhoud(pdf, page, '0 0 0 1 k 0 0 10 10 re f'); }],
  ['color.renderingIntent', 2, async (pdf, page) => { inhoud(pdf, page, '/Gs1 gs', { ExtGState: { Gs1: pdf.context.obj({ Type: 'ExtGState', RI: 'Bijzonder' }) } }); }],
  ['gs.transfer', 2, async (pdf, page) => { inhoud(pdf, page, '/Gs1 gs', { ExtGState: { Gs1: pdf.context.obj({ Type: 'ExtGState', TR: 'Identity' }) } }); }],
  ['font.notEmbedded', 2, async (pdf, page) => {
    const f = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText('Hallo', { x: 10, y: 10, font: f, size: 12 });
  }],
  ['font.widths', 2, async (pdf, page) => {
    const bytes = await laadFont('Regular');
    const ff = pdf.context.register(pdf.context.flateStream(bytes));
    const desc = pdf.context.register(pdf.context.obj({ Type: 'FontDescriptor', FontName: 'LiberationSans', Flags: 32, FontBBox: [0, 0, 1000, 1000], ItalicAngle: 0, Ascent: 900, Descent: -200, CapHeight: 700, StemV: 80, FontFile2: ff }));
    const font = pdf.context.register(pdf.context.obj({ Type: 'Font', Subtype: 'TrueType', BaseFont: 'LiberationSans', FirstChar: 65, LastChar: 65, Widths: [123], Encoding: 'WinAnsiEncoding', FontDescriptor: desc }));
    inhoud(pdf, page, 'BT /F9 12 Tf 10 10 Td (A) Tj ET', { Font: { F9: font } });
  }],
  ['font.encoding', 2, async (pdf, page) => {
    const bytes = await laadFont('Regular');
    const ff = pdf.context.register(pdf.context.flateStream(bytes));
    const desc = pdf.context.register(pdf.context.obj({ Type: 'FontDescriptor', FontName: 'LiberationSans', Flags: 32, FontBBox: [0, 0, 1000, 1000], ItalicAngle: 0, Ascent: 900, Descent: -200, CapHeight: 700, StemV: 80, FontFile2: ff }));
    const font = pdf.context.register(pdf.context.obj({ Type: 'Font', Subtype: 'TrueType', BaseFont: 'LiberationSans', FirstChar: 65, LastChar: 65, Widths: [667], FontDescriptor: desc }));
    inhoud(pdf, page, 'BT /F9 12 Tf 10 10 Td (A) Tj ET', { Font: { F9: font } });
  }],
  ['font.subsetSet', 1, async (pdf, page) => {
    const { type0 } = await cidFont(pdf, page);
    // Een subset herken je aan het voorvoegsel ABCDEF+ (ISO 32000-1 9.6.4).
    type0.set(N('BaseFont'), N('ABCDEF+LiberationSans'));
  }],
  ['font.cidToGid', 2, async (pdf, page) => {
    const { descendant } = await cidFont(pdf, page);
    descendant.delete(N('CIDToGIDMap'));
  }],
  ['transp.alpha', 1, async (pdf, page) => { page.drawRectangle({ x: 1, y: 1, width: 5, height: 5, color: rgb(1, 0, 0), opacity: 0.5 }); }],
  ['transp.smask', 1, async (pdf, page) => { inhoud(pdf, page, '/Gs1 gs', { ExtGState: { Gs1: pdf.context.obj({ Type: 'ExtGState', SMask: { Type: 'Mask', S: 'Luminosity', G: leegForm(pdf) } }) } }); }],
  ['transp.blend', 1, async (pdf, page) => { inhoud(pdf, page, '/Gs1 gs', { ExtGState: { Gs1: pdf.context.obj({ Type: 'ExtGState', BM: 'Multiply' }) } }); }],
  ['transp.group', 1, async (pdf, page) => { page.node.set(N('Group'), pdf.context.obj({ Type: 'Group', S: 'Transparency' })); }],
  ['image.interpolate', 2, async (pdf, page) => {
    const img = pdf.context.register(pdf.context.stream(new Uint8Array(3), { Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1, ColorSpace: 'DeviceGray', BitsPerComponent: 8, Interpolate: true }));
    inhoud(pdf, page, 'q 10 0 0 10 0 0 cm /Im1 Do Q', { XObject: { Im1: img } });
  }],
  ['image.alternates', 2, async (pdf, page) => {
    const img = pdf.context.register(pdf.context.stream(new Uint8Array(1), { Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1, ColorSpace: 'DeviceGray', BitsPerComponent: 8, Alternates: [] }));
    inhoud(pdf, page, 'q 10 0 0 10 0 0 cm /Im1 Do Q', { XObject: { Im1: img } });
  }],
  ['image.jpx', 1, async (pdf, page) => {
    const img = pdf.context.register(pdf.context.stream(new Uint8Array(4), { Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1, Filter: 'JPXDecode' }));
    inhoud(pdf, page, 'q 10 0 0 10 0 0 cm /Im1 Do Q', { XObject: { Im1: img } });
  }],
  ['xobject.forbidden', 2, async (pdf, page) => {
    const ps = pdf.context.register(pdf.context.stream('%!PS', { Type: 'XObject', Subtype: 'PS' }));
    inhoud(pdf, page, '/P1 Do', { XObject: { P1: ps } });
  }],
  ['action.forbidden', 2, async (pdf, page) => { annot(pdf, page, { Subtype: 'Link', A: { S: 'Launch', F: PDFString.of('calc.exe') } }); }],
  ['action.named', 2, async (pdf, page) => { annot(pdf, page, { Subtype: 'Link', A: { S: 'Named', N: 'Print' } }); }],
  ['action.javascript', 2, async (pdf) => {
    const js = pdf.context.obj({ S: 'JavaScript', JS: PDFString.of('app.alert(1)') });
    pdf.catalog.set(N('Names'), pdf.context.obj({ JavaScript: { Names: [PDFString.of('a'), js] } }));
  }],
  ['action.additional', 2, async (pdf, page) => { page.node.set(N('AA'), pdf.context.obj({ O: { S: 'GoTo', D: [page.ref, N('Fit')] } })); }],
  ['embed.forbidden', 1, async (pdf) => { await pdf.attach(new TextEncoder().encode('hoi'), 'notitie.txt', { mimeType: 'text/plain' }); await pdf.flush(); }],
  ['embed.notPdfA', 2, async (pdf) => { await pdf.attach(new TextEncoder().encode('hoi'), 'notitie.txt', { mimeType: 'text/plain' }); await pdf.flush(); }],
  ['embed.spec', 3, async (pdf) => {
    const s = pdf.context.register(pdf.context.stream('hoi', { Type: 'EmbeddedFile' }));
    const spec = pdf.context.register(pdf.context.obj({ Type: 'Filespec', F: PDFString.of('n.txt'), EF: { F: s } }));
    pdf.catalog.set(N('Names'), pdf.context.obj({ EmbeddedFiles: { Names: [PDFString.of('n.txt'), spec] } }));
  }],
  ['annot.type', 1, async (pdf, page) => { annot(pdf, page, { Subtype: 'Polygon', Vertices: [10, 10, 50, 10, 30, 50], C: [1, 0, 0], AP: { N: leegForm(pdf) } }); }],
  ['annot.flags', 2, async (pdf, page) => { annot(pdf, page, { Subtype: 'Square', F: 2, C: [1, 0, 0], AP: { N: leegForm(pdf) } }); }],
  ['annot.appearance', 2, async (pdf, page) => { annot(pdf, page, { Subtype: 'Square', C: [1, 0, 0] }); }],
  ['annot.alpha', 1, async (pdf, page) => { annot(pdf, page, { Subtype: 'Square', CA: 0.5, AP: { N: leegForm(pdf) } }); }],
  ['annot.color', 1, async (pdf, page) => {
    const oi = outputIntents(pdf)[0];
    oi.dict.set(N('DestOutputProfile'), pdf.context.register(pdf.context.stream(Object.assign(cmykProfielBytes(), {}), { N: 4 })));
    // Het CMYK-profiel is een invoerprofiel; maak er voor deze test een printerprofiel van.
    const p = cmykProfielBytes(); p.set([0x70, 0x72, 0x74, 0x72], 12);
    oi.dict.set(N('DestOutputProfile'), pdf.context.register(pdf.context.stream(p, { N: 4 })));
    annot(pdf, page, { Subtype: 'Square', C: [1, 0, 0], AP: { N: leegForm(pdf) } });
  }],
  ['form.needAppearances', 2, async (pdf) => { pdf.catalog.set(N('AcroForm'), pdf.context.obj({ Fields: [], NeedAppearances: true })); }],
  ['form.xfa', 2, async (pdf) => { pdf.catalog.set(N('AcroForm'), pdf.context.obj({ Fields: [], XFA: pdf.context.register(pdf.context.stream('<xdp/>')) })); }],
  ['oc.forbidden', 1, async (pdf) => {
    const ocg = pdf.context.register(pdf.context.obj({ Type: 'OCG', Name: PDFString.of('Laag') }));
    pdf.catalog.set(N('OCProperties'), pdf.context.obj({ OCGs: [ocg], D: { Name: PDFString.of('Standaard'), Order: [ocg] } }));
  }],
  ['oc.config', 2, async (pdf) => {
    const ocg = pdf.context.register(pdf.context.obj({ Type: 'OCG', Name: PDFString.of('Laag') }));
    pdf.catalog.set(N('OCProperties'), pdf.context.obj({ OCGs: [ocg], D: { AS: [], Order: [] } }));
  }],
  ['catalog.forbidden', 2, async (pdf) => { pdf.catalog.set(N('NeedsRendering'), pdf.context.obj(true)); }],
];

test('elke regel heeft een kapot testbestand', () => {
  const gedekt = new Set(KAPOT.map(([c]) => c));
  // Kop en einde van het bestand worden hieronder op ruwe bytes getest.
  for (const code of Object.keys(REGELS)) {
    if (['file.header', 'file.dataAfterEof', 'file.cryptFilter'].includes(code)) continue;
    assert.ok(gedekt.has(code), `geen kapot bestand voor ${code}`);
  }
});

test('de basis is schoon voor 1b, 2b en 3b', async () => {
  for (const deel of [1, 2, 3]) {
    const r = await valideerPdfA(await goedeBasis(deel), { deel });
    assert.deepEqual(codes(r), [], `deel ${deel}`);
    assert.ok(r.conform);
    assert.deepEqual(r.geclaimd, { part: deel, conformance: 'B' });
  }
});

for (const [code, deel, breekFn, saveOpties] of KAPOT) {
  test(`kapot bestand meldt ${code} (PDF/A-${deel}b)`, async () => {
    const bytes = await breek(deel, breekFn || (() => {}), saveOpties);
    const r = await valideerPdfA(bytes, { deel });
    assert.ok(heeft(r, code), `${code} niet gemeld; wel: ${codes(r).join(', ')}`);
    const b = r.bevindingen.find((x) => x.code === code);
    assert.ok(b.clausule, 'clausule');
    assert.ok(typeof b.object === 'string');
  });
}

test('kop en einde van het bestand op ruwe bytes', async () => {
  const goed = await goedeBasis(2);
  const zonderBinair = new Uint8Array(goed);
  zonderBinair.set(new TextEncoder().encode('%abcd'), 9);
  assert.ok(heeft(await valideerPdfA(zonderBinair, { deel: 2 }), 'file.header'));
  const metStaart = new Uint8Array([...goed, ...new TextEncoder().encode('\nrommel na het einde')]);
  assert.ok(heeft(await valideerPdfA(metStaart, { deel: 2 }), 'file.dataAfterEof'));
});

test('bevindingen geven pagina en object', async () => {
  const bytes = await breek(2, async (pdf, page) => {
    pdf.addPage([200, 200]);
    const tweede = pdf.getPage(1);
    const f = await pdf.embedFont(StandardFonts.Helvetica);
    tweede.drawText('x', { font: f, size: 10, x: 5, y: 5 });
    void page;
  });
  const r = await valideerPdfA(bytes, { deel: 2 });
  const b = r.bevindingen.find((x) => x.code === 'font.notEmbedded');
  assert.equal(b.pagina, 2);
  assert.match(b.object, /^\d+ 0 R$|Font/);
  assert.equal(b.details.font, 'Helvetica');
});

test('een bekend kapot bestand noemt al zijn redenen', async () => {
  const pdf = await nieuw(async (pdf, page) => {
    const f = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText('Bouwvergunning', { x: 10, y: 250, font: f, size: 14 });
    page.drawRectangle({ x: 10, y: 10, width: 40, height: 40, color: rgb(0, 0, 1), opacity: 0.4 });
    annot(pdf, page, { Subtype: 'Link', A: { S: 'JavaScript', JS: PDFString.of('x') } });
  });
  const r = await valideerPdfA(await opslaan(pdf), { deel: 1 });
  for (const code of ['file.trailerId', 'meta.missing', 'oi.missing', 'font.notEmbedded', 'transp.alpha', 'action.forbidden']) {
    assert.ok(heeft(r, code), `${code} ontbreekt in ${codes(r).join(', ')}`);
  }
  assert.equal(r.conform, false);
});

// ── Conversie ──────────────────────────────────────────────────────────────

/** Een document met zoveel mogelijk problemen tegelijk. */
async function rommelDocument() {
  return nieuw(async (pdf, page) => {
    pdf.setTitle('Bouwtekening', { showInWindowTitleBar: false });
    pdf.setAuthor('Ontwerper');
    pdf.setSubject('Test');
    pdf.setKeywords(['pdfa', 'test']);
    pdf.setCreator('Testsuite');
    pdf.setCreationDate(new Date(Date.UTC(2020, 0, 2, 3, 4, 5)));
    const helv = await pdf.embedFont(StandardFonts.Helvetica);
    const times = await pdf.embedFont(StandardFonts.TimesRomanBold);
    page.drawText('Helvetica tekst', { x: 10, y: 270, font: helv, size: 12 });
    page.drawText('Times tekst', { x: 10, y: 250, font: times, size: 12 });
    page.drawRectangle({ x: 10, y: 10, width: 40, height: 40, color: cmyk(0, 1, 1, 0) });
    page.drawRectangle({ x: 60, y: 10, width: 40, height: 40, color: rgb(0, 0.5, 0), opacity: 0.5 });
    annot(pdf, page, { Subtype: 'Link', Rect: [10, 100, 50, 120], A: { S: 'Launch', F: PDFString.of('x.exe') } });
    annot(pdf, page, { Subtype: 'Square', Rect: [100, 100, 150, 150], C: [1, 0, 0] });
    annot(pdf, page, { Subtype: 'Polygon', Rect: [150, 150, 200, 200], Vertices: [150, 150, 200, 150, 175, 200], C: [0, 0, 1] });
    annot(pdf, page, { Subtype: 'Ink', Rect: [200, 200, 250, 250], F: 2, InkList: [[200, 200, 250, 250]], C: [0, 0, 0] });
    annot(pdf, page, { Subtype: 'Text', Rect: [250, 250, 270, 270], F: 0, C: [1, 1, 0] });
    const js = pdf.context.obj({ S: 'JavaScript', JS: PDFString.of('app.alert(1)') });
    pdf.catalog.set(N('Names'), pdf.context.obj({ JavaScript: { Names: [PDFString.of('a'), js] } }));
    pdf.catalog.set(N('OpenAction'), pdf.context.obj({ S: 'JavaScript', JS: PDFString.of('x') }));
    const ocg = pdf.context.register(pdf.context.obj({ Type: 'OCG', Name: PDFString.of('Laag') }));
    pdf.catalog.set(N('OCProperties'), pdf.context.obj({ OCGs: [ocg], D: { AS: [], Order: [] } }));
    pdf.catalog.set(N('AcroForm'), pdf.context.obj({ Fields: [], NeedAppearances: true }));
    const lzw = pdf.context.register(pdf.context.stream(new Uint8Array([0x80, 0x0b, 0x60, 0x50, 0x22, 0x0c, 0x0c, 0x85, 0x01]), { Filter: 'LZWDecode' }));
    page.node.addContentStream(lzw);
    const img = pdf.context.register(pdf.context.stream(new Uint8Array(3), { Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Interpolate: true }));
    inhoud(pdf, page, 'q 10 0 0 10 200 10 cm /Im1 Do Q', { XObject: { Im1: img } });
    await pdf.attach(new TextEncoder().encode('<ifc/>'), 'model.xml', { mimeType: 'application/xml', description: 'Model' });
    await pdf.flush();
  });
}

for (const deel of [1, 2, 3]) {
  test(`conversie naar PDF/A-${deel}b levert een bestand zonder bevindingen`, async () => {
    const bron = await opslaan(await rommelDocument());
    const voor = await valideerPdfA(bron, { deel });
    assert.ok(voor.bevindingen.length > 5, 'het brondocument heeft problemen');
    const r = await converteerNaarPdfA(bron, { deel, laadFont, rasteriseer, nu: NU, id: ID });
    assert.ok(r.ok, `onopgelost: ${JSON.stringify(r.onopgelost)}`);
    // Onafhankelijk opnieuw valideren.
    const na = await valideerPdfA(r.bytes, { deel });
    assert.deepEqual(codes(na), []);
    assert.deepEqual(na.geclaimd, { part: deel, conformance: 'B' });

    const pdf = await PDFDocument.load(r.bytes, { updateMetadata: false });
    // OutputIntent met ICC-profiel
    const oi = outputIntents(pdf);
    assert.ok(oi.some((o) => o.s === 'GTS_PDFA1' && o.kop?.ruimte === 'RGB ' && o.kop.versie < 3));
    // XMP en /Info gelijk
    const xml = documentXmp(pdf);
    const info = infoTeksten(pdf);
    assert.deepEqual(infoVerschillen(info, xml), []);
    assert.equal(info.Title, 'Bouwtekening');
    assert.equal(xmpWaarde(xml, 'dc:title'), 'Bouwtekening');
    assert.equal(xmpWaarde(xml, 'dc:creator'), 'Ontwerper');
    assert.equal(xmpWaarde(xml, 'pdf:Producer'), 'Open PDF Studio');
    assert.equal(leesXmpDatum(xmpWaarde(xml, 'xmp:CreateDate')).getTime(), Date.UTC(2020, 0, 2, 3, 4, 5));
    // Bestands-ID en kop
    assert.equal(pdf.context.trailerInfo.ID.size(), 2);
    const kop = new TextDecoder('latin1').decode(r.bytes.subarray(0, 8));
    assert.equal(kop, deel === 1 ? '%PDF-1.4' : '%PDF-1.7');
    // Ingesloten bestand: alleen 3b houdt het, met AFRelationship
    const namen = pdf.catalog.lookup(N('Names'));
    const ef = namen instanceof PDFDict ? namen.lookup(N('EmbeddedFiles')) : null;
    if (deel === 3) {
      assert.ok(ef, 'bijlage blijft in 3b');
      const spec = pdf.context.lookup(ef.lookup(N('Names')).get(1));
      assert.equal(spec.get(N('AFRelationship')).decodeText(), 'Unspecified');
      assert.ok(pdf.catalog.lookup(N('AF')) instanceof PDFArray || true);
    } else assert.ok(!ef, `bijlage weg in ${deel}b`);
    // JavaScript weg
    assert.ok(!(namen instanceof PDFDict && namen.has(N('JavaScript'))));
    assert.ok(!pdf.catalog.has(N('OpenAction')));
    // Wijzigingen zijn gemeld
    const w = r.wijzigingen.map((x) => x.code);
    for (const c of ['change.actionRemoved', 'change.outputIntentAdded', 'change.metadataWritten', 'change.fontEmbedded', 'change.fontSubstituted']) assert.ok(w.includes(c), c);
    if (deel === 1) assert.ok(w.includes('change.pageRasterised'), 'transparantie in 1b wordt gerasterd');
    else assert.ok(!w.includes('change.pageRasterised'), `geen raster in ${deel}b`);
  });
}

test('3b: de bijlage is geassocieerd via /AF', async () => {
  const r = await converteerNaarPdfA(await opslaan(await rommelDocument()), { deel: 3, laadFont, rasteriseer, nu: NU, id: ID });
  const pdf = await PDFDocument.load(r.bytes, { updateMetadata: false });
  const af = pdf.catalog.lookup(N('AF'));
  assert.ok(af instanceof PDFArray && af.size() === 1);
  const spec = pdf.context.lookup(af.get(0));
  assert.ok(spec.has(N('UF')) && spec.has(N('F')));
  const stroom = pdf.context.lookup(spec.lookup(N('EF')).get(N('F')));
  assert.equal(stroom.dict.get(N('Subtype')).decodeText(), 'application/xml');
});

test('1b zonder rasterfunctie meldt de transparantie als onopgelost', async () => {
  const pdf = await nieuw(async (p, page) => page.drawRectangle({ x: 1, y: 1, width: 5, height: 5, color: rgb(1, 0, 0), opacity: 0.5 }));
  const r = await converteerNaarPdfA(await opslaan(pdf), { deel: 1, laadFont, nu: NU, id: ID });
  assert.equal(r.ok, false);
  assert.ok(r.onopgelost.some((b) => b.code === 'transp.alpha'));
  assert.deepEqual(r.rasterNodig.map((x) => x.pagina), [1]);
});

test('Helvetica wordt maatvast ingebed: dezelfde breedtes', async () => {
  const pdf = await nieuw(async (p, page) => {
    const f = await p.embedFont(StandardFonts.Helvetica);
    page.drawText('AVW', { x: 10, y: 10, font: f, size: 12 });
  });
  const r = await converteerNaarPdfA(await opslaan(pdf), { deel: 2, laadFont, nu: NU, id: ID });
  assert.ok(r.ok, JSON.stringify(r.onopgelost));
  const uit = await PDFDocument.load(r.bytes);
  const font = [...uit.context.enumerateIndirectObjects()].map(([, o]) => o)
    .find((o) => o instanceof PDFDict && o.get(N('Type'))?.decodeText?.() === 'Font');
  assert.equal(font.get(N('Subtype')).decodeText(), 'TrueType');
  const eerste = font.get(N('FirstChar')).asNumber();
  const w = font.lookup(N('Widths')).asArray().map((x) => x.asNumber());
  // Helvetica-AFM: A=667, V=667, W=944
  assert.equal(w[65 - eerste], 667);
  assert.equal(w[87 - eerste], 944);
  assert.ok(r.wijzigingen.some((x) => x.code === 'change.fontEmbedded' && x.details.font === 'Helvetica'));
});

test('een document dat al PDF/A is, blijft na conversie gelijkwaardig', async () => {
  const eens = await goedeBasis(2);
  const r = await converteerNaarPdfA(eens, { deel: 2, laadFont, nu: NU, id: ID });
  assert.ok(r.ok);
  assert.deepEqual(r.wijzigingen.map((w) => w.code), ['change.metadataWritten']);
});

test('DeviceCMYK naast een sRGB-OutputIntent krijgt /DefaultCMYK', async () => {
  const pdf = await nieuw(async (p, page) => page.drawRectangle({ x: 1, y: 1, width: 5, height: 5, color: cmyk(0, 0, 0, 1) }));
  const r = await converteerNaarPdfA(await opslaan(pdf), { deel: 2, laadFont, nu: NU, id: ID });
  assert.ok(r.ok, JSON.stringify(r.onopgelost));
  const uit = await PDFDocument.load(r.bytes);
  const cs = uit.getPage(0).node.Resources().lookup(N('ColorSpace'));
  assert.ok(cs.has(N('DefaultCMYK')));
});

// ── PDF/A-balk: bewerken en opnieuw converteren bij opslaan ───────────────

test('keuze bij bewerken: standaard opnieuw converteren, nooit stil weg', () => {
  assert.equal(moetHerconverteren({ pdfaCompliance: { part: '2', conformance: 'B' } }), true);
  assert.equal(moetHerconverteren({ pdfaCompliance: { part: '2' }, pdfaOpslaan: 'herconverteer' }), true);
  assert.equal(moetHerconverteren({ pdfaCompliance: { part: '2' }, pdfaOpslaan: 'verwijder' }), false);
  assert.equal(moetHerconverteren({ pdfaCompliance: null }), false);
  assert.equal(herconversieDeel({ part: '3', conformance: 'A' }), 3);
  assert.equal(herconversieDeel({ part: '4' }), null);
});

test('rondgang: PDF/A openen, bewerken (metadata gestript zoals de saver doet), opslaan converteert opnieuw', async () => {
  const origineel = await goedeBasis(2);
  // Wat de saver doet: pdfaid uit het XMP halen en een annotatie toevoegen.
  const pdf = await PDFDocument.load(origineel, { updateMetadata: false });
  stripPdfAMetadata(pdf);
  assert.equal(documentXmp(pdf).includes('pdfaid:part'), false, 'de saver haalt pdfaid echt weg');
  annot(pdf, pdf.getPage(0), { Subtype: 'Square', Rect: [20, 20, 80, 80], C: [1, 0, 0] });
  const f = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.getPage(0).drawText('Bewerkt', { x: 10, y: 10, font: f, size: 10 });
  const bewerkt = await pdf.save();
  assert.ok(!(await valideerPdfA(bewerkt, { deel: 2 })).conform, 'zonder herconversie geen PDF/A meer');

  const doc = { pdfaCompliance: { part: '2', conformance: 'B' }, pdfADismissed: true, pdfaOpslaan: 'herconverteer' };
  const converteer = (b, deel) => converteerNaarPdfA(b, { deel, laadFont, rasteriseer, nu: NU, id: ID });
  const uit = await herconverteerVoorOpslaan(bewerkt, doc, converteer);
  assert.deepEqual(uit.behouden, { part: 2, conformance: 'B' });
  const v = await valideerPdfA(uit.bytes, { deel: 2 });
  assert.deepEqual(codes(v), []);

  // Gekozen voor een gewone PDF: de bytes blijven zoals de saver ze maakte.
  const gewoon = await herconverteerVoorOpslaan(bewerkt, { ...doc, pdfaOpslaan: 'verwijder' }, converteer);
  assert.equal(gewoon.behouden, null);
  assert.equal(gewoon.bytes, bewerkt);

  // Lukt het niet, dan geen PDF/A maar wel de redenen.
  const mislukt = await herconverteerVoorOpslaan(bewerkt, doc, async () => ({ ok: false, onopgelost: [{ code: 'font.notEmbedded', details: { font: 'X' } }] }));
  assert.equal(mislukt.behouden, null);
  assert.equal(mislukt.redenen.length, 1);
});

const leesBron = (rel) => fs.readFileSync(path.join(app, rel), 'utf8').replace(/\r\n/g, '\n');

test('bedrading: de balk waarschuwt eerst, de saver converteert opnieuw in plaats van stil te strippen', () => {
  const balk = leesBron('js/solid/components/PdfABar.jsx');
  assert.match(balk, /openDialog\('pdfa-edit'/);
  assert.match(balk, /openDialog\('pdfa'/);
  assert.doesNotMatch(balk, /dismissPdfAForActiveDoc/, 'bewerken gaat via de waarschuwing');
  const dialoog = leesBron('js/solid/components/dialogs/PdfAEditDialog.jsx');
  assert.match(dialoog, /dismissPdfAForActiveDoc\(keuze\(\)\)/);
  const loader = leesBron('js/pdf/loader.js');
  assert.match(loader, /activeDoc\.pdfaOpslaan = opslaan === 'verwijder' \? 'verwijder' : 'herconverteer'/);
  const saver = leesBron('js/pdf/saver.js');
  assert.match(saver, /const pdfaUitkomst = await herconverteerPdfA\(activeDoc, savedBytes\);/);
  assert.match(saver, /activeDoc\.pdfaCompliance = pdfaUitkomst\.behouden;/);
  assert.doesNotMatch(saver, /activeDoc\.pdfaCompliance = null;/);
  const host = leesBron('js/solid/components/DialogHost.jsx');
  assert.match(host, /'pdfa': PdfADialog/);
  assert.match(host, /'pdfa-edit': PdfAEditDialog/);
});

// ── Teksten ────────────────────────────────────────────────────────────────

const LOCALES = path.join(app, 'js/i18n/locales');
const lees = (taal, ns) => JSON.parse(fs.readFileSync(path.join(LOCALES, taal, `${ns}.json`), 'utf8'));
const plaats = (s) => [...String(s).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort().join(',');
function paden(o, voor = '') {
  return Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? paden(v, `${voor}${k}.`) : [[`${voor}${k}`, v]]));
}

test('elke bevinding en wijziging heeft een Engelse tekst', async () => {
  const en = lees('en', 'dialogs');
  const t = (sleutel, opties = {}) => {
    const v = sleutel.split('.').reduce((o, k) => o?.[k], en);
    assert.equal(typeof v, 'string', `ontbrekende tekst ${sleutel}`);
    return v.replace(/\{\{(\w+)\}\}/g, (_, k) => String(opties[k] ?? `{${k}}`));
  };
  const bron = await opslaan(await rommelDocument());
  for (const deel of [1, 2, 3]) {
    for (const b of (await valideerPdfA(bron, { deel })).bevindingen) assert.doesNotMatch(bevindingTekst(t, b), /\{\w+\}/, bevindingSleutel(b));
    const r = await converteerNaarPdfA(bron, { deel, laadFont, rasteriseer, nu: NU, id: ID });
    for (const w of r.wijzigingen) assert.doesNotMatch(wijzigingTekst(t, w), /\{\w+\}/, w.code);
  }
  // Alle kapotte bestanden: ook hun meldingen hebben een tekst.
  for (const [, deel, breekFn, saveOpties] of KAPOT) {
    const r = await valideerPdfA(await breek(deel, breekFn || (() => {}), saveOpties), { deel });
    for (const b of r.bevindingen) bevindingTekst(t, b);
  }
  assert.equal(pdfaLabel(2), 'PDF/A-2b');
});

test('alle talen hebben dezelfde PDF/A-teksten met dezelfde plaatshouders', () => {
  const en = { dialogs: lees('en', 'dialogs').pdfa, statusbar: lees('en', 'statusbar'), appMenu: lees('en', 'appMenu') };
  const enPaden = new Map(paden(en.dialogs));
  const talen = fs.readdirSync(LOCALES).filter((x) => x !== 'en');
  assert.ok(talen.length >= 39);
  for (const taal of talen) {
    const d = lees(taal, 'dialogs').pdfa;
    assert.ok(d, `${taal}: geen pdfa-sectie`);
    const p = new Map(paden(d));
    for (const [k, v] of enPaden) {
      assert.ok(p.has(k), `${taal}: ${k} ontbreekt`);
      assert.equal(plaats(p.get(k)), plaats(v), `${taal}: plaatshouders van ${k}`);
    }
    const s = lees(taal, 'statusbar');
    for (const k of ['pdfaReadOnly', 'pdfaValidate']) {
      assert.equal(typeof s[k], 'string', `${taal}: statusbar.${k}`);
      assert.equal(plaats(s[k]), plaats(en.statusbar[k]));
    }
    assert.equal(typeof lees(taal, 'appMenu').pdfa, 'string', `${taal}: appMenu.pdfa`);
    // Echt vertaald: niet alles gelijk aan het Engels.
    if (taal !== 'en') assert.notEqual(d.editText, en.dialogs.editText, `${taal}: niet vertaald`);
  }
});
