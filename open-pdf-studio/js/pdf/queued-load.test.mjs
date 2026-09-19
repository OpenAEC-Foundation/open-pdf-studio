// A queued file load resolves its tab when it runs, not when it was queued,
// and no open route reloads a document that is already loaded.
//
// Three layers: the pure decisions on plain arrays, the queue the app runs
// against a real Solid store, and the wiring of the routes pinned on source.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { queuedLoadTarget, documentNeedsLoad, loadIfNeeded, createFileOpenQueue } from './queued-load.js';

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

// --- The queue itself, against a real store --------------------------------
// createFileOpenQueue() is the loop the app runs (main.js only hands it the
// app's functions). Here it gets a real Solid store, the way state.documents
// is one: the store hands out proxies, and a raw object is never found in it.

// The browser build: the bare specifier resolves to the server build in node,
// and that one has no proxies.
const { createMutable } = await import(new URL('../../node_modules/solid-js/store/dist/store.js', import.meta.url).href);

// Tests that wait for a load to start: a queue that never starts it must show
// up as a failed test, not as a test run that hangs.
const WAITS = { timeout: 5000 };

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

// A small app around the queue: createTab() like tabs.js (existing tab for an
// open path, otherwise push the RAW document and return it), loadPDF() like
// loader.js (refuses a loading document, empties the one it loads into).
function app() {
  const state = createMutable({ documents: [], activeDocumentIndex: -1 });
  const log = [];
  const hold = new Map();     // filePath -> deferred the load waits for
  const started = new Map();  // filePath -> deferred resolved when the load starts
  let running = 0;
  let maxRunning = 0;

  const createTab = (filePath, autoSwitch = true) => {
    const existing = state.documents.findIndex((d) => d.filePath === filePath);
    if (existing !== -1) {
      if (autoSwitch) switchToTab(existing);
      return { doc: state.documents[existing], index: existing };
    }
    const doc = { filePath, pdfDoc: null, _isLoading: false, currentPage: 1, annotations: [], undoStack: [] };
    state.documents.push(doc);
    const index = state.documents.length - 1;
    if (autoSwitch) switchToTab(index);
    return { doc, index };
  };
  const switchToTab = (index) => {
    state.activeDocumentIndex = index;
    log.push(`switch:${state.documents[index].filePath}`);
  };
  const loadPDF = async (filePath, index) => {
    const doc = state.documents[index];
    if (!doc || doc._isLoading) return;
    doc._isLoading = true;
    running++;
    maxRunning = Math.max(maxRunning, running);
    log.push(`load:${filePath}`);
    started.get(filePath)?.resolve();
    try {
      if (hold.has(filePath)) await hold.get(filePath).promise;
      else await new Promise((r) => setTimeout(r, 0));
      if (filePath.includes('broken')) throw new Error('not a PDF');
      doc.annotations = [];
      doc.undoStack = [];
      doc.currentPage = 1;
      doc.pdfDoc = { src: filePath };
    } finally {
      doc._isLoading = false;
      running--;
    }
  };
  const openFiles = createFileOpenQueue({
    documents: () => state.documents,
    createTab,
    switchToTab,
    loadPDF,
    onLoaded: (filePath) => log.push(`recent:${filePath}`),
  });
  const tabs = () => state.documents.map((d) => `${d.filePath}=${d.pdfDoc?.src ?? '-'}`);
  return { state, log, hold, started, createTab, loadPDF, openFiles, tabs, maxRunning: () => maxRunning };
}

test('the store never finds the raw document createTab() returns', () => {
  const { state, createTab } = app();
  const { doc: raw, index } = createTab('C:/s/R1.pdf', false);
  assert.notEqual(state.documents[index], raw, 'the store hands out a proxy');
  assert.equal(queuedLoadTarget(state.documents, raw), -1);
  assert.equal(queuedLoadTarget(state.documents, state.documents[index]), index);
});

test('files open from the command line although createTab() returns raw documents', async () => {
  const { openFiles, tabs, log } = app();
  await openFiles(['C:/s/R1.pdf', 'C:/s/R2.pdf']);
  assert.deepEqual(tabs(), ['C:/s/R1.pdf=C:/s/R1.pdf', 'C:/s/R2.pdf=C:/s/R2.pdf']);
  assert.deepEqual(log, [
    'switch:C:/s/R2.pdf',
    'load:C:/s/R1.pdf', 'recent:C:/s/R1.pdf',
    'load:C:/s/R2.pdf', 'recent:C:/s/R2.pdf',
  ]);
});

