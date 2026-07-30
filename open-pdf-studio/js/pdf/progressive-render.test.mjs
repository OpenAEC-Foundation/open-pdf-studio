import { test } from 'node:test';
import assert from 'node:assert';
import { isHeavyBytes, computeTileGrid } from './progressive-render.js';

test('isHeavyBytes: drempel = 1MB gecomprimeerde content', () => {
  assert.equal(isHeavyBytes(2_000_000), true);
  assert.equal(isHeavyBytes(1_000_001), true);
  assert.equal(isHeavyBytes(1_000_000), false); // strikt groter dan
  assert.equal(isHeavyBytes(500_000), false);
  assert.equal(isHeavyBytes(undefined), false);
  assert.equal(isHeavyBytes(NaN), false);
});

test('computeTileGrid dekt de hele bitmap aaneensluitend, laatste kolom/rij = rest', () => {
  const tiles = computeTileGrid(843, 596, 256);
  // 843 -> kolommen 0,256,512,768 (4); 596 -> rijen 0,256,512 (3) = 12 tegels
  assert.equal(tiles.length, 12);
  // dekt exact tot 843 x 596, geen gaten voorbij
  const maxX = Math.max(...tiles.map(t => t.px + t.pw));
  const maxY = Math.max(...tiles.map(t => t.py + t.ph));
  assert.equal(maxX, 843);
  assert.equal(maxY, 596);
  // alle tegels positief
  assert.ok(tiles.every(t => t.pw > 0 && t.ph > 0));
  // rest-tegels: rechterkolom pw=75, onderrij ph=84
  assert.ok(tiles.some(t => t.pw === 75));
  assert.ok(tiles.some(t => t.ph === 84));
});

test('computeTileGrid: exact veelvoud levert volle tegels', () => {
  const tiles = computeTileGrid(512, 256, 256);
  assert.equal(tiles.length, 2); // 2 kolommen x 1 rij
  assert.ok(tiles.every(t => t.pw === 256 && t.ph === 256));
});

test('computeTileGrid: kleiner dan één tegel = één tegel', () => {
  const tiles = computeTileGrid(100, 80, 256);
  assert.equal(tiles.length, 1);
  assert.deepEqual(tiles[0], { px: 0, py: 0, pw: 100, ph: 80 });
});
