// Golden fixtures for the Rust port of the Compare pixel work
// (pdfium-worker/src/compare/tests.rs).
//
// Each case stores the inputs the JS modules saw (ink masks, an RGBA tile)
// and what js/compare/* returned for them: writeInkTile, estimateBackground,
// estimateAlignment and detectMaskChanges. The Rust tests feed the same
// inputs to the port and require the same output.
//
// Masks are zlib-compressed bytes (stride x height). Matrices that are INPUTS
// are stored as f64 bit patterns (hex) so they reach Rust bit for bit; outputs
// are plain JSON numbers and compared with a stated tolerance.
//
// Run from open-pdf-studio/:  node scripts/bench-rust/compare-golden.mjs
// (rewrites pdfium-worker/tests/fixtures/compare/).

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { createCanvas } from '@napi-rs/canvas';
import { makePair } from './compare-fixtures.mjs';
import { openDoc, jsPipeline } from './compare-js-pipeline.mjs';
import { planPair, detectionParams } from '../../js/compare/detect-plan.js';
import { estimateBackground, rgbaToMask, countInk } from '../../js/compare/ink-mask.js';
import { estimateAlignment } from '../../js/compare/auto-align.js';
import { detectMaskChanges } from '../../js/compare/mask-detect.js';
import { pixelMatrix } from '../../js/compare/alignment.js';
import { SHEETS_MM, drawingFor, rasterize, plotMap, sheetPt } from '../../js/compare/synthetic-sheets.mjs';

const here = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const outDir = join(here, '..', '..', '..', 'pdfium-worker', 'tests', 'fixtures', 'compare');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const hex = (v) => {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v, true);
  return dv.getBigUint64(0, true).toString(16).padStart(16, '0');
};
const hexMatrix = (m) => (m ? m.map(hex) : null);

// Outputs keep their JSON numbers for reading, plus the exact bit pattern of
// every non-integer under "<key>#" so the Rust test can compare bit for bit.
function withBits(v) {
  if (Array.isArray(v)) return v.map(withBits);
  if (!v || typeof v !== 'object') return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    out[k] = withBits(x);
    if (typeof x === 'number' && !Number.isInteger(x)) out[`${k}#`] = hex(x);
  }
  return out;
}

function writeMask(name, mask) {
  const file = `${name}.mask.z`;
  writeFileSync(join(outDir, file), deflateSync(mask.data, { level: 9 }));
  return { width: mask.width, height: mask.height, stride: mask.stride, file };
}

function detectCase(oldMask, newMask, params, transform) {
  const res = detectMaskChanges(oldMask, newMask, { ...params, transform });
  return {
    params: {
      tolerance_px: params.tolerancePx, min_area_px: params.minAreaPx, merge_px: params.mergePx,
      noise_px: params.noisePx, max_runs: params.maxRuns ?? 2_000_000,
    },
    transform: hexMatrix(transform),
    expected: withBits(res),
  };
}

const cases = [];

// 1 + 2: pdf.js-rendered masks of the generated A3 pair, plain and shifted.
for (const shift of [false, true]) {
  const name = shift ? 'a3-shift' : 'a3-plain';
  const p = await makePair('A3', { shift });
  const [o, n] = await Promise.all([openDoc(p.oldBytes), openDoc(p.newBytes)]);
  const r = await jsPipeline(o, n, { autoAlign: true });
  const { oldMask, newMask } = r.masks;
  const align = estimateAlignment(oldMask, newMask, { pxPerPt: r.pxPerPt, oldSize: r.oldSize, newSize: r.newSize, measureRatio: null });
  const T = pixelMatrix(align.alignment, r.oldSize, r.newSize, r.pxPerPt);
  const detects = [];
  for (const preset of ['line', 'scan', 'text']) {
    detects.push({ preset, ...detectCase(oldMask, newMask, detectionParams(preset, r.mmPerPx), T) });
  }
  // The identity path (direct rows, no resampling) as well.
  detects.push({ preset: 'line-identity', ...detectCase(oldMask, newMask, detectionParams('line', r.mmPerPx), null) });
  // A tiny run budget: the truncated path.
  detects.push({ preset: 'line-truncated', ...detectCase(oldMask, newMask, { ...detectionParams('line', r.mmPerPx), maxRuns: 500 }, null) });
  cases.push({
    name,
    old: writeMask(`${name}-old`, oldMask),
    new: writeMask(`${name}-new`, newMask),
    align: { px_per_pt: hex(r.pxPerPt), old_size: withBits(r.oldSize), new_size: withBits(r.newSize), measure_ratio: null, expected: withBits(align) },
    detects,
  });
  await o.loadingTask?.destroy?.();
  await n.loadingTask?.destroy?.();
}

