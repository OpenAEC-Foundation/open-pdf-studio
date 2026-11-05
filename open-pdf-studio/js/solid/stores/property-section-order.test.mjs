import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SECTION_ORDER as defaults, normalizeSectionOrder, moveSection } from './property-section-order.js';
test('old or damaged preferences yield every known section once', () => {
  for (const input of [undefined, null, {}, 'general', 3]) assert.deepEqual(normalizeSectionOrder(input), defaults);
  const saved = ['appearance', 'appearance', '__proto__', null, 'general'];
  const order = normalizeSectionOrder(saved);
  assert.deepEqual(order.slice(0, 2), ['appearance', 'general']);
  assert.equal(order.length, defaults.length);
  assert.deepEqual(order.slice(2), defaults.filter(x => !['appearance','general'].includes(x)));
  assert.equal(saved.length, 5);
});
test('moving above and below a target preserves other sections and the input', () => {
  const order = moveSection(defaults, 'appearance', 'location');
  assert.deepEqual(order.slice(0, 4), ['general','appearance','location','replies']);
  assert.deepEqual(moveSection(order, 'appearance','replies',true), defaults);
  assert.equal(defaults[3], 'appearance');
});
test('sections absent from one annotation survive a move and a saved round trip', () => {
  let saved = moveSection(defaults,'textFormat','location');
  saved = moveSection(JSON.parse(JSON.stringify(saved)), 'appearance','general');
  const line = saved.filter(id => ['general','location','appearance','lineEndings'].includes(id));
  assert.deepEqual(line, ['appearance','general','location','lineEndings']);
  assert(saved.indexOf('textFormat') < saved.indexOf('location'));
  assert.deepEqual(saved.filter(id => !['textFormat','appearance'].includes(id)), defaults.filter(id => !['textFormat','appearance'].includes(id)));
});
test('unknown/self targets are harmless; default reset is independent of saved order', () => {
  for (const [source,target] of [['unknown','general'],['general','unknown'],['general','general']]) assert.deepEqual(moveSection(defaults,source,target),defaults);
  moveSection(defaults,'paragraph','general');
  assert.deepEqual(normalizeSectionOrder(), defaults);
});
