// A document whose pages differ in /UserUnit, with one document scale 1:N
// (release gate 2026.44.6). The ratio says how paper relates to reality, so it
// holds on every page, while one page unit is UserUnit/72 inch on that page.
// The stored pixelsPerUnit used to be applied as it was: calibrating on the
// /UserUnit 2 page gave its value to all pages, calibrating on the other page
// gave that value to all pages. 72 units are 50.8 mm of paper on /UserUnit 2
// and 25.4 mm on /UserUnit 1, wherever the scale was set.
//
// The PDFs are real (pdf-lib); the /UserUnit is read the way the loader does.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('../core/state.ts');
const { DEFAULT_PREFERENCES } = await import('../core/constants.ts');
const meting = await import('./measurement.js');
const { schaalUitKalibratie } = await import('./kalibratie-schaal.js');
const { measureScaleFromTitleBlock } = await import('./document-scale.js');
const { documentSchaalOpPagina, pixelsPerUnitFor } = await import('./scale-region-scale.js');
const { schaalOpPunt } = await import('./schaal-op-punt.js');
const { createScaleBar } = await import('./scale-bar.js');
const { getViewportScaleFactor } = await import('./dynamic-scaling.js');
const { schrijfOpslagJson, verwijderOpslag } = await import('../core/opslag.js');
const { dimensionMeasure, writeDimensionMeasure } = await import('../pdf/saver/dimension-measure.js');
const { meetschaalOp } = await import('../pdf/cad-export.js');
const { leesPdfViewports, leesUserUnits, beginViewportLezing, rondViewportLezingAf, herschikViewports } = await import('../pdf/pdf-viewports.js');

const bijna = (a, b, tekst = '') => assert.ok(Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b)), `${tekst}: ${a} is not ${b}`);

// 72 page units in real millimetres at 1:50.
const MM_UU2 = 72 * 2 * (25.4 / 72) * 50;
const MM_UU1 = 72 * (25.4 / 72) * 50;

/** A real PDF with the given /UserUnit per page; 1 leaves the key out. */
async function pdfMet(userUnits) {
  const pdf = await PDFDocument.create();
  for (const u of userUnits) {
    const page = pdf.addPage([400, 400]);
    if (u !== 1) page.node.set(PDFName.of('UserUnit'), pdf.context.obj(u));
  }
  return pdf.save();
}

/** Opens the bytes the way the loader reads them, as the active document. */
async function openen(bytes, extra = {}) {
  const pdfLib = await PDFDocument.load(bytes);
  const doc = {
    id: `doc-${Math.random().toString(36).slice(2, 8)}`, filePath: null, pdfDoc: { numPages: pdfLib.getPageCount() },
    currentPage: 1, scale: 1, viewMode: 'single', annotations: [], selectedAnnotation: null, selectedAnnotations: [],
    undoStack: [], redoStack: [], textEdits: [], watermarks: [], bookmarks: [], pageRotations: {}, measureScale: null,
    ...extra,
  };
  const kenmerk = beginViewportLezing(doc);
  rondViewportLezingAf(doc, kenmerk, leesPdfViewports(pdfLib), leesUserUnits(pdfLib));
  state.documents = [doc];
  state.activeDocumentIndex = 0;
  return state.documents[0];
}

const lengteOp = (pagina) => meting.calculateDistance(10, 50, 82, 50, pagina).value;

function kalibreerOp(doc, pagina, denominator = 50, unit = 'mm') {
  doc.currentPage = pagina;
  doc.measureScale = schaalUitKalibratie({
    method: 'ratio', denominator, unit, userUnit: doc.pageUserUnits?.[pagina] ?? 1,
  });
}

test.beforeEach(() => {
  state.preferences = { ...DEFAULT_PREFERENCES };
});

