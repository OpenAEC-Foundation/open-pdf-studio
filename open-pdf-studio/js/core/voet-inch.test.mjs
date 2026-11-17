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

// ── #1145: voet, inch en breuken in elk lengteveld, bij elke eenheid ────────

test('every unambiguous form reads the same whatever the display preference (#1145)', async () => {
  const { ontleedVoetInch } = await import('./voet-inch.js');
  const gevallen = {
    [`12'`]: 144, [`6"`]: 6, [`12' 6"`]: 150, [`12'-6 3/8"`]: 150.375, [`6 3/8"`]: 6.375,
    [`3/8"`]: 0.375, [`1.5'`]: 18, [`6.25"`]: 6.25, [`12'6`]: 150, [`12' 6 3/8`]: 150.375,
    [`0'-0 1/64"`]: 1 / 64, [`12 feet 6 inches`]: 150, [`6 in`]: 6, [`12’-6”`]: 150,
  };
  for (const formaat of ['decimal', 'feetInch']) {
    stelVoetInchBronIn(() => ({ formaat, precisie: 16 }));
    for (const [tekst, inches] of Object.entries(gevallen)) {
      assert.equal(leesVoetInch(tekst), inches, `${tekst} (${formaat})`);
    }
  }
  assert.deepEqual(ontleedVoetInch(`12'-6"`), { inches: 150, metVoet: true });
  assert.deepEqual(ontleedVoetInch(`6 3/8"`), { inches: 6.375, metVoet: false });
});

test('what is ambiguous is rejected, not guessed (#1145)', () => {
  // Een breuk zonder inchteken, twee getallen zonder voetteken, een breuk
  // achter decimale inches, twee keer voet, een noemer nul, losse tekens.
  for (const tekst of [`6 3/8`, `3/8`, `12 6"`, `12-6-3/8`, `6.5 3/8"`, `12' 6.5 3/8"`, `12'6'`,
    `6 3/0"`, `'`, `"`, `12' x`, `12'-6" extra`, `1/2/4"`]) {
    assert.equal(leesVoetInch(tekst), null, tekst);
    assert.ok(Number.isNaN(leesLengte(tekst, 'ft')), `leesLengte ${tekst}`);
  }
  // Met { begin } mag een kaal getal tekst erachter hebben, maar een mislukte
  // voet-inchmaat wordt geen 12.
  assert.equal(leesLengte('12 mm', 'mm', { begin: true }), 12);
  assert.ok(Number.isNaN(leesLengte(`12'-6 x"`, 'ft', { begin: true })));
  assert.ok(Number.isNaN(leesLengte(`12' 6 3/`, 'ft', { begin: true })));
});

test('a bare number keeps meaning the unit of the field (#1145)', () => {
  assert.equal(leesLengte('12', 'ft'), 12);
  assert.equal(leesLengte('12', 'in'), 12);
  assert.equal(leesLengte('12', 'mm'), 12);
  assert.equal(leesLengte('12,5', 'ft'), 12.5);
  assert.equal(leesLengte(7, 'm'), 7);
});

test('feet and inches convert exactly to a metric unit: 1 in = 25.4 mm (#1145)', () => {
  assert.equal(leesLengte(`1"`, 'mm'), 25.4);
  assert.equal(leesLengte(`10"`, 'cm'), 25.4);
  assert.ok(Math.abs(leesLengte(`12'-6 3/8"`, 'mm') - 3819.525) < 1e-9);
  assert.ok(Math.abs(leesLengte(`12'-6 3/8"`, 'm') - 3.819525) < 1e-12);
  assert.ok(Math.abs(leesLengte(`3'`, 'yd') - 1) < 1e-12);
  assert.equal(leesLengte(`6"`, 'ft'), 0.5);
  assert.equal(leesLengte(`1.5'`, 'in'), 18);
  // Een eenheid zonder vaste lengte: dan is een voet-inchmaat onzin.
  assert.ok(Number.isNaN(leesLengte(`12'`, 'px')));
  assert.equal(leesLengte('12', 'px'), 12);
});

