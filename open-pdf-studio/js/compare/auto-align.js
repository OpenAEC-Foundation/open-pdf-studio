// Automatic alignment of a compare pair (#465).
//
// Estimates translation, rotation and scale between the old and the new page
// from their ink masks, coarse to fine:
//
//   1. Coarse search on a ~192 px density raster: every candidate scale (1,
//      the paper size ratios, the measuring-scale ratio when both pages carry
//      one) and rotation (the sheet orientation plus a few degrees either way)
//      is scored by phase correlation, which also yields the translation.
//   2. Refinement at ~768 px and ~2048 px: a grid of patches is phase
//      correlated against the old page warped by the current estimate; the
//      patch shifts are correspondences, and a robust least-squares fit of a
//      similarity transform updates translation, rotation and scale.
//   3. Confidence: the share of ink that finds ink on the other side within
//      one raster cell (an F-score of both directions) at the finest level.
//      The identity is kept when it is as good as the estimate.
//
// Pure module: runs in the detection worker and in node tests.

import { downsampleDensity } from './ink-mask.js';
import { phaseCorrelate, spectrum } from './fft.js';
import { pixelMatrix, invert, applyPoint, multiply, scaling, matrixToAlignment, IDENTITY_ALIGNMENT } from './alignment.js';

const COARSE_SIDE = 192;
const COARSE_N = 256;
const LEVELS = [768, 2048];
const PATCH = 64;
const PATCH_GRID = 7;

function bilinear(d, x, y) {
  // d: {width,height,data}; (x, y) in cell units, cell centres at i + 0.5
  const fx = x - 0.5;
  const fy = y - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const W = d.width;
  const H = d.height;
  if (x0 < -1 || y0 < -1 || x0 >= W || y0 >= H) return 0;
  const tx = fx - x0;
  const ty = fy - y0;
  const data = d.data;
  const inX0 = x0 >= 0, inX1 = x0 + 1 < W, inY0 = y0 >= 0, inY1 = y0 + 1 < H;
  const r0 = y0 * W;
  const r1 = r0 + W;
  const v00 = inX0 && inY0 ? data[r0 + x0] : 0;
  const v10 = inX1 && inY0 ? data[r0 + x0 + 1] : 0;
  const v01 = inX0 && inY1 ? data[r1 + x0] : 0;
  const v11 = inX1 && inY1 ? data[r1 + x0 + 1] : 0;
  return (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
}

// Render the old density into an n x n grid in new-level coordinates.
// M maps old full px -> new full px; both levels use factor k.
function warpInto(oldD, M, k, n, x0 = 0, y0 = 0, out = new Float64Array(n * n)) {
  const inv = invert(M);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const px = (x0 + x + 0.5) * k;
      const py = (y0 + y + 0.5) * k;
      const ox = inv[0] * px + inv[2] * py + inv[4];
      const oy = inv[1] * px + inv[3] * py + inv[5];
      out[y * n + x] = bilinear(oldD, ox / k, oy / k);
    }
  }
  return out;
}

function placeInto(d, n, x0 = 0, y0 = 0, out = new Float64Array(n * n)) {
  for (let y = 0; y < n; y++) {
    const sy = y0 + y;
    if (sy < 0 || sy >= d.height) continue;
    for (let x = 0; x < n; x++) {
      const sx = x0 + x;
      if (sx < 0 || sx >= d.width) continue;
      out[y * n + x] = d.data[sy * d.width + sx];
    }
  }
  return out;
}

const _hann = new Map();
function hann(n) {
  let w = _hann.get(n);
  if (!w) {
    w = new Float64Array(n * n);
    for (let y = 0; y < n; y++) {
      const wy = 0.5 - 0.5 * Math.cos((2 * Math.PI * (y + 0.5)) / n);
      for (let x = 0; x < n; x++) w[y * n + x] = wy * (0.5 - 0.5 * Math.cos((2 * Math.PI * (x + 0.5)) / n));
    }
    _hann.set(n, w);
  }
  return w;
}

