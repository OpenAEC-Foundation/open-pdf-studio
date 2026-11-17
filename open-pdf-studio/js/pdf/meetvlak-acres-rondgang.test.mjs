// Een meetvlak in acres of hectares door opslaan en heropenen (GitHub #1129),
// met de echte saver en de echte lader.
//
// - De weergave-eenheid staat in de eigen sleutel OPS_AreaUnit; /A van het
//   /Measure-woordenboek draagt dezelfde eenheid met de factor vanuit de
//   lengte-eenheid van /X, zodat een ander programma dezelfde waarde toont.
// - Na heropenen toont het vlak weer acres; een vlak zonder eigen eenheid
//   krijgt geen sleutel en blijft zoals het was.
// - Een bestand van een ander programma met /A in acres (zonder de eigen
//   sleutel) opent ook in acres.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { PDFDocument, PDFName } from 'pdf-lib';

register('../core/app-test-hooks.mjs', import.meta.url);
register('./saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('./tekstvak-canvas.testhulp.mjs');
installeerCanvas();

const { state } = await import('../core/state.js');
const { savePDF } = await import('./saver.js');
const { convertPdfAnnotation } = await import('./loader/annotation-converter.js');
const { extractAnnotationColors } = await import('./loader/color-extraction.js');
const { decodePdfTextObject } = await import('./saver/pdf-text.js');
const meas = await import('../annotations/measurement.js');
const { oppervlakteFormaat } = await import('./saver/dimension-measure.js');

// Een terreintekening 1" = 100': 72 punt per 100 voet.
const VOET = { pixelsPerUnit: 72 / 100, unit: 'ft' };
const FT2 = (200 / 0.72) * (200 / 0.72);
const bijna = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

async function leegBlad() {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  return doc.save();
}

function openen(annotations, measureScale = VOET) {
  state.documents = [{
    id: 'acres', filePath: 'C:/rondgang/bron.pdf', pdfDoc: { numPages: 1 }, annotations,
    currentPage: 1, scale: 1, viewMode: 'single',
    selectedAnnotation: null, selectedAnnotations: [],
    undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
    pageRotations: {}, _annotationPagesReady: new Set([1]),
    textEdits: [], watermarks: [], bookmarks: [], measureScale,
  }];
  state.activeDocumentIndex = 0;
  return state.documents[0];
}

async function opslaan(bronBytes, doc) {
  let uit = null;
  globalThis.__saverTest = {
    impl: {
      getCachedPdfBytes: () => bronBytes,
      writeBinaryFile: (_pad, bytes) => { uit = bytes; return true; },
      writeBinaryFileAtomic: (_pad, bytes) => { uit = bytes; return true; },
    },
  };
  state.activeDocumentIndex = state.documents.indexOf(doc);
  assert.equal(await savePDF('C:/rondgang/uit.pdf', { zonderHandtekeningVraag: true }), true, 'opslaan gelukt');
  return uit;
}

async function laad(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const pagina = await doc.getPage(1);
  const viewport = pagina.getViewport({ scale: 1 });
  const kaart = await extractAnnotationColors(1, await PDFDocument.load(bytes.slice()));
  const modellen = [];
  for (const annot of await pagina.getAnnotations()) {
    modellen.push(await convertPdfAnnotation(annot, 1, viewport, new Map(), kaart));
  }
  await doc.loadingTask.destroy();
  return modellen.filter(Boolean);
}

/** Het polygoon-woordenboek van het meetvlak en zijn /A-opmaak. */
async function bestand(bytes) {
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  const [d] = doc.getPage(0).node.Annots().asArray().map((ref) => ctx.lookup(ref))
    .filter((x) => x.get(PDFName.of('Subtype'))?.toString() === '/Polygon');
  const tekst = (obj) => (obj ? decodePdfTextObject(ctx.lookup(obj) || obj) : null);
  const measure = ctx.lookup(d.get(PDFName.of('Measure')));
  const a = ctx.lookup(ctx.lookup(measure.get(PDFName.of('A'))).get(0));
  const x = ctx.lookup(ctx.lookup(measure.get(PDFName.of('X'))).get(0));
  return {
    doc, dict: d,
    contents: tekst(d.get(PDFName.of('Contents'))),
    areaUnit: tekst(d.get(PDFName.of('OPS_AreaUnit'))),
    A: { C: ctx.lookup(a.get(PDFName.of('C'))).asNumber(), U: tekst(a.get(PDFName.of('U'))) },
    X: { C: ctx.lookup(x.get(PDFName.of('C'))).asNumber(), U: tekst(x.get(PDFName.of('U'))) },
  };
}

function meetvlak(extra = {}) {
  return {
    id: 'ma1129', type: 'measureArea', page: 1,
    points: [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 300 }, { x: 100, y: 300 }],
    color: '#ff0000', strokeColor: '#ff0000', fillColor: null, lineWidth: 1, opacity: 1,
    borderStyle: 'solid', hatchPattern: 'none', author: 'Tester',
    createdAt: '2026-10-01T10:00:00.000Z', modifiedAt: '2026-10-01T10:00:00.000Z',
    ...extra,
  };
}

