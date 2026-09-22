import test from 'node:test';
import assert from 'node:assert/strict';
import { hasFill, hasStroke, kanZonderRand } from './fill-utils.js';

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

test('kanZonderRand: alleen vormen waarvan de omtrek weg kan', () => {
  for (const t of ['box', 'circle', 'polygon', 'cloud', 'textbox', 'callout', 'filledArea', 'measureArea']) {
    assert.equal(kanZonderRand(t), true, t);
  }
  // Een lijn, pijl, vrije hand of maatlijn is zijn streek: geen "geen rand".
  for (const t of ['line', 'arrow', 'draw', 'measureDistance', 'measurePerimeter', 'polyline', 'cloudPolyline', 'text', undefined]) {
    assert.equal(kanZonderRand(t), false, String(t));
  }
});
