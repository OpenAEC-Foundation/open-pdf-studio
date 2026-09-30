import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { canvasToTiffBytes } from './tiff.js';
import { imageWithDpi } from './image-dpi.js';

test('TIFF records pixel dimensions, DPI and alpha-composited RGB data', () => {
  const canvas = {
    width: 2, height: 1,
    getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray([
      10, 20, 30, 255,
      0, 100, 200, 128,
    ]) }) }),
  };
  const bytes = canvasToTiffBytes(canvas, 300);
  const view = new DataView(bytes.buffer);
  assert.deepEqual([...bytes.slice(0, 4)], [73, 73, 42, 0]);
  const entries = new Map();
  for (let i = 0; i < view.getUint16(8, true); i++) {
    const offset = 10 + i * 12;
    entries.set(view.getUint16(offset, true), {
      type: view.getUint16(offset + 2, true),
      count: view.getUint32(offset + 4, true),
      value: view.getUint32(offset + 8, true),
    });
  }
  assert.equal(entries.get(256).value, 2);
  assert.equal(entries.get(257).value, 1);
  assert.equal(entries.get(259).value, 1);
  assert.equal(entries.get(262).value, 2);
  assert.equal(entries.get(277).value & 0xffff, 3);
  assert.equal(entries.get(279).value, 6);
  assert.equal(entries.get(296).value & 0xffff, 2);
  for (const tag of [282, 283]) {
    const offset = entries.get(tag).value;
    assert.equal(view.getUint32(offset, true), 300);
    assert.equal(view.getUint32(offset + 4, true), 1);
  }
  assert.deepEqual([...bytes.slice(entries.get(273).value)], [10, 20, 30, 127, 177, 227]);
});

test('PNG physical resolution is inserted once and can be updated without changing other chunks', () => {
  const source = new Uint8Array(readFileSync(new URL('../../public/icon.png', import.meta.url)));
  const first = imageWithDpi(source, 'png', 300);
  const second = imageWithDpi(first, 'png', 600);
  const chunks = bytes => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const found = [];
    for (let at = 8; at < bytes.length;) {
      const length = view.getUint32(at);
      const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
      found.push({ type, data: bytes.subarray(at + 8, at + 8 + length) });
      at += length + 12;
    }
    return found;
  };
  const original = chunks(source), updated = chunks(second);
  assert.equal(updated.filter(chunk => chunk.type === 'pHYs').length, 1);
  assert.equal(updated[0].type, 'IHDR');
  assert.equal(updated[1].type, 'pHYs');
  const density = new DataView(updated[1].data.buffer, updated[1].data.byteOffset, 9);
  assert.equal(density.getUint32(0), Math.round(600 / 0.0254));
  assert.equal(density.getUint32(4), Math.round(600 / 0.0254));
  assert.equal(density.getUint8(8), 1);
  assert.deepEqual(updated.filter(chunk => chunk.type !== 'pHYs').map(chunk => [...chunk.data]),
    original.filter(chunk => chunk.type !== 'pHYs').map(chunk => [...chunk.data]));
});

test('JPEG JFIF stores the selected DPI in inches', () => {
  const jfif = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0,
    1, 2, 0, 0, 72, 0, 72, 0, 0, 0xff, 0xd9]);
  const updated = imageWithDpi(jfif, 'jpeg', 300);
  assert.equal(updated.length, jfif.length);
  assert.equal(updated[13], 1);
  assert.deepEqual([...updated.subarray(14, 18)], [1, 44, 1, 44]);
  assert.deepEqual([...jfif.subarray(13, 18)], [0, 0, 72, 0, 72]);
  const noJfif = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const inserted = imageWithDpi(noJfif, 'jpeg', 300);
  assert.deepEqual([...inserted.subarray(0, 4)], [0xff, 0xd8, 0xff, 0xe0]);
  assert.deepEqual([...inserted.subarray(16, 20)], [1, 44, 0, 0]);
});
