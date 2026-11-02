// Annotations from a file on a page with /UserUnit. The app space counts page
// units, like /Rect and the saver, but a PDF.js viewport multiplies by the
// /UserUnit. Read through that viewport, every save and reopen doubled the
// coordinates on a /UserUnit 2 page.
//
// The PDFs are real (pdf-lib) and are read with PDF.js, like the loader does.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { PDFDocument, PDFName } from 'pdf-lib';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { paginaViewport } = await import('./pagina-viewport.js');
const { convertPdfAnnotation } = await import('./loader/annotation-converter.js');

async function pdfMet({ userUnit, rotate, cropBox }) {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([400, 600]);
  if (userUnit) pagina.node.set(PDFName.of('UserUnit'), doc.context.obj(userUnit));
  if (rotate) pagina.node.set(PDFName.of('Rotate'), doc.context.obj(rotate));
  if (cropBox) pagina.node.set(PDFName.of('CropBox'), doc.context.obj(cropBox));
  const vierkant = doc.context.obj({
    Type: 'Annot', Subtype: 'Square', Rect: [100, 200, 180, 260], C: [1, 0, 0], F: 4,
  });
  const lijn = doc.context.obj({
    Type: 'Annot', Subtype: 'Line', Rect: [50, 50, 150, 90], L: [50, 50, 150, 90], C: [0, 0, 1], F: 4,
  });
  pagina.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(vierkant), doc.context.register(lijn)]));
  return doc.save();
}

async function gelezen(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const pagina = await doc.getPage(1);
  const viewport = paginaViewport(pagina);
  const annots = await pagina.getAnnotations();
  const uit = [];
  for (const annot of annots) uit.push(await convertPdfAnnotation(annot, 1, viewport, null, null));
  await doc.loadingTask.destroy();
  return { viewport, annots: uit };
}

test('/UserUnit 2: the coordinates stay in page units', async () => {
  const { viewport, annots: [vierkant, lijn] } = await gelezen(await pdfMet({ userUnit: 2 }));
  assert.equal(viewport.width, 400);
  assert.equal(viewport.height, 600);
  assert.deepEqual([vierkant.x, vierkant.y, vierkant.width, vierkant.height], [100, 340, 80, 60]);
  assert.deepEqual([lijn.startX, lijn.startY, lijn.endX, lijn.endY], [50, 550, 150, 510]);
});

test('/UserUnit 2: the viewport reports scale 1, so radii and text sizes stay as they are', async () => {
  const { viewport } = await gelezen(await pdfMet({ userUnit: 2 }));
  assert.equal(viewport.scale, 1);
});

test('/UserUnit 3 with a CropBox and /Rotate 90: same result as without /UserUnit', async () => {
  const kenmerken = { rotate: 90, cropBox: [20, 30, 380, 570] };
  const met = await gelezen(await pdfMet({ userUnit: 3, ...kenmerken }));
  const zonder = await gelezen(await pdfMet(kenmerken));
  for (const k of ['x', 'y', 'width', 'height']) assert.equal(met.annots[0][k], zonder.annots[0][k], k);
  assert.equal(met.viewport.width, zonder.viewport.width);
  assert.equal(met.viewport.height, zonder.viewport.height);
});

test('without /UserUnit nothing changes', async () => {
  const { viewport, annots: [vierkant] } = await gelezen(await pdfMet({}));
  assert.equal(viewport.scale, 1);
  assert.deepEqual([vierkant.x, vierkant.y, vierkant.width, vierkant.height], [100, 340, 80, 60]);
});

test('with a zoom the viewport keeps the page size times the zoom, and reports the zoom', async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: (await pdfMet({ userUnit: 2 })).slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const viewport = paginaViewport(await doc.getPage(1), { scale: 1.5, rotation: 90 });
  await doc.loadingTask.destroy();
  assert.deepEqual([viewport.width, viewport.height, viewport.scale, viewport.rotation], [900, 600, 1.5, 90]);
});

for (const [naam, patroon] of [
  ['./loader.js', /\.getViewport\(\{ scale: 1 \}\)/g],
  ['./renderer.js', /page\.getViewport\(/g],
  ['../tools/pdf-snap-extractor.js', /page\.getViewport\(/g],
  ['../tools/embedded-image-detector.js', /page\.getViewport\(/g],
]) {
  test(`${naam} reads pages through this viewport`, () => {
    assert.deepEqual(readFileSync(new URL(naam, import.meta.url), 'utf8').match(patroon) ?? [], []);
  });
}
