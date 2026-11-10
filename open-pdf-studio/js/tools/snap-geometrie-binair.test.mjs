// Snap-geometrie uit de PDFium-worker: de OSG1-codering en de keuze tussen
// de Rust-route en de PDF.js-route in pdf-snap-extractor.js. De worker zelf
// heeft zijn eigen tests (pdfium-worker/src/snap_geometry.rs); de
// pariteit Rust ↔ JavaScript op gemaakte tekeningen staat in
// open-pdf-studio/scripts/bench-rust/snap-geometrie.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { PDFDocument, moveTo, lineTo, stroke } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
// platform.isMobile() leest de URL van het venster.
globalThis.window.location ??= { search: '' };

const { state } = await import('../core/state.ts');
const { decodeerSnapGeometrie, codeerSnapGeometrie } = await import('./snap-geometrie-binair.js');
const extractor = await import('./pdf-snap-extractor.js');

test('codering heen en terug: punten, soorten en randen', () => {
  const geometrie = {
    points: [
      { x: 0, y: 0, type: 'endpoint', annotation: null },
      { x: 50, y: 0.5, type: 'midpoint', annotation: null },
      { x: 100, y: 1, type: 'endpoint', annotation: null },
    ],
    edges: [{ x1: 0, y1: 0, x2: 100, y2: 1 }],
  };
  const terug = decodeerSnapGeometrie(codeerSnapGeometrie(geometrie));
  assert.deepEqual(terug, geometrie);
});

test('codering: lege set, scheve byteOffset en getallenlijst', () => {
  const leeg = decodeerSnapGeometrie(codeerSnapGeometrie({ points: [], edges: [] }));
  assert.deepEqual(leeg, { points: [], edges: [] });

  const bytes = new Uint8Array(codeerSnapGeometrie({ points: [{ x: 1.25, y: 2, type: 'endpoint' }], edges: [] }));
  const scheef = new Uint8Array(bytes.length + 1);
  scheef.set(bytes, 1);
  assert.equal(decodeerSnapGeometrie(scheef.subarray(1)).points[0].x, 1.25);
  assert.equal(decodeerSnapGeometrie(Array.from(bytes)).points[0].y, 2);
});

test('codering: fout formaat of afgekapt antwoord wordt geweigerd', () => {
  assert.throws(() => decodeerSnapGeometrie(new Uint8Array(16)), /OSG1/);
  const bytes = new Uint8Array(codeerSnapGeometrie({ points: [{ x: 1, y: 2, type: 'endpoint' }], edges: [] }));
  assert.throws(() => decodeerSnapGeometrie(bytes.subarray(0, 20)), /afgekapt/);
});

test('index heen en terug: zelfde cellen, volgorde en vakjes als buildSpatialIndex', async () => {
  const points = [];
  const edges = [];
  for (let i = 0; i < 300; i++) {
    const x = (i * 37) % 900 - 50;
    const y = (i * 53) % 700 - 20;
    points.push({ x, y, type: i % 3 ? 'endpoint' : 'midpoint', annotation: null });
    edges.push({ x1: x, y1: y, x2: x + (i % 7) * 30, y2: y + (i % 5) * 20 });
  }
  edges.push({ x1: 0, y1: 0, x2: 5000, y2: 5000 }); // te groot: altijd-lijst
  const index = await extractor.bouwSnapIndex(points, edges);
  const terug = decodeerSnapGeometrie(codeerSnapGeometrie({ points, edges }, index)).index;
  const alsLijsten = (m) => [...m.entries()].map(([k, v]) => [k, Array.from(v)]);
  assert.deepEqual(alsLijsten(terug.pointGrid), alsLijsten(index.pointGrid));
  assert.deepEqual(alsLijsten(terug.edgeGrid), alsLijsten(index.edgeGrid));
  assert.deepEqual(terug.edgeOversized, index.edgeOversized);
  assert.deepEqual(index.edgeOversized, [300]);
});

// ── Keuze van de route ─────────────────────────────────────────────────────

async function documentMetLijn() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([400, 300]);
  page.pushOperators(moveTo(10, 20), lineTo(110, 20), stroke());
  const bytes = await pdf.save();
  const pdfDoc = await getDocument({ data: bytes, verbosity: 0, isEvalSupported: false }).promise;
  const doc = {
    id: `doc-${Math.random().toString(36).slice(2, 8)}`, filePath: 'C:/tekening.pdf', pdfDoc,
    currentPage: 1, scale: 1, viewMode: 'single', annotations: [], pageRotations: {},
    selectedAnnotation: null, selectedAnnotations: [],
  };
  state.documents = [doc];
  state.activeDocumentIndex = 0;
  // De store bewaart een kopie: met die kopie werken (isOpen vergelijkt).
  return state.documents[0];
}

