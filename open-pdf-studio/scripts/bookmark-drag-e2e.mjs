import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
const pdf = await PDFDocument.create(); pdf.addPage([612, 792]);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.setDefaultTimeout(15000);
  await page.goto(process.argv[2] || 'http://127.0.0.1:3076', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.locator('[data-tab="view"]').waitFor({ timeout: 90000 });
  await page.evaluate(async bytes => {
    const { cacheWebFile } = await import('/js/core/platform.js');
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDFIfNeeded } = await import('/js/pdf/loader.js');
    cacheWebFile('bookmarks.pdf', new Uint8Array(bytes));
    const { index } = createTab('bookmarks.pdf'); await loadPDFIfNeeded('bookmarks.pdf', index);
    const { getActiveDocument } = await import('/js/core/state.ts');
    const bm = await import('/js/ui/panels/bookmarks.js');
    const doc = getActiveDocument();
    window.bookmarkTest = { doc, bm, getActiveDocument };
    doc.bookmarks = ['a', 'b', 'c', 'd'].map((id, sortOrder) => ({ id, title: id.toUpperCase(), page: 1, parentId: null, sortOrder, expanded: true }));
    bm.updateBookmarksList();
    (await import('/js/solid/stores/leftPanelStore.js')).switchToLeftPanelTab('bookmarks');
    // Simulate a host which does not deliver internal HTML5 drag/drop.
    document.addEventListener('dragstart', e => { e.preventDefault(); e.stopImmediatePropagation(); }, true);
  }, [...await pdf.save()]);
  const row = id => page.locator(`[data-bm-id="${id}"]`);
  const model = () => page.evaluate(() => JSON.parse(JSON.stringify(window.bookmarkTest.doc.bookmarks)));
  const drag = async (from, to, fraction = .5, release = true) => {
    const a = await row(from).boundingBox(); const b = await row(to).boundingBox();
    await page.mouse.move(a.x + 65, a.y + a.height / 2); await page.mouse.down();
    await page.mouse.move(b.x + 80, b.y + b.height * fraction, { steps: 12 });
    if (release) await page.mouse.up();
  };
  await row('a').click(); await row('b').click({ modifiers: ['Control'] });
  await drag('a', 'c');
  await page.waitForFunction(() => window.bookmarkTest.doc.bookmarks.find(b => b.id === 'a').parentId === 'c', { timeout: 3000 });
  assert.equal((await model()).find(b => b.id === 'b').parentId, 'c');
  await page.evaluate(async () => { await (await import('/js/core/undo-manager.js')).undo(); });
  assert.ok((await model()).every(b => !b.parentId), 'one undo restores the group');
  // Shift ranges and before/after insertion preserve the group order.
  await row('a').click(); await row('b').click({ modifiers: ['Shift'] });
  await drag('a', 'd', .95);
  await page.waitForFunction(() => window.bookmarkTest.doc.bookmarks.find(b => b.id === 'a').sortOrder === 2);
  assert.equal((await model()).find(b => b.id === 'b').sortOrder, 3);
  await page.evaluate(async () => { await (await import('/js/core/undo-manager.js')).undo(); });
  const unchanged = await model();
  await drag('a', 'c', .5, false); await page.keyboard.press('Escape'); await page.mouse.up();
  assert.deepEqual(await model(), unchanged, 'Escape cancels the whole gesture');
  await drag('a', 'c', .5, false);
  await page.mouse.move(1100, 800); await page.mouse.up();
  assert.deepEqual(await model(), unchanged, 'release outside the list cancels');
  await page.evaluate(() => { const {doc, bm} = window.bookmarkTest; doc.pdfaCompliance = 'PDF/A-1b'; doc.pdfADismissed = false; bm.updateBookmarksList(); });
  await drag('a', 'c');
  assert.deepEqual(await model(), unchanged, 'read-only document cannot move bookmarks');
  await page.evaluate(() => { const {doc, bm} = window.bookmarkTest; doc.pdfaCompliance = null; bm.updateBookmarksList(); });
  await row('a').click();
  await drag('a', 'c');
  await page.waitForFunction(() => window.bookmarkTest.doc.bookmarks.find(b => b.id === 'a').parentId === 'c');
  const nested = await model();
  await drag('c', 'a');
  assert.deepEqual(await model(), nested, 'parent cannot be dropped into its own child');
  // A stationary pointer expands a closed parent, then still drops inside it.
  await page.evaluate(() => { const {doc, bm} = window.bookmarkTest; doc.bookmarks.find(b => b.id === 'c').expanded = false; bm.updateBookmarksList(); });
  await drag('d', 'c', .5, false);
  await row('a').waitFor({ state: 'visible' }); await page.mouse.up();
  await page.waitForFunction(() => window.bookmarkTest.doc.bookmarks.find(b => b.id === 'd').parentId === 'c');
  const [download, saved] = await Promise.all([
    page.waitForEvent('download', { timeout: 90000 }),
    page.evaluate(async () => (await import('/js/pdf/saver.js')).savePDF(null, { zonderHandtekeningVraag: true })),
  ]);
  assert.equal(saved, true);
  const stream = await download.createReadStream(); const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const reopened = await getDocument({ data: new Uint8Array(Buffer.concat(chunks)), isEvalSupported: false }).promise;
  try {
    const outline = await reopened.getOutline();
    assert.ok(outline.find(b => b.title === 'C').items.some(b => b.title === 'A'));
    assert.ok(outline.find(b => b.title === 'C').items.some(b => b.title === 'D'));
  } finally { await reopened.loadingTask.destroy(); }
  // Scroll continues with the pointer stationary near the bottom edge.
  await page.evaluate(() => { const {doc, bm} = window.bookmarkTest; doc.bookmarks = Array.from({length: 100}, (_, i) => ({id: 's'+i, title: 'Sheet '+i, page: 1, parentId: null, sortOrder: i, expanded: true})); bm.updateBookmarksList(); });
  const start = await row('s0').boundingBox(); const list = page.locator('.bookmarks-container'); const rect = await list.boundingBox();
  await page.mouse.move(start.x + 65, start.y + start.height / 2); await page.mouse.down();
  await page.mouse.move(rect.x + 80, rect.y + rect.height - 8, {steps: 8});
  await page.waitForFunction(() => document.querySelector('.bookmarks-container').scrollTop > 150);
  await page.keyboard.press('Escape'); await page.mouse.up();
  assert.ok((await model()).every(b => !b.parentId));
  await list.evaluate(el => { el.scrollTop = 0; });
  await drag('s0', 's2', .5, false);
  const beforeSwitch = await model();
  await page.evaluate(async bytes => {
    const { cacheWebFile } = await import('/js/core/platform.js');
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDFIfNeeded } = await import('/js/pdf/loader.js');
    cacheWebFile('other.pdf', new Uint8Array(bytes));
    const {index} = createTab('other.pdf'); await loadPDFIfNeeded('other.pdf', index);
  }, [...await pdf.save()]);
  await page.mouse.up();
  assert.deepEqual(await model(), beforeSwitch, 'document switch cancels old gesture');
  assert.equal(await page.evaluate(() => window.bookmarkTest.getActiveDocument().bookmarks.length), 0);
  console.log('PASS blocked-HTML5 group/range dragging, nesting, reordering, undo, cancellation/read-only/descendant guards, hover expansion, stationary autoscroll, document switch and saved PDF outline');
} finally { await browser.close(); }
