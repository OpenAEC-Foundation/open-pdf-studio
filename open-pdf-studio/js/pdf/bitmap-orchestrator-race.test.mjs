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
const { viewport } = await import('./pdf-viewport.js');
const { state } = await import('../core/state.js');
const { ensureBitmapForCurrentView } = await import('./bitmap-orchestrator.js');

for (const change of ['switch page', 'close viewport']) {
  test('late page classification after ' + change, async () => {
    let release;
    const progressive = [];
    globalThis.__nep = {
      isHeavyPage: (_path, page) => page === 1 ? new Promise(resolve => { release = resolve; }) : false,
      isExtremePage: () => false,
      computeZoomBucket: scale => scale,
      ensureBitmap: (_path, page) => ({ bitmap: page }),
      ensureProgressiveBitmapForCurrentView: () => progressive.push(viewport.pageNum),
    };
    Object.assign(viewport, {
      active: true, pageType: 'raster', filePath: 'test', pageNum: 1,
      pageW: 800, pageH: 600, zoom: 1, rotation: 0, currentBitmap: null,
    });
    state.preferences = { progressiveRender: true };
    const delayed = ensureBitmapForCurrentView();
    if (change === 'switch page') viewport.pageNum = 2;
    else viewport.active = false;
    await ensureBitmapForCurrentView();
    release(true);
    await delayed;
    assert.deepEqual(progressive, []);
    assert.equal(viewport.currentBitmap, change === 'switch page' ? 2 : null);
  });
}
