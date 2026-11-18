// Actual calibration dialog, scale lookup, undo/redo, saver and loadPDF.
// Optional local reporter sample; CI uses a small generated CAD-style fixture.
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const lib = await PDFDocument.create();
const sheet = lib.addPage([2400, 1700]);
sheet.node.set(PDFName.of('VP'), lib.context.obj([{ Type: 'Viewport', BBox: [0, 0, 2400, 1700],
  Measure: { Type: 'Measure', Subtype: 'RL', X: [{ U: PDFString.of('mm'), C: 12.55464 }] } }]));
const bytes = process.env.OPS_SCALE_SAMPLE ? await readFile(process.env.OPS_SCALE_SAMPLE) : await lib.save();
const cache = await mkdtemp(path.join(tmpdir(), 'opds-scale-override-'));
const server = await createServer({ root, cacheDir: cache, logLevel: 'error', server: { host: '127.0.0.1', port: 18475, strictPort: false, hmr: false } });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { timeout: 120000 });
  await page.waitForSelector('#tool-select', { timeout: 120000 });
  await page.evaluate(async data => {
    const { default: i18n } = await import('/js/i18n/config.js'); await i18n.changeLanguage('en');
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { index } = createTab('/scale-original.pdf');
    await loadPDF('/scale-original.pdf', index, new Uint8Array(data));
    window.scaleTestDoc = (await import('/js/core/state.ts')).getActiveDocument;
  }, [...bytes]);
  await page.waitForFunction(() => window.scaleTestDoc()?.pdfViewports?.[1]?.length);
  const initial = await page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    const doc = getActiveDocument();
    const { createAnnotation } = await import('/js/annotations/factory.js');
    const { recalculateAllMeasurements, getMeasureScale } = await import('/js/annotations/measurement.js');
    doc.measureScale = { pixelsPerUnit: .05, unit: 'mm', method: 'reference', scaleRatio: 0 };
    doc.annotations.push(createAnnotation({ type: 'measureDistance', page: 1, startX: 450, startY: 500, endX: 550, endY: 500 }));
    doc.undoStack = []; doc.redoStack = [];
    recalculateAllMeasurements();
    return getMeasureScale(1, 500, 500).pixelsPerUnit;
  });
  assert.notEqual(initial, .05, 'embedded viewport overrides document calibration before opting in');
  const open = () => page.evaluate(async () => {
    const { default: i18n } = await import('/js/i18n/config.js'); await i18n.changeLanguage('en');
    (await import('/js/annotations/measurement.js')).showCalibrationDialog(100);
  });
  const dialog = page.locator('.calibration-dialog');
  await open();
  const toggle = dialog.getByRole('checkbox', { name: 'Override embedded PDF scales' });
  assert.equal(await toggle.isChecked(), false);
  await toggle.check();
  await dialog.locator('input.calibration-input').nth(0).fill('100');
  await dialog.locator('input.calibration-input').nth(1).fill('1000');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  const scale = () => page.evaluate(async () => (await import('/js/annotations/measurement.js')).getMeasureScale(1, 500, 500).pixelsPerUnit);
  assert.equal(await scale(), .1);
  assert.equal(await page.evaluate(async () => (await import('/js/core/state.ts')).getActiveDocument().annotations.find(a => a.type === 'measureDistance').measureValue), 1000);
  await page.evaluate(async () => (await import('/js/core/undo-manager.js')).undo()); assert.equal(await scale(), initial);
  await page.evaluate(async () => (await import('/js/core/undo-manager.js')).redo()); assert.equal(await scale(), .1);
  await page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    const saved = await (await import('/js/pdf/saver.js')).bouwMomentopname(getActiveDocument());
    const { index } = (await import('/js/ui/chrome/tabs.js')).createTab('/scale-reopened.pdf');
    await (await import('/js/pdf/loader.js')).loadPDF('/scale-reopened.pdf', index, saved.slice());
  });
  await page.waitForFunction(() => window.scaleTestDoc()?.filePath === '/scale-reopened.pdf' && window.scaleTestDoc()?.measureScale?.overridePdfScale === true);
  assert.equal(await scale(), .1, 'real saver/loadPDF retain override');
  await open(); assert.equal(await toggle.isChecked(), true);
  await toggle.uncheck(); await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  assert.equal(await scale(), initial, 'original embedded scale can be restored');
  await open(); await toggle.check(); await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await scale(), initial, 'cancel does not apply checkbox');
  await open(); await toggle.check(); await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await open(); await dialog.getByRole('button', { name: 'Reset', exact: true }).click();
  assert.equal(await scale(), initial, 'reset restores embedded scale');
  console.log('PASS: real PDF load, calibration opt-in, measurement recalculation, undo/redo, save/reopen, restore, cancel and reset');
} finally {
  await browser?.close(); await server.close(); await rm(cache, { recursive: true, force: true });
}
