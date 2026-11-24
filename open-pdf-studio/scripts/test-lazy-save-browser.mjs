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
let server, browser, release;
try {
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), cacheDir: cache, logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } });
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const saverRequests = [];
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
  await page.route('**/js/pdf/saver.js', async route => { requested(); await gate; await route.continue(); });
  await page.keyboard.press('Control+s');
  await Promise.race([started, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Ctrl+S did not request the saver')), 15000); timer.unref(); })]);
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
  console.log(JSON.stringify({ browser: browser.version(), saverRequests: saverRequests.length, ...result }));
} finally { release?.(); await browser?.close(); await server?.close(); rmSync(cache, { recursive: true, force: true }); }
