import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, degrees } from 'pdf-lib';
import { extractStampImages } from './image-extraction.js';
import { register } from 'node:module';
register('../saver-test-hooks.mjs', import.meta.url);
let canvas;
try { canvas = await import('@napi-rs/canvas'); } catch { /* optional PDF.js dependency */ }

test('een samengestelde stempel tekent het masker en de geneste vorm op transparante pixels', { skip: !canvas }, async () => {
  const { createCanvas, loadImage } = canvas;
  globalThis.document = { createElement: () => createCanvas(1, 1) };
  const doc = await PDFDocument.create();
  const page = doc.addPage([80, 80]);
  page.setRotation(degrees(90));
  page.drawRectangle({ x: 0, y: 0, width: 80, height: 80 });
  const c = doc.context;
  const beeld = { Type: 'XObject', Subtype: 'Image', Width: 2, Height: 1, BitsPerComponent: 8 };
  const mask = c.register(c.flateStream(Uint8Array.of(255, 0), { ...beeld, ColorSpace: 'DeviceGray' }));
  const image = c.register(c.flateStream(Uint8Array.of(255, 0, 0, 0, 0, 0), {
    ...beeld, ColorSpace: 'DeviceRGB', SMask: mask,
  }));
  const form = (ops, xobjects, fonts = {}) => c.register(c.flateStream(ops, {
    Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 20, 10], Resources: { XObject: xobjects, Font: fonts },
  }));
  const base = form('q 20 0 0 10 0 0 cm /Img Do Q', { Img: image });
  const font = c.register(c.obj({
    Type: 'Font', Subtype: 'Type3', FontBBox: [0, 0, 1000, 1000], FontMatrix: [0.001, 0, 0, 0.001, 0, 0],
    FirstChar: 65, LastChar: 65, Widths: [1000], Encoding: { Type: 'Encoding', Differences: [65, 'A'] },
    CharProcs: { A: c.register(c.stream('1000 0 d0 0 0 1000 1000 re f')) }, Resources: {},
  }));
  const overlay = form('0 0 1 rg 10 0 10 5 re f BT /F 2 Tf 0 1 0 rg 12 6 Td (A) Tj ET', {}, { F: font });
  const normal = form('/Base Do /Overlay Do', { Base: base, Overlay: form('/Artwork Do', { Artwork: overlay }) });
  const stamp = c.register(c.obj({ Type: 'Annot', Subtype: 'Stamp', Rect: [10, 20, 30, 30], AP: { N: normal }, F: 4 }));
  page.node.addAnnot(stamp);
  const loaded = await PDFDocument.load(await doc.save());
  const entries = await extractStampImages(1, loaded);
  const entry = entries.get(`id:${stamp.objectNumber}R`);
  assert.equal(entry?.source, 'render');
  const bitmap = await loadImage(entry.dataUrl);
  assert.deepEqual([bitmap.width, bitmap.height], [20, 40]);
  const ctx = createCanvas(20, 40).getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  const pixel = (x, y) => [...ctx.getImageData(x, y, 1, 1).data];
  assert.deepEqual(pixel(5, 5), [255, 0, 0, 255]);
  assert.deepEqual(pixel(5, 35), [0, 0, 255, 255]);
  assert.deepEqual(pixel(13, 25), [0, 255, 0, 255]);
  assert.deepEqual(pixel(15, 35), [0, 0, 0, 0]);
});
