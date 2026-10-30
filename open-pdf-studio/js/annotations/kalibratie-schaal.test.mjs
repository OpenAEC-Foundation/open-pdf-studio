// Kalibratiedialoog, tab Schaalverhouding (#553): in ft gaf de dialoog
// pixelsPerUnit = 72 / (S * 12), 144 keer te klein, zodat elke meting daarna
// 144 keer te lang was. Het schaalgebied rekende wél goed (pixelsPerUnitFor).
// De dialoog rekent nu via pixelsPerUnitFor; deze tests pinnen dat voor elke
// eenheid die de dialoog aanbiedt, en dat de dialoog geen eigen omrekening
// meer heeft.
//
// scale-region.js laadt de state-store (state.ts); zie ../core/app-test-hooks.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { schaalUitKalibratie } = await import('./kalibratie-schaal.js');
const { pixelsPerUnitFor } = await import('./scale-region.js');

const dialoog = readFileSync(new URL('../solid/components/dialogs/CalibrationDialog.jsx', import.meta.url), 'utf8');

// De eenheden van de keuzelijst op de tab Schaalverhouding, uit de dialoog zelf:
// een eenheid die er later bijkomt, valt zo vanzelf onder deze tests.
function eenhedenVanSelect(signaal) {
  const begin = dialoog.indexOf(`value={${signaal}()}`);
  assert.ok(begin > 0, `keuzelijst ${signaal} niet gevonden`);
  const lijst = dialoog.slice(begin, dialoog.indexOf('</select>', begin));
  return [...lijst.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
}
const verhoudingEenheden = eenhedenVanSelect('ratioUnit');
const referentieEenheden = eenhedenVanSelect('unit');

// Inches per eenheid: 1:S betekent S eenheden echt = 1 eenheid op papier, en
// 1 inch op papier is 72 PDF-punten.
const INCH_PER_EENHEID = { mm: 1 / 25.4, cm: 1 / 2.54, m: 1000 / 25.4, in: 1, ft: 12 };
const ongeveer = (a, b, tekst) => assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), `${tekst}: ${a} ≠ ${b}`);

test('the dialog offers only units the scale regions know', () => {
  // pixelsPerUnitFor valt bij een onbekende eenheid stil terug op mm.
  assert.ok(verhoudingEenheden.includes('ft') && verhoudingEenheden.length >= 5, verhoudingEenheden.join(', '));
  for (const unit of [...verhoudingEenheden, ...referentieEenheden]) {
    assert.ok(unit in INCH_PER_EENHEID, `onbekende eenheid ${unit}`);
  }
});

test('1:48 in feet is 18 points per foot, the same as a scale region (#553)', () => {
  const schaal = schaalUitKalibratie({ method: 'ratio', denominator: 48, unit: 'ft' });
  // 1 ft bij 1:48 is 1/4" op papier = 18 pt (op afronding van de mm-route na).
  ongeveer(schaal.pixelsPerUnit, 18, '1:48 in ft');
  assert.equal(schaal.pixelsPerUnit, pixelsPerUnitFor('1:48', 'ft'));
  assert.deepEqual(schaal, { pixelsPerUnit: schaal.pixelsPerUnit, unit: 'ft', method: 'ratio', scaleRatio: '1:48' });
  // De meting uit het issue: 2,5" op papier (180 pt) bij 1/4" = 1'-0" is 10 ft.
  ongeveer(180 / schaal.pixelsPerUnit, 10, 'meting van 180 pt');
});

test('every unit of the ratio tab gives what pixelsPerUnitFor gives', () => {
  for (const unit of verhoudingEenheden) {
    for (const S of [1, 10, 12.5, 48, 96, 100, 1000]) {
      const { pixelsPerUnit, scaleRatio } = schaalUitKalibratie({ method: 'ratio', denominator: S, unit });
      assert.equal(scaleRatio, `1:${S}`);
      assert.equal(pixelsPerUnit, pixelsPerUnitFor(`1:${S}`, unit), `${unit} bij 1:${S}`);
      ongeveer(pixelsPerUnit, 72 * INCH_PER_EENHEID[unit] / S, `${unit} bij 1:${S}`);
    }
  }
});

test('the reference line holds for every unit: known points over known length', () => {
  for (const unit of referentieEenheden) {
    const schaal = schaalUitKalibratie({ method: 'reference', pixels: '180', distance: '10', unit });
    assert.deepEqual(schaal, { pixelsPerUnit: 18, unit, method: 'reference', scaleRatio: null });
  }
});

test('input that gives no scale is not applied', () => {
  assert.equal(schaalUitKalibratie({ method: 'reference', pixels: 72, distance: 0, unit: 'mm' }), null);
  assert.equal(schaalUitKalibratie({ method: 'reference', pixels: '', distance: 1, unit: 'mm' }), null);
  assert.equal(schaalUitKalibratie({ method: 'ratio', denominator: -5, unit: 'ft' }), null);
  assert.equal(schaalUitKalibratie({ method: 'ratio', denominator: 0, unit: 'ft' }), null);
  assert.equal(schaalUitKalibratie({ method: 'ratio', denominator: NaN, unit: 'ft' }), null);
});

test('the dialog has no unit conversion of its own', () => {
  const apply = dialoog.slice(dialoog.indexOf('function handleApply'), dialoog.indexOf('function handleReset'));
  assert.match(apply, /schaalUitKalibratie\(\{/);
  assert.doesNotMatch(dialoog, /pixelsPerUnit\s*=\s*72\b/);
  assert.doesNotMatch(dialoog, /72\s*\/\s*\(\s*S\b/);
});


// #885: actual paper distances with the selectable architectural/engineering
// ratios must retain the established calibration conversion (including ft).
const { IMPERIAL_SCALE_PRESETS } = await import('./scale-presets.js');
test('imperial presets measure a 2.5-inch paper line in feet without a unit-ratio error', () => {
  const expected = [80, 40, 80 / 3, 20, 40 / 3, 10, 20 / 3, 5, 10 / 3, 2.5, 5 / 3, 5 / 6,
    25, 50, 75, 100, 125, 150, 250];
  assert.equal(IMPERIAL_SCALE_PRESETS.length, expected.length);
  for (const [i, preset] of IMPERIAL_SCALE_PRESETS.entries()) {
    const scale = schaalUitKalibratie({ method: 'ratio', denominator: Number(preset.ratio.split(':')[1]), unit: 'ft' });
    ongeveer(180 / scale.pixelsPerUnit, expected[i], preset.label);
    assert.equal(scale.scaleRatio, preset.ratio);
  }
});
