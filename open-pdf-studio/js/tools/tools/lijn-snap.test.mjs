// Lijngereedschap: snappen op andere lijnen (#997).
//
// - loodrecht vanaf het eigen beginpunt op een andere markeringslijn;
// - het tweede punt komt precies waar de voorvertoning (en de snapmarkering)
//   het toonde, ook met Shift ingedrukt (eerder negeerde de klik Shift);
// - een object-snap wint van Shift (zelfde regel als de meetgereedschappen);
// - het eigen beginpunt is geen snapdoel bij doorlopend tekenen.
//
// De echte tool, de snap-engine en de state-store draaien onder node (zie
// ../../core/app-test-hooks.mjs). Een klik volgt de dispatcher: eerst zijn
// snap op het klikpunt (state.startX/startY), dan pointerdown van de tool.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('../../core/state.ts');
const snapEngine = await import('../snap-engine.js');
const { snapAngle } = await import('../../utils/helpers.js');
const { lineTool } = await import('./line-tool.js');

const andere = { id: 'ander', type: 'line', page: 1, startX: 20, startY: 200, endX: 380, endY: 200 };

function openen(annotaties = [andere]) {
  state.documents = [{
    id: `doc-${Math.random().toString(36).slice(2, 8)}`, filePath: null, pdfDoc: null,
    currentPage: 1, scale: 1, viewMode: 'single', annotations: annotaties.map(a => ({ ...a })),
    selectedAnnotation: null, selectedAnnotations: [], pageRotations: {},
    undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
  }];
  state.activeDocumentIndex = 0;
  state.currentTool = 'line';
  snapEngine.vergeetVorigeSnap();
}

function voorkeuren(extra = {}) {
  Object.assign(state.preferences, {
    enableObjectSnap: true, snapToEndpoints: true, snapToMidpoints: true, snapToCenters: true,
    snapToVertices: true, snapToStartPoints: true, snapToEdges: true, snapToIntersections: true,
    snapToPerpendicular: true, snapToQuadrant: false, snapToTangent: false, snapToNearest: false,
    snapToPdfContent: false, enableGridSnap: false, polarTrackingEnabled: false,
    objectSnapRadius: 12, enableAngleSnap: true, angleSnapDegrees: 45, lineContinue: false,
  }, extra);
}

let preview = null;
function ctxBij(x, y) {
  const doc = state.documents[state.activeDocumentIndex];
  return {
    x, y, state, pageNum: 1, scale: 1,
    snap: (px, py, uitsluiten, punten, opties) =>
      snapEngine.performSnap(px, py, doc.annotations, 1, 1, uitsluiten, punten, opties),
    snapToGrid: (v) => v,
    snapAngle,
    setPolarAnchor: snapEngine.setPolarAnchor,
    clearPolarAnchor: snapEngine.clearPolarAnchor,
    redraw() {}, drawSnapIndicator() {},
    drawShapePreview: (px, py) => { preview = { x: px, y: py }; },
    createAnnotationFromTool: (tool, sx, sy, ex, ey) =>
      ({ id: `n${Math.random()}`, type: 'line', page: 1, startX: sx, startY: sy, endX: ex, endY: ey }),
    recordAdd() {},
  };
}

const ev = (extra = {}) => ({ button: 0, shiftKey: false, ctrlKey: false, altKey: false, preventDefault() {}, ...extra });

function klik(x, y, extra) {
  const doc = state.documents[state.activeDocumentIndex];
  const s = snapEngine.performSnap(x, y, doc.annotations, 1, 1);
  state.startX = s.snapped ? s.x : x;
  state.startY = s.snapped ? s.y : y;
  lineTool.onPointerDown(ctxBij(x, y), ev(extra));
}

function beweeg(x, y, extra) {
  lineTool.onPointerMove(ctxBij(x, y), ev(extra));
}

const nieuweLijnen = () => state.documents[0].annotations.filter(a => a.id !== 'ander');