function sum(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return s;
}

function dedupe(list, rel = 0.004) {
  const out = [];
  for (const v of list) {
    if (!(v > 0) || !Number.isFinite(v)) continue;
    if (!out.some((u) => Math.abs(u - v) / v < rel)) out.push(v);
  }
  return out;
}

// Weighted least squares for q = [a −b; b a]·p + t. Returns a matrix or null.
function fitSimilarity(pairs) {
  if (pairs.length < 3) return null;
  let sw = 0, mpx = 0, mpy = 0, mqx = 0, mqy = 0;
  for (const c of pairs) { sw += c.w; mpx += c.w * c.px; mpy += c.w * c.py; mqx += c.w * c.qx; mqy += c.w * c.qy; }
  mpx /= sw; mpy /= sw; mqx /= sw; mqy /= sw;
  let sxx = 0, sab = 0, sba = 0;
  for (const c of pairs) {
    const px = c.px - mpx, py = c.py - mpy, qx = c.qx - mqx, qy = c.qy - mqy;
    sxx += c.w * (px * px + py * py);
    sab += c.w * (px * qx + py * qy);
    sba += c.w * (px * qy - py * qx);
  }
  if (sxx < 1e-9) return null;
  const a = sab / sxx;
  const b = sba / sxx;
  const tx = mqx - (a * mpx - b * mpy);
  const ty = mqy - (b * mpx + a * mpy);
  return [a, b, -b, a, tx, ty];
}

// Density rasters are needed several times per level: compute each once.
function densityCache() {
  const memo = new Map();
  return (mask, k) => {
    let m = memo.get(mask);
    if (!m) { m = new Map(); memo.set(mask, m); }
    let d = m.get(k);
    if (!d) { d = downsampleDensity(mask, k); m.set(k, d); }
    return d;
  };
}

function refineLevel(oldMask, newMask, M, targetSide, dens) {
  const maxDim = Math.max(newMask.width, newMask.height);
  const k = Math.max(1, Math.ceil(maxDim / targetSide));
  const newD = dens(newMask, k);
  const oldD = dens(oldMask, k);
  const pairs = [];
  const P = PATCH;
  const win = hann(P);
  const inv = invert(M);
  const A = new Float64Array(P * P);
  const B = new Float64Array(P * P);
  const spanX = Math.max(0, newD.width - P);
  const spanY = Math.max(0, newD.height - P);
  for (let gy = 0; gy < PATCH_GRID; gy++) {
    for (let gx = 0; gx < PATCH_GRID; gx++) {
      const x0 = Math.round((spanX * (gx + 0.5)) / PATCH_GRID);
      const y0 = Math.round((spanY * (gy + 0.5)) / PATCH_GRID);
      A.fill(0);
      B.fill(0);
      placeInto(newD, P, x0, y0, A);
      warpInto(oldD, M, k, P, x0, y0, B);
      const sa = sum(A);
      const sb = sum(B);
      // Too little ink in the patch to say anything.
      if (sa < P * P * 0.004 || sb < P * P * 0.004) continue;
      for (let i = 0; i < P * P; i++) { A[i] *= win[i]; B[i] *= win[i]; }
      const r = phaseCorrelate(A, B, P, { maxShift: P / 4 });
      if (!(r.peak > 0.06)) continue;
      const cx = x0 + P / 2;
      const cy = y0 + P / 2;
      // New content at c matches warped-old content at c − d.
      const [px, py] = applyPoint(inv, (cx - r.dx) * k, (cy - r.dy) * k);
      pairs.push({ px, py, qx: cx * k, qy: cy * k, w: r.peak });
    }
  }
  if (!pairs.length) return { M, k, pairs: 0 };
  let fit = fitSimilarity(pairs);
  if (fit) {
    // One round of outlier rejection (patches that contain a real change).
    const res = pairs.map((c) => {
      const [x, y] = applyPoint(fit, c.px, c.py);
      return Math.hypot(x - c.qx, y - c.qy);
    });
    const sorted = [...res].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    const lim = Math.max(3 * med, 1.5 * k);
    const inliers = pairs.filter((_, i) => res[i] <= lim);
    const fit2 = fitSimilarity(inliers);
    if (fit2) fit = fit2;
  }
  if (!fit) {
    // Translation only: weighted mean of the patch shifts.
    let sw = 0, sx = 0, sy = 0;
    for (const c of pairs) {
      const [x, y] = applyPoint(M, c.px, c.py);
      sw += c.w; sx += c.w * (c.qx - x); sy += c.w * (c.qy - y);
    }
    const out = M.slice();
    out[4] += sx / sw;
    out[5] += sy / sw;
    return { M: out, k, pairs: pairs.length };
  }
  // Reject implausible jumps away from the coarse estimate.
  const s0 = Math.hypot(M[0], M[1]);
  const s1 = Math.hypot(fit[0], fit[1]);
  const r0 = Math.atan2(M[1], M[0]);
  const r1 = Math.atan2(fit[1], fit[0]);
  if (Math.abs(s1 / s0 - 1) > 0.05 || Math.abs(r1 - r0) > (2 * Math.PI) / 180) return { M, k, pairs: pairs.length };
  return { M: fit, k, pairs: pairs.length };
}

