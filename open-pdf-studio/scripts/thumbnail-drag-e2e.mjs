// node scripts/thumbnail-drag-e2e.mjs [isolated Vite URL]
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
const pdf = await PDFDocument.create();
for (let i = 1; i <= 8; i++) pdf.addPage([300, 400]).drawText(`Page ${i}`, { x: 50, y: 200 });
const bytes = [...await pdf.save()];
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.argv[2] || 'http://127.0.0.1:32862', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.locator('[data-tab="drawing"]').waitFor({ timeout: 90000 });
  await page.evaluate(async bytes => {
    const { cacheWebFile } = await import('/js/core/platform.js');
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDFIfNeeded } = await import('/js/pdf/loader.js');
    cacheWebFile('thumbnail-drag.pdf', new Uint8Array(bytes));
    const { index } = createTab('thumbnail-drag.pdf');
    await loadPDFIfNeeded('thumbnail-drag.pdf', index);
    window.__dragState = await import('/js/core/state.ts');
    window.__beforeDrag = window.__dragState.getActiveDocument().pdfDoc;
    window.__nativeDragStarts = 0;
    // Model native drop ownership in a desktop WebView: HTML5 dragging cannot finish.
    document.addEventListener('dragstart', e => { window.__nativeDragStarts++; e.preventDefault(); }, true);
  }, bytes);
  const tile = n => page.locator(`.thumbnail-item[data-page="${n}"]`);
  await tile(4).waitFor({ state: 'visible' });
  const order = () => page.evaluate(async () => {
    const pdf = window.__dragState.getActiveDocument().pdfDoc;
    const labels = [];
    for (let n = 1; n <= pdf.numPages; n++) labels.push((await (await pdf.getPage(n)).getTextContent()).items.map(i => i.str).join(''));
    return labels;
  });
  const original = Array.from({ length: 8 }, (_, i) => `Page ${i + 1}`);
  const snapshot = () => page.evaluate(() => { window.__beforeDrag = window.__dragState.getActiveDocument().pdfDoc; });
  const changed = () => page.waitForFunction(() => window.__dragState.getActiveDocument().pdfDoc !== window.__beforeDrag, null, { timeout: 15000 });
  async function drag(from, to, finish = true) {
    const a = await tile(from).boundingBox(); const b = await tile(to).boundingBox();
    const list = await page.locator('#thumbnails-container').boundingBox();
    assert.ok(b.y + b.height - 8 < list.y + list.height, 'drop point must be inside the visible thumbnail list');
    await page.mouse.move(a.x + a.width / 2, a.y + 40); await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height - 8, { steps: 12 });
    if (finish) await page.mouse.up();
  }
  await drag(1, 3);
  await changed();
  assert.deepEqual(await order(), ['Page 2', 'Page 3', 'Page 1', ...original.slice(3)]);
  await snapshot();
  await page.evaluate(async () => (await import('/js/core/undo-manager.js')).undo());
  await changed();
  assert.deepEqual(await order(), original);
  await tile(1).click(); await tile(2).click({ modifiers: ['Control'] });
  await snapshot(); await drag(1, 4); await changed();
  assert.deepEqual(await order(), ['Page 3', 'Page 4', 'Page 1', 'Page 2', ...original.slice(4)]);
  await snapshot(); await page.evaluate(async () => (await import('/js/core/undo-manager.js')).undo()); await changed();
  assert.deepEqual(await order(), original);
  await drag(1, 3, false); await page.keyboard.press('Escape'); await page.mouse.up();
  assert.deepEqual(await order(), original);
  await drag(1, 3, false); await page.mouse.move(1400, 200); await page.mouse.up();
  assert.deepEqual(await order(), original);
  await tile(3).click();
  assert.ok(await tile(3).evaluate(el => el.classList.contains('selected')), 'normal clicks still select');
  await tile(3).locator('.thumbnail-label').dblclick();
  await tile(3).locator('input').fill('Custom page');
  await page.keyboard.press('Enter');
  assert.equal(await tile(3).locator('.thumbnail-label').textContent(), 'Custom page');
  assert.equal(await page.evaluate(() => window.__nativeDragStarts), 0);
  assert.deepEqual(errors, []);
  console.log('Thumbnail pointer drag: single/group reorder, actual PDF order, one-step undo, Escape/outside cancellation, click selection, label editing, and zero HTML5 drag starts passed.');
} finally { await browser.close(); }
