import test from 'node:test';
import assert from 'node:assert/strict';
import { apOpacityPlan } from './ap-opacity.js';

test('geen doorzichtigheid: niets toevoegen', () => {
  for (const o of [undefined, null, 1, 0, -1, NaN, 'x']) {
    const p = apOpacityPlan(o, undefined);
    assert.equal(p.prefix, '');
    assert.equal(p.overall, undefined);
    assert.equal(p.fill, undefined);
  }
});

test('40% doorzichtigheid: /GSo gs voorop en alfa 0,4', () => {
  const p = apOpacityPlan(0.4, undefined);
  assert.equal(p.prefix, '/GSo gs\n');
  assert.equal(p.overall, 0.4);
  assert.equal(p.fill, undefined);
});

test('aparte vul-alfa wordt met de algemene vermenigvuldigd', () => {
  const p = apOpacityPlan(0.5, 0.5);
  assert.equal(p.overall, 0.5);
  assert.equal(p.fill, 0.25);
});

test('alleen vul-alfa blijft zoals ze was', () => {
  const p = apOpacityPlan(1, 0.3);
  assert.equal(p.prefix, '');
  assert.equal(p.fill, 0.3);
});
