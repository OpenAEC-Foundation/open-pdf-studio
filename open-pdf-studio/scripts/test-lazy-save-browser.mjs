// #454: first Ctrl+S loads the saver on demand and keeps its original PDF tab.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classicFixture } from './pdf-lib-classic-xref-fixture.mjs';
const cache = mkdtempSync(join(tmpdir(), 'opds-lazy-save-'));
// Exercise Vite's query-bearing module URLs without changing the application.
const queryFixture = process.argv.includes('--vite-query') ? [{
  name: 'lazy-save-query-fixture', enforce: 'pre',
  transform(code, id) {
    if (id.endsWith('/js/pdf/save-commands.js')) return code.replace("'./saver.js'", "'./saver.js?lazy-save-regression=1'");
  },
}] : [];
let server, browser, release;
try {
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), cacheDir: cache, plugins: queryFixture, logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } });
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const saverRequests = [];
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', req => { if (new URL(req.url()).pathname === '/js/pdf/saver.js') saverRequests.push(req.url()); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`, { timeout: 120000 });
  await page.waitForSelector('#tool-select', { timeout: 120000 });
  assert.equal(saverRequests.length, 0, 'starting the app does not load the saver');
  await page.evaluate(async raw => {
    const { createTab, switchToTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { getActiveDocument } = await import('/js/core/state.ts');
    const tabs = [];
    for (const path of ['/first.pdf', '/second.pdf']) {
      const tab = createTab(path); await loadPDF(path, tab.index, new Uint8Array(raw));
      const doc = getActiveDocument(); await doc._annotationCompletion; doc.modified = true;
      tabs.push({ index: tab.index, doc });
    }
    switchToTab(tabs[0].index);
    const files = new Map(tabs.map(t => [t.doc.filePath, new Uint8Array(raw)]));
    window.__lazySaveTest = { tabs, writes: [], files };
    window.__TAURI__ = {
      path: { tempDir: async () => '/temp' },
      fs: { readFile: async p => files.get(p)?.slice(), remove: async () => {}, writeFile: async (p, b) => files.set(p, b.slice()) },
      core: { invoke: async (cmd, args, opts) => {
        if (cmd === 'write_file_atomic') {
          const path = decodeURIComponent(opts.headers['x-opds-path']);
          files.set(path, new Uint8Array(args).slice()); window.__lazySaveTest.writes.push(path); return true;
        }
        if (cmd.startsWith('render_')) throw new Error('native renderer unavailable in browser regression');
        return null;
      } },
    };
  }, [...await classicFixture()]);
  assert.equal(saverRequests.length, 0, 'opening PDF tabs does not load the saver');
  const gate = new Promise(resolve => { release = resolve; });
  let requested;
  const started = new Promise(resolve => { requested = resolve; });
  // Vite can append query parameters: match the same pathname as the request
  // observer above, otherwise a real save bypasses the gate and times out.
  await page.route(url => url.pathname === '/js/pdf/saver.js', async route => { requested(); await gate; await route.continue(); });
  await page.locator('.document-tab.active').click();
  await page.evaluate(() => {
    window.__lazySaveTest.keys = [];
    document.addEventListener('keydown', event => {
      window.__lazySaveTest.keys.push({ key: event.key, ctrl: event.ctrlKey, prevented: event.defaultPrevented, target: event.target.tagName });
    });
  });
  await page.keyboard.press('Control+s');
  let timer;
  try {
    await Promise.race([started, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Ctrl+S did not reach the saver request gate')), 15000); })]);
  } catch (error) {
    console.error(JSON.stringify({ saverRequests, pageErrors, state: await page.evaluate(() => ({ keys: window.__lazySaveTest.keys, writes: window.__lazySaveTest.writes, focus: document.activeElement?.tagName })) }));
    throw error;
  } finally { clearTimeout(timer); }
  assert.equal(saverRequests.length, 1, 'one first-save module request reaches the gate');
  if (queryFixture.length) assert.equal(new URL(saverRequests[0]).searchParams.get('lazy-save-regression'), '1');
  assert.deepEqual(await page.evaluate(() => window.__lazySaveTest.writes), [], 'the first save stays blocked until the tab switch');
  await page.evaluate(async () => {
    const { switchToTab } = await import('/js/ui/chrome/tabs.js');
    switchToTab(window.__lazySaveTest.tabs[1].index);
  });
  release();
  await page.waitForFunction(() => window.__lazySaveTest.writes.length > 0, null, { timeout: 60000 });
  const result = await page.evaluate(async () => {
    const { tabs, writes, files } = window.__lazySaveTest;
    const { getActiveDocument } = await import('/js/core/state.ts');
    return { writes, active: getActiveDocument().filePath, secondModified: tabs[1].doc.modified, savedBytes: [...files.get('/first.pdf')] };
  });
  result.pages = (await PDFDocument.load(new Uint8Array(result.savedBytes))).getPageCount();
  delete result.savedBytes;
  assert.deepEqual(result, { writes: ['/first.pdf'], active: '/second.pdf', secondModified: true, pages: 2 });
  console.log(JSON.stringify({ browser: browser.version(), queryFixture: queryFixture.length > 0, saverRequests: saverRequests.length, ...result }));
} finally { release?.(); await browser?.close(); await server?.close(); rmSync(cache, { recursive: true, force: true }); }
