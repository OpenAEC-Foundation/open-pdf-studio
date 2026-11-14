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

// ── Blocking 3: existing measurements follow a page scale change ────────────

function telHerberekeningen() {
  const docs = [];
  globalThis.__nep.recalculateAllMeasurements = () => { docs.push(state.documents[state.activeDocumentIndex]); };
  return docs;
}

/** Text items per page for the detection, the way pdf.js gives them. */
function metTekst(doc, perPagina) {
  doc.pdfDoc = {
    numPages: doc.pdfDoc.numPages,
    getPage: async (p) => ({ getTextContent: async () => ({ items: (perPagina[p] || []).map((str) => ({ str })) }) }),
  };
  return doc;
}

test('setting, clearing and detecting a page scale recalculates the measurements of that document', async () => {
  const [doc] = openen(metTekst(nieuwDoc(2), { 1: ['SCALE 1:50'], 2: ['SCALE 1:20'] }));
  const herberekend = telHerberekeningen();

  app.zetPaginaSchalen(doc, [1], '1:100');
  assert.equal(herberekend.length, 1, 'after set');
  assert.equal(herberekend[0], doc);

  app.zetPaginaSchalen(doc, [1], null);
  assert.equal(herberekend.length, 2, 'after clear');

  await app.detecteerPaginaSchalen(doc, [1, 2]);
  assert.deepEqual(ratios(doc), { 1: '1:50', 2: '1:20' });
  assert.equal(herberekend.length, 3, 'after detect');

  await undo.undo();
  assert.equal(herberekend.length, 4, 'after undo');
  await undo.redo();
  assert.equal(herberekend.length, 5, 'after redo');
});

test('setting the scale a page already has is no step: not modified, nothing recalculated', () => {
  const [doc] = openen(nieuwDoc(2, { 1: schaal(100) }));
  const herberekend = telHerberekeningen();
  app.zetPaginaSchalen(doc, [1], '1:100');
  assert.equal(doc.undoStack.length, 0);
  assert.equal(doc.modified, false);
  assert.equal(doc.savedUndoStackLength, 0, 'the clean point stays reachable');
  assert.equal(globalThis.__stubCalls.markDocumentModified, undefined);
  assert.equal(herberekend.length, 0);
});

// ── Blocking 5: detection that runs while the user keeps working ────────────

/** pdf.js text that only arrives when the test lets it through. */
function trageTekst(doc, perPagina) {
  const wachtend = [];
  doc.pdfDoc = {
    numPages: doc.pdfDoc.numPages,
    getPage: async (p) => ({
      getTextContent: () => new Promise((klaar) => wachtend.push(() => klaar({ items: (perPagina[p] || []).map((str) => ({ str })) }))),
    }),
  };
  async function laatDoor() {
    while (wachtend.length) { wachtend.shift()(); await new Promise((r) => setImmediate(r)); }
  }
  laatDoor.een = async () => { wachtend.shift()?.(); await new Promise((r) => setImmediate(r)); };
  return laatDoor;
}

test('detection that finishes after a tab switch records on its own document, not the active one', async () => {
  const [a, b] = openen(nieuwDoc(2), nieuwDoc(1));
  const laatDoor = trageTekst(a, { 1: ['SCALE 1:50'], 2: ['SCALE 1:20'] });
  const herberekend = telHerberekeningen();
  const bezig = app.detecteerPaginaSchalen(a, [1, 2]);
  await new Promise((r) => setImmediate(r));
  state.activeDocumentIndex = 1;   // the user switches tabs meanwhile
  await laatDoor();
  await bezig;
  assert.deepEqual(ratios(a), { 1: '1:50', 2: '1:20' });
  assert.equal(a.undoStack.length, 1, 'the step is on the detected document');
  assert.equal(a.undoStack[0].type, 'modifyPageScales');
  assert.equal(b.undoStack.length, 0, 'nothing on the active document');
  assert.equal(a.modified, true);
  // The measurements of the other document are not touched; this one's
  // are recalculated when its tab comes to the front (tabs.js).
  assert.equal(herberekend.length, 0);
  assert.equal(a._metingenHerberekenen, true);
});

test('detection keeps a scale the user set by hand while it was running', async () => {
  const [doc] = openen(nieuwDoc(2));
  const laatDoor = trageTekst(doc, { 1: ['SCALE 1:50'], 2: ['SCALE 1:20'] });
  const bezig = app.detecteerPaginaSchalen(doc, [1, 2]);
  await new Promise((r) => setImmediate(r));
  app.zetPaginaSchalen(doc, [2], '1:5');   // typed on the thumbnail meanwhile
  await laatDoor();
  await bezig;
  assert.deepEqual(ratios(doc), { 1: '1:50', 2: '1:5' });
  // Undo of the detection gives back the hand-set scale, not the state from before both.
  await undo.undo();
  assert.deepEqual(ratios(doc), { 2: '1:5' });
});

