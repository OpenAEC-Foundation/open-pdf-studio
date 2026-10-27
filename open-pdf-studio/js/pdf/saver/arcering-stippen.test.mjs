// Stippenarcering (concrete, sand, dots, ...) in een opgeslagen appearance.
//
// Het stippenrooster werd over de hele opgeblazen omhullende geschreven (zijde
// ~2x de diagonaal plus marge), terwijl de knip (W n) bijna alles wegsnijdt:
// een vlak van 250x150 pt met 'concrete' gaf een appearance van 45 MB. Nu
// alleen de stippen die het vlak kunnen raken, met exact hetzelfde beeld, en
// gaat een grote vector-appearance met Flate.

import assert from 'node:assert/strict';
import test from 'node:test';
import * as mupdf from 'mupdf';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { hatchFillOps } from './appearance-vectors.js';
import { leegBlad, opslaan, laad } from '../rondgang.testhulp.mjs';

const HOOGTE = 120;

// Een blad van 120x120 pt met de ops als inhoud (app-y naar beneden).
async function bladMet(ops) {
  const doc = await PDFDocument.create();
  const blad = doc.addPage([120, HOOGTE]);
  const stroom = doc.context.stream(ops);
  blad.node.set(PDFName.of('Contents'), doc.context.register(stroom));
  return doc.save();
}

function pixels(bytes) {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  const pix = doc.loadPage(0).toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false, true);
  return pix.getPixels().slice();
}

const driehoek = [{ x: 25, y: 95 }, { x: 60, y: 45 }, { x: 95, y: 95 }];

for (const [patroon, hoek] of [['concrete', 30], ['sand', -50], ['dots', 0]]) {
  test(`${patroon} ${hoek} graden: alleen zichtbare stippen, beeld gelijk aan het volle rooster`, async () => {
    const basis = {
      points: driehoek, holes: null, hatchPattern: patroon, hatchColorRgb: [0.2, 0.2, 0.2],
      hatchScale: 100, hatchAngle: hoek, X: (x) => x, Y: (y) => HOOGTE - y,
    };
    const geknipt = hatchFillOps(basis);
    const vol = hatchFillOps({ ...basis, volledigRooster: true });
    const stippen = (s) => (s.match(/^f$/gm) || []).length;
    assert.ok(stippen(geknipt) > 20, 'er blijven stippen over');
    assert.ok(stippen(geknipt) * 4 < stippen(vol), `${stippen(geknipt)} van ${stippen(vol)} stippen`);
    assert.deepEqual(pixels(await bladMet(geknipt)), pixels(await bladMet(vol)), 'zelfde beeld');
  });
}

test('vlak met concrete van 250x150 pt blijft klein na opslaan en komt terug', async () => {
  const vlak = {
    id: 'beton', type: 'filledArea', page: 1, opacity: 1, printable: true,
    points: [{ x: 170, y: 400 }, { x: 295, y: 250 }, { x: 420, y: 400 }],
    x: 170, y: 250, width: 250, height: 150,
    color: '#6e6e6e', strokeColor: '#6e6e6e', fillColor: null, lineWidth: 0.7, borderStyle: 'solid',
    hatchPattern: 'concrete', hatchColor: '#6E6E6E', hatchScale: 100, hatchAngle: 0,
  };
  const uit = await opslaan(await leegBlad(), [vlak]);
  // Voorheen ~45 MB; nu een paar honderd KB aan zichtbare stippen, gecomprimeerd.
  assert.ok(uit.length < 400 * 1024, `opgeslagen ${uit.length} bytes`);

  const doc = await PDFDocument.load(uit);
  const annot = doc.context.lookup(doc.getPage(0).node.Annots().get(0));
  const n = doc.context.lookup(doc.context.lookup(annot.get(PDFName.of('AP'))).get(PDFName.of('N')));
  assert.ok(n instanceof PDFRawStream);
  assert.equal(n.dict.get(PDFName.of('Filter'))?.toString(), '/FlateDecode');

  const terug = (await laad(uit)).find((m) => m.type === 'filledArea');
  assert.ok(terug, 'vlak teruggelezen');
  assert.equal(terug.hatchPattern, 'concrete');
});
