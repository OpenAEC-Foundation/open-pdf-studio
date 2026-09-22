// "Opslaan als PDF" uit de printdialoog: de print-PDF met de bronpagina's als
// vectoren (Form XObject) op het vel, in de gekozen stand en op de gekozen
// schaal. Alleen pdf-lib, dus in node te testen.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream, PDFRef, StandardFonts, degrees, decodePDFRawStream,
} from 'pdf-lib';

import {
  bouwVectorPrintPdf, weergaveMaat, paginaOpVelMatrix, verwijderOnbereikbaar,
  maakTegelRaster, vakkenUitRaster, vakOpVel,
} from './print-vector.js';
import { PAPIERFORMATEN } from './print-pagina-instelling.js';

const MM = 72 / 25.4;
const vel = (sleutel) => ({ breedteMm: PAPIERFORMATEN[sleutel].breedte, hoogteMm: PAPIERFORMATEN[sleutel].hoogte });
const KEUZES = { orientatie: 'auto', schaling: 'fit', zoom: 100, centreren: true };

function bijna(werkelijk, verwacht, speling = 0.01, wat = '') {
  assert.ok(Math.abs(werkelijk - verwacht) <= speling, `${wat} ${werkelijk} ≠ ${verwacht} (±${speling})`);
}

/** Bron-PDF: per pagina [breedte, hoogte, rotate] in pt, met tekst en een lijn. */
async function bron(paginas, { koppelingen = false } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  paginas.forEach(([b, h, rot = 0], i) => {
    const p = doc.addPage([b, h]);
    p.drawText(`Vectortekst pagina ${i + 1}`, { x: 40, y: h - 60, size: 24, font });
    p.drawLine({ start: { x: 20, y: 20 }, end: { x: b - 20, y: h - 20 }, thickness: 2 });
    if (rot) p.setRotation(degrees(rot));
  });
  if (koppelingen) {
    // Elke pagina een koppeling naar de volgende: bij kopiëren sleept zo'n
    // annotatie de doelpagina mee.
    const ps = doc.getPages();
    ps.forEach((p, i) => {
      const doel = ps[(i + 1) % ps.length];
      const annot = doc.context.register(doc.context.obj({
        Type: 'Annot', Subtype: 'Link', Rect: [10, 10, 100, 30], Dest: [doel.ref, 'Fit'],
      }));
      p.node.set(PDFName.of('Annots'), doc.context.obj([annot]));
    });
  }
  return doc.save();
}

/** Alle XObjects van een pagina: [{ naam, subtype, stroom }]. */
function xobjecten(pagina) {
  const res = pagina.node.Resources();
  const xo = res?.lookupMaybe(PDFName.of('XObject'), PDFDict);
  if (!xo) return [];
  return xo.entries().map(([naam, ref]) => {
    const stroom = pagina.doc.context.lookup(ref);
    return { naam: naam.decodeText(), subtype: stroom.dict.get(PDFName.of('Subtype')).decodeText(), stroom };
  });
}

function stroomTekst(stroom) {
  const bytes = stroom instanceof PDFRawStream ? decodePDFRawStream(stroom).decode() : stroom.getContents();
  return Buffer.from(bytes).toString('latin1');
}

function paginaInhoud(pagina) {
  const c = pagina.node.Contents();
  const stromen = c instanceof PDFArray ? c.asArray().map((r) => pagina.doc.context.lookup(r)) : [c];
  return stromen.map(stroomTekst).join('\n');
}

/** Elke `cm` die direct voor een `Do` staat, in volgorde: [[a b c d e f], …]. */
function alleMatrices(pagina) {
  const re = /(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) cm\s+\/\S+ Do/g;
  return [...paginaInhoud(pagina).matchAll(re)].map((m) => m.slice(1, 7).map(Number));
}

/** De matrix waarmee de bronpagina op het vel staat. */
function plaatsingsMatrix(pagina) {
  const alle = alleMatrices(pagina);
  assert.ok(alle.length > 0, `geen "cm … Do" in: ${paginaInhoud(pagina)}`);
  return alle[0];
}

async function herlaad(pdf) {
  return PDFDocument.load(await pdf.save());
}

