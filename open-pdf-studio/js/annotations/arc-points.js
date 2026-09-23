// Boogsegmenten in een puntenlijst. Een punt met `arc: true` sluit een boog af
// die begint bij het vorige punt; `bulge` is de doorbuiging als fractie van de
// koordlengte. Puur rekenwerk, geen state — zodat ook headless modules
// (oppervlakte, ringindeling) hem kunnen gebruiken zonder measurement.js met
// zijn UI-imports binnen te halen.

/** Heeft deze puntenlijst een boogsegment? */
export function hasArcPoints(points) {
  return !!points && points.some(p => p && p.arc);
}

/**
 * Calculate the control point for an arc segment using the bulge factor.
 * The control point is at the midpoint of prev->current, offset perpendicular by bulge * distance.
 */
export function arcControlPoint(prev, current) {
  const bulge = current.bulge || 0.3;
  const mx = (prev.x + current.x) / 2;
  const my = (prev.y + current.y) / 2;
  const dx = current.x - prev.x;
  const dy = current.y - prev.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  // Perpendicular direction (rotated 90 degrees CCW)
  const px = -dy / (dist || 1);
  const py = dx / (dist || 1);
  return {
    x: mx + px * bulge * dist,
    y: my + py * bulge * dist,
  };
}

/**
 * Expand polygon points that contain arc segments into a series of line segments
 * for accurate area calculation (shoelace formula approximation).
 * Each arc is subdivided into ~16 straight segments.
 */
export function expandArcPoints(points) {
  if (!points || points.length < 2) return points;
  const expanded = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const pt = points[i];
    if (pt.arc && i > 0) {
      const prev = points[i - 1];
      const cp = arcControlPoint(prev, pt);
      // Subdivide the quadratic bezier into segments
      const segments = 16;
      for (let s = 1; s <= segments; s++) {
        const t = s / segments;
        const t1 = 1 - t;
        expanded.push({
          x: t1 * t1 * prev.x + 2 * t1 * t * cp.x + t * t * pt.x,
          y: t1 * t1 * prev.y + 2 * t1 * t * cp.y + t * t * pt.y,
        });
      }
    } else {
      expanded.push({ x: pt.x, y: pt.y });
    }
  }
  // Handle closing segment: if first point has arc flag, expand it too
  if (points[0].arc && n >= 2) {
    const prev = points[n - 1];
    const pt = points[0];
    const cp = arcControlPoint(prev, pt);
    const segments = 16;
    for (let s = 1; s < segments; s++) {
      const t = s / segments;
      const t1 = 1 - t;
      expanded.push({
        x: t1 * t1 * prev.x + 2 * t1 * t * cp.x + t * t * pt.x,
        y: t1 * t1 * prev.y + 2 * t1 * t * cp.y + t * t * pt.y,
      });
    }
  }
  return expanded;
}
