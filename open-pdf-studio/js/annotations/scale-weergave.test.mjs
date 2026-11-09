// Imperiale schalen tonen als 1/8" = 1'-0" in plaats van 1:96 (#1000). Eén
// formatter (scaleDisplayLabel) voor elke plek die een schaal toont; de
// opgeslagen scaleRatio blijft eenheidloos "1:N".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scaleDisplayLabel, IMPERIAL_SCALE_PRESETS } from './scale-presets.js';

const bron = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');

test('an imperial preset in feet shows its inch notation, then the ratio', () => {
  assert.equal(scaleDisplayLabel('1:96', 'ft'), `1/8" = 1'-0" (1:96)`);
  assert.equal(scaleDisplayLabel('1:96', 'ft', { withRatio: false }), `1/8" = 1'-0"`);
  assert.equal(scaleDisplayLabel('1:240', 'ft'), `1" = 20'-0" (1:240)`);
  assert.equal(scaleDisplayLabel(48, 'in'), `1/4" = 1'-0" (1:48)`);
  for (const p of IMPERIAL_SCALE_PRESETS) assert.equal(scaleDisplayLabel(p.ratio, 'ft'), p.label);
});

test('a metric scale keeps 1:N', () => {
  assert.equal(scaleDisplayLabel('1:100', 'mm'), '1:100');
  assert.equal(scaleDisplayLabel('1:96', 'mm'), '1:96');
  assert.equal(scaleDisplayLabel('1 : 50', 'm'), '1:50');
  assert.equal(scaleDisplayLabel('1:50'), '1:50');
});

test('other imperial ratios get inch notation when it is a clean one', () => {
  assert.equal(scaleDisplayLabel('1:1', 'in'), `12" = 1'-0" (1:1)`);
  assert.equal(scaleDisplayLabel('1:2', 'in'), `6" = 1'-0" (1:2)`);
  assert.equal(scaleDisplayLabel('1:300', 'ft'), `1" = 25'-0" (1:300)`);
  assert.equal(scaleDisplayLabel('1:768', 'ft'), `1/64" = 1'-0" (1:768)`);
  // Geen nette inchnotatie: dan gewoon de verhouding.
  assert.equal(scaleDisplayLabel('1:100', 'ft'), '1:100');
  assert.equal(scaleDisplayLabel('1:96.0412', 'ft'), '1:96.0412');
});

test('no scale or an unreadable one is shown as it is', () => {
  assert.equal(scaleDisplayLabel('', 'ft'), '');
  assert.equal(scaleDisplayLabel(0, 'mm'), '');
  assert.equal(scaleDisplayLabel(null, 'ft'), '');
  assert.equal(scaleDisplayLabel('abc', 'ft'), 'abc');
});

test('every place that shows a scale uses the one formatter', () => {
  const paneel = bron('../solid/components/left-panel/panels/MeasurementsPanel.jsx');
  assert.match(paneel, /return scaleDisplayLabel\(ms\.scaleRatio, ms\.unit\)/);
  assert.match(paneel, /scaleDisplayLabel\(vp\.scaleRatio, vp\.unit\)/);

  const controle = bron('../solid/components/dialogs/ScaleCheckDialog.jsx');
  assert.equal((controle.match(/scaleDisplayLabel\(/g) || []).length, 3, 'source, new scale, history');

  const kalibratie = bron('../solid/components/dialogs/CalibrationDialog.jsx');
  assert.match(kalibratie, /scaleDisplayLabel\(ratio, ms\.unit\)/);
  assert.match(kalibratie, /t\('calibration\.currentScale', \{ scale: currentScale \}\)/);
  assert.match(kalibratie, /ms\.method === 'ratio' \|\| ms\.method === 'auto-detect'/);

  const tekenen = bron('./rendering.js');
  assert.match(tekenen, /scaleDisplayLabel\(scaleStr, unitStr, \{ withRatio: false \}\)/);
  assert.match(tekenen, /scaleDisplayLabel\(annotation\.scaleRatio, annotation\.unit, \{ withRatio: false \}\)/);
  assert.match(tekenen, /scaleDisplayLabel\(_sbMs\.scaleRatio, _sbMs\.unit, \{ withRatio: false \}\)/);

  assert.match(bron('../solid/components/properties-panel/PropertiesPanel.jsx'), /scaleDisplayLabel\(cur, annotProps\.scaleRegionUnits\)/);
  assert.match(bron('../solid/components/dialogs/ScaleRegionDialog.jsx'), /scaleDisplayLabel\(scaleString\(\), units\(\)\)/);

  for (const taal of ['en', 'nl']) {
    const d = JSON.parse(bron(`../i18n/locales/${taal}/dialogs.json`));
    assert.match(d.calibration.currentScale, /\{\{scale\}\}/, taal);
  }
});
