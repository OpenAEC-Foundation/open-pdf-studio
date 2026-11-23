// The right mouse button in the real app (#1241): by default a drag does not
// move the sheet; with the preference on, a drag pans (single-page and
// continuous view) and a click still opens the context menu.
//   node scripts/test-right-button-pan-browser.mjs
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
const cache = await mkdtemp(path.join(tmpdir(), 'opds-right-pan-'));
const server = await createServer({ root, cacheDir: cache, logLevel: 'error', server: { host: '127.0.0.1', port: 18401, strictPort: false, hmr: false } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1300, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { timeout: 120000 });
  await page.waitForSelector('[data-tab="view"]', { timeout: 120000 });
  const pdf = await PDFDocument.create();
  for (let i = 0; i < 3; i++) pdf.addPage([1200, 1600]).drawText(`Page ${i + 1}`, { x: 60, y: 1500, size: 40 });
  await page.evaluate(async (bytes) => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const tab = createTab('/right-pan.pdf');
    await loadPDF('/right-pan.pdf', tab.index, new Uint8Array(bytes));
  }, Array.from(await pdf.save()));

  const zet = (waarde) => page.evaluate(async (w) => { (await import('/js/core/state.ts')).state.preferences.rightButtonDrag = w; }, waarde);
  const modus = (m) => page.evaluate(async (m) => {
    const r = await import('/js/pdf/renderer.js');
    await r.setViewMode(m);
    await r.setZoom(2);
  }, m);
  // Where the sheet is: the scroll position, and the viewport offset when the viewport pans.
  const plek = () => page.evaluate(() => {
    const c = document.getElementById('pdf-container');
    const vp = window.__pdfViewport;
    return { x: c.scrollLeft, y: c.scrollTop, ox: vp?.active ? Math.round(vp.offsetX) : 0, oy: vp?.active ? Math.round(vp.offsetY) : 0 };
  });
  const verschoven = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.ox - b.ox) + Math.abs(a.oy - b.oy);
  const menuOpen = () => page.evaluate(() => [...document.querySelectorAll('.context-menu')].some((e) => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0));
  const sluitMenu = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(150); };
  const midden = async () => {
    const r = await page.evaluate(() => { const b = document.getElementById('pdf-container').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
    return r;
  };
  async function sleepRechts(dx, dy) {
    const m = await midden();
    await page.mouse.move(m.x, m.y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(m.x + dx / 2, m.y + dy / 2, { steps: 4 });
    await page.mouse.move(m.x + dx, m.y + dy, { steps: 4 });
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(300);
  }

  for (const weergave of ['continuous', 'single']) {
    await modus(weergave);
    await page.waitForTimeout(800);
    // Start somewhere in the middle, so there is room to pan both ways.
    await page.evaluate(() => { const c = document.getElementById('pdf-container'); c.scrollTop = 300; c.scrollLeft = 200; });
    await page.waitForTimeout(200);

    await zet('menu');
    const a = await plek();
    await sleepRechts(-120, -90);
    const b = await plek();
    assert.equal(verschoven(a, b), 0, `${weergave}: by default a right drag does not move the sheet`);
    await sluitMenu();

    await zet('pan');
    const c = await plek();
    await sleepRechts(-120, -90);
    const d = await plek();
    assert.ok(verschoven(c, d) > 100, `${weergave}: with the preference on a right drag pans (${JSON.stringify(c)} -> ${JSON.stringify(d)})`);
    assert.equal(await menuOpen(), false, `${weergave}: no context menu after the drag`);
    assert.equal(await page.evaluate(async () => (await import('/js/core/state.ts')).state.isPanning), false, `${weergave}: the pan ends on release`);

    // A click without a drag still opens the context menu.
    const m = await midden();
    await page.mouse.click(m.x, m.y, { button: 'right' });
    await page.waitForTimeout(300);
    assert.equal(await menuOpen(), true, `${weergave}: a right click opens the context menu`);
    await sluitMenu();
  }

  // The preference is saved with the others.
  await zet('pan');
  const bewaard = await page.evaluate(async () => {
    await (await import('/js/core/preferences.js')).savePreferences();
    return Object.values(localStorage).some((v) => typeof v === 'string' && v.includes('"rightButtonDrag":"pan"'));
  });
  assert.equal(bewaard, true, 'the preference is stored');
  assert.deepEqual(errors, [], 'no uncaught browser errors');
  console.log('PASS: right button default unchanged; with the preference a drag pans in both views, a click keeps the menu, and the choice is saved');
} finally {
  await browser?.close();
  await server.close();
  await rm(cache, { recursive: true, force: true });
}
