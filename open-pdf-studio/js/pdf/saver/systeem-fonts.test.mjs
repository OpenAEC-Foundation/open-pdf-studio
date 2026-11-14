import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, PDFName, PDFDict, decodePDFRawStream } from 'pdf-lib';
import { maakSysteemFontKeten, splitsOpDekking } from './systeem-fonts.js';

// #1020: het gekozen lettertype van een tekstvak wordt ingebed (een
// deelverzameling), één keer per bestand, met terugval voor wat niet kan.

test('splitsOpDekking: tekens die het font niet heeft gaan apart', () => {
  const heeft = (cp) => cp < 0x400;
  assert.deepEqual(splitsOpDekking('ab Ж c', heeft), [
    { tekst: 'ab ', ingebed: true }, { tekst: 'Ж ', ingebed: false }, { tekst: 'c', ingebed: true },
  ]);
  assert.deepEqual(splitsOpDekking('', heeft), []);
});

test('keten: standaardletters en niet-insluitbare fonts geven null', async () => {
  const doc = await PDFDocument.create();
  const keten = maakSysteemFontKeten(doc, {
    zoek: async (f) => (f === 'Locked' ? { pad: null, exact: false, insluitbaar: false, reden: 'licence' } : null),
    laadBytes: async () => { throw new Error('not called'); },
  });
  assert.equal(await keten.voor('Arial'), null);
  assert.equal(await keten.voor('Times New Roman', true), null);
  assert.equal(await keten.voor('Locked'), null);
  assert.equal(await keten.voor('mixed'), null);
});

// Een echt TrueType-font van deze machine; overgeslagen als er geen is.
const kandidaten = ['consola.ttf', 'segoeui.ttf', 'DejaVuSans.ttf']
  .flatMap((f) => [path.join(process.env.WINDIR || 'C:/Windows', 'Fonts', f), `/usr/share/fonts/truetype/dejavu/${f}`]);
const fontPad = kandidaten.find((p) => fs.existsSync(p));

test('keten: één ingebed subset-font voor vijf tekstvakken', { skip: !fontPad && 'no TrueType font on this machine' }, async () => {
  const doc = await PDFDocument.create();
  let geladen = 0;
  const keten = maakSysteemFontKeten(doc, {
    zoek: async () => ({ pad: fontPad, exact: true, insluitbaar: true, reden: null }),
    laadBytes: async (p) => { geladen++; return new Uint8Array(fs.readFileSync(p)); },
  });
  const fonts = [];
  for (let i = 0; i < 5; i++) fonts.push(await keten.voor('Test Font'));
  assert.ok(fonts[0]);
  assert.ok(fonts.every((f) => f === fonts[0]), 'same embedded font for every box');
  assert.equal(geladen, 1);
  // Vet zonder eigen bestand: hetzelfde bestand, ook één keer geladen.
  assert.equal(await keten.voor('Test Font', true), fonts[0]);
  assert.equal(geladen, 1);

  const f = fonts[0];
  const page = doc.addPage([200, 100]);
  page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: doc.context.obj({ [f.naam]: f.font.ref }) }));
  const inhoud = `BT /${f.naam} 12 Tf 10 50 Td ${f.font.encodeText('Hello 123').toString()} Tj ET`;
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream(inhoud)));
  const bytes = await doc.save();

  const terug = await PDFDocument.load(bytes);
  const fontDict = terug.context.lookup(terug.getPage(0).node.Resources().lookup(PDFName.of('Font'), PDFDict).get(PDFName.of(f.naam)), PDFDict);
  assert.equal(fontDict.get(PDFName.of('Subtype')).toString(), '/Type0');
  const basis = fontDict.get(PDFName.of('BaseFont')).toString();
  assert.match(basis, /^\/[A-Z]{6}\+/, 'subset tag in the font name');
  const cid = terug.context.lookup(fontDict.lookup(PDFName.of('DescendantFonts')).get(0), PDFDict);
  const fd = cid.lookup(PDFName.of('FontDescriptor'), PDFDict);
  assert.ok(fd.get(PDFName.of('FontFile2')) || fd.get(PDFName.of('FontFile3')), 'font file embedded');
  assert.ok(bytes.length < fs.statSync(fontPad).size, 'subset is smaller than the whole font');
});

// Variabele lettertypen gaan heel mee: fontkits subsetter liet bij Cascadia
// Mono de meeste tekens leeg (alleen M, o, b, e, ... bleven zichtbaar).
const variabelPad = [path.join(process.env.WINDIR || 'C:/Windows', 'Fonts', 'CascadiaMono.ttf'), path.join(process.env.WINDIR || 'C:/Windows', 'Fonts', 'bahnschrift.ttf')].find((p) => fs.existsSync(p));

