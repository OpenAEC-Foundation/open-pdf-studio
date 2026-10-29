// Watermarks and headers/footers through the real save entry point, reopen
// and undo (#847): saving again replaces, removing removes, undo restores.
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { PDFDocument, PDFName, PDFString, degrees } from 'pdf-lib';

register('../core/app-test-hooks.mjs', import.meta.url);
register('../pdf/saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('../core/state.ts');
const undo = await import('../core/undo-manager.js');
const { saveWatermarksToPages } = await import('../pdf/saver/watermarks.js');
const { leesKopVoetUitBestand, naOpslaanKopVoet } = await import('./kopvoet-weergave.js');
const { readWatermarkDefinitions } = await import('../pdf/saver/watermark-content.js');

const PATH = 'C:/test/watermark.pdf';
const header = { id: 'hf', type: 'headerFooter', enabled: true, headerCenter: 'HEADER', pageRange: 'all' };
const mark = (extra = {}) => ({
  id: 'wm', type: 'textWatermark', text: 'DRAFT', fontFamily: 'Helvetica', fontSize: 48, color: '#ff0000',
  opacity: 0.3, rotation: -45, position: 'center', layer: 'behind', pageRange: 'all', enabled: true, ...extra,
});

function openDoc(watermarks = []) {
  state.documents = [{
    id: 'doc-wm', filePath: PATH, fileName: 'watermark.pdf', pdfDoc: { numPages: 2 }, currentPage: 1, scale: 1,
    viewMode: 'single', annotations: [], selectedAnnotation: null, selectedAnnotations: [],
    undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
    textEdits: [], watermarks, bookmarks: [], pageRotations: {}, measureScale: null,
  }];
  state.activeDocumentIndex = 0;
  return state.documents[0];
}

async function save(doc, bytes) {
  const pdf = await PDFDocument.load(bytes);
  const { kopVoet } = await saveWatermarksToPages(pdf, pdf.getPages(), doc);
  const out = await pdf.save();
  naOpslaanKopVoet(doc, kopVoet, PATH);
  return out;
}

async function reopen(bytes) {
  const doc = openDoc([]);
  leesKopVoetUitBestand(doc, await PDFDocument.load(bytes), PATH);
  return state.documents[0];
}

async function texts(bytes) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loaded = await getDocument({ data: bytes.slice(), isEvalSupported: false, useSystemFonts: true }).promise;
  try {
    const out = [];
    for (let n = 1; n <= loaded.numPages; n++) {
      out.push((await (await loaded.getPage(n)).getTextContent()).items.map(i => i.str).filter(s => s.trim()));
    }
    return out;
  } finally { await loaded.loadingTask.destroy(); }
}

async function blank() {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < 2; i++) pdf.addPage([600, 800]).drawText('BODY', { x: 50, y: 400 });
  return pdf.save();
}

test('header and watermark on the same pages: saving again and again keeps one of each', async () => {
  let doc = openDoc([{ ...header }, mark()]);
  let bytes = await save(doc, await blank());
  for (let i = 0; i < 3; i++) {
    doc = await reopen(bytes);
    assert.deepEqual(doc.watermarks.map(w => w.id).sort(), ['hf', 'wm']);
    assert.ok(doc.watermarks.every(w => w.uitBestand), 'both are page content of the opened file');
    bytes = await save(doc, bytes);
  }
  assert.deepEqual(await texts(bytes), [['BODY', 'HEADER', 'DRAFT'], ['BODY', 'HEADER', 'DRAFT']]);
});

test('removing the watermark after reopening leaves the header and the body', async () => {
  let bytes = await save(openDoc([{ ...header }, mark()]), await blank());
  const doc = await reopen(bytes);
  doc.watermarks.splice(doc.watermarks.findIndex(w => w.id === 'wm'), 1);
  bytes = await save(doc, bytes);
  assert.deepEqual(await texts(bytes), [['BODY', 'HEADER'], ['BODY', 'HEADER']]);
  assert.deepEqual(readWatermarkDefinitions(await PDFDocument.load(bytes)), []);
});

