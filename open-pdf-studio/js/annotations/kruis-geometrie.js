// Kruis (twee diagonalen) als 'sparing'/'vervalt'-teken in een rechthoek of
// een cirkel/ellips. Pure functies: gedeeld door scherm-rendering, de
// appearance stream bij opslaan en de eigenschappen-zichtbaarheid.

/** Annotatietypen die de eigenschap Kruis kennen. */
export const KRUIS_TYPES = Object.freeze(['box', 'circle']);

export function ondersteuntKruis(type) {
  return KRUIS_TYPES.includes(type);
}

/** Vinkje tonen bij een (meervoudige) selectie: elk type moet een kruis kennen. */
export function kruisZichtbaarVoorSelectie(annotaties) {
  return Array.isArray(annotaties) && annotaties.length > 0
    && annotaties.every(a => ondersteuntKruis(a?.type));
}

/**
 * Kruis in een ellips met middelpunt (cx, cy) en halve assen rx (x), ry (y),
 * in het eigen (ongedraaide) assenstelsel van de vorm. Twee lijnen onder ±45°
 * door het middelpunt met de eindpunten op de omtrek, zoals een rond gat
 * (sparing) op een bouwtekening. Het snijpunt van y = ±x met de ellips ligt op
 * |x| = |y| = rx·ry / √(rx² + ry²); bij een cirkel is dat r/√2.
 *
 * @returns {[{x1,y1,x2,y2},{x1,y1,x2,y2}]} lijn 1 van linksboven naar
 *   rechtsonder, lijn 2 van rechtsboven naar linksonder (y-as omlaag).
 */
export function kruisEindpuntenEllips(cx, cy, rx, ry) {
  const a = Math.abs(rx), b = Math.abs(ry);
  const d = a > 0 && b > 0 ? (a * b) / Math.hypot(a, b) : 0;
  return [
    { x1: cx - d, y1: cy - d, x2: cx + d, y2: cy + d },
    { x1: cx + d, y1: cy - d, x2: cx - d, y2: cy + d },
  ];
}