test('session restore behind the user: own tab, loaded once, open work untouched', WAITS, async () => {
  const { state, openFiles, createTab, loadPDF, hold, started, tabs, log } = app();

  // The user opened R2 and U before the session restore got to its tabs, and
  // has been working in R2.
  for (const filePath of ['C:/s/R2.pdf', 'C:/u/U.pdf']) {
    const { index } = createTab(filePath);
    await loadPDF(filePath, index);
  }
  const r2 = state.documents[0];
  r2.currentPage = 7;
  r2.annotations.push({ id: 'a1' });
  r2.undoStack.push({ op: 'add', id: 'a1' });
  log.length = 0;

  // Session restore queues R1, R2 (already open) and R3 in the background.
  hold.set('C:/s/R1.pdf', deferred());
  started.set('C:/s/R1.pdf', deferred());
  const restored = openFiles(['C:/s/R1.pdf', 'C:/s/R2.pdf', 'C:/s/R3.pdf'], { activate: state.documents.length === 0 });
  assert.deepEqual(tabs(), ['C:/s/R2.pdf=C:/s/R2.pdf', 'C:/u/U.pdf=C:/u/U.pdf', 'C:/s/R1.pdf=-', 'C:/s/R3.pdf=-']);

  // While R1 is loading the user closes U (index 1): R1 and R3 shift down.
  await started.get('C:/s/R1.pdf').promise;
  assert.equal(state.documents[2]._isLoading, true, 'R1 is mid-load');
  state.documents.splice(1, 1);
  hold.get('C:/s/R1.pdf').resolve();
  await restored;

  assert.deepEqual(tabs(), ['C:/s/R2.pdf=C:/s/R2.pdf', 'C:/s/R1.pdf=C:/s/R1.pdf', 'C:/s/R3.pdf=C:/s/R3.pdf']);
  // No switch (the user keeps the tab in front), R2 neither loaded nor re-added to the recent files
  assert.deepEqual(log, ['load:C:/s/R1.pdf', 'recent:C:/s/R1.pdf', 'load:C:/s/R3.pdf', 'recent:C:/s/R3.pdf']);
  assert.equal(r2.currentPage, 7);
  assert.deepEqual(r2.annotations.map((a) => a.id), ['a1']);
  assert.equal(r2.undoStack.length, 1);
});

test('a tab closed while its load waits is skipped, the rest still opens', WAITS, async () => {
  const { state, openFiles, hold, started, tabs, log } = app();
  hold.set('C:/s/R1.pdf', deferred());
  started.set('C:/s/R1.pdf', deferred());
  const done = openFiles(['C:/s/R1.pdf', 'C:/s/R2.pdf', 'C:/s/R3.pdf']);
  await started.get('C:/s/R1.pdf').promise;
  state.documents.splice(1, 1); // R2, still a placeholder
  hold.get('C:/s/R1.pdf').resolve();
  await done;

  assert.deepEqual(tabs(), ['C:/s/R1.pdf=C:/s/R1.pdf', 'C:/s/R3.pdf=C:/s/R3.pdf']);
  assert.equal(log.includes('load:C:/s/R2.pdf'), false);
});

test('the last new tab comes to the front at once - unless the restore runs behind the user', async () => {
  const front = app();
  const done = front.openFiles(['C:/s/R1.pdf', 'C:/s/R2.pdf']);
  assert.deepEqual(front.log, ['switch:C:/s/R2.pdf'], 'before any load has run');
  await done;

  const behind = app();
  await behind.openFiles(['C:/s/R1.pdf', 'C:/s/R2.pdf'], { activate: false });
  assert.equal(behind.log.some((l) => l.startsWith('switch:')), false);
  assert.equal(behind.state.activeDocumentIndex, -1);
});

test('separate calls share one queue: loads never overlap and keep their order', async () => {
  const { openFiles, log, maxRunning } = app();
  // The single-instance plugin sends one open-files event per file.
  const calls = [openFiles(['C:/s/R1.pdf']), openFiles(['C:/s/R2.pdf']), openFiles(['C:/s/R3.pdf'])];
  await Promise.all(calls);
  assert.equal(maxRunning(), 1);
  assert.deepEqual(log.filter((l) => l.startsWith('load:')), ['load:C:/s/R1.pdf', 'load:C:/s/R2.pdf', 'load:C:/s/R3.pdf']);
});

test('a load that throws does not stall the files behind it', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const { openFiles, tabs, log } = app();
  await openFiles(['C:/s/broken.pdf', 'C:/s/R2.pdf']);
  assert.deepEqual(tabs(), ['C:/s/broken.pdf=-', 'C:/s/R2.pdf=C:/s/R2.pdf']);
  assert.equal(log.includes('recent:C:/s/broken.pdf'), false);
  assert.equal(console.warn.mock.callCount(), 1);
});

test('only PDF paths get a tab', async () => {
  const { openFiles, tabs } = app();
  await openFiles(['C:/s/notes.txt', '', null, 'C:/s/PLAN.PDF']);
  assert.deepEqual(tabs(), ['C:/s/PLAN.PDF=C:/s/PLAN.PDF']);
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

test('main.js runs the tested queue on the live document list', () => {
  const main = source('../main.js');
  const start = main.indexOf('const openFiles = createFileOpenQueue({');
  assert.notEqual(start, -1);
  const deps = main.slice(start, main.indexOf('});', start));
  // A getter on the store, read again at every step: never a copy of the list.
  assert.match(deps, /documents: \(\) => state\.documents,/);
  for (const dep of ['createTab', 'switchToTab', 'loadPDF']) assert.match(deps, new RegExp(`\\n  ${dep},\\n`));
  assert.equal(directLoads(main), 0, 'every load in main.js goes through the queue or the guard');
});
