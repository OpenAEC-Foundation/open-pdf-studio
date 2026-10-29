// Font size and auto-fit for text watermarks (#849): one size rule for the
// screen and the saved file, computed per page from its display size.
import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, degrees } from 'pdf-lib';
import {
  watermarkFontSize, watermarkAutoFitSize, clampWatermarkFontSize, stepWatermarkFontSize, watermarkTextBox, watermarkTextPlacement,
  WATERMARK_MARGIN, WATERMARK_FONT_MIN, WATERMARK_FONT_MAX, WATERMARK_FONT_LIMIT, watermarkFontSizeFromField,
} from './watermark-layout.js';
import { writeWatermarkContent, readWatermarkDefinitions } from '../pdf/saver/watermark-content.js';

const mark = (extra = {}) => ({
  id: 'wm', type: 'textWatermark', text: 'CONFIDENTIAL', fontFamily: 'Helvetica', fontSize: 30,
  rotation: 0, position: 'center', layer: 'behind', pageRange: 'all', enabled: true, ...extra,
});

function rotatedBox(wm, size) {
  const { width, height } = watermarkTextBox(wm, size);
  const a = (wm.rotation || 0) * Math.PI / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  return { w: c * width + s * height, h: s * width + c * height };
}

test('manual sizes are kept within 4 to 288 pt', () => {
  assert.equal(WATERMARK_FONT_MIN, 4);
  assert.equal(WATERMARK_FONT_MAX, 288);
  assert.equal(clampWatermarkFontSize(1), 4);
  assert.equal(clampWatermarkFontSize(500), 288);
  assert.equal(clampWatermarkFontSize('36.5'), 36.5);
  assert.equal(clampWatermarkFontSize('abc'), 72);
  assert.equal(watermarkFontSize(mark({ fontSize: 30 }), 600, 800), 30);
});

test('a stored size above the dialog range keeps its size on screen and in the file', async () => {
  assert.equal(watermarkFontSize(mark({ fontSize: 400 }), 600, 800), 400);
  assert.equal(watermarkTextPlacement(mark({ fontSize: 400 }), 600, 800).size, 400);
  assert.equal(watermarkFontSize(mark({ fontSize: 2 }), 600, 800), 2);
  assert.equal(WATERMARK_FONT_LIMIT, 5000);
  assert.equal(watermarkFontSize(mark({ fontSize: 1e9 }), 600, 800), 5000, 'sanity bound');
  assert.equal(watermarkFontSize(mark({ fontSize: 'x' }), 600, 800), 72);

  const pdf = await PDFDocument.create();
  pdf.addPage([2384, 3370]);
  await writeWatermarkContent(pdf, [mark({ fontSize: 400, text: 'A0' })]);
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loaded = await getDocument({ data: (await pdf.save()).slice(), isEvalSupported: false, useSystemFonts: true }).promise;
  try {
    const [item] = (await (await loaded.getPage(1)).getTextContent()).items.filter(i => i.str.trim());
    assert.ok(Math.abs(Math.hypot(item.transform[0], item.transform[1]) - 400) < 0.01);
  } finally { await loaded.loadingTask.destroy(); }
});

test('the dialog keeps a stored size outside the range until the field is edited', () => {
  assert.equal(watermarkFontSizeFromField(400, { edited: false, stored: 400 }), 400);
  assert.equal(watermarkFontSizeFromField('400', { edited: true, stored: 400 }), 288);
  assert.equal(watermarkFontSizeFromField('36', { edited: true, stored: 400 }), 36);
  assert.equal(watermarkFontSizeFromField('500', { edited: false, stored: undefined }), 288, 'a new watermark is clamped');
  assert.equal(watermarkFontSizeFromField(2, { edited: false, stored: 2 }), 2);
});

test('the stepper buttons move to the next whole point, within the range', () => {
  assert.equal(stepWatermarkFontSize(72, 1), 73);
  assert.equal(stepWatermarkFontSize('36.5', 1), 37);
  assert.equal(stepWatermarkFontSize('36.5', -1), 36);
  assert.equal(stepWatermarkFontSize(288, 1), 288);
  assert.equal(stepWatermarkFontSize(4, -1), 4);
  assert.equal(stepWatermarkFontSize('', 1), 73);
});

test('auto-fit fills the page up to its margin, at any rotation', () => {
  for (const rotation of [0, -45, 90, 30]) {
    for (const [pw, ph] of [[595, 842], [842, 595], [2384, 3370]]) {
      const wm = mark({ rotation, autoFit: true });
      const size = watermarkAutoFitSize(wm, pw, ph);
      assert.equal(watermarkFontSize(wm, pw, ph), size);
      const box = rotatedBox(wm, size);
      const roomW = pw - 2 * WATERMARK_MARGIN, roomH = ph - 2 * WATERMARK_MARGIN;
      assert.ok(box.w <= roomW + 1e-6 && box.h <= roomH + 1e-6, `${rotation} ${pw}x${ph}: ${JSON.stringify(box)}`);
      assert.ok(Math.abs(box.w - roomW) < 1e-6 || Math.abs(box.h - roomH) < 1e-6, 'one side touches the margin');
    }
  }
});

test('auto-fit ignores the manual size, and turning it off brings that size back', () => {
  const wm = mark({ fontSize: 30, autoFit: true });
  assert.notEqual(watermarkFontSize(wm, 595, 842), 30);
  assert.equal(watermarkFontSize({ ...wm, autoFit: false }, 595, 842), 30);
  assert.equal(watermarkTextPlacement(wm, 595, 842).size, watermarkAutoFitSize(wm, 595, 842));
});

test('auto-fit never goes below the minimum size on a tiny page', () => {
  assert.equal(watermarkAutoFitSize(mark({ autoFit: true, text: 'A VERY LONG WATERMARK TEXT' }), 90, 90), 4);
});

test('the saved file uses the auto-fit size of each page and keeps the setting', async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]);
  pdf.addPage([842, 1191]).setRotation(degrees(90));
  const wm = mark({ autoFit: true, rotation: -45 });
  await writeWatermarkContent(pdf, [wm]);
  const bytes = await pdf.save();
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loaded = await getDocument({ data: bytes.slice(), isEvalSupported: false, useSystemFonts: true }).promise;
  try {
    for (const [n, pw, ph] of [[1, 595, 842], [2, 1191, 842]]) {
      const page = await loaded.getPage(n);
      const [item] = (await page.getTextContent()).items.filter(i => i.str.trim());
      const expected = watermarkAutoFitSize(wm, pw, ph);
      const scale = Math.hypot(item.transform[0], item.transform[1]);
      assert.ok(Math.abs(scale - expected) < 0.01, `page ${n}: ${scale} vs ${expected}`);
    }
  } finally { await loaded.loadingTask.destroy(); }
  assert.equal(readWatermarkDefinitions(await PDFDocument.load(bytes))[0].autoFit, true);
});
