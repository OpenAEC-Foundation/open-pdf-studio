import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');

try {
  const page = browser.contexts()
    .flatMap(context => context.pages())
    .find(candidate => candidate.url().startsWith('http://localhost:3041'));
  assert.ok(page, 'Open PDF Studio dev page is not available on CDP port 9222');

  const result = await page.evaluate(async () => {
    const { state } = await import('/js/core/state.ts');
    const { handlePointerDown, handlePointerMove, handlePointerUp } =
      await import('/js/tools/tool-dispatcher.js');
    const { hideProperties } = await import('/js/ui/panels/properties-panel.js');
    const canvas = document.getElementById('annotation-canvas');
    const originalCanvasStyle = canvas.getAttribute('style');
    const originalState = {
      documents: state.documents,
      activeDocumentIndex: state.activeDocumentIndex,
      currentTool: state.currentTool,
      isDragging: state.isDragging,
      isResizing: state.isResizing,
      activeHandle: state.activeHandle,
      originalAnnotation: state.originalAnnotation,
      originalAnnotations: state.originalAnnotations,
      enableObjectSnap: state.preferences.enableObjectSnap,
    };
    const line = {
      id: 'undo-line-move', type: 'line', page: 1,
      startX: 20, startY: 20, endX: 120, endY: 20,
      lineWidth: 2, locked: false,
    };
    const doc = {
      id: 'undo-line-move-doc', pdfDoc: { numPages: 1 }, filePath: null,
      currentPage: 1, scale: 1, viewMode: 'single', annotations: [line],
      selectedAnnotation: line, selectedAnnotations: [line],
      undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
    };
    const pointer = (x, y, up = false) => ({
      clientX: x, clientY: y, button: 0, buttons: up ? 0 : 1,
      target: canvas, detail: 1,
      shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
      preventDefault() {}, stopPropagation() {},
    });

    try {
      canvas.style.cssText =
        'position:fixed;left:0;top:0;width:600px;height:600px;display:block;z-index:9999';
      state.documents = [doc];
      state.activeDocumentIndex = 0;
      state.currentTool = 'select';
      state.isDragging = false;
      state.isResizing = false;
      state.activeHandle = null;
      state.originalAnnotation = null;
      state.originalAnnotations = [];
      state.preferences.enableObjectSnap = false;

      handlePointerDown(pointer(45, 20));
      handlePointerMove(pointer(95, 90));
      handlePointerUp(pointer(95, 90, true));
      const afterMove = {
        startX: line.startX,
        startY: line.startY,
        undoLength: doc.undoStack.length,
        undoType: doc.undoStack[0]?.type,
      };

      // Caps Lock and some keyboard layouts report an uppercase key value
      // even though Shift is not pressed. This is still a normal Ctrl+Z.
      const undoEvent = new KeyboardEvent('keydown', {
        key: 'Z', code: 'KeyZ', ctrlKey: true,
        bubbles: true, cancelable: true,
      });
      document.dispatchEvent(undoEvent);
      await new Promise(resolve => setTimeout(resolve, 100));

      return {
        afterMove,
        afterUndo: {
          startX: line.startX,
          startY: line.startY,
          endX: line.endX,
          endY: line.endY,
          undoLength: doc.undoStack.length,
          redoLength: doc.redoStack.length,
          prevented: undoEvent.defaultPrevented,
        },
      };
    } finally {
      if (originalCanvasStyle == null) canvas.removeAttribute('style');
      else canvas.setAttribute('style', originalCanvasStyle);
      state.documents = originalState.documents;
      state.activeDocumentIndex = originalState.activeDocumentIndex;
      state.currentTool = originalState.currentTool;
      state.isDragging = originalState.isDragging;
      state.isResizing = originalState.isResizing;
      state.activeHandle = originalState.activeHandle;
      state.originalAnnotation = originalState.originalAnnotation;
      state.originalAnnotations = originalState.originalAnnotations;
      state.preferences.enableObjectSnap = originalState.enableObjectSnap;
      hideProperties();
    }
  });

  assert.deepEqual(result.afterMove, {
    startX: 70,
    startY: 90,
    undoLength: 1,
    undoType: 'modifyAnnotation',
  });
  assert.deepEqual(result.afterUndo, {
    startX: 20,
    startY: 20,
    endX: 120,
    endY: 20,
    undoLength: 0,
    redoLength: 1,
    prevented: true,
  });

  console.log('annotation move undo test passed');
} finally {
  await browser.close();
}
