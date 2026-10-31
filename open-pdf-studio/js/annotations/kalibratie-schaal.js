// De documentschaal die de kalibratiedialoog toepast (CalibrationDialog.jsx),
// los van de JSX zodat hij onder node te testen is.
//
// De schaalverhouding rekent via pixelsPerUnitFor, dezelfde omrekening als
// het schaalgebied: zo kunnen dialoog en schaalgebied niet meer uit elkaar
// lopen. De dialoog had er een eigen tabel naast, en daarin stond ft op
// 72 / (S * 12), 144 keer te klein (#553).
import { pixelsPerUnitFor } from './scale-region.js';

/**
 * @param {object} invoer
 * @param {'reference'|'ratio'} invoer.method
 * @param {number|string} [invoer.distance]  referentielijn: bekende lengte
 * @param {number|string} [invoer.pixels]    referentielijn: lengte in PDF-punten
 * @param {number} [invoer.denominator]      schaalverhouding: N van 1:N
 * @param {string} invoer.unit               'mm' | 'cm' | 'm' | 'in' | 'ft'
 * @param {number} [invoer.userUnit]        /UserUnit van de pagina (schaalverhouding; #884)
 * @returns {{pixelsPerUnit:number, unit:string, method:string, scaleRatio:string|null}|null}
 *   null als de invoer geen schaal oplevert.
 */
export function schaalUitKalibratie({ method, distance, pixels, denominator, unit, userUnit = 1 }) {
  if (method === 'reference') {
    // Punten per eenheid = gemeten punten / bekende lengte, in elke eenheid.
    // De lijn is in pagina-eenheden gemeten, dus /UserUnit zit er al in.
    const d = parseFloat(distance);
    const p = parseFloat(pixels);
    if (!(d > 0 && p > 0)) return null;
    return { pixelsPerUnit: p / d, unit, method: 'reference', scaleRatio: null };
  }
  // Een noemer van nul of kleiner geeft geen schaal; pixelsPerUnitFor zou er
  // stil 1 van maken.
  const S = Number(denominator);
  if (!Number.isFinite(S) || S <= 0) return null;
  const scaleRatio = `1:${S}`;
  return { pixelsPerUnit: pixelsPerUnitFor(scaleRatio, unit, userUnit), unit, method: 'ratio', scaleRatio };
}
