// Acres en hectares in de staten (GitHub #1129): exacte omrekening, één
// eenheid per kolom, en de oppervlaktekolommen van een staat in een gevraagde
// eenheid (app_get_takeoff met areaUnit).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normaliseerEenheid, eenheidSoort, isMetrisch, isAlleenOppervlakte, omrekenFactor, omrekenbaar,
  rekenOm, documentEenheidVoor, kiesKolomEenheid,
} from './eenheid-omrekening.js';
import { buildSchedule } from './engine.js';
import { configMetOppervlakteEenheid } from './staat-oppervlakte-eenheid.js';

const bijna = (a, b, eps = 1e-12) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

test('acre and hectare are area-only units', () => {
  assert.equal(eenheidSoort('ac'), 'area');
  assert.equal(eenheidSoort('ha'), 'area');
  assert.equal(normaliseerEenheid('Acres'), 'ac');
  assert.equal(normaliseerEenheid('hectare'), 'ha');
  assert.equal(isAlleenOppervlakte('ac'), true);
  assert.equal(isAlleenOppervlakte('ha'), true);
  assert.equal(isAlleenOppervlakte('ft²'), false);
  assert.equal(isAlleenOppervlakte('px'), false);
  assert.equal(isMetrisch('ha'), true);
  assert.equal(isMetrisch('ac'), false);
  // There is no squared or cubed acre, and no length to go with it.
  assert.equal(eenheidSoort('ac²'), null);
  assert.equal(eenheidSoort('ha³'), null);
  assert.equal(documentEenheidVoor('ac', 'area'), null, 'a scale is never in acres');
});

test('exact factors: 1 ac = 43,560 ft² = 4046.8564224 m², 1 ha = 10,000 m²', () => {
  assert.equal(omrekenFactor('ac', 'ft²'), 43_560);
  assert.equal(omrekenFactor('ac', 'm²'), 4046.8564224);
  assert.equal(omrekenFactor('ha', 'm²'), 10_000);
  assert.equal(omrekenFactor('ha', 'mm²'), 1e10);
  assert.equal(omrekenFactor('ac', 'yd²'), 4840);
  assert.equal(omrekenFactor('ac', 'in²'), 6_272_640);
  assert.equal(omrekenFactor('ha', 'ac'), 1e12 / (43_560 * 3048 ** 2));
  assert.ok(bijna(omrekenFactor('ha', 'ac'), 2.4710538146716534));
  // Not a length, not a volume.
  assert.equal(omrekenFactor('ac', 'ft'), null);
  assert.equal(omrekenFactor('m³', 'ha'), null);
  assert.equal(omrekenFactor('px', 'ac'), null);
  assert.equal(omrekenbaar('ft²', 'ac'), true);
  assert.equal(omrekenbaar('ft', 'ac'), false);
});

test('converting without rounding in between', () => {
  assert.equal(rekenOm(43_560, 'ft²', 'ac'), 1);
  assert.equal(rekenOm(87_120, 'sq ft', 'acres'), 2);
  assert.equal(rekenOm(2.5, 'ac', 'ft²'), 108_900);
  assert.equal(rekenOm(25_000, 'm²', 'ha'), 2.5);
  assert.equal(rekenOm(3, 'ha', 'm²'), 30_000);
  assert.equal(rekenOm(2e10, 'mm²', 'ha'), 2);
  assert.equal(rekenOm(1, 'ac', 'm²'), 4046.8564224);
  assert.equal(rekenOm(4046.8564224, 'm²', 'ac'), 1);
  assert.equal(rekenOm(7, 'ac', 'ac'), 7);
  assert.equal(rekenOm(1, 'ac', 'ft'), null);
  // The existing length and area conversions are unchanged.
  assert.equal(rekenOm(4360, 'mm', 'm'), 4.36);
  assert.equal(omrekenFactor('ft', 'in'), 12);
  assert.equal(omrekenFactor('ft²', 'in²'), 144);
  assert.equal(rekenOm(20_000_000, 'mm²', 'm²'), 20);
});

