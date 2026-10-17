import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { opslaanGeweigerd, markeerBeveiligd } from './wachtwoord-pdf.js';
import { bestandsnaamUitPad } from '../core/bestandsnaam.js';

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
  const writes = [], owners = [], attachmentEdits = [];
  const deps = {
    state: { documents: [a, b] }, getActiveDocument: () => active,
    showLoading() {}, hideLoading() {}, updateTabBar() {}, updateWindowTitle() {},
    getCachedPdfBytes: path => new TextEncoder().encode(path), setCachedPdfBytes() {},
    verzamelSchaalBronnen: () => ({}),
    PDFDocument: { load: async bytes => ({ context: { largestObjectNumber: 1 }, getPages: () => [], catalog: { get: () => null }, save: async () => bytes }) },
    PDFName: { of: x => x }, KNIPSEL_CATALOGUS: 'snippets',
    getAnnotationStorage: doc => { owners.push(doc); return null; },
    getAnnotIdToFieldName: doc => { owners.push(doc); return new Map(); },
    schrijfAnnotatieLagen() {}, maakCjkFontKeten: () => ({}), layersForSave: doc => { owners.push(doc); return []; }, currentLayerId() {},
    saveTextEditsToPages: async (_pdf, _pages, doc) => owners.push(doc),
    saveWatermarksToPages: async (_pdf, _pages, doc) => owners.push(doc),
    saveBookmarksToOutline: (_pdf, doc) => owners.push(doc), saveStylePresetsToCatalog() {},
    slaPaginaLabelsOp: (_pdf, doc) => owners.push(doc),
    pasBijlagenToe: (_pdf, wijzigingen) => attachmentEdits.push(wijzigingen),
    unlockFile: async () => {}, lockFile: async () => {},
    writeBinaryFileAtomic: async (path, bytes) => { writes.push({ path, source: new TextDecoder().decode(bytes) }); },
    isTauri: () => false, markeerGebakken() {}, hidePdfABar() {}, stripPdfAMetadata() {},
    i18next: { t: x => x }, showMessage() {}, window: {},
    // Met een wachtwoord geopend: nooit opslaan (wachtwoord-pdf.js, echt).
    opslaanGeweigerd,
    // Leesbare naam, ook voor een content://-URI van Android (#596).
    bestandsnaamUitPad,
    console: { error() {}, warn() {} },
    saveFileDialog: async () => 'copy.pdf',
    // Het slot tegen een extensiewissel (#550): standaard loopt er geen.
    metOpslagSlot: async fn => fn(),
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
  return { a, b, deps, api, writes, owners, attachmentEdits, switchToB: () => { active = b; } };
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

test('saving waits for a running extension switch before it reads the document (#550)', async () => {
  const h = harness(), wissel = deferred();
  h.deps.metOpslagSlot = fn => wissel.promise.then(fn);
  const saving = h.api.savePDF('copy-of-a.pdf');
  await new Promise(r => setTimeout(r, 5));
  assert.deepEqual(h.writes, [], 'nothing is written during the switch');
  assert.deepEqual(h.owners, []);
  wissel.resolve();
  assert.equal(await saving, true);
  assert.deepEqual(h.writes, [{ path: 'copy-of-a.pdf', source: 'a.pdf' }]);
});

test('the extension slot is taken after the signature question and held for the whole write (#550)', async () => {
  const h = harness(), log = [];
  const original = h.deps.loadModule;
  h.deps.loadModule = async path => path.includes('verificatie')
    ? { bevestigOpslaanMetHandtekeningen: async () => { log.push('question'); return true; } }
    : original(path);
  h.deps.metOpslagSlot = async fn => { log.push('slot taken'); try { return await fn(); } finally { log.push('slot released'); } };
  const write = h.deps.writeBinaryFileAtomic;
  h.deps.writeBinaryFileAtomic = async (path, bytes) => { log.push('write'); return write(path, bytes); };
  assert.equal(await h.api.savePDF('copy-of-a.pdf'), true);
  assert.deepEqual(log, ['question', 'slot taken', 'write', 'slot released']);
});

test('a second save while the first waits for the slot waits for the first one (#550)', async () => {
  const h = harness(), wissel = deferred();
  let requests = 0;
  h.deps.metOpslagSlot = fn => { requests++; return wissel.promise.then(fn); };
  const first = h.api.savePDF('first.pdf');
  await new Promise(r => setTimeout(r, 5));
  const second = h.api.savePDF('second.pdf');
  await new Promise(r => setTimeout(r, 5));
  assert.equal(requests, 1, 'the second save does not start its own write next to the first');
  wissel.resolve();
  assert.deepEqual([await first, await second], [true, true]);
  assert.deepEqual(h.writes.map(w => w.path), ['first.pdf', 'second.pdf']);
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

test('explicit Save As path retargets A without opening a file dialog', async () => {
  const h = harness();
  h.deps.saveFileDialog = async () => { throw new Error('unexpected file dialog'); };
  assert.equal(await h.api.savePDFAs(h.a, 'translated.pdf', { zonderHandtekeningVraag: true }), true);
  assert.deepEqual(h.writes, [{ path: 'translated.pdf', source: 'a.pdf' }]);
  assert.equal(h.a.filePath, 'translated.pdf');
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

test('saving text edits to a new path refreshes the view and retargets later saves', async () => {
  const h = harness();
  const reloads = [];
  h.a.textEdits = [{ id: 'edit-1', newText: 'Bienvenue', baked: false }];
  h.deps.saveTextEditsToPages = async (_pdf, _pages, doc) => {
    doc.textEdits[0]._pendingBakeInfo = { bakedNewText: 'Bienvenue', inplaceBaked: null };
  };
  const loadModule = h.deps.loadModule;
  h.deps.loadModule = async path => path.includes('page-manager')
    ? { reloadFromBytes: async (bytes, _annotations, _rotations, _page, _viewport, doc) => {
      reloads.push({ bytes: new TextDecoder().decode(bytes), target: doc.saveTargetPath });
      doc.filePath = 'fresh-working-copy.pdf';
      doc.pdfDoc = { fresh: true };
      doc.modified = true;
    } }
    : loadModule(path);
  assert.equal(await h.api.savePDF('translated.pdf', { zonderHandtekeningVraag: true }), true);
  assert.deepEqual(h.writes.map(write => write.path), ['translated.pdf']);
  assert.deepEqual(reloads, [{ bytes: 'a.pdf', target: 'translated.pdf' }]);
  assert.equal(h.a.saveTargetPath, 'translated.pdf');
  assert.equal(h.a.textEdits.length, 0);
  assert.equal(h.a.modified, false);
});

test('Save As keeps a refreshed text edit bound to its new file', async () => {
  const h = harness();
  h.a.textEdits = [{ id: 'edit-2', newText: 'Bienvenue', baked: false }];
  h.deps.saveTextEditsToPages = async (_pdf, _pages, doc) => {
    doc.textEdits[0]._pendingBakeInfo = { bakedNewText: 'Bienvenue', inplaceBaked: null };
  };
  const loadModule = h.deps.loadModule;
  h.deps.loadModule = async path => path.includes('page-manager')
    ? { reloadFromBytes: async (_bytes, _annotations, _rotations, _page, _viewport, doc) => {
      assert.equal(doc.saveTargetPath, 'copy.pdf');
      doc.filePath = 'fresh-working-copy.pdf';
      doc._renderTemp = true;
      doc.pdfDoc = { fresh: true };
    } }
    : loadModule(path);
  assert.equal(await h.api.savePDFAs(h.a), true);
  assert.equal(h.a.filePath, 'copy.pdf');
  assert.equal(h.a.saveTargetPath, null);
  assert.equal(h.a._renderTemp, false);
  assert.equal(h.a.pdfDoc.fresh, true);
  assert.equal(h.a.modified, false);
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

test('a PDF opened with a password is never saved: Save, Save As and a given path all refuse', async () => {
  const h = harness();
  const meldingen = [];
  h.deps.showMessage = (m) => meldingen.push(m);
  let dialoog = 0;
  h.deps.saveFileDialog = async () => { dialoog++; return 'copy.pdf'; };
  h.a.filePath = 'C:/Temp/opds-beveiligd/1-0123456789abcdef.pdf';
  markeerBeveiligd(h.a, 'D:/Projecten/contract.pdf');
  assert.equal(await h.api.savePDF(null, { zonderHandtekeningVraag: true }), false);
  assert.equal(await h.api.savePDF('D:/elders.pdf', { zonderHandtekeningVraag: true }), false);
  assert.equal(await h.api.savePDFAs(h.a), false);
  assert.deepEqual(h.writes, []);
  assert.equal(dialoog, 0, 'no Save As dialog either');
  assert.deepEqual(meldingen, ['protectedPdfReadOnly', 'protectedPdfReadOnly', 'protectedPdfReadOnly']);
  // Het andere document slaat gewoon op.
  h.switchToB();
  assert.equal(await h.api.savePDF(null, { zonderHandtekeningVraag: true }), true);
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].path, 'b.pdf');
});

test('a save writes the attachment changes of the document being saved (#376)', async () => {
  const h = harness();
  const edits = { toegevoegd: [{ naam: 'model.ifc', bytes: new Uint8Array([1]) }], verwijderd: ['old.xlsx'] };
  h.a.bijlagenWijzigingen = edits;
  h.b.bijlagenWijzigingen = { toegevoegd: [], verwijderd: ['b-only.txt'] };
  assert.equal(await h.api.savePDF(null, { zonderHandtekeningVraag: true }), true);
  assert.deepEqual(h.attachmentEdits, [edits]);
});
