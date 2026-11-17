// Een meetvlak in acres of hectares (GitHub #1129).
//
// Een blad van een terreintekening staat in voet of in meter; kavels worden in
// acres of hectares opgegeven. Het meetvlak rekende alleen in het kwadraat van
// de schaal-eenheid (ft², m²). Nu heeft een meetvlak een eigen weergave-
// eenheid (`measureAreaUnit`); de waarde en de lengte-eenheid van het vlak
// blijven zoals ze waren, zodat zijdematen, omtrek, eigen schaal en bestaande
// documenten niet veranderen.
//
// De echte state-store, het eigenschappenpaneel, de meetmodule en het
// gereedschap draaien hier onder node met de laadhaken van de app
// (zie ../core/app-test-hooks.mjs).

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('../core/state.ts');
const meas = await import('./measurement.js');
const { storeShowProperties, annotProps, updateAnnotProp } = await import('../solid/stores/propertiesStore.js');
const { createMeasureAreaAnnotation } = await import('../tools/annotation-creators.js');
const { writeStylePrefs } = await import('../core/style-prefs.js');
const { applyItemToAnnotation, isSavedProperty, prefKeyToAnnKeys } = await import('./tool-sets.js');
const { buildSchedule } = await import('../quantities/engine.js');

// Een terreintekening 1" = 100': 72 punt per 100 voet.
const VOET = { pixelsPerUnit: 72 / 100, unit: 'ft' };
// Een situatietekening 1:500 in meters.
const METER = { pixelsPerUnit: 72 / 25.4 / 500 * 1000, unit: 'm' };
const bijna = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

function openen(annotations = [], measureScale = VOET) {
  state.documents = [{
    id: `doc-${Math.random().toString(36).slice(2, 8)}`, filePath: null, pdfDoc: { numPages: 1 },
    currentPage: 1, scale: 1, viewMode: 'single', annotations,
    selectedAnnotation: null, selectedAnnotations: [],
    undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
    textEdits: [], watermarks: [], bookmarks: [], pageRotations: {}, measureScale,
  }];
  state.activeDocumentIndex = 0;
  return state.documents[0];
}

// 300 × 200 punt: op 1" = 100' is dat 416,67 × 277,78 ft = 115.740,74 ft².
const punten = () => [{ x: 100, y: 100 }, { x: 400, y: 100 }, { x: 400, y: 300 }, { x: 100, y: 300 }];
const FT2 = (300 / 0.72) * (200 / 0.72);
const ACRES = FT2 / 43_560;

function meetvlak(extra = {}, schaal = VOET) {
  openen([], schaal);
  const ann = {
    id: `ma-${Math.random().toString(36).slice(2, 8)}`, type: 'measureArea', page: 1, points: punten(),
    strokeColor: '#ff0000', color: '#ff0000', lineWidth: 1, opacity: 1, measurePrecision: 2,
    createdAt: '2026-10-01T10:00:00.000Z', modifiedAt: '2026-10-01T10:00:00.000Z',
    ...extra,
  };
  meas.herberekenVlakMaat(ann);
  return ann;
}

function selecteer(ann, schaal = VOET) {
  const doc = openen([ann], schaal);
  doc.selectedAnnotation = ann;
  doc.selectedAnnotations = [ann];
  storeShowProperties(ann);
  return doc;
}

function metVoorkeur(sleutel, waarde, fn) {
  const oud = state.preferences[sleutel];
  state.preferences[sleutel] = waarde;
  try { return fn(); } finally { state.preferences[sleutel] = oud; }
}

test('a sheet in feet: the area in acres, computed by the app (1 ac = 43,560 ft²)', () => {
  const ann = meetvlak({ measureAreaUnit: 'ac' });
  assert.ok(bijna(ACRES, 2.6570418), 'the fixture is 2.657 acres');
  assert.equal(ann.measureText, '2.657 ac');
  // The value and unit of the area stay in the square of the scale unit.
  assert.ok(bijna(ann.measureValue, FT2));
  assert.equal(ann.measureUnit, 'ft²');
});

