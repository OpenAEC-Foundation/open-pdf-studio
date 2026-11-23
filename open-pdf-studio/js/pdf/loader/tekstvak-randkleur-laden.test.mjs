// A text box of another program with a red border, taken through the real
// loader (pdf.js, extractAnnotationColors, convertPdfAnnotation). The border
// colour is only in the appearance stream; it came back black when the stream
// set it with SC after a colour space, or in CMYK.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('../tekstvak-canvas.testhulp.mjs');
installeerCanvas();

const { convertPdfAnnotation } = await import('./annotation-converter.js');
const { extractAnnotationColors } = await import('./color-extraction.js');

async function tekstvakMet(inhoud) {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([842, 595]);
  const ctx = doc.context;
  const rect = [100, 300, 380, 360];
  const stroom = ctx.stream(inhoud, { Type: 'XObject', Subtype: 'Form', BBox: rect, Matrix: [1, 0, 0, 1, -100, -300] });
  const ref = ctx.register(ctx.obj({
    Type: 'Annot', Subtype: 'FreeText', Rect: rect, F: 4,
    Contents: PDFString.of('7 nos. of WIU-7.6'),
    DA: PDFString.of('0 0 0 rg /Helv 12 Tf'),
    AP: ctx.obj({ N: ctx.register(stroom) }),
  }));
  pagina.node.set(PDFName.of('Annots'), ctx.obj([ref]));
  const bytes = await doc.save();

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const geladen = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const blad = await geladen.getPage(1);
  const viewport = blad.getViewport({ scale: 1 });
  const kaart = await extractAnnotationColors(1, await PDFDocument.load(bytes.slice()));
  const [annot] = await blad.getAnnotations();
  const model = await convertPdfAnnotation(annot, 1, viewport, new Map(), kaart);
  await geladen.loadingTask.destroy();
  return model;
}

const TEKST = 'BT 0 g /Helv 12 Tf 104 340 Td (7 nos. of WIU-7.6) Tj ET';

for (const [naam, rand] of [
  ['RG', '1 0 0 RG 1 w 100.5 300.5 279 59 re S'],
  ['SC after a colour space', '/DeviceRGB CS 1 0 0 SC 1 w 100.5 300.5 279 59 re S'],
  ['CMYK', '0 1 1 0 K 1 w 100.5 300.5 279 59 re S'],
]) {
  test(`a red border written as ${naam} loads as red, with black text`, async () => {
    const model = await tekstvakMet(`${rand}\n${TEKST}`);
    assert.equal(model.type, 'textbox');
    assert.equal(String(model.strokeColor).toLowerCase(), '#ff0000');
    assert.equal(String(model.textColor).toLowerCase(), '#000000');
  });
}
