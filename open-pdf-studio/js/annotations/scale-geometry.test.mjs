import assert from 'node:assert/strict';
import test from 'node:test';

import { scaleAnnotation } from './scale-geometry.js';

const dichtbij = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('scale: rechthoek 2× rond het oorsprongpunt', () => {
  const ann = { type: 'box', x: 10, y: 10, width: 20, height: 20 };
  assert.equal(scaleAnnotation(ann, 0, 0, 2), true);
  assert.ok(dichtbij(ann.x, 20) && dichtbij(ann.y, 20));
  assert.ok(dichtbij(ann.width, 40) && dichtbij(ann.height, 40));
});

test('scale: verkleinen tot de helft rond een eigen basispunt', () => {
  const ann = { type: 'box', x: 0, y: 0, width: 100, height: 50 };
  // Basispunt = linkerbovenhoek → die blijft staan
  scaleAnnotation(ann, 0, 0, 0.5);
  assert.ok(dichtbij(ann.x, 0) && dichtbij(ann.y, 0));
  assert.ok(dichtbij(ann.width, 50) && dichtbij(ann.height, 25));
});

test('scale: gedraaide vorm blijft op zijn plaats (middelpunt schaalt)', () => {
  const ann = { type: 'box', x: 0, y: 0, width: 10, height: 10, rotation: 45 };
  scaleAnnotation(ann, 0, 0, 3);
  // Middelpunt (5,5) → (15,15)
  const cx = ann.x + ann.width / 2;
  const cy = ann.y + ann.height / 2;
  assert.ok(dichtbij(cx, 15) && dichtbij(cy, 15));
  assert.equal(ann.rotation, 45, 'rotatie blijft gelijk');
  assert.ok(dichtbij(ann.width, 30));
});

test('scale: lijn schaalt beide uiteinden rond het basispunt', () => {
  const ann = { type: 'line', startX: 10, startY: 0, endX: 30, endY: 0 };
  scaleAnnotation(ann, 0, 0, 2);
  assert.ok(dichtbij(ann.startX, 20) && dichtbij(ann.endX, 60));
  assert.ok(dichtbij(ann.startY, 0) && dichtbij(ann.endY, 0));
});

test('scale: puntenreeks en freehand-pad schalen mee', () => {
  const poly = { type: 'polyline', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] };
  scaleAnnotation(poly, 0, 0, 2);
  assert.ok(dichtbij(poly.points[1].x, 20) && dichtbij(poly.points[1].y, 20));

  const draw = { type: 'draw', path: [{ x: 4, y: 4 }] };
  scaleAnnotation(draw, 0, 0, 0.5);
  assert.ok(dichtbij(draw.path[0].x, 2) && dichtbij(draw.path[0].y, 2));
});

test('scale: tekstgrootte schaalt mee, lijndikte niet', () => {
  const ann = { type: 'box', x: 0, y: 0, width: 10, height: 10, fontSize: 12, lineWidth: 2 };
  scaleAnnotation(ann, 0, 0, 2);
  assert.ok(dichtbij(ann.fontSize, 24));
  assert.ok(dichtbij(ann.lineWidth, 2), 'lijndikte blijft gelijk');
});

test('scale: ongeldige factoren veranderen niets', () => {
  const orig = { type: 'box', x: 5, y: 5, width: 10, height: 10 };
  for (const f of [0, -1, NaN, null]) {
    const ann = { ...orig };
    assert.equal(scaleAnnotation(ann, 0, 0, f), false);
    assert.deepEqual(ann, orig);
  }
});
