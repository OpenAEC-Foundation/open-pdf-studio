import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { NAMES, CATEGORY_META } from './nen1414-metadata.js';

const assets = new URL('../../../assets/nen1414/', import.meta.url);
const locales = new URL('../../i18n/locales/', import.meta.url);

test('each catalogue name refers to an existing, uniquely named raster asset', () => {
  const files = readdirSync(assets).filter(f => f.endsWith('.png')).map(f => f.slice(0,-4)).sort();
  assert.deepEqual(Object.keys(NAMES).sort(), files);
});

test('first aid, prohibited lift, exit and warning labels match the inspected images (#1271)', () => {
  // Hashes bind the visual regression to the actual bundled image, rather
  // than accepting a renamed key whose picture was swapped accidentally.
  const cases = JSON.parse(readFileSync(new URL('./nen1414-label-fixtures.json', import.meta.url)));
  for (const [id, name, sha] of cases) {
    assert.equal(NAMES[id], name, id);
    assert.equal(createHash('sha256').update(readFileSync(new URL(id + '.png', assets))).digest('hex'), sha, id);
  }
  assert.equal(CATEGORY_META.Tr.name, 'NL NEN 1414 — Eerste hulp en redding');
  assert.equal(CATEGORY_META.Tv.name, 'NL NEN 1414 — Verbodstekens');
  assert.equal(CATEGORY_META.Tn.name, 'NL NEN 1414 — Vluchtwegen');
  assert.equal(CATEGORY_META.Tw.name, 'NL NEN 1414 — Waarschuwingen');
});

test('all 40 languages carry the four corrected categories and Dutch matches catalogue metadata', () => {
  const langs = readdirSync(locales, { withFileTypes: true }).filter(d => d.isDirectory());
  assert.equal(langs.length, 40);
  for (const lang of langs) {
    const categories = JSON.parse(readFileSync(new URL(lang.name + '/ribbon.json', locales))).symbolPalette.categories;
    for (const prefix of ['Tr', 'Tv', 'Tn', 'Tw']) {
      const value = categories['nen1414-' + prefix.toLowerCase()];
      assert.ok(value.startsWith('NL NEN 1414 — ') && value.length > 15, lang.name + prefix);
      if (lang.name === 'nl') assert.equal(value, CATEGORY_META[prefix].name);
    }
  }
});
