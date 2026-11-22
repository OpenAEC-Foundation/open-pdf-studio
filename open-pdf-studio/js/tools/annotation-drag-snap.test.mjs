import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { state } = await import('../core/state.ts');
const { createAnnotationDragSnap } = await import('./annotation-drag-snap.js');
const { applyMove } = await import('../annotations/transforms.js');
const line = (id, x, y, page = 1) => ({ id, type: 'line', page, startX: x, startY: y, endX: x + 100, endY: y });
const prefs = {
  enableObjectSnap: true, objectSnapRadius: 12, snapToEndpoints: true,
  snapToMidpoints: false, snapToCenters: false, snapToStartPoints: false,
  snapToQuadrant: false, snapToVertices: true, polarTrackingEnabled: false,
  moveInferenceTracking: false, moveInferenceExtension: false, moveInferenceParallel: false,
};
function session(originals, targets, overrides = {}) {
  Object.assign(state.preferences, prefs, overrides);
  return createAnnotationDragSnap({ originals, annotations: [...originals, ...targets], page: 1, start: { x: 45, y: 20 } });
}

test('lijnuiteinde klikt vast onafhankelijk van de aanklikplek; geen cumulatieve correctie', () => {
  const a = line('a', 20, 20), b = line('b', 200, 150);
  const s = session([a], [b]);
  const first = s.snap(77, 128, 1);
  assert.deepEqual([first.dx, first.dy], [80, 130]);
  assert.deepEqual([first.indicator.x, first.indicator.y], [200, 150]);
  applyMove(a, first.dx, first.dy, structuredClone(a));
  assert.deepEqual([s.snap(77, 128, 1).dx, s.snap(77, 128, 1).dy], [80, 130]);
  assert.equal(s.snap(40, 90, 1).indicator, null, 'weg van het doel vrij bewegen');
  s.dispose();
});

test('cirkelkwadrant en veelhoekpunt sluiten exact aan', () => {
  const circle = { id: 'c', type: 'circle', page: 1, x: 20, y: 20, width: 40, height: 40 };
  const polygon = { id: 'p', type: 'polygon', page: 1, points: [{ x: 200, y: 150 }, { x: 300, y: 150 }, { x: 250, y: 250 }] };
  const s = session([circle], [polygon], { snapToQuadrant: true });
  assert.deepEqual([s.snap(138, 111, 1).dx, s.snap(138, 111, 1).dy], [140, 110]);
  s.dispose();
});

test('groep behoudt onderlinge afstand en vormt geen eigen snapdoel', () => {
  const a = line('a', 20, 20), b = line('b', 20, 60);
  const own = [a, b];
  const s = session(own, [line('c', 200, 150)]);
  const r = s.snap(77, 88, 1);
  const moved = structuredClone(own);
  moved.forEach((a, i) => applyMove(a, r.dx, r.dy, own[i]));
  assert.equal(moved[1].startY - moved[0].startY, 40);
  assert.deepEqual([moved[1].endX, moved[1].endY], [200, 150]);
  s.dispose();
  const solo = session(own, []);
  assert.equal(solo.snap(4, 4, 1).indicator, null);
  solo.dispose();
});

test('andere pagina wordt nooit een doel, object snap uit laat delta intact', () => {
  const a = line('a', 20, 20);
  const s = session([a], [line('b', 200, 150, 2)]);
  assert.deepEqual([s.snap(77, 128, 1).dx, s.snap(77, 128, 1).dy], [77, 128]);
  s.dispose();
  const off = session([a], [line('b', 200, 150)], { enableObjectSnap: false });
  assert.equal(off.snap(77, 128, 1).indicator, null);
  off.dispose();
});

test('vangstraal blijft twaalf schermpixels bij verschillende zoomniveaus', () => {
  for (const scale of [0.25, 1, 4, 64]) {
    const s = session([line('a', 20, 20)], [line('b', 200, 150)]);
    assert.ok(s.snap(80 - 11 / scale, 130, scale).indicator, `binnen bij ${scale}`);
    assert.equal(s.snap(80 - 13 / scale, 130, scale).indicator, null, `buiten bij ${scale}`);
    s.dispose();
  }
});

test('hoek volgt verticaal een naburig eindpunt; voorkeur schakelt hulplijnen uit', () => {
  const box = { id: 'a', type: 'box', page: 1, x: 400, y: 400, width: 50, height: 30 };
  const s = session([box], [line('b', 0, 0)], { moveInferenceTracking: true });
  const r = s.snap(-348, 190, 1);
  assert.equal(r.inferred.kind, 'tracking');
  assert.equal(450 + r.dx, 100);
  state.preferences.moveInferenceTracking = false;
  assert.equal(s.snap(-348, 190, 1).inferred, null);
  s.dispose();
});
