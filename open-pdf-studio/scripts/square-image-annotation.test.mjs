import assert from 'node:assert/strict';
import test from 'node:test';

import {
  annotationIdOf,
  findImageAnnotationSources,
  findImageForAnnotation,
} from '../js/pdf/loader/annotation-image-sources.mjs';

const ONE_PIXEL_PNG = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n0sAAAAASUVORK5CYII=',
  'base64',
));

test('a synthetic SquareImage annotation exposes its direct image stream', async () => {
  const { PDFDocument, PDFName } = await import('pdf-lib');
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([200, 200]);
  const image = await pdfDoc.embedPng(ONE_PIXEL_PNG);
  await image.embed();
  const annotation = pdfDoc.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Square'),
    IT: PDFName.of('SquareImage'),
    Rect: [10, 20, 110, 70],
    Image: image.ref,
  });
  const annotationRef = pdfDoc.context.register(annotation);
  page.node.set(PDFName.of('Annots'), pdfDoc.context.obj([annotationRef]));

  const sources = findImageAnnotationSources(1, pdfDoc);

  assert.equal(sources.length, 1);
  assert.equal(sources[0].rectKey, '10,20,110,70');
  assert.match(sources[0].annotationId, /^\d+R$/);
  assert.equal(sources[0].kind, 'square-image');
  assert.equal(sources[0].stream.dict.get(PDFName.of('Subtype')).toString(), '/Image');
});

test('ordinary Square annotations are not treated as images', async () => {
  const { PDFDocument, PDFName } = await import('pdf-lib');
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([200, 200]);
  const annotation = pdfDoc.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Square'),
    Rect: [10, 20, 110, 70],
  });
  const annotationRef = pdfDoc.context.register(annotation);
  page.node.set(PDFName.of('Annots'), pdfDoc.context.obj([annotationRef]));

  assert.deepEqual(findImageAnnotationSources(1, pdfDoc), []);
});

test('annotation identity prevents a colliding ordinary Square from becoming an image', () => {
  const images = new Map([
    ['id:131R', { kind: 'square-image', dataUrl: 'data:image/png;base64,abc' }],
  ]);
  assert.equal(
    findImageForAnnotation(images, { id: '131R', rect: [10, 20, 110, 70] }, 'square-image'),
    'data:image/png;base64,abc',
  );
  assert.equal(
    findImageForAnnotation(images, { id: '132R', rect: [10, 20, 110, 70] }, 'square-image'),
    null,
  );
});

test('annotation identity retains non-zero PDF reference generations', async () => {
  const { PDFRef } = await import('pdf-lib');
  assert.equal(annotationIdOf(PDFRef.of(7, 0)), '7R');
  assert.equal(annotationIdOf(PDFRef.of(7, 3)), '7R3');
});
