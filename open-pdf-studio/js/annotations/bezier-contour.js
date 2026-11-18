// Shared geometry for mixed straight/cubic contours (#1169).
// Handles are absolute page-space points: `incoming` ends the preceding
// segment, `outgoing` starts the next one. An absent handle sits at its node.
// No UI/state imports: rendering, editing and PDF appearances must use the
// same geometry. Integration is deliberately separate from this foundation.
import { arcControlPoint } from './arc-points.js';

const point = (p) => ({ x: p.x, y: p.y });
const finitePoint = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
// Annotation geometry is JSON data. Like the application's undo snapshots,
// unwrap reactive array/node proxies; structuredClone cannot clone a Proxy.
const copyNodes = (nodes) => JSON.parse(JSON.stringify(nodes));

/** Only explicit cubic handles opt existing annotations into the new model. */
export function hasBezierHandles(nodes) {
  return Array.isArray(nodes) && nodes.some(p => p?.incoming || p?.outgoing);
}

/** Map a node and its absolute handles together, retaining other point data. */
export function mapContourNode(node, mapPoint) {
  const result = { ...node, ...mapPoint(node) };
  for (const key of ['incoming', 'outgoing']) {
    if (node[key]) result[key] = { ...node[key], ...mapPoint(node[key]) };
  }
  return result;
}

function validateNodes(nodes) {
  if (!Array.isArray(nodes)) throw new TypeError('Expected contour nodes');
  for (const p of nodes) {
    if (!finitePoint(p)) throw new TypeError('Contour coordinates must be finite');
    if (p.arc && p.bulge != null && !Number.isFinite(p.bulge)) throw new TypeError('Arc bulge must be finite');
    for (const name of ['incoming', 'outgoing']) {
      if (p[name] != null && !finitePoint(p[name])) throw new TypeError('Handle coordinates must be finite');
    }
  }
}

/** Ordered segments; `index` is the start-node index, including closure. */
export function contourSegments(nodes, closed = false) {
  validateNodes(nodes);
  const result = [];
  const count = nodes.length < 2 ? 0 : nodes.length - (closed ? 0 : 1);
  for (let i = 0; i < count; i++) {
    const endIndex = (i + 1) % nodes.length;
    const a = nodes[i], b = nodes[endIndex];
    const seg = { index: i, endIndex, start: point(a), end: point(b) };
    if (a.outgoing || b.incoming) {
      Object.assign(seg, { kind: 'cubic', c1: point(a.outgoing || a), c2: point(b.incoming || b) });
    } else if (b.arc) {
      // Match the existing quadratic arc exactly, not a sampled substitute.
      const q = arcControlPoint(a, b);
      Object.assign(seg, { kind: 'cubic', c1: lerp(a, q, 2 / 3), c2: lerp(b, q, 2 / 3) });
    } else seg.kind = 'line';
    result.push(seg);
  }
  return result;
}

/** de Casteljau evaluation also behaves well at coincident nodes. */
export function contourPoint(segment, t) {
  if (!Number.isFinite(t) || t < 0 || t > 1) throw new RangeError('t must be between zero and one');
  if (segment.kind === 'line') return lerp(segment.start, segment.end, t);
  const a = lerp(segment.start, segment.c1, t);
  const b = lerp(segment.c1, segment.c2, t);
  const c = lerp(segment.c2, segment.end, t);
  return lerp(lerp(a, b, t), lerp(b, c, t), t);
}

function splitCubic(s, t) {
  const a = lerp(s.start, s.c1, t), b = lerp(s.c1, s.c2, t), c = lerp(s.c2, s.end, t);
  const d = lerp(a, b, t), e = lerp(b, c, t), middle = lerp(d, e, t);
  return [
    { ...s, c1: a, c2: d, end: middle },
    { ...s, start: middle, c1: e, c2: c },
  ];
}

/** Insert a node without changing the path (also on the closing segment). */
export function splitContourSegment(nodes, index, t = 0.5, closed = false) {
  if (!Number.isFinite(t) || t <= 0 || t >= 1) throw new RangeError('Split must be inside the segment');
  const s = contourSegments(nodes, closed)[index];
  if (!Number.isInteger(index) || !s) throw new RangeError('Invalid segment index');
  const copy = copyNodes(nodes);
  let inserted = contourPoint(s, t);
  if (s.kind === 'cubic') {
    const [left, right] = splitCubic(s, t);
    copy[index].outgoing = left.c1;
    copy[s.endIndex].incoming = right.c2;
    delete copy[s.endIndex].arc;
    delete copy[s.endIndex].bulge;
    inserted = { ...inserted, incoming: left.c2, outgoing: right.c1 };
  }
  copy.splice(index + 1, 0, inserted);
  return copy;
}

/** Move one node and its two handles, leaving the adjacent nodes untouched. */
export function moveContourNode(nodes, index, dx, dy) {
  validateNodes(nodes);
  if (!Number.isInteger(index) || !nodes[index]) throw new RangeError('Invalid node index');
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new TypeError('Delta must be finite');
  const copy = copyNodes(nodes), p = copy[index];
  for (const item of [p, p.incoming, p.outgoing]) {
    if (item) { item.x += dx; item.y += dy; }
  }
  return copy;
}

/** Straighten just one segment; retain the handles for its neighbours. */
export function straightenContourSegment(nodes, index, closed = false) {
  const s = contourSegments(nodes, closed)[index];
  if (!Number.isInteger(index) || !s) throw new RangeError('Invalid segment index');
  const copy = copyNodes(nodes);
  delete copy[index].outgoing;
  delete copy[s.endIndex].incoming;
  delete copy[s.endIndex].arc;
  delete copy[s.endIndex].bulge;
  return copy;
}