test('loodrecht vanaf het beginpunt op een andere lijn: voorvertoning = marker = eindpunt', () => {
  voorkeuren();
  openen();
  klik(100, 60);
  beweeg(106, 203);
  assert.equal(state.lastSnapResult?.type, 'perpendicular');
  assert.deepEqual([state.lastSnapResult.x, state.lastSnapResult.y], [100, 200], 'marker op het voetpunt');
  assert.deepEqual([preview.x, preview.y], [100, 200], 'voorvertoning op het voetpunt');
  klik(106, 203);
  const [l] = nieuweLijnen();
  assert.deepEqual([l.startX, l.startY, l.endX, l.endY], [100, 60, 100, 200]);
});

test('op de lijn, eindpunt en midden van een andere lijn', () => {
  voorkeuren({ snapToPerpendicular: false });
  openen();
  klik(100, 60);
  klik(150, 204);
  assert.deepEqual([nieuweLijnen()[0].endX, nieuweLijnen()[0].endY], [150, 200], 'op de lijn');

  openen();
  klik(100, 60);
  klik(377, 203);
  assert.deepEqual([nieuweLijnen()[0].endX, nieuweLijnen()[0].endY], [380, 200], 'eindpunt');

  openen();
  klik(100, 60);
  klik(203, 202);
  assert.deepEqual([nieuweLijnen()[0].endX, nieuweLijnen()[0].endY], [200, 200], 'midden');
});

test('snijpunt van twee andere lijnen', () => {
  voorkeuren({ snapToPerpendicular: false });
  openen([andere, { id: 'kruis', type: 'line', page: 1, startX: 300, startY: 100, endX: 300, endY: 330 }]);
  klik(100, 60);
  klik(304, 197);
  const l = state.documents[0].annotations.find(a => a.id !== 'ander' && a.id !== 'kruis');
  assert.deepEqual([l.endX, l.endY], [300, 200]);
});

test('Shift zonder snap: de klik legt het eindpunt op de getoonde hoek', () => {
  voorkeuren({ enableObjectSnap: false });
  openen([]);
  klik(100, 100);
  beweeg(250, 108, { shiftKey: true });
  assert.ok(Math.abs(preview.y - 100) < 1e-9, 'voorvertoning horizontaal');
  klik(250, 108, { shiftKey: true });
  const [l] = nieuweLijnen();
  assert.ok(Math.abs(l.endY - 100) < 1e-9, `eindpunt horizontaal (endY ${l.endY})`);
  assert.ok(Math.abs(l.endX - preview.x) < 1e-9 && Math.abs(l.endY - preview.y) < 1e-9, 'klik = voorvertoning');
});

test('Shift met snap: de object-snap wint, voorvertoning en klik gelijk', () => {
  voorkeuren({ snapToEdges: false, snapToPerpendicular: false });
  openen();
  klik(100, 60);
  beweeg(377, 203, { shiftKey: true });
  assert.equal(state.lastSnapResult?.type, 'endpoint');
  klik(377, 203, { shiftKey: true });
  const [l] = nieuweLijnen();
  assert.deepEqual([l.endX, l.endY], [380, 200]);
});

test('doorlopend tekenen: het beginpunt (eindpunt van het vorige segment) is geen doel', () => {
  voorkeuren({ lineContinue: true, snapToEdges: false });
  openen([]);
  klik(100, 100);
  klik(200, 100);
  // Nieuw segment begint op (200, 100); cursor er vlak naast.
  beweeg(202, 103);
  assert.ok(!(state.lastSnapResult && state.lastSnapResult.x === 200 && state.lastSnapResult.y === 100),
    'geen snap terug op het eigen beginpunt');
  // Het startpunt van het eerste segment blijft wel een doel.
  beweeg(102, 102);
  assert.ok(state.lastSnapResult && state.lastSnapResult.x === 100 && state.lastSnapResult.y === 100);
  lineTool.onEscape(ctxBij(0, 0));
});
