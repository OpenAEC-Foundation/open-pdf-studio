// Hoeveelheden — elementen verrijken met hun opgeloste meetschaal, zoals de
// pure engine (quantities/categories.js) ze verwacht. Eén regel voor het
// hoeveelhedenpaneel (quantitiesStore) en de opgeslagen staten
// (schedulesStore); die hielden elk een eigen kopie bij die uit elkaar liep:
// de staten gaven getekende vlakken geen schaal, waardoor hun oppervlakte in
// pagina-eenheden kwam (#982).
import { getMeasureScale, vlakLengteSchaal } from '../../annotations/measurement.js';

// Lijnvormige annotatietypes zónder eigen measureValue: hun lengte moet uit de
// geometrie + document-schaal komen (net als de meet-tools). measureDistance/
// measurePerimeter dragen hun waarde al zelf, dus die verrijken we niet.
export const LENGTH_TYPES = new Set(['line', 'arrow', 'polyline', 'wall', 'spline', 'arc', 'draw']);

// Getekende vlakken zonder eigen measureValue: idem voor de OPPERVLAKTE- en
// LENGTE-kolom (omtrek).
export const AREA_TYPES = new Set([
  'filledArea', 'polygon', 'cloud', 'cloudPolyline',
  'box', 'mask', 'redaction', 'highlight', 'circle', 'ellipse',
]);

// Representatief punt van een element voor schaal-lookup
// (scaleRegion/scaleBar zijn positie-afhankelijk).
function schaalPunt(a) {
  if (typeof a.startX === 'number' && typeof a.endX === 'number') {
    return { x: (a.startX + a.endX) / 2, y: (a.startY + a.endY) / 2 };
  }
  if (typeof a.x === 'number' && typeof a.y === 'number'
      && typeof a.width === 'number' && typeof a.height === 'number') {
    return { x: a.x + a.width / 2, y: a.y + a.height / 2 };
  }
  const pts = Array.isArray(a.points) ? a.points : (Array.isArray(a.path) ? a.path : null);
  if (pts && pts.length) {
    const cx = pts.reduce((s, p) => s + (p.x ?? 0), 0) / pts.length;
    const cy = pts.reduce((s, p) => s + (p.y ?? 0), 0) / pts.length;
    return { x: cx, y: cy };
  }
  return { x: 0, y: 0 };
}

/** Element met de px-per-eenheid schaal op zijn plek (`__pxPerUnit`, `__unit`). */
export function metSchaal(a) {
  const mid = schaalPunt(a);
  const scale = getMeasureScale(a.page || 1, mid.x, mid.y);
  return { ...a, __pxPerUnit: scale.pixelsPerUnit, __unit: scale.unit };
}

/**
 * Meetvlak met de lengteschaal waarmee zijn oppervlakte gerekend is: een eigen
 * (gekalibreerde) schaal wint, anders de schaal op het zwaartepunt — precies
 * vlakLengteSchaal. Terugval voor de omtrek als measureValue ontbreekt.
 */
function metVlakSchaal(a) {
  if (!Array.isArray(a.points) || a.points.length < 3) return a;
  const { perPt, unit } = vlakLengteSchaal(a);
  if (!(perPt > 0)) return a;
  return { ...a, __pxPerUnit: 1 / perPt, __unit: unit };
}

/**
 * Verrijk één annotatie voor de staat.
 * @param {object} a annotatie
 * @param {(id: string) => string} [telNaam] naam van een telcategorie
 */
export function verrijkVoorStaat(a, telNaam) {
  if (a.type === 'count') return telNaam ? { ...a, __countCatName: telNaam(a.categoryId) } : a;
  if (LENGTH_TYPES.has(a.type) && typeof a.measureValue !== 'number') return metSchaal(a);
  if (AREA_TYPES.has(a.type)) return metSchaal(a);
  if (a.type === 'measureArea') return metVlakSchaal(a);
  // Meet-lijnen dragen hun eigen eenheid, maar niet altijd; geef de opgeloste
  // schaal mee als terugval voor de kolomeenheid.
  if (a.type === 'measureDistance' || a.type === 'measurePerimeter') {
    return a.measureUnit ? a : metSchaal(a);
  }
  return a;
}
