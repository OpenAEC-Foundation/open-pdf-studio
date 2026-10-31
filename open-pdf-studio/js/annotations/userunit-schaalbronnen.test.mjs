// /UserUnit in de schaalbronnen die het eigenschappenpaneel en de CAD-export
// zelf omrekenen (#884). Een blad op 1:50 met /UserUnit 2 heeft pagina-
// eenheden van 2/72 inch: een schaal 1:N levert daar de helft van de
// pagina-eenheden per millimeter op. Het paneel (één viewport geselecteerd,
// de werkelijke maat van een schaalgebied) en de CAD-export (schaalgebieden)
// moeten dezelfde omrekening gebruiken als het meten zelf, anders meet een
// viewport na het wijzigen van zijn schaal in het paneel dubbel zo lang en
// toont het paneel een schaalgebied half zo groot als het is.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('../core/state.ts');
const { DEFAULT_PREFERENCES } = await import('../core/constants.ts');
const { storeShowProperties, annotProps, updateAnnotProp } = await import('../solid/stores/propertiesStore.js');
const { pixelsPerUnitFor, getScaleFromRegion, invalidateScaleRegionCache } = await import('./scale-region.js');
const { gebiedenOpPagina } = await import('../pdf/cad-export.js');

const bijna = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));
const PPU_1_50_UU2 = pixelsPerUnitFor('1:50', 'mm', 2);

function openen(annotations, pageUserUnits) {
  state.documents = [{
    id: `doc-${Math.random().toString(36).slice(2, 8)}`, filePath: null, pdfDoc: { numPages: 1 },
    currentPage: 1, scale: 1, viewMode: 'single', annotations,
    selectedAnnotation: null, selectedAnnotations: [],
    undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
    textEdits: [], watermarks: [], bookmarks: [], pageRotations: {}, measureScale: null,
    pageUserUnits,
  }];
  state.activeDocumentIndex = 0;
  invalidateScaleRegionCache();
  return state.documents[0];
}

function selecteer(ann, pageUserUnits) {
  const doc = openen([ann], pageUserUnits);
  doc.selectedAnnotation = ann;
  doc.selectedAnnotations = [ann];
  storeShowProperties(ann);
  return doc;
}

const viewport = (extra = {}) => ({
  id: `vp-${Math.random().toString(36).slice(2, 8)}`, type: 'viewport', page: 1,
  x: 10, y: 10, width: 200, height: 100, name: 'Plan', scaleRatio: '1:100',
  pixelsPerUnit: pixelsPerUnitFor('1:100', 'mm', 2), unit: 'mm',
  createdAt: '2026-10-01T10:00:00.000Z', modifiedAt: '2026-10-01T10:00:00.000Z',
  ...extra,
});

const schaalgebied = (extra = {}) => ({
  id: `sr-${Math.random().toString(36).slice(2, 8)}`, type: 'scaleRegion', page: 1,
  x: 0, y: 0, width: 1200 * PPU_1_50_UU2, height: 600 * PPU_1_50_UU2,
  scaleString: '1:50', units: 'mm', label: '',
  createdAt: '2026-10-01T10:00:00.000Z', modifiedAt: '2026-10-01T10:00:00.000Z',
  ...extra,
});

test.beforeEach(() => {
  state.preferences = { ...DEFAULT_PREFERENCES };
});

test('/UserUnit 2: de schaal van één geselecteerde viewport in het paneel rekent in pagina-eenheden', () => {
  const ann = viewport();
  selecteer(ann, { 1: 2 });
  updateAnnotProp('viewportScaleRatio', '50');
  assert.equal(ann.scaleRatio, '1:50');
  assert.ok(bijna(ann.pixelsPerUnit, PPU_1_50_UU2), `${ann.pixelsPerUnit} ≠ ${PPU_1_50_UU2}`);
});

test('zonder /UserUnit blijft de viewport-schaal in het paneel 72 / 25,4 / N', () => {
  const ann = viewport({ pixelsPerUnit: pixelsPerUnitFor('1:100', 'mm') });
  selecteer(ann, undefined);
  updateAnnotProp('viewportScaleRatio', '50');
  assert.ok(bijna(ann.pixelsPerUnit, 72 / (25.4 * 50)));
});

test('/UserUnit 2: het paneel toont de werkelijke maat van een schaalgebied zoals erin gemeten wordt', () => {
  const ann = schaalgebied();
  selecteer(ann, { 1: 2 });
  assert.equal(annotProps.scaleRegionWidth, 1200);
  assert.equal(annotProps.scaleRegionHeight, 600);
  // Dezelfde omrekening als meten in het gebied.
  assert.ok(bijna(getScaleFromRegion(1, 5, 5).pixelsPerUnit, PPU_1_50_UU2));
});

test('/UserUnit 2: een werkelijke breedte invullen geeft het gebied de juiste paginamaat', () => {
  const ann = schaalgebied();
  selecteer(ann, { 1: 2 });
  updateAnnotProp('scaleRegionWidth', '3000');
  assert.ok(bijna(ann.width, 3000 * PPU_1_50_UU2), `${ann.width}`);
});

test('/UserUnit 2: de CAD-export geeft schaalgebied, viewport-annotatie en /VP dezelfde schaalnoemer', () => {
  const doc = openen([
    schaalgebied(),
    viewport({ scaleRatio: '1:50', pixelsPerUnit: PPU_1_50_UU2 }),
  ], { 1: 2 });
  // /VP met /C per gebruikerseenheid: 1 eenheid = 2 pt = 2 · 25,4/72 mm · 50.
  doc.pdfViewports = { 1: [{ x: 0, y: 0, width: 100, height: 100, pixelsPerUnit: PPU_1_50_UU2, unit: 'mm', ratio: '1:50', name: 'VP' }] };
  const noemers = gebiedenOpPagina(doc, 1).map((g) => g.schaal);
  assert.equal(noemers.length, 3);
  for (const n of noemers) assert.ok(bijna(n, noemers[0]), `${noemers}`);
});

test('zonder /UserUnit geeft de CAD-export een 1:50-schaalgebied de noemer 50', () => {
  const doc = openen([schaalgebied({ width: 100, height: 100 })], undefined);
  const [g] = gebiedenOpPagina(doc, 1);
  assert.ok(bijna(g.schaal, 50));
});
