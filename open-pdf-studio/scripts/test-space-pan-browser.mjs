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
const cache = await mkdtemp(path.join(tmpdir(), 'opds-space-pan-'));
const server = await createServer({ root, cacheDir: cache, logLevel: 'error', server: { host: '127.0.0.1', port: 18346, strictPort: false, hmr: false } });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { timeout: 120000 });
  await page.waitForSelector('#tool-select', { timeout: 120000 });
  const pdf = await PDFDocument.create();
  for (let i = 0; i < 3; i++) pdf.addPage([1200, 1600]).drawText(`Pan test ${i + 1}`, { x: 400, y: 800 });
  await page.evaluate(async bytes => {
    const {state, getActiveDocument} = await import('/js/core/state.ts');
    const {interactionState} = await import('/js/core/stores/interaction-store.ts');
    const {createTab} = await import('/js/ui/chrome/tabs.js');
    const {loadPDF} = await import('/js/pdf/loader.js');
    const renderer = await import('/js/pdf/renderer.js');
    const view = await import('/js/pdf/pdf-viewport.js');
    const {setTool} = await import('/js/tools/manager.js');
    const tab = createTab('/space-pan-test.pdf');
    await loadPDF('/space-pan-test.pdf', tab.index, new Uint8Array(bytes));
    await getActiveDocument()._annotationCompletion;
    window.panTest = {state, getActiveDocument, interactionState, renderer, view, setTool};
  }, Array.from(await pdf.save()));
  const snapshot = () => page.evaluate(() => {
    const {state, getActiveDocument, interactionState, view} = window.panTest;
    const c = document.getElementById('pdf-container');
    return { x: view.viewport.active ? view.viewport.offsetX : c.scrollLeft, y: view.viewport.active ? view.viewport.offsetY : c.scrollTop,
      zoom: view.viewport.active ? view.viewport.zoom : getActiveDocument().scale,
      held: interactionState.spacePanHeld, pan: state.isPanning, tool: state.currentTool, annotations: getActiveDocument().annotations.length };
  });
  for (const mode of ['single', 'continuous', 'facing', 'book']) {
    await page.evaluate(async mode => {
      const t = window.panTest; await t.renderer.setViewMode(mode);
      await t.renderer.setZoom(1.5);
      t.setTool('line'); document.activeElement?.blur(); document.getElementById('pdf-container').scrollTop = 250;
    }, mode);
    const rect = await page.locator('#pdf-container').boundingBox();
    const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
    await page.mouse.move(x, y); const before = await snapshot();
    await page.keyboard.down('Space'); assert.equal((await snapshot()).held, true, `${mode}: Space arms pan`);
    await page.mouse.down(); assert.equal((await snapshot()).pan, true, `${mode}: drag starts pan`);
    await page.mouse.move(x - 60, y - 80, { steps: 5 }); const moved = await snapshot();
    assert.ok(moved.x !== before.x || moved.y !== before.y, `${mode}: document moves`);
    await page.keyboard.up('Space'); assert.equal((await snapshot()).pan, false);
    await page.mouse.up(); const after = await snapshot();
    assert.equal(after.tool, 'line'); assert.equal(after.annotations, before.annotations);
    console.log(mode, 'before wheel', after);
    await page.keyboard.down('Control'); await page.mouse.wheel(0, -120);
    await page.waitForFunction(z => {
      const t = window.panTest; return (t.view.viewport.active ? t.view.viewport.zoom : t.getActiveDocument().scale) !== z;
    }, after.zoom, { timeout: 15000 });
    await page.keyboard.up('Control');
    console.log(`PASS ${mode}: Space drag, release before mouse, tool/annotations unchanged, Ctrl+wheel zoom`);
  }
  await page.evaluate(() => {
    const input = document.createElement('input'); input.id = 'pan-test-input';
    document.getElementById('pdf-container').append(input); input.focus();
  });
  await page.keyboard.type('a b'); assert.equal(await page.inputValue('#pan-test-input'), 'a b'); assert.equal((await snapshot()).held, false);
  await page.evaluate(() => document.activeElement.blur()); await page.keyboard.down('Space');
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); assert.equal((await snapshot()).held, false);
  await page.keyboard.up('Space'); assert.deepEqual(errors, []);
  console.log('PASS text entry and focus-loss cancellation; no browser errors');
} finally { await browser?.close(); await server.close(); await rm(cache, { recursive: true, force: true }); }
