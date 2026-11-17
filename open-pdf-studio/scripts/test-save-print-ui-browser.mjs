import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { PDFDocument } from 'pdf-lib';
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
for (const language of await readdir(path.join(root, 'js/i18n/locales'))) {
  const strings = JSON.parse(await readFile(path.join(root, 'js/i18n/locales', language, 'dialogs.json'), 'utf8'));
  assert.ok(strings.print.perSheetColumns?.trim() && strings.print.perSheetRows?.trim(), `${language}: distinct grid labels`);
}
const cache = await mkdtemp(path.join(tmpdir(), 'opds-save-print-'));
const fixture = {
  name: 'save-button-test-fixture',
  resolveId(id) { if (id === '/save-test-fixture.js') return '\0save-test-fixture.js'; },
  load(id) {
    if (id !== '\0save-test-fixture.js') return;
    return `
      import { render } from 'solid-js/web';
      import { createComponent } from 'solid-js';
      import SaveSplitButton from '/js/solid/components/SaveSplitButton.jsx';
      export function mount() {
        const host = document.createElement('div'); host.id = 'save-test-host';
        host.style.cssText = 'position:fixed;top:200px;left:200px;z-index:10000;background:white';
        document.body.append(host); window.saveCalls = [];
        render(() => createComponent(SaveSplitButton, {
          saveLabel: 'Save', saveAsLabel: 'Save As', exportLabel: 'Export',
          onSave: () => window.saveCalls.push('save'),
          onSaveAs: () => window.saveCalls.push('saveAs'),
          onExport: () => window.saveCalls.push('export'),
        }), host);
      }
    `;
  },
};
const server = await createServer({ root, cacheDir: cache, plugins: [fixture], logLevel: 'error', server: { host: '127.0.0.1', port: 18351, strictPort: false, hmr: false } });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1300, height: 950 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { timeout: 120000 });
  await page.waitForSelector('#tool-select', { timeout: 120000 });
  await page.waitForTimeout(1000);
  const arrow = page.locator('.title-bar .quick-save-arrow');
  assert.equal(await arrow.isDisabled(), true, 'no document disables save menu');
  const pdf = await PDFDocument.create();
  for (let i = 0; i < 4; i++) pdf.addPage([595, 842]).drawText(`Print UI ${i + 1}`);
  await page.evaluate(async bytes => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const tab = createTab('/save-print-ui.pdf');
    await loadPDF('/save-print-ui.pdf', tab.index, new Uint8Array(bytes));
  }, Array.from(await pdf.save()));
  await arrow.focus(); await arrow.press('ArrowDown');
  const menu = page.locator('#quick-save-menu');
  await menu.waitFor();
  await page.screenshot({ path: path.join(tmpdir(), 'opds-save-menu-ui.png') });
  // Save As, Save as IFCX and raster export.
  assert.equal(await menu.locator('button').count(), 3);
  assert.match(await menu.locator('#quick-save-ifcx').textContent(), /IFCX/);
  assert.equal(await menu.locator('button').nth(0).evaluate(e => e === document.activeElement), true);
  await page.keyboard.press('ArrowDown');
  assert.equal(await menu.locator('button').nth(1).evaluate(e => e === document.activeElement), true);
  await page.keyboard.press('Escape');
  assert.equal(await menu.count(), 0);
  assert.equal(await arrow.evaluate(e => e === document.activeElement), true);
  // Outside the menu: the status bar is never covered by it.
  await arrow.click(); await page.locator('.status-bar').click({ position: { x: 5, y: 5 } });
  assert.equal(await menu.count(), 0, 'outside click closes menu');
  await page.evaluate(async () => {
    const { state } = await import('/js/core/state.ts');
    state.documents[state.activeDocumentIndex].hostAlleenLezen = true;
  });
  assert.equal(await page.locator('.quick-save-split > button').first().isDisabled(), true);
  assert.equal(await arrow.isDisabled(), false, 'read-only still permits Save As and export');
  await arrow.click();
  await page.evaluate(async () => {
    const { state } = await import('/js/core/state.ts');
    state.documents[state.activeDocumentIndex].hostAlleenLezen = false;
    (await import('/js/bridge.ts')).openDialog('print');
  });
  await page.waitForSelector('.print-dialog');
  assert.equal(await menu.count(), 0, 'opening a modal dismisses save menu');
  assert.equal(await arrow.isDisabled(), true);
  const layout = () => page.evaluate(() => {
    const row = document.querySelector('.print-custom-row');
    const group = row.closest('fieldset');
    const label = row.querySelector('label');
    const select = document.querySelector('#print-duplex');
    const checks = [...document.querySelectorAll('.print-checkbox-row')];
    return {
      labelAlign: getComputedStyle(label).textAlign,
      customIndent: row.getBoundingClientRect().left - group.getBoundingClientRect().left,
      checkPadding: checks.map(e => getComputedStyle(e).paddingInlineStart),
      selectWidth: select.getBoundingClientRect().width,
      rowWidth: select.parentElement.getBoundingClientRect().width,
    };
  });
  const l = await layout();
  assert.equal(l.labelAlign, 'start');
  const gridColors = await page.evaluate(() => getComputedStyle(document.querySelector('.print-label')).color);
  assert.ok(gridColors);
  assert.ok(l.customIndent < 15, 'custom page range starts at fieldset edge');
  assert.ok(l.checkPadding.every(x => x === '0px'), 'standalone checkboxes are not indented');
  assert.ok(l.selectWidth < l.rowWidth - 65, 'select uses content width instead of stretching');
  const modes = page.locator('.print-mode-btns button');
  await modes.nth(1).click();
  const perSheet = page.locator('.print-placement-group select').first();
  await perSheet.selectOption('custom');
  await page.waitForSelector('#print-sheet-columns');
  assert.equal(await page.locator('label[for="print-sheet-columns"]').count(), 1);
  assert.equal(await page.locator('label[for="print-sheet-rows"]').count(), 1);
  assert.equal(await page.locator('.print-grid-label').first().evaluate(e => getComputedStyle(e).color), gridColors, 'grid labels respect the active theme');
  await page.locator('#print-sheet-columns').fill('3');
  await page.locator('#print-sheet-rows').fill('2');
  await page.locator('#print-sheet-rows').press('Tab');
  assert.equal(await page.locator('#print-sheet-columns').inputValue(), '3');
  assert.equal(await page.locator('#print-sheet-rows').inputValue(), '2');
  await page.screenshot({ path: process.env.OPDS_UI_SCREENSHOT || path.join(tmpdir(), 'opds-save-print-ui.png') });
  await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
  const rtl = await page.evaluate(() => [...document.querySelectorAll('.print-checkbox-row, .print-custom-row, .print-zoom-row')].map(e => ({ padding: getComputedStyle(e).paddingInlineStart, margin: getComputedStyle(e).marginInlineStart })));
  assert.ok(rtl.every(x => x.padding === '0px' && x.margin === '0px'), 'RTL has no stale reversed indentation');
  await page.locator('.print-footer-right .pref-btn-secondary').click();
  await page.evaluate(() => document.documentElement.setAttribute('dir', 'ltr'));

  // Exercise the actual reusable component's callbacks without writing user files.
  await page.evaluate(async () => (await import('/save-test-fixture.js')).mount());
  const host = page.locator('#save-test-host');
  await host.locator('.quick-access-btn').first().click();
  await host.locator('.quick-save-arrow').click();
  await host.locator('[role="menuitem"]').first().click();
  await host.locator('.quick-save-arrow').click();
  await host.locator('[role="menuitem"]').last().click();
  assert.deepEqual(await page.evaluate(() => window.saveCalls), ['save', 'saveAs', 'export']);
  assert.deepEqual(errors, [], 'no uncaught browser errors');
  console.log('PASS: save/menu callbacks, keyboard, dismissal, read-only/modal state, print alignment, compact selects, custom grid, RTL');
} finally { await browser?.close(); await server.close(); await rm(cache, { recursive: true, force: true }); }
