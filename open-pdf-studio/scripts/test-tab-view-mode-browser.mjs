// Switching tabs between documents in different view modes shows the page of
// the document that is in front. The single-page canvas and the continuous
// container are shared; a switch from a continuous document to a single-page
// one used to leave the previous document on screen.
//   node scripts/test-tab-view-mode-browser.mjs
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { PDFDocument, rgb } from 'pdf-lib';
const root = fileURLToPath(new URL('../', import.meta.url)); process.chdir(root);
const cache = await mkdtemp(path.join(tmpdir(), 'opds-tabproef-'));
const server = await createServer({ root, cacheDir: cache, logLevel: 'error', server: { host: '127.0.0.1', port: 18361, strictPort: false, hmr: false } });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { timeout: 120000 });
  await page.waitForSelector('[data-tab="view"]', { timeout: 120000 });
  const kleuren = { rood: [1,0,0], groen: [0,1,0], blauw: [0,0,1] };
  for (const [naam, k] of Object.entries(kleuren)) {
    const pdf = await PDFDocument.create();
    for (let i = 0; i < 4; i++) { const p = pdf.addPage([595, 842]); p.drawRectangle({ x: 0, y: 0, width: 595, height: 842, color: rgb(...k) }); }
    await page.evaluate(async ([naam, bytes]) => {
      const { createTab } = await import('/js/ui/chrome/tabs.js');
      const { loadPDF } = await import('/js/pdf/loader.js');
      const tab = createTab(`/${naam}.pdf`);
      await loadPDF(`/${naam}.pdf`, tab.index, new Uint8Array(bytes));
    }, [naam, Array.from(await pdf.save())]);
  }
  const zie = async (label) => {
    await page.waitForTimeout(900);
    const png = await page.screenshot();
    const r = await page.evaluate(async (b64) => {
      const { state, getActiveDocument } = await import('/js/core/state.ts');
      const c = document.getElementById('pdf-container').getBoundingClientRect();
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
      const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
      const d = g.getImageData(Math.round(c.x + c.width / 2), Math.round(c.y + c.height / 2), 1, 1).data;
      const kleur = d[0] > 200 && d[1] < 80 ? 'rood' : d[1] > 200 && d[0] < 80 ? 'groen' : d[2] > 200 && d[0] < 80 ? 'blauw' : `rgb(${d[0]},${d[1]},${d[2]})`;
      const tab = document.querySelector('.document-tab.active, .document-tabs .active')?.textContent?.trim();
      return { actief: getActiveDocument()?.fileName || getActiveDocument()?.filePath, tab, blad: kleur };
    }, png.toString('base64'));
    assert.ok(r.actief?.includes(r.blad), `${label}: ${r.actief} in front, page shows ${r.blad}`);
    assert.ok(r.tab?.includes(r.actief), `${label}: tab ${r.tab} for ${r.actief}`);
  };
  const sw = (i) => page.evaluate(async (i) => (await import('/js/ui/chrome/tabs.js')).switchToTab(i), i);
  const modus = (m) => page.evaluate(async (m) => (await import('/js/pdf/renderer.js')).setViewMode(m), m);
  const info = () => page.evaluate(async () => { const { state } = await import('/js/core/state.ts'); return state.documents.map(d => d.fileName + ':' + d.viewMode).join(' '); });
  await zie('after loading');
  // A new document opens in continuous view (the default).
  assert.equal(await page.evaluate(async () => (await import('/js/core/state.ts')).getActiveDocument().viewMode), 'continuous');
  assert.ok(await page.evaluate(() => getComputedStyle(document.getElementById('continuous-container')).display !== 'none'), 'continuous area shown after loading');
  for (const i of [0, 1]) { await sw(i); await modus('single'); await zie('tab ' + i + ' single'); }
  await sw(2);
  // The rotate buttons next to the view mode buttons turn the current page.
  const rot = () => page.evaluate(async () => { const st = await import('/js/core/state.ts'); return st.getPageRotation(st.getActiveDocument().currentPage) || 0; });
  const voorRot = await rot();
  await page.locator('#status-rotate-right').click(); await page.waitForTimeout(1500);
  assert.equal(((await rot()) - voorRot + 360) % 360, 90, 'rotate right turns the page 90 degrees');
  await page.locator('#status-rotate-left').click(); await page.waitForTimeout(1500);
  assert.equal(((await rot()) - voorRot + 360) % 360, 0, 'rotate left turns it back');
  await zie('after rotating');
  // Continuous -> single-page: the reported case.
  await modus('continuous'); await zie('tab 2 continuous');
  await sw(1); await zie('continuous tab 2 -> single tab 1');
  await sw(0); await zie('single tab 1 -> single tab 0');
  // Single-page -> continuous.
  await sw(2); await zie('single tab 0 -> continuous tab 2');
  // Book view (a grid) -> single-page and back.
  await modus('book'); await zie('tab 2 book');
  await sw(1); await zie('book tab 2 -> single tab 1');
  await sw(2); await zie('single tab 1 -> book tab 2');
  // Clicking the tabs, the way a user does.
  await page.locator('.document-tab').nth(0).click(); await zie('click tab 0');
  await page.locator('.document-tab').nth(2).click(); await zie('click tab 2');
  await page.locator('.document-tab').nth(1).click(); await zie('click tab 1');
  assert.deepEqual(errors, [], 'no uncaught browser errors');
  console.log('PASS: the page follows the tab across single-page, continuous and book view');
} finally { await browser?.close(); await server.close(); await rm(cache, { recursive: true, force: true }); }
