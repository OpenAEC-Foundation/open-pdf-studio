// Constructieraster: de rekenslag onder elke constructieplattegrond.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_VELDEN, MM_TO_PX, RasterFout, maakRaster, meetschaalVoor, mmNaarPunten,
  parseVelden, puntenNaarMm, pxPerMmOpSchaal, rasterLabels, schaalNoemer,
} from './raster.js';

const bijna = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

// assert.throws geeft de fout niet terug; voor het toetsen van de foutcode
// vangen we hem zelf.
function vangFout(fn) {
  try { fn(); } catch (e) { return e; }
  assert.fail('verwachtte een fout');
}

test('de schaalnoemer komt uit elke gangbare schrijfwijze', () => {
  assert.equal(schaalNoemer('1:100'), 100);
  assert.equal(schaalNoemer('1:50'), 50);
  assert.equal(schaalNoemer('1/20'), 20);
  assert.equal(schaalNoemer(' 1 : 200 '), 200);
  assert.equal(schaalNoemer(100), 100);
  // Een niet-eenheidsverhouding telt ook: 2:100 is 1:50.
  assert.equal(schaalNoemer('2:100'), 50);
});

test('een onbruikbare schaal wordt geweigerd, niet geraden', () => {
  assert.throws(() => schaalNoemer('groot'), RasterFout);
  assert.throws(() => schaalNoemer('1:0'), RasterFout);
  assert.throws(() => schaalNoemer(-5), RasterFout);
});

test('millimeters worden paginapunten via papier-mm', () => {
  // 1000 mm werkelijk op 1:100 = 10 papier-mm = 10 x 72/25,4 punten.
  bijna(mmNaarPunten(1000, '1:100'), 10 * MM_TO_PX);
  bijna(mmNaarPunten(1000, '1:50'), 20 * MM_TO_PX);
  bijna(pxPerMmOpSchaal('1:100'), MM_TO_PX / 100);
  // Heen en terug levert hetzelfde getal op.
  bijna(puntenNaarMm(mmNaarPunten(5400, '1:50'), '1:50'), 5400, 1e-9);
});

test('de meetschaal-ijking is dezelfde omrekening, in millimeters', () => {
  const ijk = meetschaalVoor('1:100');
  assert.equal(ijk.unit, 'mm');
  bijna(ijk.pixelsPerUnit, MM_TO_PX / 100);
});

test('veldmaten mogen als lijst, als reeks of als aantal maal maat', () => {
  assert.deepEqual(parseVelden([5400, 5400, 6000]), [5400, 5400, 6000]);
  assert.deepEqual(parseVelden('5400 5400 6000'), [5400, 5400, 6000]);
  assert.deepEqual(parseVelden('5400, 6000; 7200'), [5400, 6000, 7200]);
  assert.deepEqual(parseVelden('3x5400'), [5400, 5400, 5400]);
  assert.deepEqual(parseVelden('3@5400, 6000'), [5400, 5400, 5400, 6000]);
  // Maat eerst mag ook: de groottes wijzen uit wat het aantal is.
  assert.deepEqual(parseVelden('5400x3'), [5400, 5400, 5400]);
  assert.deepEqual(parseVelden(6000), [6000]);
});

test('een maat in meters wordt geweigerd in plaats van stil verkeerd getekend', () => {
  const fout = vangFout(() => parseVelden('5,4 6,0'));
  assert.ok(fout instanceof RasterFout);
  assert.equal(fout.code, 'veldmaat');
  assert.match(fout.message, /millimeters/);
});

test('een leeg of te groot raster wordt geweigerd', () => {
  assert.throws(() => parseVelden(''), RasterFout);
  assert.throws(() => parseVelden([]), RasterFout);
  assert.throws(() => parseVelden(`${MAX_VELDEN + 1}x1000`), RasterFout);
});

test('rasterlabels volgen de tekenkamer: letters en cijfers', () => {
  assert.deepEqual(rasterLabels(3, 'letters'), ['A', 'B', 'C']);
  assert.deepEqual(rasterLabels(4, 'cijfers'), ['1', '2', '3', '4']);
  // Voorbij Z telt hij door als een kolomletter.
  assert.equal(rasterLabels(27, 'letters')[26], 'AA');
  assert.equal(rasterLabels(28, 'letters')[27], 'AB');
});

test('het raster zet lijnen, knopen en velden op de juiste punten', () => {
  const r = maakRaster({
    oorsprong: { x: 100, y: 200 },
    veldenX: '2x5400', veldenY: [6000],
    schaal: '1:100', uitloopMm: 1000,
  });

  assert.equal(r.schaal.tekst, '1:100');
  assert.equal(r.lijnenX.length, 3);
  assert.equal(r.lijnenY.length, 2);
  assert.equal(r.knopen.length, 6);
  assert.equal(r.velden.length, 2);

  // De eerste lijn ligt op de oorsprong; de volgende 5400 mm verderop.
  bijna(r.lijnenX[0].x, 100);
  bijna(r.lijnenX[1].x, 100 + mmNaarPunten(5400, '1:100'));
  bijna(r.lijnenX[2].x, 100 + mmNaarPunten(10800, '1:100'));
  bijna(r.lijnenY[1].y, 200 + mmNaarPunten(6000, '1:100'));

  // De uitloop steekt aan beide kanten even ver uit.
  bijna(r.lijnenX[0].yBoven, 200 - mmNaarPunten(1000, '1:100'));
  bijna(r.lijnenX[0].yOnder, 200 + mmNaarPunten(6000 + 1000, '1:100'));

  bijna(r.maat.breedteMm, 10800);
  bijna(r.maat.hoogteMm, 6000);
});

test('de horizontale lijnen worden van onder af genummerd, zoals op de tekening', () => {
  const r = maakRaster({
    oorsprong: { x: 0, y: 0 }, veldenX: [5000], veldenY: '3x3000', schaal: '1:100',
  });
  // Vier horizontale lijnen; de ONDERSTE (grootste y) heet 1.
  const onderste = r.lijnenY[r.lijnenY.length - 1];
  const bovenste = r.lijnenY[0];
  assert.equal(onderste.label, '1');
  assert.equal(bovenste.label, '4');
  assert.ok(onderste.y > bovenste.y);
});

test('van boven af nummeren kan ook, als de tekening dat vraagt', () => {
  const r = maakRaster({
    oorsprong: { x: 0, y: 0 }, veldenX: [5000], veldenY: '3x3000',
    schaal: '1:100', labelsYVanOnder: false,
  });
  assert.equal(r.lijnenY[0].label, '1');
  assert.equal(r.lijnenY[3].label, '4');
});

test('een veld heet naar de lijn links en de lijn eronder', () => {
  const r = maakRaster({
    oorsprong: { x: 0, y: 0 }, veldenX: '2x5000', veldenY: '2x4000', schaal: '1:100',
  });
  // Lijnen: A B C in x; 3 2 1 van boven naar onder in y.
  assert.deepEqual(r.velden.map(v => v.label), ['A2', 'B2', 'A1', 'B1']);
  const eerste = r.velden[0];
  bijna(eerste.midden.x, mmNaarPunten(2500, '1:100'));
  bijna(eerste.midden.y, mmNaarPunten(2000, '1:100'));
});

test('zonder oorsprong wordt er niets uitgezet', () => {
  assert.throws(() => maakRaster({ veldenX: [5000], veldenY: [5000] }), RasterFout);
  const fout = vangFout(() => maakRaster({ oorsprong: { x: 0 }, veldenX: [5000], veldenY: [5000] }));
  assert.ok(fout instanceof RasterFout);
  assert.equal(fout.code, 'oorsprong');
});
