import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

// Execute the production save functions with controlled I/O. The app imports
// require a webview; only those dependencies and dynamic imports are replaced.
const source = readFileSync(new URL('./saver.js', import.meta.url), 'utf8');
const functions = source.slice(source.indexOf('let _saveBezig = null;'))
  .replaceAll('export async function', 'async function')
  .replaceAll('await import(', 'await loadModule(');
const tabs = readFileSync(new URL('../ui/chrome/tabs.js', import.meta.url), 'utf8');
const saved = tabs.slice(tabs.indexOf('export function markDocumentSaved'), tabs.indexOf('\n/**', tabs.indexOf('export function markDocumentSaved')))
  .replace('export function', 'function');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function harness() {
  const a = { id: 'a', pdfDoc: {}, filePath: 'a.pdf', annotations: [], modified: true, undoStack: [] };
  const b = { id: 'b', pdfDoc: {}, filePath: 'b.pdf', annotations: [], modified: true, undoStack: [] };
  let active = a;
  const writes = [], owners = [];
  const deps = {
    state: { documents: [a, b] }, getActiveDocument: () => active,
    showLoading() {}, hideLoading() {}, updateTabBar() {}, updateWindowTitle() {},
    getCachedPdfBytes: path => new TextEncoder().encode(path), setCachedPdfBytes() {},
    PDFDocument: { load: async bytes => ({ context: { largestObjectNumber: 1 }, getPages: () => [], catalog: { get: () => null }, save: async () => bytes }) },
    PDFName: { of: x => x }, KNIPSEL_CATALOGUS: 'snippets',
    getAnnotationStorage: doc => { owners.push(doc); return null; },
    getAnnotIdToFieldName: doc => { owners.push(doc); return new Map(); },
    schrijfAnnotatieLagen() {}, layersForSave: doc => { owners.push(doc); return []; }, currentLayerId() {},
    saveTextEditsToPages: async (_pdf, _pages, doc) => owners.push(doc),
    saveWatermarksToPages: async (_pdf, _pages, doc) => owners.push(doc),
    saveBookmarksToOutline: (_pdf, doc) => owners.push(doc), saveStylePresetsToCatalog() {},
    unlockFile: async () => {}, lockFile: async () => {},
    writeBinaryFileAtomic: async (path, bytes) => { writes.push({ path, source: new TextDecoder().decode(bytes) }); },
    isTauri: () => false, markeerGebakken() {}, hidePdfABar() {}, stripPdfAMetadata() {},
    i18next: { t: x => x }, showMessage() {}, window: {},
    console: { error() {}, warn() {} },
    saveFileDialog: async () => 'copy.pdf',
    loadModule: async path => {
      if (path.includes('verificatie')) return { bevestigOpslaanMetHandtekeningen: async () => true };
      if (path.includes('opslaan')) return { moetOpnieuwVerifieren: () => false, opslaanAlsStandaardPad: doc => doc.filePath };
      if (path.includes('cad-import')) return { isVoorbeeldPdf: () => false };
      if (path.includes('document-release')) return { losgelatenWerkbestanden: () => [], ruimWerkbestandenOp: async () => {} };
      throw new Error(`Unexpected import: ${path}`);
    },
  };
  // A with scope keeps the injected dependencies mutable across awaits.
  const api = new Function('deps', `with (deps) { ${saved}\n${functions}\n return {savePDF, savePDFAs}; }`)(deps);
  return { a, b, deps, api, writes, owners, switchToB: () => { active = b; } };
}

test('tab switch during signature verification still saves A to the requested path', async () => {
  const h = harness(), gate = deferred(), entered = deferred();
  const original = h.deps.loadModule;
  h.deps.loadModule = async path => path.includes('verificatie')
    ? { bevestigOpslaanMetHandtekeningen: async () => { entered.resolve(); return gate.promise; } }
    : original(path);
  const saving = h.api.savePDF('copy-of-a.pdf');
  await entered.promise;
  h.switchToB(); gate.resolve(true);
  assert.equal(await saving, true);
  assert.deepEqual(h.writes, [{ path: 'copy-of-a.pdf', source: 'a.pdf' }]);
  assert.ok(h.owners.every(doc => doc === h.a));
  assert.equal(h.a.modified, false);
  assert.equal(h.b.modified, true);
});

