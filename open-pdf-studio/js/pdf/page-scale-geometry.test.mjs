import assert from 'node:assert/strict';
import test from 'node:test';
import { schaalVoorPassen, scaleAnnotationGeometry } from './page-scale-geometry.js';

test('A3 landscape fits A4 landscape by 1/sqrt(2) and stays centred', () => {
  const { s, dx, dy } = schaalVoorPassen(1190.55, 841.89, 841.89, 595.28);
  assert.ok(Math.abs(s - 0.7071) < 0.001);
  assert.ok(Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1);
});

test('a portrait page on a landscape one is scaled by the height and centred sideways', () => {
  const { s, dx, dy } = schaalVoorPassen(100, 200, 300, 100);
  assert.equal(s, 0.5);
  assert.equal(dx, 125);
  assert.equal(dy, 0);
});

test('a text box scales its position, size, font and leaders', () => {
  const a = { x: 100, y: 200, width: 80, height: 40, fontSize: 12, lineWidth: 2, leaders: [{ tipX: 10, tipY: 20, kneeX: 30, kneeY: 40 }] };
  scaleAnnotationGeometry(a, 0.5, 10, 5);
  assert.deepEqual([a.x, a.y, a.width, a.height, a.fontSize, a.lineWidth], [60, 105, 40, 20, 6, 1]);
  assert.deepEqual(a.leaders[0], { tipX: 15, tipY: 15, kneeX: 25, kneeY: 25 });
});

test('points of a polyline and a circle centre follow the page content', () => {
  const p = { points: [{ x: 0, y: 0 }, { x: 100, y: 50 }], cx: 20, cy: 20, radius: 10 };
  scaleAnnotationGeometry(p, 2, 1, 1);
  assert.deepEqual(p.points, [{ x: 1, y: 1 }, { x: 201, y: 101 }]);
  assert.deepEqual([p.cx, p.cy, p.radius], [41, 41, 20]);
});
