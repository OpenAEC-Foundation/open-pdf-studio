// 'Standaardstijl toepassen' en 'Als standaardstijl instellen' bij een
// meetvlak (GitHub #536).
//
// Sinds #536 rekent een meetvlak met zijn EIGEN schaal (measureScale +
// measureUnit) als die er is. De standaardstijl van een meetvlak nam de
// maatlijn-instellingen mee (measureAreaDimScale/DimUnit, standaard 1 en
// 'mm'), terwijl een nieuw vlak die nooit gebruikt: het rekent met de schaal
// van het document. 'Standaardstijl toepassen' gaf een bestaand vlak zo een
// eigen schaal van 1 mm per punt, en het eerstvolgende verslepen maakte van
// 6,22 m² 0,01 m². Andersom lekte de eigen schaal van één vlak via
// 'Als standaardstijl instellen' naar elk vlak waarop je de stijl toepast.
//
// Afronding en zijdematen horen wel bij de stijl van een meetvlak.
//
// De echte preferences.js draait hier (app-test-hooks.mjs maakt er anders een
// stub van), samen met de echte meetmodule en vervormingen.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('./app-test-hooks.mjs', import.meta.url);
// De echte preferences.js in plaats van de stub van app-test-hooks.
register(`data:text/javascript,${encodeURIComponent(`
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export async function load(url, context, nextLoad) {
  if (url.startsWith('file:') && url.endsWith('/js/core/preferences.js')) {
    return { format: 'module', shortCircuit: true, source: readFileSync(fileURLToPath(url), 'utf8') };
  }
  return nextLoad(url, context);
}`)}`);
const { installeerBrowserStubs } = await import('./app-test-hooks.mjs');
installeerBrowserStubs();
globalThis.window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

const { state } = await import('./state.ts');
const meas = await import('../annotations/measurement.js');
const { applyResize } = await import('../annotations/transforms.js');
const { cloneAnnotation } = await import('../annotations/factory.js');
const { applyDefaultStyle, setAsDefaultStyle } = await import('./preferences.js');

// 1:100 in millimeters: pixels (punten) per millimeter.
const PPU_100 = 72 / (25.4 * 100);

function openen(annotations = []) {
  state.documents = [{
    id: `doc-${Math.random().toString(36).slice(2, 8)}`, filePath: null, pdfDoc: { numPages: 1 },
    currentPage: 1, scale: 1, viewMode: 'single', annotations,
    selectedAnnotation: null, selectedAnnotations: [], undoStack: [], redoStack: [],
    savedUndoStackLength: 0, modified: false, textEdits: [], watermarks: [], bookmarks: [],
    pageRotations: {}, measureScale: { pixelsPerUnit: PPU_100, unit: 'mm' },
  }];
  state.activeDocumentIndex = 0;
}

/** Een meetvlak van 100 × 50 punt op 1:100, zoals het gereedschap het maakt. */
function meetvlak(extra = {}) {
  openen([]);
  const points = [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 150 }, { x: 100, y: 150 }];
  const area = meas.calculateArea(points, undefined, 1);
  const ann = {
    id: `ma-${Math.random().toString(36).slice(2, 8)}`, type: 'measureArea', page: 1, points,
    strokeColor: '#ff0000', color: '#ff0000', lineWidth: 1, opacity: 1,
    measureText: meas.formatMeasurement(area), measureValue: area.value, measureUnit: area.unit,
    measurePrecision: 2, ...extra,
  };
  openen([ann]);
  return ann;
}

function versleepNul(ann) {
  applyResize(ann, 'polyline_node_2', 0, 0, cloneAnnotation(ann));
  return ann.measureText;
}

test('standaardstijl toepassen geeft een bestaand meetvlak geen eigen schaal', () => {
  // De voorkeuren van een verse installatie: maatlijnschaal 1, eenheid mm.
  assert.equal(state.preferences.measureAreaDimScale, 1);
  assert.equal(state.preferences.measureAreaDimUnit, 'mm');
  const ann = meetvlak();
  assert.equal(ann.measureText, '6.22 m²');

  applyDefaultStyle(ann);
  assert.ok(!(Number(ann.measureScale) > 0), `geen eigen schaal (${ann.measureScale})`);
  assert.equal(versleepNul(ann), '6.22 m²', 'de oppervlakte blijft na verslepen');
});

test('afronding en zijdematen gaan wel mee met de standaardstijl', () => {
  state.preferences.measureAreaDimPrecision = 1;
  state.preferences.measureAreaShowEdgeLengths = true;
  const ann = meetvlak({ measurePrecision: 2 });
  applyDefaultStyle(ann);
  assert.equal(ann.measurePrecision, 1);
  assert.equal(ann.measureShowEdgeLengths, true);
  state.preferences.measureAreaDimPrecision = 2;
  state.preferences.measureAreaShowEdgeLengths = false;
});

test('de eigen schaal van een vlak lekt niet via de standaardstijl naar een ander vlak', () => {
  const eigen = meetvlak({ measureScale: 0.5, measureUnit: 'cm²', measurePrecision: 3 });
  const voorSchaal = state.preferences.measureAreaDimScale;
  const voorEenheid = state.preferences.measureAreaDimUnit;
  setAsDefaultStyle(eigen);
  assert.equal(state.preferences.measureAreaDimScale, voorSchaal, 'de schaal van het vlak is geen stijl');
  assert.equal(state.preferences.measureAreaDimUnit, voorEenheid, 'de eenheid van het vlak is geen stijl');
  assert.equal(state.preferences.measureAreaDimPrecision, 3, 'de afronding wel');

  const ander = meetvlak();
  applyDefaultStyle(ander);
  assert.ok(!(Number(ander.measureScale) > 0), `geen eigen schaal (${ander.measureScale})`);
  assert.equal(versleepNul(ander), '6.22 m²', 'de schaal van het document');
  state.preferences.measureAreaDimPrecision = 2;
});

test('de weergave-eenheid van de oppervlakte (acres, hectares) gaat mee met de standaardstijl (#1129)', () => {
  const inAcres = meetvlak({ measureAreaUnit: 'ac' });
  setAsDefaultStyle(inAcres);
  assert.equal(state.preferences.measureAreaDisplayUnit, 'ac');

  const ander = meetvlak();
  applyDefaultStyle(ander);
  assert.equal(ander.measureAreaUnit, 'ac');
  assert.equal(ander.measureUnit, 'mm²', 'de lengte-eenheid van het vlak blijft');
  assert.match(versleepNul(ander), / ac$/, 'het label staat in acres');

  // Zonder eigen eenheid volgt de standaard weer de schaal.
  setAsDefaultStyle(meetvlak());
  assert.equal(state.preferences.measureAreaDisplayUnit, '');
  applyDefaultStyle(ander);
  assert.equal(ander.measureAreaUnit, undefined);
  assert.equal(versleepNul(ander), '6.22 m²');
});

test('een vlak met een eigen schaal houdt die bij standaardstijl toepassen', () => {
  const ann = meetvlak({ measureScale: 0.5, measureUnit: 'cm²' });
  meas.herberekenVlakMaat(ann);
  const voor = ann.measureText;
  applyDefaultStyle(ann);
  assert.equal(ann.measureScale, 0.5);
  assert.equal(versleepNul(ann), voor);
});
