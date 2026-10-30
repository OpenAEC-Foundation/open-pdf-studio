// Hoekpunten van een meetvlak direct bewerken (#872): toevoegen op een zijde
// en weghalen, met de echte app-modules, de echte saver en de echte lader.
//
// - Eén bewerking is één ongedaan-stap; opnieuw zet hem terug, inclusief de
//   oppervlaktetekst.
// - Na opslaan en heropenen staan dezelfde hoekpunten in /Vertices, in de
//   appearance-stream en in het heropende model, ook op een pagina met
//   /Rotate 90, 180 en 270, en voor een gat (/OPS_Holes).

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
const undo = await import('../core/undo-manager.js');
const { savePDF } = await import('./saver.js');
const { convertPdfAnnotation } = await import('./loader/annotation-converter.js');
const { extractAnnotationColors } = await import('./loader/color-extraction.js');
const meas = await import('../annotations/measurement.js');
const { areaVertexHit } = await import('../annotations/area-vertices.js');
const { applyAreaVertexEdit } = await import('../tools/area-vertex-editing.js');

async function leegBlad(rotatie) {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([595, 842]);
  if (rotatie) pagina.node.set(PDFName.of('Rotate'), doc.context.obj(rotatie));
  return doc.save();
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

function openen(annotations) {
  state.documents = [{
    id: 'hoekpunten', filePath: 'C:/rondgang/bron.pdf', pdfDoc: { numPages: 1 }, annotations,
    currentPage: 1, scale: 1, viewMode: 'single',
    selectedAnnotation: annotations[0] || null, selectedAnnotations: annotations.slice(0, 1),
    undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
    pageRotations: {}, _annotationPagesReady: new Set([1]),
    textEdits: [], watermarks: [], bookmarks: [], measureScale: null,
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

/** /Vertices, /OPS_Holes en de ringen (m … l … h) uit de appearance. */
async function bestand(bytes) {
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  const [d] = doc.getPage(0).node.Annots().asArray().map((ref) => ctx.lookup(ref))
    .filter((x) => x.get(PDFName.of('Subtype'))?.toString() === '/Polygon');
  const getallen = (arr) => ctx.lookup(arr).asArray().map((x) => ctx.lookup(x).asNumber());
  const paren = (lijst) => { const uit = []; for (let i = 0; i < lijst.length; i += 2) uit.push([lijst[i], lijst[i + 1]]); return uit; };
  const vertices = paren(getallen(d.get(PDFName.of('Vertices'))));
  const holesObj = d.get(PDFName.of('OPS_Holes'));
  const holes = holesObj ? ctx.lookup(holesObj).asArray().map((h) => paren(getallen(h))) : [];
  const n = ctx.lookup(ctx.lookup(d.get(PDFName.of('AP'))).get(PDFName.of('N')));
  const ap = new TextDecoder().decode(n.getContents());
  const ringen = [...ap.matchAll(/(-?[\d.]+) (-?[\d.]+) m\n((?:-?[\d.]+ -?[\d.]+ l\n)*)h\n/g)].map((m) => [
    [+m[1], +m[2]],
    ...[...m[3].matchAll(/(-?[\d.]+) (-?[\d.]+) l/g)].map((l) => [+l[1], +l[2]]),
  ]);
  return { vertices, holes, ringen };
}

const bijna = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
function zelfdeRing(a, b, wat) {
  assert.equal(a.length, b.length, `${wat}: aantal hoekpunten`);
  a.forEach((p, i) => {
    const q = b[i];
    const [px, py] = Array.isArray(p) ? p : [p.x, p.y];
    const [qx, qy] = Array.isArray(q) ? q : [q.x, q.y];
    assert.ok(bijna(px, qx) && bijna(py, qy), `${wat}: hoekpunt ${i} (${px},${py}) ≠ (${qx},${qy})`);
  });
}

function meetvlak() {
  const ann = {
    id: 'ma872', type: 'measureArea', page: 1,
    points: [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 300 }, { x: 100, y: 300 }],
    holes: [[{ x: 150, y: 150 }, { x: 200, y: 150 }, { x: 200, y: 200 }, { x: 150, y: 200 }]],
    color: '#ff0000', strokeColor: '#ff0000', fillColor: null, lineWidth: 1, opacity: 1,
    borderStyle: 'solid', hatchPattern: 'none', author: 'Tester',
    createdAt: '2026-10-01T10:00:00.000Z', modifiedAt: '2026-10-01T10:00:00.000Z',
  };
  return ann;
}

test('één bewerking is één ongedaan-stap; opnieuw zet punten en oppervlakte terug', async () => {
  const doc = openen([meetvlak()]);
  const ann = doc.annotations[0];
  meas.herberekenVlakMaat(ann);
  const tekstVoor = ann.measureText;
  const waardeVoor = ann.measureValue;
  assert.equal(applyAreaVertexEdit(ann, areaVertexHit(ann, 300, 300, 4)), true, 'hoek weg');
  assert.equal(ann.points.length, 3);
  assert.ok(ann.measureValue < waardeVoor, 'de oppervlakte volgt direct');
  assert.notEqual(ann.measureText, tekstVoor, 'het label volgt direct');
  const tekstNa = ann.measureText;
  assert.equal(doc.undoStack.length, 1, 'één stap');
  await undo.undo();
  const terug = state.documents[0].annotations[0];
  assert.equal(terug.points.length, 4);
  assert.equal(terug.measureText, tekstVoor);
  await undo.redo();
  const weer = state.documents[0].annotations[0];
  assert.equal(weer.points.length, 3);
  assert.equal(weer.measureText, tekstNa);
});

for (const rotatie of [0, 90, 180, 270]) {
  test(`opslaan en heropenen na bewerken op /Rotate ${rotatie}: /Vertices, appearance en model gelijk`, async () => {
    const bron = await leegBlad(rotatie);
    const doc = openen([meetvlak()]);
    const ann = doc.annotations[0];
    meas.herberekenVlakMaat(ann);
    // Rechtsklik-invoegen op de cursor, dubbelklik-invoegen in het midden,
    // een hoek weg, en een punt op de zijde van het gat.
    assert.equal(applyAreaVertexEdit(ann, areaVertexHit(ann, 170, 101, 4)), true);
    assert.equal(applyAreaVertexEdit(ann, areaVertexHit(ann, 301, 220, 4), true), true);
    assert.equal(applyAreaVertexEdit(ann, areaVertexHit(ann, 100, 300, 4)), true);
    assert.equal(applyAreaVertexEdit(ann, areaVertexHit(ann, 175, 151, 4)), true);
    assert.deepEqual(ann.points.map((p) => [p.x, p.y]), [[100, 100], [170, 100], [300, 100], [300, 200], [300, 300]]);
    assert.equal(ann.holes[0].length, 5);
    const waarde = ann.measureValue;
    const punten = ann.points.map((p) => ({ x: p.x, y: p.y }));
    const gat = ann.holes[0].map((p) => ({ x: p.x, y: p.y }));

    const bytes = await opslaan(bron, doc);
    const { vertices, holes, ringen } = await bestand(bytes);
    assert.equal(vertices.length, 5, '/Vertices heeft de nieuwe hoekpunten');
    assert.equal(holes.length, 1);
    assert.equal(holes[0].length, 5);
    assert.equal(ringen.length, 2, 'buitenring en gat in de appearance');
    zelfdeRing(ringen[0], vertices, 'appearance = /Vertices');
    zelfdeRing(ringen[1], holes[0], 'appearance = /OPS_Holes');

    const [terug] = await laad(bytes);
    assert.equal(terug.type, 'measureArea');
    zelfdeRing(terug.points, punten, 'heropende buitenring');
    zelfdeRing(terug.holes[0], gat, 'heropend gat');
    openen([terug]);
    meas.herberekenVlakMaat(terug);
    assert.ok(bijna(terug.measureValue, waarde, 1e-6), 'zelfde oppervlakte na heropenen');
  });
}