test('negative lengths where a field allows them (#1145)', () => {
  assert.equal(leesVoetInch(`-2'-6"`), -30);
  assert.equal(leesVoetInch(`-6 3/8"`), -6.375);
  assert.equal(leesVoetInch(`-3/8"`), -0.375);
  assert.equal(leesLengte(`-1'`, 'mm'), -304.8);
  assert.equal(leesLengte('-2,5', 'ft'), -2.5);
});

test('a decimal comma is a decimal sign, never a thousands separator (#1145)', () => {
  // Eén scheidingsteken is altijd het decimaalteken (core/getal-invoer.js).
  assert.equal(leesVoetInch(`1,5'`), 18);
  assert.ok(Math.abs(leesVoetInch(`1,234'`) - 14.808) < 1e-9, '1,234 ft, not 1234 ft');
  assert.ok(Math.abs(leesVoetInch(`1.234'`) - 14.808) < 1e-9);
  assert.equal(leesVoetInch(`6,25"`), 6.25);
  assert.equal(leesVoetInch(`12' 6,5"`), 150.5);
  // Een getal met groepen hoort niet in een voet-inchmaat: geweigerd.
  for (const tekst of [`1,234.5'`, `1.234,5'`, `1,234,567'`, `12' 1,234.5"`]) {
    assert.equal(leesVoetInch(tekst), null, tekst);
    assert.ok(Number.isNaN(leesLengte(tekst, 'ft')), tekst);
  }
  // Zonder voet- of inchteken blijft het de gewone getalinvoer.
  assert.equal(leesLengte('1.234,5', 'mm'), 1234.5);
});

test('a typed length that carries its own unit (#1145)', async () => {
  const { leesVoetInchMaat, lijktOpVoetInch } = await import('./voet-inch.js');
  assert.deepEqual(leesVoetInchMaat(`12'-6"`), { waarde: 12.5, eenheid: 'ft' });
  assert.deepEqual(leesVoetInchMaat(`6 3/8"`), { waarde: 6.375, eenheid: 'in' });
  assert.deepEqual(leesVoetInchMaat(`12 ft 6 in`), { waarde: 12.5, eenheid: 'ft' });
  assert.equal(leesVoetInchMaat('12'), null);
  assert.equal(lijktOpVoetInch(`12'`), true);
  assert.equal(lijktOpVoetInch('12 ft'), false);
});

test('every length field goes through the one parser (#1145)', () => {
  const leest = /leesLengte\(/;
  for (const pad of [
    '../solid/components/dialogs/CalibrationDialog.jsx',
    '../solid/components/dialogs/ScaleCheckDialog.jsx',
    '../solid/components/dialogs/MeasuredLengthDialog.jsx',
    '../solid/components/dialogs/ViewportScaleDialog.jsx',
    '../solid/components/BoxSizeOverlay.jsx',
    '../solid/stores/propertiesStore.js',
    '../tools/coord-invoer.js',
  ]) assert.match(bron(pad), leest, pad);
  assert.match(bron('../solid/components/dialogs/ScaleDialog.jsx'), /leesVoetInchMaat\(/);
  // De velden zelf zijn lengtevelden: ook bij een metrische eenheid typbaar.
  for (const pad of [
    '../solid/components/dialogs/CalibrationDialog.jsx',
    '../solid/components/dialogs/ScaleCheckDialog.jsx',
    '../solid/components/dialogs/MeasuredLengthDialog.jsx',
    '../solid/components/dialogs/ViewportScaleDialog.jsx',
    '../solid/components/properties-panel/PropertiesPanel.jsx',
  ]) assert.match(bron(pad), /data-getal="lengte"/, pad);
  // Er is geen tweede voet-inchparser bijgekomen.
  for (const pad of ['../tools/coord-invoer.js', '../tools/voet-inch-toets.js', '../ui/getal-veld.js',
    '../solid/components/dialogs/ScaleDialog.jsx']) {
    assert.doesNotMatch(bron(pad), /new RegExp/, pad);
  }
  // De hint staat bij een imperiale eenheid in de tooltip.
  assert.match(bron('../solid/components/BoxSizeOverlay.jsx'), /isImperialeLengte\(unit\(\)\)[^\n]*feetInchHint/);
  assert.match(bron('../solid/components/TypeLengthHUD.jsx'), /isImperialeLengte\(typeLengthUnit\(\)\)/);
});
