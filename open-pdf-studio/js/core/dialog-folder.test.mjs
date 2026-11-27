// Start folder of the Open and Save As dialogs (#1245): Open starts where the
// user last opened or saved, Save As of a document without a file of its own
// starts in the folder of the last Save As.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const winkel = new Map();
globalThis.localStorage = {
  getItem: (k) => (winkel.has(k) ? winkel.get(k) : null),
  setItem: (k, v) => { winkel.set(k, String(v)); },
  removeItem: (k) => { winkel.delete(k); },
};
globalThis.window = {};

const {
  LAST_SAVE_FOLDER_NAME, folderOf, openStartFolder, saveAsStartFolder, readLastSaveFolder, rememberSaveFolder,
} = await import('./dialog-folder.js');
const { opslagSleutel } = await import('./opslag.js');

const source = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the folder of a file, with either kind of slash', () => {
  assert.equal(folderOf('C:\\Projects\\A\\plan.pdf'), 'C:\\Projects\\A');
  assert.equal(folderOf('C:/Projects/A/plan.pdf'), 'C:/Projects/A');
  assert.equal(folderOf('/home/me/docs/plan.pdf'), '/home/me/docs');
  assert.equal(folderOf('\\\\server\\share\\plan.pdf'), '\\\\server\\share');
});

test('a file directly in a root keeps the root', () => {
  assert.equal(folderOf('C:\\plan.pdf'), 'C:\\');
  assert.equal(folderOf('D:/plan.pdf'), 'D:/');
  assert.equal(folderOf('/plan.pdf'), '/');
});

test('what is not a file path has no folder', () => {
  assert.equal(folderOf('plan.pdf'), null);
  assert.equal(folderOf('__memory__abc/def'), null);
  assert.equal(folderOf('content://com.android.providers/document/42'), null);
  assert.equal(folderOf('https://example.org/files/plan.pdf'), null);
  assert.equal(folderOf(''), null);
  assert.equal(folderOf(null), null);
  assert.equal(folderOf(undefined), null);
});

test('Open starts in the folder of the most recently opened file', () => {
  const recents = [
    { path: 'C:\\Old\\a.pdf', timestamp: 100 },
    { path: 'C:\\New\\b.pdf', timestamp: 300 },
    { path: 'C:\\Mid\\c.pdf', timestamp: 200, pinned: true },
  ];
  assert.equal(openStartFolder(recents, null), 'C:\\New');
  // The list itself is not reordered.
  assert.equal(recents[0].path, 'C:\\Old\\a.pdf');
});

test('a Save As after the last open wins, an older one does not', () => {
  const recents = [{ path: 'C:\\Opened\\a.pdf', timestamp: 300 }];
  assert.equal(openStartFolder(recents, { dir: 'D:\\Saved', t: 400 }), 'D:\\Saved');
  assert.equal(openStartFolder(recents, { dir: 'D:\\Saved', t: 200 }), 'C:\\Opened');
  assert.equal(openStartFolder([], { dir: 'D:\\Saved', t: 1 }), 'D:\\Saved');
});

test('without anything known the dialog gets no start folder', () => {
  assert.equal(openStartFolder([], null), undefined);
  assert.equal(openStartFolder(null, undefined), undefined);
  assert.equal(openStartFolder([{ path: 'plan.pdf', timestamp: 5 }], { dir: '', t: 9 }), undefined);
});

test('recent entries without a folder are skipped, not chosen', () => {
  const recents = [
    { path: 'upload.pdf', timestamp: 900 },
    { path: 'C:\\Docs\\a.pdf', timestamp: 100 },
    null,
    { timestamp: 950 },
  ];
  assert.equal(openStartFolder(recents, null), 'C:\\Docs');
});

