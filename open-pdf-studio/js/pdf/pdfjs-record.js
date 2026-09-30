// PDF.js 6 returns Maps for catalog dictionaries and JavaScript actions.
// Normalize only at the UI boundary; leave PDF.js's own objects unchanged.
export function pdfjsRecord(value) {
  return value instanceof Map ? Object.fromEntries(value) : value;
}

// PDF.js 6 dropped PageViewport.convertToViewportRectangle; same result from
// the two corner points ([x1, y1, x2, y2], not normalised).
export function viewportRectangle(viewport, rect) {
  const [x1, y1] = viewport.convertToViewportPoint(rect[0], rect[1]);
  const [x2, y2] = viewport.convertToViewportPoint(rect[2], rect[3]);
  return [x1, y1, x2, y2];
}
