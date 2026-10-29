// Inference engine for interactive moves (#519) — PURE geometry, no app state.
//
// Consumes snap candidates (points from collectSnapPoints / PDF content,
// segments from annotation edges / wall faces / PDF vector edges) and infers
// guide lines for the cursor of a move session:
//
//   tracking       the cursor or a snap point of the MOVING selection lines up
//                  horizontally / vertically with a point of other geometry
//   acquired       H/V tracking lines through points the user hovered briefly
//   axis           H/V through the base point (start of the move)
//   polar          polar increments around the base point (polar settings)
//   extension      the extension of an existing line / wall face beyond its
//                  endpoints
//   parallel /     the move direction is (nearly) parallel or perpendicular to
//   perpendicular  a nearby line
//
// Two guides within tolerance give an intersection snap. Every guide is a
// line in CURSOR space: a guide for a probe with offset o (probe = cursor + o)
// is the original line shifted by -o, so "probe lies on L" is the same test
// as "cursor lies on L - o". That keeps own-point and cursor guides in one
// framework and makes intersections between them trivial.
//
// Candidate collection is bounded: points live in a sorted-axis index (H/V
// alignment = binary search) plus a uniform grid (nearest-point queries),
// segments in a uniform grid with an "oversized" list. Nothing on the
// mousemove path scans the whole page.

// ─── Priorities ────────────────────────────────────────────────────────────
// Higher wins. Point object snaps (endpoint, corner, midpoint, centre, vertex,
// start point, quadrant, intersection of geometry …) always beat inference;
// inference beats the "soft" snaps (edge/nearest/grid).
export const INFERENCE_PRIORITY = Object.freeze({
  point: 100,
  intersection: 80,
  locked: 75,
  acquired: 62,
  tracking: 60,
  extension: 60,
  axis: 58,
  parallel: 55,
  perpendicular: 55,
  polar: 50,
  edge: 40,
  nearest: 40,
  grid: 10,
});

// Snap types that are NOT exact points of geometry: they lose against
// inference. Every other type (incl. types added later, e.g. 'vertex' or
// 'startpoint') counts as a point snap.
const SOFT_SNAP_TYPES = new Set(['edge', 'nearest', 'grid', 'polar']);

export function isPointSnapType(type) {
  return !!type && !SOFT_SNAP_TYPES.has(type);
}

/** Priority of an object-snap result (performSnap / corner-to-corner). */
export function snapPriority(type) {
  if (!type) return 0;
  if (isPointSnapType(type)) return INFERENCE_PRIORITY.point;
  return INFERENCE_PRIORITY[type] ?? 0;
}

/**
 * Pick the winner from snap candidates: highest priority, then smallest
 * distance to the cursor. Candidates: { priority, dist, ... }.
 */
export function resolveSnapPriority(candidates) {
  let best = null;
  for (const c of candidates) {
    if (!c) continue;
    if (!best || c.priority > best.priority
        || (c.priority === best.priority && (c.dist ?? 0) < (best.dist ?? 0))) {
      best = c;
    }
  }
  return best;
}

// ─── Line helpers ──────────────────────────────────────────────────────────
// A line is { px, py, dx, dy } with a unit direction.

export function makeLine(px, py, dx, dy) {
  const len = Math.hypot(dx, dy);
  if (!(len > 1e-12)) return null;
  return { px, py, dx: dx / len, dy: dy / len };
}

export function distToLine(l, x, y) {
  return Math.abs((x - l.px) * l.dy - (y - l.py) * l.dx);
}

export function projectOnLine(l, x, y) {
  const t = (x - l.px) * l.dx + (y - l.py) * l.dy;
  return { x: l.px + t * l.dx, y: l.py + t * l.dy, t };
}

/** Intersection of two lines, or null when (nearly) parallel. */
export function intersectLines(a, b, minSin = Math.sin(2 * Math.PI / 180)) {
  const cross = a.dx * b.dy - a.dy * b.dx;
  if (Math.abs(cross) < minSin) return null;
  const t = ((b.px - a.px) * b.dy - (b.py - a.py) * b.dx) / cross;
  return { x: a.px + t * a.dx, y: a.py + t * a.dy };
}

function _sameLine(a, b, eps) {
  const cross = Math.abs(a.dx * b.dy - a.dy * b.dx);
  if (cross > 1e-3) return false;
  return distToLine(a, b.px, b.py) <= eps;
}

