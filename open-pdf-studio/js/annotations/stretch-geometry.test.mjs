import assert from 'node:assert/strict';
import test from 'node:test';

import { verticesOf, stretchAnnotation, canStretch } from './stretch-geometry.js';

const dichtbij = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const inRuit = (x1, y1, x2, y2) => {
  const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
  return (p) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
};

test('stretch: rechterrand verlengen, linkerrand blijft staan', () => {
  const orig = { type: 'box', x: 0, y: 0, width: 100, height: 50 };
  const doel = { ...orig };
  const ruit = inRuit(90, -10, 110, 60); // alleen de rechterhoeken
  assert.equal(stretchAnnotation(orig, doel, 20, 0, ruit), true);
  assert.ok(dichtbij(doel.x, 0));
  assert.ok(dichtbij(doel.width, 120));
  assert.ok(dichtbij(doel.y, 0));
  assert.ok(dichtbij(doel.height, 50));
});

test('stretch: alle hoeken in de ruit = gewoon verplaatsen', () => {
  const orig = { type: 'box', x: 10, y: 10, width: 30, height: 30 };
  const doel = { ...orig };
  const ruit = inRuit(0, 0, 100, 100);
  stretchAnnotation(orig, doel, 5, -7, ruit);
  assert.ok(dichtbij(doel.x, 15) && dichtbij(doel.y, 3));
  assert.ok(dichtbij(doel.width, 30) && dichtbij(doel.height, 30));
});

test('stretch: alleen de onderste hoeken = hoogte groeit', () => {
  const orig = { type: 'box', x: 0, y: 0, width: 40, height: 40 };
  const doel = { ...orig };
  const ruit = inRuit(-5, 35, 45, 45);
  stretchAnnotation(orig, doel, 0, 25, ruit);
  assert.ok(dichtbij(doel.y, 0));
  assert.ok(dichtbij(doel.height, 65));
});

test('stretch: lijn-uiteinde los verplaatsen', () => {
  const orig = { type: 'line', startX: 0, startY: 0, endX: 100, endY: 0 };
  const doel = { ...orig };
  const ruit = inRuit(90, -10, 110, 10);
  stretchAnnotation(orig, doel, 0, 30, ruit);
  assert.ok(dichtbij(doel.startX, 0) && dichtbij(doel.startY, 0));
  assert.ok(dichtbij(doel.endX, 100) && dichtbij(doel.endY, 30));
});

test('stretch: puntenreeks — slechts de geraakte punten bewegen', () => {
  const orig = { type: 'polyline', points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }] };
  const doel = { ...orig, points: orig.points.map((p) => ({ ...p })) };
  const ruit = inRuit(40, -10, 60, 10);
  stretchAnnotation(orig, doel, 10, 0, ruit);
  assert.ok(dichtbij(doel.points[0].x, 0));
  assert.ok(dichtbij(doel.points[1].x, 60));
  assert.ok(dichtbij(doel.points[2].x, 50), 'hoekpunt buiten de ruit blijft staan');
});

test('stretch: freehand-pad volgt mee', () => {
  const orig = { type: 'draw', path: [{ x: 0, y: 0 }, { x: 10, y: 10 }] };
  const doel = { ...orig, path: orig.path.map((p) => ({ ...p })) };
  stretchAnnotation(orig, doel, 0, 5, inRuit(5, 5, 15, 15));
  assert.ok(dichtbij(doel.path[0].y, 0));
  assert.ok(dichtbij(doel.path[1].y, 15));
});

test('stretch: minimale maat blijft behouden', () => {
  const orig = { type: 'box', x: 0, y: 0, width: 100, height: 10 };
  const doel = { ...orig };
  // Linkerrand precies tegen de rechterrand aan → nul breedte, wat de vorm
  // zou laten verdwijnen. Afkappen op de minimale maat.
  stretchAnnotation(orig, doel, 100, 0, inRuit(-1, -1, 1, 11));
  assert.ok(doel.width >= 0.5, `width = ${doel.width}`);
  assert.ok(dichtbij(doel.x, 100));

  const doel2 = { ...orig };
  stretchAnnotation(orig, doel2, 60, 0, inRuit(-1, -1, 1, 11));
  assert.ok(dichtbij(doel2.x, 60) && dichtbij(doel2.width, 40));
});

test('stretch: verticesOf levert de tikbare punten per type', () => {
  assert.equal(verticesOf({ type: 'box', x: 0, y: 0, width: 10, height: 10 }).length, 4);
  assert.equal(verticesOf({ type: 'line', startX: 0, startY: 0, endX: 1, endY: 1 }).length, 2);
  assert.equal(verticesOf({ type: 'polyline', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }).length, 2);
  assert.equal(verticesOf({}).length, 0);
  assert.equal(canStretch({}), false);
  assert.equal(canStretch({ type: 'box', x: 0, y: 0, width: 1, height: 1 }), true);
});
