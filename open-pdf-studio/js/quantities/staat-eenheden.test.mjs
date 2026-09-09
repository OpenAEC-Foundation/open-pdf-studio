// Een staat (schedule) moet de hoeveelheid tonen in de eenheid die er
// werkelijk bij hoort, en de naam die de gebruiker aan een meet-vlak gaf.
//
// Meetwaarden staan in de tekeneenheid van het document. Bij de gebruikelijke
// mm-schaal is measureValue van een oppervlakte dus mm²; de staat toonde dat
// getal ongewijzigd met "m²" erboven, waardoor 20 m² als 20.000.000 in de
// lijst kwam. En de naam uit het eigenschappenpaneel (measureName) werd
// nergens uitgelezen.

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSchedule } from './engine.js';
import { normaliseerMeting, fieldsForCategories } from './categories.js';

const kolom = (res, key) => res.columns.find(c => c.key === key);
const eersteRij = (res) => res.groups[0].rows[0];

test('mm² wordt m², precies zoals op het blad', () => {
  assert.deepEqual(normaliseerMeting(20_000_000, 'mm²'), { value: 20, unit: 'm²' });
  assert.deepEqual(normaliseerMeting(3.5, 'm²'), { value: 3.5, unit: 'm²' });
  assert.deepEqual(normaliseerMeting(12, 'ft²'), { value: 12, unit: 'ft²' });
  // Onbekende eenheid: niets omrekenen, kolom houdt zijn vaste eenheid.
  assert.deepEqual(normaliseerMeting(7, null), { value: 7, unit: null });
  assert.equal(normaliseerMeting(undefined, 'mm²'), null);
});

test('oppervlakte in een mm-tekening komt als m² in de staat', () => {
  const res = buildSchedule(
    [{ type: 'measureArea', page: 1, measureValue: 20_000_000, measureUnit: 'mm²' }],
    { categories: ['area'], fields: ['area'] },
  );
  assert.equal(eersteRij(res).vals.area, 20, 'de waarde moet in m² staan');
  assert.equal(kolom(res, 'area').unit, 'm²');
  assert.equal(res.grandTotals.area, 20);
});

test('een tekening in voet houdt voet', () => {
  const res = buildSchedule(
    [{ type: 'measureArea', page: 1, measureValue: 45, measureUnit: 'ft²' }],
    { categories: ['area'], fields: ['area'] },
  );
  assert.equal(eersteRij(res).vals.area, 45);
  assert.equal(kolom(res, 'area').unit, 'ft²', 'de kolom volgt de tekeneenheid');
});

test('lengtekolom zet niet langer "m" boven millimeters', () => {
  const res = buildSchedule(
    [{ type: 'measureDistance', page: 1, measureValue: 4360, measureUnit: 'mm' }],
    { categories: ['line-based'], fields: ['length'] },
  );
  assert.equal(eersteRij(res).vals.length, 4360);
  assert.equal(kolom(res, 'length').unit, 'mm');
});

test('zonder eenheid blijft de vaste kolomeenheid staan', () => {
  const res = buildSchedule(
    [{ type: 'measureArea', page: 1, measureValue: 10 }],
    { categories: ['area'], fields: ['area', 'realArea'] },
  );
  assert.equal(kolom(res, 'area').unit, 'm²');
  assert.equal(eersteRij(res).vals.area, 10);
});

test('de naam van een meet-vlak komt in de Label-kolom', () => {
  const res = buildSchedule(
    [
      { type: 'measureArea', page: 1, measureValue: 1, measureUnit: 'm²', measureName: 'Woonkamer' },
      { type: 'measureArea', page: 1, measureValue: 2, measureUnit: 'm²', label: 'Berging' },
      { type: 'measureArea', page: 1, measureValue: 3, measureUnit: 'm²', subject: 'Zolder' },
    ],
    { categories: ['area'], fields: ['label'] },
  );
  assert.deepEqual(res.groups[0].rows.map(r => r.vals.label), ['Woonkamer', 'Berging', 'Zolder']);
});

