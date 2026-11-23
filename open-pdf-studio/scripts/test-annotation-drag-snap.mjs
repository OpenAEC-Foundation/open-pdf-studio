// Geïsoleerde browser: geen verbinding met een draaiende gebruikersapp.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
const cache = await mkdtemp('/tmp/opds-drag-snap-test-');
const server = await createServer({ root: process.cwd(), cacheDir: cache, logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  await page.route('**/*', r => new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort());
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.waitForSelector('#tool-select');
  const results = await page.evaluate(async () => {
    const { state } = await import('/js/core/state.ts');
    const { handlePointerDown, handlePointerMove, handlePointerUp } = await import('/js/tools/tool-dispatcher.js');
    const { getMoveInferenceOverlay } = await import('/js/tools/inference-overlay.js');
    const canvas = document.getElementById('annotation-canvas');
    canvas.width = 800; canvas.height = 700;
    canvas.style.cssText = 'position:fixed;left:0;top:0;width:800px;height:700px;display:block;z-index:9999';
    const output = [];
    for (const mode of ['point', 'off', 'shift', 'group', 'copy', 'tracking', 'continuous', 'image']) {
      const moving = { id: 'moving', type: 'line', page: 1, startX: 20, startY: 20, endX: 120, endY: 20, lineWidth: 2, color: '#000000' };
      const target = { ...moving, id: 'target', startX: 200, startY: 150, endX: 300, endY: 150 };
      if (mode === 'image') {
        Object.assign(moving, { type: 'image', x: 20, y: 20, width: 100, height: 40 });
        Object.assign(target, { type: 'image', x: 200, y: 150, width: 100, height: 40 });
      }
      const group = { ...moving, id: 'group', startY: 60, endY: 60 };
      const selection = mode === 'group' ? [moving, group] : [moving];
      const doc = {
        id: `drag-${mode}`, pdfDoc: { numPages: 1 }, filePath: null,
        currentPage: 1, scale: 1, viewMode: mode === 'continuous' ? 'continuous' : 'single',
        annotations: [...selection, target], selectedAnnotation: moving, selectedAnnotations: selection,
        undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
      };
      canvas.classList.add('annotation-canvas'); canvas.dataset.page = '1';
      state.documents = [doc]; state.activeDocumentIndex = 0; state.currentTool = 'select';
      state.isDragging = false; state.isResizing = false; state.activeHandle = null;
      state.originalAnnotation = null; state.originalAnnotations = []; state.modalDialogOpen = false;
      Object.assign(state.preferences, {
        enableObjectSnap: mode !== 'off', objectSnapRadius: 12, enableImageAlignSnap: mode === 'image',
        snapToEndpoints: true, snapToMidpoints: false, snapToCenters: false, snapToStartPoints: false,
        snapToPdfContent: false, snapToGrid: false, polarTrackingEnabled: false,
        moveInferenceTracking: mode === 'tracking', moveInferenceExtension: false, moveInferenceParallel: false,
      });
      const pointer = (x, y, up = false) => ({
        clientX: x, clientY: y, target: canvas, button: 0, buttons: up ? 0 : 1, detail: 1,
        shiftKey: mode === 'shift', ctrlKey: mode === 'copy', altKey: false, metaKey: false,
        preventDefault() {}, stopPropagation() {},
      });
      const grabY = mode === 'image' ? 35 : 20;
      handlePointerDown({ ...pointer(45, grabY), shiftKey: false });
      // Groepsselectie aanklikken behoudt alle geselecteerde lijnen.
      const dy = mode === 'group' ? 88 : mode === 'tracking' ? 230 : 128;
      handlePointerMove(pointer(122, grabY + dy));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const active = state.documents[0];
      const during = {
        positions: active.selectedAnnotations.map(a => a.type === 'image' ? [a.x, a.y, a.x + a.width, a.y + a.height] : [a.startX, a.startY, a.endX, a.endY]),
        indicator: state.lastSnapResult && { x: state.lastSnapResult.x, y: state.lastSnapResult.y },
        imageGuides: state._imageAlignGuides?.length || 0,
        guides: getMoveInferenceOverlay()?.lines.length || 0,
      };
      handlePointerUp(pointer(122, grabY + dy, true));
      const finished = { undo: active.undoStack.length, snap: state.lastSnapResult, overlay: getMoveInferenceOverlay() };
      const original = active.annotations.find(a => a.id === 'moving');
      const beforeUndo = mode === 'image' ? [original.x, original.y] : [original.startX, original.startY];
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }));
      await new Promise(resolve => setTimeout(resolve, 30));
      const restored = active.annotations.find(a => a.id === 'moving');
      const afterUndo = [mode === 'image' ? restored.x : restored.startX, mode === 'image' ? restored.y : restored.startY, active.annotations.length];
      output.push({ mode, during, finished, beforeUndo, afterUndo });
    }
    return output;
  });
  console.log(JSON.stringify(results, null, 2));
  for (const r of results) {
    const y = r.mode === 'group' ? 110 : r.mode === 'tracking' ? 250 : 150;
    const free = ['off', 'shift'].includes(r.mode);
    assert.deepEqual(r.during.positions[0], free ? [97, 148, 197, 148] : [100, y, 200, y + (r.mode === 'image' ? 40 : 0)], r.mode);
    if (r.mode === 'group') assert.deepEqual(r.during.positions[1], [100, 150, 200, 150]);
    if (r.mode === 'tracking') assert.ok(r.during.guides > 0);
    else if (r.mode === 'image') assert.ok(r.during.imageGuides > 0);
    else if (!free) assert.deepEqual(r.during.indicator, { x: 200, y: 150 });
    assert.equal(r.finished.undo, 1, `${r.mode}: één undo-stap`);
    assert.equal(r.finished.snap, null); assert.equal(r.finished.overlay, null);
    assert.deepEqual(r.afterUndo, [20, 20, r.mode === 'group' ? 3 : 2], `${r.mode}: undo`);
    if (r.mode === 'copy') assert.deepEqual(r.beforeUndo, [20, 20], 'Ctrl-sleep bewaart origineel');
  }
  console.log('8 browser drag-snap / group / copy / continuous / undo scenarios passed');
} finally {
  await browser?.close(); await server.close(); await rm(cache, { recursive: true, force: true });
}
