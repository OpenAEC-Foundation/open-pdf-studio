// Geometry for secure redaction (#762): matrices in PDF row-vector form
// [a b c d e f] (point · M), convex-polygon tests and clipping, curve
// flattening. Regions are convex quadrilaterals (a redaction mark may be
// rotated); everything here works for any convex polygon.

export const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);

/** A then B: point · A · B. */
export function mul(A, B) {
  return [
    A[0] * B[0] + A[1] * B[2], A[0] * B[1] + A[1] * B[3],
    A[2] * B[0] + A[3] * B[2], A[2] * B[1] + A[3] * B[3],
    A[4] * B[0] + A[5] * B[2] + B[4], A[4] * B[1] + A[5] * B[3] + B[5],
  ];
}

export function apply(M, x, y) {
  return [x * M[0] + y * M[2] + M[4], x * M[1] + y * M[3] + M[5]];
}

export function invert(M) {
  const det = M[0] * M[3] - M[1] * M[2];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const a = M[3] / det, b = -M[1] / det, c = -M[2] / det, d = M[0] / det;
  return [a, b, c, d, -(M[4] * a + M[5] * c), -(M[4] * b + M[5] * d)];
}

/** Largest scale factor of a matrix (for tolerances). */
export function scaleOf(M) {
  return Math.max(Math.hypot(M[0], M[1]), Math.hypot(M[2], M[3])) || 1;
}

export function bboxOf(points) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of points) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

export const bboxesOverlap = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

function signedArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length];
    s += x0 * y1 - x1 * y0;
  }
  return s / 2;
}