// --- de pagina zoals ze getoond wordt ------------------------------------------

test('weergaveMaat: /Rotate en de draaiing uit de app wisselen breedte en hoogte', async () => {
  const doc = await PDFDocument.load(await bron([[1191, 1684, 90], [595, 842]]));
  const [gedraaid, recht] = doc.getPages();
  assert.deepEqual(weergaveMaat(gedraaid, 0), { breedtePt: 1684, hoogtePt: 1191, rotatie: 90 });
  assert.deepEqual(weergaveMaat(gedraaid, 90), { breedtePt: 1191, hoogtePt: 1684, rotatie: 180 });
  assert.deepEqual(weergaveMaat(recht, 0), { breedtePt: 595, hoogtePt: 842, rotatie: 0 });
  assert.deepEqual(weergaveMaat(recht, 270), { breedtePt: 842, hoogtePt: 595, rotatie: 270 });
});

test('weergaveMaat: de CropBox binnen de MediaBox is de pagina', async () => {
  const doc = await PDFDocument.load(await bron([[595, 842]]));
  const p = doc.getPage(0);
  p.setCropBox(50, 100, 400, 500);
  const m = weergaveMaat(p, 0);
  assert.deepEqual([m.breedtePt, m.hoogtePt], [400, 500]);
  assert.deepEqual(m.vak, undefined);
});

test('paginaOpVelMatrix: mm vanaf linksboven wordt pt vanaf linksonder, met de schaal', () => {
  const plaatsing = {
    vel: { breedteMm: 297, hoogteMm: 420 },
    pagina: { x: 43.5, y: 61.5, breedte: 210, hoogte: 297 },
    schaal: 1,
  };
  const m = paginaOpVelMatrix(plaatsing, 420 * MM);
  bijna(m[0], 1); bijna(m[3], 1);
  assert.deepEqual([m[1], m[2]], [0, 0]);
  bijna(m[4], 43.5 * MM);
  bijna(m[5], (420 - 61.5 - 297) * MM);
  const half = paginaOpVelMatrix({ ...plaatsing, pagina: { x: 0, y: 0, breedte: 105, hoogte: 148.5 }, schaal: 0.5 }, 420 * MM);
  bijna(half[0], 0.5);
  bijna(half[5], (420 - 148.5) * MM);
});

// --- de print-PDF ----------------------------------------------------------------

test('liggende A2: het vel ligt, /Rotate 0, tekst en lijnen blijven vectoren', async () => {
  const bytes = await bron([[1684, 1191]]);
  const { pdf, opVel } = await bouwVectorPrintPdf({
    bronBytes: bytes, paginas: [{ index: 0 }], keuzes: { ...KEUZES, papier: vel('a2') },
  });
  assert.equal(opVel, true);
  const uit = await herlaad(pdf);
  assert.equal(uit.getPageCount(), 1);
  const p = uit.getPage(0);
  const { width, height } = p.getSize();
  bijna(width, 594 * MM); bijna(height, 420 * MM);
  assert.ok(width > height, 'liggend: breder dan hoog');
  assert.equal(p.getRotation().angle, 0);
  assert.equal(p.node.get(PDFName.of('Rotate')), undefined);

  // Eén Form XObject met de inhoud van de bronpagina; geen afbeelding.
  const xo = xobjecten(p);
  assert.deepEqual(xo.map((x) => x.subtype), ['Form']);
  const inhoud = stroomTekst(xo[0].stroom);
  assert.match(inhoud, /BT[\s\S]*Tj[\s\S]*ET/, 'tekstoperatoren in de vorm');
  assert.match(inhoud, /\bl\b[\s\S]*\bS\b/, 'lijnoperatoren in de vorm');
  // De vorm neemt het lettertype van de bron mee.
  const fonts = xo[0].stroom.dict.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('Font'), PDFDict);
  assert.equal(fonts.entries().length, 1);
  // Passend: 1684 x 1191 pt op 594 x 420 mm.
  const m = plaatsingsMatrix(p);
  bijna(m[0], Math.min((594 * MM) / 1684, (420 * MM) / 1191), 1e-4);
  assert.deepEqual([m[1], m[2]], [0, 0]);
});

