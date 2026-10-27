// Compare (#465): every language has every compare text, really translated,
// and every compare key the code uses exists.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const LOCALES = join(HIER, '../i18n/locales');
const lees = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const compare = (taal) => JSON.parse(lees(join(LOCALES, taal, 'ribbon.json'))).compare || {};

function plat(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object') plat(v, `${prefix}${k}.`, out);
    else out[prefix + k] = v;
  }
  return out;
}

test('all 40 languages have the same compare keys as English, none empty', () => {
  const talen = readdirSync(LOCALES);
  assert.equal(talen.length, 40);
  const en = plat(compare('en'));
  assert.ok(Object.keys(en).length >= 90);
  for (const taal of talen) {
    const b = plat(compare(taal));
    assert.deepEqual(Object.keys(b).sort(), Object.keys(en).sort(), taal);
    for (const [k, v] of Object.entries(b)) assert.ok(typeof v === 'string' && v.trim(), `${taal} ${k} is empty`);
    assert.ok(b['report.cloudsPlaced'].includes('{{count}}'), `${taal} report.cloudsPlaced keeps {{count}}`);
  }
});

test('sentences are translated, not copied from English', () => {
  const zinnen = ['fileLoadError', 'pickSecondSide', 'sensitivityHint', 'autoAlignHint', 'autoAlignEachHint',
    'confidenceHint', 'truncated', 'selectForClouds', 'report.cloudsNeedTab', 'report.failed', 'report.cloudsPlaced',
    'pairReason.sheet', 'pairReason.content', 'onlyInOld', 'onlyInNew', 'report.csv', 'report.pdf',
    'methodVectorHint', 'methodPixelFallback'];
  const en = plat(compare('en'));
  const gekopieerd = [];
  for (const taal of readdirSync(LOCALES)) {
    if (taal === 'en') continue;
    const b = plat(compare(taal));
    for (const k of zinnen) if (b[k] === en[k]) gekopieerd.push(`${taal} ${k}`);
  }
  assert.deepEqual(gekopieerd, []);
});

test('every compare key the code uses exists', () => {
  const en = plat(compare('en'));
  const bronnen = [
    '../solid/components/compare/CompareView.jsx',
    '../solid/components/compare/CompareDialog.jsx',
  ].map((p) => lees(join(HIER, p)));
  const gebruikt = new Set();
  for (const src of bronnen) {
    for (const m of src.matchAll(/\bt\('compare\.([A-Za-z.]+)'/g)) gebruikt.add(m[1]);
  }
  // compare-report-run.js prefixes "compare." itself.
  const run = lees(join(HIER, 'compare-report-run.js'));
  for (const m of run.matchAll(/\b(?:t|tr|tEn)\('([A-Za-z.]+)'/g)) gebruikt.add(m[1]);
  assert.ok(gebruikt.size >= 40, `found ${gebruikt.size}`);
  const ontbreekt = [...gebruikt].filter((k) => !(k in en));
  assert.deepEqual(ontbreekt, []);
  // Templated keys.
  for (const k of ['line', 'scan', 'text']) assert.ok(en[`preset.${k}`]);
  for (const k of ['no', 'pair', 'oldPage', 'newPage', 'sheet', 'type', 'source', 'xMm', 'yMm', 'widthMm', 'heightMm', 'oldText', 'newText']) {
    assert.ok(en[`report.col.${k}`], `report.col.${k}`);
  }
  for (const k of ['sheet', 'label', 'content', 'index', 'manual']) assert.ok(en[`pairReason.${k}`], `pairReason.${k}`);
});
