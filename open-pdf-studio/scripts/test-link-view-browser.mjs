import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PDFDocument, PDFName, PDFString, degrees } from 'pdf-lib';
import { createServer } from 'vite';
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const temp = await mkdtemp(path.join(tmpdir(), 'opds-link-view-'));
const pdf = await PDFDocument.create();
const p1 = pdf.addPage([600, 800]), p2 = pdf.addPage([600, 800]);
p2.drawRectangle({ x: 200, y: 300, width: 200, height: 200 });
const link = pdf.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [30, 700, 150, 730],
  C: [1, 0, 0], Border: [0, 0, 3], BS: { W: 3, S: 'D', D: [4, 2] },
  Dest: [p2.ref, 'FitR', 200, 300, 400, 500] });
p1.node.set(PDFName.of('Annots'), pdf.context.obj([pdf.context.register(link)]));
const p3 = pdf.addPage([700, 1000]); p3.setCropBox(50, 100, 600, 800); p3.setRotation(degrees(90));
pdf.catalog.set(PDFName.of('Names'), pdf.context.obj({ Dests: { Names: [PDFString.of('Detail'), [p2.ref, 'XYZ', 200, 500, 2]] } }));
const file = path.join(temp, 'link-view.pdf'); await writeFile(file, await pdf.save());
const server = await createServer({ root, cacheDir: path.join(temp, 'vite'), logLevel: 'error',
  server: { host: '127.0.0.1', port: 18366, strictPort: false, hmr: false } });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  for (const mode of ['continuous', 'single']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { timeout: 120000 });
    await page.waitForSelector('#tool-select', { timeout: 120000 });
    await page.evaluate(async mode => {
      const { state } = await import('/js/core/state.ts'); state.preferences.defaultViewMode = mode;
    }, mode);
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.quick-access-toolbar .quick-access-btn').first().click()]);
    await chooser.setFiles(file);
    const anchor = page.locator('.pdf-link:visible').first(); await anchor.waitFor({ timeout: 60000 });
    const border = await anchor.locator('path').count();
    const color = border ? await anchor.locator('path').getAttribute('stroke') : null;
    await anchor.click();
    await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()?.currentPage === 2);
    await page.waitForTimeout(1500);
    const result = await page.evaluate(async () => {
      const { getActiveDocument } = await import('/js/core/state.ts'); const doc = getActiveDocument();
      const scroller = document.getElementById('pdf-container');
      const el = doc.viewMode === 'continuous' ? document.querySelector('.page-wrapper[data-page="2"] .canvas-container-cont') : document.getElementById('pdf-canvas');
      const r = el.getBoundingClientRect(), box = scroller.getBoundingClientRect();
      return { scale: doc.scale, expected: Math.min((scroller.clientWidth - 24) / 200, (scroller.clientHeight - 24) / 200),
        dx: r.left - box.left + 300 * doc.scale - scroller.clientWidth / 2,
        dy: r.top - box.top + 400 * doc.scale - scroller.clientHeight / 2 };
    });
    console.log(mode, JSON.stringify({ border, color, ...result }));
    assert.equal(border, 1); assert.equal(color, 'rgb(255,0,0)');
    assert.ok(Math.abs(result.scale - result.expected) < 0.02, 'FitR zoom');
    assert.ok(Math.abs(result.dx) < 3 && Math.abs(result.dy) < 3, 'FitR centred in both axes');
    // The same handler is used for named destinations and app-created links.
    const xyz = await page.evaluate(async () => {
      const { getActiveDocument } = await import('/js/core/state.ts');
      const { handleInternalLink } = await import('/js/pdf/link-layer.js');
      const { cssPxPerPtAt100 } = await import('/js/core/zoom-display.js');
      await handleInternalLink('Detail');
      const doc = getActiveDocument();
      const { pdfDocLib } = await (await import('/js/pdf/saver.js')).bouwAnnotatieDocument(doc);
      return { scale: doc.scale, expected: 2 * cssPxPerPtAt100(), bytes: Array.from(await pdfDocLib.save()) };
    });
    assert.ok(Math.abs(xyz.scale - xyz.expected) < 0.02, 'XYZ explicit zoom');
    const saved = await PDFDocument.load(new Uint8Array(xyz.bytes));
    const savedLink = saved.getPage(0).node.lookup(PDFName.of('Annots')).lookup(0);
    assert.equal(savedLink.lookup(PDFName.of('Dest')).lookup(1).toString(), '/FitR');
    assert.equal(savedLink.lookup(PDFName.of('BS')).lookup(PDFName.of('W')).asNumber(), 3);
    const rotated = await page.evaluate(async () => {
      const { getActiveDocument } = await import('/js/core/state.ts');
      await (await import('/js/pdf/link-layer.js')).handleInternalLink([2, { name: 'FitR' }, 250, 400, 450, 600]);
      const doc = getActiveDocument(), c = document.getElementById('pdf-container');
      const el = doc.viewMode === 'continuous' ? document.querySelector('.page-wrapper[data-page="3"] .canvas-container-cont') : document.getElementById('pdf-canvas');
      const r = el.getBoundingClientRect(), box = c.getBoundingClientRect();
      return { dx: r.left - box.left + 400 * doc.scale - c.clientWidth / 2,
        dy: r.top - box.top + 300 * doc.scale - c.clientHeight / 2 };
    });
    assert.ok(Math.abs(rotated.dx) < 3 && Math.abs(rotated.dy) < 3, 'rotated CropBox FitR centre');
    console.log(`PASS ${mode}: clickable FitR, named XYZ zoom, rotated CropBox, visible border and save preservation`);
    const race = await page.evaluate(async () => {
      const { getActiveDocument } = await import('/js/core/state.ts');
      const { handleInternalLink } = await import('/js/pdf/link-layer.js');
      const doc = getActiveDocument(), pdf = doc.pdfDoc, original = pdf.getDestination;
      let finish;
      pdf.getDestination = () => new Promise(resolve => { finish = resolve; });
      try {
        const slow = handleInternalLink('Slow');
        await handleInternalLink([1, { name: 'XYZ' }, 200, 500, 1]);
        const expectedScale = doc.scale;
        finish([0, { name: 'Fit' }]); await slow;
        return { page: doc.currentPage, scale: doc.scale, expectedScale };
      } finally { pdf.getDestination = original; }
    });
    assert.equal(race.page, 2); assert.equal(race.scale, race.expectedScale);
    console.log(`PASS ${mode}: late named destination cannot overwrite newer navigation`);
    await page.close();
  }
} finally { await browser?.close(); await server.close(); await rm(temp, { recursive: true, force: true }); }
