// Een progressieve run publiceert alleen in een viewport die nog zijn eigen
// pagina toont (MV-03 → B3-regressie: bitmap van het vorige document onder
// de annotaties van het nieuwe).

import assert from 'node:assert/strict';
import test from 'node:test';

import { runVolgtViewport } from './progressive-render.js';

const run = { filePath: 'C:/t/MV-03.pdf', pageNum: 1, rotation: 0 };

test('zelfde document, pagina en rotatie: run mag publiceren', () => {
  assert.equal(runVolgtViewport(run, { active: true, filePath: 'C:/t/MV-03.pdf', pageNum: 1, rotation: 0 }), true);
  // rotatie ontbreekt of is 360: gelijk aan 0
  assert.equal(runVolgtViewport(run, { active: true, filePath: 'C:/t/MV-03.pdf', pageNum: 1 }), true);
  assert.equal(runVolgtViewport(run, { active: true, filePath: 'C:/t/MV-03.pdf', pageNum: 1, rotation: 360 }), true);
  assert.equal(runVolgtViewport({ ...run, rotation: -90 }, { active: true, filePath: 'C:/t/MV-03.pdf', pageNum: 1, rotation: 270 }), true);
});

test('ander document in de viewport: run is stale', () => {
  assert.equal(runVolgtViewport(run, { active: true, filePath: 'C:/t/B3.pdf', pageNum: 1, rotation: 0 }), false);
});

test('andere pagina of rotatie van hetzelfde document: run is stale', () => {
  assert.equal(runVolgtViewport(run, { active: true, filePath: 'C:/t/MV-03.pdf', pageNum: 2, rotation: 0 }), false);
  assert.equal(runVolgtViewport(run, { active: true, filePath: 'C:/t/MV-03.pdf', pageNum: 1, rotation: 90 }), false);
});

test('viewport niet actief of leeg: nooit publiceren', () => {
  assert.equal(runVolgtViewport(run, { active: false, filePath: 'C:/t/MV-03.pdf', pageNum: 1 }), false);
  assert.equal(runVolgtViewport(run, null), false);
  assert.equal(runVolgtViewport(null, { active: true, filePath: 'C:/t/MV-03.pdf', pageNum: 1 }), false);
});
