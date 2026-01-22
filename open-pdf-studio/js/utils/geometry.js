// Geometry utility functions

// Calculate distance from point to line segment
export function distanceToLine(px, py, x1, y1, x2, y2) {
  const A = px - x1;
  const B = py - y1;
  const C = x2 - x1;
  const D = y2 - y1;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;
  if (lenSq !== 0) param = dot / lenSq;

  let xx, yy;
  if (param < 0) {
    xx = x1;
    yy = y1;
  } else if (param > 1) {
    xx = x2;
    yy = y2;
  } else {
    xx = x1 + param * C;
    yy = y1 + param * D;
  }

  const dx = px - xx;
  const dy = py - yy;
  return Math.sqrt(dx * dx + dy * dy);
}

// Check if point is near rectangle outline (not inside)
export function isPointNearRect(px, py, x, y, w, h, threshold = 10) {
  const insideOuter = px >= x - threshold && px <= x + w + threshold && py >= y - threshold && py <= y + h + threshold;
  const insideInner = px >= x + threshold && px <= x + w - threshold && py >= y + threshold && py <= y + h - threshold;
  return insideOuter && !insideInner;
}

// Check if point is near ellipse outline (not inside)
export function isPointNearEllipse(px, py, x, y, w, h, threshold = 10) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rx = Math.abs(w / 2);
  const ry = Math.abs(h / 2);

  // Normalized distance from center (1 means on the ellipse boundary)
  const normDist = Math.pow((px - cx) / rx, 2) + Math.pow((py - cy) / ry, 2);

  // Calculate normalized distance for outer and inner boundaries
  const outerRx = rx + threshold;
  const outerRy = ry + threshold;
  const innerRx = Math.max(rx - threshold, 0);
  const innerRy = Math.max(ry - threshold, 0);

  const outerDist = Math.pow((px - cx) / outerRx, 2) + Math.pow((py - cy) / outerRy, 2);
  const innerDist = innerRx > 0 && innerRy > 0
    ? Math.pow((px - cx) / innerRx, 2) + Math.pow((py - cy) / innerRy, 2)
    : Infinity;

  // Point is near the ellipse outline if inside outer boundary but outside inner boundary
  return outerDist <= 1 && innerDist > 1;
}
