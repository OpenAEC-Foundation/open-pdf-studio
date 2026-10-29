// Tool Sets store (#311): a damaged or unreadable stored catalog is never
// replaced by an empty one.
//
// The catalog file is rewritten on every change. A file that does not parse
// (a write broken off halfway, a disk error) used to read as "no tool sets",
// and the next change then overwrote it with that empty catalog: all tool
// sets gone. Now the damaged text is first copied aside; a store that cannot
// be read at all is not written in that session. The desktop file storage is
// simulated through the Tauri invoke bridge, with one map as the catalogs
// folder; save_catalog itself writes atomically (src-tauri, atomic_file).

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();

// Browser storage that can be listed (the app's own keys get a prefix).
const opslag = new Map();
globalThis.localStorage = {
  getItem: (k) => (opslag.has(k) ? opslag.get(k) : null),
  setItem: (k, v) => { opslag.set(k, String(v)); },
  removeItem: (k) => { opslag.delete(k); },
};

const { readStoredCatalog, damagedCatalogName } = await import('../../annotations/tool-sets.js');
const { leesOpslag, schrijfOpslag } = await import('../../core/opslag.js');

// The catalogs folder of the desktop app, by catalog id.
const map = new Map();
let leesFout = null;
const opgeslagenIds = [];
function desktop() {
  globalThis.window.__TAURI__ = {
    core: {
      invoke: async (command, args) => {
        if (command === 'load_catalog') {
          if (leesFout) throw new Error(leesFout);
          return map.has(args.id) ? map.get(args.id) : null;
        }
        if (command === 'save_catalog') {
          opgeslagenIds.push(args.id);
          map.set(args.id, args.data);
          return true;
        }
        throw new Error(`unexpected command ${command}`);
      },
    },
  };
}
function browser() {
  delete globalThis.window.__TAURI__;
}

// A fresh copy of the store, as at the start of the app.
let n = 0;
const verseStore = () => import(`./toolSetsStore.js?start=${++n}`);

// Wait until a condition holds (writes are chained behind dynamic imports);
// a generous limit, no fixed short wait.
async function totDat(check, limit = 10000) {
  const end = Date.now() + limit;
  while (!check()) {
    if (Date.now() > end) assert.fail('storage did not settle');
    await new Promise((r) => setTimeout(r, 5));
  }
}

const AFGEBROKEN = '{"version":1,"sets":[{"id":"s1","name":"Walls","items":[{"id":"i1","name":"Wall 1';

test('the stored text is told apart: no catalog, a catalog, or damaged', () => {
  assert.deepEqual(readStoredCatalog(null), { ok: true, raw: null });
  assert.deepEqual(readStoredCatalog('  '), { ok: true, raw: null });
  assert.equal(readStoredCatalog('{"version":1,"sets":[]}').ok, true);
  assert.equal(readStoredCatalog('﻿{"sets":[]}').ok, true);
  assert.equal(readStoredCatalog(AFGEBROKEN).ok, false);
  assert.equal(readStoredCatalog('null').ok, false);
  assert.equal(readStoredCatalog('{"version":1}').ok, false);
  assert.equal(readStoredCatalog('[1,2]').ok, false);
  assert.equal(damagedCatalogName('opds-tool-sets', new Date('2026-10-29T10:15:00.123Z')),
    'opds-tool-sets.damaged-20261029T101500');
});

test('desktop: a damaged catalog file is kept aside before the first save', async () => {
  desktop();
  map.set('opds-tool-sets', AFGEBROKEN);
  const store = await verseStore();
  await store.ensureToolSetsLoaded();
  assert.deepEqual(store.catalog().sets, [], 'nothing usable in it');
  const kopie = [...map.keys()].find((k) => /^opds-tool-sets\.damaged-\d{8}T\d{6}$/.test(k));
  assert.ok(kopie, 'a copy of the damaged file exists');
  assert.equal(map.get(kopie), AFGEBROKEN, 'unchanged, so it can be recovered');

  await store.createToolSet('New');
  await totDat(() => readStoredCatalog(map.get('opds-tool-sets')).raw?.sets?.length === 1);
  assert.equal(map.get(kopie), AFGEBROKEN, 'the copy stays after the save');
});

test('desktop: a catalog file that cannot be read now is not overwritten', async () => {
  desktop();
  const goed = JSON.stringify({ version: 1, sets: [{ id: 's9', name: 'Keep me', items: [] }] });
  map.clear();
  map.set('opds-tool-sets', goed);
  opgeslagenIds.length = 0;
  leesFout = 'The process cannot access the file because it is being used by another process.';
  try {
    const store = await verseStore();
    await store.ensureToolSetsLoaded();
    await store.createToolSet('Other');
    await totDat(() => leesOpslag('toolSets')?.includes('Other'));
    assert.equal(map.get('opds-tool-sets'), goed, 'the file is left as it was');
    assert.ok(!opgeslagenIds.includes('opds-tool-sets'));
  } finally {
    leesFout = null;
  }
});

test('desktop: a good catalog file loads and is written again on a change', async () => {
  desktop();
  map.clear();
  map.set('opds-tool-sets', JSON.stringify({ version: 1, sets: [{ id: 's1', name: 'Walls', items: [] }] }));
  const store = await verseStore();
  await store.ensureToolSetsLoaded();
  assert.deepEqual(store.catalog().sets.map((s) => s.name), ['Walls']);
  assert.ok(![...map.keys()].some((k) => k.includes('damaged')), 'no copy of a good file');
  await store.createToolSet('Floors');
  await totDat(() => readStoredCatalog(map.get('opds-tool-sets')).raw?.sets?.length === 2);
});

test('browser: damaged stored tool sets are kept aside as well', async () => {
  browser();
  schrijfOpslag('toolSets', AFGEBROKEN);
  const store = await verseStore();
  await store.ensureToolSetsLoaded();
  assert.deepEqual(store.catalog().sets, []);
  const sleutel = [...opslag.keys()].find((k) => /toolSets\.damaged-\d{8}T\d{6}$/.test(k));
  assert.ok(sleutel, 'a copy in browser storage');
  assert.equal(opslag.get(sleutel), AFGEBROKEN);
  await store.createToolSet('New');
  await totDat(() => readStoredCatalog(leesOpslag('toolSets')).raw?.sets?.length === 1);
  assert.equal(opslag.get(sleutel), AFGEBROKEN);
});
