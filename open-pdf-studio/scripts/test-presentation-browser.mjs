// Presentation view in the real app (Chromium): full screen hides the working
// interface, shows one fitted page, turns pages with the keys and the bar, and
// puts the view back when it ends.
//   node scripts/test-presentation-browser.mjs [screenshot folder]
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
const schermMap = process.argv[2] || null;
const cache = await mkdtemp(path.join(tmpdir(), 'opds-presentation-'));
const server = await createServer({ root, cacheDir: cache, logLevel: 'error', server: { host: '127.0.0.1', port: 18351, strictPort: false, hmr: false } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { timeout: 120000 });
  await page.waitForSelector('[data-tab="view"]', { timeout: 120000 });

  // Three pages of different sizes: every page must be fitted again.
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]).drawText('Page one');
  pdf.addPage([1684, 1191]).drawText('Page two');
  pdf.addPage([595, 842]).drawText('Page three');
  await page.evaluate(async (bytes) => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const tab = createTab('/presentation-test.pdf');
    await loadPDF('/presentation-test.pdf', tab.index, new Uint8Array(bytes));
    const r = await import('/js/pdf/renderer.js');
    await r.setViewMode('continuous');
    await r.setZoom(0.5);
  }, Array.from(await pdf.save()));

  const stand = () => page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { weergaveNaam } = await import('/js/ui/chrome/presentatie-beleid.js');
    const doc = getActiveDocument();
    const zicht = (sel) => { const e = document.querySelector(sel); return !!e && getComputedStyle(e).display !== 'none'; };
    const c = document.getElementById('pdf-container').getBoundingClientRect();
    return {
      weergave: weergaveNaam(doc), schaal: doc.scale, pagina: doc.currentPage,
      klasse: document.documentElement.classList.contains('presentation-mode'),
      titel: zicht('.title-bar'), lint: zicht('.ribbon-container'), tabs: zicht('.document-tabs'), status: zicht('.status-bar'),
      vlak: { w: Math.round(c.width), h: Math.round(c.height) }, venster: { w: innerWidth, h: innerHeight },
      teller: document.querySelector('.presentation-bar-count')?.textContent ?? null,
    };
  });

  const voor = await stand();
  assert.equal(voor.weergave, 'continuous');
  assert.equal(voor.klasse, false);
  assert.ok(voor.titel && voor.lint && voor.status, 'working interface visible before');

  await page.locator('[data-tab="view"]').click();
  await page.locator('#ribbon-fullscreen').click();
  await page.waitForFunction(() => document.documentElement.classList.contains('presentation-mode'));
  await page.waitForTimeout(1200);
  const in1 = await stand();
  assert.equal(in1.weergave, 'single', 'one page at a time');
  assert.deepEqual([in1.titel, in1.lint, in1.tabs, in1.status], [false, false, false, false], 'working interface hidden');
  assert.deepEqual(in1.vlak, in1.venster, 'the page area fills the screen');
  assert.equal(in1.teller, '1 / 3');
  // Fitted: the page is as high as the screen allows (A4 portrait on a wide screen).
  const hoogte1 = 842 * in1.schaal;
  assert.ok(hoogte1 <= in1.venster.h + 1 && hoogte1 >= in1.venster.h * 0.9, `page 1 fitted (${hoogte1.toFixed(0)} of ${in1.venster.h})`);
  if (schermMap) await page.screenshot({ path: path.join(schermMap, 'presentation-1.png') });

  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('.presentation-bar-count')?.textContent === '2 / 3');
  await page.waitForTimeout(600);
  const in2 = await stand();
  const breedte2 = 1684 * in2.schaal, hoogte2 = 1191 * in2.schaal;
  assert.ok(breedte2 <= in2.venster.w + 1 && hoogte2 <= in2.venster.h + 1, 'the larger page 2 fits too');
  assert.ok(breedte2 >= in2.venster.w * 0.9 || hoogte2 >= in2.venster.h * 0.9, 'and uses the screen');
  if (schermMap) await page.screenshot({ path: path.join(schermMap, 'presentation-2.png') });

  await page.keyboard.press('End');
  await page.waitForFunction(() => document.querySelector('.presentation-bar-count')?.textContent === '3 / 3');
  await page.keyboard.press('PageDown');
  await page.waitForTimeout(300);
  assert.equal((await stand()).pagina, 3, 'stays on the last page');
  await page.mouse.move(600, 500);
  await page.locator('.presentation-bar button').first().click();
  await page.waitForFunction(() => document.querySelector('.presentation-bar-count')?.textContent === '2 / 3');

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.documentElement.classList.contains('presentation-mode'));
  await page.waitForTimeout(1200);
  const na = await stand();
  assert.equal(na.weergave, 'continuous', 'view mode is put back');
  assert.ok(Math.abs(na.schaal - 0.5) < 0.01, `zoom is put back (${na.schaal})`);
  assert.ok(na.titel && na.lint && na.tabs && na.status, 'working interface is back');
  assert.equal(na.teller, null, 'the bar is gone');
  assert.equal(await page.evaluate(() => !!document.fullscreenElement), false);
  assert.deepEqual(errors, [], 'no uncaught browser errors');
  console.log('PASS: presentation view hides the interface, fits each page, turns pages by key and bar, and restores the view');
} finally {
  await browser?.close();
  await server.close();
  await rm(cache, { recursive: true, force: true });
}
