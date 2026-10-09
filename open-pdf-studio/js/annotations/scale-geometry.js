/**
 * Vergroten/verkleinen (AutoCAD SCALE) — puur, zonder state/DOM.
 *
 * scaleAnnotation(ann, bx, by, f) schaalt alle geometrie-lineair rond het
 * basispunt (bx,by) met factor `f`. Rechthoekvormen schalen via hun
 * MIDDELPUNT, zodat een gedraaide vorm exact op zijn plaats blijft en alleen
 * groter/kleiner wordt (rotatie blijft gelijk).
 *
 * Lijndikte blijft bewust gelijk: een 2× grotere rechthoek met 2× dikkere
 * rand oogt anders dan de gebruiker wil. Tekstgrootte schaalt wél mee.
 */

const _fin = (v) => Number.isFinite(v);

export function isLineAnnotation(ann) {
  return !!ann && _fin(ann.startX) && _fin(ann.startY) && _fin(ann.endX) && _fin(ann.endY);
}

export function isRectAnnotation(ann) {
  return !!ann && _fin(ann.x) && _fin(ann.y) && _fin(ann.width) && _fin(ann.height);
}

/**
 * @param {object} ann      annotatie die wordt geschaald (gemuteerd)
 * @param {number} bx       basispunt x
 * @param {number} by       basispunt y
 * @param {number} f        schaalfactor (> 0)
 * @returns {boolean}       of er iets is geschaald
 */
export function scaleAnnotation(ann, bx, by, f) {
  if (!ann || !_fin(bx) || !_fin(by) || !_fin(f) || f <= 0) return false;
  let geschaald = false;

  if (isRectAnnotation(ann)) {
    const cx = ann.x + ann.width / 2;
    const cy = ann.y + ann.height / 2;
    const ncx = bx + (cx - bx) * f;
    const ncy = by + (cy - by) * f;
    ann.width *= f;
    ann.height *= f;
    ann.x = ncx - ann.width / 2;
    ann.y = ncy - ann.height / 2;
    geschaald = true;
  }

  if (isLineAnnotation(ann)) {
    ann.startX = bx + (ann.startX - bx) * f;
    ann.startY = by + (ann.startY - by) * f;
    ann.endX = bx + (ann.endX - bx) * f;
    ann.endY = by + (ann.endY - by) * f;
    geschaald = true;
  }

  if (Array.isArray(ann.points)) {
    ann.points = ann.points.map((p) => ({ x: bx + (p.x - bx) * f, y: by + (p.y - by) * f }));
    geschaald = true;
  }
  if (Array.isArray(ann.path)) {
    ann.path = ann.path.map((p) => ({ x: bx + (p.x - bx) * f, y: by + (p.y - by) * f }));
    geschaald = true;
  }
  if (!geschaald && _fin(ann.x) && _fin(ann.y)) {
    ann.x = bx + (ann.x - bx) * f;
    ann.y = by + (ann.y - by) * f;
    geschaald = true;
  }

  if (geschaald && _fin(ann.fontSize)) ann.fontSize *= f;
  return geschaald;
}