/**
 * Screen axis of a direction: 'x' (screen horizontal), 'y' (screen vertical)
 * or null. `quarterTurn` = the view is rotated by 90/270 degrees, so page
 * horizontal shows vertically on screen.
 */
export function screenAxis(dx, dy, quarterTurn = false) {
  const eps = 1e-6;
  let ax = null;
  if (Math.abs(dy) < eps && Math.abs(dx) > eps) ax = 'x';
  else if (Math.abs(dx) < eps && Math.abs(dy) > eps) ax = 'y';
  if (!ax || !quarterTurn) return ax;
  return ax === 'x' ? 'y' : 'x';
}

// ─── Spatial indexes ───────────────────────────────────────────────────────

function _cellKey(cx, cy) {
  // Numeric key, no string allocation on the hot path.
  return (cx + 0x8000) * 0x10000 + (cy + 0x8000);
}

/**
 * Point index: sorted x / y arrays (H/V alignment by binary search) and a
 * uniform grid (nearest point within a radius).
 * points: [{ x, y, type, ... }] — kept by reference.
 */
export function createPointIndex(points, cellSize = 64) {
  const n = points.length;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) { xs[i] = points[i].x; ys[i] = points[i].y; }
  let byX = null, byY = null, sortedX = null, sortedY = null;
  function ensureSorted() {
    if (byX) return;
    byX = new Uint32Array(n); byY = new Uint32Array(n);
    for (let i = 0; i < n; i++) { byX[i] = i; byY[i] = i; }
    byX.sort((a, b) => xs[a] - xs[b]);
    byY.sort((a, b) => ys[a] - ys[b]);
    sortedX = new Float64Array(n); sortedY = new Float64Array(n);
    for (let i = 0; i < n; i++) { sortedX[i] = xs[byX[i]]; sortedY[i] = ys[byY[i]]; }
  }
  let grid = null;
  function ensureGrid() {
    if (grid) return;
    grid = new Map();
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(xs[i]) || !Number.isFinite(ys[i])) continue;
      const k = _cellKey(Math.floor(xs[i] / cellSize), Math.floor(ys[i] / cellSize));
      let b = grid.get(k);
      if (!b) { b = []; grid.set(k, b); }
      b.push(i);
    }
  }
  function lowerBound(arr, v) {
    let lo = 0, hi = arr.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (arr[mid] < v) lo = mid + 1; else hi = mid; }
    return lo;
  }
  function aligned(sorted, order, v, tol, cb, maxVisit) {
    let visited = 0;
    for (let i = lowerBound(sorted, v - tol); i < sorted.length && sorted[i] <= v + tol; i++) {
      if (++visited > maxVisit) break;
      cb(order[i], points[order[i]]);
    }
  }
  return {
    points,
    size: n,
    /** Visit points with |p.x - x| <= tol (vertical alignment). */
    alignedX(x, tol, cb, maxVisit = 4000) { ensureSorted(); aligned(sortedX, byX, x, tol, cb, maxVisit); },
    /** Visit points with |p.y - y| <= tol (horizontal alignment). */
    alignedY(y, tol, cb, maxVisit = 4000) { ensureSorted(); aligned(sortedY, byY, y, tol, cb, maxVisit); },
    /** Nearest point within r of (x, y): { point, index, dist } or null. */
    nearest(x, y, r) {
      if (!n || !(r > 0)) return null;
      ensureGrid();
      const minCx = Math.floor((x - r) / cellSize), maxCx = Math.floor((x + r) / cellSize);
      const minCy = Math.floor((y - r) / cellSize), maxCy = Math.floor((y + r) / cellSize);
      let best = null;
      for (let cx = minCx; cx <= maxCx; cx++) {
        for (let cy = minCy; cy <= maxCy; cy++) {
          const b = grid.get(_cellKey(cx, cy));
          if (!b) continue;
          for (let k = 0; k < b.length; k++) {
            const i = b[k];
            const d = Math.hypot(xs[i] - x, ys[i] - y);
            // Strict < keeps the FIRST candidate on an exact tie (same rule
            // as findNearestSnap), so specific labels pushed first win.
            if (d <= r && (!best || d < best.dist || (d === best.dist && i < best.index))) {
              best = { point: points[i], index: i, dist: d };
            }
          }
        }
      }
      return best;
    },
  };
}

/**
 * Segment index: uniform grid over segment bounding boxes; segments whose
 * footprint exceeds `spanCap` cells go on an always-checked list.
 * segments: [{ x1, y1, x2, y2, ... }].
 */