test('een bron met /Rotate 90 komt rechtop op een liggend vel, zonder /Rotate', async () => {
  // Opgeslagen staand (1191 x 1684) met /Rotate 90: getoond liggend.
  const bytes = await bron([[1191, 1684, 90]]);
  const { pdf } = await bouwVectorPrintPdf({
    bronBytes: bytes, paginas: [{ index: 0 }], keuzes: { ...KEUZES, papier: vel('a2') },
  });
  const p = (await herlaad(pdf)).getPage(0);
  const { width, height } = p.getSize();
  assert.ok(width > height);
  assert.equal(p.node.get(PDFName.of('Rotate')), undefined);
  // De draaiing zit in de matrix van de vorm (kwartslag met de klok mee).
  const vorm = xobjecten(p)[0].stroom;
  const matrix = vorm.dict.lookup(PDFName.of('Matrix'), PDFArray).asArray().map((n) => n.asNumber());
  assert.deepEqual(matrix, [0, -1, 1, 0, 0, 1191]);
});

test('haaks op een handmatig gekozen vel: een kwartslag linksom, het vel gevuld', async () => {
  const bytes = await bron([[595.28, 841.89]]);
  const { pdf } = await bouwVectorPrintPdf({
    bronBytes: bytes,
    paginas: [{ index: 0 }],
    keuzes: { ...KEUZES, papier: vel('a4'), orientatie: 'landscape' },
  });
  const p = (await herlaad(pdf)).getPage(0);
  const { width, height } = p.getSize();
  bijna(width, 297 * MM); bijna(height, 210 * MM);
  const vorm = xobjecten(p)[0].stroom;
  const matrix = vorm.dict.lookup(PDFName.of('Matrix'), PDFArray).asArray().map((n) => n.asNumber());
  // 270 met de klok mee = een kwartslag linksom: (x, y) → (boven - y, x - links).
  assert.deepEqual(matrix.slice(0, 4), [0, 1, -1, 0]);
  bijna(matrix[4], 841.89); bijna(matrix[5], 0);
  const m = plaatsingsMatrix(p);
  bijna(m[0], 1, 1e-3); bijna(m[4], 0, 0.05); bijna(m[5], 0, 0.05);
});

test('schaal en plek: A4 op A3 op ware grootte staat gecentreerd op het vel', async () => {
  const bytes = await bron([[210 * MM, 297 * MM]]);
  const { pdf } = await bouwVectorPrintPdf({
    bronBytes: bytes, paginas: [{ index: 0 }], keuzes: { ...KEUZES, papier: vel('a3'), schaling: 'actual' },
  });
  const p = (await herlaad(pdf)).getPage(0);
  const { width, height } = p.getSize();
  bijna(width, 297 * MM); bijna(height, 420 * MM);
  const m = plaatsingsMatrix(p);
  bijna(m[0], 1, 1e-6); bijna(m[3], 1, 1e-6);
  bijna(m[4], 43.5 * MM); bijna(m[5], 61.5 * MM);
});

test('grote en verlengde vellen: de maat van het vel, zonder papiercode', async () => {
  const bytes = await bron([[2384, 3370]]);
  for (const sleutel of ['a1', 'a0', 'a3l', 'a0l']) {
    const { pdf } = await bouwVectorPrintPdf({
      bronBytes: bytes, paginas: [{ index: 0 }], keuzes: { ...KEUZES, papier: vel(sleutel), orientatie: 'landscape' },
    });
    const { width, height } = (await herlaad(pdf)).getPage(0).getSize();
    bijna(width, PAPIERFORMATEN[sleutel].hoogte * MM, 0.01, sleutel);
    bijna(height, PAPIERFORMATEN[sleutel].breedte * MM, 0.01, sleutel);
  }
});

