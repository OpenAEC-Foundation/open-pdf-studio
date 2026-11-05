// Imperiale standaardschalen vindbaar (#972): ze stonden alleen in de
// kalibratiedialoog, en die was alleen via het contextmenu van een meting te
// openen. Elke schaalkeuzelijst biedt ze nu, en het lint opent de dialoog.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  scaleSelectOptions, isImperialScalePreset, IMPERIAL_SCALE_PRESETS, METRIC_SCALE_PRESETS,
} from './scale-presets.js';

const bron = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');

test('the dropdown options list the given metric ratios, then every imperial preset', () => {
  const opties = scaleSelectOptions(['1:100', '1:50']);
  assert.deepEqual(opties.slice(0, 2), [{ value: '1:100', label: '1:100' }, { value: '1:50', label: '1:50' }]);
  assert.equal(opties.length, 2 + IMPERIAL_SCALE_PRESETS.length);
  const kwart = opties.find(o => o.value === '1:48');
  assert.equal(kwart.label, `1/4" = 1'-0" (1:48)`);
  assert.equal(scaleSelectOptions().length, METRIC_SCALE_PRESETS.length + IMPERIAL_SCALE_PRESETS.length);
  const waarden = opties.map(o => o.value);
  assert.equal(new Set(waarden).size, waarden.length, 'no ratio twice');
});

test('imperial presets are recognised, metric ratios are not', () => {
  assert.equal(isImperialScalePreset('1:48'), true);
  assert.equal(isImperialScalePreset('1:120'), true);
  assert.equal(isImperialScalePreset('1:50'), false);
  assert.equal(isImperialScalePreset('1:100'), false);
});

test('no metric preset of the scale dialogs collides with an imperial one', () => {
  const metrisch = [
    ...METRIC_SCALE_PRESETS,
    '1:200', '1:100', '1:50', '1:20', '1:10', '1:5', '1:2', '1:1',
    ...[10, 20, 25, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000, 1250, 2000, 2500, 5000].map(r => `1:${r}`),
  ];
  for (const r of metrisch) assert.equal(isImperialScalePreset(r), false, r);
});

test('every scale dropdown offers the imperial presets and switches to feet', () => {
  const regio = bron('../solid/components/dialogs/ScaleRegionDialog.jsx');
  assert.match(regio, /scaleSelectOptions\(METRIC_REGION_SCALES\)/);
  assert.match(regio, /isImperialScalePreset\(v\)\) setUnits\('ft'\)/);

  const viewport = bron('../solid/components/dialogs/ViewportScaleDialog.jsx');
  assert.match(viewport, /\.\.\.IMPERIAL_SCALE_PRESETS\.map\(/);
  assert.match(viewport, /unit = isImperialScalePreset\(`1:\$\{ratio\}`\) \? 'ft' : 'mm';/);

  const paneel = bron('../solid/components/properties-panel/PropertiesPanel.jsx');
  assert.equal((paneel.match(/scaleSelectOptions\(/g) || []).length, 2, 'scale region and viewport in the properties panel');
  assert.match(paneel, /isImperialScalePreset\(ratio\)\) updateAnnotProp\('scaleRegionUnits', 'ft'\)/);

  const store = bron('../solid/stores/propertiesStore.js');
  assert.equal((store.match(/isImperialScalePreset\(`1:\$\{(?:ratio|vpRatio)\}`\) \? 'ft' : 'mm'/g) || []).length, 2);
});

test('the ribbon opens the calibration dialog with its ratio presets', () => {
  const meten = bron('../solid/components/ribbon/CommentTab.jsx');
  assert.match(meten, /id="tool-measure-calibrate"[^\n]*icon=\{calibrateIcon\}/);
  assert.match(meten, /onClick=\{\(\) => showCalibrationDialog\(\)\}/);
  const tekenen = bron('../solid/components/ribbon/DrawingTab.jsx');
  assert.match(tekenen, /id="btn-calibrate-scale"/);
  assert.match(tekenen, /openDialog\('calibration', \{ referencePixelLength: null \}\)/);
  const dialoog = bron('../solid/components/dialogs/CalibrationDialog.jsx');
  assert.match(dialoog, /IMPERIAL_SCALE_PRESETS\.map\(preset => <option value=\{preset\.ratio\}>\{preset\.label\}<\/option>\)/);
});