for (const [userUnits, naam] of [[[2, 1], '/UserUnit 2 first'], [[1, 2], '/UserUnit 2 last']]) {
  const verwacht = (pagina) => (userUnits[pagina - 1] === 2 ? MM_UU2 : MM_UU1);

  for (const calibratiePagina of [1, 2]) {
    test(`${naam}, calibrated on page ${calibratiePagina}: each page measures in its own units`, async () => {
      const doc = await openen(await pdfMet(userUnits));
      kalibreerOp(doc, calibratiePagina);
      bijna(lengteOp(1), verwacht(1), 'page 1');
      bijna(lengteOp(2), verwacht(2), 'page 2');
      // Without a point (the status bar, a preview): the page in view.
      for (const pagina of [1, 2]) {
        doc.currentPage = pagina;
        bijna(72 / meting.getMeasureScale().pixelsPerUnit, verwacht(pagina), `current page ${pagina}`);
      }
    });
  }

  test(`${naam}: the title block scale of page 1 also holds on page 2`, async () => {
    const doc = await openen(await pdfMet(userUnits));
    doc.measureScale = measureScaleFromTitleBlock({ ratio: 50, userUnit: userUnits[0] });
    bijna(lengteOp(1), verwacht(1), 'page 1');
    bijna(lengteOp(2), verwacht(2), 'page 2');
  });

  test(`${naam}: the unit of the scale applies on both pages`, async () => {
    const doc = await openen(await pdfMet(userUnits));
    kalibreerOp(doc, 2, 50, 'cm');
    bijna(lengteOp(1), verwacht(1) / 10, 'cm page 1');
    bijna(lengteOp(2), verwacht(2) / 10, 'cm page 2');
    kalibreerOp(doc, 1, 50, 'ft');
    bijna(lengteOp(1), verwacht(1) / 304.8, 'ft page 1');
    bijna(lengteOp(2), verwacht(2) / 304.8, 'ft page 2');
  });
}

test('recalculating updates distance, area and perimeter with the scale of their own page', async () => {
  const doc = await openen(await pdfMet([2, 1]));
  const vierkant = [{ x: 0, y: 0 }, { x: 72, y: 0 }, { x: 72, y: 72 }, { x: 0, y: 72 }];
  for (const page of [1, 2]) {
    doc.annotations.push(
      { id: `d${page}`, type: 'measureDistance', page, startX: 10, startY: 50, endX: 82, endY: 50 },
      { id: `a${page}`, type: 'measureArea', page, points: vierkant },
      { id: `p${page}`, type: 'measurePerimeter', page, points: vierkant.slice(0, 2) },
    );
  }
  kalibreerOp(doc, 2);
  meting.recalculateAllMeasurements();
  const van = (id) => doc.annotations.find((a) => a.id === id).measureValue;
  bijna(van('d1'), MM_UU2, 'distance page 1');
  bijna(van('d2'), MM_UU1, 'distance page 2');
  bijna(van('p1'), MM_UU2, 'perimeter page 1');
  bijna(van('p2'), MM_UU1, 'perimeter page 2');
  bijna(van('a1'), MM_UU2 ** 2, 'area page 1');
  bijna(van('a2'), MM_UU1 ** 2, 'area page 2');
});

test('the other readers of the document scale work per page too', async () => {
  const doc = await openen(await pdfMet([2, 1]));
  kalibreerOp(doc, 2);

  // Saved /Measure and the shared lookup.
  bijna(dimensionMeasure({ page: 1, startX: 0, startY: 0, endX: 72, endY: 0 }, doc).scale * 72, MM_UU2, '/Measure page 1');
  bijna(dimensionMeasure({ page: 2, startX: 0, startY: 0, endX: 72, endY: 0 }, doc).scale * 72, MM_UU1, '/Measure page 2');
  bijna(72 / schaalOpPunt(doc, 1, 5, 5).pixelsPerUnit, MM_UU2, 'lookup page 1');
  bijna(72 / schaalOpPunt(doc, 2, 5, 5).pixelsPerUnit, MM_UU1, 'lookup page 2');

  // The CAD export counts one page unit as one point, like a scale region.
  const rect = { x: 0, y: 0, width: 10, height: 10 };
  bijna(meetschaalOp(1, rect), 100, 'export page 1');
  bijna(meetschaalOp(2, rect), 50, 'export page 2');

  // A new scale bar is real length on the page it is placed on.
  doc.currentPage = 1;
  bijna(createScaleBar(0, 0).pixelsPerUnit, pixelsPerUnitFor('1:50', 'mm', 2), 'scale bar page 1');
  doc.currentPage = 2;
  bijna(createScaleBar(0, 0).pixelsPerUnit, pixelsPerUnitFor('1:50', 'mm', 1), 'scale bar page 2');

  // Dynamic scaling: the document scale itself needs no correction anywhere,
  // and a 1:25 viewport is twice the detail on both pages.
  assert.equal(getViewportScaleFactor(1, 5, 5), 1);
  assert.equal(getViewportScaleFactor(2, 5, 5), 1);
  for (const page of [1, 2]) {
    doc.annotations.push({ id: `vp${page}`, type: 'viewport', page, x: 0, y: 0, width: 100, height: 100,
      scaleRatio: '1:25', unit: 'mm', pixelsPerUnit: pixelsPerUnitFor('1:25', 'mm', page === 1 ? 2 : 1) });
  }
  bijna(getViewportScaleFactor(1, 5, 5), 0.5, 'viewport page 1');
  bijna(getViewportScaleFactor(2, 5, 5), 0.5, 'viewport page 2');
});

