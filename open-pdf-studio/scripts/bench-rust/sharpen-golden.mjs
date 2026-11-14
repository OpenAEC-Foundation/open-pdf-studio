// Golden fixtures for the Rust port of the page sharpen filter
// (pdfium-worker/src/sharpen.rs): images through the app's own sharpenRgba()
// (js/pdf/render-sharpen.js); the Rust test must give the same bytes.
//
//   node scripts/bench-rust/sharpen-golden.mjs
//
// Writes pdfium-worker/tests/fixtures/sharpen/. Deterministic.

import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { sharpenRgba, SHARPEN_LEVELS } from '../../js/pdf/render-sharpen.js';
import { rng } from './lib.mjs';

const out = fileURLToPath(new URL('../../../pdfium-worker/tests/fixtures/sharpen/', import.meta.url));
mkdirSync(out, { recursive: true });
const save = (name, bytes) => { writeFileSync(out + name, deflateSync(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), { level: 9 })); return name; };
const bits = (v) => { const b = new DataView(new ArrayBuffer(8)); b.setFloat64(0, v); return b.getBigUint64(0).toString(16).padStart(16, '0'); };

/** Page-like pixels: white paper, dark lines, grey anti-aliased edges, colour, noise, varying alpha. */
function image(w, h, seed) {
  const r = rng(seed);
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const x = i % w, y = Math.floor(i / w);
    let v = 255;
    if (x % 17 === 3 || y % 13 === 5) v = 0;                    // thin lines
    else if (x % 17 === 4 || y % 13 === 6) v = 96 + (i % 64);   // their soft edge
    else if ((x >> 4) % 5 === 2 && (y >> 3) % 4 === 1) v = Math.floor(r() * 256); // noise block
    px[i * 4] = v;
    px[i * 4 + 1] = (x >> 5) % 3 === 1 ? Math.floor(r() * 256) : v; // colour
    px[i * 4 + 2] = Math.max(0, v - (y % 7) * 9);
    px[i * 4 + 3] = y % 11 === 0 ? Math.floor(r() * 256) : 255;
  }
  return px;
}

const cases = [];
const sizes = [[64, 48, 1], [131, 77, 2], [3, 3, 3], [257, 5, 4], [5, 300, 5]];
for (const [w, h, seed] of sizes) {
  const source = image(w, h, seed);
  const sourceFile = save(`src-${w}x${h}.rgba.z`, source);
  for (const amount of SHARPEN_LEVELS.filter((a) => a > 0)) {
    const result = sharpenRgba(source.slice(), w, h, amount);
    cases.push({ name: `${w}x${h} amount ${amount}`, width: w, height: h, 'amount#': bits(amount), source: sourceFile, result: save(`out-${w}x${h}-${String(amount).replace('.', '_')}.rgba.z`, result) });
  }
}
// Extremes: all black, all white, and values that land exactly on a half.
for (const [name, fill] of [['black', 0], ['white', 255], ['mid', 128]]) {
  const w = 9, h = 9;
  const source = new Uint8ClampedArray(w * h * 4).fill(fill);
  for (let i = 0; i < w * h; i++) if (i % 2) source[i * 4] = 255 - fill;
  cases.push({ name, width: w, height: h, 'amount#': bits(0.5), source: save(`src-${name}.rgba.z`, source), result: save(`out-${name}.rgba.z`, sharpenRgba(source.slice(), w, h, 0.5)) });
}
writeFileSync(out + 'cases.json.z', deflateSync(Buffer.from(JSON.stringify(cases)), { level: 9 }));
console.log(`${cases.length} cases`);
