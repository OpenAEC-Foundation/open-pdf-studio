// Resize Pages with margins through the real dialog (#1291), in the browser
// build: ribbon button Organize > Resize, a custom size, margins for odd and
// for even pages, and both ways of placing the content. Afterwards the pages
// have the new size, the content lies between the margins (checked in the
// rendered page), the annotations moved and scaled along, and Undo brings
// everything back. Margins that leave no room keep the dialog open.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PDFDocument, rgb } from 'pdf-lib';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);

const MM = 72 / 25.4;
const near = (a, b, msg, tol = 0.05) => assert.ok(Math.abs(a - b) < tol, `${msg}: ${a} != ${b}`);

/** Pages of 400 x 300 pt: green far outside the page, a blue page on top. */
async function makePdf(count) {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < count; i++) {
    const page = pdf.addPage([400, 300]);
    page.drawRectangle({ x: -400, y: -400, width: 1200, height: 1100, color: rgb(0, 1, 0) });
    page.drawRectangle({ x: 0, y: 0, width: 400, height: 300, color: rgb(0, 0, 1) });
  }
  return Buffer.from(await pdf.save());
}

const cache = await mkdtemp(path.join(tmpdir(), 'opds-resize-margins-'));
const server = await createServer({ root, cacheDir: cache, logLevel: 'error',
  server: { host: '127.0.0.1', port: 18391, strictPort: false, hmr: false } });
