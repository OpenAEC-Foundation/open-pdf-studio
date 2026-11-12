// Golden fixtures for the Rust port of symbol search and form recognition
// (open-pdf-scan/). Generated images go through the app's own
// modules (js/search/symbol-matcher.js, js/pdf/form-recognition.js); the Rust
// tests must reproduce every output exactly. Floats are stored next to their
// JSON value as f64 bit patterns ("<key>#") so reading the JSON rounds nothing.
//
//   node scripts/bench-rust/scan-golden.mjs
//
// Writes open-pdf-scan/tests/fixtures/scan/. Deterministic: a rerun gives the
// same files.

import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { binaryImage, cropTemplate, transformTemplate, matchSymbols } from '../../js/search/symbol-matcher.js';
import { detectFormShapes } from '../../js/pdf/form-recognition.js';
import { rng } from './lib.mjs';

const out = fileURLToPath(new URL('../../../open-pdf-scan/tests/fixtures/scan/', import.meta.url));
mkdirSync(out, { recursive: true });

const bits = (v) => {
  const b = new DataView(new ArrayBuffer(8));
  b.setFloat64(0, v);
  return b.getBigUint64(0).toString(16).padStart(16, '0');
};
const save = (name, bytes) => { writeFileSync(out + name, deflateSync(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), { level: 9 })); return name; };

const blank = (width, height) => ({ width, height, pixels: new Uint8Array(width * height) });
function stamp(image, t, x, y) {
  for (let row = 0; row < t.height; row++) for (let col = 0; col < t.width; col++) {
    if (t.pixels[row * t.width + col]) image.pixels[(y + row) * image.width + x + col] = 1;
  }
}
function line(image, x0, y0, x1, y1) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= n; i++) {
    const x = Math.round(x0 + (x1 - x0) * i / n), y = Math.round(y0 + (y1 - y0) * i / n);
    if (x >= 0 && y >= 0 && x < image.width && y < image.height) image.pixels[y * image.width + x] = 1;
  }
}
/** A small asymmetric symbol, so rotations are distinguishable. */
function symbol(size) {
  const t = blank(size, size);
  const m = Math.max(2, Math.floor(size / 6));
  for (let y = m; y < size - m; y++) for (let x = m; x < size - m; x++) {
    if (x < m + 2 || y > size - m - 3 || (x === size - m - 3 && y < size / 2) || (x - y === 1 && x < size / 2)) t.pixels[y * size + x] = 1;
  }
  return t;
}

const matchFields = (m) => ({ x: m.x, y: m.y, width: m.width, height: m.height, score: m.score, 'score#': bits(m.score), rotation: m.rotation, scale: m.scale, 'scale#': bits(m.scale) });
const tpl = (t) => ({ width: t.width, height: t.height, pixels: Array.from(t.pixels).join('') });

const symbolCases = [];
async function symbolCase(name, image, rect, options) {
  const file = save(`${name}.bin.z`, image.pixels);
  const entry = { name, image: { width: image.width, height: image.height, file }, rect: [rect.x, rect.y, rect.width, rect.height], 'rect#': [rect.x, rect.y, rect.width, rect.height].map(bits) };
  let template;
  try {
    template = cropTemplate(image, rect);
  } catch (e) {
    entry.error = e.message;
    symbolCases.push(entry);
    return;
  }
  entry.template = tpl(template);
  entry.threshold = options.threshold ?? 0.75;
  entry['threshold#'] = bits(entry.threshold);
  entry.rotations = options.rotations ?? [0];
  entry.scales = options.scales ?? [1];
  entry['scales#'] = entry.scales.map(bits);
  try {
    const found = await matchSymbols(image, template, { ...options, yieldTask: async () => {} });
    entry.matches = found.matches.map(matchFields);
    entry.truncated = found.truncated;
  } catch (e) {
    entry.error = e.message;
  }
  symbolCases.push(entry);
}

