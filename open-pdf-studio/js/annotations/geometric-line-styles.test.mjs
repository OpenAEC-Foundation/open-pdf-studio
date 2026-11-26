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

test('batting is a continuous alternating coil, not separate tilted ellipses (#1284)', () => {
  // Four 3.2pt pitches between the 4pt end margins, across an 8pt strip.
  const paths = geometricLinePaths({ ...line, borderStyle: 'insulation', endX: 20.8 });
  assert.equal(paths.length, 1, 'one continuous stroke through all lobes');
  const p = paths[0];
  assert.deepEqual(p[0], { x: 4, y: -4 });
  assert.ok(Math.abs(p.at(-1).x - 16.8) < 1e-9);
  assert.ok(Math.abs(p.at(-1).y + 4) < 1e-9);
  const top = p.filter(q => Math.abs(q.y + 4) < 1e-9);
  const bottom = p.filter(q => Math.abs(q.y - 4) < 1e-9);
  assert.equal(top.length, 5);
  assert.equal(bottom.length, 4);
  assert.ok(Math.abs(bottom[0].x - top[0].x - 1.6) < 1e-9, 'opposite lobes offset by half a pitch');
  // The stroke turns back longitudinally between its rounded side lobes.
  assert.ok(p.some((q, i) => i && q.x < p[i - 1].x));
});

test('batting keeps its strip proportions when rotated, reversed and scaled', () => {
  const ann = { ...line, borderStyle: 'insulation', endX: 20.8 };
  const horizontal = geometricLinePaths(ann).flat();
  for (const angle of [Math.PI / 2, Math.PI, 0.37]) {
    const c = Math.cos(angle), s = Math.sin(angle);
    const rotated = geometricLinePaths({ ...ann, endX: 20.8 * c, endY: 20.8 * s }).flat();
    assert.equal(rotated.length, horizontal.length);
    rotated.forEach((q, i) => {
      assert.ok(Math.abs(q.x - (horizontal[i].x * c - horizontal[i].y * s)) < 1e-8);
      assert.ok(Math.abs(q.y - (horizontal[i].x * s + horizontal[i].y * c)) < 1e-8);
    });
  }
  const scaled = geometricLinePaths({ ...ann, lineWidth: 3, endX: 62.4 }).flat();
  assert.equal(scaled.length, horizontal.length);
  scaled.forEach((q, i) => {
    assert.ok(Math.abs(q.x - horizontal[i].x * 3) < 1e-8);
    assert.ok(Math.abs(q.y - horizontal[i].y * 3) < 1e-8);
  });
});
