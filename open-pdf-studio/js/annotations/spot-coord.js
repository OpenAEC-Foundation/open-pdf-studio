// Spot Coord (tab Tekenen): een maatlijn-leidraad (measureDistance) waarvan
// het label de X,Y-positie van het beginpunt is, geen lengte. Gemarkeerd met
// dimKind 'spotCoord', zodat een herberekening (kalibreren, schaal wijzigen,
// een greep verslepen, een ander nulpunt) de coördinaten opnieuw opbouwt in plaats van er de
// lengte van de leidraad in te schrijven. Puur: geen app-state, geen DOM; de getalnotatie
// komt uit core/maat-notatie.js.

import { formatGetalKort, lijstScheiding } from '../core/maat-notatie.js';
import { coordinaatTovNulpunt, normaliseerNulpunt } from './coord-nulpunt.js';

export const SPOT_COORD = 'spotCoord';

/** Is dit een Spot Coord-label? */
export function isSpotCoord(ann) {
  return !!ann && ann.type === 'measureDistance' && ann.dimKind === SPOT_COORD;
}

/**
 * Het label: "X 12.5, Y 40 mm" in meeteenheden, zes significante cijfers.
 * @param {number} x
 * @param {number} y
 * @param {{pixelsPerUnit?: number, unit?: string}} schaal  zoals getMeasureScale()
 * @param {{x:number, y:number, yUp:boolean} | null} [nulpunt]  het nulpunt van de pagina;
 *   zonder tellen x en y vanaf de linkerbovenhoek van het blad; `wx`/`wy` zijn de
 *   waarden van het nulpunt in meeteenheden
 */
export function spotCoordTekst(x, y, schaal, nulpunt = null) {
  ({ x, y } = coordinaatTovNulpunt(x, y, nulpunt));
  // De waarde van het nulpunt zelf (bijv. een RD-coördinaat), in meeteenheden.
  const w = normaliseerNulpunt(nulpunt);
  const k = schaal?.pixelsPerUnit > 0 ? schaal.pixelsPerUnit : 1;
  const unit = schaal?.unit || 'mm';
  // Zes significante cijfers, met het decimaalteken van de taal; bij een
  // decimaalkomma scheidt een puntkomma de twee getallen (#629).
  // Bij grote waarden (een nulpunt met een RD-coördinaat) groeit het aantal
  // cijfers mee, zodat er altijd twee decimalen overblijven.
  const num = (v) => {
    if (!Number.isFinite(v)) return '0';
    const cijfers = Math.max(6, String(Math.trunc(Math.abs(v))).length + 2);
    return formatGetalKort(Number(v.toPrecision(cijfers)), 12);
  };
  return `X ${num(x / k + (w?.wx ?? 0))}${lijstScheiding()}Y ${num(y / k + (w?.wy ?? 0))} ${unit}`;
}
