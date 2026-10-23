import assert from 'node:assert/strict';
import test from 'node:test';
import { verticaleVerschuiving, TEKST_V_UITLIJNINGEN } from './textbox-layout.js';

test('verticaleVerschuiving: boven blijft staan, midden de helft, onder alles', () => {
  assert.equal(verticaleVerschuiving('top', 100, 40), 0);
  assert.equal(verticaleVerschuiving(undefined, 100, 40), 0);
  assert.equal(verticaleVerschuiving('middle', 100, 40), 30);
  assert.equal(verticaleVerschuiving('bottom', 100, 40), 60);
});

test('verticaleVerschuiving: past de tekst niet, dan begint hij boven', () => {
  assert.equal(verticaleVerschuiving('middle', 40, 100), 0);
  assert.equal(verticaleVerschuiving('bottom', 40, 40), 0);
  assert.equal(verticaleVerschuiving('middle', 0, 0), 0);
});

test('de uitlijningen', () => {
  assert.deepEqual([...TEKST_V_UITLIJNINGEN], ['top', 'middle', 'bottom']);
});
