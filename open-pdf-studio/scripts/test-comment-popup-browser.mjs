import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { PDFDocument } from 'pdf-lib';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const cache = await mkdtemp(path.join(tmpdir(), 'opds-comment-popup-'));
const server = await createServer({ cacheDir: cache, server: { host: '127.0.0.1', port: 3199, strictPort: true, hmr: false } });
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(server.resolvedUrls.local[0], { timeout: 120000 });
  await page.waitForSelector('#document-tabs', { timeout: 120000 });
  const pdf = await PDFDocument.create(); pdf.addPage();
  await page.evaluate(async bytes => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const tab = createTab('/comment-popup.pdf');
    await loadPDF('/comment-popup.pdf', tab.index, new Uint8Array(bytes));
    await (await import('/js/core/state.ts')).getActiveDocument()._annotationCompletion;
  }, Array.from(await pdf.save()));
  async function openNote(id) {
    await page.evaluate(async id => {
      const { getActiveDocument, state } = await import('/js/core/state.ts');
      state.preferences.confirmBeforeDelete = false;
      const { openStickyPopup } = await import('/js/solid/stores/stickyNotePopupStore.js');
      const doc = getActiveDocument();
      doc.annotations.push({ id, type: 'comment', page: 1, x: 50, y: 50, width: 24, height: 24, color: '#FFFF00', text: 'original', author: 'Test' });
      const note = doc.annotations.at(-1);
      openStickyPopup(note);
      doc.selectedAnnotation = note; doc.selectedAnnotations = [note];
    }, id);
    await page.locator('.sticky-popup').last().waitFor();
  }
  await openNote('deleted');
  await page.locator('.sticky-popup textarea').fill('edited before deletion');
  // Use the document's Delete shortcut, not Delete inside the text editor.
  await page.locator('.sticky-popup textarea').evaluate(e => e.blur());
  await page.evaluate(async () => {
    const d=(await import('/js/core/state.ts')).getActiveDocument(); d.selectedAnnotations=[d.annotations[0]]; d.selectedAnnotation=d.annotations[0];
  });
  await page.keyboard.press('Delete');
  await page.waitForFunction(() => !document.querySelector('.sticky-popup'), { }, { timeout: 3000 });
  const deleted = await page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { getOpenPopups } = await import('/js/solid/stores/stickyNotePopupStore.js');
    const doc = getActiveDocument();
    return { count: doc.annotations.length, popups: getOpenPopups().length, undo: doc.undoStack.length };
  });
  assert.deepEqual(deleted, { count: 0, popups: 0, undo: 1 });
  await page.evaluate(async () => (await import('/js/core/undo-manager.js')).undo());
  assert.equal(await page.evaluate(async () => (await import('/js/core/state.ts')).getActiveDocument().annotations[0].text), 'edited before deletion');
  await page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    (await import('/js/solid/stores/stickyNotePopupStore.js')).openStickyPopup(getActiveDocument().annotations[0]);
  });
  await page.locator('.sticky-popup').waitFor();
  await page.evaluate(async () => (await import('/js/core/undo-manager.js')).redo());
  await page.waitForFunction(() => !document.querySelector('.sticky-popup'));
  await openNote('keep'); await openNote('remove');
  const deleteLabel = await page.evaluate(async () => {
    const doc = (await import('/js/core/state.ts')).getActiveDocument();
    (await import('/js/solid/stores/contextMenuStore.js')).showAnnotationMenu(400, 200, doc.annotations.find(a => a.id === 'remove'));
    return (await import('/js/i18n/config.js')).default.t('common:delete');
  });
  await page.locator('.context-menu-item').filter({ has: page.getByText(deleteLabel, { exact: true }) }).click();
  await page.waitForFunction(() => document.querySelectorAll('.sticky-popup').length === 1);
  assert.deepEqual(await page.evaluate(async () => (await import('/js/solid/stores/stickyNotePopupStore.js')).getOpenPopups().map(e => e.annotationId)), ['keep']);
  assert.deepEqual(errors, []);
  console.log('PASS: Delete, edited text/undo, reopened popup/redo, context-menu deletion preserves other popups');
} catch (e) { console.error(e); process.exitCode = 1; } finally {
  await browser.close(); await Promise.race([server.close(), new Promise(r => setTimeout(r, 2000))]); await rm(cache, { recursive: true, force: true });
}

process.exit(process.exitCode || 0);
