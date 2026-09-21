import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPointPolygon, rotatePointPolygon, flipPointPolygon,
} from './polygon-transform.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const samePoints = (a, b) => a.length === b.length
  && a.every((p, i) => near(p.x, b[i].x) && near(p.y, b[i].y));

// L-shaped polygon, bbox 0..40 x 0..30, centre (20, 15).
function lShape(extra = {}) {
  return {
    type: 'filledArea',
    x: 0, y: 0, width: 40, height: 30,
    points: [
      { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 10 },
      { x: 10, y: 10 }, { x: 10, y: 30 }, { x: 0, y: 30 },
    ],
    ...extra,
  };
}

test('isPointPolygon: only filledArea/measureArea with >= 3 points', () => {
  assert.equal(isPointPolygon(lShape()), true);
  assert.equal(isPointPolygon({ ...lShape(), type: 'measureArea' }), true);
  assert.equal(isPointPolygon({ ...lShape(), type: 'box' }), false);
  assert.equal(isPointPolygon({ type: 'filledArea', points: [{ x: 0, y: 0 }] }), false);
  assert.equal(isPointPolygon(null), false);
});

test('rotate 90 about the bbox centre moves the points and refreshes the bbox', () => {
  const a = lShape();
  assert.equal(rotatePointPolygon(a, 90), true);
  // (0,0) relative to centre (-20,-15) -> (15,-20) -> absolute (35,-5)
  assert.ok(near(a.points[0].x, 35) && near(a.points[0].y, -5));
  // 40x30 rotated a quarter turn becomes 30x40 about the same centre
  assert.ok(near(a.width, 30) && near(a.height, 40));
  assert.ok(near(a.x + a.width / 2, 20) && near(a.y + a.height / 2, 15));
});

test('four quarter turns and a full 360 return the original points', () => {
  const orig = lShape();
  const a = lShape();
  for (let i = 0; i < 4; i++) rotatePointPolygon(a, 90);
  assert.ok(samePoints(a.points, orig.points));
  const b = lShape();
  rotatePointPolygon(b, 360);
  assert.ok(samePoints(b.points, orig.points));
});

test('rotation by a free angle preserves edge lengths', () => {
  const a = lShape();
  rotatePointPolygon(a, 37);
  const len = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
  const o = lShape().points;
  for (let i = 0; i < o.length; i++) {
    const j = (i + 1) % o.length;
    assert.ok(near(len(a.points[i], a.points[j]), len(o[i], o[j]), 1e-9));
  }
});

test('rotation keeps arc flags and bulge unchanged', () => {
  const a = lShape();
  a.points[1] = { x: 40, y: 0, arc: true, bulge: 0.5 };
  rotatePointPolygon(a, 45);
  assert.equal(a.points[1].arc, true);
  assert.equal(a.points[1].bulge, 0.5);
});

test('holes rotate together with the outer contour', () => {
  const a = lShape({ holes: [[{ x: 2, y: 2 }, { x: 6, y: 2 }, { x: 6, y: 6 }]] });
  rotatePointPolygon(a, 90);
  // (2,2) relative to centre (-18,-13) -> (13,-18) -> absolute (33,-3)
  assert.ok(near(a.holes[0][0].x, 33) && near(a.holes[0][0].y, -3));
});

test('mirror left-right: x reflects about the centre, y is unchanged', () => {
  const a = lShape();
  flipPointPolygon(a, 'x');
  assert.ok(near(a.points[0].x, 40) && near(a.points[0].y, 0));
  assert.ok(near(a.points[3].x, 30) && near(a.points[3].y, 10));
  assert.ok(near(a.x, 0) && near(a.width, 40) && near(a.height, 30));
});

test('mirror top-bottom: y reflects about the centre, x is unchanged', () => {
  const a = lShape();
  flipPointPolygon(a, 'y');
  assert.ok(near(a.points[0].x, 0) && near(a.points[0].y, 30));
  assert.ok(near(a.points[4].x, 10) && near(a.points[4].y, 0));
});

test('mirror twice returns the original points and arc bulges', () => {
  const a = lShape();
  a.points[2] = { x: 40, y: 10, arc: true, bulge: 0.4 };
  const orig = JSON.parse(JSON.stringify(a.points));
  flipPointPolygon(a, 'x');
  flipPointPolygon(a, 'x');
  assert.ok(samePoints(a.points, orig));
  assert.equal(a.points[2].bulge, 0.4);
  flipPointPolygon(a, 'y');
  flipPointPolygon(a, 'y');
  assert.equal(a.points[2].bulge, 0.4);
});

test('mirror negates the bulge of arc points (winding reverses), incl. the default', () => {
  const a = lShape();
  a.points[1] = { x: 40, y: 0, arc: true, bulge: 0.25 };
  a.points[2] = { x: 40, y: 10, arc: true }; // no bulge -> renderer default 0.3
  flipPointPolygon(a, 'x');
  assert.equal(a.points[1].bulge, -0.25);
  assert.equal(a.points[2].bulge, -0.3);
});

test('mirror does not invent a bulge on straight segments', () => {
  const a = lShape();
  flipPointPolygon(a, 'x');
  assert.equal('bulge' in a.points[0], false);
});

test('mirror also reflects and re-signs hole contours', () => {
  const a = lShape({ holes: [[{ x: 2, y: 2 }, { x: 6, y: 2, arc: true, bulge: 0.2 }, { x: 6, y: 6 }]] });
  flipPointPolygon(a, 'x');
  assert.ok(near(a.holes[0][0].x, 38));
  assert.equal(a.holes[0][1].bulge, -0.2);
});

test('functions leave non-polygon annotations untouched and return false', () => {
  const box = { type: 'box', x: 1, y: 2, width: 3, height: 4 };
  assert.equal(rotatePointPolygon(box, 90), false);
  assert.equal(flipPointPolygon(box, 'x'), false);
  assert.deepEqual(box, { type: 'box', x: 1, y: 2, width: 3, height: 4 });
});
