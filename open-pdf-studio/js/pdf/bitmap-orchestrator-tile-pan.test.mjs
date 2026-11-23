import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register('../core/app-test-hooks.mjs', import.meta.url, {
  data: { extraStubs: [
    '/js/core/state.ts', '/js/pdf/pdf-viewport.js', '/js/pdf/page-bitmap-cache.js',
    '/js/pdf/progressive-render.js', '/js/pdf/render-queue.js', '/js/pdf/render-sharpen-pref.js',
  ] },
});
globalThis.window = { devicePixelRatio: 1 };
globalThis.ImageData = class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } };
globalThis.createImageBitmap = async (image) => ({ width: image.width, height: image.height, close() {} });

const { viewport } = await import('./pdf-viewport.js');
const { ensureTileForCurrentView } = await import('./bitmap-orchestrator.js');
const { tileCoversViewport } = await import('./tile-coverage.js');
const { tileCacheClearAll } = await import('./tile-cache.js');

// A large sheet (1609 x 841 mm) zoomed in so far that the visible part is much
// smaller than a quarter of the page.
const PAGE = { pageW: 4560.84, pageH: 2383.92 };
const ZOOM = 6;
const canvas = { width: 990, height: 1132 };

function tileBytes() {
  const bytes = new Uint8Array(8 + 4);
  new DataView(bytes.buffer).setUint32(0, 1, true);
  new DataView(bytes.buffer).setUint32(4, 1, true);
  return bytes;
}

test('panning within one cache cell renders a tile for the new view', async () => {
  tileCacheClearAll();
  const rendered = [];
  globalThis.__nep = {
    computeZoomBucket: (scale) => 2 ** Math.ceil(Math.log2(scale)),
    invokeTileRegion: (args) => { rendered.push(args); return tileBytes(); },
    sharpenPageRgba: (rgba) => rgba,
    isRenderCancelled: () => false,
  };
  Object.assign(viewport, {
    active: true, pageType: 'raster', filePath: 'sheet.pdf', pageNum: 3, rotation: 0, viewRotation: 0,
    ...PAGE, zoom: ZOOM, offsetX: -2200 * ZOOM, offsetY: -660 * ZOOM,
    currentBitmap: null, currentTile: null, currentTileMeta: null, dirty: false,
  });

  await ensureTileForCurrentView(canvas);
  assert.equal(rendered.length, 1);
  assert.ok(tileCoversViewport(viewport.currentTileMeta, viewport, canvas.width, canvas.height, 1));

  // Scroll down by more than the tile's buffer, but stay inside the same
  // quarter-page cell of the cache key.
  viewport.offsetY = -940 * ZOOM;
  await ensureTileForCurrentView(canvas);

  assert.equal(rendered.length, 2, 'a tile for the new position is rendered');
  assert.ok(
    tileCoversViewport(viewport.currentTileMeta, viewport, canvas.width, canvas.height, 1),
    'the tile on screen covers the visible part of the page',
  );
});
