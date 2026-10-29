import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
const pdf = await PDFDocument.create();
for (let i = 1; i <= 8; i++) pdf.addPage([300, 400]).drawText(`Page ${i}`, { x: 50, y: 200 });
const bytes = [...await pdf.save()];
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', error => console.error('Browser error:', error.message));
  page.on('console', message => { if (message.type() === 'error') console.error('Browser console:', message.text()); });
  await page.goto(process.argv[2] || 'http://127.0.0.1:3062', { waitUntil: 'domcontentloaded', timeout: 90000 });
  console.log('Loaded page');
  await page.locator('[data-tab="drawing"]').waitFor({ timeout: 90000 });
  console.log('Loading fixture');
  await page.evaluate(async bytes => {
    const { cacheWebFile } = await import('/js/core/platform.js');
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDFIfNeeded } = await import('/js/pdf/loader.js');
    cacheWebFile('drag-fixture.pdf', new Uint8Array(bytes));
    const { index } = createTab('drag-fixture.pdf');
    await loadPDFIfNeeded('drag-fixture.pdf', index);
    const { openDialog } = await import('/js/solid/stores/dialogStore.js'); openDialog('page-organizer');
    // Model native ownership of HTML5 drops: no HTML5 gesture may be used.
    window.__nativeDragStarts = 0;
    document.addEventListener('dragstart', e => { window.__nativeDragStarts++; e.preventDefault(); }, true);
  }, bytes);
  console.log('Fixture loaded');
  const tiles = page.locator('.page-organizer-tile');
  await tiles.nth(7).waitFor();
  const order = () => tiles.evaluateAll(els => els.map(e => e.dataset.key));
  const original = Array.from({ length: 8 }, (_, i) => `p${i + 1}`);
  const tile = key => page.locator(`.page-organizer-tile[data-key="${key}"]`);
  const point = async (locator, gap = false) => { const b = await locator.boundingBox(); return { x: b.x + b.width / 2, y: b.y + (gap ? 60 : 50) }; };
  async function drag(key, gap, finish = true) {
    const a = await point(tile(key)); const b = await point(page.locator('.page-organizer-gutter').nth(gap), true);
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 12 });
    if (finish) await page.mouse.up();
  }
  console.log('Testing reorder');
  await drag('p1', 4);
  assert.deepEqual(await order(), ['p2','p3','p4','p1','p5','p6','p7','p8']);
  await page.keyboard.press('Control+z'); assert.deepEqual(await order(), original);
  await tile('p1').click(); await tile('p2').click({ modifiers: ['Control'] });
  await drag('p1', 4);
  assert.deepEqual(await order(), ['p3','p4','p1','p2','p5','p6','p7','p8']);
  assert.equal(await page.locator('.page-organizer-tile.selected').count(), 2);
  await page.keyboard.press('Control+z'); assert.deepEqual(await order(), original);
  await drag('p1', 4, false); await page.keyboard.press('Escape'); await page.mouse.up();
  assert.deepEqual(await order(), original); assert.equal(await page.locator('.page-organizer-dialog').count(), 1);
  const a = await point(tile('p1')); await page.mouse.move(a.x,a.y); await page.mouse.down();
  await page.mouse.move(1,1,{steps:12}); await page.mouse.up(); assert.deepEqual(await order(), original);
  await tile('p3').click(); assert.equal(await tile('p3').getAttribute('aria-selected'), 'true');
  assert.equal(await page.evaluate(() => window.__nativeDragStarts), 0);
  console.log('Testing native insertion');
  // External native file drops still reach the organizer callback.
  await page.evaluate(async bytes => {
    const { cacheWebFile } = await import('/js/core/platform.js');
    cacheWebFile('external-fixture.pdf', new Uint8Array(bytes));
    const { pageDropTarget } = await import('/js/ui/page-drop-target.js');
    const target = pageDropTarget(); target.over(0,0); await target.drop(['external-fixture.pdf'],0,0);
  }, bytes);
  assert.equal((await order()).filter(k => k.startsWith('f')).length, 8);
  await page.keyboard.press('Escape');
  const count = await page.evaluate(async () => (await import('/js/core/state.ts')).getActiveDocument().pdfDoc.numPages);
  assert.equal(count, 8);
  console.log('Testing Apply');
  await page.evaluate(async () => {
    window.__getActiveDocument = (await import('/js/core/state.ts')).getActiveDocument;
    window.__beforeApplyPdf = window.__getActiveDocument().pdfDoc;
    (await import('/js/solid/stores/dialogStore.js')).openDialog('page-organizer');
  });
  await tiles.nth(7).waitFor(); await drag('p1', 4);
  assert.deepEqual(await order(), ['p2','p3','p4','p1','p5','p6','p7','p8']);
  console.log('Click Apply');
  await page.locator('#page-organizer-apply').click();
  console.log('Wait for applied PDF');
  await page.waitForFunction(() => window.__getActiveDocument().pdfDoc !== window.__beforeApplyPdf && window.__getActiveDocument().undoStack.length > 0, null, { timeout: 30000 }).catch(async error => {
    console.error(await page.evaluate(async () => {
      const doc = (await import('/js/core/state.ts')).getActiveDocument();
      const bytes = (await import('/js/pdf/loader.js')).getCachedPdfBytes(doc.filePath);
      return { path: doc.filePath, cachedBytes: bytes?.length, undo: doc.undoStack.length, body: document.body.innerText.slice(-5000) };
    }));
    throw error;
  });
  console.log('Applied PDF changed');
  const applied = await page.evaluate(async () => {
    const doc = (await import('/js/core/state.ts')).getActiveDocument();
    const page = await doc.pdfDoc.getPage(1);
    return { text: (await page.getTextContent()).items.map(i => i.str).join(''), undo: doc.undoStack.length };
  });
  assert.equal(applied.text, 'Page 2'); assert.equal(applied.undo, 1);
  console.log('PASS: single/multi page pointer moves, undo, Escape/outside cancellation, click selection, native file insertion/discard and Apply into real PDF with one undo step; no HTML5 drag events');
} finally { await browser.close(); }
