// Eenhedenstelsel van de schaallijsten (#996): Metrisch, Imperiaal of Beide
// (standaard). De huidige schaal blijft altijd in de lijst staan.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  scaleSelectOptions, filterScaleOptions, schaalSysteem, stelSchaalSysteemBronIn,
  isImperialScalePreset, IMPERIAL_SCALE_PRESETS, METRIC_SCALE_PRESETS,
} from './scale-presets.js';

const bron = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');

afterEach(() => stelSchaalSysteemBronIn(null));

test('without a preference both systems are listed', () => {
  assert.equal(schaalSysteem(), 'both');
  assert.equal(scaleSelectOptions().length, METRIC_SCALE_PRESETS.length + IMPERIAL_SCALE_PRESETS.length);
});

test('metric or imperial shows only that system', () => {
  const metrisch = scaleSelectOptions(undefined, { system: 'metric' });
  assert.deepEqual(metrisch.map(o => o.value), METRIC_SCALE_PRESETS);
  const imperiaal = scaleSelectOptions(undefined, { system: 'imperial' });
  assert.deepEqual(imperiaal.map(o => o.value), IMPERIAL_SCALE_PRESETS.map(p => p.ratio));
  assert.ok(imperiaal.every(o => isImperialScalePreset(o.value)));
});

test('the preference source decides, an unknown value means both', () => {
  stelSchaalSysteemBronIn(() => 'imperial');
  assert.equal(scaleSelectOptions().length, IMPERIAL_SCALE_PRESETS.length);
  stelSchaalSysteemBronIn(() => 'metric');
  assert.equal(scaleSelectOptions().length, METRIC_SCALE_PRESETS.length);
  stelSchaalSysteemBronIn(() => 'nonsense');
  assert.equal(schaalSysteem(), 'both');
  stelSchaalSysteemBronIn(() => { throw new Error('x'); });
  assert.equal(schaalSysteem(), 'both');
});

test('the current scale stays in a filtered list', () => {
  const lijst = scaleSelectOptions(undefined, { system: 'metric', current: '1:96' });
  assert.ok(lijst.some(o => o.value === '1:96' && o.label === `1/8" = 1'-0" (1:96)`));
  const imp = filterScaleOptions([{ value: '1:100', label: '1:100' }, { value: '1:48', label: 'q' }],
    { system: 'imperial', current: '1:100' });
  assert.deepEqual(imp.map(o => o.value), ['1:100', '1:48']);
});

test('the preference exists with default both, and every scale list follows it', () => {
  // Bron gelezen: CI draait Node 20, dat geen .ts importeert.
  assert.match(bron('../core/constants.ts'), /\n\s*scaleUnitSystem: 'both',/);
  assert.match(bron('../main.js'), /stelSchaalSysteemBronIn\(\(\) => state\.preferences\?\.scaleUnitSystem\)/);
  assert.match(bron('../solid/components/dialogs/ViewportScaleDialog.jsx'), /filterScaleOptions\(/);
  assert.match(bron('../solid/components/dialogs/ScaleRegionDialog.jsx'), /scaleSelectOptions\(METRIC_REGION_SCALES, \{ current: scaleString\(\) \}\)/);
  const paneel = bron('../solid/components/properties-panel/PropertiesPanel.jsx');
  assert.match(paneel, /\{ current: annotProps\.viewportScaleRatio \|\| '1:100' \}/);
  assert.match(paneel, /\{ current: cur \}/);
  assert.match(bron('../solid/components/preferences/AnnotationsTab.jsx'), /p\.scaleUnitSystem\[0\]/);
});
