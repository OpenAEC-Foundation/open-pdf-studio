// Depth of a measurement (#311): length × depth is a surface, area × depth a
// volume, in the measurement's own unit (mm and cm shown in metres).

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDepth, depthQuantity, formatDepthQuantity, supportsDepth } from './measure-depth.js';

test('a depth is a positive number; comma and point both work', () => {
  assert.equal(parseDepth('2600'), 2600);
  assert.equal(parseDepth('2,5'), 2.5);
  assert.equal(parseDepth(0.3), 0.3);
  for (const v of ['', null, undefined, '0', '-3', 'abc', 0, NaN]) assert.equal(parseDepth(v), undefined, String(v));
});

test('length × depth gives a surface, area × depth a volume', () => {
  const wall = depthQuantity({ type: 'measureDistance', measureValue: 2400, measureUnit: 'mm', measureDepth: 3000 });
  assert.equal(wall.kind, 'surface');
  assert.equal(wall.unit, 'm²');
  assert.equal(formatDepthQuantity(wall), '7.200 m²');
  const slab = depthQuantity({ type: 'measureArea', measureValue: 20, measureUnit: 'm²', measureDepth: 0.25 });
  assert.equal(slab.kind, 'volume');
  assert.equal(formatDepthQuantity(slab), '5.000 m³');
  const screed = depthQuantity({ type: 'measureArea', measureValue: 2e6, measureUnit: 'mm²', measureDepth: 50 });
  assert.equal(formatDepthQuantity(screed), '0.100 m³');
  const feet = depthQuantity({ type: 'measurePerimeter', measureValue: 10, measureUnit: 'ft', measureDepth: 8 });
  assert.equal(formatDepthQuantity(feet, 1), '80.0 ft²');
});

test('no depth, no value or another type: nothing to show', () => {
  assert.equal(depthQuantity({ type: 'measureDistance', measureValue: 10, measureUnit: 'm' }), null);
  assert.equal(depthQuantity({ type: 'measureAngle', measureValue: 10, measureDepth: 2 }), null);
  assert.equal(depthQuantity({ type: 'measureArea', measureUnit: 'm²', measureDepth: 2 }), null);
  assert.equal(supportsDepth('measurePerimeter'), true);
  assert.equal(supportsDepth('line'), false);
  assert.equal(formatDepthQuantity(null), '');
});