// 1. A drawing-like page: lines, the symbol at several places, turned and
//    scaled copies, damaged copies, unrelated marks.
{
  const r = rng(7);
  const image = blank(640, 420);
  for (let i = 0; i < 40; i++) line(image, Math.floor(r() * 640), Math.floor(r() * 420), Math.floor(r() * 640), Math.floor(r() * 420));
  const t = symbol(24);
  const places = [[40, 30, 0, 1], [200, 50, 90, 1], [330, 80, 180, 1], [480, 40, 270, 1], [90, 200, 0, 1.25], [260, 220, 90, 0.8], [420, 250, 0, 1], [540, 300, 0, 1]];
  for (const [x, y, rot, sc] of places) stamp(image, transformTemplate(t, rot, sc), x, y);
  // the template itself, undisturbed, at a known spot
  for (let y = 350; y < 380; y++) for (let x = 20; x < 50; x++) image.pixels[y * 640 + x] = 0;
  stamp(image, t, 23, 353);
  // scan damage
  for (let i = 0; i < 300; i++) image.pixels[Math.floor(r() * image.pixels.length)] ^= 1;
  for (let y = 300; y < 330; y++) for (let x = 150; x < 190; x++) image.pixels[y * 640 + x] = 1;
  const rect = { x: 23, y: 353, width: 24, height: 24 };
  await symbolCase('drawing-default', image, rect, {});
  await symbolCase('drawing-all', image, rect, { rotations: [0, 90, 180, 270], scales: [0.8, 1, 1.25], threshold: 0.6 });
  await symbolCase('drawing-strict', image, rect, { threshold: 1 });
  await symbolCase('drawing-duplicates', image, rect, { rotations: [90, 0, 90], scales: [1, 1, 1.25], threshold: 0.7 });
  await symbolCase('drawing-fraction', image, { x: 22.4, y: 352.7, width: 25.2, height: 24.9 }, { threshold: 0.55, scales: [0.5, 2] });
  await symbolCase('drawing-bad-rotation', image, rect, { rotations: [45] });
  await symbolCase('drawing-bad-scale', image, rect, { scales: [3] });
  await symbolCase('drawing-bad-threshold', image, rect, { threshold: 0.4 });
  await symbolCase('crop-out-of-bounds', image, { x: 630, y: 10, width: 24, height: 24 }, {});
  await symbolCase('crop-too-small', image, { x: 10, y: 10, width: 5, height: 5 }, {});
  await symbolCase('crop-too-large', image, { x: 10, y: 10, width: 161, height: 20 }, {});
  await symbolCase('crop-solid', image, { x: 152, y: 302, width: 20, height: 20 }, {});
}
// 2. A regular pattern: more than 5000 candidates, so the search stops early.
{
  const image = blank(700, 500);
  for (let y = 0; y < 500; y++) for (let x = 0; x < 700; x++) if (x % 6 < 2 || y % 6 < 2) image.pixels[y * 700 + x] = 1;
  await symbolCase('grid-truncated', image, { x: 0, y: 0, width: 12, height: 12 }, { threshold: 0.9 });
}
// 3. Many separate copies: more than 1000 kept matches.
{
  const image = blank(900, 620);
  const t = symbol(12);
  for (let y = 2; y + 14 < 620; y += 15) for (let x = 2; x + 14 < 900; x += 15) stamp(image, t, x, y);
  await symbolCase('many-copies', image, { x: 2, y: 2, width: 12, height: 12 }, { threshold: 0.95 });
}
// 4. A template larger than the image in one direction after turning.
{
  const image = blank(60, 20);
  const t = blank(40, 10);
  for (let x = 2; x < 38; x++) { t.pixels[2 * 40 + x] = 1; t.pixels[7 * 40 + x] = x % 3 ? 1 : 0; }
  stamp(image, t, 5, 5);
  await symbolCase('wide-template', image, { x: 5, y: 5, width: 40, height: 10 }, { rotations: [0, 90], threshold: 0.8 });
}

// binaryImage on RGBA with colours, greys around the threshold and alpha.
const rgbaCases = [];
{
  const r = rng(11);
  const w = 97, h = 53;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const mode = i % 5;
    const g = mode === 0 ? 169 + (i % 3) : Math.floor(r() * 256);
    data[i * 4] = mode === 1 ? Math.floor(r() * 256) : g;
    data[i * 4 + 1] = mode === 2 ? Math.floor(r() * 256) : g;
    data[i * 4 + 2] = g;
    data[i * 4 + 3] = mode === 3 ? 127 + (i % 4) : 255;
  }
  const bin = binaryImage({ width: w, height: h, data });
  rgbaCases.push({ name: 'rgba-threshold', width: w, height: h, rgba: save('rgba-threshold.rgba.z', data), binary: save('rgba-threshold.bin.z', bin.pixels) });
}

