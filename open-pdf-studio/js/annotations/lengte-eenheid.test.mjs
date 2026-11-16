// De eenheid van een lengte- of maatlijn wijzigen (GitHub #1091).
//
// Een maatlijn zonder eigen schaal rekent met de documentschaal. Koos je in
// het eigenschappenpaneel een andere eenheid (ft -> in), dan rekende
// recomputeMeasureText opnieuw met de documentschaal en zette de eenheid
// meteen terug op die van het document: er veranderde niets op de pagina en
// na opnieuw selecteren stond er weer ft. Zoals bij een meetvlak (#536) legt
// een gekozen eenheid nu de schaal in die eenheid vast; de echte lengte blijft.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('../core/state.ts');
const meas = await import('./measurement.js');
const { storeShowProperties, annotProps, updateAnnotProp } = await import('../solid/stores/propertiesStore.js');

// 1/8" = 1'-0" (1:96) in voet: 9 punt papier per voet.
const VOET = { pixelsPerUnit: 9, unit: 'ft' };
const bijna = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

function openen(annotations, measureScale = VOET) {
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

/** Een maatlijn van 90 punt (10 voet) zoals het gereedschap hem aanmaakt. */
function maatlijn() {
  openen([]);
  const dist = meas.calculateDistance(100, 300, 190, 300, 1, null);
  const ann = {
    id: `md-${Math.random().toString(36).slice(2, 8)}`, type: 'measureDistance', page: 1,
    startX: 100, startY: 300, endX: 190, endY: 300, strokeColor: '#000000', color: '#000000', lineWidth: 1, opacity: 1,
    measureText: meas.formatDimensionText(dist), measureValue: dist.value, measureUnit: dist.unit, measurePixels: dist.pixels,
    measurePrecision: 2, createdAt: '2026-11-14T10:00:00.000Z', modifiedAt: '2026-11-14T10:00:00.000Z',
  };
  state.documents[0].annotations.push(ann);
  return ann;
}

function selecteer(ann) {
  const doc = state.documents[0];
  doc.selectedAnnotation = ann;
  doc.selectedAnnotations = [ann];
  storeShowProperties(ann);
}

test('voet naar inch: de waarde wordt in inch getoond en de eenheid blijft inch', () => {
  const ann = maatlijn();
  assert.equal(ann.measureUnit, 'ft');
  assert.ok(bijna(ann.measureValue, 10));
  selecteer(ann);
  updateAnnotProp('measureUnit', 'in');
  assert.equal(ann.measureUnit, 'in');
  assert.ok(bijna(ann.measureValue, 120), `120 inch, kreeg ${ann.measureValue}`);
  assert.match(ann.measureText, /120/);
  assert.equal(annotProps.measureUnit, 'in');
});

test('na opnieuw selecteren staat de gekozen eenheid er nog', () => {
  const ann = maatlijn();
  selecteer(ann);
  updateAnnotProp('measureUnit', 'in');
  // Iets anders selecteren en dan de maatlijn weer: het paneel leest opnieuw uit de annotatie.
  const ander = { id: 'ander', type: 'box', page: 1, x: 10, y: 10, width: 20, height: 20 };
  state.documents[0].annotations.push(ander);
  selecteer(ander);
  assert.notEqual(annotProps.measureUnit, 'in');
  selecteer(ann);
  assert.equal(annotProps.measureUnit, 'in');
  assert.equal(ann.measureUnit, 'in');
});

test('metrisch: millimeter naar meter houdt dezelfde lengte', () => {
  openen([], { pixelsPerUnit: 72 / (25.4 * 100), unit: 'mm' });
  const dist = meas.calculateDistance(0, 0, 100, 0, 1, null);
  const ann = { id: 'mdm', type: 'measureDistance', page: 1, startX: 0, startY: 0, endX: 100, endY: 0,
    measureValue: dist.value, measureUnit: dist.unit, measurePrecision: 2, measureText: meas.formatDimensionText(dist) };
  state.documents[0].annotations.push(ann);
  selecteer(ann);
  updateAnnotProp('measureUnit', 'm');
  assert.equal(ann.measureUnit, 'm');
  assert.ok(bijna(ann.measureValue, dist.value / 1000));
});

// Samen met de opmaak per maat (#1099): een maat die de documentschaal volgde
// toonde zijn waarde met de standaardopmaak, niet met de precisie van het
// gereedschap (0 decimalen voor millimeters). Na een eenheidswissel krijgt de
// maat een eigen schaal; de precisie van het gereedschap mag dan niet ineens
// gaan gelden ("7338" werd "7 m").
test('millimeter naar meter houdt bruikbare decimalen, ook met gereedschapsprecisie 0', () => {
  openen([], { pixelsPerUnit: 72 / (25.4 * 100), unit: 'mm' });
  const dist = meas.calculateDistance(0, 0, 208, 0, 1, null);
  const ann = { id: 'mp0', type: 'measureDistance', page: 1, startX: 0, startY: 0, endX: 208, endY: 0,
    measureValue: dist.value, measureUnit: dist.unit, measurePrecision: 0, measureText: meas.formatDimensionText(dist) };
  state.documents[0].annotations.push(ann);
  selecteer(ann);
  updateAnnotProp('measureUnit', 'm');
  assert.equal(ann.measureText, '7.34 m');
  updateAnnotProp('measureUnit', 'mm');
  assert.equal(ann.measureText, '7338');
});

test('voet naar inch en terug houdt de decimalen, ook met gereedschapsprecisie 0', () => {
  openen([]);
  const dist = meas.calculateDistance(0, 0, 19.64, 0, 1, null);
  const ann = { id: 'fp0', type: 'measureDistance', page: 1, startX: 0, startY: 0, endX: 19.64, endY: 0,
    measureValue: dist.value, measureUnit: dist.unit, measurePrecision: 0, measureText: meas.formatDimensionText(dist) };
  state.documents[0].annotations.push(ann);
  selecteer(ann);
  updateAnnotProp('measureUnit', 'in');
  assert.equal(ann.measureText, '26.19 in');
  updateAnnotProp('measureUnit', 'ft');
  assert.equal(ann.measureText, '2.18 ft');
});

test('een uitdrukkelijk gekozen precisie op een maat met eigen schaal blijft gelden', () => {
  openen([], { pixelsPerUnit: 72 / (25.4 * 100), unit: 'mm' });
  const ann = { id: 'ep', type: 'measureDistance', page: 1, startX: 0, startY: 0, endX: 208, endY: 0,
    measureScale: 35.2777777, measureUnit: 'mm', measurePrecision: 1, measureText: '' };
  state.documents[0].annotations.push(ann);
  selecteer(ann);
  updateAnnotProp('measureUnit', 'm');
  assert.equal(ann.measurePrecision, 1);
  assert.match(ann.measureText, /^7\.3 m$/);
});
