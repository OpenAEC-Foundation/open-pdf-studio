// Reader Mode storage: the sidecar next to the PDF (desktop) or a
// localStorage entry (browser). Covers read, write, and — what makes
// "tracking off" stick — removal.

import assert from 'node:assert/strict';
import test from 'node:test';

// Browser stand-ins, installed before the module under test is imported.
const store = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  },
});
globalThis.window = {};

const { getReaderPosition, saveReaderPosition, clearReaderPosition } = await import('./reader-mode.js');

const FILE = 'C:/docs/book.pdf';
const POS = { page: 7, scale: 2, scrollTop: 100, scrollHeight: 1000, viewMode: 'single' };

/** A minimal in-memory stand-in for the desktop fs plugin. */
function desktopFs({ readOnly = false } = {}) {
  const files = new Map();
  const fs = {
    files,
    readFile: async (p) => { if (!files.has(p)) throw new Error('not found: ' + p); return files.get(p); },
    writeFile: async (p, data) => { if (readOnly) throw new Error('access denied'); files.set(p, data); },
    exists: async (p) => files.has(p),
    remove: async (p) => { if (readOnly) throw new Error('access denied'); if (!files.delete(p)) throw new Error('not found: ' + p); },
  };
  return fs;
}

test('browser: nothing stored means no position', async () => {
  store.clear();
  assert.equal(await getReaderPosition(FILE), null);
  assert.equal(await getReaderPosition(''), null);
});

test('browser: a saved position is read back', async () => {
  store.clear();
  assert.equal(await saveReaderPosition(FILE, POS), true);
  const saved = await getReaderPosition(FILE);
  assert.equal(saved.page, 7);
  assert.equal(saved.scale, 2);
  assert.equal(typeof saved.savedAt, 'number');
});

test('browser: clearing removes the position, so the next open starts untracked', async () => {
  store.clear();
  await saveReaderPosition(FILE, POS);
  await saveReaderPosition('C:/docs/other.pdf', POS);
  assert.equal(await clearReaderPosition(FILE), true);
  assert.equal(await getReaderPosition(FILE), null);
  // Only that one file is forgotten.
  assert.equal((await getReaderPosition('C:/docs/other.pdf')).page, 7);
});

test('no path: saving reports failure, clearing has nothing to do', async () => {
  assert.equal(await saveReaderPosition(null, POS), false);
  assert.equal(await clearReaderPosition(null), true);
});

test('desktop: the position lives in a sidecar next to the PDF', async () => {
  const fs = desktopFs();
  globalThis.window = { __TAURI__: { fs } };
  try {
    assert.equal(await getReaderPosition(FILE), null);
    assert.equal(await saveReaderPosition(FILE, POS), true);
    assert.deepEqual([...fs.files.keys()], [FILE + '.readerpos.json']);
    assert.equal((await getReaderPosition(FILE)).page, 7);
  } finally {
    globalThis.window = {};
  }
});

test('desktop: clearing deletes the sidecar; clearing again is still fine', async () => {
  const fs = desktopFs();
  globalThis.window = { __TAURI__: { fs } };
  try {
    await saveReaderPosition(FILE, POS);
    assert.equal(await clearReaderPosition(FILE), true);
    assert.equal(fs.files.size, 0);
    assert.equal(await getReaderPosition(FILE), null);
    assert.equal(await clearReaderPosition(FILE), true);
  } finally {
    globalThis.window = {};
  }
});

test('desktop: a read-only folder is reported instead of thrown', async (t) => {
  const fs = desktopFs({ readOnly: true });
  fs.files.set(FILE + '.readerpos.json', new TextEncoder().encode(JSON.stringify(POS)));
  globalThis.window = { __TAURI__: { fs } };
  t.mock.method(console, 'warn', () => {});
  try {
    assert.equal(await saveReaderPosition(FILE, POS), false);
    assert.equal(await clearReaderPosition(FILE), false);
    // The sidecar that could not be removed is still readable.
    assert.equal((await getReaderPosition(FILE)).page, 7);
  } finally {
    globalThis.window = {};
  }
});
