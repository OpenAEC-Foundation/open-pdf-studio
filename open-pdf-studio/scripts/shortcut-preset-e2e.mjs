import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
const preset = fileURLToPath(new URL('../public/shortcuts/bluebeam-revu.json', import.meta.url));
const pdf = await PDFDocument.create(); pdf.addPage([612, 792]);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.setDefaultTimeout(15000);
  const url = process.argv[2] || 'http://127.0.0.1:3075';
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.locator('[data-tab="view"]').waitFor({ timeout: 90000 });
  await page.evaluate(async bytes => {
    const { default: i18n, loadLocale } = await import('/js/i18n/config.js');
    await loadLocale('en'); await i18n.changeLanguage('en');
    (await import('/js/core/state.ts')).state.preferences.language = 'en';
    const { cacheWebFile } = await import('/js/core/platform.js');
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDFIfNeeded } = await import('/js/pdf/loader.js');
    cacheWebFile('shortcuts.pdf', new Uint8Array(bytes));
    const { index } = createTab('shortcuts.pdf'); await loadPDFIfNeeded('shortcuts.pdf', index);
  }, [...await pdf.save()]);
  const owner = combo => page.evaluate(async combo => (await import('/js/core/keybindings/app-shortcuts.js')).sneltoetsen.ownerOf(combo), combo);
  const currentTool = () => page.evaluate(async () => (await import('/js/core/state.ts')).state.currentTool);
  const open = () => page.evaluate(async () => (await import('/js/solid/stores/dialogStore.js')).openDialog('preferences', { tab: 'shortcuts' }));
  const importPreset = async () => {
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: 'Import…', exact: true }).click(),
    ]);
    await chooser.setFiles(preset);
    await page.getByText('Shortcuts imported', { exact: false }).waitFor();
  };
  assert.equal(await owner('H'), 'tool.hand');
  await open(); await importPreset();
  assert.equal(await owner('H'), 'tool.hand', 'import is staged until Save');
  await page.locator('.preferences-footer').getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await owner('H'), 'tool.hand', 'Cancel preserves active bindings');
  await open(); await importPreset();
  await page.locator('.preferences-footer').getByRole('button', { name: 'Save', exact: true }).click();
  assert.equal(await owner('H'), 'tool.highlight');
  for (const [key, tool] of [['h', 'highlight'], ['Shift+V', 'hand'], ['r', 'box'], ['Alt+Shift+L', 'measureDistance']]) {
    await page.keyboard.press(key);
    assert.equal(await currentTool(), tool, key);
  }
  await page.evaluate(() => { const input = document.createElement('input'); input.id = 'typing-fixture'; document.body.append(input); input.focus(); });
  await page.keyboard.press('h');
  assert.equal(await page.locator('#typing-fixture').inputValue(), 'h');
  assert.equal(await currentTool(), 'measureDistance', 'typing does not change tools');
  await page.locator('#typing-fixture').evaluate(el => el.remove());
  await open(); await page.keyboard.press('h');
  assert.equal(await currentTool(), 'measureDistance', 'modal suppresses tool shortcuts');
  await page.locator('.preferences-footer').getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-tab="view"]').waitFor({ timeout: 90000 });
  assert.equal(await owner('H'), 'tool.highlight', 'saved overrides survive reload');
  await open();
  await page.getByRole('button', { name: 'Reset all', exact: true }).click();
  await page.locator('.confirm-dialog-btn-yes').click();
  await page.locator('.preferences-footer').getByRole('button', { name: 'Save', exact: true }).click();
  assert.equal(await owner('H'), 'tool.hand', 'Reset All restores defaults');
  console.log('PASS real preset import, staged changes, Cancel, Save, tool dispatch, typing/modal guards, persistence and reset');
} finally { await browser.close(); }
