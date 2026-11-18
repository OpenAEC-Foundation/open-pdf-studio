import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const temp = await mkdtemp(path.join(tmpdir(), 'opds-picker-'));
const server = await createServer({ root, cacheDir: path.join(temp, 'vite'), logLevel: 'error',
  server: { host: '127.0.0.1', port: 18367, strictPort: false, hmr: false } });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { timeout: 120000 });
  await page.waitForSelector('#tool-select', { timeout: 120000 });
  await page.evaluate(async () => {
    const { registerTemplate } = await import('/js/symbols/registry.js');
    registerTemplate({ id: 'test-custom', name: 'My custom symbol', category: 'Custom', params: [], render: () => [] });
    await (await import('/js/i18n/useTranslation.js')).changeLanguage('en');
    (await import('/js/solid/stores/parametricSymbolStore.js')).setPickerOpen(true);
  });
  const modal = page.locator('.ops-modal').filter({ has: page.locator('strong') });
  await modal.waitFor();
  assert.equal(await modal.locator('strong').first().textContent(), 'Door', 'English is the primary symbol name');
  assert.equal(await modal.locator('strong').last().textContent(), 'My custom symbol', 'custom names without English metadata remain available');
  await page.waitForFunction(() => {
    const images = [...document.querySelectorAll('.ops-modal img')];
    return images.length > 0 && images.every(img => img.complete && img.naturalWidth > 0);
  });
  const previews = await modal.locator('img').evaluateAll(images => images.slice(0, 3).map(img => {
    const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
    const bytes = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    return { pixels: bytes.some((value, index) => index % 4 === 3 && value > 0), src: img.src };
  }));
  assert.equal(previews.length, 3); assert.ok(previews.every(p => p.pixels), 'door, window and stairs previews contain rendered geometry');
  assert.equal(new Set(previews.map(p => p.src)).size, 3, 'previews distinguish symbol shapes');
  for (const [language, expected] of [['nl', 'Deur'], ['de', 'Door'], ['en', 'Door']]) {
    await page.evaluate(async language => (await import('/js/i18n/useTranslation.js')).changeLanguage(language), language);
    await page.waitForFunction(expected => document.querySelector('.ops-modal strong')?.textContent === expected, expected);
  }
  if (process.env.PICKER_SCREENSHOT) await modal.screenshot({ path: process.env.PICKER_SCREENSHOT });
  await modal.getByRole('button').filter({ has: page.locator('strong', { hasText: /^Door$/ }) }).click();
  assert.equal(await page.evaluate(async () => (await import('/js/solid/stores/parametricSymbolStore.js')).pendingSymbolId()), 'door');
  assert.equal(await modal.count(), 0, 'selection closes the picker');
  console.log('PASS: English/Dutch/fallback names, reactive language switching, custom name fallback, distinct rendered thumbnails and unchanged symbol selection');
} finally {
  await browser?.close(); await server.close(); await rm(temp, { recursive: true, force: true });
}
