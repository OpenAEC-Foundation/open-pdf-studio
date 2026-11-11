import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { PDFDocument, degrees } from 'pdf-lib';
const root = fileURLToPath(new URL('../', import.meta.url));
const cache = await mkdtemp(path.join(tmpdir(), 'opds-text-rotation-'));
const server = await createServer({ root, cacheDir: cache, logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false } });
let browser;
try {
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]).setRotation(degrees(270));
  const bytes = Array.from(await pdf.save());
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  await page.waitForSelector('#tool-select', { timeout: 120000 });
  await page.evaluate(async bytes => {
    const { createBlankPDF } = await import('/js/pdf/loader.js');
    await createBlankPDF(595, 842, 1, bytes);
    const { addTextAnnotation } = await import('/js/tools/text-editing.js');
    window.addTextDone = addTextAnnotation(200, 200, 1, document.querySelector('#annotation-canvas'));
  }, bytes);
  await page.locator('.text-annot-dialog textarea').fill('Rotation test\nSecond line');
  await page.locator('.text-annot-footer .pref-btn-primary').click();
  await page.evaluate(async () => {
    await window.addTextDone;
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { startTextEditEditing } = await import('/js/tools/text-edit-tool.js');
    const doc = getActiveDocument();
    window.rotationAnchor = [doc.textEdits[0].pdfX, doc.textEdits[0].pdfY];
    startTextEditEditing(doc.textEdits[0], 1, document.querySelector('#annotation-canvas'));
  });
  const input = page.locator('#prop-pdf-text-rotation');
  await input.waitFor({ timeout: 10000 });
  assert.equal(await input.inputValue(), '0');
  for (const angle of [90, 270, 37.5, -22.5]) {
    await input.fill(String(angle));
    await page.waitForFunction(async angle => {
      const { getActiveDocument } = await import('/js/core/state.ts');
      return getActiveDocument().textEdits[0].textAngle === angle;
    }, angle);
    const actual = await page.evaluate(async () => {
      const { getActiveDocument } = await import('/js/core/state.ts');
      const edit = getActiveDocument().textEdits[0];
      return { anchor: [edit.pdfX, edit.pdfY], originalAnchor: window.rotationAnchor,
        transform: document.querySelector('.pdf-text-editor').style.transform };
    });
    assert.deepEqual(actual.anchor, actual.originalAnchor);
    assert.equal(actual.transform, `rotate(${270 - angle}deg)`);
    const hit = await page.evaluate(async angle => {
      const { getActiveDocument } = await import('/js/core/state.ts');
      const { findTextEditAtPosition } = await import('/js/tools/text-edit-tool.js');
      const { applyPageRotation } = await import('/js/text/text-edit-appearance.js');
      const doc = getActiveDocument(), edit = doc.textEdits[0], dims = doc.pageDims[1];
      const rad = angle * Math.PI / 180;
      const dx = 30, dy = -8;
      const point = applyPageRotation(edit.pdfX + Math.cos(rad)*dx + Math.sin(rad)*dy,
        dims.heightPt-edit.pdfY-Math.sin(rad)*dx+Math.cos(rad)*dy,
        dims.widthPt,dims.heightPt,dims.rotation);
      const selected = findTextEditAtPosition(point.x,point.y,1,document.querySelector('#annotation-canvas'));
      const span = document.querySelector('span[data-synthetic]');
      return { selected: selected?.id===edit.id, transform: JSON.parse(span.dataset.pdfTransform) };
    }, angle);
    assert.ok(hit.selected, 'rotated text can be selected at its displayed position');
    const rad = angle*Math.PI/180;
    assert.ok(Math.abs(hit.transform[1]-Math.sin(rad)*16)<0.001);
    if (angle===37.5) await page.screenshot({path:'/tmp/opds-1026-angle.png'});
  }
  await page.locator('.pdf-text-editor').press('Control+Enter');
  await page.locator('.pdf-text-editor').waitFor({ state: 'detached' });
  const undoAngles = await page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { undo, redo } = await import('/js/core/undo-manager.js');
    await undo(); const before = getActiveDocument().textEdits[0].textAngle || 0;
    await redo(); return [before, getActiveDocument().textEdits[0].textAngle];
  });
  assert.deepEqual(undoAngles, [0, -22.5]);
  await page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { startTextEditEditing } = await import('/js/tools/text-edit-tool.js');
    startTextEditEditing(getActiveDocument().textEdits[0],1,document.querySelector('#annotation-canvas'));
  });
  assert.equal(await input.inputValue(), '-22.5');
  await input.fill('45');
  await page.waitForFunction(() => document.querySelector('.pdf-text-editor').style.transform==='rotate(225deg)');
  await page.locator('.pdf-text-editor').press('Escape');
  const cancelled = await page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    return getActiveDocument().textEdits[0].textAngle;
  });
  assert.equal(cancelled,-22.5,'Escape restores the committed rotation');

  console.log('PASS: Add Text, degree field, arbitrary angles, unchanged anchor, rotated page, undo/redo');
} finally {
  await browser?.close();
  await server.close();
  await rm(cache, { recursive: true, force: true });
}
