// Run the real initialization sequence, with only native OS services mocked.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const root = fileURLToPath(new URL('../', import.meta.url));
const cache = await mkdtemp(path.join(tmpdir(), 'opds-startup-'));
const server = await createServer({ root, cacheDir: cache, logLevel: 'error', server: { host: '127.0.0.1', port: 18034, strictPort: false, hmr: false } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.addInitScript(theme => {
      window.startupTest = { events: [], errors: [] };
      window.addEventListener('error', e => window.startupTest.errors.push(e.message));
      const noop = async () => () => {};
      const win = new Proxy({
        label: 'main', theme: async () => 'light',
        onCloseRequested: async () => { window.startupTest.events.push('close-handler'); return () => {}; },
      }, { get: (o, k) => k in o ? o[k] : noop });
      window.__TAURI__ = {
        os: { type: () => 'windows' },
        window: { getCurrentWindow: () => win },
        event: { listen: noop, emit: noop },
        app: { getVersion: async () => '2026.46.15' },
        core: { invoke: async (cmd, args) => {
          if (cmd === 'is_dev_mode') return true;
          if (cmd === 'load_preferences') {
            await new Promise(r => setTimeout(r, 100));
            window.startupTest.events.push('preferences');
            return JSON.stringify({ theme });
          }
          if (cmd === 'instance_role') return { secondary: true };
          if (cmd === 'startup_diagnostic') { window.startupTest.events.push(args.phase); return; }
          if (cmd === 'startup_window_ready') {
            window.startupTest.events.push('show');
            const c = document.getElementById('app-root');
            window.startupTest.shown = {
              theme: document.documentElement.getAttribute('data-theme'),
              tool: !!document.getElementById('tool-select'),
              width: c?.getBoundingClientRect().width ?? 0,
              height: c?.getBoundingClientRect().height ?? 0,
            };
            return;
          }
          if (cmd === 'get_opened_file') {
            window.startupTest.events.push('files');
            // Simulate document loading that can wait for a password forever.
            return new Promise(() => {});
          }
          throw new Error(`Unmocked native service: ${cmd}`);
        } },
      };
    }, theme);
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { timeout: 120000 });
    try {
      await page.waitForFunction(() => window.startupTest.events.includes('files'), null, { timeout: 120000 });
    } catch (e) {
      console.error(await page.evaluate(() => window.startupTest));
      throw e;
    }
    const result = await page.evaluate(() => window.startupTest);
    assert.ok(result.shown, 'shell must be revealed before command-line document loading');
    assert.equal(result.shown.theme, theme);
    assert.equal(result.shown.tool, true);
    assert.ok(result.shown.width > 0 && result.shown.height > 0);
    for (const prerequisite of ['preferences', 'frontend-rendered', 'close-handler']) {
      assert.ok(result.events.indexOf(prerequisite) >= 0);
      assert.ok(result.events.indexOf(prerequisite) < result.events.indexOf('show'));
    }
    assert.ok(result.events.indexOf('show') < result.events.indexOf('files'));
    assert.equal(result.events.filter(e => e === 'show').length, 1);
    console.log(`PASS ${theme}: themed shell laid out and wired before reveal; document wait follows reveal`);
    await page.close();
  }
} finally {
  await browser?.close();
  await server.close();
  await rm(cache, { recursive: true, force: true });
}