/** Adds a dimension with an inherited scale to each page, as the saver writes it. */
async function metMaatlijnen(bytes, doc) {
  const pdf = await PDFDocument.load(bytes);
  pdf.getPages().forEach((page, i) => {
    const ann = { page: i + 1, startX: 10, startY: 50, endX: 82, endY: 50, measureText: 'x' };
    const dict = pdf.context.obj({ Type: 'Annot', Subtype: 'Line', IT: PDFName.of('LineDimension'),
      OPS_Subtype: PDFString.of('measureDistance'), Rect: [0, 300, 100, 360], L: [10, 350, 82, 350] });
    writeDimensionMeasure(dict, pdf.context, ann, doc);
    page.node.set(PDFName.of('Annots'), pdf.context.obj([pdf.context.register(dict)]));
  });
  return pdf.save();
}

function geschrevenSchaal(pdf, pagina) {
  const lijn = pdf.context.lookup(pdf.getPage(pagina - 1).node.Annots().get(0));
  const measure = lijn.lookup(PDFName.of('Measure'));
  const x = pdf.context.lookup(measure.get(PDFName.of('X'))).lookup(0);
  return { c: x.get(PDFName.of('C')).asNumber(), geerfd: lijn.get(PDFName.of('OPS_ScaleInherited'))?.toString() };
}

for (const calibratiePagina of [1, 2]) {
  test(`save, reopen and measure again after calibrating on page ${calibratiePagina}`, async () => {
    const filePath = `C:/test/gemengd-${calibratiePagina}.pdf`;
    const doc = await openen(await pdfMet([2, 1]), { filePath });
    kalibreerOp(doc, calibratiePagina);
    meting.saveDocumentScale(doc);
    try {
      const opgeslagen = await metMaatlijnen(await pdfMet([2, 1]), doc);

      // What the file says for other readers: per unit of its own page.
      const bestand = await PDFDocument.load(opgeslagen);
      const p1 = geschrevenSchaal(bestand, 1);
      const p2 = geschrevenSchaal(bestand, 2);
      bijna(p1.c * 72, MM_UU2, '/X /C page 1');
      bijna(p2.c * 72, MM_UU1, '/X /C page 2');
      assert.equal(p1.geerfd, 'true');
      assert.equal(p2.geerfd, 'true');

      // Reopened: the same /UserUnit from the file, the scale from storage.
      const heropend = await openen(opgeslagen, { filePath });
      assert.deepEqual(heropend.pageUserUnits, { 1: 2 });
      assert.equal(heropend.measureScale, null);
      meting.loadDocumentScale(heropend);
      assert.equal(heropend.measureScale.scaleRatio, '1:50');
      bijna(lengteOp(1), MM_UU2, 'reopened page 1');
      bijna(lengteOp(2), MM_UU1, 'reopened page 2');
    } finally {
      meting.saveDocumentScale({ filePath, measureScale: null });
    }
  });
}

// What earlier versions stored: 2026.44.6 with the page's /UserUnit in
// pixelsPerUnit, before #884 without it. The ratio and unit are in all of them.
const OPGESLAGEN_SCHALEN = [
  ['calibrated on the /UserUnit 2 page', { pixelsPerUnit: pixelsPerUnitFor('1:50', 'mm', 2), unit: 'mm', method: 'ratio', scaleRatio: '1:50' }],
  ['calibrated on the /UserUnit 1 page', { pixelsPerUnit: pixelsPerUnitFor('1:50', 'mm', 1), unit: 'mm', method: 'ratio', scaleRatio: '1:50' }],
  ['from the title block of a /UserUnit 2 page', { pixelsPerUnit: pixelsPerUnitFor('1:50', 'mm', 2), unit: 'mm', method: 'auto-detect', scaleRatio: '1:50' }],
];
for (const [naam, schaal] of OPGESLAGEN_SCHALEN) {
  test(`a scale stored by an earlier version, ${naam}, is right on both pages`, async () => {
    const filePath = `C:/test/oud-${naam}.pdf`;
    schrijfOpslagJson(`ops_measureScale_${filePath}`, schaal);
    try {
      const doc = await openen(await pdfMet([2, 1]), { filePath });
      meting.loadDocumentScale(doc);
      assert.deepEqual({ ...doc.measureScale }, schaal);
      bijna(lengteOp(1), MM_UU2, 'page 1');
      bijna(lengteOp(2), MM_UU1, 'page 2');
    } finally {
      verwijderOpslag(`ops_measureScale_${filePath}`);
    }
  });
}

