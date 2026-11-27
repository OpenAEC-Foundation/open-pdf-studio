import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { createServer } from 'vite';
const root = fileURLToPath(new URL('../', import.meta.url)); process.chdir(root);
const temp = await mkdtemp(path.join(tmpdir(), 'opds-link-marks-'));
const pdf = await PDFDocument.create();
const pages = Array.from({ length: 3 }, () => pdf.addPage([600, 800]));
function pair(page, n, sheet, x, y, size = 8.5) {
  page.drawText(n, { x: x + 10, y, size });
  page.drawText(sheet, { x, y: y - 13, size: 8.5 });
}
pair(pages[0], '3', 'S2.01', 90, 600);
pair(pages[1], '3', 'S1.01', 190, 600, 11.5);
pair(pages[1], '3', 'S1.01', 190, 400, 11.5);
pair(pages[1], '4', 'S1.01', 390, 600, 11.5);
pair(pages[2], '3', 'S1.01', 190, 600, 11.5);
function link(from, to, x) {
  const a = pdf.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [x, 580, x + 50, 620],
    Dest: [pages[to].ref, 'XYZ', 0, 800, null] });
  pages[from].node.set(PDFName.of('Annots'), pdf.context.obj([pdf.context.register(a)]));
}
link(0, 1, 85); link(1, 0, 185);
pdf.catalog.set(PDFName.of('PageLabels'), pdf.context.obj({ Nums: [0, { P: PDFString.of('S1.01 - PLAN') },
  1, { P: PDFString.of('S2.01 - DETAILS') }, 2, { P: PDFString.of('S3.01 - DETAILS') }] }));
const bytes = [...await pdf.save()];
const server = await createServer({ root, cacheDir: path.join(temp, 'vite'), logLevel: 'error',
  server: { host: '127.0.0.1', port: 18396, strictPort: false, hmr: false } });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  for (const mode of ['single', 'continuous']) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1050 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { timeout: 120000 });
    await page.waitForSelector('#tool-select', { timeout: 120000 });
    async function load(file) {
      await page.evaluate(async ({ bytes, mode, file }) => {
        const core = await import('/js/core/state.ts'); core.state.preferences.defaultViewMode = mode;
        const { index } = (await import('/js/ui/chrome/tabs.js')).createTab(file);
        await (await import('/js/pdf/loader.js')).loadPDF(file, index, new Uint8Array(bytes));
        await core.getActiveDocument()._annotationCompletion;
        window.markTest = { core, links: await import('/js/pdf/link-layer.js') };
      }, { bytes, mode, file });
    }
    await load('/marks.pdf');
    const linkAt = n => page.locator(mode === 'single' ? '#canvas-container .pdf-link' : `.page-wrapper[data-page="${n}"] .pdf-link`).first();
    await linkAt(1).waitFor({ timeout: 60000 });
    const before = await page.evaluate(() => JSON.stringify(window.markTest.core.getActiveDocument().annotations));
    await linkAt(1).click();
    const menu = page.locator('.link-doel-keuze'); await menu.waitFor();
    assert.equal(await menu.locator('button').count(), 2);
    assert.match(await menu.locator('button').first().innerText(), /S2.01.*\(2\)/);
    await page.keyboard.press('Escape'); await menu.waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => window.markTest.core.getActiveDocument().currentPage), 1);
    await linkAt(1).click(); await menu.waitFor(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('.link-doel-markering').length === 4);
    assert.equal(await page.evaluate(() => window.markTest.core.getActiveDocument().currentPage), 2);
    const marks = await page.locator('.link-doel-markering').evaluateAll(els => els.map(el => ({ x: parseFloat(el.style.left), bg: getComputedStyle(el).backgroundColor })));
    assert.ok(marks.every(m => m.x < 40 && m.bg.includes('255, 0, 0')), 'only both matching 3/sheet pairs marked red');
    if (process.env.OPDS_LINK_MARK_SCREENSHOT && mode === 'single') await page.screenshot({ path: process.env.OPDS_LINK_MARK_SCREENSHOT });
    // Following the title back marks its cut bubble, despite the font difference.
    await linkAt(2).click();
    await page.waitForFunction(() => window.markTest.core.getActiveDocument().currentPage === 1 && document.querySelectorAll('.link-doel-markering').length === 2);
    await page.locator('#pdf-container').click({ position: { x: 2, y: 2 } });
    assert.equal(await page.locator('.link-doel-markering').count(), 0);
    await linkAt(1).click(); await menu.waitFor(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.markTest.core.getActiveDocument().currentPage === 3 && document.querySelectorAll('.link-doel-markering').length === 2);
    // Entries without a clickable rectangle retain ordinary navigation and clear marks.
    await page.evaluate(() => window.markTest.links.handleInternalLink([0, { name: 'XYZ' }, 0, 800, null]));
    assert.equal(await page.locator('.link-doel-markering').count(), 0);
    assert.equal(await page.evaluate(() => JSON.stringify(window.markTest.core.getActiveDocument().annotations)), before);
    await linkAt(1).click(); await menu.waitFor();
    await page.evaluate(() => window.markTest.links.handleInternalLink([2, { name: 'XYZ' }, 0, 800, null]));
    await menu.waitFor({ state: 'detached' });
    // A slow first text read cannot open an obsolete menu or overwrite a newer jump.
    await load('/marks-race.pdf');
    const race = await page.evaluate(async () => {
      const { core, links } = window.markTest, doc = core.getActiveDocument(), pdf = doc.pdfDoc;
      const original = pdf.getPage;
      let release, reached; const ready = new Promise(r => { reached = r; }); let once = true;
      pdf.getPage = function(n) {
        if (once && new Error().stack.includes('link-doelmarkering')) {
          once = false; reached(); return new Promise(r => { release = () => r(original.call(pdf, n)); });
        }
        return original.call(pdf, n);
      };
      try {
        const slow = links.handleInternalLink([1, { name: 'XYZ' }, 0, 800, null], { page: 1, rect: [85,580,135,620] });
        await Promise.race([ready, new Promise((_, reject) => setTimeout(() => reject(Error('text lookup not started')), 10000))]);
        await links.handleInternalLink([2, { name: 'XYZ' }, 0, 800, null]);
        release(); await slow;
        return { page: doc.currentPage, menus: document.querySelectorAll('.link-doel-keuze').length, marks: document.querySelectorAll('.link-doel-markering').length };
      } finally { pdf.getPage = original; }
    });
    assert.deepEqual(race, { page: 3, menus: 0, marks: 0 });
    assert.deepEqual(errors.filter(e => !e.startsWith('WebSocket closed without opened')), []);
    console.log(`PASS ${mode}: paired marks, multiple matches/pages, keyboard menu, reverse font match, click dismissal, unchanged annotations and stale-jump cancellation`);
    await page.close();
  }
} finally { await browser?.close(); await server.close(); await rm(temp, { recursive: true, force: true }); }
