// Saving a document with OCR results, with the real saver.
//
// Invalid OCR words (an empty box, oversized text) never fail the save or the
// crash-recovery snapshot. A reviewed word the OCR font cannot show, or
// reviewed words without the OCR font, refuse the save (#657) but never the
// crash-recovery snapshot. An unchanged OCR layer does not reload the document
// after a save; a changed one (including an undone OCR run) does.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName, PDFArray, PDFBool, decodePDFRawStream } from 'pdf-lib';

register('../core/app-test-hooks.mjs', import.meta.url);
register('./saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('./tekstvak-canvas.testhulp.mjs');
installeerCanvas();

const FONT = readFileSync(new URL('../../public/pdfjs/web/standard_fonts/LiberationSans-Regular.ttf', import.meta.url));
let fontAvailable = true;
globalThis.__TAURI__ = {
  path: { resourceDir: async () => 'C:/app/resources', join: async (...parts) => parts.join('/') },
  core: { invoke: async () => undefined },
  fs: {
    readFile: async (path) => {
      if (!fontAvailable) throw new Error(`failed to open file at path: ${path}`);
      return new Uint8Array(FONT);
    },
  },
};

const { state } = await import('../core/state.js');
const { savePDF, bouwMomentopname } = await import('./saver.js');

async function blankPdf(pages = 1) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([595, 842]);
  return doc.save();
}

/** A document in the store plus a fake file system that keeps the last write. */
async function harness(document, pages = 1) {
  let base = await blankPdf(pages);
  const calls = { reload: 0, writes: [] };
  globalThis.__saverTest = {
    impl: {
      getCachedPdfBytes: () => base,
      setCachedPdfBytes: (_path, bytes) => { base = bytes; },
      writeBinaryFile: (path, bytes) => { calls.writes.push(path); base = bytes; return true; },
      writeBinaryFileAtomic: (path, bytes) => { calls.writes.push(path); base = bytes; return true; },
      reloadFromBytes: () => { calls.reload++; },
    },
  };
  state.documents = [{
    id: 'ocr', filePath: 'C:/ocr/doc.pdf', pdfDoc: {}, pageRotations: {},
    _annotationPagesReady: new Set([1]), textEdits: [], annotations: [], ocrResults: {}, ...document,
  }];
  state.activeDocumentIndex = 0;
  const doc = state.documents[0];
  return {
    doc,
    calls,
    bytes: () => base,
    save: () => savePDF('C:/ocr/doc.pdf', { zonderHandtekeningVraag: true }),
  };
}

async function warnings(fn) {
  const messages = [];
  const old = console.warn;
  console.warn = (...args) => messages.push(args.map(String).join(' '));
  try { return { result: await fn(), messages }; } finally { console.warn = old; }
}

function ownedLayerText(pdf, pageIndex = 0) {
  const page = pdf.getPage(pageIndex);
  const contents = page.node.Contents();
  if (!contents) return null;
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  const owned = refs.map((ref) => pdf.context.lookup(ref))
    .filter((stream) => stream?.dict?.get(PDFName.of('OPS_OCRLayer')) === PDFBool.True);
  if (!owned.length) return null;
  return owned.map((stream) => new TextDecoder().decode(decodePDFRawStream(stream).decode())).join('\n');
}

const word = (text, extra = {}) => ({ text, left: 72, top: 72, width: 60, height: 14, confidence: 50, ...extra });

// First: the bundled font is cached once it has been read successfully.
test('a missing OCR font with reviews present refuses the save, not the recovery snapshot', async () => {
  fontAvailable = false;
  try {
    const reviewed = word('Hello', { review: { status: 'accepted', originalText: 'Hello' } });
    const h = await harness({ ocrResults: { 1: [reviewed] } });
    const before = h.bytes();
    assert.equal(await h.save(), false, 'save refused');
    assert.deepEqual(h.calls.writes, [], 'nothing written');
    assert.equal(h.bytes(), before);
    const { result: bytes, messages } = await warnings(() => bouwMomentopname(h.doc));
    assert.ok(bytes instanceof Uint8Array && bytes.length > 0, 'snapshot made');
    assert.ok(messages.some((m) => /OCR/i.test(m)), `warning: ${JSON.stringify(messages)}`);
  } finally {
    fontAvailable = true;
  }
});

test('a missing OCR font without reviews still saves', async () => {
  fontAvailable = false;
  try {
    const h = await harness({ ocrResults: { 1: [word('Hello')] } });
    const { result, messages } = await warnings(() => h.save());
    assert.equal(result, true, 'save succeeded');
    assert.ok(messages.some((m) => /OCR/i.test(m)), `warning: ${JSON.stringify(messages)}`);
  } finally {
    fontAvailable = true;
  }
});

test('a zero-width or non-finite OCR word is skipped; the save and the other words go through', async () => {
  const h = await harness({ ocrResults: { 1: [word('Broken', { width: 0 }), word('Nan', { left: NaN }), word('Hello')] } });
  const { result, messages } = await warnings(() => h.save());
  assert.equal(result, true, 'save succeeded');
  const text = ownedLayerText(await PDFDocument.load(h.bytes()));
  assert.ok(text, 'the OCR layer was written');
  assert.ok(messages.some((m) => /OCR/i.test(m) && /skip/i.test(m)), `log line: ${JSON.stringify(messages)}`);
});

test('a crash-recovery snapshot with an invalid OCR word still succeeds', async () => {
  const h = await harness({ ocrResults: { 1: [word('Broken', { height: -1 }), word('x'.repeat(2001))] } });
  const bytes = await bouwMomentopname(h.doc);
  assert.ok(bytes instanceof Uint8Array && bytes.length > 0);
});