export function createSegmentIndex(segments, cellSize = 64, spanCap = 256) {
  const grid = new Map();
  const oversized = [];
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (![s.x1, s.y1, s.x2, s.y2].every(Number.isFinite)) continue;
    const minCx = Math.floor(Math.min(s.x1, s.x2) / cellSize);
    const maxCx = Math.floor(Math.max(s.x1, s.x2) / cellSize);
    const minCy = Math.floor(Math.min(s.y1, s.y2) / cellSize);
    const maxCy = Math.floor(Math.max(s.y1, s.y2) / cellSize);
    if ((maxCx - minCx + 1) * (maxCy - minCy + 1) > spanCap) { oversized.push(i); continue; }
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const k = _cellKey(cx, cy);
        let b = grid.get(k);
        if (!b) { b = []; grid.set(k, b); }
        b.push(i);
      }
    }
  }
  return {
    segments,
    size: segments.length,
    /** Segments whose bbox touches the square of radius r around (x, y). */
    near(x, y, r) {
      const minCx = Math.floor((x - r) / cellSize), maxCx = Math.floor((x + r) / cellSize);
      const minCy = Math.floor((y - r) / cellSize), maxCy = Math.floor((y + r) / cellSize);
      const seen = new Set();
      const out = [];
      for (let cx = minCx; cx <= maxCx; cx++) {
        for (let cy = minCy; cy <= maxCy; cy++) {
          const b = grid.get(_cellKey(cx, cy));
          if (!b) continue;
          for (let k = 0; k < b.length; k++) {
            if (!seen.has(b[k])) { seen.add(b[k]); out.push(segments[b[k]]); }
          }
        }
      }
      for (const i of oversized) if (!seen.has(i)) { seen.add(i); out.push(segments[i]); }
      return out;
    },
  };
}

// ─── Individual inferences ─────────────────────────────────────────────────

/**
 * Polar line through `start` when the start→cursor angle is within
 * `toleranceDeg` of a multiple of `incrementDeg` (same rule as polarPass in
 * snap-engine.js). Returns { line, angle, angleDiff } or null.
 */
export function polarLine(start, cursor, incrementDeg = 45, toleranceDeg = 3) {
  const dx = cursor.x - start.x, dy = cursor.y - start.y;
  if (Math.hypot(dx, dy) < 1e-6) return null;
  const inc = (incrementDeg * Math.PI) / 180;
  if (!(inc > 0)) return null;
  const angle = Math.atan2(dy, dx);
  const snapped = Math.round(angle / inc) * inc;
  let diff = Math.abs(angle - snapped);
  if (diff > Math.PI) diff = 2 * Math.PI - diff;
  if (diff > (toleranceDeg * Math.PI) / 180) return null;
  return { line: makeLine(start.x, start.y, Math.cos(snapped), Math.sin(snapped)), angle: snapped, angleDiff: diff };
}

/**
 * H/V alignment of probes with indexed points.
 * probes: [{ x, y, ox, oy }] — probe position and its offset from the cursor.
 * Returns candidate guides (cursor space) for the nearest aligned point per
 * probe and direction.
 */
export function findAlignments(probes, pointIndex, tol, reach, kind = 'tracking') {
  const out = [];
  if (!pointIndex || !pointIndex.size) return out;
  for (const p of probes) {
    // Vertical guide: same x.
    let bestV = null;
    pointIndex.alignedX(p.x, tol, (_i, s) => {
      const along = Math.abs(s.y - p.y);
      if (along > reach) return;
      const d = Math.abs(s.x - p.x);
      if (along <= tol && d <= tol) return; // that's a point snap, not tracking
      if (!bestV || d < bestV.d - 1e-9 || (Math.abs(d - bestV.d) <= 1e-9 && along < bestV.along)) bestV = { s, d, along };
    });
    if (bestV) {
      out.push({
        kind, line: makeLine(bestV.s.x - p.ox, 0, 0, 1), dist: bestV.d,
        source: bestV.s, probe: p, dir: 'v',
      });
    }
    // Horizontal guide: same y.
    let bestH = null;
    pointIndex.alignedY(p.y, tol, (_i, s) => {
      const along = Math.abs(s.x - p.x);
      if (along > reach) return;
      const d = Math.abs(s.y - p.y);
      if (along <= tol && d <= tol) return;
      if (!bestH || d < bestH.d - 1e-9 || (Math.abs(d - bestH.d) <= 1e-9 && along < bestH.along)) bestH = { s, d, along };
    });
    if (bestH) {
      out.push({
        kind, line: makeLine(0, bestH.s.y - p.oy, 1, 0), dist: bestH.d,
        source: bestH.s, probe: p, dir: 'h',
      });
    }
  }
  return out;
}

