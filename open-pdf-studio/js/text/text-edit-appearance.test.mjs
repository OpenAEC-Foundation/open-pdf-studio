import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyPageRotation,
  elementRectToCanvasPixels,
  getPageRotationMatrix,
  getTextLayerCssMatrix,
  invertPageRotation,
  restoreTextEditSnapshot,
  resolveTextEditLineStyle,
  resolveTextEditPageGeometry,
  sanitizeWinAnsiText,
  selectTextColor,
  textEditAngleFromTransform,
  textEditLineAnchor,
} from './text-edit-appearance.js';

test('page rotation matrix keeps PDF text attached for every quarter turn', () => {
  const width = 600;
  const height = 800;
  const point = { x: 100, y: 200 };

  assert.deepEqual(getPageRotationMatrix(width, height, 0), [1, 0, 0, 1, 0, 0]);
  assert.deepEqual(getPageRotationMatrix(width, height, 90), [0, 1, -1, 0, 800, 0]);
  assert.deepEqual(getPageRotationMatrix(width, height, 180), [-1, 0, 0, -1, 600, 800]);
  assert.deepEqual(getPageRotationMatrix(width, height, 270), [0, -1, 1, 0, 0, 600]);

  assert.deepEqual(applyPageRotation(point.x, point.y, width, height, 90), { x: 600, y: 100 });
  assert.deepEqual(applyPageRotation(point.x, point.y, width, height, 180), { x: 500, y: 600 });
  assert.deepEqual(applyPageRotation(point.x, point.y, width, height, 270), { x: 200, y: 500 });
});

test('rotated display coordinates invert to the original text position', () => {
  const width = 600;
  const height = 800;
  const original = { x: 123, y: 456 };

  for (const rotation of [0, 90, 180, 270]) {
    const displayed = applyPageRotation(original.x, original.y, width, height, rotation);
    assert.deepEqual(invertPageRotation(displayed.x, displayed.y, width, height, rotation), original);
  }
});

test('text layer matrix composes page rotation, zoom, and viewport offset', () => {
  assert.deepEqual(
    getTextLayerCssMatrix(600, 800, 90, 2, 10, 20),
    [0, 2, -2, 0, 1610, 20],
  );
  assert.deepEqual(
    getTextLayerCssMatrix(600, 800, 270, 1.5, -5, 12),
    [0, -1.5, 1.5, 0, -5, 912],
  );
});

test('text colour selection ignores white background and antialiased grey edges', () => {
  const blackGlyph = new Uint8ClampedArray([
    255, 255, 255, 255,
    188, 188, 188, 255,
    17, 17, 17, 255,
    110, 110, 110, 255,
  ]);
  assert.equal(selectTextColor(blackGlyph), '#000000');

  const redGlyph = new Uint8ClampedArray([
    255, 255, 255, 255,
    255, 170, 170, 255,
    214, 32, 40, 255,
  ]);
  assert.equal(selectTextColor(redGlyph), '#d62028');
});

test('text colour selection preserves colours on light and dark backgrounds', () => {
  assert.equal(selectTextColor(new Uint8ClampedArray([
    0, 0, 0, 255,
    0, 0, 0, 255,
    214, 32, 40, 255,
  ])), '#d62028');
  assert.equal(selectTextColor(new Uint8ClampedArray([
    255, 255, 255, 255,
    255, 255, 255, 255,
    51, 51, 51, 255,
  ])), '#333333');
  assert.equal(selectTextColor(new Uint8ClampedArray([
    255, 255, 255, 255,
    255, 255, 255, 255,
    244, 244, 244, 255,
  ])), '#f4f4f4');

  assert.equal(selectTextColor(new Uint8ClampedArray([
    255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255,
    255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  ]), '#000000', 3, 3), '#000000');
});

test('cancelling a live text edit restores the complete record snapshot', () => {
  const record = { pdfX: 12, pdfY: 30, color: '#ff0000', transient: true };
  restoreTextEditSnapshot(record, { pdfX: 10, pdfY: 20, color: '#000000' });
  assert.deepEqual(record, { pdfX: 10, pdfY: 20, color: '#000000' });
});

test('DOM text bounds are converted to canvas backing pixels', () => {
  const canvasRect = { left: 20, top: 40, width: 400, height: 300 };
  const textRect = { left: 120, top: 115, right: 220, bottom: 145 };

  assert.deepEqual(
    elementRectToCanvasPixels(textRect, canvasRect, 800, 600),
    { x: 200, y: 150, width: 200, height: 60 },
  );
});

