// Pure geometry helpers for line-based parametric symbols. The two endpoints
// are canonical; x/y/width/height/rotation are the derived rendering band.

const EPSILON = 1e-6;

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

/** Return explicit endpoints, or reconstruct them from a legacy rotated bbox. */
export function twoPointEndpoints(annotation) {
  if (Number.isFinite(annotation?.startX) && Number.isFinite(annotation?.startY)
      && Number.isFinite(annotation?.endX) && Number.isFinite(annotation?.endY)) {
    return {
      startX: annotation.startX,
      startY: annotation.startY,
      endX: annotation.endX,
      endY: annotation.endY,
    };
  }

  const x = finite(annotation?.x);
  const y = finite(annotation?.y);
  const width = Math.max(EPSILON, Math.abs(finite(annotation?.width, 1)));
  const height = Math.max(EPSILON, Math.abs(finite(annotation?.height, 1)));
  const angle = finite(annotation?.rotation) * Math.PI / 180;
  const halfX = Math.cos(angle) * width / 2;
  const halfY = Math.sin(angle) * width / 2;
  const cx = x + width / 2;
  const cy = y + height / 2;
  return {
    startX: cx - halfX,
    startY: cy - halfY,
    endX: cx + halfX,
    endY: cy + halfY,
  };
}

/**
 * Make endpoints canonical and derive the horizontal local rendering band.
 * The renderer rotates this band around its centre, so the local centreline
 * lands exactly on the two requested points.
 */
export function syncTwoPointGeometry(annotation, startX, startY, endX, endY, height) {
  if (!annotation) return false;
  const sx = finite(startX);
  const sy = finite(startY);
  let ex = finite(endX, sx + 1);
  let ey = finite(endY, sy);
  let length = Math.hypot(ex - sx, ey - sy);
  if (length < EPSILON) {
    const previous = twoPointEndpoints(annotation);
    const angle = Math.atan2(previous.endY - previous.startY, previous.endX - previous.startX);
    ex = sx + Math.cos(angle) * EPSILON;
    ey = sy + Math.sin(angle) * EPSILON;
    length = EPSILON;
  }
  const bandHeight = Math.max(EPSILON, Math.abs(finite(height, annotation.height || 1)));
  const cx = (sx + ex) / 2;
  const cy = (sy + ey) / 2;

  annotation.startX = sx;
  annotation.startY = sy;
  annotation.endX = ex;
  annotation.endY = ey;
  annotation.x = cx - length / 2;
  annotation.y = cy - bandHeight / 2;
  annotation.width = length;
  annotation.height = bandHeight;
  annotation.rotation = Math.atan2(ey - sy, ex - sx) * 180 / Math.PI;
  return true;
}

/** Resize around the midpoint while keeping the current two-point direction. */
export function resizeTwoPointGeometry(annotation, length, height = annotation?.height) {
  if (!annotation || !(Number(length) > 0)) return false;
  const endpoints = twoPointEndpoints(annotation);
  const cx = (endpoints.startX + endpoints.endX) / 2;
  const cy = (endpoints.startY + endpoints.endY) / 2;
  let dx = endpoints.endX - endpoints.startX;
  let dy = endpoints.endY - endpoints.startY;
  const currentLength = Math.hypot(dx, dy);
  if (currentLength < EPSILON) {
    const angle = finite(annotation.rotation) * Math.PI / 180;
    dx = Math.cos(angle);
    dy = Math.sin(angle);
  } else {
    dx /= currentLength;
    dy /= currentLength;
  }
  const half = Number(length) / 2;
  return syncTwoPointGeometry(
    annotation,
    cx - dx * half,
    cy - dy * half,
    cx + dx * half,
    cy + dy * half,
    height,
  );
}

/** Update the editable real-world length from the current endpoint distance. */
export function syncTwoPointLengthParam(annotation, pxPerMm) {
  if (!annotation || !(pxPerMm > 0)) return false;
  const endpoints = twoPointEndpoints(annotation);
  const lengthMm = Math.hypot(
    endpoints.endX - endpoints.startX,
    endpoints.endY - endpoints.startY,
  ) / pxPerMm;
  annotation.params = { ...(annotation.params || {}), lengte: Math.round(lengthMm * 100) / 100 };
  return true;
}
