import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const cache = await mkdtemp(path.join(tmpdir(), 'opds-quantities-area-'));
const server = await createServer({ root, cacheDir: cache, logLevel: 'error',
  server: { host: '127.0.0.1', port: 18349, strictPort: false, hmr: false } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { timeout: 120000 });
  await page.waitForSelector('#tool-select', { timeout: 120000 });
  const report = await page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    const loader = await import('/js/pdf/loader.js');
    await loader.createBlankPDF(595, 842, 1);
    const doc = getActiveDocument();
    doc.measureScale = { pixelsPerUnit: 0.1, unit: 'mm' };
    const { createMeasureAreaAnnotation } = await import('/js/tools/annotation-creators.js');
    doc.annotations = [createMeasureAreaAnnotation([
      { x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 200 }, { x: 100, y: 200 },
    ])];
    const q = await import('/js/solid/stores/quantitiesStore.js');
    q.setScheduledFields(['area', 'length']); q.setSortLevels([]); q.setFormat({});
    q.setScheduleVisible(true);
    const before = JSON.parse(JSON.stringify(q.scheduleResult()));
    const { pdfDocLib } = await (await import('/js/pdf/saver.js')).bouwAnnotatieDocument(doc);
    const bytes = await pdfDocLib.save();
    const path = '/quantities-area-roundtrip.pdf';
    const { index } = (await import('/js/ui/chrome/tabs.js')).createTab(path);
    await loader.loadPDF(path, index, bytes.slice());
    await getActiveDocument()._annotationCompletion;
    const reopened = JSON.parse(JSON.stringify(q.scheduleResult()));
    q.setPropertiesVisible(true);
    return { before, reopened };
  });
  for (const result of [report.before, report.reopened]) {
    assert.equal(result.count, 1);
    assert.deepEqual(result.columns.map(c => c.unit), ['m²', 'mm']);
    const { area, length } = result.groups[0].rows[0].vals;
    assert.ok(Math.abs(area - 2) < 1e-9);
    assert.ok(Math.abs(length - 6000) < 1e-9);
  }
  // Change the actual Quantities Properties unit field, not the store API.
  await page.locator('.q-props-dialog .q-tab').nth(3).click();
  await page.locator('.q-format-table tbody tr').nth(1).locator('td').nth(2).locator('input').fill('m');
  await page.waitForFunction(() => document.querySelector('.schedule-table th:last-child')?.textContent.includes('(m)'));
  const formatted = await page.evaluate(async () => {
    const q = await import('/js/solid/stores/quantitiesStore.js');
    return JSON.parse(JSON.stringify(q.scheduleResult()));
  });
  assert.deepEqual(formatted.columns.map(c => c.unit), ['m²', 'm']);
  assert.ok(Math.abs(formatted.groups[0].rows[0].vals.area - 2) < 1e-9);
  assert.ok(Math.abs(formatted.groups[0].rows[0].vals.length - 6) < 1e-9);
  console.log('Quantities area reload and real unit field passed.', JSON.stringify({
    before: report.before.groups[0].rows[0].vals, reopened: report.reopened.groups[0].rows[0].vals,
    formatted: formatted.groups[0].rows[0].vals,
  }));
} finally {
  await browser?.close(); await server.close(); await rm(cache, { recursive: true, force: true });
}
