// The render scheduler in the app (#506): the page bitmap cache, the tile
// path and the tab switch together. A fake Rust bridge holds every render
// until the test finishes it.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();

function wire(w = 2, h = 1) {
  const out = new Uint8Array(8 + w * h * 4);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, w, true);
  dv.setUint32(4, h, true);
  return out;
}

// Every render command waits for the test; other commands answer at once.
const calls = [];
globalThis.__TAURI__ = {
  core: {
    invoke: (cmd, args) => {
      if (cmd === 'page_content_size') return Promise.resolve(0);
      return new Promise((resolve, reject) => calls.push({ cmd, args, resolve, reject }));
    },
  },
};
const closed = [];
globalThis.ImageData ??= class ImageData {
  constructor(data, width, height) { this.data = data; this.width = width; this.height = height; }
};
globalThis.createImageBitmap = async (src) => {
  const bmp = { width: src.width, height: src.height, close() { closed.push(bmp); } };
  return bmp;
};

const { state } = await import('../core/state.js');
const pbc = await import('./page-bitmap-cache.js');
const { invokeTileRegion } = await import('./progressive-render.js');
const { renderQueue } = await import('./render-queue-state.js');
const { isRenderCancelled } = await import('./render-queue.js');

/** Lets the dynamic imports and promise callbacks of the callers run. */
async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}
const renders = (cmd, path) => calls.filter((c) => c.cmd === cmd && c.args.path === path);
const tile = (path, i) => invokeTileRegion({
  path, pageIndex: 0, scale: 2, rotation: 0,
  regionXPt: i * 10, regionYPt: 0, regionWPt: 10, regionHPt: 10,
});

function showTab(index) {
  state.activeDocumentIndex = index;
  renderQueue.activeDocumentChanged();
}

test('a tab switch drops the old tiles and renders the new page at once', async () => {
  calls.length = 0;
  pbc.clearAllBitmaps();
  state.documents = [{ id: 1, filePath: 'A.pdf' }, { id: 2, filePath: 'B.pdf' }];
  showTab(0);

  const tilesA = Array.from({ length: 8 }, (_, i) => tile('A.pdf', i).then(
    () => 'drawn',
    (e) => (isRenderCancelled(e) ? 'cancelled' : `error: ${e}`),
  ));
  await settle();
  assert.equal(renders('render_pdf_page_region', 'A.pdf').length, 4, 'four tiles with the workers');

  showTab(1);
  const pageB = pbc.ensureBitmap('B.pdf', 1, 0, 1);
  await settle();
  assert.equal(renders('render_pdf_page', 'B.pdf').length, 1, 'B\'s page goes to Rust at once');
  assert.equal(renders('render_pdf_page_region', 'A.pdf').length, 4, 'no further tile of A starts');

  renders('render_pdf_page', 'B.pdf')[0].resolve(wire());
  const entry = await pageB;
  assert.ok(entry?.bitmap, 'B\'s page rendered');
  assert.ok(pbc.getCachedBitmap('B.pdf', 1, 0, 1));

  for (const c of renders('render_pdf_page_region', 'A.pdf')) c.resolve(wire());
  const outcomes = await Promise.all(tilesA);
  assert.deepEqual(outcomes, Array(8).fill('cancelled'), 'no stale tile is handed to a caller');
  assert.deepEqual(renderQueue.stats(), { queued: 0, inFlight: 0, prefetchRunning: 0 });
});

test('a page render that lands after its document was closed stays out of the cache', async () => {
  calls.length = 0;
  pbc.clearAllBitmaps();
  state.documents = [{ id: 1, filePath: 'C.pdf' }, { id: 2, filePath: 'D.pdf' }];
  showTab(0);

  const pageC = pbc.ensureBitmap('C.pdf', 1, 0, 1);
  await settle();
  assert.equal(renders('render_pdf_page', 'C.pdf').length, 1);

  // Close C (tabs.js + document-release.js): D shown, C's caches emptied.
  state.documents = [{ id: 2, filePath: 'D.pdf' }];
  showTab(0);
  renderQueue.releaseDocument('C.pdf');
  pbc.invalidateDocumentBitmaps('C.pdf');

  renders('render_pdf_page', 'C.pdf')[0].resolve(wire());
  assert.equal(await pageC, null);
  assert.equal(pbc.getCachedBitmap('C.pdf', 1, 0, 1), null, 'no bitmap of the closed document comes back');
});

test('rapid A -> B -> C switching ends with C rendered', async () => {
  calls.length = 0;
  pbc.clearAllBitmaps();
  state.documents = ['E.pdf', 'F.pdf', 'G.pdf'].map((filePath, i) => ({ id: i + 10, filePath }));
  const pages = [];
  for (let i = 0; i < 3; i++) {
    showTab(i);
    const path = state.documents[i].filePath;
    pages.push(pbc.ensureBitmap(path, 1, 0, 1));
    for (let t = 0; t < 6; t++) tile(path, t).catch(() => {});
    await settle();
  }
  // Rust works through everything it received, in order.
  for (let round = 0; round < 10; round++) {
    const open = calls.filter((c) => !c.done);
    if (!open.length) break;
    for (const c of open) { c.done = true; c.resolve(wire()); }
    await settle();
  }
  const [e, f, g] = await Promise.all(pages);
  assert.equal(e, null);
  assert.equal(f, null);
  assert.ok(g?.bitmap, 'the last document\'s page is rendered');
  assert.equal(pbc.getCachedBitmap('E.pdf', 1, 0, 1), null);
  assert.equal(pbc.getCachedBitmap('F.pdf', 1, 0, 1), null);
  assert.ok(pbc.getCachedBitmap('G.pdf', 1, 0, 1));
  // Of E and F, only what was already running reached Rust.
  assert.ok(renders('render_pdf_page_region', 'E.pdf').length <= 4);
  assert.ok(renders('render_pdf_page_region', 'F.pdf').length <= 4);
  assert.equal(renders('render_pdf_page_region', 'G.pdf').length, 6, 'all of G\'s tiles render');
});