test('tab switch during parsing keeps all serialization helpers and clean state on A', async () => {
  const h = harness(), entered = deferred(), gate = deferred();
  const load = h.deps.PDFDocument.load;
  h.deps.PDFDocument.load = async bytes => { entered.resolve(); await gate.promise; return load(bytes); };
  const saving = h.api.savePDF(null, { zonderHandtekeningVraag: true });
  await entered.promise; h.switchToB(); gate.resolve();
  assert.equal(await saving, true);
  assert.ok(h.owners.every(doc => doc === h.a));
  assert.equal(h.b.modified, true);
});

test('queued save remains bound to A after switching to B', async () => {
  const h = harness(), entered = deferred(), gate = deferred();
  const write = h.deps.writeBinaryFileAtomic;
  let calls = 0;
  h.deps.writeBinaryFileAtomic = async (...args) => {
    if (++calls === 1) { entered.resolve(); await gate.promise; }
    return write(...args);
  };
  const first = h.api.savePDF(null, { zonderHandtekeningVraag: true });
  await entered.promise;
  const second = h.api.savePDF('second.pdf', { zonderHandtekeningVraag: true });
  h.switchToB(); gate.resolve();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.deepEqual(h.writes.map(w => w.source), ['a.pdf', 'a.pdf']);
});

test('Save As dialog keeps source and resulting path on A', async () => {
  const h = harness(), entered = deferred(), gate = deferred();
  h.deps.saveFileDialog = async () => { entered.resolve(); return gate.promise; };
  const saving = h.api.savePDFAs();
  await entered.promise; h.switchToB(); gate.resolve('copy-of-a.pdf');
  assert.equal(await saving, true);
  assert.deepEqual(h.writes, [{ path: 'copy-of-a.pdf', source: 'a.pdf' }]);
  assert.equal(h.a.filePath, 'copy-of-a.pdf');
  assert.equal(h.b.filePath, 'b.pdf');
});

test('closed document is not saved after the confirmation wait', async () => {
  const h = harness(), entered = deferred(), gate = deferred();
  h.deps.loadModule = async () => ({ bevestigOpslaanMetHandtekeningen: async () => { entered.resolve(); return gate.promise; } });
  const saving = h.api.savePDF();
  await entered.promise; h.deps.state.documents = [h.b]; gate.resolve(true);
  assert.equal(await saving, false);
  assert.deepEqual(h.writes, []);
});

test('write failure preserves modified and PDF/A state and re-locks the file', async () => {
  const h = harness(); let locks = 0;
  h.a.pdfaCompliance = 'PDF/A-2b';
  h.deps.writeBinaryFileAtomic = async () => { throw new Error('full disk'); };
  h.deps.lockFile = async () => { locks++; };
  assert.equal(await h.api.savePDF(null, { zonderHandtekeningVraag: true }), false);
  assert.equal(h.a.modified, true);
  assert.equal(h.a.pdfaCompliance, 'PDF/A-2b');
  assert.equal(locks, 1);
});

test('a structural reload during serialization cannot overwrite the prior document', async () => {
  const h = harness(), entered = deferred(), gate = deferred();
  const load = h.deps.PDFDocument.load;
  h.deps.PDFDocument.load = async bytes => { entered.resolve(); await gate.promise; return load(bytes); };
  const saving = h.api.savePDF(null, { zonderHandtekeningVraag: true });
  await entered.promise;
  h.a.pdfDoc = { newer: true };
  h.a.filePath = 'a-working-copy.pdf';
  gate.resolve();
  assert.equal(await saving, false);
  assert.deepEqual(h.writes, []);
  assert.equal(h.a.modified, true);
});

test('a reload during the disk write never marks the newer document clean', async () => {
  const h = harness(), entered = deferred(), gate = deferred();
  const write = h.deps.writeBinaryFileAtomic;
  h.deps.writeBinaryFileAtomic = async (...args) => { entered.resolve(); await gate.promise; return write(...args); };
  const saving = h.api.savePDF(null, { zonderHandtekeningVraag: true });
  await entered.promise;
  h.a.pdfDoc = { newer: true };
  gate.resolve();
  assert.equal(await saving, false);
  assert.equal(h.writes.length, 1);
  assert.equal(h.a.modified, true);
});

test('saving aborts before writing when a page has model annotations but is not ready', async () => {
  const h = harness();
  h.a.annotations = [{ page: 1, type: 'highlight' }];
  h.a._annotationPagesReady = new Set();
  const load = h.deps.PDFDocument.load;
  h.deps.PDFDocument.load = async bytes => ({ ...(await load(bytes)),
    getPages: () => [{ getRotation: () => ({ angle: 0 }) }] });
  assert.equal(await h.api.savePDF(null, { zonderHandtekeningVraag: true }), false);
  assert.deepEqual(h.writes, []);
  assert.equal(h.a.modified, true);
});
