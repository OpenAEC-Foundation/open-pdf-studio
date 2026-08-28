// Pure hit-test helpers for the ink eraser tool.
//
// The eraser sweeps a segment (the pointer movement between two events) over
// the page; an ink (freehand) annotation is hit when that swept segment comes
// within `tol` of any segment of the annotation's polyline path. Whole-stroke
// erase only: a hit removes the entire annotation (partial erase is future
// work). Kept free of app/DOM imports so `node --test` can run it directly.

import { distanceToLine } from '../../utils/math.js';

// Orientation of ordered triplet (a, b, c): >0 counter-clockwise, <0
// clockwise, 0 collinear.
function orient(ax, ay, bx, by, cx, cy) {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

// True when segments AB and CD properly intersect (or touch).
function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const o1 = orient(ax, ay, bx, by, cx, cy);
  const o2 = orient(ax, ay, bx, by, dx, dy);
  const o3 = orient(cx, cy, dx, dy, ax, ay);
  const o4 = orient(cx, cy, dx, dy, bx, by);
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) &&
      ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return true;
  // Collinear/touching cases fall through to the distance check in
  // segmentDistance (distance 0 when an endpoint lies on the other segment).
  return false;
}

/**
 * Minimum distance between segments AB and CD.
 */
export function segmentDistance(ax, ay, bx, by, cx, cy, dx, dy) {
  if (segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
  return Math.min(
    distanceToLine(ax, ay, cx, cy, dx, dy),
    distanceToLine(bx, by, cx, cy, dx, dy),
    distanceToLine(cx, cy, ax, ay, bx, by),
    distanceToLine(dx, dy, ax, ay, bx, by),
  );
}

/**
 * True when the swept eraser segment (x0,y0)→(x1,y1) comes within `tol` of
 * the polyline `path` ([{x,y}, ...]). A single-point path is treated as a dot.
 */
export function eraserHitsPath(x0, y0, x1, y1, path, tol) {
  if (!Array.isArray(path) || path.length === 0) return false;
  if (path.length === 1) {
    return distanceToLine(path[0].x, path[0].y, x0, y0, x1, y1) <= tol;
  }
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (segmentDistance(x0, y0, x1, y1, a.x, a.y, b.x, b.y) <= tol) return true;
  }
  return false;
}
