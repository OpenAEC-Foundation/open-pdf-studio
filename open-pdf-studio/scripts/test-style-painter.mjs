// Geïsoleerde app: echte sneltoets, pointerdispatcher, stijlopmaak en undo.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
const cache = await mkdtemp('/tmp/opds-style-painter-test-');
const server = await createServer({ root: process.cwd(), cacheDir: cache, logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false } });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  await page.route('**/*', r => new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort());
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`, { timeout: 90000 });
  await page.waitForSelector('#tool-select');
  const results = await page.evaluate(async () => {
    const { state } = await import('/js/core/state.ts');
    const { handlePointerMove, handlePointerDown } = await import('/js/tools/tool-dispatcher.js');
    const { setTool } = await import('/js/tools/manager.js');
    const { undo, redo } = await import('/js/core/undo-manager.js');
    const { sneltoetsen, voerSneltoetsUit } = await import('/js/core/keybindings/app-shortcuts.js');
    const canvas = document.getElementById('annotation-canvas');
    canvas.width = 800; canvas.height = 700;
    canvas.style.cssText = 'position:fixed;left:0;top:0;width:800px;height:700px;display:block;z-index:9999';
    canvas.classList.add('annotation-canvas');
    const wait = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const pointer = (x, y, extra = {}) => ({ clientX: x, clientY: y, target: canvas, button: 0, buttons: 0, pointerType: 'mouse', detail: 1, preventDefault() {}, stopPropagation() {}, ...extra });
    const hover = async (x, y, extra) => { handlePointerMove(pointer(x, y, extra)); await wait(); };
    const key = (key, code, extra = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true, ...extra }));
    const result = [];
    for (const mode of ['single', 'continuous', 'locked', 'hidden', 'readonly', 'escape', 'right', 'tool', 'document', 'text', 'navigation']) {
      setTool('select');
      const source = { id: 'source', type: 'box', page: 1, x: 20, y: 20, width: 80, height: 40, color: '#ff0000', strokeColor: '#ff0000', fillColor: '#ffff00', opacity: 0.6, lineWidth: 5, borderStyle: 'dash' };
      const target = { ...source, id: 'target', page: mode === 'continuous' ? 2 : 1, x: 200, color: '#000000', strokeColor: '#000000', fillColor: '#ffffff', opacity: 1, lineWidth: 1, borderStyle: 'solid' };
      const second = { ...target, id: 'second', x: 400 };
      if (mode === 'locked') target.locked = true;
      if (mode === 'hidden') target.hidden = true;
      if (mode === 'text') {
        Object.assign(source, { type: 'textbox', text: 'Source text', fontSize: 18, fontFamily: 'Helvetica', fontBold: true, textColor: '#008800' });
        Object.assign(target, { type: 'textbox', text: 'Keep my words', fontSize: 12, fontFamily: 'Helvetica', fontBold: false, textColor: '#000000' });
      }
      state.documents = [{ id: `painter-${mode}`, pdfDoc: { numPages: 2 }, filePath: null, currentPage: 1, scale: 1, viewMode: mode === 'continuous' ? 'continuous' : 'single', annotations: [source, target, second], selectedAnnotation: source, selectedAnnotations: [source], undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false }];
      state.activeDocumentIndex = 0; state.isEditingText = false; state.pdfTextEditState = null; state.modalDialogOpen = false;
      canvas.dataset.page = mode === 'continuous' ? '2' : '1';
      const doc = state.documents[0];
      sneltoetsen.setOverrides({ 'edit.stylePainter': ['Ctrl+Alt+P'] });
      key('p', 'KeyP', { ctrlKey: true, altKey: true }); await wait();
      const started = state.currentTool;
      if (mode === 'readonly') doc.pdfaCompliance = 'PDF/A-1b';
      if (mode === 'escape') { key('Escape', 'Escape'); await wait(); }
      if (mode === 'right') handlePointerDown(pointer(600, 100, { button: 2, buttons: 2 }));
      if (mode === 'tool') setTool('hand');
      if (mode === 'document') {
        state.documents.push({ ...doc, id: 'different', annotations: [{ ...target }], undoStack: [], redoStack: [] }); state.activeDocumentIndex = 1;
      }
      if (mode === 'single') doc.annotations[0].strokeColor = '#008800';
      await hover(220, 35, mode === 'navigation' ? { buttons: 4 } : {});
      await hover(220, 35, mode === 'navigation' ? { pointerType: 'touch' } : {});
      const a = doc.annotations.find(a => a.id === 'target');
      const painted = { stroke: a.strokeColor, width: a.lineWidth, fill: a.fillColor, opacity: a.opacity, border: a.borderStyle, text: a.text, fontSize: a.fontSize, fontBold: a.fontBold, textColor: a.textColor, x: a.x, undo: doc.undoStack.length };
      const afterTool = state.currentTool;
      if (mode === 'single' || mode === 'continuous') {
        await hover(420, 35); const steps = doc.undoStack.length;
        await undo(); const firstUndo = doc.annotations.find(a => a.id === 'second').strokeColor;
        await undo(); const secondUndo = doc.annotations.find(a => a.id === 'target').strokeColor;
        await redo(); const redoStroke = doc.annotations.find(a => a.id === 'target').strokeColor;
        result.push({ mode, started, painted, afterTool, steps, firstUndo, secondUndo, redoStroke, sourceStroke: doc.annotations[0].strokeColor });
      } else result.push({ mode, started, painted, afterTool, otherUndo: state.documents[1]?.undoStack.length || 0 });
    }
    setTool('select'); const doc = state.documents[state.activeDocumentIndex];
    doc.selectedAnnotations = []; doc.selectedAnnotation = null;
    await voerSneltoetsUit('edit.stylePainter'); result.push({ mode: 'empty', afterTool: state.currentTool });
    return result;
  });
  console.log(JSON.stringify(results, null, 2));
  for (const r of results) {
    if (r.mode === 'empty') { assert.equal(r.afterTool, 'select'); continue; }
    assert.equal(r.started, 'stylePainter', `${r.mode}: one shortcut`);
    const paints = ['single', 'continuous', 'text'].includes(r.mode);
    assert.equal(r.painted.stroke, paints ? '#ff0000' : '#000000', r.mode);
    assert.equal(r.painted.undo, paints ? 1 : 0, `${r.mode}: history`); assert.equal(r.painted.x, 200);
    if (paints) {
      assert.equal(r.painted.width, 5); assert.equal(r.painted.fill, '#ffff00');
      assert.equal(r.painted.opacity, 0.6); assert.equal(r.painted.border, 'dash');
    }
    if (r.mode === 'text') {
      assert.equal(r.painted.text, 'Keep my words'); assert.equal(r.painted.fontSize, 18);
      assert.equal(r.painted.fontBold, true); assert.equal(r.painted.textColor, '#008800');
    }
    if (r.steps) {
      assert.equal(r.steps, 2); assert.equal(r.firstUndo, '#000000'); assert.equal(r.secondUndo, '#000000'); assert.equal(r.redoStroke, '#ff0000');
      assert.equal(r.sourceStroke, r.mode === 'single' ? '#008800' : '#ff0000');
    }
    if (r.mode === 'document') assert.equal(r.otherUndo, 0);
    if (['readonly', 'escape', 'right', 'document'].includes(r.mode)) assert.equal(r.afterTool, 'select', r.mode);
  }
  console.log('12 style-painter browser scenarios passed');
} finally { await browser?.close(); await server.close(); await rm(cache, { recursive: true, force: true }); }
