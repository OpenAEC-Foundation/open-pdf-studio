// Uiteenhalen en samenvoegen houdt de laag (OCG) van de bron (#629, #377).
// De modules draaien onder node met de laadhaken van de app (zie
// core/app-test-hooks.mjs).

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('../core/state.ts');
const undo = await import('../core/undo-manager.js');
const { explodeSelection, joinSelection, explodeCollection, createCollection } = await import('./segment-ops.js');

function openen(annotations) {
  state.documents = [{
    id: `doc-${Math.random().toString(36).slice(2, 8)}`, filePath: null, pdfDoc: { numPages: 1 },
    currentPage: 1, scale: 1, viewMode: 'single', annotations,
    annotationLayers: [
      { id: 'default', name: '', color: null, visible: true, printable: true, locked: false },
      { id: 'L1', name: 'Installaties', color: null, visible: true, printable: true, locked: false },
      { id: 'L2', name: 'Bouwkundig', color: null, visible: true, printable: true, locked: false },
    ],
    selectedAnnotation: null, selectedAnnotations: [],
    undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
    textEdits: [], watermarks: [], bookmarks: [], pageRotations: {}, measureScale: null,
  }];
  state.activeDocumentIndex = 0;
  return state.documents[0];
}

const lijn = (id, x1, y1, x2, y2, extra = {}) => ({
  id, type: 'line', page: 1, startX: x1, startY: y1, endX: x2, endY: y2, color: '#ff0000', lineWidth: 1, ...extra,
});

test('uiteenhalen van een polylijn: elk stuk blijft op de laag en in de verzameling van de bron', () => {
  const doc = openen([{
    id: 'p', type: 'polyline', page: 1, layer: 'L1', groupId: 'grp_a', color: '#00ff00', lineWidth: 2,
    points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
  }]);
  doc.selectedAnnotations = [doc.annotations[0]];
  assert.equal(explodeSelection(), 1);
  const alle = state.documents[0].annotations;
  assert.equal(alle.length, 2);
  assert.deepEqual(alle.map((a) => a.layer), ['L1', 'L1']);
  assert.deepEqual(alle.map((a) => a.groupId), ['grp_a', 'grp_a']);
});

test('een stuk van een lijn op de standaardlaag krijgt geen laagveld', () => {
  const doc = openen([{
    id: 'p', type: 'polyline', page: 1, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
  }]);
  doc.selectedAnnotations = [doc.annotations[0]];
  explodeSelection();
  assert.ok(state.documents[0].annotations.every((a) => !('layer' in a) && !('groupId' in a)));
});

test('samenvoegen houdt de laag; uiteenhalen en weer samenvoegen komt op dezelfde laag uit', async () => {
  const doc = openen([lijn('a', 0, 0, 10, 0, { layer: 'L2' }), lijn('b', 10, 0, 10, 10, { layer: 'L2' })]);
  doc.selectedAnnotations = [...doc.annotations];
  assert.equal(joinSelection(), 2);
  let alle = state.documents[0].annotations;
  assert.equal(alle.length, 1);
  assert.equal(alle[0].type, 'polyline');
  assert.equal(alle[0].layer, 'L2');

  state.documents[0].selectedAnnotations = [alle[0]];
  explodeSelection();
  alle = state.documents[0].annotations;
  assert.deepEqual(alle.map((a) => a.layer), ['L2', 'L2']);
  state.documents[0].selectedAnnotations = [...alle];
  joinSelection();
  assert.equal(state.documents[0].annotations[0].layer, 'L2');

  // Ongedaan maken zet de losse lijnen terug, met hun laag.
  await undo.undo();
  assert.deepEqual(state.documents[0].annotations.map((a) => a.layer), ['L2', 'L2']);
});

test('samenvoegen over lagen heen: de eerste geselecteerde wint, een gedeelde verzameling blijft', () => {
  const doc = openen([
    lijn('a', 0, 0, 10, 0, { layer: 'L1', groupId: 'g' }),
    lijn('b', 10, 0, 10, 10, { layer: 'L2', groupId: 'g' }),
  ]);
  doc.selectedAnnotations = [...doc.annotations];
  joinSelection();
  const [samen] = state.documents[0].annotations;
  assert.equal(samen.layer, 'L1');
  assert.equal(samen.groupId, 'g');
});

test('groeperen en ontgroeperen laten de laag van elk lid ongemoeid', () => {
  const doc = openen([lijn('a', 0, 0, 1, 1, { layer: 'L1' }), lijn('b', 5, 5, 6, 6, { layer: 'L2' }), lijn('c', 9, 9, 8, 8)]);
  doc.selectedAnnotations = [...doc.annotations];
  assert.equal(createCollection(), 3);
  state.documents[0].selectedAnnotations = [state.documents[0].annotations[0]];
  assert.equal(explodeCollection(), 3);
  assert.deepEqual(state.documents[0].annotations.map((a) => a.layer), ['L1', 'L2', undefined]);
});