/**
 * F-score of ink overlap at factor k: ink cells of one side that find ink on
 * the other side within one cell, both directions.
 */
export function overlapScore(oldMask, newMask, M, k, dens = densityCache()) {
  const newD = dens(newMask, k);
  const oldD = dens(oldMask, k);
  const has = (d, x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    for (let yy = yi - 1; yy <= yi + 1; yy++) {
      if (yy < 0 || yy >= d.height) continue;
      for (let xx = xi - 1; xx <= xi + 1; xx++) {
        if (xx < 0 || xx >= d.width) continue;
        if (d.data[yy * d.width + xx] > 0) return true;
      }
    }
    return false;
  };
  const inv = invert(M);
  const ratio = (from, to, m) => {
    let total = 0;
    let hit = 0;
    const step = Math.max(1, Math.floor(Math.sqrt((from.width * from.height) / 1_000_000)));
    for (let y = 0; y < from.height; y += step) {
      for (let x = 0; x < from.width; x += step) {
        if (!(from.data[y * from.width + x] > 0)) continue;
        total++;
        const [tx, ty] = applyPoint(m, (x + 0.5) * k, (y + 0.5) * k);
        if (has(to, tx / k, ty / k)) hit++;
      }
    }
    return total ? hit / total : 0;
  };
  const recall = ratio(newD, oldD, inv);
  const precision = ratio(oldD, newD, M);
  return precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
}

/**
 * Estimate the alignment of a pair.
 * @param {{width:number,height:number,stride:number,data:Uint8Array}} oldMask
 * @param {{width:number,height:number,stride:number,data:Uint8Array}} newMask
 * @param {{pxPerPt:number, oldSize:{width:number,height:number}, newSize:{width:number,height:number},
 *   measureRatio?:number|null, rotationRange?:number}} opts
 * @returns {{alignment:{dx:number,dy:number,rotation:number,scale:number}, confidence:number,
 *   identityConfidence:number, method:string}}
 */
