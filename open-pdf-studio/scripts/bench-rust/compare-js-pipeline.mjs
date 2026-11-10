// The JS pixel pipeline of Compare, reproduced under node for measuring.
//
// Mirrors js/compare/compare-viewport.js (_preview, getCompareMask and the
// pixel branch of computePairChanges) with the same pure modules the app runs
// (detect-plan, ink-mask, auto-align, mask-detect, alignment). Rendering uses
// pdf.js with @napi-rs/canvas instead of the WebView canvas, so render times
// are indicative; every other stage is the app code itself.

import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import { planPair, planTiles, detectionParams } from '../../js/compare/detect-plan.js';
import { createMask, writeInkTile, estimateBackground } from '../../js/compare/ink-mask.js';
import { estimateAlignment } from '../../js/compare/auto-align.js';
import { detectMaskChanges } from '../../js/compare/mask-detect.js';
import { alignmentMatrix, multiply, scaling, normalizeAlignment } from '../../js/compare/alignment.js';

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

const now = () => Number(process.hrtime.bigint()) / 1e6;
// The standard fonts the app hands pdf.js (js/core/basis-url.js), so
// non-embedded fonts are drawn with the same glyphs as in the app.
const fontDir = fileURLToPath(new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)).split(String.fromCharCode(92)).join('/');

export async function openDoc(bytes) {
  return pdfjs.getDocument({
    data: Uint8Array.from(bytes), isEvalSupported: false, disableFontFace: true, verbosity: 0, standardFontDataUrl: fontDir,
  }).promise;
}

async function renderInto(page, vp, w, h, tx, ty) {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  await page.render({ canvas, canvasContext: ctx, viewport: vp, transform: [1, 0, 0, 1, -tx, -ty], intent: 'display' }).promise;
  return ctx.getImageData(0, 0, w, h);
}

/** _preview(): background colour from a 256 px render. */
export async function previewBackground(page) {
  const base = page.getViewport({ scale: 1 });
  const scale = 256 / Math.max(base.width, base.height);
  const vp = page.getViewport({ scale });
  const w = Math.ceil(vp.width);
  const h = Math.ceil(vp.height);
  const img = await renderInto(page, vp, w, h, 0, 0);
  return estimateBackground(img.data, w, h);
}

/** getCompareMask(): tiled render + ink mask, with the time split. */
export async function maskFor(page, pxPerPt, threshold, t) {
  const t0 = now();
  const bg = await previewBackground(page);
  t.preview += now() - t0;
  const vp = page.getViewport({ scale: pxPerPt });
  const W = Math.max(1, Math.ceil(vp.width));
  const H = Math.max(1, Math.ceil(vp.height));
  const mask = createMask(W, H);
  for (const tile of planTiles(W, H)) {
    const a = now();
    const img = await renderInto(page, vp, tile.w, tile.h, tile.x, tile.y);
    const b = now();
    writeInkTile(mask, img.data, tile.w, tile.h, tile.x, tile.y, bg, threshold);
    const c = now();
    t.render += b - a;
    t.ink += c - b;
  }
  return mask;
}

const _quantScale = (s) => Math.exp(Math.round(Math.log(s) / 0.005) * 0.005);

/**
 * computePairChanges() pixel branch for page 1 of two documents.
 * @returns {{changes, clusters, alignInfo, alignment, truncated, mmPerPx, pxPerPt, oldPx, times}}
 */
export async function jsPipeline(oldDoc, newDoc, { preset = 'line', autoAlign = false, offset = null } = {}) {
  const t = { preview: 0, render: 0, ink: 0, align: 0, detect: 0, total: 0 };
  const T0 = now();
  const [op, np] = await Promise.all([oldDoc.getPage(1), newDoc.getPage(1)]);
  const ov = op.getViewport({ scale: 1 });
  const nv = np.getViewport({ scale: 1 });
  const oldSize = { width: ov.width, height: ov.height };
  const newSize = { width: nv.width, height: nv.height };
  const plan = planPair(oldSize, newSize);
  const params = detectionParams(preset, plan.mmPerPx);
  const oldMask = await maskFor(op, plan.pxPerPt, params.threshold, t);
  const newMask = await maskFor(np, plan.pxPerPt, params.threshold, t);
  let alignment = normalizeAlignment(offset);
  let alignInfo = null;
  if (autoAlign) {
    const a = now();
    alignInfo = estimateAlignment(oldMask, newMask, { pxPerPt: plan.pxPerPt, oldSize, newSize, measureRatio: null });
    t.align += now() - a;
    alignment = normalizeAlignment(alignInfo.alignment);
  }
  let oldDet = oldMask;
  let oldPx = plan.pxPerPt;
  if (Math.abs(alignment.scale - 1) > 0.02) {
    oldPx = plan.pxPerPt * _quantScale(alignment.scale);
    oldDet = await maskFor(op, oldPx, params.threshold, t);
  }
  const transform = multiply(scaling(plan.pxPerPt), multiply(alignmentMatrix(alignment, oldSize, newSize), scaling(1 / oldPx)));
  const d = now();
  const res = detectMaskChanges(oldDet, newMask, { ...params, transform });
  t.detect += now() - d;
  t.total = now() - T0;
  return {
    clusters: res.clusters, runs: res.runs, components: res.components, truncated: res.truncated,
    alignInfo, alignment, mmPerPx: plan.mmPerPx, pxPerPt: plan.pxPerPt, oldPx, params, oldSize, newSize,
    mask: { width: newMask.width, height: newMask.height }, masks: { oldMask, newMask }, times: t,
  };
}
