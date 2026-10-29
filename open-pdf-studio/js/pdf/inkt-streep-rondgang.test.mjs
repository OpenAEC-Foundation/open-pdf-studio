// Gestreepte of gestippelde inkt zonder druk (een muisstreek) werd in andere
// lezers doorgetrokken getekend: de appearance van een gewone inktstreek
// (saver/utils.js generateAppearanceStream) schreef geen streepoperator `d`,
// terwijl het scherm (applyBorderStyle) en de drukinkt-appearance
// (pressure-ink.js) het patroon wel tekenen.
//
// Daarnaast schreef /BS /D een ander patroon ([8 4] en [2 2]) dan het scherm
// en de appearances ([3 4] en [2 4]); een lezer die zijn appearance zelf uit
// /BS opbouwt, tekende de streep dus anders. /BS /D volgt nu het scherm, en
// de lader herkent zowel het nieuwe als het oude patroon.
//
// Opslaan en heropenen met de echte saver en lader (rondgang.testhulp.mjs);
// het beeld met MuPDF.

import assert from 'node:assert/strict';
import test from 'node:test';
import * as mupdf from 'mupdf';
import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { leegBlad, opslaan, laad, woordenboeken } from './rondgang.testhulp.mjs';

const basis = {
  page: 1, rotation: 0, color: '#1144cc', strokeColor: '#1144cc', fillColor: null,
  lineWidth: 2, borderStyle: 'solid', opacity: 1, author: 'Tester',
  createdAt: '2026-10-29T10:00:00.000Z', modifiedAt: '2026-10-29T10:00:00.000Z',
};

// Een horizontale muisstreek op app-hoogte 300 (zonder druk, zonder gladheid).
const Y_APP = 300;
const pad = () => [{ x: 100, y: Y_APP }, { x: 160, y: Y_APP }, { x: 230, y: Y_APP }, { x: 300, y: Y_APP }];

async function inkt(bytes) {
  const lijst = await woordenboeken(bytes);
  const inktLijst = lijst.filter(({ dict }) => String(dict.get(PDFName.of('Subtype'))) === '/Ink');
  assert.equal(inktLijst.length, 1, 'precies één /Ink');
  const ctx = lijst.doc.context;
  const { dict } = inktLijst[0];
  const ap = ctx.lookup(dict.get(PDFName.of('AP')));
  const n = ap && ctx.lookup(ap.get(PDFName.of('N')));
  const inhoud = n ? Buffer.from(n instanceof PDFRawStream ? decodePDFRawStream(n).decode() : n.getContents()).toString('latin1') : '';
  const bs = ctx.lookup(dict.get(PDFName.of('BS')));
  const d = bs.get(PDFName.of('D'));
  const streep = d ? ctx.lookup(d).asArray().map((g) => g.asNumber()) : null;
  return { inhoud, bsStijl: String(bs.get(PDFName.of('S'))), streep };
}

// Aantal onderbrekingen in de streek op de rij van de streek, met MuPDF op
// schaal 2 (blad 595x842: app-y 300 is pdf-y 542, pixelrij 600).
function onderbrekingen(bytes) {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  const pix = doc.loadPage(0).toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false, true);
  const breedte = pix.getWidth();
  const n = pix.getNumberOfComponents();
  const px = pix.getPixels();
  const rij = Y_APP * 2;
  let inkt = 0, gaten = 0, vorige = null;
  for (let x = 2 * 104; x < 2 * 296; x++) {
    const groen = px[(rij * breedte + x) * n + 1];
    const isInkt = groen < 180;
    if (isInkt) inkt++;
    if (vorige === true && !isInkt) gaten++;
    vorige = isInkt;
  }
  return { inkt, gaten };
}

for (const [stijl, patroon] of [['dashed', [3, 4]], ['dotted', [2, 4]]]) {
  test(`${stijl} muisstreek: de appearance tekent het patroon van het scherm`, async () => {
    const ann = { ...basis, id: stijl, type: 'draw', path: pad(), borderStyle: stijl };
    const bytes = await opslaan(await leegBlad(), [ann]);
    const { inhoud, bsStijl, streep } = await inkt(bytes);
    assert.match(inhoud, new RegExp(`^\\[${patroon.join(' ')}\\] 0 d$`, 'm'), `dash-operator in de /AP:\n${inhoud}`);
    assert.match(inhoud, /^1 J$/m, 'ronde kappen, zoals het scherm');
    assert.match(inhoud, /^1 j$/m, 'ronde hoeken, zoals het scherm');
    assert.equal(bsStijl, '/D');
    assert.deepEqual(streep, patroon, '/BS /D volgt hetzelfde patroon als het scherm');

    const { inkt: zwart, gaten } = onderbrekingen(bytes);
    assert.ok(zwart > 100, `de streek is zichtbaar (${zwart} px)`);
    assert.ok(gaten >= 15, `onderbroken in MuPDF (${gaten} gaten)`);

    const [m] = await laad(bytes);
    assert.equal(m.borderStyle, stijl, 'de lijnstijl komt terug');
  });
}

