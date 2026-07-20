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
    const { tagWhitespaceSpans } = await import('/js/text/text-layer.js');
    const { hideProperties, showProperties } = await import('/js/ui/panels/properties-panel.js');
    const originalDocuments = state.documents;
    const originalActiveDocumentIndex = state.activeDocumentIndex;
    const textLayer = document.createElement('div');
    textLayer.className = 'textLayer';
    const zeroWidthSpan = document.createElement('span');
    zeroWidthSpan.textContent = '\u200b\u2060';
    const visibleSpan = document.createElement('span');
    visibleSpan.textContent = 'Zichtbaar';
    textLayer.append(zeroWidthSpan, visibleSpan);
    document.body.appendChild(textLayer);

    const line = {
      id: 'ghost-selection-line', type: 'line', page: 1,
      startX: 10, startY: 10, endX: 100, endY: 10, lineWidth: 2,
    };

    try {
      state.documents = [{
        id: 'ghost-selection-test', pdfDoc: { numPages: 1 }, currentPage: 1,
        scale: 1, viewMode: 'single', annotations: [line],
        selectedAnnotation: line, selectedAnnotations: [line],
        undoStack: [], redoStack: [],
      }];
      state.activeDocumentIndex = 0;

      tagWhitespaceSpans(textLayer);
      const range = document.createRange();
      range.selectNodeContents(zeroWidthSpan);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);

      showProperties(line);

      return {
        zeroWidthTaggedAsWhitespace: zeroWidthSpan.dataset.ws === '1',
        visibleTextTaggedAsWhitespace: visibleSpan.dataset.ws === '1',
        nativeSelectionCleared: selection.rangeCount === 0 || selection.isCollapsed,
      };
    } finally {
      window.getSelection()?.removeAllRanges();
      textLayer.remove();
      state.documents = originalDocuments;
      state.activeDocumentIndex = originalActiveDocumentIndex;
      const restoredDoc = state.documents[state.activeDocumentIndex];
      if (restoredDoc?.selectedAnnotations?.length === 1) {
        showProperties(restoredDoc.selectedAnnotations[0]);
      } else {
        hideProperties();
      }
    }
  });

  assert.equal(
    result.zeroWidthTaggedAsWhitespace,
    true,
    'Visually empty PDF text spans must not receive a blue selection background',
  );
  assert.equal(result.visibleTextTaggedAsWhitespace, false);
  assert.equal(
    result.nativeSelectionCleared,
    true,
    'Selecting an annotation must clear a stale native PDF text selection',
  );

  console.log('ghost text selection test passed');
} finally {
  await browser.close();
}
