// Synthetic drawing sheets for the Compare tests (#465). Not a test file.
//
// A "drawing" is a list of line segments in millimetres on paper. It is
// rasterised straight into an ink mask at a given resolution, optionally
// through a similarity transform (to simulate a plot shift, a rotated scan or
// the same drawing plotted to another paper size).

import { createMask } from './ink-mask.js';

export const SHEETS_MM = {
  A0: { width: 1189, height: 841 },
  A1: { width: 841, height: 594 },
  A3: { width: 420, height: 297 },
  A4: { width: 297, height: 210 },
};

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * A plausible drawing: a frame, a title block, a grid of walls and many short
 * strokes (text-like), all in mm.
 */
export function drawingFor(sheet, seed = 1, { strokes = 600, lineMm = 0.25 } = {}) {
  const r = rng(seed);
  const { width: W, height: H } = sheet;
  const segs = [];
  const seg = (x1, y1, x2, y2, t = lineMm) => segs.push({ x1, y1, x2, y2, t });
  // Frame and title block.
  seg(10, 10, W - 10, 10, 0.7); seg(W - 10, 10, W - 10, H - 10, 0.7);
  seg(W - 10, H - 10, 10, H - 10, 0.7); seg(10, H - 10, 10, 10, 0.7);
  const tbx = W - 10 - Math.min(180, W * 0.4);
  const tby = H - 10 - Math.min(60, H * 0.2);
  seg(tbx, tby, W - 10, tby, 0.5); seg(tbx, tby, tbx, H - 10, 0.5);
  // Walls.
  const n = 8 + Math.floor(r() * 8);
  for (let i = 0; i < n; i++) {
    const y = 30 + r() * (H - 120);
    const x1 = 30 + r() * (W * 0.4);
    seg(x1, y, x1 + 40 + r() * (W * 0.4), y, 0.5);
    const x = 30 + r() * (W - 100);
    const y1 = 30 + r() * (H * 0.4);
    seg(x, y1, x, y1 + 30 + r() * (H * 0.4), 0.5);
  }
  // Text-like strokes.
  for (let i = 0; i < strokes; i++) {
    const x = 20 + r() * (W - 60);
    const y = 20 + r() * (H - 60);
    const a = r() * Math.PI;
    const l = 1 + r() * 3;
    seg(x, y, x + Math.cos(a) * l, y + Math.sin(a) * l);
  }
  return segs;
}

/**
 * Rasterise segments (mm) into a mask at mmPerPx. `map` optionally maps a
 * point in mm to another point in mm (the plot transform).
 */
export function rasterize(sheet, segs, mmPerPx, map = null, mask = null) {
  const W = Math.ceil(sheet.width / mmPerPx);
  const H = Math.ceil(sheet.height / mmPerPx);
  const m = mask || createMask(W, H);
  const { stride, data } = m;
  for (const s of segs) {
    let [x1, y1] = map ? map(s.x1, s.y1) : [s.x1, s.y1];
    let [x2, y2] = map ? map(s.x2, s.y2) : [s.x2, s.y2];
    x1 /= mmPerPx; y1 /= mmPerPx; x2 /= mmPerPx; y2 /= mmPerPx;
    // Line weight in pixels, at least one pixel (renderers never drop lines).
    const half = Math.max(0.5, s.t / mmPerPx / 2);
    const len = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.max(1, Math.ceil(len * 2));
    const hr = Math.ceil(half);
    for (let k = 0; k <= steps; k++) {
      const cx = x1 + ((x2 - x1) * k) / steps;
      const cy = y1 + ((y2 - y1) * k) / steps;
      for (let yy = Math.floor(cy - hr); yy <= Math.ceil(cy + hr); yy++) {
        if (yy < 0 || yy >= m.height) continue;
        for (let xx = Math.floor(cx - hr); xx <= Math.ceil(cx + hr); xx++) {
          if (xx < 0 || xx >= m.width) continue;
          const dx = xx + 0.5 - cx;
          const dy = yy + 0.5 - cy;
          if (dx * dx + dy * dy <= half * half + 0.25) data[yy * stride + xx] = 1;
        }
      }
    }
  }
  return m;
}

/** Similarity map in mm about the sheet centres (old sheet -> new sheet). */
export function plotMap(oldSheet, newSheet, { dx = 0, dy = 0, rotation = 0, scale = 1 } = {}) {
  const r = (rotation * Math.PI) / 180;
  const c = Math.cos(r) * scale;
  const s = Math.sin(r) * scale;
  const cox = oldSheet.width / 2, coy = oldSheet.height / 2;
  const cnx = newSheet.width / 2, cny = newSheet.height / 2;
  return (x, y) => {
    const ux = x - cox;
    const uy = y - coy;
    return [cnx + c * ux - s * uy + dx, cny + s * ux + c * uy + dy];
  };
}

export const mmToPt = (mm) => (mm * 72) / 25.4;
export const sheetPt = (sheet) => ({ width: mmToPt(sheet.width), height: mmToPt(sheet.height) });