/** Affine [a,b,c,d,e,f], including reflection and non-uniform scaling. */
export function transformContour(nodes, matrix, closed = false) {
  if (!Array.isArray(matrix) || matrix.length !== 6 || !matrix.every(Number.isFinite)) {
    throw new TypeError('Expected a finite affine matrix');
  }
  const segments = contourSegments(nodes, closed);
  const copy = copyNodes(nodes);
  // A bulge cannot represent an affinely distorted quadratic. Materialize
  // its exact cubic handles before mapping; never silently straighten it.
  for (const s of segments) {
    if (s.kind !== 'cubic') continue;
    if (!nodes[s.index].outgoing && !nodes[s.endIndex].incoming) {
      copy[s.index].outgoing = point(s.c1);
      copy[s.endIndex].incoming = point(s.c2);
    }
    delete copy[s.endIndex].arc;
    delete copy[s.endIndex].bulge;
  }
  const [a, b, c, d, e, f] = matrix;
  for (const p of copy) {
    for (const q of [p, p.incoming, p.outgoing]) {
      if (!q) continue;
      const x = a * q.x + c * q.y + e, y = b * q.x + d * q.y + f;
      q.x = x; q.y = y;
    }
  }
  return copy;
}

function extrema(p0, p1, p2, p3) {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2), c = p1 - p0;
  const epsilon = Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b), Math.abs(c)) * 8;
  if (Math.abs(a) <= epsilon) return Math.abs(b) <= epsilon ? [] : [-c / b];
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return [];
  // Stable quadratic roots avoid cancellation for small extrema near a node.
  const q = -0.5 * (b + (b < 0 ? -1 : 1) * Math.sqrt(discriminant));
  return q === 0 ? [-b / (2 * a)] : [q / a, c / q];
}

/** Exact centreline bounds; callers add stroke/head padding separately. */
export function contourBounds(nodes, closed = false) {
  const segments = contourSegments(nodes, closed);
  if (!nodes.length) return null;
  const candidates = nodes.map(point);
  for (const s of segments) {
    if (s.kind !== 'cubic') continue;
    for (const axis of ['x', 'y']) {
      for (const t of extrema(s.start[axis], s.c1[axis], s.c2[axis], s.end[axis])) {
        if (t > 0 && t < 1) candidates.push(contourPoint(s, t));
      }
    }
  }
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
  for (const p of candidates) {
    x = Math.min(x, p.x); y = Math.min(y, p.y);
    right = Math.max(right, p.x); bottom = Math.max(bottom, p.y);
  }
  return { x, y, width: right - x, height: bottom - y };
}

function distanceToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** Adaptive polyline for picking/fallback vertices, in page-space tolerance.
 * Closed contours repeat their first point. A depth cap bounds hostile input.
 * `truncated` reports that the requested tolerance could not be met.
 */
export function flattenContour(nodes, closed = false, tolerance = 0.25, maxDepth = 16) {
  if (!Number.isFinite(tolerance) || tolerance <= 0) throw new RangeError('Tolerance must be positive');
  if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 20) throw new RangeError('Invalid subdivision limit');
  const segments = contourSegments(nodes, closed), points = nodes.length ? [point(nodes[0])] : [];
  let truncated = false;
  function visit(s, depth) {
    if (s.kind === 'line') { points.push(point(s.end)); return; }
    const flat = Math.max(distanceToSegment(s.c1, s.start, s.end), distanceToSegment(s.c2, s.start, s.end)) <= tolerance;
    if (flat || depth === maxDepth) {
      if (!flat) truncated = true;
      points.push(point(s.end));
    } else {
      const [left, right] = splitCubic(s, 0.5);
      visit(left, depth + 1); visit(right, depth + 1);
    }
  }
  for (const s of segments) visit(s, 0);
  return { points, truncated };
}

/** Trace exact geometry; callers choose stroke/fill and begin a path. */
export function traceContour(ctx, nodes, closed = false) {
  const segments = contourSegments(nodes, closed);
  if (!nodes.length) return;
  ctx.moveTo(nodes[0].x, nodes[0].y);
  for (const s of segments) {
    if (s.kind === 'line') ctx.lineTo(s.end.x, s.end.y);
    else ctx.bezierCurveTo(s.c1.x, s.c1.y, s.c2.x, s.c2.y, s.end.x, s.end.y);
  }
  if (closed) ctx.closePath();
}

/** Nearest point on a segment, including its cubic bow rather than its chord. */
export function nearestContourPoint(segment, x, y) {
  const distance = t => { const p = contourPoint(segment, t); return (p.x - x) ** 2 + (p.y - y) ** 2; };
  if (segment.kind === 'line') {
    const a = segment.start, b = segment.end, dx = b.x - a.x, dy = b.y - a.y;
    const t = dx * dx + dy * dy ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
    return { ...contourPoint(segment, t), t, distance: Math.sqrt(distance(t)) };
  }
  // Bracket every sampled local minimum, including loops and endpoint minima.
  const n = 64, values = Array.from({ length: n + 1 }, (_, i) => distance(i / n));
  let t = values[0] <= values[n] ? 0 : 1, best = distance(t);
  for (let i = 0; i <= n; i++) {
    if ((i > 0 && values[i] > values[i - 1]) || (i < n && values[i] > values[i + 1])) continue;
    let lo = Math.max(0, (i - 1) / n), hi = Math.min(1, (i + 1) / n);
    for (let j = 0; j < 36; j++) {
      const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3;
      if (distance(a) < distance(b)) hi = b; else lo = a;
    }
    const candidate = (lo + hi) / 2, d = distance(candidate);
    if (d < best) { t = candidate; best = d; }
  }
  return { ...contourPoint(segment, t), t, distance: Math.sqrt(best) };
}