test('Save As of a document without a file: suggestion, last Save As, fallback', () => {
  const lastSave = { dir: 'D:\\Saved', t: 4 };
  assert.equal(saveAsStartFolder({ suggested: 'E:\\Signed', lastSave, fallback: 'C:\\Users\\me\\Documents' }), 'E:\\Signed');
  assert.equal(saveAsStartFolder({ lastSave, fallback: 'C:\\Users\\me\\Documents' }), 'D:\\Saved');
  assert.equal(saveAsStartFolder({ lastSave: null, fallback: 'C:\\Users\\me\\Documents' }), 'C:\\Users\\me\\Documents');
  assert.equal(saveAsStartFolder({ lastSave: { dir: 42 } }), null);
  assert.equal(saveAsStartFolder(), null);
});

test('the folder of a Save As is stored and read back', () => {
  winkel.clear();
  assert.equal(readLastSaveFolder(), null);
  assert.equal(rememberSaveFolder('D:\\Out\\Final\\plan.pdf', 1234), true);
  assert.deepEqual(readLastSaveFolder(), { dir: 'D:\\Out\\Final', t: 1234 });
  assert.equal(winkel.has(opslagSleutel(LAST_SAVE_FOLDER_NAME)), true, 'under the app prefix');
  // A later Save As replaces it.
  rememberSaveFolder('E:/Other/b.pdf', 2000);
  assert.deepEqual(readLastSaveFolder(), { dir: 'E:/Other', t: 2000 });
});

test('a path without a folder records nothing and keeps what was there', () => {
  winkel.clear();
  rememberSaveFolder('D:\\Out\\plan.pdf', 10);
  assert.equal(rememberSaveFolder('download.pdf', 20), false);
  assert.equal(rememberSaveFolder('content://provider/doc/1', 30), false);
  assert.deepEqual(readLastSaveFolder(), { dir: 'D:\\Out', t: 10 });
});

test('a damaged entry in storage reads as nothing', () => {
  winkel.clear();
  winkel.set(opslagSleutel(LAST_SAVE_FOLDER_NAME), '{"dir":7}');
  assert.equal(readLastSaveFolder(), null);
  winkel.set(opslagSleutel(LAST_SAVE_FOLDER_NAME), 'not json');
  assert.equal(readLastSaveFolder(), null);
});

test('a full storage does not break saving', () => {
  const setItem = globalThis.localStorage.setItem;
  const warn = console.warn;
  globalThis.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  console.warn = () => {};
  try {
    assert.equal(rememberSaveFolder('D:\\Out\\plan.pdf', 10), false);
  } finally {
    globalThis.localStorage.setItem = setItem;
    console.warn = warn;
  }
});

// ── wiring ──────────────────────────────────────────────────────────────────

test('File > Open asks this module for its start folder', () => {
  const loader = source('../pdf/loader.js');
  const start = loader.indexOf('export async function openPDFFile(');
  const body = loader.slice(start, loader.indexOf('\nexport ', start + 1));
  assert.match(body, /defaultPath = openStartFolder\(getRecentFiles\(\), readLastSaveFolder\(\)\)/);
  assert.match(body, /openFileDialog\(\['pdf', 'dwg', 'dxf'\], \{ defaultPath, multiple: true \}\)/);
});

test('Save As records the chosen folder on the desktop only, and offers it to a document without a file', () => {
  const saver = source('../pdf/saver.js');
  const start = saver.indexOf('export async function savePDFAs(');
  const body = saver.slice(start, saver.indexOf('\nexport ', start + 1));
  // Only a folder picked in the dialog counts, not a path given by a caller.
  assert.match(body, /if \(success && !explicitPath && isTauri\(\)\) \{\s*try \{\s*\(await import\('\.\.\/core\/dialog-folder\.js'\)\)\.rememberSaveFolder\(savePath\);/);
  assert.match(body, /map = saveAsStartFolder\(\{ lastSave: readLastSaveFolder\(\) \}\);/);
  // The Documents folder stays the fallback.
  assert.match(body, /if \(!map\) \{\s*try \{ map = await window\.__TAURI__\?\.path\?\.documentDir\?\.\(\); \}/);
});