test('undo of an edit and of a removal is what gets saved next', async () => {
  let bytes = await save(openDoc([mark()]), await blank());
  const doc = await reopen(bytes);
  const wm = doc.watermarks[0];
  const before = { ...wm };
  Object.assign(wm, { text: 'FINAL', uitBestand: false });
  undo.recordModifyWatermark(wm.id, before, { ...wm });
  await undo.undo();
  assert.equal(state.documents[0].watermarks[0].text, 'DRAFT');
  bytes = await save(state.documents[0], bytes);
  assert.deepEqual(await texts(bytes), [['BODY', 'DRAFT'], ['BODY', 'DRAFT']]);

  const live = state.documents[0];
  const removed = live.watermarks.splice(0, 1)[0];
  undo.recordRemoveWatermark(removed, 0);
  await undo.undo();
  assert.equal(state.documents[0].watermarks.length, 1);
  bytes = await save(state.documents[0], bytes);
  assert.deepEqual(await texts(bytes), [['BODY', 'DRAFT'], ['BODY', 'DRAFT']]);
  await undo.redo();
  bytes = await save(state.documents[0], bytes);
  assert.deepEqual(await texts(bytes), [['BODY'], ['BODY']]);
});

test('other annotations on the page are untouched by watermark saves', async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([600, 800]);
  page.node.addAnnot(pdf.context.register(pdf.context.obj({
    Type: 'Annot', Subtype: 'Square', Rect: [10, 10, 100, 100], Contents: PDFString.of('note'),
  })));
  let bytes = await save(openDoc([mark()]), await pdf.save());
  bytes = await save(await reopen(bytes), bytes);
  const loaded = await PDFDocument.load(bytes);
  const annots = loaded.getPage(0).node.Annots();
  assert.equal(annots.size(), 1);
  const dict = loaded.context.lookup(annots.get(0));
  assert.equal(dict.get(PDFName.of('Subtype')).toString(), '/Square');
  assert.equal(dict.lookup(PDFName.of('Contents')).decodeText(), 'note');
});

test('the screen draws text watermarks where the saved file has them', async () => {
  const { renderWatermarksBehind } = await import('./watermark-renderer.js');
  const { Util, getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  for (const [position, rotation, pageRotation, autoFit] of [
    ['center', -45, 0], ['top-left', 0, 0], ['bottom-right', 30, 90], ['center', -45, 90, true], ['top-right', 0, 0, true],
  ]) {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([700, 900]);
    page.setCropBox(50, 60, 600, 800);
    page.setRotation(degrees(pageRotation));
    const wm = mark({ text: 'WAVE AVATAR', fontSize: 40, position, rotation, autoFit: !!autoFit });
    const doc = openDoc([wm]);
    const bytes = await save(doc, await pdf.save());

    const loaded = await getDocument({ data: bytes.slice(), isEvalSupported: false, useSystemFonts: true }).promise;
    const view = (await loaded.getPage(1)).getViewport({ scale: 1 });
    const [item] = (await (await loaded.getPage(1)).getTextContent()).items.filter(i => i.str.trim());
    const m = Util.transform(view.transform, item.transform);
    await loaded.loadingTask.destroy();
    const a = rotation * Math.PI / 180;
    const saved = { x: m[4] + Math.cos(a) * item.width / 2, y: m[5] + Math.sin(a) * item.width / 2 };

    // A canvas that records what the screen draws.
    const calls = [];
    const ctx = new Proxy({}, {
      get: (_, k) => (k in ctx_state ? ctx_state[k] : (...args) => calls.push([k, ...args])),
      set: (_, k, v) => { ctx_state[k] = v; return true; },
    });
    const ctx_state = {};
    state.documents[0].watermarks.forEach(w => { w.uitBestand = false; });
    renderWatermarksBehind(ctx, 1, view.width, view.height);
    const [, tx, ty] = calls.find(c => c[0] === 'translate');
    const [, , , baseline] = calls.find(c => c[0] === 'fillText');
    assert.ok(Math.abs(parseFloat(ctx_state.font) - Math.hypot(item.transform[0], item.transform[1])) < 0.01, 'same size');
    const screen = { x: tx - Math.sin(a) * baseline, y: ty + Math.cos(a) * baseline };
    assert.equal(ctx_state.textAlign, 'center');
    assert.ok(Math.abs(screen.x - saved.x) < 0.5 && Math.abs(screen.y - saved.y) < 0.5,
      `${position}/${rotation}/${pageRotation}: screen ${JSON.stringify(screen)} saved ${JSON.stringify(saved)}`);
  }
});

test('undo of an edit removes settings the edit added, redo brings them back', async () => {
  const doc = openDoc([mark()]);
  const wm = doc.watermarks[0];
  const before = { ...wm };
  Object.assign(wm, { autoFit: true, fontSize: 30 });
  undo.recordModifyWatermark(wm.id, before, { ...wm });
  await undo.undo();
  assert.equal('autoFit' in state.documents[0].watermarks[0], false);
  assert.equal(state.documents[0].watermarks[0].fontSize, 48);
  await undo.redo();
  assert.equal(state.documents[0].watermarks[0].autoFit, true);
  assert.equal(state.documents[0].watermarks[0].fontSize, 30);
});
