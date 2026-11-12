import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const cache = await mkdtemp(path.join(tmpdir(), 'opds-text-color-'));
const server = await createServer({ root, cacheDir: cache, logLevel: 'error',
  server: { host: '127.0.0.1', port: 18342, strictPort: false, hmr: false } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1433, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { timeout: 120000 });
  await page.waitForSelector('#tool-select', { timeout: 120000 });
  await page.evaluate(async () => { window.testFonts = await import('/js/solid/stores/fontStore.js'); });
  await page.waitForFunction(() => window.testFonts.systemFontList().length > 0);
  async function select(type, { multi = false, locked = false, tool = false } = {}) {
    await page.evaluate(async ({ type, multi, locked, tool }) => {
      const { state, getActiveDocument } = await import('/js/core/state.ts');
      if (!getActiveDocument()) await (await import('/js/pdf/loader.js')).createBlankPDF(595, 842, 1);
      const doc = getActiveDocument();
      const { createAnnotation } = await import('/js/annotations/factory.js');
      doc.annotations = [createAnnotation({ type, page: 1, x: 30, y: 30, width: 180, height: 50,
        text: 'Text colour', fontFamily: 'Arial', fontSize: 16, textColor: '#000000',
        strokeColor: '#ff0000', color: '#ff0000', lineWidth: 1, locked })];
      if (multi) doc.annotations.push(createAnnotation({ ...doc.annotations[0], id: 'second', y: 120 }));
      doc.selectedAnnotations = tool ? [] : [...doc.annotations];
      doc.selectedAnnotation = doc.selectedAnnotations[0] || null;
      state.currentTool = tool ? type : 'select';
      doc.undoStack = []; doc.redoStack = [];
      const fmt = await import('/js/solid/stores/formatStore.js');
      fmt.syncFormatStore(doc.selectedAnnotations);
      const ribbon = await import('/js/solid/stores/ribbonStore.js');
      ribbon.setContextualTabsVisible(true); ribbon.switchToTab('format');
    }, { type, multi, locked, tool });
  }
  async function choose(color) {
    await page.locator('#fmt-text-color').click();
    await page.locator(`#fmt-text-palette [title="${color}"]`).click();
  }
  async function colours() {
    return page.evaluate(async () => (await import('/js/core/state.ts')).getActiveDocument().annotations.map(a => [a.textColor, a.strokeColor]));
  }
  for (const type of ['textbox', 'callout']) {
    await select(type);
    await choose('#38761d');
    if (process.env.OPDS_TEXT_COLOR_SCREENSHOT && type === 'textbox') await page.screenshot({ path: process.env.OPDS_TEXT_COLOR_SCREENSHOT });
    assert.deepEqual(await colours(), [['#38761d', '#ff0000']]);
    await page.evaluate(async () => (await import('/js/core/undo-manager.js')).undo());
    assert.deepEqual(await colours(), [['#000000', '#ff0000']]);
    await page.evaluate(async () => (await import('/js/core/undo-manager.js')).redo());
    assert.deepEqual(await colours(), [['#38761d', '#ff0000']]);
    await page.locator('#fmt-text-default').click();
    assert.equal(await page.evaluate(async type => {
      const { buildAnnotationProps } = await import('/js/tools/annotation-creators.js');
      return buildAnnotationProps(type, 10, 10, 200, 100).textColor;
    }, type), '#38761d');
    await select(type, { multi: true }); await choose('#0000ff');
    assert.deepEqual(await colours(), [['#0000ff', '#ff0000'], ['#0000ff', '#ff0000']]);
    assert.equal(await page.locator('#fmt-text-default').isDisabled(), true);
    await select(type, { locked: true });
    assert.equal(await page.locator('#fmt-text-color').isDisabled(), true);
    await select(type, { tool: true }); await choose('#9900ff');
    assert.equal(await page.evaluate(async type => (await import('/js/tools/annotation-creators.js')).buildAnnotationProps(type, 10, 10, 200, 100).textColor, type), '#9900ff');
    await page.waitForFunction(type => {
      // Debounced persistence must have run before simulating a fresh load.
      return JSON.parse(localStorage.getItem('opds:pdfEditorPreferences') || '{}')[type + 'TextColor'] === '#9900ff';
    }, type);
  }
  await select('box'); assert.equal(await page.locator('#fmt-text-color').count(), 0);
  await page.reload(); await page.waitForSelector('#tool-select', { timeout: 120000 });
  await page.evaluate(async () => { window.testState = (await import('/js/core/state.ts')).state; });
  await page.waitForFunction(() => window.testState.preferences.calloutTextColor === '#9900ff');
  for (const type of ['textbox', 'callout']) {
    assert.equal(await page.evaluate(async type => (await import('/js/core/state.ts')).state.preferences[type + 'TextColor'], type), '#9900ff');
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ types: ['textbox', 'callout'], selection: true, undoRedo: true, defaultButton: true,
    multiSelection: true, locked: true, toolDefaults: true, reload: true, nonTextHidden: true }));
} finally {
  await browser?.close(); await server.close(); await rm(cache, { recursive: true, force: true });
}
