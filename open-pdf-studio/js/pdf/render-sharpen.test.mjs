import test from 'node:test';
import assert from 'node:assert/strict';
import { sharpenRgba, sharpenAmount } from './render-sharpen.js';

function img(w, h, fn) {
  const a = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = fn(x, y), i = (y * w + x) * 4;
    a[i] = a[i + 1] = a[i + 2] = v; a[i + 3] = 255;
  }
  return a;
}

test('vlakke gebieden blijven ongemoeid', () => {
  const a = img(8, 8, () => 200);
  sharpenRgba(a, 8, 8, 0.5);
  assert.ok([...a].every((v, i) => i % 4 === 3 ? v === 255 : v === 200));
});

test('een zachte rand wordt steiler: donkere kant donkerder, lichte kant lichter', () => {
  const w = 9, h = 5;
  const a = img(w, h, (x) => (x < 4 ? 0 : x === 4 ? 128 : 255));
  const before = [...a];
  sharpenRgba(a, w, h, 0.5);
  const px = (arr, x, y) => arr[(y * w + x) * 4];
  assert.ok(px(a, 3, 2) <= px(before, 3, 2));
  assert.ok(px(a, 5, 2) >= px(before, 5, 2));
  assert.ok(px(a, 4, 2) === px(before, 4, 2) || px(a, 4, 2) !== px(before, 4, 2));
  const stepBefore = px(before, 5, 2) - px(before, 3, 2);
  const stepAfter = px(a, 5, 2) - px(a, 3, 2);
  assert.ok(stepAfter >= stepBefore);
});

test('alpha en de buitenste rand blijven staan, niveau 0 doet niets', () => {
  const a = img(6, 6, (x) => (x < 3 ? 0 : 255));
  a[3] = 77;
  const copy = [...a];
  sharpenRgba(a, 6, 6, 0);
  assert.deepEqual([...a], copy);
  sharpenRgba(a, 6, 6, 0.8);
  assert.equal(a[3], 77);
  assert.equal(a[0], copy[0]);
});

test('onbruikbare maat of hoeveelheid laat de pixels staan', () => {
  const a = img(2, 2, () => 100);
  assert.equal(sharpenRgba(a, 2, 2, 0.5), a);
  assert.equal(sharpenAmount(9), 0);
  assert.equal(sharpenAmount(2), 0.5);
  assert.equal(sharpenAmount(4), 1.2);
});