test('a sheet in metres: the area in hectares (1 ha = 10,000 m²)', () => {
  const ann = meetvlak({ measureAreaUnit: 'ha' }, METER);
  // 300 × 200 pt on 1:500 = 52.917 × 35.278 m = 1866.8 m² = 0.187 ha.
  const m2 = (300 / METER.pixelsPerUnit) * (200 / METER.pixelsPerUnit);
  assert.ok(bijna(ann.measureValue, m2));
  assert.equal(ann.measureUnit, 'm²');
  assert.equal(ann.measureText, `${(m2 / 10_000).toFixed(3)} ha`);
  assert.equal(ann.measureText, '0.187 ha');
});

test('a sheet in millimetres also reports hectares and acres', () => {
  const mm = { pixelsPerUnit: 72 / 25.4 / 500, unit: 'mm' };
  const ha = meetvlak({ measureAreaUnit: 'ha' }, mm);
  assert.equal(ha.measureUnit, 'mm²');
  assert.equal(ha.measureText, '0.187 ha');
  const ac = meetvlak({ measureAreaUnit: 'ac' }, mm);
  assert.equal(ac.measureText, '0.461 ac');
});

test('an existing area without the field is shown exactly as before', () => {
  const ann = meetvlak();
  assert.equal(ann.measureAreaUnit, undefined);
  assert.equal(ann.measureText, meas.formatMeasurement({ value: FT2, unit: 'ft²' }));
  assert.equal(ann.measureText, '115740.74 ft²');
});

test('acres are not rounded on the step of the length rounding', () => {
  metVoorkeur('measureRounding', '10', () => {
    assert.equal(meas.formatMeasurement({ value: 2.3, unit: 'ac' }), '2.300 ac');
    assert.equal(meas.formatMeasurement({ value: 12.468, unit: 'ha' }), '12.47 ha');
  });
});

test('without a real-world scale the area stays in its own unit', () => {
  const ann = meetvlak({ measureAreaUnit: 'ac' }, null);
  assert.equal(ann.measureUnit, 'mm²', 'no scale: one point is one millimetre, as before');
  const px = meas.vlakTekst({ measureAreaUnit: 'ac' }, { value: 500, unit: 'px²' });
  assert.equal(px, meas.formatMeasurement({ value: 500, unit: 'px²' }));
});

test('the properties panel: choosing acres changes the label only, and back again', () => {
  const ann = meetvlak();
  selecteer(ann);
  assert.equal(annotProps.measureAreaUnit, '');
  updateAnnotProp('measureAreaUnit', 'ac');
  assert.equal(ann.measureAreaUnit, 'ac');
  assert.equal(annotProps.measureAreaUnit, 'ac');
  assert.equal(ann.measureText, '2.657 ac');
  assert.equal(ann.measureUnit, 'ft²');
  assert.ok(bijna(ann.measureValue, FT2));
  assert.equal(annotProps.measureUnit, 'ft', 'the length unit of the area is unchanged');
  // The edge lengths keep the unit of the scale.
  const zijden = meas.vlakZijdeTeksten(ann).map((z) => z.tekst);
  assert.equal(zijden.length, 4);
  assert.ok(zijden.every((t) => !/ac/.test(t)), `edge lengths stay lengths: ${zijden.join(' | ')}`);

  updateAnnotProp('measureAreaUnit', '');
  assert.equal('measureAreaUnit' in ann, false);
  assert.equal(annotProps.measureAreaUnit, '');
  assert.equal(ann.measureText, '115740.74 ft²');
});

test('a new scale keeps the acres and recomputes them', () => {
  const ann = meetvlak({ measureAreaUnit: 'ac' });
  const doc = openen([ann], VOET);
  doc.measureScale = { pixelsPerUnit: 72 / 50, unit: 'ft' };   // 1" = 50'
  meas.recalculateAllMeasurements();
  assert.equal(ann.measureAreaUnit, 'ac');
  assert.equal(ann.measureUnit, 'ft²');
  assert.ok(bijna(ann.measureValue, FT2 / 4));
  assert.equal(ann.measureText, `${(ACRES / 4).toFixed(3)} ac`);
});

