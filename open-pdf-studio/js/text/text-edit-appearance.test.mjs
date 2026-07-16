import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyPageRotation,
  elementRectToCanvasPixels,
  getPageRotationMatrix,
  getTextLayerCssMatrix,
  invertPageRotation,
  restoreTextEditSnapshot,
  resolveTextEditPageGeometry,
  selectTextColor,
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
