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
const cache = await mkdtemp(path.join(tmpdir(), 'opds-startup-tool-'));
const server = await createServer({ root, cacheDir: cache, logLevel: 'error', server: { host: '127.0.0.1', port: 18347, strictPort: false, hmr: false } });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const url = `http://127.0.0.1:${server.httpServer.address().port}/`;
  const ready = async () => {
    await page.waitForFunction(() => window.__opdsStartupToolReady, null, { timeout: 120000 });
  };
  // Observe completion of the real startup routine without mutating its state.
  await page.addInitScript(() => {
    window.__opdsStartupToolReady = false;
    const observer = new MutationObserver(() => {
      if (document.querySelector('#tool-select')) {
        setTimeout(() => { window.__opdsStartupToolReady = true; }, 1000);
        observer.disconnect();
      }
    });
    observer.observe(document, { childList: true, subtree: true });
  });
  await page.goto(url, { timeout: 120000 }); await ready();
  const current = () => page.evaluate(async () => (await import('/js/core/state.ts')).state.currentTool);
  assert.equal(await current(), 'select', 'first launch');
  const openPrefs = async () => {
    await page.evaluate(async () => (await import('/js/bridge.ts')).openDialog('preferences'));
    await page.waitForSelector('#pref-startup-tool');
  };
  const dialog = page.locator('.preferences-dialog');
  await openPrefs();
  await page.selectOption('#pref-startup-tool', 'hand');
  await dialog.locator('.pref-footer-right .pref-btn-secondary').click();
  assert.equal(await page.evaluate(async () => (await import('/js/core/state.ts')).state.preferences.startupTool), 'select', 'cancel discards choice');
  await openPrefs(); await page.selectOption('#pref-startup-tool', 'hand');
  await dialog.locator('.pref-footer-right .pref-btn-primary').click();
  assert.equal(await current(), 'select', 'saving does not switch the active tool');
  await page.reload({ timeout: 120000 }); await ready();
  assert.equal(await current(), 'hand', 'persisted choice is applied on restart');
  const pdf = await PDFDocument.create(); pdf.addPage([1200, 1600]).drawText('Startup tool test');
  await page.evaluate(async bytes => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const tab = createTab('/startup-tool-test.pdf');
    await loadPDF('/startup-tool-test.pdf', tab.index, new Uint8Array(bytes));
  }, Array.from(await pdf.save()));
  assert.equal(await current(), 'hand', 'opening PDF preserves the startup choice');
  await page.waitForFunction(() => document.querySelector('#tool-hand')?.classList.contains('active'));
  await page.evaluate(async () => {
    const { setTool } = await import('/js/tools/manager.js');
    const { savePreferences } = await import('/js/core/preferences.js');
    setTool('rectangle'); savePreferences();
  });
  assert.equal(await current(), 'rectangle', 'unrelated preference saves preserve drawing tools');
  await page.evaluate(() => document.dispatchEvent(new Event('pdf-loaded')));
  assert.equal(await current(), 'select', 'PDF loading still exits drawing tools');
  await openPrefs();
  page.once('dialog', d => d.accept());
  await dialog.locator('.preferences-footer > .pref-btn-secondary').click();
  assert.equal(await page.inputValue('#pref-startup-tool'), 'select', 'reset restores Select');
  await dialog.locator('.pref-footer-right .pref-btn-primary').click();
  await page.reload({ timeout: 120000 }); await ready();
  assert.equal(await current(), 'select', 'reset persists across restart');
  await page.evaluate(async () => {
    const { state } = await import('/js/core/state.ts');
    state.preferences.startupTool = 'rectangle';
    (await import('/js/core/preferences.js')).savePreferences();
  });
  await page.reload({ timeout: 120000 }); await ready();
  assert.equal(await current(), 'select', 'invalid stored drawing tool cannot activate on startup');
  assert.deepEqual(errors, [], 'no uncaught browser errors');
  console.log('PASS: first launch, cancel/save, restart, PDF open, unrelated saves, reset and invalid preference');
} finally { await browser?.close(); await server.close(); await rm(cache, { recursive: true, force: true }); }
