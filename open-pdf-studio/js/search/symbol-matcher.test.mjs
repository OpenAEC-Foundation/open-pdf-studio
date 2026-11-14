import test from 'node:test';
import assert from 'node:assert/strict';
import { cropTemplate, transformTemplate, matchSymbols, planSymbolCounts } from './symbol-matcher.js';

const blank = (width, height) => ({ width, height, pixels: new Uint8Array(width * height) });

function symbol() {
  const t = blank(16, 16);
  for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) if (x < 5 || y > 10 || x === 10 && y < 7) t.pixels[y * 16 + x] = 1;
  return t;
}

function stamp(image, t, x, y) {
  for (let row = 0; row < t.height; row++) for (let col = 0; col < t.width; col++) image.pixels[(y + row) * image.width + x + col] = t.pixels[row * t.width + col];
}
test('deterministic vector-like and noisy scan fixtures: precision/recall reported', async () => {
  const t = symbol(),
    image = blank(180, 120),
    truth = [{ x: 10, y: 10, t }, { x: 60, y: 10, t: transformTemplate(t, 90, 1) }, { x: 110, y: 15, t: transformTemplate(t, 0, 1.2) }, { x: 25, y: 70, t }];
  for (const s of truth) stamp(image, s.t, s.x, s.y);
  // A few missing/extra scan pixels, and a solid unrelated mark.
  image.pixels[73 * 180 + 28] = 0;
  image.pixels[78 * 180 + 32] = 1;
  for (let y = 70; y < 82; y++) for (let x = 100; x < 112; x++) image.pixels[y * 180 + x] = 1;
  const { matches } = await matchSymbols(image, t, {
    threshold: .75,
    rotations: [0, 90, 180, 270],
    scales: [.8, 1, 1.2],
    yieldTask: async () => {}
  });
  const tp = matches.filter(m => truth.some(s => Math.hypot(m.x - s.x, m.y - s.y) < 3)).length;
  assert.equal(matches.length, 4, JSON.stringify(matches));
  assert.equal(tp, 4);
  console.log('Synthetic mixed fixture: precision=1.00, recall=1.00 (4/4; not a general accuracy claim)');
  const exact = await matchSymbols(image, t, {
    threshold: .95,
    rotations: [0],
    scales: [1],
    yieldTask: async () => {}
  });
  assert.ok(exact.matches.length < 4);
});
test('cancellation rejects without partial output and blank templates fail', async () => {
  const controller = new AbortController();
  await assert.rejects(matchSymbols(blank(100, 100), symbol(), { signal: controller.signal, yieldTask: async () => controller.abort() }), { name: 'AbortError' });
  assert.throws(() => cropTemplate(blank(100, 100), { x: 0, y: 0, width: 20, height: 20 }), /CONTRAST/);
  await assert.rejects(matchSymbols(blank(100, 100), symbol(), { scales: [4] }), /TOLERANCE/);
});
test('only selected matches create counts; repeats and reloaded locations do not duplicate', () => {
  const category = { id: 'doors', name: 'Doors', color: '#ff0000' },
    matches = [{ id: 'a', page: 1, bounds: { x: 10, y: 20, width: 10, height: 10 } }, { id: 'b', page: 2, bounds: { x: 10, y: 20, width: 10, height: 10 } }];
  const first = planSymbolCounts([matches[0]], [], category);
  assert.equal(first.length, 1);
  assert.equal(first[0].type, 'count');
  assert.equal(first[0].number, 1);
  assert.equal(planSymbolCounts([matches[0]], first, category).length, 0);
  const next = planSymbolCounts(matches, JSON.parse(JSON.stringify(first)), category);
  assert.equal(next.length, 1);
  assert.equal(next[0].page, 2);
  assert.equal(next[0].number, 2);
});

// One pixel of displacement along thin lines (anti-aliasing, a symbol on a
// fraction of a pixel) must not lose the match; unrelated dense ink must not
// become one.
function thinSymbol(shift = 0) {
  const t = blank(24, 24);
  for (let i = 3; i < 21; i++) {
    t.pixels[(12 + (i > 11 ? shift : 0)) * 24 + i] = 1; // horizontal bar, half of it one row lower
    t.pixels[i * 24 + 6] = 1;                           // vertical bar
  }
  for (let i = 0; i < 6; i++) t.pixels[(4 + i) * 24 + 15 + i] = 1; // a diagonal, so turns differ
  return t;
}
test('a copy displaced by one pixel along its thin lines is still found', async () => {
  const image = blank(200, 120);
  stamp(image, thinSymbol(0), 10, 10);
  stamp(image, thinSymbol(1), 80, 40);
  stamp(image, thinSymbol(1), 150, 70);
  const { matches } = await matchSymbols(image, thinSymbol(0), { yieldTask: async () => {} });
  assert.deepEqual(matches.map(m => [m.x, m.y]).sort((a, b) => a[0] - b[0]), [[10, 10], [80, 40], [150, 70]], JSON.stringify(matches));
  assert.equal(matches.find(m => m.x === 10).score, 1, 'an exact copy scores 1');
  assert.ok(matches.every(m => m.score >= .75 && m.score <= 1));
});
test('dense unrelated ink does not match a dense template', async () => {
  // Two different pseudo-random textures of the same density: every pixel has
  // ink within one pixel, but the exact overlap is that of chance.
  let s = 7;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const template = blank(24, 24);
  for (let i = 0; i < template.pixels.length; i++) template.pixels[i] = rnd() < .45 ? 1 : 0;
  const image = blank(160, 100);
  for (let i = 0; i < image.pixels.length; i++) image.pixels[i] = rnd() < .45 ? 1 : 0;
  stamp(image, template, 100, 50);
  for (let row = 0; row < 24; row++) for (let col = 0; col < 24; col++) image.pixels[(50 + row) * 160 + 100 + col] = template.pixels[row * 24 + col];
  const { matches } = await matchSymbols(image, template, { yieldTask: async () => {} });
  assert.deepEqual(matches.map(m => [m.x, m.y]), [[100, 50]], JSON.stringify(matches.slice(0, 5)));
});

test('the default pause between rows is a plain task, not a timer', async () => {
  // A timer costs about 4 ms in a WebView once nested; at one pause per 16
  // rows that was about 0.2 s of waiting per variant and page.
  const timer = globalThis.setTimeout;
  let timers = 0;
  globalThis.setTimeout = (...a) => { timers++; return timer(...a); };
  try {
    const image = blank(120, 200);
    stamp(image, symbol(), 30, 150);
    const { matches } = await matchSymbols(image, symbol());
    assert.equal(matches.length, 1);
  } finally {
    globalThis.setTimeout = timer;
  }
  assert.equal(timers, 0);
});

test('a thick symbol is reported at its exact place, not one pixel off', async () => {
  // Every position within one pixel scores 1 with the tolerant score; the
  // exact overlap decides between them.
  const t = blank(12, 12);
  for (let y = 2; y < 10; y++) for (let x = 2; x < 10; x++) if (x < 6 || y > 6) t.pixels[y * 12 + x] = 1;
  const image = blank(80, 60);
  stamp(image, t, 31, 22);
  const { matches } = await matchSymbols(image, t, { yieldTask: async () => {} });
  assert.deepEqual(matches.map(m => [m.x, m.y, m.score]), [[31, 22, 1]]);
});
