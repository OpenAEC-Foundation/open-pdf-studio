import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const cache = await mkdtemp(path.join(tmpdir(), 'opds-high-contrast-'));
const server = await createServer({ root, cacheDir: cache, logLevel: 'error',
  server: { host: '127.0.0.1', port: 18345, strictPort: false, hmr: false } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  await page.addInitScript(() => localStorage.setItem('opds:pdfEditorPreferences', JSON.stringify({ theme: 'highContrast' })));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { timeout: 120000 });
  await page.waitForSelector('#tool-select', { timeout: 120000 });
  await page.evaluate(async () => {
    (await import('/js/core/preferences.js')).applyTheme('highContrast');
    (await import('/js/solid/stores/dialogStore.js')).openDialog('feedback');
  });
  await page.waitForSelector('.feedback-category-btn.active');
  const colours = await page.locator('.feedback-category-btn.active, .feedback-submit-btn').evaluateAll(nodes => nodes.map(n => {
    const s = getComputedStyle(n); return { colour: s.color, background: s.backgroundColor };
  }));
  for (const c of colours) {
    assert.equal(c.colour, 'rgb(0, 0, 0)');
    assert.equal(c.background, 'rgb(255, 255, 0)'); // WCAG contrast 19.56:1 before disabled opacity.
  }
  if (process.env.OPDS_CONTRAST_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.OPDS_CONTRAST_SCREENSHOTS, 'feedback.png') });
  await page.evaluate(async () => (await import('/js/solid/stores/dialogStore.js')).closeDialog('feedback'));
  const category = page.locator('.sp-cat-header').first();
  if (!await page.locator('.sp-symbol-icon').count()) await category.click();
  const icon = page.locator('.sp-symbol-icon').first();
  await icon.waitFor();
  const originalMarkup = await icon.innerHTML();
  assert.equal(await icon.evaluate(n => getComputedStyle(n).filter), 'invert(1) hue-rotate(180deg)');
  if (process.env.OPDS_CONTRAST_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.OPDS_CONTRAST_SCREENSHOTS, 'palette.png') });
  // Exercise the active CSS state without placing or changing a PDF symbol.
  await icon.evaluate(n => n.closest('.sp-symbol-btn').classList.add('active'));
  assert.equal(await icon.evaluate(n => getComputedStyle(n).filter), 'none');
  assert.equal(await icon.evaluate(n => getComputedStyle(n.closest('.sp-symbol-btn')).backgroundColor), 'rgb(255, 255, 0)');
  await icon.evaluate(n => n.closest('.sp-symbol-btn').classList.remove('active'));
  for (const theme of ['light', 'dark', 'highContrast']) {
    await page.evaluate(async theme => (await import('/js/core/preferences.js')).applyTheme(theme), theme);
    assert.equal(await icon.evaluate(n => getComputedStyle(n).filter), theme === 'highContrast' ? 'invert(1) hue-rotate(180deg)' : 'none');
    assert.equal(await icon.innerHTML(), originalMarkup, 'theme changes must not rewrite symbol geometry or colours');
  }
  console.log('PASS: high-contrast feedback buttons, palette previews, active tiles and light/dark theme isolation');
} finally {
  await browser?.close(); await server.close(); await rm(cache, { recursive: true, force: true });
}
