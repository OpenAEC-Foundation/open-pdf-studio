// Ink masks for Compare (#465).
//
// A rendered page is reduced to one byte per pixel: 1 where there is ink, 0
// for paper. "Paper" is not assumed to be white: the background colour is
// estimated from the page itself (the most frequent colour of a small preview
// render), so a dark CAD background, a grey scan or a tinted sheet works too.
// Ink is anything whose colour distance to that background exceeds the
// threshold of the sensitivity preset.
//
// Masks have a row stride that is a multiple of 4 (see detect-plan.js) so the
// detection can process four pixels per 32-bit word; padding bytes stay 0.
//
// Pure module: no DOM. Unit tested in compare-detection.test.mjs.

import { maskStride } from './detect-plan.js';

/**
 * Estimate the background colour of a page from RGBA pixels: the dominant
 * colour, quantised to 4 bits per channel, then averaged within that bin.
 * Fully transparent pixels count as white (pages are composited on white).
 * @param {Uint8ClampedArray|Uint8Array} rgba
 * @param {number} width
 * @param {number} height
 * @param {number} [maxSamples] sample at most this many pixels (uniform grid)
 * @returns {{r:number,g:number,b:number}}
 */
export function estimateBackground(rgba, width, height, maxSamples = 250_000) {
  const n = width * height;
  if (!rgba || n <= 0) return { r: 255, g: 255, b: 255 };
  const step = Math.max(1, Math.floor(Math.sqrt(n / maxSamples)));
  const counts = new Uint32Array(4096);
  const sums = new Float64Array(4096 * 3);
  for (let y = 0; y < height; y += step) {
    let p = y * width * 4;
    for (let x = 0; x < width; x += step, p += 4 * step) {
      let r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
      if (rgba[p + 3] === 0) { r = 255; g = 255; b = 255; }
      const bin = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      counts[bin]++;
      sums[bin * 3] += r;
      sums[bin * 3 + 1] += g;
      sums[bin * 3 + 2] += b;
    }
  }
  let best = 0;
  for (let i = 1; i < 4096; i++) if (counts[i] > counts[best]) best = i;
  const c = counts[best] || 1;
  return {
    r: Math.round(sums[best * 3] / c),
    g: Math.round(sums[best * 3 + 1] / c),
    b: Math.round(sums[best * 3 + 2] / c),
  };
}

/** Create an empty mask. */
export function createMask(width, height) {
  const w = Math.max(1, Math.ceil(width));
  const h = Math.max(1, Math.ceil(height));
  const stride = maskStride(w);
  return { width: w, height: h, stride, data: new Uint8Array(stride * h) };
}

/**
 * Write the ink of an RGBA tile into a mask at (ox, oy).
 * @param {{width:number,height:number,stride:number,data:Uint8Array}} mask
 * @param {Uint8ClampedArray|Uint8Array} rgba tile pixels, tileW x tileH
 * @param {number} tileW
 * @param {number} tileH
 * @param {number} ox
 * @param {number} oy
 * @param {{r:number,g:number,b:number}} bg
 * @param {number} threshold
 * @returns {number} ink pixels written
 */
export function writeInkTile(mask, rgba, tileW, tileH, ox, oy, bg, threshold) {
  const { width, height, stride, data } = mask;
  const br = bg.r, bgc = bg.g, bb = bg.b;
  // Transparent pixels are paper: they are composited on white, so they only
  // count as ink when white itself is far from the background.
  const transparentInk = (Math.abs(255 - br) + Math.abs(255 - bgc) + Math.abs(255 - bb)) > threshold ? 1 : 0;
  const w = Math.min(tileW, width - ox);
  const h = Math.min(tileH, height - oy);
  let ink = 0;
  // Fast path: most pixels of a sheet are exactly the paper colour. Compare
  // whole RGBA words against it before computing a distance.
  if ((rgba.byteOffset & 3) === 0 && rgba.buffer) {
    const px = new Uint32Array(rgba.buffer, rgba.byteOffset, (tileW * tileH) | 0);
    const probe = new Uint8Array(new Uint32Array([0x01020304]).buffer)[0] === 4; // little endian
    const paper = probe
      ? ((255 << 24) | (bb << 16) | (bgc << 8) | br) >>> 0
      : ((br << 24) | (bgc << 16) | (bb << 8) | 255) >>> 0;
    for (let y = 0; y < h; y++) {
      let i = y * tileW;
      let q = (oy + y) * stride + ox;
      for (let x = 0; x < w; x++, i++, q++) {
        if (px[i] === paper) { data[q] = 0; continue; }
        const p = i << 2;
        let v;
        if (rgba[p + 3] === 0) v = transparentInk;
        else {
          let d = rgba[p] - br;
          let s = d < 0 ? -d : d;
          d = rgba[p + 1] - bgc;
          s += d < 0 ? -d : d;
          d = rgba[p + 2] - bb;
          s += d < 0 ? -d : d;
          v = s > threshold ? 1 : 0;
        }
        data[q] = v;
        ink += v;
      }
    }
    return ink;
  }
  for (let y = 0; y < h; y++) {
    let p = y * tileW * 4;
    let q = (oy + y) * stride + ox;
    for (let x = 0; x < w; x++, p += 4, q++) {
      let v;
      if (rgba[p + 3] === 0) v = transparentInk;
      else {
        let d = rgba[p] - br;
        let s = d < 0 ? -d : d;
        d = rgba[p + 1] - bgc;
        s += d < 0 ? -d : d;
        d = rgba[p + 2] - bb;
        s += d < 0 ? -d : d;
        v = s > threshold ? 1 : 0;
      }
      data[q] = v;
      ink += v;
    }
  }
  return ink;
}

/** Build a whole mask from one RGBA buffer (tests, small pages). */
export function rgbaToMask(rgba, width, height, bg, threshold) {
  const mask = createMask(width, height);
  writeInkTile(mask, rgba, width, height, 0, 0, bg || estimateBackground(rgba, width, height), threshold);
  return mask;
}

/** Number of ink pixels in a mask. */
export function countInk(mask) {
  let n = 0;
  const d = mask.data;
  for (let i = 0; i < d.length; i++) n += d[i];
  return n;
}

/**
 * Box-downsample a mask by an integer factor into an ink density grid
 * (0..1 per cell).
 * @returns {{width:number,height:number,data:Float32Array}}
 */
export function downsampleDensity(mask, factor) {
  const f = Math.max(1, Math.floor(factor));
  const W = Math.ceil(mask.width / f);
  const H = Math.ceil(mask.height / f);
  const out = new Float32Array(W * H);
  const { width, height, stride, data } = mask;
  // Four pixels per 32-bit word; empty words (most of a drawing) are skipped.
  const words = (stride & 3) === 0 && (data.byteOffset & 3) === 0
    ? new Uint32Array(data.buffer, data.byteOffset, (stride * height) >>> 2)
    : null;
  const S4 = stride >>> 2;
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    const orow = Math.floor(y / f) * W;
    if (words) {
      const wrow = y * S4;
      for (let i = 0; i < S4; i++) {
        if (!words[wrow + i]) continue;
        const x0 = i << 2;
        for (let j = 0; j < 4; j++) {
          const x = x0 + j;
          if (x < width && data[row + x]) out[orow + ((x / f) | 0)] += 1;
        }
      }
      continue;
    }
    for (let x = 0; x < width; x++) {
      if (data[row + x]) out[orow + ((x / f) | 0)] += 1;
    }
  }
  const inv = 1 / (f * f);
  for (let i = 0; i < out.length; i++) out[i] *= inv;
  return { width: W, height: H, data: out };
}
