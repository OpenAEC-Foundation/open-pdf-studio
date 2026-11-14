import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const cache = await mkdtemp(path.join(tmpdir(), 'opds-style-shortcuts-'));
const server = await createServer({ root, cacheDir: cache, logLevel: 'error', server: { host: '127.0.0.1', port: 18382, strictPort: false, hmr: false } });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1433, height: 1000 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { timeout: 120000 });
  await page.waitForSelector('#tool-select', { timeout: 120000 });
  await page.evaluate(async () => {
    const state = await import('/js/core/state.ts');
    const factory = await import('/js/annotations/factory.js');
    const keys = await import('/js/core/keybindings/app-shortcuts.js');
    const styles = await import('/js/solid/stores/stylePresetsStore.js');
    const loader = await import('/js/pdf/loader.js');
    window.styleTest = { ...state, ...factory, keys, styles, loader };
    state.state.preferences.keyboardShortcuts = { 'edit.copyStyle': ['C C'], 'edit.pasteStyle': ['Ctrl+Alt+V'], 'edit.setDefaultStyle': ['Ctrl+Alt+D'] };
    keys.pasSneltoetsVoorkeurToe(state.state.preferences.keyboardShortcuts);
    await loader.createBlankPDF(595, 842, 2);
    const doc = state.getActiveDocument();
    const source = factory.createAnnotation({ type: 'textbox', page: 1, x: 20, y: 25, width: 190, height: 60,
      text: 'Source only', fontFamily: 'Courier New', fontSize: 18, fontBold: true, fontItalic: false,
      textColor: '#008000', strokeColor: '#ff0000', color: '#ff0000', fillColor: '#ffeeaa', opacity: 0.7, lineWidth: 3, borderStyle: 'dashed' });
    doc.annotations = [source]; doc.selectedAnnotations = [source]; doc.selectedAnnotation = source;
    window.styleTest.sourceDoc = doc; document.activeElement?.blur();
  });
  await page.keyboard.press('c'); await page.keyboard.press('c');
  await page.waitForFunction(() => window.styleTest.styles.copiedStyle()?.fontFamily === 'Courier New');
  // Copy with no selection must keep the previous clipboard.
  await page.evaluate(() => { const d = window.styleTest.getActiveDocument(); d.selectedAnnotations = []; d.selectedAnnotation = null; });
  await page.keyboard.press('c'); await page.keyboard.press('c');
  assert.equal(await page.evaluate(() => window.styleTest.styles.copiedStyle().fontFamily), 'Courier New');
  await page.evaluate(async () => {
    const t = window.styleTest; await t.loader.createBlankPDF(595, 842, 2);
    const d = t.getActiveDocument();
    const make = (type, page, locked = false) => t.createAnnotation({ type, page, x: 40, y: 60, width: 180, height: 50,
      ...(type === 'textbox' ? { text: 'Keep my text', textRuns: [[{ text: 'Keep my text', bold: false, italic: true }]], fontFamily: 'Arial', fontSize: 12, fontBold: false, fontItalic: true, textColor: '#000000' } : {}),
      author: 'Recipient', strokeColor: '#0000ff', color: '#0000ff', lineWidth: 1, opacity: 1, locked });
    d.annotations = [make('textbox', 1), make('box', 1), make('cloud', 2), make('textbox', 2, true)];
    d.selectedAnnotations = [...d.annotations]; d.selectedAnnotation = d.annotations[0]; d.undoStack = []; d.redoStack = [];
    t.before = JSON.parse(JSON.stringify(d.annotations)); document.activeElement?.blur();
  });
  await page.keyboard.press('Control+Alt+v');
  await page.waitForFunction(() => window.styleTest.getActiveDocument().annotations[0].fontFamily === 'Courier New');
  const result = await page.evaluate(() => {
    const t = window.styleTest, d = t.getActiveDocument();
    return { after: JSON.parse(JSON.stringify(d.annotations)), before: t.before, undo: d.undoStack.length, otherDocument: t.sourceDoc !== d };
  });
  assert.equal(result.otherDocument, true); assert.equal(result.undo, 1);
  for (let i = 0; i < 3; i++) {
    assert.equal(result.after[i].lineWidth, 3); assert.equal(result.after[i].strokeColor, '#ff0000');
    for (const key of ['id','type','page','x','y','width','height','text','author']) assert.deepEqual(result.after[i][key], result.before[i][key]);
  }
  assert.equal(result.after[0].fontSize, 18); assert.equal(result.after[0].textRuns[0][0].bold, true);
  assert.equal(result.after[1].fontFamily, undefined); assert.equal(result.after[2].fontFamily, undefined);
  assert.deepEqual(result.after[3], result.before[3]);
  await page.keyboard.press('Control+z');
  await page.waitForFunction(() => window.styleTest.getActiveDocument().annotations[0].fontFamily === 'Arial');
  assert.deepEqual(await page.evaluate(() => window.styleTest.getActiveDocument().annotations.map(a => a.lineWidth)), [1,1,1,1]);
  // Clipboard survives undo and may be pasted repeatedly.
  await page.evaluate(() => { const d = window.styleTest.getActiveDocument(); d.selectedAnnotations = d.annotations.slice(0,3); d.selectedAnnotation = d.annotations[0]; });
  await page.keyboard.press('Control+Alt+v');
  await page.waitForFunction(() => window.styleTest.getActiveDocument().annotations[0].fontFamily === 'Courier New');
  await page.evaluate(() => { const d = window.styleTest.getActiveDocument(); d.selectedAnnotations = [d.annotations[0]]; d.selectedAnnotation = d.annotations[0]; });
  await page.keyboard.press('Control+Alt+d');
  await page.waitForFunction(() => window.styleTest.state.preferences.textboxFontFamily === 'Courier New');
  assert.equal(await page.evaluate(async () => (await import('/js/tools/annotation-creators.js')).buildAnnotationProps('textbox', 10, 10, 200, 100).fontFamily), 'Courier New');
  // Typing, including a modifier combination, must never paste onto the selection.
  await page.evaluate(() => { const input = document.createElement('input'); input.id = 'style-typing'; document.body.append(input); input.focus(); });
  const undoBefore = await page.evaluate(() => window.styleTest.getActiveDocument().undoStack.length);
  await page.keyboard.press('Control+Alt+v'); await page.keyboard.type('cc');
  assert.equal(await page.evaluate(() => window.styleTest.getActiveDocument().undoStack.length), undoBefore);
  // No-selection paste uses the existing tool-defaults panel route.
  await page.evaluate(async () => {
    document.querySelector('#style-typing').remove();
    const d = window.styleTest.getActiveDocument(); d.selectedAnnotations = []; d.selectedAnnotation = null;
    window.styleTest.state.preferences.textboxFontFamily = 'Arial';
    window.styleTest.properties = await import('/js/solid/stores/propertiesStore.js');
    (await import('/js/tools/manager.js')).setTool('textbox'); document.activeElement?.blur();
  });
  await page.waitForFunction(() => window.styleTest.properties.annotProps.id === '__tool-defaults__');
  await page.keyboard.press('Control+Alt+v');
  await page.waitForFunction(() => window.styleTest.state.preferences.textboxFontFamily === 'Courier New');
  // Missing text flags represent a plain source; they clear styled recipients.
  await page.evaluate(() => {
    const t = window.styleTest, d = t.getActiveDocument();
    const source = t.createAnnotation({ type: 'textbox', page: 1, x: 10, y: 10, width: 80, height: 30, text: 'Plain', fontFamily: 'Arial', fontSize: 12 });
    d.annotations = [source]; d.selectedAnnotations = [source]; d.selectedAnnotation = source;
  });
  await page.keyboard.press('c'); await page.keyboard.press('c');
  await page.waitForFunction(() => window.styleTest.styles.copiedStyle()?.fontFamily === 'Arial');
  assert.equal(await page.evaluate(() => window.styleTest.styles.copiedStyle().fontBold), false);
  // Line endings use the same shared clipboard but never transfer geometry.
  await page.evaluate(() => {
    const t = window.styleTest, d = t.getActiveDocument();
    const arrow = t.createAnnotation({ type: 'line', page: 1, x: 10, y: 10, width: 100, height: 40, lineWidth: 4, startHead: 'circle', endHead: 'closed', headSize: 12 });
    d.annotations = [arrow]; d.selectedAnnotations = [arrow]; d.selectedAnnotation = arrow;
  });
  await page.keyboard.press('c'); await page.keyboard.press('c');
  await page.waitForFunction(() => window.styleTest.styles.copiedStyle()?.endHead === 'closed');
  await page.evaluate(() => {
    const t = window.styleTest, d = t.getActiveDocument();
    const line = t.createAnnotation({ type: 'line', page: 2, x: 40, y: 50, width: 120, height: 60, lineWidth: 1 });
    d.annotations = [line]; d.selectedAnnotations = [line]; d.selectedAnnotation = line;
  });
  await page.keyboard.press('Control+Alt+v');
  assert.deepEqual(await page.evaluate(() => { const a=window.styleTest.getActiveDocument().annotations[0]; return [a.startHead,a.endHead,a.headSize,a.x,a.y,a.width,a.height,a.fontFamily]; }), ['circle','closed',12,40,50,120,60,undefined]);
  assert.deepEqual(errors, []);
  console.log('PASS: real keyboard sequence/modifier; shared style clipboard; cross-document/page mixed selection; locked skip; one-step undo; repeat paste; default factory; text-input guard; tool defaults.');
} finally { await browser?.close(); await server.close(); await rm(cache, { recursive: true, force: true }); }
