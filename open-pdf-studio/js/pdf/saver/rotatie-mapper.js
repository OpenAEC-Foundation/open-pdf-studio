// ── Rotated-page coordinate remap ──────────────────────────────────────────
// On a page with /Rotate 90/180/270 the annotation coordinates live in the
// DISPLAYED (rotated) visual space, but the PDF page box (CropBox) is unrotated.
// The save-time convert helpers only know the unrotated box, so without
// compensation the saved /Rect lands rotated and annotations drift on reopen
// (the loader, via pdf.js viewport, IS rotation-aware). We remap every visual
// coordinate into the UNROTATED page frame once, up front, so the existing
// convert + appearance code produces correct PDF coordinates for every type.
//
// The map is the inverse of pdf.js viewport.convertToViewportPoint, so that
// naiveConvert(remappedPoint) === rotationAwareConvert(originalPoint). cw/ch are
// the UNROTATED page-box width/height. rot 0 is identity (callers skip it), so
// non-rotated pages are completely unaffected.
//
// Puur (geen pdf-lib, geen DOM): saver.js en saver/correction-dicts.js
// gebruiken dezelfde omrekening.
export function _rotVisualMapper(rot, cw, ch) {
  switch (((rot % 360) + 360) % 360) {
    case 90:  return (x, y) => ({ x: y,      y: ch - x });
    case 180: return (x, y) => ({ x: cw - x, y: ch - y });
    case 270: return (x, y) => ({ x: cw - y, y: x });
    default:  return (x, y) => ({ x, y });
  }
}

// Map a rect's two corners and re-derive an axis-aligned rect (width/height
// swap under 90/270).
export function _remapRect(obj, m) {
  const a = m(obj.x, obj.y);
  const b = m(obj.x + obj.width, obj.y + obj.height);
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
           width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}