// Form recognition on RGBA page rasters.
function page(w, h) {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  const set = (x, y, v = 0) => { if (x >= 0 && y >= 0 && x < w && y < h) { const o = (y * w + x) * 4; data[o] = data[o + 1] = data[o + 2] = v; } };
  return {
    w, h, data, set,
    box(x, y, bw, bh, t = 1) { for (let i = 0; i < bw; i++) for (let k = 0; k < t; k++) { set(x + i, y + k); set(x + i, y + bh - 1 - k); } for (let j = 0; j < bh; j++) for (let k = 0; k < t; k++) { set(x + k, y + j); set(x + bw - 1 - k, y + j); } },
    fill(x, y, bw, bh, v = 0) { for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) set(x + i, y + j, v); },
    circle(cx, cy, rad) { for (let a = 0; a < 720; a++) set(Math.round(cx + rad * Math.cos(a * Math.PI / 360)), Math.round(cy + rad * Math.sin(a * Math.PI / 360))); },
    hline(x, y, len, t = 1) { for (let i = 0; i < len; i++) for (let k = 0; k < t; k++) set(x + i, y + k); },
  };
}
const shapeFields = (s) => ({ x: s.x, 'x#': bits(s.x), y: s.y, 'y#': bits(s.y), width: s.width, 'width#': bits(s.width), height: s.height, 'height#': bits(s.height), type: s.type, confidence: s.confidence, source: s.source });
const formCases = [];
function formCase(name, p, scale) {
  const entry = { name, width: p.w, height: p.h, scale, 'scale#': bits(scale), rgba: save(`${name}.rgba.z`, p.data) };
  entry.shapes = detectFormShapes({ data: p.data, width: p.w, height: p.h }, scale).map(shapeFields);
  formCases.push(entry);
}
for (const scale of [1, 1.7, 2]) {
  const s = (v) => Math.round(v * scale);
  const p = page(s(500), s(360));
  p.box(s(40), s(30), s(200), s(22), 1);               // text field outline
  p.box(s(40), s(70), s(14), s(14), 1);                // checkbox
  p.circle(s(47), s(110), s(7));                       // radio
  p.hline(s(40), s(150), s(260), 1);                   // writing line
  p.hline(s(40), s(170), s(30), 1);                    // too short for a line
  p.box(s(40), s(190), s(200), s(60), 1);              // too tall
  p.fill(s(300), s(30), s(60), s(20));                 // filled: no field
  p.box(s(300), s(70), s(100), s(20), 1);              // outline with text inside
  p.fill(s(310), s(76), s(70), s(8));
  p.box(s(300), s(110), s(18), s(18), 2);              // thick checkbox
  p.box(s(300), s(140), s(26), s(12), 1);              // neither square nor wide
  p.box(s(40), s(270), s(120), s(18), 1);              // two outlines sharing an edge region
  p.box(s(42), s(272), s(116), s(14), 1);
  p.hline(s(200), s(300), s(700), 1);                  // line running off the page
  p.fill(s(420), s(200), s(40), s(3), 160);            // grey just under the ink threshold
  p.fill(s(420), s(220), s(40), s(3), 171);            // grey just above it
  formCase(`form-${String(scale).replace('.', '_')}`, p, scale);
}
{
  // More than 500 candidates: the list is cut after sorting.
  const p = page(1500, 1100);
  for (let y = 10; y + 20 < 1100; y += 24) for (let x = 10; x + 44 < 1500; x += 50) p.box(x, y, 40, 16, 1);
  formCase('form-many', p, 1);
}
{
  const p = page(40, 30);
  formCase('form-empty', p, 1.5);
}

// One case per line: readable diffs without a megabyte of indentation.
const lines = (cases) => `[\n${cases.map((c) => `  ${JSON.stringify(c)}`).join(',\n')}\n ]`;
writeFileSync(out + 'cases.json', `{\n "symbol": ${lines(symbolCases)},\n "rgba": ${lines(rgbaCases)},\n "form": ${lines(formCases)}\n}\n`);
console.log(`symbol cases: ${symbolCases.length}, rgba: ${rgbaCases.length}, form: ${formCases.length}`);
for (const c of symbolCases) console.log(`  ${c.name}: ${c.error ?? `${c.matches.length} matches${c.truncated ? ' (truncated)' : ''}`}`);
for (const c of formCases) console.log(`  ${c.name}: ${c.shapes.length} shapes (${['text', 'checkbox', 'radio'].map((t) => `${c.shapes.filter((s) => s.type === t).length} ${t}`).join(', ')})`);
