// Telmarkeringen: het kader voor het selectiekader (#934). Pure logica,
// zonder app-modules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tellingKader, TELMARKERING_HALF } from './telling.js';
import { inSelectieVak } from '../plattegrond/ruimte-koppeling.js';

const tel = (id, extra = {}) => ({ id, type: 'count', page: 1, x: 100, y: 100, ...extra });

test('a count marker has a box centred on its point (#934)', () => {
  const k = tellingKader(tel('a', { x: 50, y: 70 }));
  assert.deepEqual(k, { x: 50 - TELMARKERING_HALF, y: 70 - TELMARKERING_HALF, width: 22, height: 22 });
  assert.equal(tellingKader({ type: 'count' }), null, 'no point, no box');
});

test('a selection frame around count markers selects them, window and crossing (#934)', () => {
  const a = tel('a', { x: 100, y: 100 });
  const b = tel('b', { x: 300, y: 100 });
  const vak = { x: 50, y: 50, width: 100, height: 100 };
  // Window: helemaal erin.
  assert.equal(inSelectieVak(a, tellingKader(a), vak, 'window'), true);
  assert.equal(inSelectieVak(b, tellingKader(b), vak, 'window'), false);
  // Crossing: het kader raakt de markering half.
  const half = { x: 95, y: 95, width: 50, height: 50 };
  assert.equal(inSelectieVak(a, tellingKader(a), half, 'crossing'), true);
  assert.equal(inSelectieVak(a, tellingKader(a), half, 'window'), false);
});

test('the selection bounds of the app use the count box', async () => {
  const { readFileSync } = await import('node:fs');
  const bron = readFileSync(new URL('../core/stores/selection-helpers.ts', import.meta.url), 'utf8');
  assert.match(bron, /case 'count':\s*\/\/[^\n]*\n\s*return tellingKader\(ann\);/);
});
