// #1255: echte lintknoppen, sluiten, heropenen en voorkeuren na herladen.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const cache = mkdtempSync(join(tmpdir(), 'opds-toolbar-'));
let server, browser;
try {
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), cacheDir: cache, logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`, { timeout: 120000 });
  async function viewTab() {
    await page.waitForSelector('#tool-select', { timeout: 120000 });
    await page.evaluate(async () => {
      const { setActiveTab } = await import('/js/solid/stores/ribbonStore.js');
      setActiveTab('view');
    });
    await page.waitForSelector('#ribbon-symbol-palette');
  }
  await viewTab();
  assert.equal(await page.locator('#ribbon-drawing-toolbar').count(), 1, 'View must expose the drawing toolbar independently');
  const button = page.locator('#ribbon-drawing-toolbar');
  assert.equal(await button.isEnabled(), true, 'recoverable even without a PDF');
  async function stateSnapshot() {
    return page.evaluate(async () => {
      const { paletteVisible, paletteMode } = await import('/js/solid/components/ToolPalette.jsx');
      const { symbolPaletteVisible } = await import('/js/solid/stores/symbolStore.js');
      const { state } = await import('/js/core/state.ts');
      const { leesOpslag, VOORKEUREN_NAAM } = await import('/js/core/opslag.js');
      return { visible: paletteVisible(), mode: paletteMode(), symbols: symbolPaletteVisible(), saved: JSON.parse(leesOpslag(VOORKEUREN_NAAM)).toolPaletteVisible, preference: state.preferences.toolPaletteVisible };
    });
  }
  for (const mode of ['docked-left', 'docked-right', 'docked-top', 'docked-bottom', 'float']) {
    await page.evaluate(async mode => {
      const { state } = await import('/js/core/state.ts');
      const { initToolPalette } = await import('/js/solid/components/ToolPalette.jsx');
      const { savePreferences } = await import('/js/core/preferences.js');
      state.preferences.toolPaletteMode = mode;
      state.preferences.toolPaletteVisible = true;
      initToolPalette(); savePreferences();
    }, mode);
    const strip = mode === 'float' ? '.tp-float:not(.tp-ext)' : `.tp-${mode}:not(.tp-ext)`;
    await page.waitForSelector(strip);
    const before = await stateSnapshot();
    const close = mode === 'float' ? `${strip} .tp-float-close` : `${strip} > .tp-close:last-child`;
    await page.locator(close).click();
    await page.waitForSelector(strip, { state: 'detached' });
    assert.deepEqual(await stateSnapshot(), { ...before, visible: false, preference: false, saved: false });
    assert.equal(await button.getAttribute('aria-pressed'), 'false');
    await page.reload(); await viewTab();
    assert.deepEqual(await stateSnapshot(), { ...before, visible: false, preference: false, saved: false });
    await button.click();
    await page.waitForSelector(strip);
    assert.deepEqual(await stateSnapshot(), { ...before, visible: true, preference: true, saved: true });
    assert.equal(await button.getAttribute('aria-pressed'), 'true');
    await page.reload(); await viewTab();
    await page.waitForSelector(strip);
    assert.equal((await stateSnapshot()).visible, true);
    await page.locator('#ribbon-symbol-palette').click();
    const afterSymbol = await stateSnapshot();
    assert.equal(afterSymbol.visible, true); assert.equal(afterSymbol.symbols, !before.symbols);
    await button.click();
    assert.deepEqual(await stateSnapshot(), { ...afterSymbol, visible: false, preference: false, saved: false });
  }
  console.log('PASS: drawing toolbar closes/reopens independently in five docking modes; hidden and visible preferences survive reload; no PDF required.');
} finally { await browser?.close(); await server?.close(); rmSync(cache, { recursive: true, force: true }); }
