// The structure model (#384) of an untagged document comes from the open
// pdf.js document, without loading the whole file into pdf-lib; a tagged one
// is still read with pdf-lib, and both give the same model.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { readStructTree } from './struct-tree.js';
import { readStructModel, bytesMentionStructTreeRoot, pdfjsHasStructTree } from './struct-model.js';
import { taggedPdf, untaggedPdf } from './tagged-pdf.testhulp.mjs';

async function openPdfjs(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
}

function spyLoad() {
  const calls = [];
  const load = (bytes) => { calls.push(bytes); return PDFDocument.load(bytes); };
  return { calls, load };
}

async function untaggedWith({ lang = null, marked = false, objectStreams = true } = {}) {
  const doc = await PDFDocument.load(await untaggedPdf());
  if (lang) doc.catalog.set(PDFName.of('Lang'), PDFString.of(lang));
  if (marked) doc.catalog.set(PDFName.of('MarkInfo'), doc.context.obj({ Marked: true }));
  return doc.save({ useObjectStreams: objectStreams });
}

test('an untagged document is not loaded into pdf-lib, and the model matches pdf-lib\'s', async () => {
  for (const options of [{}, { lang: 'nl-NL', marked: true }, { lang: 'en', objectStreams: false }]) {
    const bytes = await untaggedWith(options);
    const pdfDoc = await openPdfjs(bytes);
    const { calls, load } = spyLoad();
    const model = await readStructModel({ bytes, pdfDoc, loadPdfLib: load });
    assert.equal(calls.length, 0, `no pdf-lib load (${JSON.stringify(options)})`);
    assert.deepEqual(model, readStructTree(await PDFDocument.load(bytes)), 'same model as the full read');
    await pdfDoc.loadingTask.destroy();
  }
});

test('a tagged document is read with pdf-lib', async () => {
  const bytes = await taggedPdf();
  const pdfDoc = await openPdfjs(bytes);
  assert.deepEqual(await pdfjsHasStructTree(pdfDoc), { tagged: true, exact: true });
  const { calls, load } = spyLoad();
  const model = await readStructModel({ bytes, pdfDoc, loadPdfLib: load });
  assert.equal(calls.length, 1);
  assert.equal(model.tagged, true);
  assert.equal(model.lang, 'en-US');
  await pdfDoc.loadingTask.destroy();
});

test('when pdf.js cannot tell, or the bytes name a structure tree, pdf-lib decides', async () => {
  const tagged = await taggedPdf();
  assert.equal(bytesMentionStructTreeRoot(tagged), true);
  assert.equal(bytesMentionStructTreeRoot(new TextEncoder().encode('/NotStructTreeRoot StructTreeRoot')), false,
    'only the name /StructTreeRoot counts');
  assert.equal(bytesMentionStructTreeRoot(new Uint8Array()), false);

  let { calls, load } = spyLoad();
  await readStructModel({ bytes: tagged, pdfDoc: null, loadPdfLib: load });
  assert.equal(calls.length, 1, 'no pdf.js document: full read');

  // A pdf.js without hasStructTree is asked for page 1's tree, which is also
  // null when pdf.js cannot parse one: the bytes back it up.
  const failingPdfjs = { getMetadata: async () => ({ info: {} }), getPage: async () => ({ getStructTree: async () => null }) };
  ({ calls, load } = spyLoad());
  const model = await readStructModel({ bytes: tagged, pdfDoc: failingPdfjs, loadPdfLib: load });
  assert.equal(calls.length, 1);
  assert.equal(model.tagged, true);

  const brokenPdfjs = { getPage: async () => { throw new Error('gone'); } };
  assert.deepEqual(await pdfjsHasStructTree(brokenPdfjs), { tagged: null, exact: false });
  const untagged = await untaggedPdf();
  ({ calls, load } = spyLoad());
  await readStructModel({ bytes: untagged, pdfDoc: { numPages: 1, getMetadata: async () => ({ info: {} }),
    getPage: async () => ({ getStructTree: async () => null }) }, loadPdfLib: load });
  assert.equal(calls.length, 0, 'old pdf.js, no tree and no name in the bytes: no pdf-lib load');
});
