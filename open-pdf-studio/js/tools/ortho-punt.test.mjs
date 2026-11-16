import assert from 'node:assert/strict';
import test from 'node:test';
import { orthoPunt } from './ortho-punt.js';

const p1 = { x: 100, y: 100 };

test('zonder Shift blijft het punt waar de cursor is', () => {
  assert.deepEqual(orthoPunt(p1, { x: 180, y: 130 }, false), { x: 180, y: 130 });
});

test('met Shift: horizontaal als de cursor vooral opzij staat', () => {
  assert.deepEqual(orthoPunt(p1, { x: 180, y: 130 }, true), { x: 180, y: 100 });
  assert.deepEqual(orthoPunt(p1, { x: 20, y: 90 }, true), { x: 20, y: 100 });
});

test('met Shift: verticaal als de cursor vooral boven of onder staat', () => {
  assert.deepEqual(orthoPunt(p1, { x: 110, y: 300 }, true), { x: 100, y: 300 });
  assert.deepEqual(orthoPunt(p1, { x: 95, y: -50 }, true), { x: 100, y: -50 });
});

test('zonder eerste punt doet Shift niets', () => {
  assert.deepEqual(orthoPunt(null, { x: 5, y: 6 }, true), { x: 5, y: 6 });
});
