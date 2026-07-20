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

  assert.ok(maxX >= 0 && maxY >= 0, 'Expected rendered text pixels in the textbox');
  return { minX, minY, maxX, maxY };
}

async function measureCase(browser, { fontFamily, fontSize, scale }) {
  const page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
    deviceScaleFactor: 1,
  });

  try {
    await page.goto('http://127.0.0.1:3041', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);

    const setup = await page.evaluate(async ({ fontFamily, fontSize, scale }) => {
      const { state } = await import('/js/core/state.ts');
      const { viewport } = await import('/js/pdf/pdf-viewport.js');
      const { drawTextboxContent } = await import('/js/annotations/rendering/shapes.js');
      const canvas = document.getElementById('annotation-canvas');

      document.body.appendChild(canvas);
      for (const [property, value] of Object.entries({
        position: 'fixed',
        left: '50px',
        top: '50px',
        width: '1000px',
        height: '600px',
        display: 'block',
        'z-index': '1000',
        transform: 'none',
        visibility: 'visible',
        opacity: '1',
      })) {
        canvas.style.setProperty(property, value, 'important');
      }
      canvas.width = 1000;
      canvas.height = 600;
      viewport.active = false;

      const annotation = {
        id: 'text-edit-position-test',
        type: 'textbox',
        page: 1,
        x: 30,
        y: 30,
        width: 360,
        height: 90,
        text: 'Meting tekst',
        fontFamily,
        fontSize,
        lineSpacing: 1.2,
        lineWidth: 0,
        fillColor: '#ffffff',
        strokeColor: '#000000',
        textColor: '#000000',
        rotation: 0,
        locked: false,
      };

      state.documents = [{
        id: 'text-edit-position-document',
        currentPage: 1,
        scale,
        viewMode: 'single',
        annotations: [annotation],
        selectedAnnotations: [],
        undoStack: [],
        redoStack: [],
        pdfDoc: { numPages: 1 },
      }];
      state.activeDocumentIndex = 0;

      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.save();
      context.scale(scale, scale);
      drawTextboxContent(context, annotation);
      context.restore();

      const canvasRect = canvas.getBoundingClientRect();
      return {
        clip: {
          x: canvasRect.x + annotation.x * scale,
          y: canvasRect.y + annotation.y * scale,
          width: annotation.width * scale,
          height: annotation.height * scale,
        },
      };
    }, { fontFamily, fontSize, scale });

    const renderedImage = await page.screenshot({ clip: setup.clip });

    await page.evaluate(async () => {
      const { state } = await import('/js/core/state.ts');
      const { startTextEditing } = await import('/js/tools/text-editing.js');
      startTextEditing(state.documents[0].annotations[0]);
    });
    await page.waitForSelector('.inline-text-editor');
    await page.locator('.inline-text-editor').evaluate(editor => editor.setSelectionRange(0, 0));
    await page.waitForTimeout(50);

    const editImage = await page.screenshot({ clip: setup.clip });
    const rendered = await darkPixelBounds(renderedImage);
    const editing = await darkPixelBounds(editImage);

    return {
      fontFamily,
      fontSize,
      scale,
      deltaX: editing.minX - rendered.minX,
      deltaY: editing.minY - rendered.minY,
    };
  } finally {
    await page.close();
  }
}

const browser = await chromium.launch({ headless: true });

try {
  const cases = [
    { fontFamily: 'Arial', fontSize: 28, scale: 1 },
    { fontFamily: 'Segoe UI', fontSize: 28, scale: 1 },
    { fontFamily: 'Arial', fontSize: 28, scale: 2 },
  ];

  for (const testCase of cases) {
    const result = await measureCase(browser, testCase);
    assert.ok(Math.abs(result.deltaX) <= 1,
      `${result.fontFamily} at ${result.scale}x moved ${result.deltaX}px horizontally in edit mode`);
    assert.ok(Math.abs(result.deltaY) <= 1,
      `${result.fontFamily} at ${result.scale}x moved ${result.deltaY}px vertically in edit mode`);
  }

  console.log('Text edit position test passed');
} finally {
  await browser.close();
}
