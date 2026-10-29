// Run against an isolated Vite server; exercises real PDF.js navigation.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';

const pdf = await PDFDocument.create();
for (let i = 1; i <= 4; i++) pdf.addPage([600, 800]).drawText(`Page ${i}`, { x: 50, y: 600 });
const bytes = [...await pdf.save()];
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto(process.argv[2] || 'http://127.0.0.1:3064', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-tab="drawing"]').waitFor({ timeout: 90000 });
  const result = await page.evaluate(async bytes => {
    const { cacheWebFile } = await import('/js/core/platform.js');
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDFIfNeeded } = await import('/js/pdf/loader.js');
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { setThumbnailImage } = await import('/js/bridge.ts');
    const { goToPage, renderPage } = await import('/js/pdf/renderer.js');
    cacheWebFile('transition-fixture.pdf', new Uint8Array(bytes));
    const { index } = createTab('transition-fixture.pdf');
    await loadPDFIfNeeded('transition-fixture.pdf', index);
    const doc = getActiveDocument();
    doc.viewMode = 'single'; doc.scale = 3;
    await renderPage(1);
    const thumbnail = document.createElement('canvas'); thumbnail.width = 150; thumbnail.height = 200;
    thumbnail.getContext('2d').fillRect(0, 0, 150, 200);
    for (let i = 1; i <= 4; i++) setThumbnailImage(i, { dataURL: thumbnail.toDataURL(), width: 150, height: 200, px: 300 });
    // Record even an overlay inserted and hidden within one animation frame.
    let overlays = 0;
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.target.id === 'page-transition-placeholder') overlays++;
        for (const node of record.addedNodes) {
          if (node.id === 'page-transition-placeholder' || node.querySelector?.('#page-transition-placeholder')) overlays++;
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'src'] });
    // Force a cold-page wait, then exercise fast back/forward navigation too.
    const getPage = doc.pdfDoc.getPage.bind(doc.pdfDoc);
    let delayed = false;
    doc.pdfDoc.getPage = async n => {
      if (n === 2 && !delayed) { delayed = true; await new Promise(resolve => setTimeout(resolve, 180)); }
      return getPage(n);
    };
    const seen = [];
    try {
      for (const n of [2, 3, 2, 4, 1]) {
        await goToPage(n);
        await new Promise(requestAnimationFrame);
        const canvas = document.getElementById('pdf-canvas');
        seen.push({ page: doc.currentPage, scale: doc.scale, width: canvas.style.width, height: canvas.style.height });
      }
    } finally { observer.disconnect(); doc.pdfDoc.getPage = getPage; }
    return { overlays, delayed, seen };
  }, bytes);
  assert.equal(result.overlays, 0, 'no fit-to-window thumbnail even during the cold page wait');
  assert.equal(result.delayed, true);
  assert.deepEqual(result.seen.map(x => x.page), [2, 3, 2, 4, 1]);
  for (const state of result.seen) {
    assert.equal(state.scale, 3);
    assert.equal(state.width, '1800px');
    assert.equal(state.height, '2400px');
  }
  console.log('PASS: cold and fast real PDF.js page navigation at 300%, cached sidebar thumbnails never overlay the canvas', result);
} finally { await browser.close(); }
