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
    const originalState = {
      documents: state.documents,
      activeDocumentIndex: state.activeDocumentIndex,
      clipboardAnnotation: state.clipboardAnnotation,
      clipboardAnnotations: state.clipboardAnnotations,
      pasteSequence: state._pasteSeq,
    };
    const line = {
      id: 'clipboard-line-source',
      type: 'line',
      page: 1,
      startX: 100,
      startY: 120,
      endX: 240,
      endY: 120,
      color: '#ff0000',
      strokeColor: '#ff0000',
      lineWidth: 2,
      opacity: 1,
      locked: false,
      printable: true,
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    };
    const doc = {
      id: 'clipboard-test-doc',
      pdfDoc: { numPages: 1 },
      currentPage: 1,
      scale: 1.5,
      viewMode: 'single',
      annotations: [line],
      selectedAnnotation: line,
      selectedAnnotations: [line],
      undoStack: [],
      redoStack: [],
      savedUndoStackLength: 0,
      modified: false,
      measureScale: 1,
      measureUnit: 'px',
    };

    state.documents = [doc];
    state.activeDocumentIndex = 0;
    state.clipboardAnnotation = null;
    state.clipboardAnnotations = [];

    const hadOwnClipboard = Object.prototype.hasOwnProperty.call(navigator, 'clipboard');
    const ownClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { read: () => new Promise(() => {}) },
    });

    try {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'c',
        code: 'KeyC',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }));

      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'v',
        code: 'KeyV',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }));

      await new Promise(resolve => setTimeout(resolve, 150));

      return {
        copiedType: state.clipboardAnnotation?.type,
        annotationCount: doc.annotations.length,
        pasted: doc.annotations.slice(1).map(annotation => ({
          type: annotation.type,
          startX: annotation.startX,
          startY: annotation.startY,
          endX: annotation.endX,
          endY: annotation.endY,
        })),
      };
    } finally {
      if (hadOwnClipboard && ownClipboard) {
        Object.defineProperty(navigator, 'clipboard', ownClipboard);
      } else {
        delete navigator.clipboard;
      }

      state.documents = originalState.documents;
      state.activeDocumentIndex = originalState.activeDocumentIndex;
      state.clipboardAnnotation = originalState.clipboardAnnotation;
      state.clipboardAnnotations = originalState.clipboardAnnotations;
      state._pasteSeq = originalState.pasteSequence;

      // The shortcut redraws the annotation canvas and properties panel. Restore
      // those visible side effects too so this regression test is safe to run
      // against the live development WebView.
      const restoredDoc = state.documents[state.activeDocumentIndex];
      const {
        hideProperties,
        showMultiSelectionProperties,
        showProperties,
      } = await import('/js/ui/panels/properties-panel.js');
      const restoredSelection = restoredDoc?.selectedAnnotations || [];
      if (restoredSelection.length > 1) {
        showMultiSelectionProperties();
        const { redrawAnnotations, redrawContinuous } = await import('/js/annotations/rendering.js');
        if (restoredDoc?.viewMode === 'continuous') redrawContinuous();
        else redrawAnnotations();
      } else if (restoredSelection.length === 1) {
        showProperties(restoredSelection[0]);
      } else {
        hideProperties();
      }
    }
  });

  assert.equal(result.copiedType, 'line', 'Ctrl+C must copy the selected line');
  assert.equal(result.annotationCount, 2, 'Ctrl+V must paste the internal line without waiting for native clipboard permission');
  assert.deepEqual(result.pasted, [{
    type: 'line',
    startX: 120,
    startY: 140,
    endX: 260,
    endY: 140,
  }]);

  console.log('line clipboard shortcut test passed');
} finally {
  await browser.close();
}
