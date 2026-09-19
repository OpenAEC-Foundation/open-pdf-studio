// A queued file load resolves its tab when it runs, not when it was queued,
// and never reloads a document that is already loaded.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { queuedLoadTarget, documentNeedsLoad, loadIfNeeded } from './queued-load.js';

const placeholder = (filePath) => ({ filePath, pdfDoc: null, _isLoading: false });

// What loadPDF() does to the document it loads into (loader.js, "Reset
// annotation state"): the reason a loaded document must never be loaded again.
const loadLikeLoadPDF = (doc, calls) => async () => {
  calls.push(doc.filePath);
  doc._isLoading = true;
  await new Promise((r) => setTimeout(r, 0));
  doc.annotations = [];
  doc.undoStack = [];
  doc.redoStack = [];
  doc.currentPage = 1;
  doc.pdfDoc = { src: doc.filePath };
  doc._isLoading = false;
};

// An open document the user has been working in.
const edited = (filePath) => ({
  filePath,
  pdfDoc: { src: filePath },
  _isLoading: false,
  modified: true,
  currentPage: 7,
  annotations: [{ id: 'a1' }, { id: 'a2' }],
  undoStack: [{ op: 'add', id: 'a2' }],
  redoStack: [],
});

test('a fresh placeholder tab loads into its own index', () => {
  const docs = [placeholder('C:/s/R1.pdf'), placeholder('C:/s/R2.pdf')];
  assert.equal(queuedLoadTarget(docs, docs[0]), 0);
  assert.equal(queuedLoadTarget(docs, docs[1]), 1);
});

test('a document that is already loaded is not loaded again', () => {
  const docs = [placeholder('C:/s/R1.pdf'), { ...placeholder('C:/s/R2.pdf'), pdfDoc: { numPages: 12 } }];
  assert.equal(queuedLoadTarget(docs, docs[1]), -1);
});

test('a document that is loading through another route is left alone', () => {
  const docs = [{ ...placeholder('C:/s/R1.pdf'), _isLoading: true }];
  assert.equal(queuedLoadTarget(docs, docs[0]), -1);
});

test('a failed earlier load (no pdfDoc, not loading) is retried', () => {
  const docs = [{ ...placeholder('C:/s/R1.pdf'), pdfDoc: null, _isLoading: false }];
  assert.equal(queuedLoadTarget(docs, docs[0]), 0);
});

test('a tab closed while waiting in the queue is skipped', () => {
  const docs = [placeholder('C:/s/R1.pdf'), placeholder('C:/s/R2.pdf')];
  const closed = docs[0];
  docs.splice(0, 1);
  assert.equal(queuedLoadTarget(docs, closed), -1);
});

test('closing an earlier tab shifts the index of the queued ones', () => {
  const docs = [placeholder('C:/u/U.pdf'), placeholder('C:/s/R1.pdf'), placeholder('C:/s/R2.pdf')];
  const [, r1, r2] = docs;
  docs.splice(0, 1);
  assert.equal(queuedLoadTarget(docs, r1), 0);
  assert.equal(queuedLoadTarget(docs, r2), 1);
});

test('dragging a tab to another position is followed', () => {
  const docs = [placeholder('C:/s/R1.pdf'), placeholder('C:/s/R2.pdf'), placeholder('C:/s/R3.pdf')];
  const r3 = docs[2];
  const [moved] = docs.splice(2, 1);
  docs.splice(0, 0, moved);
  assert.equal(queuedLoadTarget(docs, r3), 0);
});

test('missing arguments never produce an index', () => {
  assert.equal(queuedLoadTarget(null, placeholder('C:/s/R1.pdf')), -1);
  assert.equal(queuedLoadTarget([], null), -1);
  assert.equal(queuedLoadTarget([], undefined), -1);
});

// The scenario end to end, with the queue shape openFiles() uses: tabs are
// created first, loads run one by one, the user acts in between.
test('queue run: every file ends up in its own tab, loaded exactly once', async () => {
  const docs = [];
  const loads = [];
  const open = (filePath) => {
    let doc = docs.find((d) => d.filePath === filePath);
    if (!doc) { doc = placeholder(filePath); docs.push(doc); }
    return doc;
  };
  const load = async (filePath, index) => {
    const doc = docs[index];
    doc._isLoading = true;
    await new Promise((r) => setTimeout(r, 0));
    doc.pdfDoc = { src: filePath };
    doc._isLoading = false;
    loads.push(filePath);
  };

  // The user opened R2 and U before the session restore got to its tabs.
  const r2 = open('C:/s/R2.pdf');
  await load('C:/s/R2.pdf', docs.indexOf(r2));
  r2.currentPage = 7;
  const u = open('C:/u/U.pdf');
  await load('C:/u/U.pdf', docs.indexOf(u));

  // Session restore queues R1, R2 (already open) and R3.
  const queued = ['C:/s/R1.pdf', 'C:/s/R2.pdf', 'C:/s/R3.pdf'].map((filePath) => ({ filePath, doc: open(filePath) }));
  let queue = Promise.resolve();
  for (const { filePath, doc } of queued) {
    queue = queue.then(async () => {
      const index = queuedLoadTarget(docs, doc);
      if (index === -1) return;
      await load(filePath, index);
    });
  }
  // While R1 loads the user closes U (index 1): R1 and R3 shift down.
  docs.splice(docs.indexOf(u), 1);
  await queue;

  assert.deepEqual(docs.map((d) => `${d.filePath}=${d.pdfDoc?.src}`), [
    'C:/s/R2.pdf=C:/s/R2.pdf',
    'C:/s/R1.pdf=C:/s/R1.pdf',
    'C:/s/R3.pdf=C:/s/R3.pdf',
  ]);
  assert.equal(loads.filter((f) => f === 'C:/s/R2.pdf').length, 1);
  assert.equal(r2.currentPage, 7);
});

