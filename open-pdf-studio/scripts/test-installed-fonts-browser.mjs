import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root); // vite.config.js reads package.json relative to the app.
const catalogue = JSON.parse(await readFile(process.env.OPDS_FONT_CATALOGUE_JSON, 'utf8'));
const expected = ['OPDS Installed Fixture', 'OPDS Collection One', 'OPDS Collection 日本語'];
for (const name of expected) assert.ok(catalogue.includes(name), `native probe missing ${name}`);
const baseline = process.env.OPDS_FONT_BASELINE_SOURCE ? await readFile(process.env.OPDS_FONT_BASELINE_SOURCE, 'utf8') : null;
const cache = await mkdtemp(path.join(tmpdir(), 'opds-installed-fonts-browser-'));
const server = await createServer({ root, cacheDir: cache, logLevel: 'error',
  plugins: baseline ? [{ name: 'font-regression-baseline', enforce: 'pre',
    transform(_code, id) { if (id.split('?')[0].replaceAll('\\', '/').endsWith('/js/utils/fonts.js')) return baseline; } }] : [],
  server: { host: '127.0.0.1', port: 18311, strictPort: false, hmr: false } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  await page.waitForSelector('#tool-select', { timeout: 120000 });
  // The normal web startup must finish before testing a fresh catalogue query.
  await page.waitForFunction(async () => (await import('/js/solid/stores/fontStore.js')).systemFontList().length > 0);
  const queried = await page.evaluate(async catalogue => {
    const { createBlankPDF } = await import('/js/pdf/loader.js');
    await createBlankPDF(595, 842, 1);
    const { createAnnotation } = await import('/js/annotations/factory.js');
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { storeShowProperties } = await import('/js/solid/stores/propertiesStore.js');
    const { setSystemFontList, systemFontList } = await import('/js/solid/stores/fontStore.js');
    setSystemFontList([]);
    const annotation = createAnnotation({ type: 'textbox', page: 1, x: 30, y: 30,
      width: 180, height: 50, text: 'A 日', fontFamily: 'Arial', fontSize: 16,
      textColor: '#000000', color: '#000000', lineWidth: 1 });
    const doc = getActiveDocument();
    doc.annotations.push(annotation);
    doc.selectedAnnotations = [doc.annotations[0]];
    storeShowProperties(doc.annotations[0]);
    let calls = 0, release;
    const pending = new Promise(resolve => { release = resolve; });
    window.__TAURI__ = { core: { invoke: async command => {
      if (command !== 'list_installed_font_families') throw new Error(`Unexpected command: ${command}`);
      calls++;
      await pending;
      return catalogue;
    } } };
    try {
      const fonts = await import('/js/utils/fonts.js?native-catalogue-regression');
      const a = fonts.initFontDropdowns();
      const b = fonts.initFontDropdowns();
      fonts.ensureFontInStore('Document-only family');
      release();
      await Promise.all([a, b]);
      return { calls, names: systemFontList() };
    } finally { delete window.__TAURI__; }
  }, catalogue);
  assert.equal(queried.calls, 1, 'simultaneous dropdowns must share the native request');
  assert.ok(queried.names.includes('Document-only family'), 'async catalogue must retain document families');
  const select = page.locator('#prop-text-format-section select').first();
  await select.waitFor();
  for (const name of expected) {
    assert.ok((await select.locator('option').allTextContents()).includes(name), `dropdown lacks ${name}`);
    await select.selectOption(name);
    assert.equal(await page.evaluate(async () => (await import('/js/core/state.ts')).getActiveDocument().annotations[0].fontFamily), name);
    assert.equal(await select.inputValue(), name);
  }
  // Reopening the same annotation must retain its selection and available families.
  await page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { storeHideProperties, storeShowProperties } = await import('/js/solid/stores/propertiesStore.js');
    storeHideProperties();
    storeShowProperties(getActiveDocument().annotations[0]);
  });
  assert.equal(await select.inputValue(), expected.at(-1));
  // The fallback remains usable with an older native binary that lacks the command.
  const fallback = await page.evaluate(async () => {
    window.__TAURI__ = { core: { invoke: async () => { throw new Error('unknown command'); } } };
    try {
      const fonts = await import('/js/utils/fonts.js?old-native-backend');
      return await fonts.discoverFontFamilies();
    } finally { delete window.__TAURI__; }
  });
  assert.ok(fallback.length > 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ nativeFamilies: catalogue.length, selectedFamilies: expected,
    sharedQuery: true, asyncDocumentFamily: true, reopen: true, olderBackendFallback: true }));
} finally {
  await browser?.close();
  await server.close();
  await rm(cache, { recursive: true, force: true });
}