test('papier "pagina": elke pagina haar eigen vel, in de gekozen stand', async () => {
  // Een liggende en een staande pagina, handmatig Staand: de liggende komt
  // gedraaid op een staand vel van haar eigen maat, de staande blijft zoals ze is.
  const bytes = await bron([[1684, 1191], [595, 842]]);
  const { pdf, opVel } = await bouwVectorPrintPdf({
    bronBytes: bytes,
    paginas: [{ index: 0 }, { index: 1 }],
    keuzes: { ...KEUZES, papier: 'pagina', orientatie: 'portrait' },
  });
  assert.equal(opVel, true);
  const [p0, p1] = (await herlaad(pdf)).getPages();
  bijna(p0.getSize().width, 1191, 0.01); bijna(p0.getSize().height, 1684, 0.01);
  bijna(p1.getSize().width, 595, 0.01); bijna(p1.getSize().height, 842, 0.01);
  const matrix = xobjecten(p0)[0].stroom.dict.lookup(PDFName.of('Matrix'), PDFArray).asArray().map((n) => n.asNumber());
  assert.deepEqual(matrix.slice(0, 4), [0, 1, -1, 0], 'een kwartslag linksom');
  const m = plaatsingsMatrix(p0);
  bijna(m[0], 1, 1e-6); bijna(m[4], 0, 0.01); bijna(m[5], 0, 0.01);
});

test('onbekend papier: elke pagina op haar eigen maat', async () => {
  const bytes = await bron([[1684, 1191], [595, 842]]);
  const { pdf, opVel } = await bouwVectorPrintPdf({
    bronBytes: bytes, paginas: [{ index: 0 }, { index: 1 }], keuzes: { ...KEUZES, papier: null },
  });
  assert.equal(opVel, false);
  const maten = (await herlaad(pdf)).getPages().map((p) => [p.getSize().width, p.getSize().height]);
  assert.deepEqual(maten, [[1684, 1191], [595, 842]]);
});

test('paginakeuze en volgorde: alleen de gevraagde pagina\'s, in die volgorde', async () => {
  const bytes = await bron([[595, 842], [842, 595], [595, 842]]);
  const gezien = [];
  const { pdf } = await bouwVectorPrintPdf({
    bronBytes: bytes,
    paginas: [{ index: 2 }, { index: 1 }],
    keuzes: { ...KEUZES, papier: vel('a4') },
    voortgang: (i, index) => gezien.push([i, index]),
  });
  assert.deepEqual(gezien, [[0, 2], [1, 1]]);
  const uit = await herlaad(pdf);
  assert.equal(uit.getPageCount(), 2);
  assert.match(stroomTekst(xobjecten(uit.getPage(0))[0].stroom), /BT/);
  // Pagina 2 van de bron is liggend: bij 'auto' een liggend vel.
  assert.ok(uit.getPage(1).getSize().width > uit.getPage(1).getSize().height);
  assert.ok(uit.getPage(0).getSize().width < uit.getPage(0).getSize().height);
});

test('de draaiing uit de app telt mee (nog niet opgeslagen)', async () => {
  const bytes = await bron([[595, 842]]);
  const { pdf } = await bouwVectorPrintPdf({
    bronBytes: bytes, paginas: [{ index: 0, extraRotatie: 90 }], keuzes: { ...KEUZES, papier: vel('a4') },
  });
  const p = (await herlaad(pdf)).getPage(0);
  assert.ok(p.getSize().width > p.getSize().height, 'getoond liggend → liggend vel');
  const matrix = xobjecten(p)[0].stroom.dict.lookup(PDFName.of('Matrix'), PDFArray).asArray().map((n) => n.asNumber());
  assert.deepEqual(matrix, [0, -1, 1, 0, 0, 595]);
});

test('een onbestaande pagina is een fout, geen lege pagina', async () => {
  const bytes = await bron([[595, 842]]);
  await assert.rejects(
    bouwVectorPrintPdf({ bronBytes: bytes, paginas: [{ index: 4 }], keuzes: { ...KEUZES, papier: vel('a4') } }),
    /page 5/,
  );
});

// --- markeringen: beelden op het vel, alleen waar iets staat ---------------------

// 1 x 1 pixel, doorzichtig.
const PNG_1PX = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
));