test('/A of the measure dictionary: the factor from the length unit to the display unit', () => {
  assert.deepEqual(oppervlakteFormaat('ft'), { C: 1, U: 'ft²' });
  assert.deepEqual(oppervlakteFormaat('mm'), { C: 1e-6, U: 'm²' });
  assert.deepEqual(oppervlakteFormaat('ft', 'ac'), { C: 1 / 43_560, U: 'ac' });
  assert.deepEqual(oppervlakteFormaat('m', 'ha'), { C: 1e-4, U: 'ha' });
  assert.deepEqual(oppervlakteFormaat('mm', 'ha'), { C: 1e-10, U: 'ha' });
  assert.deepEqual(oppervlakteFormaat('px', 'ac'), { C: 1, U: 'px²' }, 'pixels cannot be converted');
});

test('an area in acres on a sheet in feet survives save and reopen', async () => {
  const bron = await leegBlad();
  const doc = openen([meetvlak({ measureAreaUnit: 'ac' })]);
  const ann = doc.annotations[0];
  meas.herberekenVlakMaat(ann);
  assert.equal(ann.measureText, `${(FT2 / 43_560).toFixed(3)} ac`);
  assert.equal(ann.measureText, '1.771 ac');

  const bytes = await opslaan(bron, doc);
  const f = await bestand(bytes);
  assert.equal(f.contents, '1.771 ac');
  assert.equal(f.areaUnit, 'ac');
  assert.equal(f.X.U, 'ft');
  assert.equal(f.A.U, 'ac');
  assert.ok(bijna(f.A.C, 1 / 43_560), 'another reader converts ft² to acres with /A');

  const [terug] = await laad(bytes);
  assert.equal(terug.type, 'measureArea');
  assert.equal(terug.measureAreaUnit, 'ac');
  assert.equal(terug.measureText, '1.771 ac');
  // Opnieuw rekenen op het heropende vlak geeft dezelfde acres.
  openen([terug]);
  meas.herberekenVlakMaat(terug);
  assert.equal(terug.measureText, '1.771 ac');
  assert.equal(terug.measureUnit, 'ft²');
  assert.ok(bijna(terug.measureValue, FT2, 1e-6));
});

test('an area with its own scale in metres, shown in hectares, survives save and reopen', async () => {
  const bron = await leegBlad();
  // Eigen schaal: 0,5 m per punt; 200 × 200 punt = 100 × 100 m = 1 ha.
  const doc = openen([meetvlak({ measureScale: 0.5, measureUnit: 'm²', measureAreaUnit: 'ha' })]);
  const ann = doc.annotations[0];
  meas.herberekenVlakMaat(ann);
  assert.equal(ann.measureText, '1.000 ha');

  const bytes = await opslaan(bron, doc);
  const f = await bestand(bytes);
  assert.equal(f.areaUnit, 'ha');
  assert.deepEqual(f.A, { C: 1e-4, U: 'ha' });
  assert.deepEqual(f.X, { C: 0.5, U: 'm' });

  const [terug] = await laad(bytes);
  assert.equal(terug.measureAreaUnit, 'ha');
  assert.equal(terug.measureScale, 0.5, 'the own scale is kept in the length unit');
  assert.equal(terug.measureUnit, 'm²');
  openen([terug]);
  meas.herberekenVlakMaat(terug);
  assert.equal(terug.measureText, '1.000 ha');
  assert.ok(bijna(terug.measureValue, 10_000));
});

test('an area without its own unit is saved as before', async () => {
  const bron = await leegBlad();
  const doc = openen([meetvlak()]);
  meas.herberekenVlakMaat(doc.annotations[0]);
  const bytes = await opslaan(bron, doc);
  const f = await bestand(bytes);
  assert.equal(f.areaUnit, null, 'no key without a choice');
  assert.deepEqual(f.A, { C: 1, U: 'ft²' });
  const [terug] = await laad(bytes);
  assert.equal('measureAreaUnit' in terug, false);
  assert.equal(terug.measureText, doc.annotations[0].measureText);
});

test('a file from another program with /A in acres opens in acres', async () => {
  const bron = await leegBlad();
  const doc = openen([meetvlak({ measureAreaUnit: 'ac' })]);
  meas.herberekenVlakMaat(doc.annotations[0]);
  const f = await bestand(await opslaan(bron, doc));
  // Zonder de eigen sleutels van de app blijft alleen het standaard /Measure over.
  for (const sleutel of ['OPS_AreaUnit', 'OPS_Subtype', 'OPS_ScaleInherited']) f.dict.delete(PDFName.of(sleutel));
  const [terug] = await laad(await f.doc.save());
  assert.equal(terug.type, 'measureArea');
  assert.equal(terug.measureAreaUnit, 'ac');
  assert.equal(terug.measureUnit, 'ft²', 'the length unit comes from /X');
  openen([terug]);
  meas.herberekenVlakMaat(terug);
  assert.equal(terug.measureText, '1.771 ac');
});
