/**
 * Lengte intypen tijdens het slepen van een eindpunt-handvat — pure logica.
 *
 * Tijdens het slepen van een eindpunt van een geselecteerde maatlijn (of lijn
 * of pijl) kan de gebruiker een lengte typen, met dezelfde notatie als bij het
 * tekenen (coord-invoer.js). Deze module bepaalt welk punt vast blijft en
 * welk punt beweegt, in welke schaal de getypte waarde staat, en waar het
 * gesleepte punt dan komt te liggen. Alle coördinaten zijn paginacoördinaten.
 */

import { parseCoordBuffer, beperkEindpunt } from './coord-invoer.js';

const LIJN_TYPES = new Set(['line', 'arrow']);

/**
 * Vast en bewegend punt voor een handvat, of null als dit handvat geen
 * lengte-eindpunt is.
 *
 * - maatlijn met hulplijnen: de hulplijn-tips (leader_start/leader_end) zijn
 *   de gemeten punten; de binnenste handvatten verschuiven alleen de offset.
 * - maatlijn zonder hulplijnen, lijn en pijl: line_start/line_end.
 */
export function gripLengteEindpunten(ann, handle) {
  if (!ann || typeof handle !== 'string') return null;
  const punt = (x, y) => ({ x, y });
  if (ann.type === 'measureDistance' && ann.leaderStartX !== undefined) {
    if (handle === 'leader_end') {
      return { vast: punt(ann.leaderStartX, ann.leaderStartY), beweeg: punt(ann.leaderEndX, ann.leaderEndY) };
    }
    if (handle === 'leader_start') {
      return { vast: punt(ann.leaderEndX, ann.leaderEndY), beweeg: punt(ann.leaderStartX, ann.leaderStartY) };
    }
    return null;
  }
  if (ann.type === 'measureDistance' || LIJN_TYPES.has(ann.type)) {
    if (handle === 'line_end') {
      return { vast: punt(ann.startX, ann.startY), beweeg: punt(ann.endX, ann.endY) };
    }
    if (handle === 'line_start') {
      return { vast: punt(ann.endX, ann.endY), beweeg: punt(ann.startX, ann.startY) };
    }
  }
  return null;
}

/**
 * Pixels per maateenheid voor de getypte waarde. Een maatlijn met een eigen
 * schaal (measureScale = eenheden per pixel) gebruikt die, zodat de getypte
 * waarde exact de getoonde maat wordt; anders geldt de schaal ter plaatse.
 */
export function pixelsPerEenheidVoor(ann, schaalPxPerEenheid) {
  if (ann?.type === 'measureDistance' && ann.measureScale > 0) return 1 / ann.measureScale;
  return schaalPxPerEenheid > 0 ? schaalPxPerEenheid : 1;
}

/**
 * Nieuwe positie van het gesleepte punt voor de getypte buffer, of null als
 * de invoer (nog) niets bepaalt. `richting` is het huidige (gesnapte /
 * orthogonale) sleeppunt; valt dat samen met het vaste punt, dan geldt
 * `terugval` (bijv. het oorspronkelijke eindpunt) als richting.
 */
export function nieuwEindpuntVoorInvoer(buffer, vast, richting, pxPerEenheid, terugval = null) {
  const r = parseCoordBuffer(buffer);
  let rx = richting.x, ry = richting.y;
  if (terugval && rx === vast.x && ry === vast.y) { rx = terugval.x; ry = terugval.y; }
  const p = beperkEindpunt(r, vast.x, vast.y, rx, ry, pxPerEenheid);
  return p.constrained ? { x: p.x, y: p.y } : null;
}

/** Toetsen die tijdens het slepen de lengte-invoer openen. */
export function isGripLengteStartToets(key) {
  return /^[0-9]$/.test(key) || key === '.' || key === '-' || key === '=';
}
