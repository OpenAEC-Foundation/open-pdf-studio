// #1262: echte keuzelijst, selectie, undo en PDF opslaan/heropenen.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { BLEND_MODES } from '../js/annotations/blend-modes.js';
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const pdf = await PDFDocument.create(); pdf.addPage([600, 400]);
const bytes = await pdf.save();
const cache = await mkdtemp(path.join(tmpdir(), 'opds-blend-panel-'));
const server = await createServer({ root, cacheDir: cache, logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  // Leg de taal vast vóór de asynchrone voorkeurslader begint.
  await page.addInitScript(() => localStorage.setItem('opds:pdfEditorPreferences', JSON.stringify({ language: 'en' })));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { timeout: 120000 });
  await page.waitForSelector('#tool-select', { timeout: 120000 });
  await page.evaluate(async data => {
    const { default: i18n } = await import('/js/i18n/config.js'); await i18n.changeLanguage('en');
    const { index } = (await import('/js/ui/chrome/tabs.js')).createTab('/blend-panel.pdf');
    await (await import('/js/pdf/loader.js')).loadPDF('/blend-panel.pdf', index, new Uint8Array(data));
    window.blendDoc = (await import('/js/core/state.ts')).getActiveDocument;
    const doc = window.blendDoc();
    const { createAnnotation } = await import('/js/annotations/factory.js');
    doc.annotations.push(createAnnotation({ type: 'box', page: 1, x: 60, y: 60, width: 200, height: 100, fillColor: '#ff0000', blendMode: 'screen' }));
    doc.annotations.push(createAnnotation({ type: 'textbox', page: 1, x: 90, y: 90, width: 200, height: 100, text: 'Blend test', fillColor: '#0000ff', blendMode: 'multiply' }));
    window.selectBlend = async indices => {
      const d = window.blendDoc();
      d.selectedAnnotations = indices.map(i => d.annotations[i]);
      d.selectedAnnotation = d.selectedAnnotations[0];
      const p = await import('/js/solid/stores/propertiesStore.js');
      p.setPanelCollapsed(false);
      if (indices.length > 1) p.storeShowMultiSelection(d.selectedAnnotations);
      else p.storeShowProperties(d.selectedAnnotation);
    };
    await window.selectBlend([0]);
  }, [...bytes]);
  const menu = page.locator('#prop-blend-mode');
  await menu.waitFor({ state: 'visible' });
  assert.deepEqual(await menu.locator('option').evaluateAll(options => options.map(o => o.value)), BLEND_MODES);
  assert.equal(await menu.inputValue(), 'screen');
  assert.equal(await page.getByLabel('Blend Mode', { exact: true }).count(), 1);
  for (const mode of BLEND_MODES) {
    await menu.selectOption(mode);
    assert.equal(await page.evaluate(() => window.blendDoc().annotations[0].blendMode), mode);
  }
  await page.evaluate(async () => {
    (await import('/js/core/undo-manager.js')).flushPropertyChange();
    await window.selectBlend([0, 1]);
  });
  assert.equal(await menu.inputValue(), 'mixed');
  await menu.selectOption('overlay');
  assert.deepEqual(await page.evaluate(() => window.blendDoc().annotations.map(a => a.blendMode)), ['overlay', 'overlay']);
  await page.evaluate(async () => { await (await import('/js/core/undo-manager.js')).undo(); await window.selectBlend([0, 1]); });
  assert.equal(await menu.inputValue(), 'mixed');
  await page.evaluate(async () => { await (await import('/js/core/undo-manager.js')).redo(); await window.selectBlend([0, 1]); });
  assert.equal(await menu.inputValue(), 'overlay');
  await page.evaluate(async () => { window.blendDoc().annotations[1].locked = true; await window.selectBlend([0, 1]); });
  assert.equal(await menu.isDisabled(), true);
  await page.evaluate(async () => { await window.selectBlend([1]); });
  assert.equal(await menu.isDisabled(), true);
  await page.evaluate(async () => { window.blendDoc().annotations[1].locked = false; await window.selectBlend([1]); });
  await menu.selectOption('colorBurn');
  await menu.scrollIntoViewIfNeeded();
  if (process.env.OPS_BLEND_SCREENSHOT) await page.screenshot({ path: process.env.OPS_BLEND_SCREENSHOT });
  await page.evaluate(async () => {
    const saved = await (await import('/js/pdf/saver.js')).bouwMomentopname(window.blendDoc());
    const { index } = (await import('/js/ui/chrome/tabs.js')).createTab('/blend-reopened.pdf');
    await (await import('/js/pdf/loader.js')).loadPDF('/blend-reopened.pdf', index, saved.slice());
    await window.selectBlend([0, 1]);
  });
  assert.deepEqual(await page.evaluate(() => window.blendDoc().annotations.map(a => a.blendMode).sort()), ['colorBurn', 'overlay']);
  assert.equal(await menu.inputValue(), 'mixed');
  console.log('PASS: 16 UI modes; rectangle/textbox, mixed selection, bulk undo/redo, single/mixed locks, real save/loadPDF roundtrip');
} finally {
  await browser?.close(); await server.close(); await rm(cache, { recursive: true, force: true });
}
