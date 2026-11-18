import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('../core/app-test-hooks.mjs', import.meta.url);
register('../pdf/saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { state, getAnnotationBounds } = await import('../core/state.ts');
const { findAnnotationAt } = await import('./geometry.js');
const { annotationBounds } = await import('./spatial-index.js');
const { applyMove, applyResize, applyRotateGeneric } = await import('./transforms.js');
const { buildPolygonPointsPath } = await import('./rendering/shapes.js');
const { scaleAnnotation } = await import('./scale-geometry.js');
const { resizeAnnotationToBounds } = await import('./size-matching.js');
const { stretchAnnotation } = await import('./stretch-geometry.js');
const { contourBounds, contourSegments, contourPoint } = await import('./bezier-contour.js');
const { veelhoekUitPunten, veelhoekPunten, veelhoekPuntenOpScherm, zetVeelhoekOpScherm, spiegelVeelhoek } = await import('./veelhoek-punten.js');

const copy = x => JSON.parse(JSON.stringify(x));
// Endpoints y=0; actual cubic peaks at 75, outside the node-only box.
const nodes = [{ x: 0, y: 0, outgoing: { x: 0, y: 100 } }, { x: 100, y: 0, incoming: { x: 100, y: 100 } }, { x: 150, y: 0 }];
const polyline = () => ({ id: 'curve', page: 1, type: 'polyline', lineWidth: 1, points: copy(nodes), ...contourBounds(nodes) });
const polygon = (rotation = 0) => ({ id: 'curve', page: 1, type: 'polygon', lineWidth: 1, rotation, ...veelhoekUitPunten(nodes) });
function open(ann) {
  state.documents = [{ id: 'bezier', pdfDoc: { numPages: 1 }, currentPage: 1, scale: 1, viewMode: 'single', annotations: [ann], selectedAnnotations: [], undoStack: [], redoStack: [], textEdits: [], watermarks: [], bookmarks: [], pageRotations: {} }];
  state.activeDocumentIndex = 0;
}
function near(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`); }
function sameNodes(actual, expected) {
  assert.equal(actual.length, expected.length);
  actual.forEach((p, i) => {
    near(p.x, expected[i].x); near(p.y, expected[i].y);
    for (const k of ['incoming', 'outgoing']) {
      assert.equal(!!p[k], !!expected[i][k]);
      if (p[k]) { near(p[k].x, expected[i][k].x); near(p[k].y, expected[i][k].y); }
    }
  });
}
const map = (pts, fn) => pts.map(p => ({ ...fn(p), ...(p.incoming && { incoming: fn(p.incoming) }), ...(p.outgoing && { outgoing: fn(p.outgoing) }) }));

test('real hit testing and both bounds paths include the bow, not its chord', () => {
  const ann = polyline(); open(ann);
  assert.equal(findAnnotationAt(50, 75)?.id, ann.id);
  assert.equal(findAnnotationAt(50, 0), null);
  assert.equal(getAnnotationBounds(ann).height, 75);
  const b = annotationBounds({ ...ann, height: 1 }); // stale cached box cannot cull the curve
  assert.ok(b.y + b.height >= 75);
  assert.equal(findAnnotationAt(125, 0)?.id, ann.id, 'adjacent straight segment');
});

test('polygon scaling and path tracing share exact bounds and cubic handles', () => {
  const ann = polygon(); ann.width *= 2; ann.height *= 3;
  const pts = veelhoekPunten(ann);
  sameNodes(pts, map(nodes, p => ({ x: p.x * 2, y: p.y * 3 })));
  const calls = [];
  const ctx = Object.fromEntries(['beginPath', 'moveTo', 'lineTo', 'bezierCurveTo', 'closePath'].map(k => [k, (...args) => calls.push([k, ...args])]));
  buildPolygonPointsPath(ctx, ann.points, ann.x, ann.y, ann.width, ann.height);
  assert.deepEqual(calls, [['beginPath'], ['moveTo', 0, 0], ['bezierCurveTo', 0, 300, 200, 300, 200, 0], ['lineTo', 300, 0], ['lineTo', 0, 0], ['closePath']]);
});

test('rotated/reflected polygon round-trip preserves every world-space handle', () => {
  for (const rotation of [0, 30, 90, 217]) {
    const ann = { ...polygon(rotation), flipX: true, flipY: true, width: 300, height: 40 };
    assert.deepEqual(ann.points[0].outgoing, nodes[0].outgoing);
    const screen = veelhoekPuntenOpScherm(ann);
    const restored = { ...ann, ...zetVeelhoekOpScherm(ann, screen) };
    sameNodes(veelhoekPuntenOpScherm(restored), screen);
    open(ann);
    const mid = contourPoint(contourSegments(screen, true)[0], .5);
    assert.equal(findAnnotationAt(mid.x, mid.y)?.id, ann.id);
    const b = annotationBounds(ann);
    assert.ok(mid.x >= b.x && mid.x <= b.x + b.width && mid.y >= b.y && mid.y <= b.y + b.height);
  }
});

test('generic move and rotate carry attached handles and preserve snapshots', () => {
  const original = polyline(), before = copy(original), moved = copy(original);
  applyMove(moved, 23, -11);
  sameNodes(moved.points, map(nodes, p => ({ x: p.x + 23, y: p.y - 11 })));
  const rotated = copy(original); applyRotateGeneric(rotated, original, 10, 20, 90);
  sameNodes(rotated.points, map(nodes, p => ({ x: 30 - p.y, y: 10 + p.x })));
  const bounds = contourBounds(rotated.points);
  for (const k of ['x', 'y', 'width', 'height']) near(rotated[k], bounds[k]);
  assert.deepEqual(original, before);
  const locked = { ...copy(original), locked: true }; applyMove(locked, 20, 20);
  sameNodes(locked.points, original.points);
});

test('polygon group rotation moves its stored handles once, alongside its box', () => {
  const original = polygon(30), changed = copy(original);
  assert.deepEqual(original.points[0].outgoing, nodes[0].outgoing);
  const before = veelhoekPuntenOpScherm(original);
  applyRotateGeneric(changed, original, 10, 20, 90);
  sameNodes(veelhoekPuntenOpScherm(changed), map(before, p => ({ x: 30 - p.y, y: 10 + p.x })));
});

test('existing node drag translates only that node and its own handles', () => {
  for (const original of [polyline(), polygon(35)]) {
    open(original); const changed = copy(original);
    const before = original.type === 'polygon' ? veelhoekPuntenOpScherm(original) : original.points;
    applyResize(changed, 'polyline_node_0', 21, 13, original, false, false, { schaal: 1 });
    const after = original.type === 'polygon' ? veelhoekPuntenOpScherm(changed) : changed.points;
    const expected = copy(before); expected[0] = map([before[0]], p => ({ x: p.x + 21, y: p.y + 13 }))[0];
    sameNodes(after, expected);
  }
});

test('uniform and nonuniform scale preserve handle vectors and true bounds', () => {
  const ann = polyline(); scaleAnnotation(ann, 10, 20, 2);
  sameNodes(ann.points, map(nodes, p => ({ x: 2 * p.x - 10, y: 2 * p.y - 20 })));
  const resized = polyline(); resizeAnnotationToBounds(resized, contourBounds(nodes), 300, 225);
  sameNodes(resized.points, map(nodes, p => ({ x: p.x * 2, y: p.y * 3 })));
  assert.equal(resized.height, 225);
});

test('polygon reflection preserves handle direction and node identity', () => {
  const ann = polygon();
  const horizontal = spiegelVeelhoek(ann, 'x');
  sameNodes(horizontal.points, map(nodes, p => ({ x: 150 - p.x, y: p.y })));
  sameNodes(spiegelVeelhoek({ ...ann, ...horizontal }, 'x').points, nodes);
});

test('CAD stretch selects world-space polygon nodes and moves their handles', () => {
  for (const original of [polyline(), polygon(35)]) {
    const before = original.type === 'polygon' ? veelhoekPuntenOpScherm(original) : original.points;
    const changed = copy(original);
    stretchAnnotation(original, changed, 17, -23, p => Math.hypot(p.x - before[0].x, p.y - before[0].y) < 1);
    const expected = copy(before); expected[0] = map([before[0]], p => ({ x: p.x + 17, y: p.y - 23 }))[0];
    sameNodes(original.type === 'polygon' ? veelhoekPuntenOpScherm(changed) : changed.points, expected);
  }
});

const { editBezierSegment, moveBezierControl, bezierEditNodes, bezierPartAt, deleteBezierNode } = await import('./bezier-edit.js');
const { getAnnotationHandles, findHandleAt } = await import('./handles.js');
const { voegVeelhoekHoekpuntIn, veelhoekDeelBij } = await import('./veelhoek-punten.js');

test('curve action adds independent controls; straight action keeps neighbouring segment', () => {
  const ann = { type: 'polyline', points: [{ x: 0, y: 0 }, { x: 90, y: 0 }, { x: 90, y: 90 }] };
  Object.assign(ann, editBezierSegment(ann, 0, 'curve'));
  assert.deepEqual(ann.points[0].outgoing, { x: 30, y: 0 });
  Object.assign(ann, editBezierSegment(ann, 1, 'curve'));
  const incoming = copy(ann.points[1].incoming);
  Object.assign(ann, moveBezierControl(ann, 'bezier_outgoing_1', 20, 15));
  assert.deepEqual(ann.points[1].incoming, incoming);
  Object.assign(ann, editBezierSegment(ann, 0, 'straight'));
  assert.equal(ann.points[0].outgoing, undefined);
  assert.equal(ann.points[1].incoming, undefined);
  assert.deepEqual(ann.points[1].outgoing, { x: 110, y: 45 });
});

test('rotated reflected polygon control drag uses world delta and keeps all other points', () => {
  const ann = { ...polygon(37), flipX: true, width: 320, height: 90 };
  open(ann);
  const before = bezierEditNodes(ann), expected = copy(before);
  expected[0].outgoing.x += 35; expected[0].outgoing.y -= 20;
  const handles = getAnnotationHandles(ann, 2), h = handles.find(h => h.type === 'bezier_outgoing_0');
  assert.equal(findHandleAt(h.x + 1.5, h.y + 1.5, ann, 2), 'bezier_outgoing_0');
  near(h.anchor.x, before[0].x); near(h.anchor.y, before[0].y);
  applyResize(ann, 'bezier_outgoing_0', 35, -20, copy(ann));
  sameNodes(bezierEditNodes(ann), expected);
});

test('regular polygon materializes without moving its world vertices', () => {
  const ann = { type: 'polygon', x: 20, y: 40, width: 120, height: 80, sides: 5, rotation: 35, flipY: true };
  const before = bezierEditNodes(ann);
  // Top vertex of the renderer's inscribed pentagon, reflected then rotated
  // about the original rectangle centre (80, 80), not the vertex-bounds centre.
  const angle = 35 * Math.PI / 180;
  near(before[0].x, 80 - 40 * Math.sin(angle));
  near(before[0].y, 80 + 40 * Math.cos(angle));
  Object.assign(ann, editBezierSegment(ann, 4, 'curve'));
  const after = bezierEditNodes(ann);
  after.forEach((p, i) => { near(p.x, before[i].x); near(p.y, before[i].y); });
  assert.equal(after.length, 5); assert.ok(after[4].outgoing); assert.ok(after[0].incoming);
});

test('curved context and insertion follow the bow and preserve the exact curve', () => {
  const ann = polyline();
  const hit = bezierPartAt(ann, 50, 76, 2);
  assert.equal(hit.kind, 'bezierEdge'); near(hit.t, 0.5);
  assert.equal(bezierPartAt(ann, 50, 0, 2), null);
  const split = editBezierSegment(ann, 0, 'insert', hit.t), before = contourSegments(ann.points)[0], after = contourSegments(split.points);
  for (let i = 0; i <= 20; i++) {
    const t = i / 20, a = contourPoint(before, t), b = contourPoint(after[t <= hit.t ? 0 : 1], t <= hit.t ? t / hit.t : (t - hit.t) / (1 - hit.t));
    near(a.x, b.x); near(a.y, b.y);
  }
  const pg = polygon();
  assert.equal(veelhoekDeelBij(pg, 50, 75, 1).edgeIndex, 0);
  const result = voegVeelhoekHoekpuntIn(pg, 0, { x: 50, y: 75 });
  near(result.points[1].x, 50); near(result.points[1].y, 75);
});

test('delete node straightens the joined edge only; locked geometry rejects all edits', () => {
  const ann = polyline();
  const result = deleteBezierNode(ann, 1);
  assert.equal(contourSegments(result.points)[0].kind, 'line');
  assert.equal(deleteBezierNode({ ...ann, points: ann.points.slice(0, 2) }, 0), null);
  ann.locked = true;
  assert.equal(editBezierSegment(ann, 0, 'straight'), null);
  assert.equal(deleteBezierNode(ann, 1), null);
  assert.equal(moveBezierControl(ann, 'bezier_outgoing_0', 1, 2), null);
  const before = copy(ann); applyResize(ann, 'bezier_outgoing_0', 10, 20, before); assert.deepEqual(ann, before);
});

const { collectSnapPoints, nearestPointOnEdge } = await import('../tools/snap-engine.js');
const { canOffset, offsetProps } = await import('./offset-geometry.js');
test('snaps use the cubic midpoint and bow; offset refuses unsupported cubic geometry', () => {
  const ann = polyline(); open(ann);
  Object.assign(state.preferences, { enableObjectSnap: true, snapToEdges: true, snapToMidpoints: true, snapToEndpoints: false, snapToVertices: false, snapToStartPoints: false, snapToCenters: false });
  const mids = collectSnapPoints([ann], 1);
  assert.ok(mids.some(p => p.x === 50 && p.y === 75));
  assert.ok(!mids.some(p => p.x === 50 && p.y === 0));
  const hit = nearestPointOnEdge(50, 76, [ann], 1, 2);
  assert.ok(hit); near(hit.x, 50); near(hit.y, 75);
  assert.equal(nearestPointOnEdge(50, 0, [ann], 1, 2), null);
  assert.equal(canOffset(ann), false);
  assert.equal(offsetProps(ann, 5, { x: 50, y: 90 }), null);
});