/** H/V tracking lines through acquired points (cursor only). */
export function acquiredLines(acquired, cursor, tol) {
  const out = [];
  for (const a of acquired || []) {
    const dv = Math.abs(cursor.x - a.x);
    if (dv <= tol) out.push({ kind: 'acquired', line: makeLine(a.x, a.y, 0, 1), dist: dv, source: a, dir: 'v' });
    const dh = Math.abs(cursor.y - a.y);
    if (dh <= tol) out.push({ kind: 'acquired', line: makeLine(a.x, a.y, 1, 0), dist: dh, source: a, dir: 'h' });
  }
  return out;
}

/**
 * Extension lines: a probe lies on the infinite line of a segment, BEYOND one
 * of its endpoints (on the segment itself is edge snap's job).
 * segmentQuery(x, y, r) → segments near the probe.
 */
export function findExtensions(probes, segmentQuery, tol, reach, { minLength = 0, maxSegments = 400 } = {}) {
  const out = [];
  if (typeof segmentQuery !== 'function') return out;
  for (const p of probes) {
    const segs = segmentQuery(p.x, p.y, reach) || [];
    let best = null;
    const lim = Math.min(segs.length, maxSegments);
    for (let i = 0; i < lim; i++) {
      const s = segs[i];
      const sdx = s.x2 - s.x1, sdy = s.y2 - s.y1;
      const len = Math.hypot(sdx, sdy);
      if (!(len > Math.max(minLength, 1e-9))) continue;
      const l = makeLine(s.x1, s.y1, sdx, sdy);
      const d = distToLine(l, p.x, p.y);
      if (d > tol) continue;
      const t = (p.x - s.x1) * l.dx + (p.y - s.y1) * l.dy;
      let beyond, end;
      if (t < 0) { beyond = -t; end = { x: s.x1, y: s.y1 }; }
      else if (t > len) { beyond = t - len; end = { x: s.x2, y: s.y2 }; }
      else continue; // on the segment
      if (beyond < tol || beyond > reach) continue;
      if (!best || d < best.dist) {
        best = { kind: 'extension', line: makeLine(l.px - p.ox, l.py - p.oy, l.dx, l.dy), dist: d, source: end, segment: s, probe: p };
      }
    }
    if (best) out.push(best);
  }
  return out;
}

/**
 * Parallel / perpendicular inference: the move direction start→cursor is
 * within `angleTolDeg` of parallel or perpendicular to a nearby segment.
 * Returns guides through `start`.
 */
export function findParallelPerpendicular(start, cursor, segments, angleTolDeg, { minMove = 0, maxSegments = 16 } = {}) {
  const out = [];
  const vx = cursor.x - start.x, vy = cursor.y - start.y;
  const vlen = Math.hypot(vx, vy);
  if (!(vlen > Math.max(minMove, 1e-9))) return out;
  const tol = (angleTolDeg * Math.PI) / 180;
  // Nearest segments first (bounded).
  const ranked = [];
  for (const s of segments || []) {
    const sdx = s.x2 - s.x1, sdy = s.y2 - s.y1;
    const len = Math.hypot(sdx, sdy);
    if (!(len > 1e-9)) continue;
    let t = ((cursor.x - s.x1) * sdx + (cursor.y - s.y1) * sdy) / (len * len);
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(cursor.x - (s.x1 + t * sdx), cursor.y - (s.y1 + t * sdy));
    ranked.push({ s, d, ux: sdx / len, uy: sdy / len });
  }
  ranked.sort((a, b) => a.d - b.d);
  const mvA = Math.atan2(vy, vx);
  for (const r of ranked.slice(0, maxSegments)) {
    const segA = Math.atan2(r.uy, r.ux);
    let diff = Math.abs(mvA - segA) % Math.PI; // 0..π
    if (diff > Math.PI / 2) diff = Math.PI - diff; // 0..π/2: 0 = parallel, π/2 = perpendicular
    if (diff <= tol) {
      // Direction along the segment, oriented with the move.
      const sgn = (vx * r.ux + vy * r.uy) >= 0 ? 1 : -1;
      const line = makeLine(start.x, start.y, sgn * r.ux, sgn * r.uy);
      out.push({ kind: 'parallel', line, dist: distToLine(line, cursor.x, cursor.y), angleDiff: diff, segment: r.s, refDist: r.d });
    } else if (Math.PI / 2 - diff <= tol) {
      const px = -r.uy, py = r.ux;
      const sgn = (vx * px + vy * py) >= 0 ? 1 : -1;
      const line = makeLine(start.x, start.y, sgn * px, sgn * py);
      out.push({ kind: 'perpendicular', line, dist: distToLine(line, cursor.x, cursor.y), angleDiff: Math.PI / 2 - diff, segment: r.s, refDist: r.d });
    }
  }
  // Closest reference line first; one guide per direction is enough.
  out.sort((a, b) => a.refDist - b.refDist);
  const uniq = [];
  for (const g of out) if (!uniq.some(u => _sameLine(u.line, g.line, 1e-6))) uniq.push(g);
  return uniq;
}

