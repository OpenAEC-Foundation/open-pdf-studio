// Voet-inch-breuken (#996): weergave van imperiale lengtes als 12'-6 3/8" en
// het lezen van zo'n getypte maat in de kalibratie- en schaalcontroledialoog.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  formatVoetInch, leesVoetInch, leesLengte, lengteNotatie, stelVoetInchBronIn, toontVoetInch,
} from './voet-inch.js';
import { formatCell, fmtTotal } from '../quantities/schedule-templates.js';

const bron = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');

afterEach(() => stelVoetInchBronIn(null));

test('feet and inches with a fraction, rounded to the chosen precision', () => {
  assert.equal(formatVoetInch(12.53125, 'ft', { precisie: 16 }), `12'-6 3/8"`);
  assert.equal(formatVoetInch(12, 'ft', { precisie: 16 }), `12'-0"`);
  assert.equal(formatVoetInch(0.5, 'ft', { precisie: 16 }), `0'-6"`);
  assert.equal(formatVoetInch(150, 'in', { precisie: 8 }), `12'-6"`);
  assert.equal(formatVoetInch(1 / 64, 'in', { precisie: 64 }), `0'-0 1/64"`);
  // 1/2: 6.3" rondt naar 6 1/2".
  assert.equal(formatVoetInch(6.3, 'in', { precisie: 2 }), `0'-6 1/2"`);
  // Afronden naar 12" wordt een hele voet.
  assert.equal(formatVoetInch(11.999, 'ft', { precisie: 16 }), `12'-0"`);
  assert.equal(formatVoetInch(-3.25, 'ft', { precisie: 16 }), `-3'-3"`);
  assert.equal(formatVoetInch(-0.0001, 'ft', { precisie: 16 }), `0'-0"`);
  assert.equal(formatVoetInch(NaN, 'ft'), '');
});

test('reading typed feet and inches gives inches', () => {
  const gevallen = {
    [`12'-6 3/8"`]: 150.375, [`12' 6"`]: 150, [`12'6"`]: 150, [`12'`]: 144, [`6 3/8"`]: 6.375,
    [`3/8"`]: 0.375, [`12.5'`]: 150, [`1,5'`]: 18, [`150"`]: 150, ['12 ft 6 in']: 150,
    [`12'-6-3/8"`]: 150.375, [`-2'-6"`]: -30, [`12′-6″`]: 150,
  };
  for (const [tekst, inches] of Object.entries(gevallen)) assert.equal(leesVoetInch(tekst), inches, tekst);
  for (const tekst of ['12', '2,5', 'abc', '', `6 3/0"`]) assert.equal(leesVoetInch(tekst), null, tekst);
  assert.equal(leesVoetInch(12), null);
});

test('a typed length in the unit of the field', () => {
  assert.equal(leesLengte(`12'-6"`, 'ft'), 12.5);
  assert.equal(leesLengte(`12'-6"`, 'in'), 150);
  assert.ok(Math.abs(leesLengte(`1'`, 'mm') - 304.8) < 1e-9);
  // Een kaal getal telt zoals het er staat, komma of punt.
  assert.equal(leesLengte('2,5', 'm'), 2.5);
  assert.equal(leesLengte('12.5', 'ft'), 12.5);
  assert.ok(Number.isNaN(leesLengte('abc', 'ft')));
});

test('the preference decides: decimal by default, feet-inch only for ft and in', () => {
  assert.deepEqual(lengteNotatie(), { formaat: 'decimal', precisie: 16 });
  assert.equal(toontVoetInch('ft'), false);
  stelVoetInchBronIn(() => ({ formaat: 'feetInch', precisie: 4 }));
  assert.equal(toontVoetInch('ft'), true);
  assert.equal(toontVoetInch('in'), true);
  assert.equal(toontVoetInch('m'), false);
  assert.equal(toontVoetInch('ft²'), false);
  assert.equal(formatVoetInch(12.53125, 'ft'), `12'-6 1/2"`);
  stelVoetInchBronIn(() => ({ formaat: 'feetInch', precisie: 3 }));
  assert.equal(lengteNotatie().precisie, 16, 'an unknown precision falls back to 1/16');
});

test('quantity columns in ft follow the preference, areas stay sq ft', () => {
  const lengte = { unit: 'ft', decimals: 2 };
  assert.equal(formatCell(12.5, lengte), '12.50');
  stelVoetInchBronIn(() => ({ formaat: 'feetInch', precisie: 16 }));
  assert.equal(formatCell(12.5, lengte), `12'-6"`);
  assert.equal(fmtTotal(25, lengte), `25'-0"`);
  assert.equal(formatCell(12.5, { unit: 'ft²', decimals: 2 }), '12.50');
  assert.equal(formatCell(3, { unit: 'm', decimals: 1 }), '3.0');
});

test('measurement labels, the panel and the dialogs use it', () => {
  const meting = bron('../annotations/measurement.js');
  assert.match(meting, /if \(toontVoetInch\(measurement\.unit\) && Number\.isFinite\(Number\(measurement\.value\)\)\) \{\s*return formatVoetInch\(measurement\.value, measurement\.unit\);/);
  assert.match(bron('../solid/components/left-panel/panels/MeasurementsPanel.jsx'), /formatMeasurement\(\{ value: sum, unit \}\)/);
  assert.match(bron('../solid/components/dialogs/CalibrationDialog.jsx'), /distance: leesLengte\(String\(distance\(\)\), unit\(\)\)/);
  assert.match(bron('../solid/components/dialogs/ScaleCheckDialog.jsx'), /leesLengte\(bekendTekst\(\), gekozenEenheid\(\)\)/);
  assert.match(bron('../main.js'), /stelVoetInchBronIn\(/);
  const prefs = bron('./constants.ts');
  assert.match(prefs, /imperialLengthFormat: 'decimal',/);
  assert.match(prefs, /imperialFractionPrecision: 16,/);
  for (const taal of ['en', 'nl']) {
    const p = JSON.parse(bron(`../i18n/locales/${taal}/preferences.json`)).measurement;
    for (const k of ['units', 'unitSystem', 'unitSystemBoth', 'unitSystemMetric', 'unitSystemImperial',
      'imperialLengthFormat', 'imperialDecimal', 'imperialFeetInch', 'imperialFractionPrecision']) {
      assert.equal(typeof p[k], 'string', `${taal} ${k}`);
    }
  }
});