test('a column unit of acres chosen by the user is a known unit', () => {
  assert.equal(kiesKolomEenheid({ gekozen: 'ac', rijEenheden: ['ft²', 'ft²'], vast: 'm²' }), 'ac');
  assert.equal(kiesKolomEenheid({ gekozen: 'hectares', rijEenheden: ['m²'], vast: 'm²' }), 'ha');
  assert.equal(kiesKolomEenheid({ rijEenheden: ['ac', 'ac', 'ft²'], vast: 'm²' }), 'ac');
});

const vlak = (ft2, extra = {}) => ({ type: 'measureArea', page: 1, measureValue: ft2, measureUnit: 'ft²', ...extra });
const kolom = (res, key) => res.columns.find((c) => c.key === key);

test('an area schedule on a sheet in feet totals in acres', () => {
  const elementen = [vlak(43_560), vlak(87_120), vlak(21_780)];
  const res = buildSchedule(elementen, {
    categories: ['area'], fields: ['area'], format: { area: { unit: 'ac' } },
  });
  assert.equal(kolom(res, 'area').unit, 'ac');
  assert.deepEqual(res.groups[0].rows.map((r) => r.vals.area), [1, 2, 0.5]);
  assert.equal(res.grandTotals.area, 3.5);
  assert.equal(res.groups[0].subtotals.area, 3.5);
});

test('an area schedule on a sheet in millimetres totals in hectares', () => {
  const res = buildSchedule(
    [{ type: 'measureArea', page: 1, measureValue: 1.5e10, measureUnit: 'mm²' },
      { type: 'measureArea', page: 1, measureValue: 5e9, measureUnit: 'mm²' }],
    { categories: ['area'], fields: ['area'], format: { area: { unit: 'ha' } } },
  );
  assert.equal(kolom(res, 'area').unit, 'ha');
  assert.equal(res.grandTotals.area, 2);
});

test('areas shown in acres put the column in acres without a choice', () => {
  const res = buildSchedule(
    [vlak(43_560, { measureAreaUnit: 'ac' }), vlak(87_120, { measureAreaUnit: 'ac' })],
    { categories: ['area'], fields: ['area', 'realArea'] },
  );
  assert.equal(kolom(res, 'area').unit, 'ac');
  assert.equal(kolom(res, 'realArea').unit, 'ac');
  assert.equal(res.grandTotals.area, 3);
  // Without the field the schedule is exactly as before.
  const oud = buildSchedule([vlak(45)], { categories: ['area'], fields: ['area'] });
  assert.equal(kolom(oud, 'area').unit, 'ft²');
  assert.equal(oud.grandTotals.area, 45);
});

test('configMetOppervlakteEenheid: every area column in the asked unit, the schedule itself untouched', () => {
  const config = {
    categories: ['area'], fields: ['area', 'length', 'realArea'],
    format: { area: { heading: 'Lot area', decimals: 3 }, length: { unit: 'm' } },
  };
  const kopie = JSON.parse(JSON.stringify(config));
  const uit = configMetOppervlakteEenheid(config, 'acres');
  assert.deepEqual(config, kopie, 'the config of the schedule is not changed');
  assert.deepEqual(uit.format.area, { heading: 'Lot area', decimals: 3, unit: 'ac' });
  assert.deepEqual(uit.format.realArea, { unit: 'ac' });
  assert.deepEqual(uit.format.length, { unit: 'm' }, 'length columns keep their unit');

  const res = buildSchedule([vlak(43_560), vlak(43_560)], uit);
  assert.equal(kolom(res, 'area').unit, 'ac');
  assert.equal(kolom(res, 'area').label, 'Lot area');
  assert.equal(res.grandTotals.area, 2);
  assert.equal(res.grandTotals.realArea, 2);

  // No unit, or not an area unit: the config as it is.
  assert.equal(configMetOppervlakteEenheid(config, null), config);
  assert.equal(configMetOppervlakteEenheid(config, 'ft'), config);
  assert.equal(configMetOppervlakteEenheid(config, 'px'), config);
  assert.equal(configMetOppervlakteEenheid(null, 'ac'), null);
});
