import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const cache = await mkdtemp(path.join(tmpdir(), 'opds-quantities-config-'));
const server = await createServer({ root, cacheDir: cache, logLevel: 'error',
  server: { host: '127.0.0.1', port: 18350, strictPort: false, hmr: false } });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { timeout: 120000 });
  await page.waitForSelector('#tool-select', { timeout: 120000 });
  const expected = await page.evaluate(async () => {
    await (await import('/js/pdf/loader.js')).createBlankPDF(595, 842, 1);
    const q = await import('/js/solid/stores/quantitiesStore.js');
    q.setSelectedCategories(['area', 'line-based']); q.setScheduledFields(['label', 'length']);
    q.setFilters([{ field: 'length', op: '>=', value: '2' }]);
    q.setSortLevels([{ field: 'label', dir: 'desc', group: true, header: true, footer: false }]);
    q.setItemize(false); q.setGrandTotals(false);
    q.setFormat({ length: { heading: 'Lengte α', unit: 'm', decimals: 3, align: 'left', total: false } });
    q.setAppearance({ gridlines: false, stripe: true, outline: true, showTitle: false, showHeaders: true });
    q.setScheduleVisible(true); q.setPropertiesVisible(true);
    return q.quantitiesConfig();
  });
  const exportButton = page.locator('[data-quantities-config="export"]');
  const importButton = page.locator('[data-quantities-config="import"]');
  const downloadPromise = page.waitForEvent('download');
  await exportButton.click(); const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), 'quantities.opds-quantities');
  const bytes = await readFile(await download.path());
  assert.deepEqual(JSON.parse(bytes.toString()).config, expected);
  // A fresh app session proves the file is independent of in-memory signals.
  await page.reload(); await page.waitForSelector('#tool-select', { timeout: 120000 });
  await page.evaluate(async () => {
    await (await import('/js/pdf/loader.js')).createBlankPDF(595, 842, 1);
    const q = await import('/js/solid/stores/quantitiesStore.js');
    q.setScheduleVisible(true); q.setPropertiesVisible(true);
  });
  async function importFile(buffer) {
    const chooserPromise = page.waitForEvent('filechooser');
    await importButton.click(); const chooser = await chooserPromise;
    await chooser.setFiles({ name: 'saved.opds-quantities', mimeType: 'application/json', buffer });
    await page.waitForFunction(() => !document.querySelector('[data-quantities-config="import"]')?.disabled);
  }
  const snapshot = () => page.evaluate(async () => (await import('/js/solid/stores/quantitiesStore.js')).quantitiesConfig());
  await importFile(bytes); assert.deepEqual(await snapshot(), expected);
  await page.locator('.q-tab').nth(3).click();
  assert.equal(await page.locator('.q-format-table tbody tr').nth(1).locator('td').nth(2).locator('input').inputValue(), 'm');
  // A future format is rejected with a visible error and no partial replacement.
  const invalid = JSON.parse(bytes.toString()); invalid.version = 99;
  await importFile(Buffer.from(JSON.stringify(invalid)));
  await page.waitForSelector('.message-dialog'); assert.deepEqual(await snapshot(), expected);
  await page.locator('.message-dialog-footer button').click();
  // Exercise the desktop dialog/fs contract using controlled mocks. No real files.
  await page.evaluate(() => {
    window.__TAURI__ = { core: { invoke: async () => {} },
      dialog: { open: async () => null, save: async () => null },
      fs: { writeFile: async () => { throw new Error('write denied'); } } };
  });
  await importButton.click();
  await page.waitForFunction(() => !document.querySelector('[data-quantities-config="import"]')?.disabled);
  assert.deepEqual(await snapshot(), expected);
  await page.evaluate(() => { window.__TAURI__.dialog.save = async () => '/test/quantities.opds-quantities'; });
  await exportButton.click(); await page.waitForSelector('.message-dialog');
  assert.deepEqual(await snapshot(), expected);
  console.log('Quantities configuration export, fresh-session import, invalid file, cancellation and write failure passed.');
} finally {
  await browser?.close(); await server.close(); await rm(cache, { recursive: true, force: true });
}