let browser;
const errors = [];
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { timeout: 120000 });
  await page.waitForSelector('[data-tab="organize"]', { timeout: 120000 });

  // The open document: three pages, the same box annotation on each.
  await page.evaluate(async (bytes) => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { runAppEvent } = await import('/js/mcp-bridge.js');
    const tab = createTab('/marges.pdf');
    await loadPDF('/marges.pdf', tab.index, new Uint8Array(bytes));
    for (const p of [1, 2, 3]) {
      const r = await runAppEvent('mcp:create-annotation', { type: 'box', page: p, props: { x: 100, y: 100, width: 80, height: 60 } });
      if (!r.ok) throw new Error(`annotation not created: ${JSON.stringify(r)}`);
    }
  }, Array.from(await makePdf(3)));

  /** Page sizes, the annotations and a few rendered pixels (document only, no annotation layer). */
  const read = (pixels) => page.evaluate(async (wanted) => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { renderPageOffscreen } = await import('/js/pdf/exporter.js');
    const doc = getActiveDocument();
    const sizes = [];
    const colours = {};
    for (let p = 1; p <= doc.pdfDoc.numPages; p++) {
      const v = (await doc.pdfDoc.getPage(p)).getViewport({ scale: 1 });
      sizes.push([v.width, v.height]);
      const points = wanted?.[p];
      if (!points) continue;
      const canvas = await renderPageOffscreen(p, 1, { markeringen: false });
      const g = canvas.getContext('2d');
      colours[p] = points.map(([x, y]) => {
        const d = g.getImageData(x, y, 1, 1).data;
        if (d[3] < 10 || (d[0] > 240 && d[1] > 240 && d[2] > 240)) return 'white';
        if (d[2] > 200 && d[0] < 60 && d[1] < 60) return 'blue';
        if (d[1] > 200 && d[0] < 60 && d[2] < 60) return 'green';
        return `${d[0]},${d[1]},${d[2]}`;
      });
    }
    return {
      sizes,
      colours,
      annotations: doc.annotations.map((a) => ({ page: a.page, x: a.x, y: a.y, width: a.width, height: a.height })),
      dialogOpen: !!document.querySelector('.crop-margins-dialog'),
    };
  }, pixels);

  const openDialog = async () => {
    await page.locator('[data-tab="organize"]').click();
    await page.locator('#ep-resize-pages').click();
    await page.waitForSelector('.crop-margins-dialog');
  };
  const dialog = page.locator('.crop-margins-dialog');
  const select = (index) => dialog.locator('select').nth(index); // 0 apply to, 1 size, 2 orientation, 3 content
  const margin = (name) => dialog.locator(`[data-margin="${name}"]`);
  const type = async (field, text) => { await field.fill(text); await field.blur(); };
  const customSize = async (width, height) => {
    await select(1).selectOption('custom');
    await select(2).selectOption(width > height ? 'landscape' : 'portrait');
    const fields = dialog.locator('input.crop-margins-input:not([data-margin])');
    await type(fields.nth(0), String(width));
    await type(fields.nth(1), String(height));
  };
  // Wait until page 1 has this width. Asked from Node in separate calls with a
  // time limit each: a page requested from a document that is just being
  // replaced may never arrive, and one such call must not stall the wait.
  const waitForWidth = async (points) => {
    const deadline = Date.now() + 60000;
    for (;;) {
      const width = await page.evaluate(async () => {
        const { getActiveDocument } = await import('/js/core/state.ts');
        const doc = getActiveDocument();
        if (!doc?.pdfDoc) return null;
        try {
          const asked = doc.pdfDoc.getPage(1).then((p) => p.getViewport({ scale: 1 }).width, () => null);
          return await Promise.race([asked, new Promise((resolve) => setTimeout(() => resolve(null), 2000))]);
        } catch {
          return null; // the old document was closed under our hands: look again
        }
      });
      if (width != null && Math.abs(width - points) < 0.5) return;
      assert.ok(Date.now() < deadline, `page 1 is ${width} pt wide, expected ${points}`);
      await page.waitForTimeout(250);
    }
  };

  // --- 1. Scale to fit between the margins; even pages mirrored ------------
  await openDialog();
  await select(0).selectOption('all');
  await customSize(200, 150);
  assert.equal(await select(3).inputValue(), 'scale', 'scaling the content is the default');
  assert.equal(await margin('even-left').count(), 0, 'one set of margins until the checkbox is ticked');

  await type(margin('odd-left'), '20');
  await type(margin('odd-right'), '10');
  await type(margin('odd-top'), '5');
  await type(margin('odd-bottom'), '15');

  // Margins that leave no room: the reason is shown and Apply does nothing.
  await type(margin('odd-left'), '195');
  await page.waitForSelector('.resize-margins-error');
  assert.match(await dialog.locator('.resize-margins-error').textContent(), /200 mm/);
  await dialog.locator('.pref-btn-primary').click();
  await page.waitForTimeout(500);
  const refused = await read();
  assert.equal(refused.dialogOpen, true, 'the dialog stays open on a margin error');
  assert.deepEqual(refused.sizes, [[400, 300], [400, 300], [400, 300]], 'nothing was resized');
  await type(margin('odd-left'), '20');
  assert.equal(await dialog.locator('.resize-margins-error').count(), 0, 'the message goes away with the cause');

  // A second set for the even pages starts as the mirror image of the first.
  await dialog.locator('.resize-margins-check input').check();
  await page.waitForSelector('[data-margin="even-left"]');
  const evenStart = {};
  for (const side of ['left', 'right', 'top', 'bottom']) {
    evenStart[side] = await margin(`even-${side}`).evaluate((el) => parseFloat(el.value));
  }
  assert.deepEqual(evenStart, { left: 10, right: 20, top: 5, bottom: 15 });

  await dialog.locator('.pref-btn-primary').click();
  await waitForWidth(200 * MM);
  await page.waitForTimeout(1000);

  // 400 x 300 pt into 170 x 130 mm: the width decides, factor 170 mm / 400 pt.
  const s = (170 * MM) / 400;
  const free = (130 * MM - 300 * s) / 2; // left over above and below
  const W = 200 * MM;
  const H = 150 * MM;
  const scaled = await read({
    // Odd pages: left 20 mm (56.7 pt), right 10 mm (28.3 pt).
    1: [[20, 200], [53, 200], [60, 200], [W - 32, 200], [W - 25, 200], [300, 8], [300, 22], [300, H - 50], [300, H - 20]],
    // Even pages: left 10 mm, right 20 mm.
    2: [[20, 200], [32, 200], [W - 60, 200], [W - 53, 200]],
    3: [[53, 200], [60, 200]],
  });
  assert.equal(scaled.dialogOpen, false, 'the dialog closed');
  for (const [w, h] of scaled.sizes) { near(w, W, 'page width'); near(h, H, 'page height'); }
  assert.deepEqual(scaled.colours[1], ['white', 'white', 'blue', 'blue', 'white', 'white', 'blue', 'blue', 'white'], 'page 1: the content lies between the margins');
  assert.deepEqual(scaled.colours[2], ['white', 'blue', 'blue', 'white'], 'page 2 has the margins of the even pages');
  assert.deepEqual(scaled.colours[3], ['white', 'blue'], 'page 3 has the margins of the odd pages again');
  for (const a of scaled.annotations) {
    const left = (a.page % 2 === 0 ? 10 : 20) * MM;
    near(a.x, 100 * s + left, `page ${a.page} annotation x`);
    near(a.y, 100 * s + 5 * MM + free, `page ${a.page} annotation y`);
    near(a.width, 80 * s, `page ${a.page} annotation width`);
    near(a.height, 60 * s, `page ${a.page} annotation height`);
  }

  // Undo puts the pages and the annotations back.
  await page.evaluate(async () => { await (await import('/js/core/undo-manager.js')).undo(); });
  await waitForWidth(400);
  await page.waitForTimeout(500);
  const undone = await read();
  assert.deepEqual(undone.sizes, [[400, 300], [400, 300], [400, 300]]);
  for (const a of undone.annotations) assert.deepEqual([a.x, a.y, a.width, a.height], [100, 100, 80, 60]);

  // --- 2. Keep the size: centred between the margins and cropped there -----
  await openDialog();
  await select(0).selectOption('all');
  await customSize(120, 100);
  await select(3).selectOption('keep');
  await type(margin('odd-left'), '20');
  await type(margin('odd-right'), '10');
  await type(margin('odd-top'), '5');
  await type(margin('odd-bottom'), '15');
  await dialog.locator('.pref-btn-primary').click();
  await waitForWidth(120 * MM);
  await page.waitForTimeout(1000);

  const W2 = 120 * MM;
  const H2 = 100 * MM;
  const kept = await read({
    // The page (400 x 300 pt) is larger than the area (90 x 80 mm): it fills
    // the area, and the margins stay empty.
    1: [[30, 140], [53, 140], [60, 140], [W2 - 32, 140], [W2 - 25, 140], [150, 8], [150, 20], [150, H2 - 48], [150, H2 - 38]],
    2: [[53, 140], [60, 140]],
  });
  for (const [w, h] of kept.sizes) { near(w, W2, 'page width'); near(h, H2, 'page height'); }
  assert.deepEqual(kept.colours[1], ['white', 'white', 'blue', 'blue', 'white', 'white', 'blue', 'blue', 'white'], 'the content is cropped to the area between the margins');
  assert.deepEqual(kept.colours[2], ['white', 'blue'], 'one set of margins applies to even pages too');
  for (const a of kept.annotations) {
    near(a.x, 100 + 20 * MM + (90 * MM - 400) / 2, `page ${a.page} annotation x`);
    near(a.y, 100 + 5 * MM + (80 * MM - 300) / 2, `page ${a.page} annotation y`);
    assert.deepEqual([a.width, a.height], [80, 60], 'the annotation keeps its size');
  }

  await page.evaluate(async () => { await (await import('/js/core/undo-manager.js')).undo(); });
  await waitForWidth(400);
  await page.waitForTimeout(500);

  // --- 3. No margins: as before, and nothing is clipped --------------------
  await openDialog();
  await select(0).selectOption('all');
  await customSize(200, 150);
  await select(3).selectOption('keep');
  await dialog.locator('.pref-btn-primary').click();
  await waitForWidth(200 * MM);
  await page.waitForTimeout(1000);
  const plain = await read({ 1: [[20, 200], [W / 2, H / 2]] });
  // The page is centred; what was drawn outside it shows around it, as it always did.
  assert.deepEqual(plain.colours[1], ['green', 'blue']);
  for (const a of plain.annotations) {
    near(a.x, 100 + (W - 400) / 2, `page ${a.page} annotation x`);
    near(a.y, 100 + (H - 300) / 2, `page ${a.page} annotation y`);
  }

  assert.deepEqual(errors, [], 'no uncaught browser errors');
  console.log(JSON.stringify({ passed: true, scaled: scaled.sizes[0], kept: kept.sizes[0] }));
} catch (e) {
  // A step that never finishes is usually an error in the page: show it.
  if (errors.length) console.error('browser errors:', errors);
  throw e;
} finally {
  await browser?.close(); await server.close(); await rm(cache, { recursive: true, force: true });
}