test('an own scale and another length unit keep the acres', () => {
  const ann = meetvlak({ measureAreaUnit: 'ac' });
  selecteer(ann);
  updateAnnotProp('measureUnit', 'm');
  assert.equal(ann.measureUnit, 'm²');
  assert.ok(bijna(ann.measureValue, FT2 * 0.09290304, 1e-9));
  assert.equal(ann.measureText, '2.657 ac', 'the same area, whatever the length unit');
});

test('the tool: new areas take the display unit of the tool defaults', () => {
  openen([]);
  metVoorkeur('measureAreaDisplayUnit', 'ac', () => {
    const ann = createMeasureAreaAnnotation(punten());
    assert.equal(ann.measureAreaUnit, 'ac');
    assert.equal(ann.measureText, '2.657 ac');
    assert.equal(ann.measureUnit, 'ft²');
  });
  metVoorkeur('measureAreaDisplayUnit', '', () => {
    const ann = createMeasureAreaAnnotation(punten());
    assert.equal('measureAreaUnit' in ann, false);
    assert.equal(ann.measureText, '115740.74 ft²');
  });
});

test('the display unit is a tool default and a tool set property', () => {
  const prefs = { ...state.preferences };
  writeStylePrefs({ type: 'measureArea', strokeColor: '#ff0000', measureAreaUnit: 'ha' }, prefs);
  assert.equal(prefs.measureAreaDisplayUnit, 'ha');
  writeStylePrefs({ type: 'measureArea', strokeColor: '#ff0000' }, prefs);
  assert.equal(prefs.measureAreaDisplayUnit, '', 'no unit: follows the scale');
  assert.equal(isSavedProperty('measureAreaUnit', 'ac'), true);
  assert.deepEqual(prefKeyToAnnKeys('measureArea').get('measureAreaDisplayUnit'), ['measureAreaUnit']);
  // An item in acres and metres: the unit of the item, the label in acres.
  const ann = meetvlak();
  applyItemToAnnotation(ann, { type: 'measureArea', props: { measureUnit: 'm²', measureAreaUnit: 'ac' } },
    { formatMeasurement: meas.formatMeasurement });
  assert.equal(ann.measureAreaUnit, 'ac');
  assert.equal(ann.measureUnit, 'm²');
  assert.equal(ann.measureText, '2.657 ac');
});

test('an area schedule totals in acres', () => {
  const a = meetvlak({ measureAreaUnit: 'ac' });
  const b = meetvlak({ measureAreaUnit: 'ac' });
  const c = meetvlak();                                  // still in ft²
  // Most rows are in acres: the column takes acres and converts the third.
  const res = buildSchedule([a, b, c], { categories: ['area'], fields: ['area', 'length'] });
  const kolom = res.columns.find((k) => k.key === 'area');
  assert.equal(kolom.unit, 'ac');
  assert.ok(bijna(res.grandTotals.area, 3 * ACRES));
  for (const rij of res.groups[0].rows) assert.ok(bijna(rij.vals.area, ACRES));
  // The perimeter column keeps the length unit of the scale.
  assert.equal(res.columns.find((k) => k.key === 'length').unit, 'ft');
  assert.ok(bijna(res.grandTotals.length, 3 * 2 * (300 + 200) / 0.72));
  // A column unit chosen by the user converts every row, also plain ft² areas.
  const gekozen = buildSchedule([c, meetvlak()], {
    categories: ['area'], fields: ['area'], format: { area: { unit: 'ac' } },
  });
  assert.equal(gekozen.columns[0].unit, 'ac');
  assert.ok(bijna(gekozen.grandTotals.area, 2 * ACRES));
});
