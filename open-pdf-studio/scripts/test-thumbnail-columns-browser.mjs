// Real thumbnail layout/rendering, persistence and page interactions.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { PDFDocument } from 'pdf-lib';
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const cache = await mkdtemp(path.join(tmpdir(), 'opds-thumbnail-columns-'));
const server = await createServer({ root, cacheDir: cache, logLevel: 'error',
  server: { host: '127.0.0.1', port: 18397, strictPort: false, hmr: false } });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
  // Expose the CI race: an already-visible slider still has its previous max
  // until ResizeObserver delivers the new panel size.
  await page.addInitScript(() => {
    const NativeObserver = window.ResizeObserver;
    window.ResizeObserver = class extends NativeObserver {
      constructor(callback) { super((entries, observer) => setTimeout(() => callback(entries, observer), 200)); }
    };
  });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { timeout: 120000 });
  await page.waitForSelector('#tool-select', { timeout: 120000 });
  const pdf = await PDFDocument.create();
  for (let n = 1; n <= 6; n++) pdf.addPage([300 + n * 10, 220]).drawText(`Page ${n}`, { x: 30, y: 100 });
  const bytes = [...await pdf.save()];
  async function load() {
    await page.evaluate(async bytes => {
      const { index } = (await import('/js/ui/chrome/tabs.js')).createTab('/columns.pdf');
      await (await import('/js/pdf/loader.js')).loadPDF('/columns.pdf', index, new Uint8Array(bytes));
      window.testState = await import('/js/core/state.ts');
      await window.testState.getActiveDocument()._annotationCompletion;
    }, bytes);
  }
  async function resize(width, maxColumns) {
    await page.evaluate(async breedte => (await import('/js/solid/stores/leftPanelStore.js')).herstelLeftPanel({ collapsed: false, tab: 'thumbnails', breedte }), width);
    // Visibility alone can succeed before the observer updates the signal.
    await page.waitForFunction(max => {
      const control = document.getElementById('thumbnail-columns');
      return max === 1 ? !control : control?.max === String(max);
    }, maxColumns);
  }
  const slider = page.locator('#thumbnail-columns');
  const thumb = n => page.locator(`#thumbnails-container .thumbnail-item[data-page="${n}"]`);
  const count = () => page.locator('#thumbnails-container').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(/\s+/).length);
  async function choose(n) { await slider.evaluate((el, n) => { el.value = String(n); el.dispatchEvent(new Event('input', { bubbles: true })); }, n); }
  await load(); await resize(900, 5);
  await page.waitForFunction(() => document.getElementById('thumbnail-columns')?.max === '5');
  await resize(730, 4); await slider.waitFor();
  assert.equal(await slider.getAttribute('max'), '4');
  await page.waitForFunction(() => document.querySelector('.thumbnail-item[data-page="1"] img')?.naturalWidth > 0);
  const oldResolution = await thumb(1).locator('img').evaluate(el => el.naturalWidth);
  await choose(2); assert.equal(await count(), 2);
  await page.waitForFunction(old => document.querySelector('.thumbnail-item[data-page="1"] img')?.naturalWidth > old, oldResolution);
  assert.ok(await thumb(1).evaluate(el => el.getBoundingClientRect().width) > 300);
  await resize(220, 1); await page.waitForFunction(() => !document.getElementById('thumbnail-columns')); assert.equal(await count(), 1);
  await resize(730, 4); await slider.waitFor(); assert.equal(await slider.inputValue(), '2'); assert.equal(await count(), 2);
  await choose(4); await resize(900, 5); await page.waitForFunction(() => document.getElementById('thumbnail-columns')?.max === '5');
  assert.equal(await slider.inputValue(), '5'); assert.equal(await count(), 5);
  await choose(2);
  if (process.env.OPDS_THUMBNAIL_SCREENSHOT) await page.screenshot({ path: process.env.OPDS_THUMBNAIL_SCREENSHOT });
  await page.reload(); await page.waitForSelector('#tool-select', { timeout: 120000 });
  await load(); await resize(730, 4); await slider.waitFor(); assert.equal(await slider.inputValue(), '2'); assert.equal(await count(), 2);
  // Selection, search, drag/reorder and add-page tile retain their behavior.
  await thumb(1).click(); await page.keyboard.press('Control+a');
  assert.equal(await page.evaluate(async () => (await import('/js/solid/stores/panels/thumbnailStore.js')).getSelectedPagesArray().length), 6);
  await page.evaluate(async () => (await import('/js/solid/stores/panels/thumbnailStore.js')).clearPageSelection());
  const search = page.locator('.thumbnails-search'); await search.fill('3'); await search.press('Enter');
  await page.waitForFunction(() => window.testState.getActiveDocument().currentPage === 3); await search.press('Escape');
  await thumb(1).scrollIntoViewIfNeeded(); const a = await thumb(1).boundingBox(), b = await thumb(2).boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + 30); await page.mouse.down();
  await page.mouse.move(b.x + b.width - 10, b.y + 30, { steps: 12 }); await page.mouse.up();
  await page.waitForFunction(() => window.testState.getActiveDocument().undoStack?.at(-1)?.type === 'pageStructure');
  assert.equal(await page.evaluate(async () => (await window.testState.getActiveDocument().pdfDoc.getPage(1)).view[2]), 320);
  await page.evaluate(async () => (await import('/js/core/undo-manager.js')).undo());
  await page.waitForFunction(async () => (await window.testState.getActiveDocument().pdfDoc.getPage(1)).view[2] === 310);
  await page.locator('.thumbnail-add-page').click(); await page.waitForSelector('.insert-page-dialog');
  await page.evaluate(async () => (await import('/js/solid/stores/dialogStore.js')).closeDialog('insert-page'));
  assert.deepEqual(errors.filter(e => !e.startsWith('WebSocket closed without opened')), []);
  console.log('PASS: 4-to-2 columns increase bitmap resolution; narrow/wide restore choice; auto adds columns; reload persistence; Ctrl+A/search/drag/undo/add-page dialog.');
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) console.error('Thumbnail layout at failure:', await page.evaluate(() => ({
    panelWidth: document.getElementById('left-panel')?.getBoundingClientRect().width,
    listWidth: document.getElementById('thumbnails-container')?.clientWidth,
    max: document.getElementById('thumbnail-columns')?.max,
    value: document.getElementById('thumbnail-columns')?.value,
  })).catch(() => null));
  throw error;
} finally { await browser?.close(); await server.close(); await rm(cache, { recursive: true, force: true }); }
