// Alignment between the old and the new page of a compare pair (#465).
//
// An alignment is a similarity transform expressed in terms a user can read
// and type: a shift in millimetres on paper, a rotation in degrees and a scale
// factor, all about the page centres. It maps a point of the OLD page onto the
// NEW page (both in PDF points, top-left origin, as pdf.js viewports at
// scale 1):
//
//   p_new = c_new + s · R(θ) · (p_old − c_old) + t
//
// With identity parameters the two page centres coincide, so the same drawing
// plotted to A1 and to A3 needs only a scale factor. The detection, the split
// line view and the highlights on the old page all derive their transforms from
// here, so they can never disagree.
//
// Matrices use the canvas convention [a, b, c, d, e, f]:
//   x' = a·x + c·y + e,  y' = b·x + d·y + f
//
// Pure module. Unit tested in compare-alignment.test.mjs.

import { PT_PER_MM, MM_PER_PT } from './detect-plan.js';

export const IDENTITY_ALIGNMENT = Object.freeze({ dx: 0, dy: 0, rotation: 0, scale: 1 });

const num = (v, d = 0) => (Number.isFinite(v) ? v : d);

/** Fill missing or invalid fields. */
export function normalizeAlignment(a) {
  const o = a || {};
  const scale = num(o.scale, 1);
  return {
    dx: num(o.dx),
    dy: num(o.dy),
    rotation: num(o.rotation),
    scale: scale > 0 ? scale : 1,
  };
}

export function isIdentityAlignment(a, eps = 1e-9) {
  const n = normalizeAlignment(a);
  return Math.abs(n.dx) < eps && Math.abs(n.dy) < eps && Math.abs(n.rotation) < eps && Math.abs(n.scale - 1) < eps;
}

/**
 * Old page points -> new page points.
 * @param {object} align {dx, dy (mm), rotation (deg), scale}
 * @param {{width:number,height:number}} oldSize points
 * @param {{width:number,height:number}} newSize points
 */
export function alignmentMatrix(align, oldSize, newSize) {
  const { dx, dy, rotation, scale } = normalizeAlignment(align);
  const r = (rotation * Math.PI) / 180;
  const a = scale * Math.cos(r);
  const b = scale * Math.sin(r);
  const c = -b;
  const d = a;
  const cox = num(oldSize?.width) / 2;
  const coy = num(oldSize?.height) / 2;
  const cnx = num(newSize?.width) / 2;
  const cny = num(newSize?.height) / 2;
  const e = cnx + dx * PT_PER_MM - (a * cox + c * coy);
  const f = cny + dy * PT_PER_MM - (b * cox + d * coy);
  return [a, b, c, d, e, f];
}

/** Inverse of a similarity transform from a matrix (old pt -> new pt). */
export function matrixToAlignment(m, oldSize, newSize) {
  const [a, b, , , e, f] = m;
  const scale = Math.hypot(a, b);
  const rotation = (Math.atan2(b, a) * 180) / Math.PI;
  const cox = num(oldSize?.width) / 2;
  const coy = num(oldSize?.height) / 2;
  const cnx = num(newSize?.width) / 2;
  const cny = num(newSize?.height) / 2;
  // e = cnx + tx − (a·cox − b·coy); f = cny + ty − (b·cox + a·coy)
  const tx = e - cnx + (a * cox - b * coy);
  const ty = f - cny + (b * cox + a * coy);
  return { dx: tx * MM_PER_PT, dy: ty * MM_PER_PT, rotation, scale };
}

export function multiply(m1, m2) {
  // m1 ∘ m2 (apply m2 first)
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

export function invert(m) {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (!det) return [1, 0, 0, 1, 0, 0];
  const ia = d / det;
  const ib = -b / det;
  const ic = -c / det;
  const id = a / det;
  return [ia, ib, ic, id, -(ia * e + ic * f), -(ib * e + id * f)];
}

export function applyPoint(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Bounding box of a transformed rectangle {x, y, width, height}. */
export function applyRect(m, r) {
  const pts = [
    applyPoint(m, r.x, r.y),
    applyPoint(m, r.x + r.width, r.y),
    applyPoint(m, r.x, r.y + r.height),
    applyPoint(m, r.x + r.width, r.y + r.height),
  ];
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x1) x1 = x;
    if (y < y1) y1 = y;
    if (x > x2) x2 = x;
    if (y > y2) y2 = y;
  }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/** Uniform scaling matrix (points -> pixels at k px/pt). */
export function scaling(k) {
  return [k, 0, 0, k, 0, 0];
}

/**
 * Old-mask pixels -> new-mask pixels, both rasterised at pxPerPt.
 */
export function pixelMatrix(align, oldSize, newSize, pxPerPt) {
  return multiply(scaling(pxPerPt), multiply(alignmentMatrix(align, oldSize, newSize), scaling(1 / pxPerPt)));
}

/**
 * CSS transform (transform-origin 0 0) for the OLD page canvas in the split
 * line view, both canvases rendered at `visualScale` px per point.
 */
export function alignmentCss(align, oldSize, newSize, visualScale) {
  const m = pixelMatrix(align, oldSize, newSize, visualScale > 0 ? visualScale : 1);
  const r = (v) => Math.round(v * 1e6) / 1e6;
  return `matrix(${m.map(r).join(', ')})`;
}

// ── Measuring scale ────────────────────────────────────────────────────────

const UNIT_MM = { mm: 1, cm: 10, dm: 100, m: 1000, km: 1_000_000, in: 25.4, inch: 25.4, '"': 25.4, ft: 304.8, "'": 304.8, yd: 914.4, mi: 1_609_344 };

/** Points on paper per real-world millimetre for one viewport, or null. */
function ptPerRealMm(vp) {
  if (!vp || !(vp.pixelsPerUnit > 0)) return null;
  const unit = String(vp.unit || 'mm').trim().toLowerCase();
  const mm = UNIT_MM[unit];
  if (!mm) return null;
  return vp.pixelsPerUnit / mm;
}

function largestViewport(list) {
  let best = null;
  for (const vp of list || []) {
    if (!vp || !(vp.pixelsPerUnit > 0)) continue;
    const area = num(vp.width) * num(vp.height);
    if (!best || area > best.area) best = { vp, area };
  }
  return best ? best.vp : null;
}

/**
 * Scale factor between the pages from their measuring scales, when both carry
 * one (PDF viewports /VP + /Measure, or a document scale). Same drawing at
 * 1:50 on A1 and 1:100 on A3 gives 0.5.
 * @param {Array|object|null} oldScales list of viewports {pixelsPerUnit, unit, width, height} or one scale
 * @param {Array|object|null} newScales
 * @returns {number|null}
 */
export function measureScaleRatio(oldScales, newScales) {
  const pick = (s) => (Array.isArray(s) ? largestViewport(s) : s);
  const o = ptPerRealMm(pick(oldScales));
  const n = ptPerRealMm(pick(newScales));
  if (!o || !n) return null;
  const ratio = n / o;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}
