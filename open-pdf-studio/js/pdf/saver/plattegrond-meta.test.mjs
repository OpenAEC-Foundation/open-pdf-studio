// Plattegrond-eigenschappen overleven opslaan en heropenen: een maat zonder
// eenheid, een meetvlak zonder eigen label, en het zaadpunt + de naam van een
// ruimte (zodat `rooms refresh` het vlak na heropenen nog terugvindt).

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName } from 'pdf-lib';

import { schrijfPlattegrondMeta } from './plattegrond-meta.js';
import { plattegrondUitExtra } from '../loader/plattegrond-meta.js';
import { extractAnnotationColors } from '../loader/color-extraction.js';
import { buildMeasureAreaAP, buildMeasureDistanceAP } from './appearance-vectors.js';

const RECT = [100, 100, 300, 200];
// App → PDF: x schuift 10 op, y klapt om; de lader doet het omgekeerde.
const X = (x) => x + 10;
const Y = (y) => 800 - y;
const naarApp = (px, py) => [px - 10, 800 - py];

/** Eén annotatie met de plattegrond-sleutels, opgeslagen en weer geopend. */
async function rondgang(ann, Subtype) {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([612, 792]);
  const context = doc.context;
  const annotDict = context.obj({ Type: 'Annot', Subtype, Rect: RECT });
  schrijfPlattegrondMeta(annotDict, ann, context, X, Y);
  pagina.node.set(PDFName.of('Annots'), context.obj([context.register(annotDict)]));
  const heropend = await PDFDocument.load(await doc.save());
  const extra = (await extractAnnotationColors(1, heropend)).get(RECT.join(','));
  return plattegrondUitExtra(extra, naarApp);
}

test('een maat zonder eenheid blijft zonder eenheid', async () => {
  assert.deepEqual(await rondgang({ type: 'measureDistance', dimShowUnit: false }, 'Line'), { dimShowUnit: false });
});

test('uitloop en hulplijnen van een maat blijven bewaard', async () => {
  assert.deepEqual(await rondgang({
    type: 'measureDistance', dimLineOvershootMm: 2, dimExtGapMm: 1.5, dimExtOvershootMm: 0,
    dimOvershootEnds: 'start',
  }, 'Line'), { dimLineOvershootMm: 2, dimExtGapMm: 1.5, dimExtOvershootMm: 0, dimOvershootEnds: 'start' });
  // 'both' is de standaard en hoeft niet in het bestand.
  assert.deepEqual(await rondgang({ type: 'measureDistance', dimOvershootEnds: 'both' }, 'Line'), {});
  // Onzin wordt niet geschreven.
  assert.deepEqual(await rondgang({ type: 'measureDistance', dimLineOvershootMm: 'x', dimOvershootEnds: 'midden' }, 'Line'), {});
});

test('een maat houdt zijn ketting en zijn rol', async () => {
  assert.deepEqual(await rondgang({ type: 'measureDistance', opsKettingId: 'ketting-1', opsMaatRol: 'total' }, 'Line'),
    { opsKettingId: 'ketting-1', opsMaatRol: 'total' });
  assert.deepEqual(await rondgang({ type: 'measureDistance', opsMaatRol: 'onzin' }, 'Line'), {});
});

test('een gewone maat krijgt geen extra sleutel', async () => {
  assert.deepEqual(await rondgang({ type: 'measureDistance' }, 'Line'), {});
  assert.deepEqual(await rondgang({ type: 'measureDistance', dimShowUnit: true }, 'Line'), {});
});

test('een ruimtevlak houdt zijn verborgen label, zijn zaadpunt en zijn naam', async () => {
  const terug = await rondgang({
    type: 'measureArea', measureShowLabel: false,
    opsRuimteZaad: { x: 250, y: 125.5 }, opsRuimteNaam: 'Woonkamer / keuken', opsRuimteNummer: '0.01',
  }, 'Polygon');
  assert.deepEqual(terug, {
    measureShowLabel: false,
    opsRuimteZaad: { x: 250, y: 125.5 },
    opsRuimteNaam: 'Woonkamer / keuken',
    opsRuimteNummer: '0.01',
  });
});

test('een gewoon meetvlak krijgt geen extra sleutels', async () => {
  assert.deepEqual(await rondgang({ type: 'measureArea' }, 'Polygon'), {});
});

test('de appearance toont wat het scherm toont', () => {
  const tekstIn = (ap) => (ap.content.match(/\(([^)]*)\) Tj/) || [])[1];
  // Zonder label: geen tekst in het vlak.
  const vlak = { points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }], X, Y, strokeColorHex: '#808080' };
  assert.equal(tekstIn(buildMeasureAreaAP({ ...vlak, text: '' })), undefined);
  assert.equal(tekstIn(buildMeasureAreaAP({ ...vlak, text: '12.00 m²'.replace('²', '2') })), '12.00 m2');

  // De maattekst staat BOVEN de lijn (niet erop, met een wit vak erachter),
  // gedraaid met de lijn mee.
  const maat = buildMeasureDistanceAP({
    startX: 0, startY: 100, endX: 200, endY: 100, X, Y,
    strokeColorHex: '#000000', lineWidth: 0.35, text: '1550',
    fontSize: 7, marge: 5.5,
  });
  assert.equal(tekstIn(maat), '1550');
  assert.ok(!/re f/.test(maat.content), 'geen wit vlak over de lijn');
  const tm = maat.content.match(/([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) Tm/);
  assert.ok(tm, 'de tekst heeft een eigen matrix');
  const basislijnY = Number(tm[6]);
  // PDF-y van de lijn is 800 - 100 = 700; de tekst ligt erboven (grotere y),
  // minstens de marge.
  assert.ok(basislijnY >= 700 + 5.5, `basislijn ${basislijnY} boven de lijn`);

  // Een staande maat: tekst langs de lijn gedraaid (leesbaar van rechts).
  const staand = buildMeasureDistanceAP({
    startX: 100, startY: 0, endX: 100, endY: 200, X, Y,
    strokeColorHex: '#000000', text: '2000', fontSize: 7, marge: 5.5,
  });
  const tm2 = staand.content.match(/([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) Tm/);
  assert.equal(Number(tm2[1]), 0, 'cos 90° = 0');
  assert.equal(Math.abs(Number(tm2[2])), 1, 'sin 90° = ±1');
  assert.ok(Number(tm2[5]) < X(100), 'de tekst staat links van de staande lijn, net als op het scherm');
});
