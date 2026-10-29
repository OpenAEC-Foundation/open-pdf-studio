import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

// Exercise the real viewport renderer with controlled cache/RAF boundaries.
const frames = new Map();
let nextFrame = 0;
globalThis.requestAnimationFrame = cb => { frames.set(++nextFrame, cb); return nextFrame; };
globalThis.cancelAnimationFrame = id => frames.delete(id);
function paint() {
  const pending = [...frames.values()]; frames.clear();
  for (const cb of pending) cb(performance.now());
}
const container = { clientWidth: 800, clientHeight: 600, querySelector: () => null };
globalThis.window = { devicePixelRatio: 2, addEventListener() {}, removeEventListener() {} };
globalThis.document = {
  getElementById: id => id === 'pdf-container' ? container : null,
  querySelector: () => null,
};
globalThis.OffscreenCanvas = class {
  constructor(width, height) { this.width = width; this.height = height; }
  getContext() { return { drawImage() {} }; }
};
const cache = new Map();
const queries = [];
globalThis.__vpTest = { impl: {
  computeZoomBucket: s => s,
  getBestAvailableBitmap: (...args) => {
    queries.push(args);
    const bitmap = cache.get(args.slice(0, 3).join(':'));
    return bitmap ? { bitmap } : null;
  },
} };
register('./pdf-viewport-test-hooks.mjs', import.meta.url);
const vp = await import('./pdf-viewport.js');
const { viewport } = vp;
const draws = [];
let transform;
const ctx = new Proxy({
  setTransform: (...m) => { transform = m; },
  drawImage: (bitmap, ...rect) => draws.push({ bitmap, rect, transform: [...transform] }),
}, { get: (obj, key) => obj[key] ?? (() => {}) });
const canvas = { width: 0, height: 0, style: {}, getContext: () => ctx };

function start(viewRotation = 0, width = 600, height = 800) {
  vp.vergeetGetoondDocument(); cache.clear(); queries.length = 0; draws.length = 0;
  vp.initViewport(canvas, () => {});
  vp.setPage('drawing.pdf', 1, width, height, 0, 0, 0, viewRotation);
  viewport.pageType = 'raster';
  vp.zetViewportStand({ zoom: 3, offsetX: -200, offsetY: -400 });
  viewport.currentBitmap = { width: 600, height: 800, old: true };
  paint(); draws.length = 0; queries.length = 0;
}

for (const viewRotation of [0, 90, 180, 270]) {
  test(`cached page paints immediately at 300% and the existing pan (view rotation ${viewRotation})`, () => {
    start(viewRotation);
    const bitmap = { width: 3600, height: 4800 };
    cache.set('drawing.pdf:2:0', bitmap);
    vp.setPage('drawing.pdf', 2, 600, 800, 0, 0, 0, viewRotation);
    assert.equal(viewport.currentBitmap, bitmap, 'cache selected synchronously, before the next frame');
    assert.deepEqual(queries[0], ['drawing.pdf', 2, 0, 4096 / 800]);
    paint();
    assert.equal(viewport.zoom, 3);
    assert.equal(viewport.offsetX, -200);
    assert.equal(viewport.offsetY, -400);
    assert.equal(draws.length, 1);
    assert.equal(draws[0].bitmap, bitmap);
    assert.deepEqual(draws[0].rect, [0, 0, 3600, 4800], 'page size × zoom × DPR, never fit-to-window');
    // The final high-resolution raster replaces it with precisely the same transform.
    viewport.currentBitmap = { width: 3600, height: 4800 };
    viewport.dirty = true; paint();
    assert.deepEqual(draws[1].transform, draws[0].transform);
    assert.deepEqual(draws[1].rect, draws[0].rect);
  });
}

test('rapid cached / cold / cached navigation never reuses the previous page or tile', () => {
  start();
  const cached = { width: 3600, height: 4800 };
  cache.set('drawing.pdf:2:0', cached);
  for (const page of [2, 3, 2]) {
    viewport.currentTile = { width: 300, height: 400 };
    viewport.currentTileMeta = { regionXpt: 0 };
    vp.setPage('drawing.pdf', page, 600, 800, 0, 0, 0);
    assert.equal(viewport.currentBitmap, page === 2 ? cached : null);
    assert.equal(viewport.currentTile, null);
    assert.equal(viewport.currentTileMeta, null);
    draws.length = 0; paint();
    assert.equal(draws.length, page === 2 ? 1 : 0);
  }
});

test('a zoom snapshot from the departing page cannot cover the new cached page', () => {
  start();
  vp.setZoomAtPoint(400, 300, 3.1);
  const bitmap = { width: 3600, height: 4800 };
  cache.set('drawing.pdf:2:0', bitmap);
  vp.setPage('drawing.pdf', 2, 600, 800, 0, 0, 0);
  paint();
  assert.equal(draws.at(-1).bitmap, bitmap, 'no previous-page OffscreenCanvas snapshot');
});

test('a smaller page preserves the existing free-pan behavior and zoom', () => {
  start();
  vp.setPage('drawing.pdf', 2, 100, 100, 0, 0, 0);
  paint();
  assert.equal(viewport.zoom, 3);
  assert.equal(viewport.offsetX, -200);
  assert.equal(viewport.offsetY, -400);
});

test('cache uses the requested document and rotation', () => {
  start(0, 2000, 3000);
  const bitmap = { width: 1000, height: 800 };
  cache.set('drawing.pdf:2:90', bitmap);
  vp.setPage('drawing.pdf', 2, 1000, 800, 0, 0, 90);
  assert.equal(viewport.currentBitmap, bitmap);
  assert.equal(queries.at(-1)[2], 90);
  vp.setPage('other.pdf', 2, 1000, 800, 0, 0, 90);
  assert.equal(viewport.currentBitmap, null, 'same page number in another document is not a cache hit');
  assert.equal(queries.at(-1)[0], 'other.pdf');
});