test('een eigen label wint van measureName', () => {
  const res = buildSchedule(
    [{ type: 'measureArea', page: 1, measureValue: 1, measureName: 'auto', label: 'handmatig' }],
    { categories: ['area'], fields: ['label'] },
  );
  assert.equal(eersteRij(res).vals.label, 'handmatig');
});

test('getekende vlakken krijgen ook een oppervlakte', () => {
  // 2000 x 1500 px bij 100 px per mm → 20 mm x 15 mm = 300 mm²... in een echte
  // tekening is de schaal px-per-mm veel kleiner; hier gaat het om de som.
  const rechthoek = {
    type: 'box', page: 1, x: 0, y: 0, width: 2000, height: 1500,
    __pxPerUnit: 100, __unit: 'mm',
  };
  const veelhoek = {
    type: 'polygon', page: 1, __pxPerUnit: 100, __unit: 'mm',
    points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }],
  };
  const res = buildSchedule([rechthoek, veelhoek], { categories: ['area'], fields: ['area'] });
  const waarden = res.groups[0].rows.map(r => r.vals.area);
  // 2000*1500 px² / 100² = 300 mm² → 0,0003 m²; 1000² / 100² = 100 mm².
  assert.ok(Math.abs(waarden[0] - 300 / 1e6) < 1e-12, `rechthoek: ${waarden[0]}`);
  assert.ok(Math.abs(waarden[1] - 100 / 1e6) < 1e-12, `veelhoek: ${waarden[1]}`);
  assert.equal(kolom(res, 'area').unit, 'm²');
});

test('gaten worden van de oppervlakte afgetrokken', () => {
  const met = {
    type: 'polygon', page: 1,
    points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
    holes: [[{ x: 2, y: 2 }, { x: 4, y: 2 }, { x: 4, y: 4 }, { x: 2, y: 4 }]],
  };
  const res = buildSchedule([met], { categories: ['area'], fields: ['area'] });
  assert.equal(eersteRij(res).vals.area, 100 - 4);
});

test('een cirkel telt als ellips-oppervlak, een schaalgebied telt niet mee', () => {
  const res = buildSchedule(
    [
      { type: 'circle', page: 1, x: 0, y: 0, width: 20, height: 10 },
      { type: 'scaleRegion', page: 1, x: 0, y: 0, width: 100, height: 100 },
    ],
    { categories: ['area'], fields: ['area'] },
  );
  const waarden = res.groups[0].rows.map(r => r.vals.area);
  assert.ok(Math.abs(waarden[0] - Math.PI * 10 * 5) < 1e-9);
  assert.equal(waarden[1], null, 'een schaalgebied is een hulpobject, geen hoeveelheid');
});

test('de dakcorrectie werkt door op de omgerekende oppervlakte', () => {
  const res = buildSchedule(
    [{ type: 'measureArea', page: 1, measureValue: 10_000_000, measureUnit: 'mm²', dakhoek: 30 }],
    { categories: ['area'], fields: ['area', 'realArea'] },
  );
  assert.equal(eersteRij(res).vals.area, 10);
  assert.ok(Math.abs(eersteRij(res).vals.realArea - 10 / Math.cos(Math.PI / 6)) < 1e-9);
  assert.equal(kolom(res, 'realArea').unit, 'm²');
});

test('een eigen eenheid in de opmaak blijft leidend', () => {
  const res = buildSchedule(
    [{ type: 'measureArea', page: 1, measureValue: 20_000_000, measureUnit: 'mm²' }],
    { categories: ['area'], fields: ['area'], format: { area: { unit: 'vierkante meter' } } },
  );
  assert.equal(kolom(res, 'area').unit, 'vierkante meter');
});

test('het veldregister draagt de dynamische eenheid', () => {
  const velden = fieldsForCategories(['area', 'line-based']);
  for (const key of ['area', 'realArea', 'length']) {
    assert.equal(typeof velden.find(f => f.key === key).unitOf, 'function', `${key} mist unitOf`);
  }
});
