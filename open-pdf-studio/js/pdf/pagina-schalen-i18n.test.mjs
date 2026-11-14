import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Page scales (#1065): every language has the same thumbnail texts as
// English, none empty, the interpolations kept, and every key the code uses
// exists.
const HIER = dirname(fileURLToPath(import.meta.url));
const LOCALES = join(HIER, '../i18n/locales');

const blok = (taal) => JSON.parse(readFileSync(join(LOCALES, taal, 'context.json'), 'utf8')).thumbnail || {};
const plaatshouders = (tekst) => [...String(tekst).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

test('all 40 languages have the same thumbnail keys as English, none empty, same placeholders', () => {
  const talen = readdirSync(LOCALES);
  assert.equal(talen.length, 40);
  const en = blok('en');
  for (const taal of talen) {
    const b = blok(taal);
    assert.deepEqual(Object.keys(b).sort(), Object.keys(en).sort(), taal);
    for (const [sleutel, tekst] of Object.entries(b)) {
      assert.ok(typeof tekst === 'string' && tekst.trim(), `${taal} ${sleutel} is empty`);
      assert.deepEqual(plaatshouders(tekst), plaatshouders(en[sleutel]), `${taal} ${sleutel} placeholders`);
    }
  }
});

test('the page scale texts are translated in Dutch, German, French and Spanish', () => {
  const en = blok('en');
  const sleutels = Object.keys(en).filter((k) => /scale/i.test(k) || k === 'pickScaleArea');
  assert.ok(sleutels.length >= 15, sleutels.join(', '));
  for (const taal of ['nl', 'de', 'fr', 'es']) {
    const b = blok(taal);
    const gelijk = sleutels.filter((k) => b[k] === en[k]);
    assert.deepEqual(gelijk, [], `${taal} keeps English text`);
  }
});

test('every thumbnail key the page scale code uses exists', () => {
  const en = blok('en');
  const bronnen = [
    '../solid/components/left-panel/ThumbnailItem.jsx',
    '../solid/components/ContextMenu.jsx',
    './pagina-schalen-app.js',
  ].map((p) => readFileSync(join(HIER, p), 'utf8')).join('\n');
  const gebruikt = [...new Set([...bronnen.matchAll(/['`](?:context:)?thumbnail\.([A-Za-z]+)['`]/g)].map((m) => m[1]))];
  for (const k of ['scaleOwnSet', 'scaleOwnDetected', 'scaleOwnOcr', 'scaleAlsoOnSheet', 'scaleDocument', 'scaleNone',
    'scaleInvalid', 'detectingPageScales', 'setPageScale', 'detectPageScales', 'clearPageScale', 'detectPageScalesArea', 'pickScaleArea']) {
    assert.ok(gebruikt.includes(k), `thumbnail.${k} is used`);
  }
  for (const k of gebruikt) assert.ok(en[k], `thumbnail.${k} exists in en`);
});
