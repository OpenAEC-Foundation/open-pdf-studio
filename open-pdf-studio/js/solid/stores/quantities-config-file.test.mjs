import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();
const q = await import('./quantitiesStore.js');
const { encodeQuantitiesConfig, decodeQuantitiesConfig } = await import('../../quantities/config-file.js');
const { state } = await import('../../core/state.ts');
const original = q.quantitiesConfig();
const config = { ...original, categories: ['line-based'], fields: ['label', 'length'],
  filters: [{ field: 'length', op: '>=', value: '2' }, { field: '', op: '', value: '' }],
  sort: [{ field: 'label', dir: 'desc', group: true, header: true, footer: false }],
  itemize: false, grandTotals: false,
  format: { length: { heading: 'Lengte α', unit: 'm', decimals: 3, align: 'left', total: false } },
  appearance: { gridlines: false, outline: true, stripe: true, showTitle: false, showHeaders: false } };

test('export/import preserves every setting and reproduces filtered, grouped quantities', () => {
  state.documents = [{ id: 'quantities-file', annotations: [
    { id: 'one', page: 1, type: 'measureDistance', measureValue: 1, measureUnit: 'm' },
    { id: 'three', page: 1, type: 'measureDistance', measureValue: 3, measureUnit: 'm' },
  ] }]; state.activeDocumentIndex = 0;
  q.applyQuantitiesConfig(config);
  const before = JSON.parse(JSON.stringify(q.scheduleResult()));
  const saved = encodeQuantitiesConfig(q.quantitiesConfig());
  assert.equal(JSON.parse(saved).version, 1);
  assert.ok(!saved.includes('quantities-file') && !saved.includes('annotations'));
  q.applyQuantitiesConfig(original);
  q.applyQuantitiesConfig(decodeQuantitiesConfig('\uFEFF' + saved));
  assert.deepEqual(q.quantitiesConfig(), config);
  assert.equal(q.scheduleResult().count, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(q.scheduleResult())), before);
  q.applyQuantitiesConfig(original);
});

test('snapshots and imported settings do not retain mutable references', () => {
  const input = decodeQuantitiesConfig(encodeQuantitiesConfig(config));
  q.applyQuantitiesConfig(input); input.format.length.unit = 'ft'; input.categories.push('count');
  const snapshot = q.quantitiesConfig(); snapshot.format.length.unit = 'in'; snapshot.fields.length = 0;
  assert.deepEqual(q.quantitiesConfig(), config);
  q.applyQuantitiesConfig(original);
});

test('invalid files and configurations leave all current settings unchanged', () => {
  const mutations = [
    c => c.categories.push('unknown'), c => c.fields.push('__proto__'),
    c => c.filters[0].op = 'execute', c => c.sort[0].dir = 'sideways',
    c => c.itemize = 'false', c => c.format.length.decimals = 99,
    c => c.appearance.gridlines = {}, c => c.filters = Array(9).fill(c.filters[0]),
    c => c.format = JSON.parse('{"__proto__":{"unit":"m"}}'),
  ];
  for (const change of mutations) {
    const c = structuredClone(config); change(c);
    assert.throws(() => q.applyQuantitiesConfig(c));
    assert.deepEqual(q.quantitiesConfig(), original);
  }
  for (const source of ['{broken', '{}', 'null', '[]', JSON.stringify({ type: 'open-pdf-studio/quantities', version: 2, config }), ' '.repeat(2 * 1024 * 1024 + 1)]) {
    assert.throws(() => q.applyQuantitiesConfig(decodeQuantitiesConfig(source)));
    assert.deepEqual(q.quantitiesConfig(), original);
  }
});

test('empty selections and a cleared decimal field remain usable', () => {
  const c = { ...original, categories: [], fields: [], filters: [], sort: [], format: { length: { decimals: NaN } } };
  const decoded = decodeQuantitiesConfig(encodeQuantitiesConfig(c));
  assert.equal(decoded.format.length.decimals, null);
  q.applyQuantitiesConfig(decoded); assert.deepEqual(q.scheduledFields(), []);
  q.applyQuantitiesConfig(original);
});