/** Counter-clockwise copy of a convex polygon, or null when it is degenerate. */
export function normaliseConvex(poly) {
  if (!Array.isArray(poly) || poly.length < 3) return null;
  if (poly.some((p) => !Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return null;
  const a = signedArea(poly);
  if (!(Math.abs(a) > 1e-9)) return null;
  const out = a > 0 ? poly.map((p) => [p[0], p[1]]) : poly.slice().reverse().map((p) => [p[0], p[1]]);
  // Convexity check.
  for (let i = 0; i < out.length; i++) {
    const [ax, ay] = out[i], [bx, by] = out[(i + 1) % out.length], [cx, cy] = out[(i + 2) % out.length];
    if ((bx - ax) * (cy - by) - (by - ay) * (cx - bx) < -1e-9) return null;
  }
  return out;
}

function project(poly, ax, ay) {
  let lo = Infinity, hi = -Infinity;
  for (const [x, y] of poly) { const v = x * ax + y * ay; if (v < lo) lo = v; if (v > hi) hi = v; }
  return [lo, hi];
}

/**
 * Do two convex polygons (any orientation; a degenerate polygon — a segment
 * or a point — is fine) intersect? Touching counts as intersecting.
 */
export function convexIntersect(A, B) {
  for (const P of [A, B]) {
    for (let i = 0; i < P.length; i++) {
      const [x0, y0] = P[i], [x1, y1] = P[(i + 1) % P.length];
      const ax = -(y1 - y0), ay = x1 - x0;
      if (ax === 0 && ay === 0) continue;
      const [a0, a1] = project(A, ax, ay), [b0, b1] = project(B, ax, ay);
      if (a1 < b0 || b1 < a0) return false;
    }
  }
  // Degenerate inputs (segments) need the segment's own normal too, covered
  // above; points need the other polygon's axes, also covered.
  return true;
}

/** Point strictly/loosely inside a CCW convex polygon. */
export function pointInConvex(C, x, y) {
  for (let i = 0; i < C.length; i++) {
    const [x0, y0] = C[i], [x1, y1] = C[(i + 1) % C.length];
    if ((x1 - x0) * (y - y0) - (y1 - y0) * (x - x0) < -1e-9) return false;
  }
  return true;
}

/** Point in a general polygon (even-odd). */
export function pointInPolygon(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Cyrus–Beck: parameter interval [t0, t1] of segment p→q inside convex CCW
 * polygon C, or null when the segment misses it.
 */
export function segmentInside(C, p, q) {
  let t0 = 0, t1 = 1;
  const dx = q[0] - p[0], dy = q[1] - p[1];
  for (let i = 0; i < C.length; i++) {
    const [x0, y0] = C[i], [x1, y1] = C[(i + 1) % C.length];
    // inside: (x1-x0)*(y-y0) - (y1-y0)*(x-x0) >= 0
    const ex = x1 - x0, ey = y1 - y0;
    const num = ex * (p[1] - y0) - ey * (p[0] - x0);
    const den = ex * dy - ey * dx;
    if (Math.abs(den) < 1e-15) { if (num < 0) return null; continue; }
    const t = -num / den;
    if (den > 0) { if (t > t0) t0 = t; } else if (t < t1) t1 = t;
    if (t0 > t1) return null;
  }
  return [t0, t1];
}

export const segmentHitsConvex = (C, p, q) => segmentInside(C, p, q) !== null;

/** Sutherland–Hodgman clip of polygon `poly` against the half-plane a·x + b·y + c >= 0. */
export function clipHalfPlane(poly, a, b, c) {
  const out = [];
  const n = poly.length;
  if (!n) return out;
  for (let i = 0; i < n; i++) {
    const P = poly[i], Q = poly[(i + 1) % n];
    const dp = a * P[0] + b * P[1] + c, dq = a * Q[0] + b * Q[1] + c;
    if (dp >= 0) out.push(P);
    if ((dp >= 0) !== (dq >= 0)) {
      const t = dp / (dp - dq);
      out.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]);
    }
  }
  return out;
}

/** Half-planes (a, b, c with a·x+b·y+c >= 0 inside) of a CCW convex polygon. */
export function halfPlanes(C) {
  const hp = [];
  for (let i = 0; i < C.length; i++) {
    const [x0, y0] = C[i], [x1, y1] = C[(i + 1) % C.length];
    const ex = x1 - x0, ey = y1 - y0;
    // inside value: ex*(y-y0) - ey*(x-x0) = -ey*x + ex*y + (ey*x0 - ex*y0)
    hp.push([-ey, ex, ey * x0 - ex * y0]);
  }
  return hp;
}

const area = (poly) => Math.abs(signedArea(poly));

/**
 * Polygon minus convex region, as a list of polygons that partition the part
 * of `poly` outside C (windows W_i = H_1 ∩ … ∩ H_(i-1) ∩ ¬H_i). Each output
 * keeps the orientation of the input, so filling the union of the outputs
 * with the input's fill rule paints exactly the input outside C.
 */
export function subtractConvex(poly, C) {
  const hp = halfPlanes(C);
  const pieces = [];
  for (let i = 0; i < hp.length; i++) {
    let p = poly;
    for (let k = 0; k < i && p.length; k++) p = clipHalfPlane(p, hp[k][0], hp[k][1], hp[k][2]);
    if (p.length) p = clipHalfPlane(p, -hp[i][0], -hp[i][1], -hp[i][2]);
    if (p.length >= 3 && area(p) > 1e-12) pieces.push(p);
  }
  return pieces;
}

/** Flatten a cubic Bézier (p0 excluded) into points with tolerance `tol`. */
export function flattenCubic(p0, p1, p2, p3, tol, out) {
  const d = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p2[0] - p1[0], p2[1] - p1[1])
    + Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
  const n = Math.min(256, Math.max(2, Math.ceil(Math.sqrt(d / Math.max(tol, 1e-6)))));
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, e = t * t * t;
    out.push([a * p0[0] + b * p1[0] + c * p2[0] + e * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + e * p3[1]]);
  }
  return out;
}

/** Quad (4 corners) of rectangle [x0,y0,x1,y1] under matrix M. */
export function rectQuad(M, x0, y0, x1, y1) {
  return [apply(M, x0, y0), apply(M, x1, y0), apply(M, x1, y1), apply(M, x0, y1)];
}

/** Convex hull (monotone chain), CCW. */
export function convexHull(points) {
  const pts = points.map((p) => [p[0], p[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length <= 2) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}