test('a correction with a glyph the OCR font lacks refuses the save (#657)', async () => {
  const corrected = word('room', { text: 'room 🙂', review: { status: 'corrected', originalText: 'room' } });
  const h = await harness({ ocrResults: { 1: [corrected, word('wall')] } });
  const before = h.bytes();
  assert.equal(await h.save(), false, 'save refused');
  assert.deepEqual(h.calls.writes, [], 'nothing written');
  assert.equal(h.bytes(), before);
});

test('a recovery snapshot leaves an unencodable correction out of the layer and keeps it in the review', async () => {
  const corrected = word('room', { text: 'room 🙂', review: { status: 'corrected', originalText: 'room' } });
  const h = await harness({ ocrResults: { 1: [corrected, word('wall', { left: 200 })] } });
  const { result: bytes, messages } = await warnings(() => bouwMomentopname(h.doc));
  const pdf = await PDFDocument.load(bytes);
  assert.ok(ownedLayerText(pdf), 'the OCR layer was written');
  assert.ok(messages.some((m) => /OCR/i.test(m) && /reviewed/i.test(m)), `warning: ${JSON.stringify(messages)}`);
  const { readOcrReview } = await import('./ocr-review.js');
  assert.equal(readOcrReview(pdf).reviewsOnly[1][0].text, 'room 🙂');
});

test('saving an OCR document twice without changes reloads it only once', async () => {
  const h = await harness({ ocrResults: { 1: [word('Hello')] } });
  assert.equal(await h.save(), true);
  assert.equal(h.calls.reload, 1, 'the first save shows the new text layer');
  assert.equal(await h.save(), true);
  assert.equal(h.calls.reload, 1, 'an unchanged OCR layer does not reload');
  assert.deepEqual([...new Set(h.calls.writes)], ['C:/ocr/doc.pdf'], 'no working copy was written');
  h.doc.ocrResults[1][0].text = 'Hallo';
  assert.equal(await h.save(), true);
  assert.equal(h.calls.reload, 2, 'a changed OCR layer reloads');
});

test('undoing OCR removes the written layer and its review metadata on the next save', async () => {
  const reviewed = word('Hello', { review: { status: 'accepted', originalText: 'Hello' } });
  const h = await harness({ ocrResults: { 1: [reviewed] } });
  assert.equal(await h.save(), true);
  let pdf = await PDFDocument.load(h.bytes());
  assert.ok(ownedLayerText(pdf));
  assert.ok(pdf.getPage(0).node.get(PDFName.of('OPS_OCRReview')));
  h.doc.ocrResults[1] = []; // what undo of the OCR run leaves behind
  assert.equal(await h.save(), true);
  pdf = await PDFDocument.load(h.bytes());
  assert.equal(ownedLayerText(pdf), null, 'own OCR layer removed');
  assert.equal(pdf.getPage(0).node.get(PDFName.of('OPS_OCRReview')), undefined, 'review metadata removed');
});

test('an empty OCR page leaves an OCR layer from before this session alone', async () => {
  const h = await harness({ ocrResults: { 1: [word('Hello')] } });
  assert.equal(await h.save(), true);
  // A new session on the saved file: nothing was written by this session yet.
  h.doc.ocrLayerPages = undefined;
  h.doc.ocrLayerSignature = undefined;
  h.doc.ocrResults = { 1: [] };
  assert.equal(await h.save(), true);
  assert.ok(ownedLayerText(await PDFDocument.load(h.bytes())), 'older layer kept');
});

test('review metadata is written only for pages with reviews', async () => {
  const reviewed = word('Hello', { review: { status: 'accepted', originalText: 'Hello' } });
  const h = await harness({ ocrResults: { 1: [word('plain')], 2: [word('plain'), reviewed] } }, 2);
  assert.equal(await h.save(), true);
  const pdf = await PDFDocument.load(h.bytes());
  assert.equal(pdf.getPage(0).node.get(PDFName.of('OPS_OCRReview')), undefined);
  const { readOcrReview } = await import('./ocr-review.js');
  const { reviewsOnly, complete } = readOcrReview(pdf);
  assert.deepEqual(Object.keys(complete), []);
  assert.equal(reviewsOnly[2].length, 1);
  assert.equal(reviewsOnly[2][0].index, 1);
  assert.equal(reviewsOnly[2][0].text, 'Hello');
  assert.equal((ownedLayerText(pdf, 1).match(/Tj/g) || []).length, 2, 'the text layer still has every word');
});

// #880: tot het opslaan staan herkende woorden alleen in het geheugen (zoeken
// neemt ze dan mee); na het opslaan staan ze in het bestand en weet het
// document dat, zodat zoeken ze niet dubbel vindt.
test('after a save the recognized words count as in the file; a new OCR run does not', async () => {
  const { ongeschrevenOcrWoorden } = await import('./ocr-laag.js');
  const h = await harness({ ocrResults: { 1: [word('Hello')] } });
  assert.equal(ongeschrevenOcrWoorden(h.doc, 1).length, 1, 'not saved yet');
  assert.equal(await h.save(), true);
  assert.deepEqual(ongeschrevenOcrWoorden(h.doc, 1), [], 'saved: the layer is in the file');
  h.doc.ocrResults[1] = [word('Hallo')];
  assert.deepEqual(ongeschrevenOcrWoorden(h.doc, 1).map((w) => w.text), ['Hallo'], 'a new run is in memory only');
});