function zetTauri(invoke) {
  globalThis.window.__TAURI__ = invoke ? { core: { invoke } } : undefined;
  if (!invoke) delete globalThis.window.__TAURI__;
}

test('desktop: de geometrie komt uit de worker, met de weergavematrix van de app', async (t) => {
  const doc = await documentMetLijn();
  const viaJs = await extractor.extractPageGeometry(1, { document: doc });
  assert.equal(viaJs.edges.length, 1);

  const vanWorker = {
    points: [{ x: 1, y: 2, type: 'endpoint', annotation: null }],
    edges: [{ x1: 1, y1: 2, x2: 3, y2: 4 }],
  };
  const aanroepen = [];
  zetTauri(async (cmd, args) => {
    aanroepen.push({ cmd, args });
    return codeerSnapGeometrie(vanWorker);
  });
  t.after(() => zetTauri(null));
  extractor._herstelRustSnapRoute();

  const viaRust = await extractor.extractPageGeometry(1, { document: doc });
  assert.deepEqual(viaRust.points, vanWorker.points);
  assert.deepEqual(viaRust.edges, vanWorker.edges);
  assert.ok(viaRust.index?.pointGrid, 'ruimtelijke index gebouwd');
  assert.equal(aanroepen.length, 1);
  assert.equal(aanroepen[0].cmd, 'extract_snap_geometry');
  assert.equal(aanroepen[0].args.path, 'C:/tekening.pdf');
  assert.equal(aanroepen[0].args.pageIndex, 0);
  const page = await doc.pdfDoc.getPage(1);
  assert.deepEqual(aanroepen[0].args.viewport, Array.from(page.getViewport({ scale: 1 }).transform));
});

test('verouderde worker: één waarschuwing, daarna steeds de PDF.js-route', async (t) => {
  const doc = await documentMetLijn();
  const viaJs = await extractor.extractPageGeometry(1, { document: doc });
  let aanroepen = 0;
  zetTauri(async () => { aanroepen++; throw 'PDF_SNAP_UNSUPPORTED'; });
  const waarschuwingen = [];
  const warn = console.warn;
  console.warn = (...a) => waarschuwingen.push(a.join(' '));
  t.after(() => { zetTauri(null); console.warn = warn; });
  extractor._herstelRustSnapRoute();

  const eerste = await extractor.extractPageGeometry(1, { document: doc });
  const tweede = await extractor.extractPageGeometry(1, { document: doc });
  assert.deepEqual(eerste.points, viaJs.points);
  assert.deepEqual(tweede.edges, viaJs.edges);
  assert.equal(aanroepen, 1, 'niet bij elke pagina opnieuw proberen');
  assert.equal(waarschuwingen.length, 1);
});

test('een losse fout van de worker geldt alleen die pagina', async (t) => {
  const doc = await documentMetLijn();
  let aanroepen = 0;
  zetTauri(async () => { aanroepen++; throw 'PDF_SNAP_FAILED: page 0: parse'; });
  const warn = console.warn;
  console.warn = () => {};
  t.after(() => { zetTauri(null); console.warn = warn; });
  extractor._herstelRustSnapRoute();

  const r = await extractor.extractPageGeometry(1, { document: doc });
  assert.equal(r.edges.length, 1, 'PDF.js-route als terugval');
  await extractor.extractPageGeometry(1, { document: doc });
  assert.equal(aanroepen, 2);
});

test('zonder bestandspad of met window.__opdsRustSnap = false: geen worker', async (t) => {
  const doc = await documentMetLijn();
  let aanroepen = 0;
  zetTauri(async () => { aanroepen++; return codeerSnapGeometrie({ points: [], edges: [] }); });
  t.after(() => { zetTauri(null); delete globalThis.__opdsRustSnap; });
  extractor._herstelRustSnapRoute();

  globalThis.__opdsRustSnap = false;
  assert.equal((await extractor.extractPageGeometry(1, { document: doc })).edges.length, 1);
  delete globalThis.__opdsRustSnap;
  doc.filePath = null;
  assert.equal((await extractor.extractPageGeometry(1, { document: doc })).edges.length, 1);
  assert.equal(aanroepen, 0);
});