test('detection stops without a change when the document was reloaded or closed meanwhile', async () => {
  const [doc] = openen(nieuwDoc(2));
  const laatDoor = trageTekst(doc, { 1: ['SCALE 1:50'], 2: ['SCALE 1:20'] });
  const bezig = app.detecteerPaginaSchalen(doc, [1, 2]);
  await new Promise((r) => setImmediate(r));
  doc.pdfDoc = { numPages: 2 };   // a page operation reloaded the document
  await laatDoor();
  const uit = await bezig;
  assert.equal(uit.afgebroken, true);
  assert.equal(doc.pageScales, null);
  assert.equal(doc.undoStack.length, 0);

  const [doc2] = openen(nieuwDoc(1));
  const laatDoor2 = trageTekst(doc2, { 1: ['SCALE 1:50'] });
  const bezig2 = app.detecteerPaginaSchalen(doc2, [1]);
  await new Promise((r) => setImmediate(r));
  state.documents = [];   // the tab was closed
  state.activeDocumentIndex = -1;
  await laatDoor2();
  assert.equal((await bezig2).afgebroken, true);
  assert.equal(doc2.pageScales, null);
});

// ── Progress and cancel ─────────────────────────────────────────────────────

test('detection shows its progress per page and Cancel applies nothing', async () => {
  const [doc] = openen(nieuwDoc(3));
  const laatDoor = trageTekst(doc, { 1: ['SCALE 1:50'], 2: ['SCALE 1:20'], 3: ['SCALE 1:5'] });
  const getoond = [];
  let annuleer = null;
  globalThis.__nep.showLoading = (bericht, { voortgang, annuleren }) => { getoond.push(voortgang); annuleer = annuleren; };
  const bezig = app.detecteerMetVoortgang(doc, [1, 2, 3]);
  await new Promise((r) => setImmediate(r));
  assert.equal(typeof annuleer, 'function', 'a Cancel button');
  // First page through, then the user cancels.
  await laatDoor.een();
  annuleer();
  await laatDoor();
  const uit = await bezig;
  assert.equal(uit.afgebroken, true);
  assert.equal(doc.pageScales, null);
  assert.equal(doc.undoStack.length, 0);
  assert.ok(getoond.length >= 2 && getoond[0] === 0, `progress shown: ${getoond}`);
  assert.equal(globalThis.__stubCalls.hideLoading, 1);
});

test('detection with progress runs to the end and reports what it found', async () => {
  const [doc] = openen(metTekst(nieuwDoc(3), { 1: ['SCALE 1:50'], 2: ['no scale here'], 3: ['SCALE 1:5'] }));
  const getoond = [];
  globalThis.__nep.showLoading = (bericht, { voortgang }) => { getoond.push(voortgang); };
  const uit = await app.detecteerMetVoortgang(doc, [1, 2, 3]);
  assert.equal(uit.gevonden, 2);
  assert.deepEqual(uit.zonder, [2]);
  assert.deepEqual(ratios(doc), { 1: '1:50', 3: '1:5' });
  assert.equal(getoond.at(-1), 1);
  assert.equal(globalThis.__stubCalls.hideLoading, 1);
});

test('detection from a drawn box: progress after the box, Cancel applies nothing', async () => {
  const [doc] = openen(nieuwDoc(2, { 2: schaal(10) }));
  globalThis.__nep.kiesLabelGebied = async () => ({ rect: { x: 0, y: 0, width: 10, height: 10 }, page: 1 });
  let annuleer = null;
  globalThis.__nep.showLoading = (bericht, { annuleren }) => { annuleer = annuleren; };
  globalThis.__nep.leesAllePaginas = async (d, gebieden, { bijVoortgang, isAfgebroken }) => {
    const rijen = [];
    for (let p = 1; p <= 2; p++) {
      if (isAfgebroken()) break;
      rijen.push({ page: p, teksten: { 1: p === 1 ? '1 : 100' : 'SCALE 1:50' }, ocr: false });
      bijVoortgang(p, 2);
      if (p === 1) annuleer();
    }
    return rijen;
  };
  const uit = await app.detecteerUitGebiedMetVoortgang(doc, 'hint');
  assert.equal(uit.afgebroken, true);
  assert.deepEqual(ratios(doc), { 2: '1:10' });

  annuleer = null;
  globalThis.__nep.leesAllePaginas = async () => [
    { page: 1, teksten: { 1: '1 : 100' }, ocr: false },
    { page: 2, teksten: { 1: 'SCALE 1:50' }, ocr: true },
  ];
  const klaar = await app.detecteerUitGebiedMetVoortgang(doc, 'hint');
  assert.equal(klaar.gevonden, 2);
  assert.deepEqual(ratios(doc), { 1: '1:100', 2: '1:50' });
  assert.equal(doc.pageScales[2].method, 'ocr');
});
