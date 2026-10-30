// Run against an isolated Vite server; exercises the actual print dialog and PDF download.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { PDFDocument, rgb } from 'pdf-lib';

const mm = 72 / 25.4;
const source = await PDFDocument.create();
source.addPage([594 * mm, 841 * mm]).drawRectangle({ x: 0, y: 0, width: 594 * mm, height: 841 * mm, color: rgb(1, 0, 0) });
const bytes = [...await source.save()];
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(process.argv[2] || 'http://127.0.0.1:3068', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.locator('[data-tab="drawing"]').waitFor({ timeout: 90000 });
  await page.evaluate(async bytes => {
    const { cacheWebFile } = await import('/js/core/platform.js');
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDFIfNeeded } = await import('/js/pdf/loader.js');
    const { state, getActiveDocument } = await import('/js/core/state.ts');
    const { stelPaginaInstellingIn } = await import('/js/solid/components/dialogs/PageSetupDialog.jsx');
    const { openDialog } = await import('/js/solid/stores/dialogStore.js');
    cacheWebFile('crop-fixture.pdf', new Uint8Array(bytes));
    const { index } = createTab('crop-fixture.pdf'); await loadPDFIfNeeded('crop-fixture.pdf', index);
    stelPaginaInstellingIn({ docId: getActiveDocument().id, handmatig: true, size: 'a3', orientation: 'portrait' });
    state.preferences.printSettings = { printer: 'opds:opslaan-als-pdf', scaling: 'poster', posterScale: 100,
      posterOverlap: 0, posterCutMarks: false, posterLabels: false, autoRotate: false, posterEdgeCrop: true };
    openDialog('print');
  }, bytes);
  const crop = page.locator('#print-poster-edge-crop');
  const count = async n => page.waitForFunction(n => {
    const text = document.querySelector('.print-preview-footer > span')?.textContent || '';
    return new RegExp(`1\\D+${n}\\s*$`).test(text.trim());
  }, n);
  await count(6); assert.equal(await crop.isChecked(), false);
  await crop.check(); await count(4);
  await page.locator('.print-preview-nav-btn').last().click();
  await crop.uncheck(); await count(6); // Reset navigation when the grid changes.
  await crop.check(); await count(4);
  await page.waitForFunction(() => {
    const c = document.querySelector('#print-preview-canvas'), ctx = c?.getContext('2d');
    return ctx && [.25, .75].every(y => {
      const pixel = ctx.getImageData(c.width / 2, c.height * y, 1, 1).data;
      return pixel[0] > 245 && pixel[1] < 10 && pixel[2] < 10;
    });
  });
  await page.screenshot({ path: '/tmp/opds-855-preview.png', fullPage: true });
  const download = page.waitForEvent('download');
  await page.locator('.print-footer-right .pref-btn-primary').click();
  const cropped = await PDFDocument.load(await readFile(await (await download).path()));
  assert.equal(cropped.getPageCount(), 4);
  for (const p of cropped.getPages()) {
    assert.ok(Math.abs(p.getWidth() - 297 * mm) < .01);
    assert.ok(Math.abs(p.getHeight() - 420 * mm) < .01);
  }
  await page.evaluate(async () => (await import('/js/solid/stores/dialogStore.js')).openDialog('print'));
  await count(6); assert.equal(await crop.isChecked(), false);
  const fullDownload = page.waitForEvent('download');
  await page.locator('.print-footer-right .pref-btn-primary').click();
  const full = await PDFDocument.load(await readFile(await (await fullDownload).path()));
  assert.equal(full.getPageCount(), 6);
  assert.deepEqual(errors, []);
  console.log('PASS: default preserves content, explicit crop, navigation reset, 4/6-sheet actual PDF downloads, reset on reopen');
} finally { await browser.close(); }
