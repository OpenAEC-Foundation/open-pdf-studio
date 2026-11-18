// Dragging on a number field in the real app (Chromium), issue #1168:
// dragging the label or the unfocused field of Font Size changes the
// annotation live, the whole drag is one undo step, Escape restores the
// starting value, and a plain click still focuses the field for typing.
//   node scripts/test-drag-number-browser.mjs
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const cache = await mkdtemp(path.join(tmpdir(), 'opds-drag-number-'));
const server = await createServer({ root, cacheDir: cache, logLevel: 'error', server: { host: '127.0.0.1', port: 18364, strictPort: false, hmr: false } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { timeout: 120000 });
  await page.waitForSelector('#tool-select', { timeout: 120000 });

  await page.evaluate(async () => {
    const { createBlankPDF } = await import('/js/pdf/loader.js');
    await createBlankPDF(595, 842, 1);
    const { createAnnotation } = await import('/js/annotations/factory.js');
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { showProperties } = await import('/js/ui/panels/properties-panel.js');
    const undo = await import('/js/core/undo-manager.js');
    const i18next = (await import('/js/i18n/config.js')).default;
    const doc = getActiveDocument();
    doc.annotations.push(createAnnotation({ type: 'textbox', page: 1, x: 60, y: 60,
      width: 260, height: 80, text: 'Drag my size', fontFamily: 'Arial', fontSize: 16,
      textColor: '#000000', color: '#000000', lineWidth: 1 }));
    doc.selectedAnnotations = [doc.annotations[0]];
    showProperties(doc.annotations[0]);
    window.dn = { getActiveDocument, undo, i18next };
  });
  await page.waitForSelector('#properties-panel[data-getal-sleep] input[data-getal]', { timeout: 15000 });

  // The Font Size group: its label and its field.
  await page.evaluate(() => {
    const naam = window.dn.i18next.t('properties:textFormat.fontSize');
    const groep = [...document.querySelectorAll('#properties-panel .property-group')]
      .find((g) => g.querySelector('label')?.textContent.trim() === naam);
    groep.querySelector('label').id = 'dn-label';
    groep.querySelector('input[data-getal]').id = 'dn-veld';
    groep.scrollIntoView({ block: 'center' });
  });
  const stand = () => page.evaluate(() => {
    const doc = window.dn.getActiveDocument();
    const veld = document.getElementById('dn-veld');
    return {
      grootte: doc.annotations[0].fontSize,
      veld: veld.value,
      undo: (doc.undoStack || []).length,
      redo: (doc.redoStack || []).length,
      focus: document.activeElement === veld,
      slepend: veld.hasAttribute('data-getal-slepend'),
      cursor: getComputedStyle(document.getElementById('dn-label')).cursor,
    };
  });
  const midden = async (id) => {
    const r = await page.locator(`#${id}`).boundingBox();
    return { x: Math.round(r.x + Math.min(r.width / 2, 20)), y: Math.round(r.y + r.height / 2) };
  };
  const wacht = (grootte) => page.waitForFunction((g) => window.dn.getActiveDocument().annotations[0].fontSize === g, grootte, { timeout: 10000 });
  const rust = () => page.waitForTimeout(150);

  let voor = await stand();
  assert.equal(voor.grootte, 16);
  assert.equal(voor.veld, '16');

  // The label says it can be dragged; the pointer stays the default arrow.
  const label = await midden('dn-label');
  await page.mouse.move(label.x, label.y);
  assert.equal(await page.getAttribute('#dn-label', 'title'), await page.evaluate(() => window.dn.i18next.t('common:dragToChange')));
  assert.ok(['default', 'auto'].includes(voor.cursor), `label cursor ${voor.cursor}`);

  // 1. Drag the label to the right: live change, one undo step.
  await page.mouse.down();
  await page.mouse.move(label.x + 3, label.y);
  assert.equal((await stand()).grootte, 16, 'below the threshold nothing changes');
  await page.mouse.move(label.x + 20, label.y, { steps: 4 });
  let tijdens = await stand();
  assert.equal(tijdens.grootte, 26, 'the annotation follows while dragging (2 px per step)');
  assert.equal(tijdens.veld, '26');
  assert.equal(tijdens.slepend, true);
  // A pause longer than the property debounce must not split the step.
  await page.waitForTimeout(600);
  await page.mouse.move(label.x + 40, label.y + 30, { steps: 4 });
  assert.equal((await stand()).grootte, 36, 'the axis is fixed: moving down does not count');
  await page.mouse.up(); await rust();
  let na = await stand();
  assert.equal(na.grootte, 36);
  assert.equal(na.undo, voor.undo + 1, 'the whole drag is one undo step');
  assert.equal(na.slepend, false);
  assert.equal(na.focus, false, 'a drag does not focus the field');
  await page.evaluate(() => window.dn.undo.undo());
  await wacht(16); await rust();
  na = await stand();
  assert.equal(na.veld, '16', 'one undo restores the value in the panel');
  assert.equal(na.undo, voor.undo);
  console.log('PASS label drag: live update, one undo step, one undo restores');

  // 2. Shift is ten times faster; dragging up is more.
  await page.evaluate(() => window.dn.undo.redo());
  await wacht(36);
  await page.evaluate(() => window.dn.undo.undo());
  await wacht(16); await rust();
  await page.mouse.move(label.x, label.y);
  await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.move(label.x, label.y - 8, { steps: 4 });
  await page.keyboard.up('Shift');
  await page.mouse.up(); await rust();
  assert.equal((await stand()).grootte, 56, 'Shift: 4 steps of 10 upwards');
  await page.evaluate(() => window.dn.undo.undo());
  await wacht(16); await rust();
  console.log('PASS vertical drag with Shift');

  // 3. Drag on the unfocused field itself, then Escape: everything is back.
  voor = await stand();
  const veld = await midden('dn-veld');
  await page.mouse.move(veld.x, veld.y);
  await page.mouse.down();
  await page.mouse.move(veld.x + 30, veld.y, { steps: 5 });
  tijdens = await stand();
  assert.equal(tijdens.grootte, 31, 'dragging the field changes the annotation');
  assert.equal(tijdens.focus, false, 'the field is not focused while dragging');
  await page.keyboard.press('Escape');
  await wacht(16); await rust();
  await page.mouse.move(veld.x + 60, veld.y, { steps: 3 });
  await page.mouse.up(); await rust();
  na = await stand();
  assert.equal(na.grootte, 16, 'Escape restores the starting value');
  assert.equal(na.veld, '16');
  assert.equal(na.undo, voor.undo, 'a cancelled drag leaves no undo step');
  assert.equal(na.redo, voor.redo, 'a cancelled drag keeps the redo history');
  assert.equal(na.focus, false);
  console.log('PASS field drag and Escape');

  // 4. A plain click focuses the field for typing.
  await page.mouse.move(veld.x, veld.y);
  await page.mouse.click(veld.x, veld.y); await rust();
  na = await stand();
  assert.equal(na.focus, true, 'a plain click focuses the field');
  assert.equal(na.grootte, 16);
  await page.keyboard.type('24');
  await page.keyboard.press('Enter');
  await wacht(24); await rust();
  assert.equal((await stand()).veld, '24', 'typing after the click replaces the value');

  // 5. In a focused field dragging selects text; the value stays.
  await page.mouse.click(veld.x, veld.y); await rust();
  assert.equal((await stand()).focus, true);
  await page.mouse.move(veld.x - 10, veld.y);
  await page.mouse.down();
  await page.mouse.move(veld.x + 30, veld.y, { steps: 4 });
  await page.mouse.up(); await rust();
  na = await stand();
  assert.equal(na.grootte, 24, 'dragging inside a focused field does not change the value');
  assert.equal(na.focus, true);
  await page.evaluate(() => document.activeElement?.blur());
  console.log('PASS plain click focuses for typing; a focused field keeps text selection');

  assert.deepEqual(errors, []);
  console.log('PASS no browser errors');
} finally { await browser?.close(); await server.close(); await rm(cache, { recursive: true, force: true }); }