// 3 + 4: synthetic plots with a scale and a quarter turn (different grids,
// swapped orientation, the second rotation base).
{
  const A3 = SHEETS_MM.A3;
  const A4 = SHEETS_MM.A4;
  const A4p = { width: A4.height, height: A4.width };
  for (const [name, from, to, plot, measure] of [
    ['scale', A3, A4, { scale: 0.7068, dx: 0.8, dy: -0.3 }, null],
    ['rot90', A4, A4p, { rotation: 90, dx: -0.5, dy: 0.4 }, null],
    ['measure', A3, A4, { scale: 0.5, dx: 0, dy: 0 }, 0.5],
  ]) {
    const po = sheetPt(from);
    const pn = sheetPt(to);
    const plan = planPair(po, pn);
    const segs = drawingFor(from, 11, { strokes: 900 });
    const oldM = rasterize(from, segs, plan.mmPerPx);
    const added = [...segs, { x1: from.width * 0.4, y1: from.height * 0.5, x2: from.width * 0.4 + 6, y2: from.height * 0.5, t: 0.35 }];
    const newM = rasterize(to, added.filter((_, i) => i !== 7), plan.mmPerPx, plotMap(from, to, plot));
    const align = estimateAlignment(oldM, newM, { pxPerPt: plan.pxPerPt, oldSize: po, newSize: pn, measureRatio: measure });
    const T = pixelMatrix(align.alignment, po, pn, plan.pxPerPt);
    cases.push({
      name,
      old: writeMask(`${name}-old`, oldM),
      new: writeMask(`${name}-new`, newM),
      align: { px_per_pt: hex(plan.pxPerPt), old_size: withBits(po), new_size: withBits(pn), measure_ratio: measure, expected: withBits(align) },
      detects: [{ preset: 'line', ...detectCase(oldM, newM, detectionParams('line', plan.mmPerPx), T) }],
    });
  }
}

// 5: ink mask from an RGBA render (anti-aliased lines and text, a tinted
// background and transparent pixels).
{
  const p = await makePair('A3', { shift: false });
  const doc = await openDoc(p.newBytes);
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 1.2 });
  const w = 640;
  const h = 420;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f4f1e8';
  ctx.fillRect(0, 0, w, h);
  await page.render({ canvas, canvasContext: ctx, viewport: vp, transform: [1, 0, 0, 1, -900, -300], intent: 'display' }).promise;
  ctx.clearRect(600, 0, 40, 30); // transparent corner
  const img = ctx.getImageData(0, 0, w, h);
  const bg = estimateBackground(img.data, w, h);
  const masks = [];
  for (const threshold of [96, 128, 170]) {
    const m = rgbaToMask(img.data, w, h, bg, threshold);
    masks.push({ threshold, ink: countInk(m), mask: writeMask(`ink-${threshold}`, m) });
  }
  // A white-on-dark variant: transparent pixels then count as ink.
  const darkBg = { r: 20, g: 20, b: 30 };
  const dark = rgbaToMask(img.data, w, h, darkBg, 96);
  masks.push({ threshold: 96, bg: darkBg, ink: countInk(dark), mask: writeMask('ink-dark', dark) });
  const rgbaFile = 'ink-tile.rgba.z';
  writeFileSync(join(outDir, rgbaFile), deflateSync(img.data, { level: 9 }));
  cases.push({ name: 'ink', rgba: { width: w, height: h, file: rgbaFile }, background: bg, background_small: estimateBackground(img.data, w, h, 5000), masks });
  await doc.loadingTask?.destroy?.();
}

writeFileSync(join(outDir, 'cases.json'), JSON.stringify({ generator: 'open-pdf-studio/scripts/bench-rust/compare-golden.mjs', cases }, null, 1));
console.log(`wrote ${cases.length} cases to ${outDir}`);
