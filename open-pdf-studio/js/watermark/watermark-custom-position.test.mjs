// Switching a watermark to the Custom position (#847 review): X/Y start at
// the position it has now, so preview and saved file do not jump to the
// top-left corner. Blank fields mean "not set" (the page centre); an
// explicit 0 is a real position.
import assert from 'node:assert/strict';
import test from 'node:test';
import { watermarkCustomPosition, parseCustomCoordinate, watermarkTextPlacement, watermarkPosition } from './watermark-layout.js';

const text = (extra = {}) => ({
  id: 'wm', type: 'textWatermark', text: 'CONFIDENTIAL', fontFamily: 'Helvetica', fontSize: 40,
  rotation: -45, position: 'center', enabled: true, ...extra,
});

test('Custom starts at the page centre for a centred watermark', () => {
  assert.deepEqual(watermarkCustomPosition(text(), 595, 842), { x: 297.5, y: 421 });
});

test('Custom starts where a corner watermark is now, for text and images', () => {
  const t = text({ position: 'top-left', rotation: 30 });
  const placed = watermarkTextPlacement(t, 595, 842);
  const custom = watermarkCustomPosition(t, 595, 842);
  assert.ok(Math.abs(custom.x - placed.x) < 0.05 && Math.abs(custom.y - placed.y) < 0.05);
  const moved = watermarkTextPlacement({ ...t, position: 'custom', customX: custom.x, customY: custom.y }, 595, 842);
  assert.ok(Math.abs(moved.x - placed.x) < 0.05 && Math.abs(moved.y - placed.y) < 0.05, 'no jump');

  const img = { id: 'i', type: 'imageWatermark', width: 200, height: 100, scale: 1.5, rotation: 0, position: 'bottom-right' };
  assert.deepEqual(watermarkCustomPosition(img, 600, 800), watermarkPosition(img, 600, 800, 300, 150));
});

test('a watermark that is already custom keeps its coordinates, including 0/0', () => {
  assert.deepEqual(watermarkCustomPosition(text({ position: 'custom', customX: 0, customY: 0 }), 595, 842), { x: 0, y: 0 });
  assert.deepEqual(watermarkPosition(text({ position: 'custom', customX: 0, customY: 0 }), 595, 842), { x: 0, y: 0 });
});

test('blank coordinate fields are not a position; 0 is', () => {
  assert.equal(parseCustomCoordinate(''), undefined);
  assert.equal(parseCustomCoordinate('  '), undefined);
  assert.equal(parseCustomCoordinate(null), undefined);
  assert.equal(parseCustomCoordinate('abc'), undefined);
  assert.equal(parseCustomCoordinate('0'), 0);
  assert.equal(parseCustomCoordinate(0), 0);
  assert.equal(parseCustomCoordinate('120.5'), 120.5);
  const blank = text({ position: 'custom', customX: parseCustomCoordinate(''), customY: parseCustomCoordinate('') });
  assert.deepEqual(watermarkPosition(blank, 595, 842), { x: 297.5, y: 421 });
});
