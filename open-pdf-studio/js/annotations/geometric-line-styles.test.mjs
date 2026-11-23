import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GEOMETRIC_LINE_STYLES, geometricLinePaths, geometricPathsBounds, drawGeometricLine, canApplyLineStyle } from './geometric-line-styles.js';
const line = { type: 'line', startX: 0, startY: 0, endX: 240, endY: 0, lineWidth: 1 };
for (const borderStyle of GEOMETRIC_LINE_STYLES) {
  test(`${borderStyle}: visible geometry, finite bounds and Canvas parity`, () => {
    const ann = { ...line, borderStyle }, paths = geometricLinePaths(ann), bounds = geometricPathsBounds(paths);
    assert.ok(paths.flat().length >= 4);
    assert.ok(bounds.height >= 6);
    assert.ok(paths.flat().every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
    const actual = []; let path;
    const ctx = { lineWidth: 1, save() {}, restore() {}, setLineDash() {}, beginPath() {}, stroke() {},
      moveTo(x, y) { path = [{ x, y }]; actual.push(path); }, lineTo(x, y) { path.push({ x, y }); } };
    assert.equal(drawGeometricLine(ctx, ann), true);
    assert.deepEqual(actual, paths);
    const moved = geometricLinePaths({ ...ann, startX: 30, startY: 50, endX: 270, endY: 50 });
    moved.forEach((p, i) => p.forEach((q, j) => {
      assert.ok(Math.abs(q.x - paths[i][j].x - 30) < 1e-9);
      assert.ok(Math.abs(q.y - paths[i][j].y - 50) < 1e-9);
    }));
  });
}
test('parallel rails preserve corners without unbounded miter spikes', () => {
  const p = geometricLinePaths({ type: 'polyline', borderStyle: 'double', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] });
  assert.equal(p.length, 2);
  assert.deepEqual(p[0], [{ x: 0, y: -4 }, { x: 100, y: -4 }, { x: 104, y: 0 }, { x: 104, y: 100 }]);
});
test('curved polylines follow the curve and repeated nodes do not break patterns', () => {
  const ann = { type: 'polyline', borderStyle: 'road', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], curves: [{ c1x: 0, c1y: 100, c2x: 0, c2y: 100 }] };
  assert.ok(geometricPathsBounds(geometricLinePaths(ann)).height > 70);
  const p = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 240, y: 0 }];
  assert.deepEqual(geometricLinePaths({ type: 'polyline', points: p, borderStyle: 'gas' }), geometricLinePaths({ ...line, borderStyle: 'gas' }));
});
test('short, degenerate, malformed and enormous input stays bounded', () => {
  for (const borderStyle of GEOMETRIC_LINE_STYLES) {
    assert.deepEqual(geometricLinePaths({ ...line, borderStyle, endX: 0 }), []);
    assert.deepEqual(geometricLinePaths({ ...line, borderStyle, endX: NaN }), []);
    assert.ok(geometricLinePaths({ ...line, borderStyle, endX: 1 }).flat().every(p => Number.isFinite(p.x)));
    assert.ok(geometricLinePaths({ ...line, borderStyle, endX: 1e8 }).flat().length <= 65001);
  }
});
test('ordinary and unsupported styles retain the existing rendering path', () => {
  assert.equal(geometricLinePaths({ ...line, borderStyle: 'dashed' }), null);
  assert.equal(geometricLinePaths({ ...line, type: 'arrow', borderStyle: 'gas' }), null);
  assert.equal(canApplyLineStyle('box', 'gas'), false);
  assert.equal(canApplyLineStyle('polyline', 'gas'), true);
  assert.equal(canApplyLineStyle('box', 'dashed'), true);
});

test('thin-lines display changes only the pen, not the pattern geometry', () => {
  const ann = { ...line, lineWidth: 3, borderStyle: 'tracks' };
  const actual = []; let path;
  drawGeometricLine({ lineWidth: 0.1, save() {}, restore() {}, setLineDash() {}, beginPath() {}, stroke() {},
    moveTo(x, y) { path = [{ x, y }]; actual.push(path); }, lineTo(x, y) { path.push({ x, y }); } }, ann);
  assert.deepEqual(actual, geometricLinePaths(ann));
});