// --- Every route that opens a file by path -------------------------------
// createTab() returns the existing tab for a path that is already open, so
// File > Open, recent files, places, drag and drop and saved sessions all land
// on a loaded document when the user opens a file a second time.

test('opening a file that is already open keeps its unsaved work', async () => {
  const docs = [edited('C:/p/plan.pdf')];
  const calls = [];
  const ran = await loadIfNeeded(docs, 0, loadLikeLoadPDF(docs[0], calls));

  assert.equal(ran, false);
  assert.deepEqual(calls, [], 'the file is not read again');
  assert.equal(docs[0].currentPage, 7);
  assert.deepEqual(docs[0].annotations.map((a) => a.id), ['a1', 'a2']);
  assert.equal(docs[0].undoStack.length, 1);
  assert.equal(docs[0].modified, true);
});

test('a new tab is loaded, and only once when the route fires twice', async () => {
  const docs = [placeholder('C:/p/plan.pdf')];
  const calls = [];
  const load = loadLikeLoadPDF(docs[0], calls);
  // Two drops of the same file in a row: the second one finds the first load running.
  const [first, second] = await Promise.all([loadIfNeeded(docs, 0, load), loadIfNeeded(docs, 0, load)]);

  assert.deepEqual([first, second], [true, false]);
  assert.deepEqual(calls, ['C:/p/plan.pdf']);
  assert.equal(await loadIfNeeded(docs, 0, load), false, 'and a third time finds it loaded');
  assert.deepEqual(calls, ['C:/p/plan.pdf']);
});

test('a tab whose earlier load failed is loaded again', async () => {
  const docs = [placeholder('C:/p/plan.pdf')];
  const calls = [];
  assert.equal(await loadIfNeeded(docs, 0, loadLikeLoadPDF(docs[0], calls)), true);
  assert.equal(docs[0].pdfDoc.src, 'C:/p/plan.pdf');
});

test('no tab at that index means no load', async () => {
  const calls = [];
  const load = async () => { calls.push('x'); };
  assert.equal(await loadIfNeeded([], 0, load), false);
  assert.equal(await loadIfNeeded(null, 0, load), false);
  assert.equal(await loadIfNeeded([placeholder('C:/p/a.pdf')], 3, load), false);
  assert.deepEqual(calls, []);
});

test('documentNeedsLoad: only an empty tab that is not loading', () => {
  assert.equal(documentNeedsLoad(placeholder('C:/p/a.pdf')), true);
  assert.equal(documentNeedsLoad({ ...placeholder('C:/p/a.pdf'), pdfDoc: {} }), false);
  assert.equal(documentNeedsLoad({ ...placeholder('C:/p/a.pdf'), _isLoading: true }), false);
  assert.equal(documentNeedsLoad(null), false);
  assert.equal(documentNeedsLoad(undefined), false);
});

// The routes themselves live in modules that need the DOM and the Tauri
// runtime, so their wiring is pinned on the source: a route that opens a file
// by path goes through loadPDFIfNeeded(), never straight to loadPDF().
// Line endings evened out: a Windows checkout with autocrlf has CRLF on disk.
const source = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8').split('\r\n').join('\n');
const directLoads = (text) => (text.match(/(?<![\w.])loadPDF\(/g) || []).length;

test('loader.js wraps the guard around loadPDF for the live document list', () => {
  const loader = source('./loader.js');
  const start = loader.indexOf('export function loadPDFIfNeeded(');
  assert.notEqual(start, -1);
  const body = loader.slice(start, loader.indexOf('\n}\n', start));
  assert.match(body, /loadIfNeeded\(state\.documents, docIndex, \(\) => loadPDF\(filePath, docIndex, preloadedData\)\)/);
});

test('File > Open does not reload a file that is already open', () => {
  const loader = source('./loader.js');
  const start = loader.indexOf('export async function openPDFFile(');
  assert.notEqual(start, -1);
  const body = loader.slice(start, loader.indexOf('\nexport ', start + 1));
  assert.match(body, /createTab\(path\)/);
  assert.match(body, /await loadPDFIfNeeded\(path, index\)/);
  assert.equal(directLoads(body), 0);
});

for (const [name, file, routes] of [
  ['recent files, places and open-from-URL', '../solid/components/app-menu/OpenPanel.jsx', 3],
  ['drag and drop', '../ui/setup.js', 2],
  ['saved sessions', '../stores/sessions.js', 1],
]) {
  test(`${name}: every open route is guarded`, () => {
    const text = source(file);
    assert.equal(directLoads(text), 0, 'no direct loadPDF() call left');
    assert.equal((text.match(/await loadPDFIfNeeded\(/g) || []).length, routes);
    assert.equal((text.match(/createTab\(/g) || []).length, routes, 'one guarded load per createTab()');
  });
}

test('mobile: the picker and the deep link are guarded, the in-memory route is not', () => {
  const mobile = source('../solid/MobileApp.jsx');
  assert.match(mobile, /if \(await loadPDFIfNeeded\(path, index\)\) await fitPage\(\);/);
  // <input type=file> has no path, only a display name and the bytes: two
  // different files may share that name, so this one always loads.
  assert.equal(directLoads(mobile), 1);
  assert.match(mobile, /await loadPDF\(file\.name, index, data\);/);

  const main = source('../main.js');
  assert.match(main, /if \(await loadPDFIfNeeded\(filePath, index\)\) await fitPage\(\);/);
});