// ─── Acquisition (hover a point briefly) ───────────────────────────────────

/**
 * Tracking-point acquisition: hovering the same point for `delayMs` acquires
 * it; hovering an acquired point again for `delayMs` releases it. A point is
 * acted on at most once per hover (moving away re-arms it). At most `max`
 * points are kept (oldest dropped).
 */
export function createAcquirer({ delayMs = 400, max = 4, eps = 1e-6 } = {}) {
  let list = [];
  let hover = null; // { x, y, since, done }
  const same = (a, b) => a && b && Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;
  return {
    /** Feed the currently hovered point (or null). Returns { changed, pendingMs }. */
    update(pt, now) {
      if (!pt) { hover = null; return { changed: false, pendingMs: 0 }; }
      if (!hover || !same(hover, pt)) hover = { x: pt.x, y: pt.y, type: pt.type, since: now, done: false };
      if (hover.done) return { changed: false, pendingMs: 0 };
      const left = delayMs - (now - hover.since);
      if (left > 0) return { changed: false, pendingMs: left };
      hover.done = true;
      const idx = list.findIndex(a => same(a, hover));
      if (idx >= 0) list.splice(idx, 1);
      else {
        list.push({ x: hover.x, y: hover.y, type: hover.type });
        if (list.length > max) list = list.slice(list.length - max);
      }
      return { changed: true, pendingMs: 0 };
    },
    list() { return list.slice(); },
    clear() { list = []; hover = null; },
  };
}

// ─── The combined inference ────────────────────────────────────────────────

// When two guides describe the same line, keep the more meaningful one.
const DEDUPE_RANK = { locked: 0, acquired: 1, tracking: 2, extension: 3, parallel: 4, perpendicular: 4, axis: 5, polar: 6 };

/**
 * Infer the cursor position of a move.
 *
 * opts:
 *   start, cursor            base point and current cursor (page space)
 *   probes                   [{x,y,ox,oy}] snap points of the moving selection
 *                            at their CURRENT position (cursor included as ox=oy=0
 *                            automatically)
 *   pointIndex               createPointIndex of STATIC points (selection excluded)
 *   segmentQuery(x,y,r)      static segments near a point
 *   acquired                 acquired tracking points
 *   tol                      distance tolerance (page units)
 *   reach                    max distance along a guide for tracking/extension
 *   angleTolDeg              parallel/perpendicular angular tolerance
 *   polar                    null | { incrementDeg, toleranceDeg }
 *   enable                   { tracking, extension, parallel } booleans
 *   lockLine                 optional line the result must lie on (Shift lock,
 *                            X/Y axis lock)
 *   extensionReach           max distance beyond a line's endpoint (default reach)
 *   extensionProbes          max probes used for extension (default 5)
 *
 * Returns null or { x, y, kind, priority, dist, guides:[...], lockable }.
 */
