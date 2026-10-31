// Apply Redactions in the app (#762), end to end with the real saver:
// the marks in the model → Apply Redactions (redaction.js) → the reloaded
// bytes → save (saver.js) → the written file. The marks are gone from the
// model and the file, the covered content is gone from the file, OCR words
// under a mark are not written again, other annotations are kept, and the
// save is a complete rewrite without unreferenced objects or earlier
// revisions.
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { PDFDocument, PDFName } from 'pdf-lib';

register('../../core/app-test-hooks.mjs', import.meta.url);
register('../saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('../tekstvak-canvas.testhulp.mjs');
installeerCanvas();

const H = await import('./redaction.testhulp.mjs');
const { state } = await import('../../core/state.js');
const { savePDF } = await import('../saver.js');
const { runRedactions } = await import('../../annotations/redaction.js');
const { createAnnotation } = await import('../../annotations/factory.js');
const { PENDING_KEY, unreferencedObjects } = await import('./apply.js');

async function source() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([600, 800]);
  const ctx = pdf.context;
  const font = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding' }));
  page.node.set(PDFName.of('Resources'), ctx.obj({ Font: ctx.obj({ F1: font }) }));
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream('BT /F1 12 Tf 100 700 Td (KEEPLEFT APPSECRET KEEPRIGHT) Tj ET')));
  return pdf.save({ useObjectStreams: false });
}

function openDocument(bytes, annotations, extra = {}) {
  const cache = { bytes };
  state.documents = [{
    id: 'red', filePath: 'C:/red/bron.pdf', pdfDoc: {}, annotations, pageRotations: {},
    _annotationPagesReady: new Set([1]), textEdits: [], currentPage: 1, fileName: 'bron.pdf', ...extra,
  }];
  state.activeDocumentIndex = 0;
  globalThis.__saverTest = {
    impl: {
      getCachedPdfBytes: () => cache.bytes,
      writeBinaryFile: () => true,
      writeBinaryFileAtomic: (_p, b) => { globalThis.__saverTest.uit = b; return true; },
      // The reload after applying: the document now shows these bytes.
      reloadFromBytes: (b, anns, _rot, _page, _vp, doc) => { cache.bytes = b; doc.annotations = anns; doc._annotationPagesReady = new Set([1]); },
    },
  };
  return state.documents[0];
}

test('Apply Redactions then save: content, marks and OCR words under the mark are gone from the file', async () => {
  const src = await source();
  // "APPSECRET" at x = 100 + width("KEEPLEFT ") (Helvetica 12 pt); app space has y down.
  const x0 = 100 + H.advances('KEEPLEFT ', { fs: 12 })[9];
  const w = H.advances('APPSECRET', { fs: 12 })[9];
  const mark = createAnnotation({ type: 'redaction', page: 1, x: x0 + 0.5, y: 800 - 710, width: w - 1, height: 14, overlayColor: '#000000' });
  const under = createAnnotation({ type: 'box', page: 1, x: x0 + 5, y: 800 - 708, width: 10, height: 6, color: '#ff0000', strokeColor: '#ff0000', lineWidth: 1 });
  const away = createAnnotation({ type: 'box', page: 1, x: 50, y: 300, width: 40, height: 40, color: '#00ff00', strokeColor: '#00ff00', lineWidth: 1 });
  const doc = openDocument(src, [mark, under, away], {
    ocrResults: { 1: [
      { text: 'OCRUNDER', left: x0 + 2, top: 800 - 710, width: 20, height: 10, confidence: 90 },
      { text: 'OCRAWAY', left: 300, top: 400, width: 40, height: 10, confidence: 90 },
    ] },
  });
  const r = await runRedactions({ all: false, doc, vragen: false });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(r.stats.glyphs >= 9);
  // The model: the mark is applied, the annotation under it removed, the other kept.
  assert.deepEqual(doc.annotations.map((a) => a.id), [away.id]);
  assert.deepEqual(doc.ocrResults[1].map((w2) => w2.text), ['OCRAWAY']);

  assert.equal(await savePDF('C:/red/uit.pdf', { zonderHandtekeningVraag: true }, doc), true);
  const saved = globalThis.__saverTest.uit;
  const [text] = H.mupdfText(saved);
  assert.ok(text.includes('KEEPLEFT') && text.includes('KEEPRIGHT'));
  assert.ok(!text.includes('APPSECRET') && !text.includes('SECRET'));
  assert.ok(!H.containsSecret(saved, 'APPSECRET'));
  // The pending record is not written; nothing unreferenced; no earlier revision.
  const pdf = await PDFDocument.load(saved);
  assert.equal(pdf.getPage(0).node.get(PDFName.of(PENDING_KEY)), undefined);
  assert.ok(!H.latin1(saved).includes('/Prev'));
  const plain = await pdf.save({ useObjectStreams: false });
  assert.deepEqual(unreferencedObjects(plain), []);
  // No redaction mark annotation is written any more.
  assert.ok(!H.latin1(plain).includes('(redaction)'));
});

test('invalid marks refuse the whole operation and change nothing', async () => {
  const src = await source();
  const good = createAnnotation({ type: 'redaction', page: 1, x: 100, y: 90, width: 50, height: 14 });
  const bad = createAnnotation({ type: 'redaction', page: 1, x: 100, y: 90, width: 20, height: 14 });
  bad.width = Number.NaN; // e.g. a mark read from a damaged file
  const doc = openDocument(src, [good, bad]);
  const r = await runRedactions({ all: true, doc, vragen: false });
  assert.equal(r.ok, false);
  assert.equal(r.fout, 'REDACTION_INVALID_AREA');
  assert.equal(doc.annotations.length, 2);
});

test('unsaved text edits must be saved first', async () => {
  const src = await source();
  const doc = openDocument(src, [createAnnotation({ type: 'redaction', page: 1, x: 100, y: 90, width: 50, height: 14 })], {
    textEdits: [{ id: 't', page: 1, newText: 'x' }],
  });
  const r = await runRedactions({ all: true, doc, vragen: false });
  assert.equal(r.ok, false);
  assert.equal(r.reden, 'tekstbewerkingen');
});
