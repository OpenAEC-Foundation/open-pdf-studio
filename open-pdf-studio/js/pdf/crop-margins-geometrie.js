// Pixelgrenzen horen bij de werkelijk gerenderde PDF.js-viewport: bestaand
// CropBox, oorsprong, /Rotate, gebruikersrotatie en /UserUnit inbegrepen.
export function cropBoxFromPixels(bounds, viewport, mediaBox, paddingPt) {
  const a = viewport.convertToPdfPoint(bounds.minX, bounds.minY);
  // De laatste gevonden pixel hoort helemaal bij de inhoud, ook bij één pixel.
  const b = viewport.convertToPdfPoint(bounds.maxX + 1, bounds.maxY + 1);
  const padding = paddingPt / (viewport.userUnit || 1);
  const left = Math.max(mediaBox.x, Math.min(a[0], b[0]) - padding);
  const bottom = Math.max(mediaBox.y, Math.min(a[1], b[1]) - padding);
  const right = Math.min(mediaBox.x + mediaBox.width, Math.max(a[0], b[0]) + padding);
  const top = Math.min(mediaBox.y + mediaBox.height, Math.max(a[1], b[1]) + padding);
  return { x: left, y: bottom, width: right - left, height: top - bottom };
}

// Het model gebruikt punten vanaf linksboven van de getoonde pagina.
// Na bijsnijden verschuift die oorsprong; markeringen moeten de inhoud volgen.
export function cropOriginShift(crop, viewport) {
  const a = viewport.convertToViewportPoint(crop.x, crop.y);
  const b = viewport.convertToViewportPoint(crop.x + crop.width, crop.y + crop.height);
  return { dx: -Math.min(a[0], b[0]) / viewport.scale,
    dy: -Math.min(a[1], b[1]) / viewport.scale };
}
