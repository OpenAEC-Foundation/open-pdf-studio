// Rotate / mirror for closed, point-based polygon annotations (filledArea and
// measureArea). Their geometry lives in points[] (+ holes[][]), not in a
// rect + rotation field, so the Arrange-tab / context-menu Rotate and Flip
// buttons must move the points themselves. Setting annotation.rotation or
// flipX/flipY has no effect on how these types are drawn.
//
// Points may carry an arc segment ({arc:true, bulge}). The arc's control point
// is offset perpendicular to the chord prev->current by bulge*length (see
// arcControlPoint in measurement.js), so:
//   - a rotation keeps every bulge as it is;
//   - a mirror reverses the polygon's winding, which flips the perpendicular
//     of every chord, so each arc's bulge changes sign.
//
// Pure functions (no imports) so they can be unit-tested in Node.

export const POINT_POLYGON_TYPES = new Set(['filledArea', 'measureArea']);

// Same default that arcControlPoint() applies when an arc point has no bulge.
const DEFAULT_BULGE = 0.3;

export function isPointPolygon(annotation) {
  return !!annotation
    && POINT_POLYGON_TYPES.has(annotation.type)
    && Array.isArray(annotation.points)
    && annotation.points.length >= 3;
}

function outerBounds(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function mapContours(annotation, mapPoint) {
  annotation.points = annotation.points.map(mapPoint);
  if (Array.isArray(annotation.holes)) {
    annotation.holes = annotation.holes.map(h => (Array.isArray(h) ? h.map(mapPoint) : h));
  }
  // Keep the cached bounding box (used for selection/export) in step with the
  // outer contour, the way the tool computes it when the shape is created.
  if (typeof annotation.x === 'number' && typeof annotation.y === 'number') {
    const b = outerBounds(annotation.points);
    annotation.x = b.minX;
    annotation.y = b.minY;
    annotation.width = b.maxX - b.minX;
    annotation.height = b.maxY - b.minY;
  }
}

/** Rotate the polygon by `degrees` (clockwise on screen) about its bounding-box centre. */
export function rotatePointPolygon(annotation, degrees) {
  if (!isPointPolygon(annotation)) return false;
  const b = outerBounds(annotation.points);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const rad = degrees * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  mapContours(annotation, (p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    return { ...p, x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  });
  return true;
}

/** Mirror the polygon left-right (axis 'x') or top-bottom (axis 'y') about its centre. */
export function flipPointPolygon(annotation, axis) {
  if (!isPointPolygon(annotation)) return false;
  const b = outerBounds(annotation.points);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  mapContours(annotation, (p) => {
    const q = axis === 'y'
      ? { ...p, y: 2 * cy - p.y }
      : { ...p, x: 2 * cx - p.x };
    if (p.arc) q.bulge = -(p.bulge || DEFAULT_BULGE);
    return q;
  });
  return true;
}
