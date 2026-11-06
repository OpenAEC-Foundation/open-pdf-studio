// Tekstballon in een PDF-viewport met meetschaal (#981).
//
// Een tekening met een /VP + /Measure in meters (zoals een CAD-plot, of de
// demoplattegrond uit scripts/readme-demo-pdfs.mjs) en een documentschaal 1:50
// uit de titelhoek in millimeters. De dynamische markeringsschaal vergeleek de
// pixelsPerUnit van beide zonder naar de eenheid te kijken: 56,7 per meter
// tegen 0,0567 per millimeter leek duizend keer zoveel detail, en een nieuwe
// tekstballon met de punt in de viewport kreeg de minimale tekstgrootte in
// plaats van de voorkeur calloutFontSize.
//
// De PDF is echt (pdf-lib); de viewports worden gelezen zoals de loader dat doet.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { PDFDocument, PDFName, PDFNumber, PDFString } from 'pdf-lib';

register('../core/app-test-hooks.mjs', import.meta.url);
register('../pdf/saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('../core/state.ts');
const { measureScaleFromTitleBlock } = await import('./document-scale.js');
const { pixelsPerUnitFor } = await import('./scale-region-scale.js');
const { getViewportScaleFactor, pixelsPerMm } = await import('./dynamic-scaling.js');
const { createAnnotationFromTool } = await import('../tools/annotation-creators.js');
const { leesPdfViewports, leesUserUnits, beginViewportLezing, rondViewportLezingAf } = await import('../pdf/pdf-viewports.js');

const bijna = (a, b, tekst = '') => assert.ok(Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b)), `${tekst}: ${a} is not ${b}`);

// Paginapunten per meter op 1:50, zoals de demoplattegrond.
const PT_PER_M = (1000 / 50) * (72 / 25.4);
// Viewport in PDF-ruimte; A3 liggend.
const A3 = [1190.55, 841.89];
const VP_BBOX = [100, 100, 100 + 14 * PT_PER_M, 100 + 9 * PT_PER_M];

/** Een A3-pagina met een /VP met /Measure in meters, zoals een CAD-plot. */
async function plattegrondPdf({ eenheid = 'm', perPunt = 1 / PT_PER_M, ratio = '1:50' } = {}) {
  const pdf = await PDFDocument.create();
  const p = pdf.addPage(A3);
  const ctx = pdf.context;
  const getal = (u, c) => ctx.obj({ Type: 'NumberFormat', U: PDFString.of(u), C: PDFNumber.of(c), D: 100 });
  const meet = ctx.obj({
    Type: 'Measure', Subtype: 'RL', R: PDFString.of(ratio),
    X: [getal(eenheid, perPunt)], D: [getal(eenheid, 1)], A: [getal(`sq ${eenheid}`, 1)],
  });
  const vp = ctx.obj({ Type: 'Viewport', BBox: VP_BBOX, Name: PDFString.of('Plan'), Measure: meet });
  p.node.set(PDFName.of('VP'), ctx.obj([vp]));
  return PDFDocument.load(await pdf.save());
}

async function openen(pdfLib, measureScale) {
  const doc = {
    id: `doc-${Math.random().toString(36).slice(2, 8)}`, filePath: null, pdfDoc: { numPages: 1 },
    currentPage: 1, scale: 1, viewMode: 'single', annotations: [], selectedAnnotation: null,
    selectedAnnotations: [], undoStack: [], redoStack: [], textEdits: [], watermarks: [], bookmarks: [],
    pageRotations: {}, measureScale,
  };
  const kenmerk = beginViewportLezing(doc);
  rondViewportLezingAf(doc, kenmerk, leesPdfViewports(pdfLib), leesUserUnits(pdfLib));
  state.documents = [doc];
  state.activeDocumentIndex = 0;
  return doc;
}

/** Een punt midden in de viewport, in app-ruimte (y omlaag). */
function inViewport(doc) {
  const vp = doc.pdfViewports[1][0];
  return { x: vp.x + vp.width / 2, y: vp.y + vp.height / 2 };
}

test('pixelsPerMm rekent elke eenheid om naar paginaeenheden per mm', () => {
  bijna(pixelsPerMm({ pixelsPerUnit: PT_PER_M, unit: 'm' }), PT_PER_M / 1000, 'm');
  bijna(pixelsPerMm({ pixelsPerUnit: pixelsPerUnitFor('1:50', 'mm'), unit: 'mm' }), PT_PER_M / 1000, 'mm');
  bijna(pixelsPerMm({ pixelsPerUnit: pixelsPerUnitFor('1:50', 'cm'), unit: 'cm' }), PT_PER_M / 1000, 'cm');
  bijna(pixelsPerMm({ pixelsPerUnit: pixelsPerUnitFor('1:50', 'ft'), unit: 'ft' }), PT_PER_M / 1000, 'ft');
  assert.equal(pixelsPerMm({ pixelsPerUnit: 0, unit: 'mm' }), null);
  assert.equal(pixelsPerMm({ pixelsPerUnit: 1, unit: 'parsec' }), null);
});

test('#981: een 1:50-viewport in meters in een 1:50-document in mm schaalt niets', async () => {
  const doc = await openen(await plattegrondPdf(), measureScaleFromTitleBlock({ ratio: 50 }));
  const vp = doc.pdfViewports[1][0];
  assert.equal(vp.unit, 'm', 'de viewport telt in meters');
  const { x, y } = inViewport(doc);
  assert.equal(getViewportScaleFactor(1, x, y), 1);
});

test('#981: een nieuwe tekstballon in de viewport krijgt de voorkeursgrootte', async () => {
  const doc = await openen(await plattegrondPdf(), measureScaleFromTitleBlock({ ratio: 50 }));
  const { x, y } = inViewport(doc);
  const oud = state.preferences.calloutFontSize;
  const oudeDynamiek = state.preferences.dynamicMarkupScaling;
  try {
    state.preferences.dynamicMarkupScaling = true;
    for (const grootte of [10, 14, 20]) {
      state.preferences.calloutFontSize = grootte;
      // Punt en tekstvak allebei in de viewport.
      const binnen = createAnnotationFromTool('callout', x, y, x + 40, y + 30, null);
      assert.equal(binnen.fontSize, grootte, `in de viewport (${grootte} pt)`);
      assert.equal(binnen.viewportScaleFactor, undefined);
      // Buiten de viewport (links boven op het blad) net zo.
      const buiten = createAnnotationFromTool('callout', 20, 20, 60, 50, null);
      assert.equal(buiten.fontSize, grootte, `buiten de viewport (${grootte} pt)`);
    }
    assert.equal(doc.annotations.length, 0);
  } finally {
    state.preferences.calloutFontSize = oud;
    state.preferences.dynamicMarkupScaling = oudeDynamiek;
  }
});

test('een echt grotere detailschaal blijft dynamisch schalen, ook met andere eenheden', async () => {
  // Detail 1:25 in meters in een document 1:50 in mm: twee keer zoveel detail.
  const doc = await openen(
    await plattegrondPdf({ perPunt: 1 / (2 * PT_PER_M), ratio: '1:25' }),
    measureScaleFromTitleBlock({ ratio: 50 }),
  );
  const { x, y } = inViewport(doc);
  bijna(getViewportScaleFactor(1, x, y), 0.5, 'factor');
  const oud = state.preferences.calloutFontSize;
  try {
    state.preferences.calloutFontSize = 20;
    const ann = createAnnotationFromTool('callout', x, y, x + 40, y + 30, null);
    assert.equal(ann.fontSize, 10);
  } finally {
    state.preferences.calloutFontSize = oud;
  }
});
