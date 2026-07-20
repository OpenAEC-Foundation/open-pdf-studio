import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const APP_URL = 'http://127.0.0.1:3041';

async function openPage(browser) {
  const page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
    deviceScaleFactor: 1,
  });
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  return page;
}

async function assertSelectAllStaysInEditor(page, selector, text, moveFocus = true) {
  await page.locator(selector).evaluate((editor, shouldMoveFocus) => {
    editor.setSelectionRange(1, Math.min(3, editor.value.length));
    if (shouldMoveFocus) {
      document.body.tabIndex = -1;
      document.body.focus();
    } else {
      editor.focus();
    }
  }, moveFocus);

  await page.keyboard.press('Control+A');

  const result = await page.evaluate((editorSelector) => {
    const editor = document.querySelector(editorSelector);
    const { state } = window.__textEditorTestModules;
    return {
      activeClass: document.activeElement?.className || '',
      selectionStart: editor.selectionStart,
      selectionEnd: editor.selectionEnd,
      selectedAnnotations: state.documents[0].selectedAnnotations.length,
    };
  }, selector);

  assert.match(result.activeClass, new RegExp(selector.slice(1)));
  assert.equal(result.selectionStart, 0);
  assert.equal(result.selectionEnd, text.length);
  assert.equal(result.selectedAnnotations, 0,
    'Ctrl+A in an active text editor must not select page annotations');
}

const browser = await chromium.launch({ headless: true });

try {
  // The vector renderer does not call PDF.js page.render(). Embedded font
  // metadata must therefore be resolved lazily before opening the editor.
  {
    const page = await openPage(browser);
    try {
      const sourceText = await page.evaluate(async () => {
        const pdfjs = await import('/@id/pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
        const bytes = new Uint8Array(await (
          await fetch('/pdfjs/web/compressed.tracemonkey-pldi-09.pdf')
        ).arrayBuffer());
        const pdfDoc = await pdfjs.getDocument({
          data: bytes,
          isEvalSupported: false,
          verbosity: 0,
        }).promise;
        const pdfPage = await pdfDoc.getPage(1);
        const viewport = pdfPage.getViewport({ scale: 1 });
        const { state } = await import('/js/core/state.ts');
        const { createTextLayer } = await import('/js/text/text-layer.js');
        const { activateEditTextTool } = await import('/js/tools/text-edit-tool.js');

        const host = document.createElement('div');
        Object.assign(host.style, {
          position: 'fixed',
          left: '0',
          top: '0',
          width: `${viewport.width}px`,
          height: `${viewport.height}px`,
          background: '#ffffff',
          zIndex: '5000',
        });
        const canvas = document.createElement('canvas');
        canvas.className = 'pdf-canvas';
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        host.append(canvas);
        document.body.append(host);

        const annotations = [
          { id: 'other-1', type: 'rectangle', page: 1, x: 5, y: 5, width: 10, height: 10 },
          { id: 'other-2', type: 'rectangle', page: 1, x: 25, y: 5, width: 10, height: 10 },
        ];
        state.documents = [{
          id: 'embedded-font-vector-test',
          filePath: 'embedded-font-vector-test.pdf',
          fileName: 'embedded-font-vector-test.pdf',
          currentPage: 1,
          scale: 1,
          viewMode: 'single',
          annotations,
          selectedAnnotations: [],
          textEdits: [],
          undoStack: [],
          redoStack: [],
          pdfDoc,
        }];
        state.activeDocumentIndex = 0;
        state.currentTool = 'editText';
        window.__textEditorTestModules = { state };

        const layer = await createTextLayer(pdfPage, viewport, host, 1);
        activateEditTextTool();
        const target = [...layer.querySelectorAll('span')]
          .find(span => span.textContent.includes('Trace-based'));
        if (!target) throw new Error('Embedded-font source span not found');
        target.click();
        return target.textContent;
      });

      await page.waitForSelector('.pdf-text-editor');
      const fontState = await page.evaluate(() => {
        const editor = document.querySelector('.pdf-text-editor');
        const source = [...document.querySelectorAll('.textLayer span')]
          .find(span => span.textContent.includes('Trace-based'));
        const fontSelect = document.querySelector('#prop-text-format-section select');
        return {
          actualFontName: source?.dataset.pdfActualFontName || '',
          loadedFontName: source?.dataset.pdfLoadedFontName || '',
          editorFontFamily: getComputedStyle(editor).fontFamily,
          displayedFont: fontSelect?.value || '',
        };
      });

      assert.ok(fontState.actualFontName,
        'Vector-mode text editing must resolve the original PDF font name');
      assert.match(fontState.loadedFontName, /^g_d\d+_f\d+$/,
        'Vector-mode text editing must retain the loaded PDF.js font face');
      assert.ok(fontState.editorFontFamily.includes(fontState.loadedFontName),
        `Editor must use embedded font ${fontState.loadedFontName}, got ${fontState.editorFontFamily}`);
      assert.doesNotMatch(fontState.displayedFont, /^g_d\d+_f\d+$/,
        'Properties must never show an internal PDF.js font identifier');

      await assertSelectAllStaysInEditor(page, '.pdf-text-editor', sourceText);
    } finally {
      await page.close();
    }
  }

  // Annotation text boxes use a separate inline editor. Ctrl+A must stay
  // scoped to it even after focus temporarily moves outside the textarea.
  {
    const page = await openPage(browser);
    try {
      const text = 'Alleen deze tekst selecteren';
      await page.evaluate(async ({ text }) => {
        const { state } = await import('/js/core/state.ts');
        const { startTextEditing } = await import('/js/tools/text-editing.js');
        const canvas = document.getElementById('annotation-canvas');
        Object.assign(canvas.style, {
          position: 'fixed',
          left: '0',
          top: '0',
          width: '1000px',
          height: '600px',
          display: 'block',
        });
        canvas.width = 1000;
        canvas.height = 600;

        const textbox = {
          id: 'textbox-select-all',
          type: 'textbox',
          page: 1,
          x: 100,
          y: 100,
          width: 320,
          height: 80,
          text,
          fontFamily: 'Arial',
          fontSize: 18,
          textColor: '#000000',
          fillColor: '#ffffff',
          strokeColor: '#000000',
          lineWidth: 1,
          locked: false,
        };
        const other = {
          id: 'other-annotation', type: 'rectangle', page: 1,
          x: 10, y: 10, width: 20, height: 20,
        };
        state.documents = [{
          id: 'textbox-select-all-document',
          currentPage: 1,
          scale: 1,
          viewMode: 'single',
          annotations: [textbox, other],
          selectedAnnotation: textbox,
          selectedAnnotations: [],
          undoStack: [],
          redoStack: [],
          pdfDoc: { numPages: 1 },
        }];
        state.activeDocumentIndex = 0;
        window.__textEditorTestModules = { state };
        startTextEditing(textbox);
      }, { text });

      await page.waitForSelector('.inline-text-editor');
      await assertSelectAllStaysInEditor(page, '.inline-text-editor', text, false);
    } finally {
      await page.close();
    }
  }

  console.log('Text editor embedded-font and Ctrl+A tests passed');
} finally {
  await browser.close();
}
