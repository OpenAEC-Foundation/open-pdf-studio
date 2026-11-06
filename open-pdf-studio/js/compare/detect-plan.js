// Detection resolution plan for Compare (#465).
//
// The detection raster is derived from the paper size: the target is about
// 0.2 mm on paper per raster pixel, whatever the sheet size, so a 2 mm change
// is about ten pixels on A4 and on A0 alike. Pages are rasterised in tiles so
// that only one tile of RGBA pixels exists at a time; what is kept per page is
// a one-byte-per-pixel ink mask. A per-side pixel budget bounds the mask: a
// sheet larger than the budget allows (a long roll plot) gets a coarser
// resolution instead of unbounded memory.
//
// All cluster filters are expressed in millimetres on paper and only turned
// into pixels here, from the resolution that was actually chosen.
//
// Pure module: no DOM, no pdf.js. Unit tested in detect-plan.test.mjs.

export const MM_PER_PT = 25.4 / 72;
export const PT_PER_MM = 72 / 25.4;

/** Target resolution on paper. */
export const TARGET_MM_PER_PX = 0.2;
/** Mask pixel budget per side (1 byte per pixel): A0 at 0.2 mm/px is 25 Mpx. */
export const MAX_MASK_PX = 40_000_000;
/** Largest tile edge (canvas limits of the web views) and tile pixel budget. */
export const MAX_TILE_EDGE = 4096;
export const MAX_TILE_PX = 8_388_608; // 32 MiB of RGBA per tile

/**
 * Sensitivity presets. Each sets threshold, tolerance, minimum cluster size
 * and merge proximity together.
 *   threshold   colour distance to the estimated background (sum of the
 *               absolute R, G and B differences, 0..765) above which a pixel
 *               counts as ink
 *   toleranceMm ink within this distance on the other side counts as the same
 *               ink (absorbs line weight, anti-aliasing and a residual
 *               alignment error)
 *   minAreaMm2  clusters with less changed ink than this are dropped
 *   mergeMm     clusters closer than this are merged into one change
 */
export const SENSITIVITY_PRESETS = Object.freeze({
  line: Object.freeze({ threshold: 96, toleranceMm: 0.25, minAreaMm2: 0.2, mergeMm: 1.5 }),
  scan: Object.freeze({ threshold: 170, toleranceMm: 0.6, minAreaMm2: 2, mergeMm: 3 }),
  text: Object.freeze({ threshold: 128, toleranceMm: 0.3, minAreaMm2: 0.5, mergeMm: 2.5 }),
});

export const DEFAULT_PRESET = 'line';

export function normalizePreset(name) {
  return Object.prototype.hasOwnProperty.call(SENSITIVITY_PRESETS, name) ? name : DEFAULT_PRESET;
}

export function presetSettings(name) {
  return SENSITIVITY_PRESETS[normalizePreset(name)];
}

/**
 * Pixels per PDF point for a millimetre-per-pixel resolution.
 */
export function pxPerPtFor(mmPerPx) {
  return MM_PER_PT / mmPerPx;
}

/**
 * Split a raster of width x height into tiles that respect the edge and pixel
 * budgets. Tiles cover the raster exactly, row by row.
 */
export function planTiles(width, height, { maxEdge = MAX_TILE_EDGE, maxPx = MAX_TILE_PX } = {}) {
  const W = Math.max(1, Math.ceil(width));
  const H = Math.max(1, Math.ceil(height));
  const cols = Math.max(1, Math.ceil(W / maxEdge));
  const tileW = Math.ceil(W / cols);
  const tileH = Math.max(1, Math.min(maxEdge, H, Math.floor(maxPx / tileW)));
  const tiles = [];
  for (let y = 0; y < H; y += tileH) {
    for (let x = 0; x < W; x += tileW) {
      tiles.push({ x, y, w: Math.min(tileW, W - x), h: Math.min(tileH, H - y) });
    }
  }
  return tiles;
}

/**
 * Resolution for a page pair. Both sides share one millimetre-per-pixel value
 * so that raster pixels mean the same distance on paper on both sides (needed
 * for the tolerance and for alignment with scale correction). The larger sheet
 * decides whether the budget forces a coarser value.
 *
 * @param {{width:number,height:number}} oldSize page size in points
 * @param {{width:number,height:number}} newSize page size in points
 * @param {{targetMmPerPx?:number, maxMaskPx?:number}} [opts]
 * @returns {{mmPerPx:number, pxPerPt:number, old:{width:number,height:number}, new:{width:number,height:number}}}
 */
export function planPair(oldSize, newSize, opts = {}) {
  const target = opts.targetMmPerPx > 0 ? opts.targetMmPerPx : TARGET_MM_PER_PX;
  const maxPx = opts.maxMaskPx > 0 ? opts.maxMaskPx : MAX_MASK_PX;
  const areaMm2 = (s) => (s.width * MM_PER_PT) * (s.height * MM_PER_PT);
  const largest = Math.max(areaMm2(oldSize), areaMm2(newSize));
  // Pixels at the target: area / target². Coarsen until within budget.
  let mmPerPx = target;
  if (largest / (target * target) > maxPx) mmPerPx = Math.sqrt(largest / maxPx);
  const pxPerPt = pxPerPtFor(mmPerPx);
  const dims = (s) => ({
    width: Math.max(1, Math.ceil(s.width * pxPerPt)),
    height: Math.max(1, Math.ceil(s.height * pxPerPt)),
  });
  return { mmPerPx, pxPerPt, old: dims(oldSize), new: dims(newSize) };
}

/** Mask row stride: a multiple of 4 so rows can be processed as 32-bit words. */
export function maskStride(width) {
  return (Math.ceil(width) + 3) & ~3;
}

/** Bytes for one mask, and for the largest tile of RGBA pixels. */
export function memoryFor(width, height) {
  const tiles = planTiles(width, height);
  const tileBytes = tiles.reduce((m, t) => Math.max(m, t.w * t.h * 4), 0);
  return { maskBytes: maskStride(width) * Math.ceil(height), tileBytes, tiles: tiles.length };
}

/**
 * Turn a preset (millimetres on paper) into raster pixel parameters for the
 * detection at mmPerPx.
 */
export function detectionParams(preset, mmPerPx) {
  const p = typeof preset === 'string' ? presetSettings(preset) : { ...SENSITIVITY_PRESETS[DEFAULT_PRESET], ...(preset || {}) };
  const px2 = mmPerPx * mmPerPx;
  return {
    threshold: p.threshold,
    tolerancePx: Math.max(0, Math.round(p.toleranceMm / mmPerPx)),
    minAreaPx: Math.max(1, Math.round(p.minAreaMm2 / px2)),
    mergePx: Math.max(0, Math.round(p.mergeMm / mmPerPx)),
    // Isolated specks below a tenth of the minimum never become part of a
    // change, which keeps the merge step small on noisy scans.
    noisePx: Math.max(1, Math.floor(p.minAreaMm2 / px2 / 10)),
    mmPerPx,
  };
}