export function estimateAlignment(oldMask, newMask, opts) {
  const { pxPerPt, oldSize, newSize } = opts;
  const rotRange = Number.isFinite(opts.rotationRange) ? opts.rotationRange : 3;
  const swapped = (oldSize.width > oldSize.height) !== (newSize.width > newSize.height)
    && Math.abs(oldSize.width - oldSize.height) > 1 && Math.abs(newSize.width - newSize.height) > 1;
  // Same paper: scale 1. Other paper: the side ratios (fit width, fit height,
  // equal area). The measuring scale of both pages is always a candidate.
  const ow = swapped ? oldSize.height : oldSize.width;
  const oh = swapped ? oldSize.width : oldSize.height;
  const scales = dedupe([
    1,
    newSize.width / ow,
    newSize.height / oh,
    Math.sqrt((newSize.width * newSize.height) / (ow * oh)),
    opts.measureRatio || 0,
  ], 0.01);
  const bases = swapped ? [90, -90] : [0, 180];

  const maxDim = Math.max(newMask.width, newMask.height, oldMask.width, oldMask.height);
  const kc = Math.max(1, Math.ceil(maxDim / COARSE_SIDE));
  const dens = densityCache();
  const newC = dens(newMask, kc);
  const oldC = dens(oldMask, kc);
  const N = COARSE_N;
  const A = placeInto(newC, N);
  const aSpectrum = spectrum(A, N);
  const B = new Float64Array(N * N);

  const evaluate = (scale, rotation) => {
    const M = pixelMatrix({ dx: 0, dy: 0, rotation, scale }, oldSize, newSize, pxPerPt);
    B.fill(0);
    warpInto(oldC, M, kc, N, 0, 0, B);
    if (sum(B) <= 0) return null;
    const r = phaseCorrelate(A, B, N, { maxShift: N / 4, aSpectrum });
    const out = M.slice();
    out[4] += r.dx * kc;
    out[5] += r.dy * kc;
    return { M: out, peak: r.peak, scale, rotation };
  };

  let best = null;
  const consider = (c) => { if (c && (!best || c.peak > best.peak)) best = c; };
  const fine = [];
  for (let r = -rotRange; r <= rotRange + 1e-9; r += 0.5) fine.push(Math.round(r * 10) / 10);
  for (const base of [bases[0]]) {
    for (const s of scales) for (const fr of fine) consider(evaluate(s, base + fr));
  }
  if (!best || best.peak < 0.12) {
    for (const s of scales) for (const fr of fine) consider(evaluate(s, bases[1] + fr));
  }
  if (!best) {
    return { alignment: { ...IDENTITY_ALIGNMENT }, confidence: 0, identityConfidence: 0, method: 'identity' };
  }
  // Local scale and rotation polish at the coarse level.
  for (const m of [0.985, 0.993, 1.007, 1.015]) consider(evaluate(best.scale * m, best.rotation));
  for (const d of [-0.25, 0.25]) consider(evaluate(best.scale, best.rotation + d));

  let M = best.M;
  let k = kc;
  for (const side of LEVELS) {
    const res = refineLevel(oldMask, newMask, M, side, dens);
    M = res.M;
    k = res.k;
  }
  // Second pass at the finest level converges the fit.
  M = refineLevel(oldMask, newMask, M, LEVELS[LEVELS.length - 1], dens).M;

  const identityM = pixelMatrix(IDENTITY_ALIGNMENT, oldSize, newSize, pxPerPt);
  const confidence = overlapScore(oldMask, newMask, M, k, dens);
  const identityConfidence = overlapScore(oldMask, newMask, identityM, k, dens);
  // Fallback: when the content gives no convincing fit but both pages carry
  // a measuring scale, the scale from those with the centres on each other.
  if (opts.measureRatio > 0 && confidence < 0.5) {
    const measured = { dx: 0, dy: 0, rotation: bases[0], scale: opts.measureRatio };
    const mc = overlapScore(oldMask, newMask, pixelMatrix(measured, oldSize, newSize, pxPerPt), k, dens);
    if (mc > confidence && mc > identityConfidence) {
      return { alignment: measured, confidence: mc, identityConfidence, method: 'measure' };
    }
  }
  if (identityConfidence >= confidence - 0.005) {
    return { alignment: { ...IDENTITY_ALIGNMENT }, confidence: identityConfidence, identityConfidence, method: 'identity' };
  }
  const Mpt = multiply(scaling(1 / pxPerPt), multiply(M, scaling(pxPerPt)));
  const alignment = matrixToAlignment(Mpt, oldSize, newSize);
  const fromMeasure = opts.measureRatio && Math.abs(best.scale / opts.measureRatio - 1) < 0.004;
  return { alignment, confidence, identityConfidence, method: fromMeasure ? 'measure' : 'phase' };
}
