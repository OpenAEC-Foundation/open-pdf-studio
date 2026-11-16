import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { PDFDocument, PDFName, PDFNumber, degrees } from 'pdf-lib';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const cache = await mkdtemp(path.join(tmpdir(), 'opds-page-size-'));
const server = await createServer({ cacheDir: cache, server: { host: '127.0.0.1', port: 3203, strictPort: true, hmr: false } });
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(server.resolvedUrls.local[0], { timeout: 120000 });
  await page.waitForSelector('#document-tabs', { timeout: 120000 });
  const pdf = await PDFDocument.create(); pdf.addPage([2592, 1728]);
  const rotated = pdf.addPage([720, 1080]); rotated.setRotation(degrees(90));
  rotated.node.set(PDFName.of('UserUnit'), PDFNumber.of(2));
  await page.evaluate(async bytes => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const tab = createTab('/page-size.pdf');
    await loadPDF('/page-size.pdf', tab.index, new Uint8Array(bytes));
    await (await import('/js/core/state.ts')).getActiveDocument()._annotationCompletion;
  }, Array.from(await pdf.save()));
  const pageSize = page.locator('#prop-no-selection .prop-info-value').nth(2);
  async function setUnits(value) {
    await page.evaluate(async value => {
      (await import('/js/core/state.ts')).state.preferences.scaleUnitSystem = value;
    }, value);
  }
  async function expectSize(expected) {
    await page.waitForFunction(expected => {
      const sizes = document.querySelectorAll('#prop-no-selection .prop-info-value');
      return sizes[2]?.textContent === expected;
    }, expected);
    assert.equal(await pageSize.textContent(), expected);
  }
  for (const [system, expected] of [
    ['metric', '914.4 x 609.6 mm'], ['imperial', '36.00 x 24.00 in'],
    ['both', '914.4 x 609.6 mm (36.00 x 24.00 in)'],
  ]) { await setUnits(system); await expectSize(expected); }
  await page.evaluate(async () => (await import('/js/solid/stores/dialogStore.js')).openDialog('calibration'));
  await page.locator('.calibration-tab').nth(1).click();
  const calibration = page.locator('.calibration-page-size');
  await calibration.waitFor();
  for (const [system, expected] of [
    ['imperial', '36.00 x 24.00 in'], ['metric', '914.4 x 609.6 mm'],
    ['both', '914.4 x 609.6 mm (36.00 x 24.00 in)'],
  ]) {
    await setUnits(system); await expectSize(expected);
    await page.waitForFunction(expected => document.querySelector('.calibration-page-size')?.textContent.endsWith(expected), expected);
  }
  // A rotated sheet with UserUnit=2 has a different physical landscape size.
  await page.evaluate(async () => {
    (await import('/js/solid/stores/dialogStore.js')).closeDialog('calibration');
    (await import('/js/core/state.ts')).getActiveDocument().currentPage = 2;
  });
  await setUnits('imperial'); await expectSize('30.00 x 20.00 in');
  await page.evaluate(async () => (await import('/js/solid/stores/dialogStore.js')).openDialog('calibration'));
  await page.locator('.calibration-tab').nth(1).click();
  await page.waitForFunction(() => document.querySelector('.calibration-page-size')?.textContent.endsWith('30.00 x 20.00 in'));
  // Missing page data remains '-' in both places.
  await page.evaluate(async () => {
    (await import('/js/solid/stores/dialogStore.js')).closeDialog('calibration');
    (await import('/js/core/state.ts')).getActiveDocument().pdfDoc = null;
  });
  await expectSize('-');
  await page.evaluate(async () => (await import('/js/solid/stores/dialogStore.js')).openDialog('calibration'));
  await page.locator('.calibration-tab').nth(1).click();
  await page.waitForFunction(() => document.querySelector('.calibration-page-size')?.textContent.endsWith('-'));
  assert.deepEqual(errors, []);
  console.log('PASS: page-size units update Properties and open Calibration; rotated UserUnit page and missing size');
} catch (e) { console.error(e); process.exitCode = 1; } finally {
  await browser.close(); await Promise.race([server.close(), new Promise(r => setTimeout(r, 2000))]); await rm(cache, { recursive: true, force: true });
}

process.exit(process.exitCode || 0);
