import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import sharp from 'sharp';

async function darkPixelBounds(image) {
  const { data, info } = await sharp(image)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      if (data[offset] < 90 && data[offset + 1] < 90 && data[offset + 2] < 90) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  assert.ok(maxX >= 0 && maxY >= 0, 'Expected rendered PDF text pixels');
  return { minX, minY, maxX, maxY };
}

const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
    deviceScaleFactor: 1,
  });

  await page.goto('http://127.0.0.1:3041', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);

  const setup = await page.evaluate(async () => {
    const { state } = await import('/js/core/state.ts');
    const { viewport } = await import('/js/pdf/pdf-viewport.js');
    const canvas = document.getElementById('annotation-canvas');

    document.body.appendChild(canvas);
    for (const [property, value] of Object.entries({
      position: 'fixed',
      left: '50px',
      top: '50px',
      width: '1000px',
      height: '600px',
      display: 'block',
      'z-index': '900',
      transform: 'none',
      visibility: 'visible',
      opacity: '1',
      background: '#ffffff',
    })) {
      canvas.style.setProperty(property, value, 'important');
    }
    canvas.width = 1000;
    canvas.height = 600;
    viewport.active = false;

    const textEdit = {
      id: 'native-pdf-text-test',
      page: 1,
      originalText: 'Oude tekst',
      newText: 'PDF tekstregel',
      pdfX: 60,
      pdfY: 470,
      pdfWidth: 230,
      fontSize: 32,
      lineSpacing: 38.4,
      numOriginalLines: 1,
      fontFamily: 'Helvetica',
      color: '#000000',
    };

    state.documents = [{
      id: 'native-pdf-text-document',
      currentPage: 1,
      scale: 1,
      viewMode: 'single',
      annotations: [],
      selectedAnnotations: [],
      textEdits: [textEdit],
      undoStack: [],
      redoStack: [],
      pdfDoc: { numPages: 1 },
    }];
    state.activeDocumentIndex = 0;

    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#000000';
    context.font = '32px Helvetica, Arial, sans-serif';
    context.textBaseline = 'alphabetic';
    context.fillText(textEdit.newText, textEdit.pdfX, canvas.height - textEdit.pdfY);
    const canvasRect = canvas.getBoundingClientRect();
    return {
      clip: {
        x: canvasRect.x + 50,
        y: canvasRect.y + 80,
        width: 280,
        height: 90,
      },
    };
  });

  const renderedImage = await page.screenshot({ clip: setup.clip });

  await page.evaluate(async () => {
    const { state } = await import('/js/core/state.ts');
    const { startTextEditEditing } = await import('/js/tools/text-edit-tool.js');
    startTextEditEditing(
      state.documents[0].textEdits[0],
      1,
      document.getElementById('annotation-canvas'),
    );
  });
  await page.waitForSelector('.pdf-text-editor');
  await page.locator('.pdf-text-editor').evaluate(editor => editor.setSelectionRange(0, 0));

  const editorMetrics = await page.locator('.pdf-text-editor').evaluate((editor) => ({
    rect: editor.getBoundingClientRect().toJSON(),
    color: getComputedStyle(editor).color,
    font: getComputedStyle(editor).font,
    value: editor.value,
  }));
  const editImage = await page.screenshot({ clip: setup.clip });
  const rendered = await darkPixelBounds(renderedImage);
  let editing;
  try {
    editing = await darkPixelBounds(editImage);
  } catch (error) {
    throw new Error(`No editable text pixels; editor=${JSON.stringify(editorMetrics)}; clip=${JSON.stringify(setup.clip)}`, { cause: error });
  }
  assert.ok(Math.abs(editing.minX - rendered.minX) <= 1,
    `Native PDF text moved ${editing.minX - rendered.minX}px horizontally in edit mode`);
  assert.ok(Math.abs(editing.minY - rendered.minY) <= 1,
    `Native PDF text moved ${editing.minY - rendered.minY}px vertically in edit mode`);
  assert.ok(Math.abs((editing.maxX - editing.minX) - (rendered.maxX - rendered.minX)) <= 2,
    `Native PDF text width changed from ${rendered.maxX - rendered.minX}px to ${editing.maxX - editing.minX}px in edit mode`);
  assert.ok(Math.abs((editing.maxY - editing.minY) - (rendered.maxY - rendered.minY)) <= 2,
    `Native PDF text height changed from ${rendered.maxY - rendered.minY}px to ${editing.maxY - editing.minY}px in edit mode`);

  await page.evaluate(async () => {
    const { applyActiveTextEditStyle } = await import('/js/tools/text-edit-tool.js');
    applyActiveTextEditStyle('fontBold', true);
    applyActiveTextEditStyle('fontItalic', true);
    applyActiveTextEditStyle('fontUnderline', true);
    applyActiveTextEditStyle('fontStrikethrough', true);
    applyActiveTextEditStyle('textFontSize', 40);
  });

  const formatting = await page.locator('.pdf-text-editor').evaluate((editor) => ({
    weight: getComputedStyle(editor).fontWeight,
    style: getComputedStyle(editor).fontStyle,
    decoration: getComputedStyle(editor).textDecorationLine,
    fontSize: getComputedStyle(editor).fontSize,
  }));
  assert.ok(Number(formatting.weight) >= 600 || formatting.weight === 'bold');
  assert.equal(formatting.style, 'italic');
  assert.match(formatting.decoration, /underline/);
  assert.match(formatting.decoration, /line-through/);
  assert.equal(formatting.fontSize, '40px');

  const singleLineHeight = await page.locator('.pdf-text-editor').evaluate(editor => editor.getBoundingClientRect().height);
  await page.locator('.pdf-text-editor').press('Enter');
  await page.waitForTimeout(50);
  assert.equal(await page.locator('.pdf-text-editor').count(), 1,
    'Enter must insert a line break instead of closing a single-line PDF editor');
  assert.match(await page.locator('.pdf-text-editor').inputValue(), /\n/);
  const multiLineHeight = await page.locator('.pdf-text-editor').evaluate(editor => editor.getBoundingClientRect().height);
  assert.ok(multiLineHeight > singleLineHeight,
    `Editor height must grow after Enter (${singleLineHeight}px -> ${multiLineHeight}px)`);

  await page.locator('.pdf-text-editor').fill('Eerste regel\nTweede regel');
  await page.locator('.pdf-text-editor').press('Control+Enter');
  await page.waitForTimeout(50);
  assert.equal(await page.locator('.pdf-text-editor').count(), 0,
    'Ctrl+Enter must commit the PDF text edit');

  const saved = await page.evaluate(async () => {
    const { state } = await import('/js/core/state.ts');
    const { saveTextEditsToPages } = await import('/js/pdf/saver/text-edits.js');
    const record = state.documents[0].textEdits[0];
    const calls = { text: [], line: [] };
    const fakeFont = { widthOfTextAtSize: (value, size) => value.length * size * 0.5 };
    await saveTextEditsToPages(
      { embedFont: async () => fakeFont },
      [{
        drawRectangle: () => {},
        drawText: (value, options) => calls.text.push({ value, options }),
        drawLine: options => calls.line.push(options),
      }],
    );
    return {
      record: {
        newText: record.newText,
        fontFamily: record.fontFamily,
        fontSize: record.fontSize,
        fontUnderline: record.fontUnderline,
        fontStrikethrough: record.fontStrikethrough,
      },
      calls,
    };
  });

  assert.match(saved.record.newText, /\n/);
  assert.match(saved.record.fontFamily, /Bold/);
  assert.match(saved.record.fontFamily, /Oblique|Italic/);
  assert.equal(saved.record.fontSize, 40);
  assert.equal(saved.record.fontUnderline, true);
  assert.equal(saved.record.fontStrikethrough, true);
  assert.equal(saved.calls.text.length, 2);
  assert.equal(saved.calls.line.length, 4,
    'Each of the two lines must save both underline and strikethrough');

  const cancelRestoredRecord = await page.evaluate(async () => {
    const { state } = await import('/js/core/state.ts');
    const { startTextEditEditing, applyActiveTextEditStyle } = await import('/js/tools/text-edit-tool.js');
    const record = state.documents[0].textEdits[0];
    const before = JSON.stringify(record);
    startTextEditEditing(record, 1, document.getElementById('annotation-canvas'));
    applyActiveTextEditStyle('fontUnderline', false);
    applyActiveTextEditStyle('textColor', '#ff0000');
    applyActiveTextEditStyle('textFontSize', 12);
    document.querySelector('.pdf-text-editor').dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
    }));
    return before === JSON.stringify(record);
  });
  assert.equal(cancelRestoredRecord, true,
    'Escape must restore a textEdit record after live formatting changes');

  // Repeat the edit through the real PDF.js text-layer path (no pre-existing
  // textEdit record) to cover text that originates in the opened PDF itself.
  await page.evaluate(async () => {
    const { state } = await import('/js/core/state.ts');
    const { activateEditTextTool } = await import('/js/tools/text-edit-tool.js');
    document.querySelectorAll('.textLayer').forEach(layer => layer.remove());

    const canvas = document.getElementById('annotation-canvas');
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#000000';
    context.font = '32px Helvetica, Arial, sans-serif';
    context.textBaseline = 'alphabetic';
    context.fillText('PDF brontekst', 60, 130);

    const textLayer = document.createElement('div');
    textLayer.className = 'textLayer';
    textLayer.dataset.page = '1';
    Object.assign(textLayer.style, {
      position: 'fixed',
      left: '50px',
      top: '50px',
      width: '1000px',
      height: '600px',
      transform: 'none',
    });

    const metrics = context.measureText('Mg');
    const ascent = metrics.fontBoundingBoxAscent || metrics.actualBoundingBoxAscent;
    const descent = metrics.fontBoundingBoxDescent || metrics.actualBoundingBoxDescent;
    const baselineOffset = ascent + (32 - ascent - descent) / 2;
    const span = document.createElement('span');
    span.textContent = 'PDF brontekst';
    Object.assign(span.style, {
      position: 'absolute',
      left: '60px',
      top: `${130 - baselineOffset}px`,
      font: '32px / 32px Helvetica, Arial, sans-serif',
      transform: 'none',
      color: 'transparent',
    });
    span.dataset.pdfTransform = JSON.stringify([32, 0, 0, 32, 60, 470]);
    span.dataset.pdfWidth = '210';
    span.dataset.pdfFontFamily = 'sans-serif';
    span.dataset.pdfFontName = 'Helvetica';
    span.dataset.pdfActualFontName = 'Helvetica';
    span.dataset.pdfLoadedFontName = '';
    span.dataset.pdfBold = 'false';
    span.dataset.pdfItalic = 'false';
    textLayer.appendChild(span);
    document.body.appendChild(textLayer);

    state.documents = [{
      id: 'native-pdf-source-text-document',
      currentPage: 1,
      scale: 1,
      viewMode: 'single',
      annotations: [],
      selectedAnnotations: [],
      textEdits: [],
      undoStack: [],
      redoStack: [],
      pdfDoc: { numPages: 1 },
    }];
    state.activeDocumentIndex = 0;
    state.currentTool = 'editText';
    activateEditTextTool();
    span.click();
  });

  await page.waitForSelector('.pdf-text-editor');
  await page.locator('.pdf-text-editor').evaluate(editor => editor.setSelectionRange(0, 0));
  const sourceEditImage = await page.screenshot({ clip: setup.clip });
  const sourceEditing = await darkPixelBounds(sourceEditImage);
  assert.ok(Math.abs(sourceEditing.minX - rendered.minX) <= 1,
    `Original PDF text moved ${sourceEditing.minX - rendered.minX}px horizontally in edit mode`);
  assert.ok(Math.abs(sourceEditing.minY - rendered.minY) <= 1,
    `Original PDF text moved ${sourceEditing.minY - rendered.minY}px vertically in edit mode`);

  await page.evaluate(async () => {
    const { applyActiveTextEditStyle } = await import('/js/tools/text-edit-tool.js');
    applyActiveTextEditStyle('fontFamily', 'Times New Roman');
  });
  await page.locator('.pdf-text-editor').press('Control+Enter');
  const familyOnlyRecord = await page.evaluate(async () => {
    const { state } = await import('/js/core/state.ts');
    return state.documents[0].textEdits[0];
  });
  assert.equal(familyOnlyRecord.newText, 'PDF brontekst');
  assert.equal(familyOnlyRecord.fontFamily, 'TimesRoman',
    'A font-family-only edit must create and persist a PDF textEdit record');

  await page.evaluate(async () => {
    const { state } = await import('/js/core/state.ts');
    const { startTextEditEditing, applyActiveTextEditStyle } = await import('/js/tools/text-edit-tool.js');
    startTextEditEditing(
      state.documents[0].textEdits[0],
      1,
      document.getElementById('annotation-canvas'),
    );
    applyActiveTextEditStyle('fontBold', true);
    applyActiveTextEditStyle('fontUnderline', true);
  });
  await page.waitForSelector('.pdf-text-editor');
  await page.locator('.pdf-text-editor').fill('Bronregel een\nBronregel twee');
  await page.locator('.pdf-text-editor').press('Control+Enter');
  const sourceRecord = await page.evaluate(async () => {
    const { state } = await import('/js/core/state.ts');
    return state.documents[0].textEdits[0];
  });
  assert.equal(sourceRecord.newText, 'Bronregel een\nBronregel twee');
  assert.match(sourceRecord.fontFamily, /Bold/);
  assert.equal(sourceRecord.fontUnderline, true);

  // Vector viewport mode has an independent zoom and page offset. Reopening a
  // record must use that transform, not a stale document scale.
  const viewportSetup = await page.evaluate(async () => {
    const { state } = await import('/js/core/state.ts');
    const { viewport } = await import('/js/pdf/pdf-viewport.js');
    const canvas = document.getElementById('annotation-canvas');
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);

    const textEdit = {
      id: 'viewport-pdf-text-test',
      page: 1,
      originalText: 'Oude viewporttekst',
      newText: 'Viewporttekst',
      pdfX: 30,
      pdfY: 470,
      pdfWidth: 120,
      fontSize: 16,
      lineSpacing: 19.2,
      numOriginalLines: 1,
      fontFamily: 'Helvetica',
      color: '#000000',
    };
    state.documents = [{
      id: 'viewport-pdf-text-document',
      filePath: 'viewport-fixture.pdf',
      currentPage: 1,
      scale: 1,
      viewMode: 'single',
      annotations: [],
      selectedAnnotations: [],
      textEdits: [textEdit],
      undoStack: [],
      redoStack: [],
      pdfDoc: { numPages: 1 },
    }];
    state.activeDocumentIndex = 0;
    Object.assign(viewport, {
      active: true,
      zoom: 2,
      offsetX: 25,
      offsetY: 30,
      pageW: 500,
      pageH: 600,
      pageNum: 1,
    });

    context.fillStyle = '#000000';
    context.font = '32px Helvetica, Arial, sans-serif';
    context.textBaseline = 'alphabetic';
    context.fillText('Viewporttekst', 25 + 30 * 2, 30 + (600 - 470) * 2);
    const canvasRect = canvas.getBoundingClientRect();
    return {
      clip: {
        x: canvasRect.x + 75,
        y: canvasRect.y + 250,
        width: 260,
        height: 90,
      },
    };
  });
  const viewportRenderedImage = await page.screenshot({ clip: viewportSetup.clip });
  await page.evaluate(async () => {
    const { state } = await import('/js/core/state.ts');
    const { startTextEditEditing } = await import('/js/tools/text-edit-tool.js');
    startTextEditEditing(
      state.documents[0].textEdits[0],
      1,
      document.getElementById('annotation-canvas'),
    );
  });
  await page.waitForSelector('.pdf-text-editor');
  await page.locator('.pdf-text-editor').evaluate(editor => editor.setSelectionRange(0, 0));
  const viewportEditImage = await page.screenshot({ clip: viewportSetup.clip });
  const viewportRendered = await darkPixelBounds(viewportRenderedImage);
  const viewportEditing = await darkPixelBounds(viewportEditImage);
  assert.ok(Math.abs(viewportEditing.minX - viewportRendered.minX) <= 1,
    `Viewport PDF text moved ${viewportEditing.minX - viewportRendered.minX}px horizontally`);
  assert.ok(Math.abs(viewportEditing.minY - viewportRendered.minY) <= 1,
    `Viewport PDF text moved ${viewportEditing.minY - viewportRendered.minY}px vertically`);

  console.log('Native PDF text editing test passed');
} finally {
  await browser.close();
}
