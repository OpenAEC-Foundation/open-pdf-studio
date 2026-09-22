// Pure maatgelijk-geometrie voor de Schikken-groep "Grootte"
// (arr-same-size / arr-same-width / arr-same-height, issue #313).
//
// Dit bestand heeft bewust geen browser-imports: de kernlogica wordt ook in
// Node geünittest door scripts/test-arrange-same-size.mjs (minimummaat.js is
// zelf import-vrij). De browser-kant (selectie, undo, redraw) zit in
// js/annotations/alignment.js.

import { klemMaat } from './minimummaat.js';

// Herbereken de opgeslagen bounding box van een punt-gebaseerde annotatie.
function updateBoundsFromPoints(ann, points) {
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  ann.x = Math.min(...xs);
  ann.y = Math.min(...ys);
  ann.width = Math.max(...xs) - ann.x;
  ann.height = Math.max(...ys) - ann.y;
}

/**
 * Schaal de geometrie van één annotatie zodat de bounding box de
 * doelafmetingen krijgt. De linkerbovenhoek van de bounding box blijft
 * op zijn plaats (anker = top-left).
 *
 * @param {object} ann      annotatie (wordt gemuteerd)
 * @param {object} bounds   huidige bounding box { x, y, width, height }
 * @param {number|null} targetW  doelbreedte, of null = breedte behouden
 * @param {number|null} targetH  doelhoogte, of null = hoogte behouden
 * @returns {boolean} true wanneer de annotatie daadwerkelijk is aangepast
 */
export function resizeAnnotationToBounds(ann, bounds, targetW, targetH) {
  if (!ann || !bounds) return false;
  // Schaalfactor alleen wanneer de huidige maat > 0 is: een dimensie van 0
  // (bv. een exact horizontale lijn) heeft geen richting om in te schalen.
  const sx = (targetW != null && bounds.width > 0 && targetW !== bounds.width)
    ? targetW / bounds.width : null;
  const sy = (targetH != null && bounds.height > 0 && targetH !== bounds.height)
    ? targetH / bounds.height : null;
  const mapX = sx == null ? (x) => x : (x) => bounds.x + (x - bounds.x) * sx;
  const mapY = sy == null ? (y) => y : (y) => bounds.y + (y - bounds.y) * sy;

  switch (ann.type) {
    case 'line':
    case 'arrow':
    case 'measureDistance': {
      if (sx == null && sy == null) return false;
      ann.startX = mapX(ann.startX); ann.startY = mapY(ann.startY);
      ann.endX = mapX(ann.endX); ann.endY = mapY(ann.endY);
      if (ann.leaderStartX !== undefined) {
        ann.leaderStartX = mapX(ann.leaderStartX);
        ann.leaderStartY = mapY(ann.leaderStartY);
        ann.leaderEndX = mapX(ann.leaderEndX);
        ann.leaderEndY = mapY(ann.leaderEndY);
      }
      return true;
    }
    case 'draw': {
      if (!ann.path || ann.path.length === 0 || (sx == null && sy == null)) return false;
      ann.path.forEach(p => { p.x = mapX(p.x); p.y = mapY(p.y); });
      return true;
    }
    case 'polyline':
    case 'cloudPolyline':
    case 'measureArea':
    case 'measurePerimeter':
    case 'filledArea': {
      if (!ann.points || ann.points.length === 0 || (sx == null && sy == null)) return false;
      ann.points.forEach(p => { p.x = mapX(p.x); p.y = mapY(p.y); });
      if (ann.x !== undefined) updateBoundsFromPoints(ann, ann.points);
      return true;
    }
    case 'spline': {
      if (!ann.controlPoints || ann.controlPoints.length === 0 || (sx == null && sy == null)) return false;
      ann.controlPoints.forEach(p => { p.x = mapX(p.x); p.y = mapY(p.y); });
      return true;
    }
    case 'arc':
    case 'measureAngle':
      // Straal-/hoekpunt-model: niet-uniform schalen is hier niet zinnig.
      return false;
    default: {
      // Rechthoek-model (rect, ellipse, freetext, stamp, image, callout, …):
      // afmetingen direct zetten, positie (x/y) blijft staan. Technische
      // ondergrens: een lijn als referentie heeft hoogte 0, en die mag een
      // rechthoek niet krijgen (raaktest en index kunnen er niet mee overweg).
      let changed = false;
      if (targetW != null && typeof ann.width === 'number') {
        const w = klemMaat(targetW);
        if (ann.width !== w) { ann.width = w; changed = true; }
      }
      if (targetH != null && typeof ann.height === 'number') {
        const h = klemMaat(targetH);
        if (ann.height !== h) { ann.height = h; changed = true; }
      }
      return changed;
    }
  }
}

/**
 * Maak alle annotaties even groot/breed/hoog als de referentie-annotatie.
 *
 * @param {Array<{ann: object, b: object}>} entries  annotaties met hun bounds
 * @param {object} referenceAnn  de referentie (laatst geselecteerde); blijft zelf ongewijzigd
 * @param {{width?: boolean, height?: boolean}} opts  welke dimensies gelijkgetrokken worden
 * @returns {object[]} de daadwerkelijk gewijzigde annotaties
 */
export function matchAnnotationSizes(entries, referenceAnn, { width = false, height = false } = {}) {
  if (!Array.isArray(entries) || entries.length < 2) return [];
  const ref = entries.find(e => e && e.ann === referenceAnn && e.b);
  if (!ref) return [];
  const changed = [];
  for (const entry of entries) {
    if (!entry || !entry.ann || !entry.b) continue;
    if (entry.ann === referenceAnn || entry.ann.locked) continue;
    const didChange = resizeAnnotationToBounds(
      entry.ann, entry.b,
      width ? ref.b.width : null,
      height ? ref.b.height : null,
    );
    if (didChange) changed.push(entry.ann);
  }
  return changed;
}
