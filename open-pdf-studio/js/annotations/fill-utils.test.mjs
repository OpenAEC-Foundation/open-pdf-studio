import test from 'node:test';
import assert from 'node:assert/strict';
import { hasFill, hasStroke } from './fill-utils.js';

test('hasFill: true for a real color, false for unset/none/transparent', () => {
  assert.equal(hasFill('#ff0000'), true);
  assert.equal(hasFill(undefined), false);
  assert.equal(hasFill(null), false);
  assert.equal(hasFill(''), false);
  assert.equal(hasFill('none'), false);
  assert.equal(hasFill('transparent'), false);
});

test('hasStroke: false only for the explicit none/transparent sentinel', () => {
  assert.equal(hasStroke('none'), false);
  assert.equal(hasStroke('transparent'), false);
  assert.equal(hasStroke('#000000'), true);
  // Unlike hasFill, an unset strokeColor still has a border: the renderer
  // falls back to annotation.color (`annotation.strokeColor ||
  // annotation.color`), so hasStroke() must stay true for undefined/null —
  // only the two explicit sentinel values mean "no border".
  assert.equal(hasStroke(undefined), true);
  assert.equal(hasStroke(null), true);
  assert.equal(hasStroke(''), true);
});