test('page geometry combines intrinsic and user rotation', () => {
  assert.deepEqual(
    resolveTextEditPageGeometry({ widthPt: 600, heightPt: 800, rotation: 90 }, 800, 600, 90),
    { pageWidth: 600, pageHeight: 800, rotation: 180, displayWidth: 600, displayHeight: 800 },
  );
});

test('WinAnsi sanitizer keeps encodable text untouched', () => {
  const { text, replaced } = sanitizeWinAnsiText('Prijs € 1.200,00 — "citaat" … één ligne');
  assert.equal(text, 'Prijs € 1.200,00 — "citaat" … één ligne');
  assert.deepEqual(replaced, []);
});

test('WinAnsi sanitizer replaces non-encodable characters with close equivalents', () => {
  const { text, replaced } = sanitizeWinAnsiText('u ≤ h/300 → ok ﬁjn');
  assert.equal(text, 'u <= h/300 -> ok fijn');
  assert.deepEqual(replaced, ['≤', '→', 'ﬁ']);
});

test('WinAnsi sanitizer falls back to ? for unmapped characters', () => {
  const { text, replaced } = sanitizeWinAnsiText('hobЬi �');
  assert.equal(text, 'hob?i ?');
  assert.deepEqual(replaced, ['Ь', '�']);
  // Newlines survive (line splitting happens before drawing)
  assert.equal(sanitizeWinAnsiText('a\nb').text, 'a\nb');
});

test('text angle is derived from the span matrix and snapped to right angles', () => {
  assert.equal(textEditAngleFromTransform([11, 0, 0, 11, 100, 200]), 0);
  // 90° CCW authored text (as on /Rotate 90 pages): [0, fs, -fs, 0]
  assert.equal(textEditAngleFromTransform([0, 10.017, -10.017, 0, 538, 971]), 90);
  assert.equal(textEditAngleFromTransform([-9, 0, 0, -9, 0, 0]), 180);
  assert.equal(textEditAngleFromTransform([0, -12, 12, 0, 0, 0]), 270);
  // Garbage in, safe default out
  assert.equal(textEditAngleFromTransform(null), 0);
  assert.equal(textEditAngleFromTransform([0, 0, 0, 0]), 0);
});

test('line anchors follow the text direction for rotated runs', () => {
  // Horizontal text: next line straight down (PDF y decreases)
  assert.deepEqual(textEditLineAnchor(100, 500, 1, 12, 0), { x: 100, y: 488 });
  // 90° CCW text: next line moves in +x (perpendicular to reading direction)
  const a = textEditLineAnchor(538, 971, 1, 12, 90);
  assert.ok(Math.abs(a.x - 550) < 1e-9 && Math.abs(a.y - 971) < 1e-9);
  const b = textEditLineAnchor(100, 500, 2, 10, 180);
  assert.ok(Math.abs(b.x - 100) < 1e-9 && Math.abs(b.y - 520) < 1e-9);
});

test('per-line styles resolve with record-level fallback', () => {
  const edit = {
    fontFamily: 'Helvetica-Bold',
    fontSize: 11,
    color: '#3399cc',
    loadedFontName: 'g_d0_f1',
    lineStyles: [
      { fontFamily: 'Helvetica-Bold', fontSize: 11, color: '#3399cc', loadedFontName: 'g_d0_f1' },
      { fontFamily: 'Helvetica', fontSize: 9.96, color: '#000000', loadedFontName: 'g_d0_f2' },
    ],
  };
  // Line 0: heading style; line 1: body style
  assert.equal(resolveTextEditLineStyle(edit, 0).color, '#3399cc');
  assert.equal(resolveTextEditLineStyle(edit, 1).fontFamily, 'Helvetica');
  assert.equal(resolveTextEditLineStyle(edit, 1).fontSize, 9.96);
  // Extra lines beyond the original block reuse the last known line style
  assert.equal(resolveTextEditLineStyle(edit, 5).color, '#000000');
  // Records without lineStyles keep the uniform record style (old records,
  // panel overrides)
  const uniform = { fontFamily: 'TimesRoman', fontSize: 12, color: '#112233' };
  assert.deepEqual(resolveTextEditLineStyle(uniform, 3), {
    fontFamily: 'TimesRoman', fontSize: 12, color: '#112233', loadedFontName: '',
  });
});