test('beelden van de markeringen komen bovenop de vectoren, op hun plek in mm', async () => {
  const bytes = await bron([[210 * MM, 297 * MM]]);
  const gevraagd = [];
  const { pdf } = await bouwVectorPrintPdf({
    bronBytes: bytes,
    paginas: [{ index: 0 }],
    keuzes: { ...KEUZES, papier: vel('a4') },
    beelden: async ({ index, plaatsing }) => {
      gevraagd.push([index, plaatsing.vel.orientatie]);
      return [{ png: PNG_1PX, opVel: { x: 10, y: 20, breedte: 50, hoogte: 30 } }];
    },
  });
  assert.deepEqual(gevraagd, [[0, 'portrait']]);
  const p = (await herlaad(pdf)).getPage(0);
  const soorten = xobjecten(p).map((x) => x.subtype).sort();
  assert.deepEqual(soorten, ['Form', 'Image']);
  // Eerst de vorm, dan het beeld; het beeld 50 x 30 mm op (10, 20) mm van linksboven.
  const [, beeld] = alleMatrices(p);
  assert.ok(beeld, paginaInhoud(p));
  bijna(beeld[0], 50 * MM); bijna(beeld[3], 30 * MM);
  assert.deepEqual([beeld[1], beeld[2]], [0, 0]);
  bijna(beeld[4], 10 * MM); bijna(beeld[5], (297 - 20 - 30) * MM);
  // Geen paginavullend beeld: de gerasterde printopdracht heeft er precies één
  // dat het hele vel bedekt; hier bedekt het beeld alleen de markering.
  const velOpp = 210 * 297;
  assert.ok((beeld[0] / MM) * (beeld[3] / MM) < 0.05 * velOpp, 'het beeld bedekt te veel van het vel');
  // De tekst van de bron is tekst gebleven.
  const vorm = xobjecten(p).find((x) => x.subtype === 'Form');
  assert.match(stroomTekst(vorm.stroom), /BT[\s\S]*Tj[\s\S]*ET/);
});

test('vakOpVel: pixels van het beeld worden mm op het vel', () => {
  const deel = { px: { x: 100, y: 200, breedte: 1000, hoogte: 500 }, opVel: { x: 10, y: 20, breedte: 100, hoogte: 50 } };
  assert.deepEqual(vakOpVel(deel, { x: 0, y: 0, breedte: 1000, hoogte: 500 }), { x: 10, y: 20, breedte: 100, hoogte: 50 });
  assert.deepEqual(vakOpVel(deel, { x: 250, y: 100, breedte: 500, hoogte: 250 }), { x: 35, y: 30, breedte: 50, hoogte: 25 });
});

test('tegelraster: alleen tegels met dekking tellen, per band gevuld', () => {
  const raster = maakTegelRaster(10, 6, 4); // 3 x 2 tegels
  assert.deepEqual([raster.kolommen, raster.rijen], [3, 2]);
  // Band van 2 rijen vanaf y = 3: pixel (9, 4) dekkend → tegel (2, 1).
  const band = new Uint8ClampedArray(10 * 2 * 4);
  band[(1 * 10 + 9) * 4 + 3] = 255;
  raster.markeer(band, 3, 2);
  assert.deepEqual(Array.from(raster.bezet), [0, 0, 0, 0, 0, 1]);
  assert.deepEqual(vakkenUitRaster(raster), [{ x: 8, y: 4, breedte: 2, hoogte: 2 }]);
  // Volledig doorzichtig blijft leeg.
  const leeg = maakTegelRaster(10, 6, 4);
  leeg.markeer(new Uint8ClampedArray(10 * 6 * 4), 0, 6);
  assert.deepEqual(vakkenUitRaster(leeg), []);
});

