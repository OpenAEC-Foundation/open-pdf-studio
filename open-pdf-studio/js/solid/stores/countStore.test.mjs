import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { register } from 'node:module';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { state } = await import('../../core/state.ts');
const { countTallies, countTotal, countCsvRows } = await import('./countStore.js');

const marker = (id, categoryId, extra = {}) => ({ id, type: 'count', categoryId, ...extra });
beforeEach(() => {
  state.documents = [{ annotations: [], selectedAnnotations: [], currentPage: 1 }];
  state.activeDocumentIndex = 0;
});

test('restored custom category IDs contribute to tallies, total and CSV', () => {
  state.documents[0].annotations = [marker('a', 'valves-dn100'), marker('b', 'valves-dn100'),
    marker('c', 'deuren'), marker('d', null), { id: 'box', type: 'box' }];
  assert.equal(countTotal(), 4);
  const rows = countTallies().filter(row => row.count);
  assert.deepEqual(rows.map(row => [row.id, row.count]).sort(),
    [['(geen)', 1], ['deuren', 1], ['valves-dn100', 2]]);
  assert.equal(rows.find(row => row.id === 'valves-dn100').name, 'valves-dn100');
  assert.ok(countCsvRows().includes('Telling,"valves-dn100",2,stuks,'));
});

test('custom tallies react to deletion and reassignment without stale groups', () => {
  state.documents[0].annotations = [marker('a', 'custom-a'), marker('b', 'custom-a')];
  assert.equal(countTotal(), 2);
  state.documents[0].annotations.splice(0, 1);
  assert.equal(countTotal(), 1);
  assert.equal(countTallies().find(row => row.id === 'custom-a').count, 1);
  state.documents[0].annotations[0].categoryId = 'custom-b';
  assert.equal(countTallies().some(row => row.id === 'custom-a'), false);
  assert.equal(countTallies().find(row => row.id === 'custom-b').count, 1);
});

test('switching documents derives unknown groups from only the active document', () => {
  state.documents = [{ annotations: [marker('a', 'first')] },
    { annotations: [marker('b', 'second'), marker('c', 'second')] }];
  assert.equal(countTotal(), 1);
  state.activeDocumentIndex = 1;
  assert.equal(countTotal(), 2);
  assert.equal(countTallies().some(row => row.id === 'first'), false);
  state.activeDocumentIndex = -1;
  assert.equal(countTotal(), 0);
});

test('known preset groups keep their names and are never duplicated', () => {
  state.documents[0].annotations = [marker('a', 'deuren'), marker('b', 'deuren')];
  assert.equal(countTallies().filter(row => row.id === 'deuren').length, 1);
  assert.equal(countTallies().find(row => row.id === 'deuren').name, 'Deuren');
  assert.equal(countTotal(), 2);
});

test('CSV escapes quotes in restored group IDs', () => {
  state.documents[0].annotations = [marker('a', 'Valve "A", DN100')];
  assert.deepEqual(countCsvRows(), ['Telling,"Valve ""A"", DN100",1,stuks,']);
});