test('doorgetrokken muisstreek: geen patroon en geen onderbrekingen', async () => {
  const bytes = await opslaan(await leegBlad(), [{ ...basis, id: 'vol', type: 'draw', path: pad() }]);
  const { inhoud, bsStijl, streep } = await inkt(bytes);
  assert.doesNotMatch(inhoud, /\] 0 d$/m);
  assert.equal(bsStijl, '/S');
  assert.equal(streep, null);
  const { inkt: zwart, gaten } = onderbrekingen(bytes);
  assert.ok(zwart > 300, `doorgetrokken (${zwart} px)`);
  assert.equal(gaten, 0);
  const [m] = await laad(bytes);
  assert.equal(m.borderStyle, 'solid');
});

test('oude bestanden: /BS /D [8 4] blijft gestreept, [2 2] gestippeld', async () => {
  for (const [stijl, oud] of [['dashed', [8, 4]], ['dotted', [2, 2]]]) {
    const bytes = await opslaan(await leegBlad(), [{ ...basis, id: stijl, type: 'draw', path: pad(), borderStyle: stijl }]);
    const doc = await PDFDocument.load(bytes);
    const annot = doc.context.lookup(doc.getPage(0).node.Annots().get(0));
    const bs = doc.context.lookup(annot.get(PDFName.of('BS')));
    bs.set(PDFName.of('D'), doc.context.obj(oud));
    const [m] = await laad(await doc.save());
    assert.equal(m.borderStyle, stijl, `${oud} -> ${stijl}`);
  }
});

test('/BS /D gelijk aan het scherm (applyBorderStyle) voor elke lijnstijl', async () => {
  const { applyBorderStyle } = await import('../annotations/rendering/decorations.js');
  const { buildBorderStyle } = await import('./saver/utils.js');
  const doc = await PDFDocument.create();
  for (const stijl of ['solid', 'dashed', 'dotted', 'dash-dot', 'dash-dot-dot', 'long-dash', 'long-dash-dot', 'long-dash-dot-dot']) {
    let scherm = null;
    applyBorderStyle({ setLineDash: (d) => { scherm = d; } }, stijl);
    const bs = buildBorderStyle(doc.context, 2, stijl);
    const d = bs.get(PDFName.of('D'));
    assert.deepEqual(d ? doc.context.lookup(d).asArray().map((g) => g.asNumber()) : [], scherm, stijl);
  }
});

test('veelhoek en tekstvak: hun appearance tekent hetzelfde patroon als het scherm', async () => {
  const vormen = [
    { ...basis, id: 'pg', type: 'polygon', x: 80, y: 300, width: 140, height: 90, sides: 6 },
    { ...basis, id: 'tb', type: 'textbox', x: 60, y: 60, width: 220, height: 60, text: 'hallo',
      fontSize: 12, fontFamily: 'Arial', textColor: '#000000', lineWidth: 1 },
  ];
  for (const vorm of vormen) {
    for (const [stijl, patroon] of [['dashed', '[3 4] 0 d'], ['dotted', '[2 4] 0 d'], ['dash-dot', '[10 8 2 8] 0 d']]) {
      const bytes = await opslaan(await leegBlad(), [{ ...vorm, borderStyle: stijl }]);
      const lijst = await woordenboeken(bytes);
      assert.equal(lijst.length, 1);
      const ctx = lijst.doc.context;
      const n = ctx.lookup(ctx.lookup(lijst[0].dict.get(PDFName.of('AP'))).get(PDFName.of('N')));
      const inhoud = Buffer.from(n instanceof PDFRawStream ? decodePDFRawStream(n).decode() : n.getContents()).toString('latin1');
      assert.ok(inhoud.includes(patroon), `${vorm.type} ${stijl}: ${patroon} in\n${inhoud}`);
    }
  }
});
