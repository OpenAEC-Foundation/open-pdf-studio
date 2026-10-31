// Een getekende veelhoek raken, grijpen en erop snappen gebeurt op zijn
// hoekpunten zoals het scherm ze toont (#622): door het vak en gedraaid.
//
// De echte geometry.js, handles.js en snap-engine.js draaien onder node met
// de stubs van ../core/app-test-hooks.mjs. Het document bewaart een kopie
// van de annotatie: terugzoeken op id.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
register('../pdf/saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('../core/state.ts');
const { findAnnotationAt } = await import('./geometry.js');
const { getAnnotationHandles, findHandleAt } = await import('./handles.js');
const { performSnap } = await import('../tools/snap-engine.js');
const { veelhoekUitPunten, veelhoekPuntenOpScherm } = await import('./veelhoek-punten.js');

const driehoek = [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 100, y: 300 }];

function openen(ann) {
  state.documents = [{
    id: 'raak', filePath: null, pdfDoc: { numPages: 1 }, currentPage: 1, scale: 1, viewMode: 'single',
    annotations: [ann], selectedAnnotation: null, selectedAnnotations: [],
    undoStack: [], redoStack: [], textEdits: [], watermarks: [], bookmarks: [], pageRotations: {},
  }];
  state.activeDocumentIndex = 0;
  Object.assign(state.preferences, {
    enableObjectSnap: true, enableGridSnap: false, polarTrackingEnabled: false,
    snapToPdfContent: false, snapEndpoints: true, snapMidpoints: true, snapCenters: true,
  });
}

const veelhoek = (extra = {}) => ({
  id: 'v', type: 'polygon', page: 1, opacity: 1, strokeColor: '#ff0000', lineWidth: 1,
  ...veelhoekUitPunten(driehoek), ...extra,
});

test('raken: op een zijde en erbinnen wel, in de lege hoek van het vak niet', () => {
  const v = veelhoek();
  openen(v);
  assert.equal(findAnnotationAt(200, 100)?.id ?? null, v.id, 'op de bovenzijde');
  assert.equal(findAnnotationAt(150, 150)?.id ?? null, v.id, 'erbinnen');
  assert.equal(findAnnotationAt(280, 280)?.id ?? null, null, 'in het vak, naast de schuine zijde');
});

test('raken volgt de draaiing', () => {
  const v = veelhoek({ rotation: 90 });
  openen(v);
  const [a, b] = veelhoekPuntenOpScherm(v);
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  assert.equal(findAnnotationAt(m.x, m.y)?.id ?? null, v.id, 'op de gedraaide zijde');
});

test('een veelhoek zonder punten raakt zoals altijd op zijn vak', () => {
  const v = { id: 'z', type: 'polygon', page: 1, x: 100, y: 100, width: 200, height: 200, sides: 6 };
  openen(v);
  assert.equal(findAnnotationAt(110, 110)?.id ?? null, v.id);
});

test('grepen: een per hoekpunt waar het scherm het tekent, en findHandleAt vindt hem', () => {
  const v = veelhoek({ rotation: 30 });
  openen(v);
  const grepen = getAnnotationHandles(v, Infinity);
  const hoeken = grepen.filter((g) => g.type === 'polyline_node');
  assert.equal(hoeken.length, 3);
  const scherm = veelhoekPuntenOpScherm(v);
  for (const g of hoeken) {
    const p = scherm[g.nodeIndex];
    assert.ok(Math.abs(g.x - p.x) < 1e-6 && Math.abs(g.y - p.y) < 1e-6, `greep ${g.nodeIndex}`);
  }
  // Het draaipunt (#826) staat in het midden, op de plek van de verplaatsgreep.
  assert.ok(grepen.some((g) => g.type === 'pivot'), 'draaipunt');
  assert.ok(grepen.some((g) => g.type === 'rotate'), 'draaigreep');
  assert.ok(!grepen.some((g) => ['tl', 'tr', 'bl', 'br', 't', 'b', 'l', 'r'].includes(g.type)), 'geen maatgrepen');
  assert.equal(findHandleAt(scherm[2].x + 1, scherm[2].y, v, 1), 'polyline_node_2');
});

test('snappen op de hoekpunten en de middens van de zijden, ook de sluitende', () => {
  const v = veelhoek();
  openen(v);
  const hoek = performSnap(298, 102, [v], 1, 1);
  assert.ok(hoek.snapped && hoek.x === 300 && hoek.y === 100, `hoekpunt: ${JSON.stringify(hoek)}`);
  const midden = performSnap(201, 199, [v], 1, 1);
  assert.ok(midden.snapped && midden.x === 200 && midden.y === 200, `midden sluitende zijde: ${JSON.stringify(midden)}`);
});
