import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName } from 'pdf-lib';
import { createPluginPdfAnnotation, readPluginPdfAnnotation, renderPluginAnnotationPng } from './plugin-pdf.js';
import { extractAnnotationColors } from '../pdf/loader/color-extraction.js';

const onePixelPng = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLytQAAAABJRU5ErkJggg==', 'base64'));

test('plugin metadata and visible appearance survive a saved PDF round trip', async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([400, 300]);
  const annotation = { id: 'grid-1', type: 'intecoGrid', page: 1, x: 20, y: 30,
    width: 100, height: 60, params: { orientation: 90, origin: [20, 30] } };
  const dict = await createPluginPdfAnnotation(pdf, annotation, [20, 210, 120, 270], onePixelPng);
  assert.ok(dict.get(PDFName.of('AP')));
  page.node.addAnnot(pdf.context.register(dict));

  const reopened = await PDFDocument.load(await pdf.save());
  const savedDict = reopened.context.lookup(reopened.getPages()[0].node.Annots().get(0));
  assert.ok(savedDict.get(PDFName.of('AP')));
  assert.deepEqual(readPluginPdfAnnotation(savedDict, reopened.context), annotation);
  const bytes = await reopened.save();
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const reader = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  try {
    const [visible] = await (await reader.getPage(1)).getAnnotations();
    const extras = (await extractAnnotationColors(1, reopened)).get(`@ref:${visible.id}`);
    assert.equal(visible.subtype, 'Square');
    assert.deepEqual(extras.pluginAnnotation, annotation);
  } finally {
    await reader.destroy();
  }
});

test('ordinary PDF annotations are not interpreted as plugin objects', async () => {
  const pdf = await PDFDocument.create();
  const dict = pdf.context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [0, 0, 10, 10] });
  assert.equal(readPluginPdfAnnotation(dict, pdf.context), null);
});

test('overlapping plugin annotations retain separate metadata by PDF reference', async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([400, 300]);
  for (const id of ['first', 'second']) {
    const dict = await createPluginPdfAnnotation(pdf,
      { id, type: 'ceilingSystem', page: 1, x: 20, y: 30, width: 100, height: 60 },
      [20, 210, 120, 270], onePixelPng);
    page.node.addAnnot(pdf.context.register(dict));
  }
  const bytes = await pdf.save();
  const readerLib = await PDFDocument.load(bytes.slice());
  const map = await extractAnnotationColors(1, readerLib);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const reader = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  try {
    const annotations = await (await reader.getPage(1)).getAnnotations();
    assert.deepEqual(annotations.map(a => map.get(`@ref:${a.id}`)?.pluginAnnotation.id), ['first', 'second']);
  } finally {
    await reader.destroy();
  }
});

test('appearance raster is counter-rotated for a rotated PDF page', () => {
  const canvases = [];
  const rotations = [];
  const createCanvas = () => {
    const canvas = {
      width: 0, height: 0,
      getContext: () => ({
        setTransform() {}, translate() {}, drawImage() {},
        rotate: angle => rotations.push(angle),
      }),
      toDataURL: () => `data:image/png;base64,${Buffer.from(onePixelPng).toString('base64')}`,
    };
    canvases.push(canvas);
    return canvas;
  };
  const bytes = renderPluginAnnotationPng(
    { x: 0, y: 0, width: 30, height: 10 }, { render() {} }, 90, createCanvas);
  assert.ok(bytes.length);
  assert.deepEqual([canvases[1].width, canvases[1].height], [40, 120]);
  assert.deepEqual(rotations, [-Math.PI / 2]);
});
