import { mapContourNode } from './bezier-contour.js';
/**
 * Vergroten/verkleinen (CAD-stijl schalen) — puur, zonder state/DOM.
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
    // Maat met hulplijnen: de basispunten schalen mee, anders staan
    // maatlijn en gemeten punten niet meer bij elkaar.
    if (_fin(ann.leaderStartX) && _fin(ann.leaderStartY)) {
      ann.leaderStartX = bx + (ann.leaderStartX - bx) * f;
      ann.leaderStartY = by + (ann.leaderStartY - by) * f;
    }
    if (_fin(ann.leaderEndX) && _fin(ann.leaderEndY)) {
      ann.leaderEndX = bx + (ann.leaderEndX - bx) * f;
      ann.leaderEndY = by + (ann.leaderEndY - by) * f;
    }
    geschaald = true;
  }

  // Overige puntvelden (boog: arc/bulge) blijven op het punt staan; een
  // bulge is relatief tot de koorde en klopt dus ook na uniform schalen.
  const schaalPunt = p => mapContourNode(p, q => ({ x: bx + (q.x - bx) * f, y: by + (q.y - by) * f }));
  if (Array.isArray(ann.points)) {
    ann.points = ann.points.map(schaalPunt);
    geschaald = true;
  }
  if (Array.isArray(ann.holes)) {
    ann.holes = ann.holes.map((ring) => (Array.isArray(ring) ? ring.map(schaalPunt) : ring));
  }
  if (Array.isArray(ann.path)) {
    ann.path = ann.path.map(schaalPunt);
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
