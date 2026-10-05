// Namen van proefleescorrecties (#508) in de annotatielijst en het paneel:
// aanwezig en vertaald in alle 39 talen. De lijst toont een vervanging,
// invoeging of schrapping bij deze naam in plaats van de kale typenaam.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCALES = join(dirname(fileURLToPath(import.meta.url)), '../../i18n/locales');
const KEYS = ['caret', 'replaceText', 'crossOut'];
const ENGELS = { caret: 'Inserted Text', replaceText: 'Replace Text', crossOut: 'Cross-Out' };

const types = (locale) => JSON.parse(readFileSync(join(LOCALES, locale, 'properties.json'), 'utf8')).types || {};
const plekhouders = (tekst) => (String(tekst).match(/\{\{\s*\w+\s*\}\}/g) || []).map((p) => p.replace(/\s/g, '')).sort();

test('alle 39 talen hebben de namen van de correcties', () => {
  const locales = readdirSync(LOCALES);
  assert.equal(locales.length, 39);
  for (const locale of locales) {
    const t = types(locale);
    for (const key of KEYS) {
      assert.equal(typeof t[key], 'string', `${locale} types.${key} ontbreekt`);
      assert.ok(t[key].trim().length > 0, `${locale} types.${key} is leeg`);
    }
  }
});

test('de Engelse namen zijn die uit de specificatie', () => {
  const t = types('en');
  for (const key of KEYS) assert.equal(t[key], ENGELS[key]);
});

test('geen taal valt terug op de Engelse namen', () => {
  for (const locale of readdirSync(LOCALES)) {
    if (locale === 'en') continue;
    const t = types(locale);
    for (const key of KEYS) {
      assert.notEqual(t[key], ENGELS[key], `${locale} types.${key} is de Engelse tekst`);
    }
  }
});

test('plekhouders zijn in elke taal dezelfde als in het Engels', () => {
  const en = types('en');
  for (const locale of readdirSync(LOCALES)) {
    const t = types(locale);
    for (const key of KEYS) {
      assert.deepEqual(plekhouders(t[key]), plekhouders(en[key]), `${locale} types.${key}`);
    }
  }
});

test('de drie namen verschillen per taal van elkaar en van de naam voor tekst', () => {
  for (const locale of readdirSync(LOCALES)) {
    const t = types(locale);
    assert.equal(new Set(KEYS.map((k) => t[k])).size, 3, `${locale}: drie verschillende namen`);
    assert.notEqual(t.caret, t.text, `${locale}: invoegen is niet hetzelfde als tekst`);
  }
});
