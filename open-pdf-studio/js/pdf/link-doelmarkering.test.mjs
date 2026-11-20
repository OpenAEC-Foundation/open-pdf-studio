import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kiesDoelVakken } from './link-doelmarkering.js';

const v = (str, x, y, h = 8) => ({ str, x, y, w: str.length * h * 0.6, h, angle: 0 });

test('marks the matching word and the line stacked on it, not the title block', () => {
  const doel = [v('FD01', 100, 100), v('S1.01', 98, 110), v('DETAIL', 140, 100, 12), v('S3.01', 900, 800, 14), v('NOTE', 300, 300)];
  const k = kiesDoelVakken(doel, [v('FD01', 0, 0), v('S3.01', 0, 10)]);
  assert.deepEqual(k.map((x) => x.str).sort(), ['FD01', 'S1.01']);
});

test('with a destination point only the nearest match', () => {
  const doel = [v('FD01', 100, 100), v('S3.01', 98, 110), v('FD01', 500, 400), v('S3.01', 498, 410)];
  const k = kiesDoelVakken(doel, [v('FD01', 0, 0)], { x: 480, y: 380 });
  assert.deepEqual(k.map((x) => [x.str, x.x]), [['FD01', 500], ['S3.01', 498]]);
});

test('no match, or a word everywhere: nothing marked', () => {
  assert.deepEqual(kiesDoelVakken([v('A', 1, 1)], [v('FD01', 0, 0)]), []);
  const veel = Array.from({ length: 13 }, (_, i) => v('TYP', i * 50, 10));
  assert.deepEqual(kiesDoelVakken(veel, [v('TYP', 0, 0)]), []);
});