test('keten: een variabel lettertype wordt heel ingebed', { skip: !variabelPad && 'no variable font on this machine' }, async () => {
  const doc = await PDFDocument.create();
  const keten = maakSysteemFontKeten(doc, {
    zoek: async () => ({ pad: variabelPad, exact: true, insluitbaar: true, reden: null }),
    laadBytes: async (p) => new Uint8Array(fs.readFileSync(p)),
  });
  const f = await keten.voor('Variable Font');
  assert.ok(f);
  const page = doc.addPage([200, 100]);
  page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: doc.context.obj({ [f.naam]: f.font.ref }) }));
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream(`BT /${f.naam} 12 Tf 10 50 Td ${f.font.encodeText('Cascadia 0123').toString()} Tj ET`)));
  const bytes = await doc.save();
  const terug = await PDFDocument.load(bytes);
  const fontDict = terug.context.lookup(terug.getPage(0).node.Resources().lookup(PDFName.of('Font'), PDFDict).get(PDFName.of(f.naam)), PDFDict);
  assert.doesNotMatch(fontDict.get(PDFName.of('BaseFont')).toString(), /[+]/, 'no subset tag on a whole font');
  const cid = terug.context.lookup(fontDict.lookup(PDFName.of('DescendantFonts')).get(0), PDFDict);
  const ff = terug.context.lookup(cid.lookup(PDFName.of('FontDescriptor'), PDFDict).get(PDFName.of('FontFile2')));
  const lengte1 = decodePDFRawStream(ff).decode().length;
  assert.equal(lengte1, fs.statSync(variabelPad).size, 'the whole font file is in the PDF');
});

// A collection can contain several families/styles at the same file path.
// The IPC returns one standalone face; the save cache must keep them apart.
const fixtureBytes = new Uint8Array(fs.readFileSync(new URL('../../../scripts/font-native-tests/fixtures/installed.ttf', import.meta.url)));

test('collection faces are requested and cached separately, with real embedded widths', async () => {
  const doc = await PDFDocument.create();
  const requests = [];
  const keten = maakSysteemFontKeten(doc, {
    zoek: async (family) => ({ pad: '/fonts/collection.ttc', gezicht: family === 'First' ? 0 : 1, insluitbaar: true, exact: true }),
    laadBytes: async (pad, gezicht) => { requests.push([pad, gezicht]); return fixtureBytes; },
  });
  const a = await keten.voor('First');
  const b = await keten.voor('Second');
  assert.ok(a && b);
  assert.notEqual(a, b, 'different faces never reuse the first face');
  assert.notEqual(a.naam, b.naam);
  assert.equal(await keten.voor('Second'), b);
  assert.deepEqual(requests, [['/fonts/collection.ttc', 0], ['/fonts/collection.ttc', 1]]);
  const page = doc.addPage();
  page.drawText('A日', { font: a.font, x: 20, y: 80 });
  page.drawText('A日', { font: b.font, x: 20, y: 40 });
  const saved = await PDFDocument.load(await doc.save());
  for (const f of [a, b]) {
    const dict = saved.context.lookup(f.font.ref, PDFDict);
    assert.equal(dict.get(PDFName.of('Subtype')).toString(), '/Type0');
    const cid = saved.context.lookup(dict.lookup(PDFName.of('DescendantFonts')).get(0), PDFDict);
    assert.ok(cid.lookup(PDFName.of('W')).size() > 0, 'glyph widths present');
    assert.ok(cid.lookup(PDFName.of('FontDescriptor'), PDFDict).get(PDFName.of('FontFile2')));
    assert.ok(dict.get(PDFName.of('ToUnicode')));
  }
});

test('no-subsetting rights embed the entire extracted face', async () => {
  const doc = await PDFDocument.create();
  const keten = maakSysteemFontKeten(doc, {
    zoek: async () => ({ pad: '/fonts/collection.ttc', gezicht: 1, subset: false, insluitbaar: true, exact: true }),
    laadBytes: async () => fixtureBytes,
  });
  const f = await keten.voor('No subset');
  doc.addPage().drawText('A', { font: f.font });
  const saved = await PDFDocument.load(await doc.save());
  const dict = saved.context.lookup(f.font.ref, PDFDict);
  assert.doesNotMatch(dict.get(PDFName.of('BaseFont')).toString(), /[+]/);
  const cid = saved.context.lookup(dict.lookup(PDFName.of('DescendantFonts')).get(0), PDFDict);
  const stream = saved.context.lookup(cid.lookup(PDFName.of('FontDescriptor'), PDFDict).get(PDFName.of('FontFile2')));
  assert.deepEqual(new Uint8Array(decodePDFRawStream(stream).decode()), fixtureBytes);
});
