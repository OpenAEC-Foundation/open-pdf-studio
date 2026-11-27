import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register('../core/app-test-hooks.mjs', import.meta.url, {
  data: { extraStubs: [
    '/js/core/state.ts', '/js/pdf/pdf-viewport.js', '/js/pdf/page-bitmap-cache.js',
    '/js/pdf/progressive-render.js', '/js/pdf/render-queue.js', '/js/pdf/render-sharpen-pref.js',
  ] },
});
globalThis.window = { devicePixelRatio: 2 };
const { viewport } = await import('./pdf-viewport.js');
const { state } = await import('../core/state.js');
const { ensureBitmapForCurrentView } = await import('./bitmap-orchestrator.js');

// The real bucket rule: the next power of two at or above the scale.
const powerOfTwoBucket = (scale) => 2 ** Math.ceil(Math.log2(scale));

function renders() {
  const asked = [];
  globalThis.__nep = {
    isHeavyPage: () => false,
    isExtremePage: () => false,
    computeZoomBucket: powerOfTwoBucket,
    getBestAvailableBitmap: () => null,
    ensureBitmap: (_path, _page, _rot, scale) => { asked.push(scale); return { bitmap: `whole@${scale}` }; },
    ensureExactBitmap: (_path, _page, _rot, scale) => { asked.push(scale); return { bitmap: `exact@${scale}` }; },
  };
  state.preferences = { progressiveRender: false };
  return asked;
}

// An A0 sheet (3370 x 2384 pt): the 4096 px axis limit allows scale 1.215.
const A0 = { pageW: 3370, pageH: 2384 };
const CAP = 4096 / 3370;

for (const zoom of [0.75, 1, 1.5, 4]) {
  test(`A0 at ${zoom * 100}% on a 2x screen renders the whole page once, within the 4096 px limit`, async () => {
    const asked = renders();
    Object.assign(viewport, { active: true, pageType: 'raster', filePath: 'a0.pdf', pageNum: 1, rotation: 0, zoom, currentBitmap: null, ...A0 });
    await ensureBitmapForCurrentView();
    assert.equal(asked.length, 1, `one render, asked: ${asked}`);
    assert.ok(asked[0] <= CAP + 1e-9, `scale ${asked[0]} exceeds the cap ${CAP}`);
    assert.ok(Math.max(A0.pageW, A0.pageH) * asked[0] <= 4096 + 1e-6);
    assert.equal(viewport.currentBitmap, `whole@${asked[0]}`);
  });
}

test('below the cap the power-of-two bucket and the exact settle render stay as they were', async () => {
  const asked = renders();
  // A4 portrait at 75% on a 2x screen: target 1.5, bucket 2 (1684 px), exact 1.5.
  Object.assign(viewport, { active: true, pageType: 'raster', filePath: 'a4.pdf', pageNum: 1, rotation: 0, zoom: 0.75, currentBitmap: null, pageW: 595, pageH: 842 });
  await ensureBitmapForCurrentView();
  assert.deepEqual(asked, [2, 1.5]);
  assert.equal(viewport.currentBitmap, 'exact@1.5');
});
