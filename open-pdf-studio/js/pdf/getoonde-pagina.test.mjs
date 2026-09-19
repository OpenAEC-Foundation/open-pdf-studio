import assert from 'node:assert/strict';
import test from 'node:test';

import { viewportOpties } from './getoonde-pagina.js';

test('zonder extra draaiing geen rotation: PDF.js past /Rotate zelf toe', () => {
  assert.deepEqual(viewportOpties({ rotate: 90 }, 0), { scale: 1 });
  assert.deepEqual(viewportOpties({ rotate: 90 }, undefined), { scale: 1 });
});

test('extra draaiing telt op bij de eigen /Rotate, modulo 360', () => {
  assert.deepEqual(viewportOpties({ rotate: 0 }, 90), { scale: 1, rotation: 90 });
  assert.deepEqual(viewportOpties({ rotate: 90 }, 90), { scale: 1, rotation: 180 });
  assert.deepEqual(viewportOpties({ rotate: 270 }, 180), { scale: 1, rotation: 90 });
});

test('schaal gaat ongewijzigd mee', () => {
  assert.deepEqual(viewportOpties({ rotate: 0 }, 0, 0.25), { scale: 0.25 });
  assert.deepEqual(viewportOpties({ rotate: 90 }, 90, 2), { scale: 2, rotation: 180 });
});
