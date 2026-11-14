// Page scales in the app (#1065): undo and redo, recalculation of existing
// measurements, and detection that runs while the user keeps working.
//
// The real undo-manager, state store and pagina-schalen-app; the page
// manager, the measurement module, the tab bar, OCR and the loading overlay
// are stubs whose behaviour the tests set through globalThis.__nep.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url, {
  data: {
    extraStubs: [
      '/js/pdf/page-manager.js',
      '/js/annotations/measurement.js',
      '/js/ui/chrome/tabs.js',
      '/js/ui/chrome/dialogs.js',
      '/js/pdf/ocr-engines.js',
      '/js/pdf/pagina-labels-app.js',
      '/js/tools/tools/label-gebied-tool.js',
    ],
  },
});
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('../core/state.ts');
const undo = await import('../core/undo-manager.js');
const app = await import('./pagina-schalen-app.js');

const schaal = (r, method = 'manual') => ({ scaleRatio: `1:${r}`, unit: 'mm', method });

function nieuwDoc(numPages, pageScales = null, extra = {}) {
  return {
    id: `doc-${Math.random().toString(36).slice(2, 8)}`, filePath: null,
    pdfDoc: { numPages }, currentPage: 1, scale: 1, viewMode: 'single', annotations: [],
    selectedAnnotation: null, selectedAnnotations: [],
    undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
    textEdits: [], watermarks: [], bookmarks: [], pageRotations: {}, measureScale: null,
    pageScales, ...extra,
  };
}

function openen(...docs) {
  state.documents = docs;
  state.activeDocumentIndex = 0;
  return state.documents;
}

const kloon = (x) => JSON.parse(JSON.stringify(x));
const ratios = (doc) => Object.fromEntries(Object.entries(doc.pageScales || {}).map(([p, s]) => [p, s.scaleRatio]));

beforeEach(() => {
  globalThis.__nep = {};
  globalThis.__stubCalls = {};
});

// ── Blocking 1: undo/redo of a page operation ───────────────────────────────

test('undo and redo of a page deletion put the page scales back on the right pages', async () => {
  const [doc] = openen(nieuwDoc(3, { 1: schaal(100), 2: schaal(20), 3: schaal(5) }));
  // What reloadFromBytes does: restorePageState reloads without a mapping.
  globalThis.__nep.restorePageState = async () => { app.schalenNaHerladen(state.documents[0], null); };

  // Delete page 2, the way page-manager.js does it: reload with a mapping,
  // then record the page structure step.
  app.schalenNaHerladen(doc, { 1: 1, 2: null, 3: 2 });
  doc.pdfDoc = { numPages: 2 };
  assert.deepEqual(ratios(doc), { 1: '1:100', 2: '1:5' });
  undo.recordPageStructure(new Uint8Array(), [], {}, 2, new Uint8Array(), [], {}, 2);

  doc.pdfDoc = { numPages: 3 };
  await undo.undo();
  assert.deepEqual(ratios(state.documents[0]), { 1: '1:100', 2: '1:20', 3: '1:5' });

  doc.pdfDoc = { numPages: 2 };
  await undo.redo();
  assert.deepEqual(ratios(state.documents[0]), { 1: '1:100', 2: '1:5' });
});

test('a page operation without a mapping (crop) keeps the page scales through undo', async () => {
  const [doc] = openen(nieuwDoc(2, { 2: schaal(50) }));
  globalThis.__nep.restorePageState = async () => { app.schalenNaHerladen(state.documents[0], null); };
  app.schalenNaHerladen(doc, null);
  undo.recordPageStructure(new Uint8Array(), [], {}, 1, new Uint8Array(), [], {}, 1);
  await undo.undo();
  assert.deepEqual(ratios(state.documents[0]), { 2: '1:50' });
  await undo.redo();
  assert.deepEqual(ratios(state.documents[0]), { 2: '1:50' });
});
