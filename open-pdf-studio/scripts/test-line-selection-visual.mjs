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
    const { drawSelectionHandles } = await import('/js/annotations/rendering/selection.js');
    const originalDocuments = state.documents;
    const originalActiveDocumentIndex = state.activeDocumentIndex;
    const line = {
      id: 'vertical-line-selection',
      type: 'line',
      page: 1,
      startX: 100,
      startY: 50,
      endX: 100,
      endY: 250,
      lineWidth: 2,
    };
    const strokeRects = [];
    const dashPatterns = [];
    const ctx = {
      save() {},
      restore() {},
      fillRect() {},
      strokeRect(...args) { strokeRects.push(args); },
      setLineDash(pattern) { dashPatterns.push([...pattern]); },
    };

    try {
      state.documents = [{
        id: 'line-selection-visual-test',
        pdfDoc: { numPages: 1 },
        currentPage: 1,
        scale: 1,
        viewMode: 'single',
        annotations: [line],
        selectedAnnotation: line,
        selectedAnnotations: [line],
        undoStack: [],
        redoStack: [],
      }];
      state.activeDocumentIndex = 0;
      drawSelectionHandles(ctx, line);
      return { strokeRects, dashPatterns };
    } finally {
      state.documents = originalDocuments;
      state.activeDocumentIndex = originalActiveDocumentIndex;
    }
  });

  const degenerateOutlines = result.strokeRects.filter(([, , width, height]) => width === 0 || height === 0);
  const visibleDashPatterns = result.dashPatterns.filter(pattern => pattern.length > 0);

  assert.deepEqual(
    degenerateOutlines,
    [],
    'A selected vertical line must not render a zero-width dashed selection rectangle',
  );
  assert.deepEqual(
    visibleDashPatterns,
    [],
    'Line selection must use its three grips instead of a dashed blue outline',
  );

  console.log('line selection visual test passed');
} finally {
  await browser.close();
}
