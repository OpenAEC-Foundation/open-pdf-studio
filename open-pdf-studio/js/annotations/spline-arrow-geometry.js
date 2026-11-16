// Pure geometry helpers for the curved (spline) arrow annotation (issue #267).
//
// A spline arrow is defined by its clicked points (stored on the annotation as
// `points`, exactly like a polyline so the generic vertex-edit path applies).
// The visible curve is a uniform Catmull-Rom spline through those points,
// expressed as a chain of cubic Bézier segments so both the on-screen canvas
// (bezierCurveTo) and the saved PDF appearance stream (`c` operators) draw the
// IDENTICAL curve. The arrowhead sits at the last point and points along the
// curve's end tangent.
//
// This module is intentionally PURE — no imports, no DOM, no app state — so it
// can be unit-tested under plain `node`.

// Convert a list of control points into cubic-Bézier segments using the uniform
// (centripetal-free, tension 1/2) Catmull-Rom → Bézier formula. Phantom end
// points are reflected (2*P0 - P1) so the curve starts/ends exactly at the first
// and last clicked point — matching catmullRomSpline() in spline-tool.js.
//
// Returns [] for < 2 points, otherwise an array of
//   { x0, y0, c1x, c1y, c2x, c2y, x1, y1 }
// one per span between consecutive control points.
export function catmullRomToBezier(points) {
  if (!points || points.length < 2) return [];
  const p = points;
  const n = p.length;
  const segments = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = i > 0 ? p[i - 1] : { x: 2 * p[0].x - p[1].x, y: 2 * p[0].y - p[1].y };
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = i + 2 < n
      ? p[i + 2]
      : { x: 2 * p[n - 1].x - p[n - 2].x, y: 2 * p[n - 1].y - p[n - 2].y };
    segments.push({
      x0: p1.x, y0: p1.y,
      c1x: p1.x + (p2.x - p0.x) / 6, c1y: p1.y + (p2.y - p0.y) / 6,
      c2x: p2.x - (p3.x - p1.x) / 6, c2y: p2.y - (p3.y - p1.y) / 6,
      x1: p2.x, y1: p2.y,
    });
  }
  return segments;
}

// Angle (radians, screen/app space with y pointing down) of the curve's tangent
// at its END point — the direction the arrowhead should point. For a cubic
// Bézier the tangent at t=1 is proportional to (P1 - C2); fall back to the last
// chord if that is degenerate.
export function splineArrowEndTangent(points) {
  const segments = catmullRomToBezier(points);
  if (segments.length === 0) {
    if (points && points.length >= 2) {
      const a = points[points.length - 2];
      const b = points[points.length - 1];
      return Math.atan2(b.y - a.y, b.x - a.x);
    }
    return 0;
  }
  const last = segments[segments.length - 1];
  let dx = last.x1 - last.c2x;
  let dy = last.y1 - last.c2y;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) {
    dx = last.x1 - last.x0;
    dy = last.y1 - last.y0;
  }
  return Math.atan2(dy, dx);
}