export function inferMove(opts) {
  const {
    start, cursor, pointIndex, segmentQuery, acquired = [],
    tol, reach = Infinity, angleTolDeg = 2, polar = null,
    enable = { tracking: true, extension: true, parallel: true },
    lockLine = null, extensionProbes = 5,
  } = opts;
  const extensionReach = opts.extensionReach ?? reach;
  if (!start || !cursor || !(tol > 0)) return null;
  const probes = [{ x: cursor.x, y: cursor.y, ox: 0, oy: 0, cursor: true }, ...(opts.probes || [])];

  // Lines are gathered with a relaxed tolerance when locked: they only have
  // to cross the lock line near the cursor.
  const gTol = lockLine ? tol * 1.5 : tol;
  let guides = [];
  if (enable.tracking) {
    guides.push(...findAlignments(probes, pointIndex, gTol, reach, 'tracking'));
    guides.push(...acquiredLines(acquired, cursor, gTol));
    for (const [dx, dy, dir] of [[1, 0, 'h'], [0, 1, 'v']]) {
      const line = makeLine(start.x, start.y, dx, dy);
      const d = distToLine(line, cursor.x, cursor.y);
      if (d <= gTol && Math.hypot(cursor.x - start.x, cursor.y - start.y) > tol) {
        guides.push({ kind: 'axis', line, dist: d, source: { x: start.x, y: start.y }, dir });
      }
    }
  }
  if (polar) {
    const pl = polarLine(start, cursor, polar.incrementDeg, polar.toleranceDeg);
    if (pl) guides.push({ kind: 'polar', line: pl.line, dist: distToLine(pl.line, cursor.x, cursor.y), angle: pl.angle, source: { x: start.x, y: start.y } });
  }
  if (enable.extension) {
    guides.push(...findExtensions(probes.slice(0, Math.max(1, extensionProbes)), segmentQuery, gTol, extensionReach));
  }
  if (enable.parallel && typeof segmentQuery === 'function') {
    const near = segmentQuery(cursor.x, cursor.y, Math.min(reach, tol * 30)) || [];
    const pp = findParallelPerpendicular(start, cursor, near, angleTolDeg, { minMove: tol * 2 });
    guides.push(...pp);
  }

  // Dedupe identical lines (e.g. axis vs polar at 0°, parallel to a horizontal line).
  guides.sort((a, b) => (DEDUPE_RANK[a.kind] ?? 9) - (DEDUPE_RANK[b.kind] ?? 9) || a.dist - b.dist);
  const uniq = [];
  for (const g of guides) {
    if (!g.line) continue;
    if (uniq.some(u => _sameLine(u.line, g.line, tol * 0.05))) continue;
    uniq.push(g);
  }
  guides = uniq;

  if (lockLine) {
    const foot = projectOnLine(lockLine, cursor.x, cursor.y);
    let best = null;
    for (const g of guides) {
      const X = intersectLines(lockLine, g.line);
      if (!X) continue;
      const d = Math.hypot(X.x - foot.x, X.y - foot.y);
      if (d <= tol * 1.5 && (!best || d < best.dist)) best = { x: X.x, y: X.y, kind: 'intersection', dist: d, guides: [g] };
    }
    const lockedGuide = { kind: 'locked', line: lockLine, dist: 0, source: lockLine.source || null };
    if (best) {
      return { ...best, priority: INFERENCE_PRIORITY.intersection, guides: [lockedGuide, ...best.guides], lockable: lockLine };
    }
    return { x: foot.x, y: foot.y, kind: 'locked', priority: INFERENCE_PRIORITY.locked, dist: distToLine(lockLine, cursor.x, cursor.y), guides: [lockedGuide], lockable: lockLine };
  }

  const active = guides.filter(g => g.dist <= tol || g.kind === 'polar').sort((a, b) => a.dist - b.dist).slice(0, 12);
  if (active.length === 0) return null;

  // Intersection of two guides near the cursor.
  let bestX = null;
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const X = intersectLines(active[i].line, active[j].line);
      if (!X) continue;
      const d = Math.hypot(X.x - cursor.x, X.y - cursor.y);
      if (d <= tol * 1.5 && (!bestX || d < bestX.dist)) bestX = { x: X.x, y: X.y, dist: d, guides: [active[i], active[j]] };
    }
  }
  if (bestX) {
    return { ...bestX, kind: 'intersection', priority: INFERENCE_PRIORITY.intersection, lockable: null };
  }

  // Single guide: highest priority, then nearest.
  let best = null;
  for (const g of active) {
    const pr = INFERENCE_PRIORITY[g.kind] ?? 0;
    if (!best || pr > best.pr || (pr === best.pr && g.dist < best.g.dist)) best = { g, pr };
  }
  const f = projectOnLine(best.g.line, cursor.x, cursor.y);
  return {
    x: f.x, y: f.y, kind: best.g.kind, priority: best.pr, dist: best.g.dist,
    guides: [best.g], lockable: best.g.line,
  };
}
