// Versleepbare breedte van eigenschappenpaneel en symbolenpalet: grenzen,
// sleeprichting per rand en de werkruimte-sleutels.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { begrensPaneelBreedte, gesleepteBreedte, PANEEL_BREEDTES } = await import('./paneel-breedte.js');
const { LAYOUT_SLEUTELS, normaliseerLayout, PANEEL_MIN } = await import('../../core/werkruimte.js');

test('width stays between the minimum and 60 % of the window', () => {
  assert.equal(begrensPaneelBreedte(50, 2000), PANEEL_MIN);
  assert.equal(begrensPaneelBreedte(480.4, 2000), 480);
  assert.equal(begrensPaneelBreedte(5000, 2000), 1200);
  assert.equal(begrensPaneelBreedte(null, 2000), null);
  assert.equal(begrensPaneelBreedte('300', 2000), null);
});

test('a grip on the left edge widens when dragged left, on the right edge when dragged right', () => {
  assert.equal(gesleepteBreedte(300, 1000, 900, 'links', 2000), 400);
  assert.equal(gesleepteBreedte(300, 1000, 1100, 'links', 2000), 200);
  assert.equal(gesleepteBreedte(220, 400, 500, 'rechts', 2000), 320);
  assert.equal(gesleepteBreedte(220, 400, 500, 'rechts', 2000, true), PANEEL_MIN, 'right-to-left flips');
});

test('both widths belong to the workspace layout, null = the stylesheet width', () => {
  for (const sleutel of Object.keys(PANEEL_BREEDTES)) {
    assert.ok(LAYOUT_SLEUTELS.includes(sleutel), sleutel);
    assert.equal(normaliseerLayout({ [sleutel]: 420 })[sleutel], 420);
    assert.equal(normaliseerLayout({ [sleutel]: null })[sleutel], null);
    assert.equal(normaliseerLayout({ [sleutel]: 10 })[sleutel], undefined, 'too narrow is dropped');
  }
});