test('the stored scale keeps its pixelsPerUnit: nothing rewrites it while measuring', async () => {
  const doc = await openen(await pdfMet([2, 1]));
  kalibreerOp(doc, 1);
  const voor = JSON.stringify(doc.measureScale);
  lengteOp(2);
  documentSchaalOpPagina(doc, 2);
  assert.equal(JSON.stringify(doc.measureScale), voor);
  bijna(doc.measureScale.pixelsPerUnit, pixelsPerUnitFor('1:50', 'mm', 2));
});

test('a scale without a ratio stays as stored, in page units', async () => {
  const doc = await openen(await pdfMet([2, 1]));
  for (const schaal of [
    { pixelsPerUnit: 3, unit: 'mm', method: 'reference', scaleRatio: null },
    { pixelsPerUnit: 3, unit: 'mm', method: 'quick-scale', scaleRatio: 0 },
    { pixelsPerUnit: 3, unit: 'mm', method: 'scaleBar', scaleRatio: 0 },
    { pixelsPerUnit: 3, unit: 'mm', method: 'manual', scaleRatio: 0 },
    { pixelsPerUnit: 3, unit: 'mm' },
  ]) {
    doc.measureScale = schaal;
    assert.equal(documentSchaalOpPagina(doc, 1).pixelsPerUnit, 3);
    assert.equal(documentSchaalOpPagina(doc, 2).pixelsPerUnit, 3);
  }
  doc.measureScale = { pixelsPerUnit: 0, unit: 'mm', method: 'ratio', scaleRatio: '1:50' };
  assert.equal(documentSchaalOpPagina(doc, 1), null, 'no usable scale');
  doc.measureScale = null;
  assert.equal(documentSchaalOpPagina(doc, 1), null);
});

test('while the /UserUnit per page is not known, the stored value is the best there is', () => {
  // A /UserUnit 2 sheet just opened: the title block is read through PDF.js,
  // the /UserUnit per page is still being read, or could not be read at all.
  const schaal = measureScaleFromTitleBlock({ ratio: 50, userUnit: 2 });
  const doc = { measureScale: schaal };
  assert.equal(documentSchaalOpPagina(doc, 1).pixelsPerUnit, schaal.pixelsPerUnit);

  const kenmerk = beginViewportLezing(doc);
  assert.equal(documentSchaalOpPagina(doc, 1).pixelsPerUnit, schaal.pixelsPerUnit);
  rondViewportLezingAf(doc, kenmerk, null);
  assert.equal(documentSchaalOpPagina(doc, 1).pixelsPerUnit, schaal.pixelsPerUnit, 'failed read');

  // Pages that cannot be listed say nothing about the /UserUnit.
  const onleesbaar = { getPages() { throw new Error('broken page tree'); } };
  assert.equal(leesUserUnits(onleesbaar), null);
  rondViewportLezingAf(doc, beginViewportLezing(doc), {}, leesUserUnits(onleesbaar));
  assert.equal(documentSchaalOpPagina(doc, 1).pixelsPerUnit, schaal.pixelsPerUnit, 'unreadable pages');

  // Known: /UserUnit 2 everywhere gives the same value as stored.
  rondViewportLezingAf(doc, beginViewportLezing(doc), {}, { 1: 2 });
  bijna(documentSchaalOpPagina(doc, 1).pixelsPerUnit, schaal.pixelsPerUnit, 'known');
});

test('once read, no /UserUnit at all means 1 on every page, also after the /UserUnit 2 pages left', async () => {
  const doc = await openen(await pdfMet([2, 1]));
  kalibreerOp(doc, 1);
  // Page 1 (/UserUnit 2) is deleted; the old page 2 becomes page 1.
  doc.pageUserUnits = herschikViewports(doc.pageUserUnits, { 1: null, 2: 1 });
  assert.equal(doc.pageUserUnits, undefined);
  bijna(lengteOp(1), MM_UU1, 'the remaining page');
});

test('the /UserUnit follows a page that moves, and the scale with it', async () => {
  const doc = await openen(await pdfMet([2, 1]));
  kalibreerOp(doc, 1);
  doc.pageUserUnits = herschikViewports(doc.pageUserUnits, { 1: 2, 2: 1 });
  bijna(lengteOp(1), MM_UU1, 'now page 1');
  bijna(lengteOp(2), MM_UU2, 'now page 2');
});

test('a document with one /UserUnit keeps measuring as before', async () => {
  for (const u of [1, 2]) {
    const doc = await openen(await pdfMet([u, u]));
    kalibreerOp(doc, 1);
    const verwacht = u === 2 ? MM_UU2 : MM_UU1;
    bijna(lengteOp(1), verwacht, `page 1, /UserUnit ${u}`);
    bijna(lengteOp(2), verwacht, `page 2, /UserUnit ${u}`);
    bijna(documentSchaalOpPagina(doc, 2).pixelsPerUnit, doc.measureScale.pixelsPerUnit);
  }
});