test('vakken: losse groepen apart, overlappende omhullenden samengevoegd, nooit overlap', () => {
  const raster = maakTegelRaster(80, 80, 10); // 8 x 8 tegels
  const zet = (k, r) => { raster.bezet[r * raster.kolommen + k] = 1; };
  // Groep linksboven (2 tegels naast elkaar) en een losse tegel rechtsonder.
  zet(0, 0); zet(1, 0); zet(7, 7);
  assert.deepEqual(vakkenUitRaster(raster), [
    { x: 0, y: 0, breedte: 20, hoogte: 10 },
    { x: 70, y: 70, breedte: 10, hoogte: 10 },
  ]);
  // Een L-vorm waarvan de omhullende een losse tegel omvat: één vak.
  const l = maakTegelRaster(80, 80, 10);
  const zetL = (k, r) => { l.bezet[r * l.kolommen + k] = 1; };
  zetL(0, 0); zetL(0, 1); zetL(0, 2); zetL(1, 2); zetL(2, 2); zetL(2, 0);
  assert.deepEqual(vakkenUitRaster(l), [{ x: 0, y: 0, breedte: 30, hoogte: 30 }]);
  // Geen twee vakken overlappen (dubbel tekenen zou doorzichtige markeringen donkerder maken).
  const vol = maakTegelRaster(80, 80, 10);
  for (const [k, r] of [[0, 0], [2, 1], [1, 3], [5, 5], [6, 4], [7, 7], [3, 6]]) vol.bezet[r * vol.kolommen + k] = 1;
  const vakken = vakkenUitRaster(vol);
  for (let i = 0; i < vakken.length; i++) {
    for (let j = i + 1; j < vakken.length; j++) {
      const [a, b] = [vakken[i], vakken[j]];
      const los = a.x + a.breedte <= b.x || b.x + b.breedte <= a.x || a.y + a.hoogte <= b.y || b.y + b.hoogte <= a.y;
      assert.ok(los, `${JSON.stringify(a)} overlapt ${JSON.stringify(b)}`);
    }
  }
});

// --- geen resten van de bron ------------------------------------------------------

test('de print-PDF sleept geen bronpagina\'s, annotaties of losse stromen mee', async () => {
  const bytes = await bron([[595, 842], [595, 842], [595, 842]], { koppelingen: true });
  const { pdf } = await bouwVectorPrintPdf({
    bronBytes: bytes, paginas: [{ index: 0 }], keuzes: { ...KEUZES, papier: vel('a4') },
  });
  const uit = await herlaad(pdf);
  assert.equal(uit.getPageCount(), 1);
  // pdf-lib zet op een nieuwe pagina zelf een lege /Annots.
  assert.equal(uit.getPage(0).node.Annots()?.size() ?? 0, 0);
  // Alles in het bestand is bereikbaar vanaf de trailer: geen wezen.
  const voor = uit.context.enumerateIndirectObjects().length;
  assert.equal(verwijderOnbereikbaar(uit), 0, 'er stonden nog onbereikbare objecten in');
  assert.equal(uit.context.enumerateIndirectObjects().length, voor);
  // Eén paginablad, en geen tekst van de andere pagina's.
  const bladen = uit.context.enumerateIndirectObjects()
    .filter(([, o]) => o instanceof PDFDict && o.get(PDFName.of('Type')) === PDFName.of('Page'));
  assert.equal(bladen.length, 1);
  const alles = uit.context.enumerateIndirectObjects()
    .filter(([, o]) => o instanceof PDFRawStream).map(([, o]) => stroomTekst(o)).join('\n');
  assert.ok(!alles.includes('pagina 2'), 'inhoud van een niet gekozen pagina meegekomen');
});

test('een gedeeld lettertype komt één keer mee, ook bij meer pagina\'s', async () => {
  const bytes = await bron([[595, 842], [595, 842], [595, 842]]);
  const { pdf } = await bouwVectorPrintPdf({
    bronBytes: bytes, paginas: [{ index: 0 }, { index: 1 }, { index: 2 }], keuzes: { ...KEUZES, papier: vel('a4') },
  });
  const uit = await herlaad(pdf);
  const fonts = uit.context.enumerateIndirectObjects()
    .filter(([, o]) => o instanceof PDFDict && o.get(PDFName.of('Type')) === PDFName.of('Font'));
  assert.equal(fonts.length, 1);
});

test('verwijderOnbereikbaar: haalt alleen weg wat vanaf de trailer niet te bereiken is', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([100, 100]);
  const wees = doc.context.register(doc.context.obj({ Wees: true }));
  assert.ok(wees instanceof PDFRef);
  assert.equal(verwijderOnbereikbaar(doc), 1);
  assert.equal(doc.context.lookup(wees), undefined);
  assert.equal((await herlaad(doc)).getPageCount(), 1);
});
