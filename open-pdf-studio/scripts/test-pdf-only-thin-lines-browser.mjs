// Real ribbon toggle and annotation canvases in single-page/continuous views.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { PDFDocument, rgb } from 'pdf-lib';
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const cache = await mkdtemp(path.join(tmpdir(), 'opds-thin-lines-'));
const server = await createServer({ root, cacheDir: cache, logLevel: 'error',
  server: { host: '127.0.0.1', port: 18396, strictPort: false, hmr: false } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { timeout: 120000 });
  await page.waitForSelector('#tool-select', { timeout: 120000 });
  const pdf = await PDFDocument.create();
  for (let i = 0; i < 2; i++) pdf.addPage([300, 300]).drawLine({ start: { x: 20, y: 240 }, end: { x: 240, y: 240 }, thickness: 12, color: rgb(0, 1, 0) });
  await page.evaluate(async bytes => {
    window.testState = await import('/js/core/state.ts');
    const { index } = (await import('/js/ui/chrome/tabs.js')).createTab('/thin.pdf');
    await (await import('/js/pdf/loader.js')).loadPDF('/thin.pdf', index, new Uint8Array(bytes));
    const doc = window.testState.getActiveDocument();
    await doc._annotationCompletion;
    doc.annotations.push(
      { id: 'box', type: 'box', page: 1, x: 30, y: 100, width: 90, height: 90, color: '#ff0000', lineWidth: 12, opacity: 1 },
      { id: 'hatch', type: 'box', page: 1, x: 160, y: 100, width: 90, height: 90, color: '#ff0000', lineWidth: 3, opacity: 1, hatchPattern: 'horizontal', hatchColor: '#ff0000' }
    );
    window.annotationBefore = JSON.stringify(doc.annotations);
    (await import('/js/annotations/rendering.js')).redrawAnnotations();
  }, [...await pdf.save()]);
  await page.locator('[data-tab="view"]').click();
  const settle = async () => {
    await page.waitForFunction(() => window.__pdfRenderInFlight === 0);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const pixels = selector => page.locator(selector).first().evaluate(c => {
    const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let red = 0; for (let i = 0; i < data.length; i += 4) if (data[i] > 150 && data[i+1] < 80 && data[i+2] < 80 && data[i+3] > 200) red++;
    return { red, image: c.toDataURL() };
  });
  for (const continuous of [false, true]) {
    if (continuous) await page.evaluate(async () => (await import('/js/pdf/renderer.js')).setViewMode('continuous'));
    const selector = continuous ? '.annotation-canvas' : '#annotation-canvas';
    await page.waitForSelector(selector); await settle();
    const before = await pixels(selector); assert.ok(before.red > 500, 'visible thick red annotation');
    await page.locator('#thin-lines-toggle').click(); await settle();
    assert.equal(await page.evaluate(() => window.testState.state.preferences.thinLines), true);
    assert.deepEqual(await pixels(selector), before, 'Thin Lines must not alter annotation pixels');
    await page.locator('#thin-lines-toggle').click(); await settle();
    assert.deepEqual(await pixels(selector), before, 'switching back preserves annotation pixels');
  }
  assert.equal(await page.evaluate(() => JSON.stringify(window.testState.getActiveDocument().annotations) === window.annotationBefore), true);
  assert.deepEqual(errors.filter(e => !e.startsWith('WebSocket closed without opened')), []);
  console.log('PASS: ribbon Thin Lines on/off preserves annotation border and hatch pixels in single-page and continuous views; model unchanged.');
} finally {
  await browser?.close(); await server.close(); await rm(cache, { recursive: true, force: true });
}
