// Hoeveelheden — eenheden omrekenen (puur, geen UI-deps).
//
// Eén kolom van een staat kan rijen in verschillende eenheden bevatten: een
// schaalgebied in m naast een documentschaal in mm, of een tekening in voet
// naast een in millimeters. De kolom krijgt één weergave-eenheid (zie
// kiesKolomEenheid) en elke cel wordt daarin omgerekend vóór weergave,
// subtotaal, eindtotaal, CSV en werkboek-koppeling.
//
// De factoren zijn exact (per definitie: 1 in = 25,4 mm, 1 ft = 304,8 mm,
// 1 yd = 914,4 mm). Afronden gebeurt pas bij de weergave.

import { eenheidNotatie } from '../core/maat-notatie.js';

// Tienden van een millimeter per lengte-eenheid. Hele getallen, zodat elke
// factor een verhouding van gehele getallen is: 304,8 / 25,4 gaf in drijvende
// komma 12,000000000000002, 3048 / 254 geeft precies 12.
const MM_PER = Object.freeze({
  mm: 10, cm: 100, dm: 1000, m: 10_000, km: 10_000_000,
  in: 254, ft: 3048, yd: 9144,
});

const METRISCH = new Set(['mm', 'cm', 'dm', 'm', 'km']);

const MACHT = { length: 1, area: 2, volume: 3 };
const TEKEN = { 1: '', 2: '²', 3: '³' };

/**
 * Eenheid in de vaste notatie: "m2", "m^2" en "sq m" worden "m²", "cu ft"
 * wordt "ft³", '"' wordt "in" en "'" wordt "ft". Leeg of geen tekst: ''.
 * @param {unknown} eenheid
 */
export function normaliseerEenheid(eenheid) {
  if (typeof eenheid !== 'string') return '';
  const kaal = eenheid.trim();
  if (kaal === '"') return 'in';
  if (kaal === "'") return 'ft';
  return eenheidNotatie(kaal);
}

/**
 * Ontleed een eenheid tot basis-lengte-eenheid + macht.
 * @returns {{basis: string, soort: 'length'|'area'|'volume'} | null}
 */
function ontleed(eenheid) {
  const e = normaliseerEenheid(eenheid);
  if (!e) return null;
  let basis = e, macht = 1;
  if (e.endsWith('²')) { basis = e.slice(0, -1); macht = 2; }
  else if (e.endsWith('³')) { basis = e.slice(0, -1); macht = 3; }
  if (!(basis in MM_PER)) return null;
  const soort = macht === 1 ? 'length' : (macht === 2 ? 'area' : 'volume');
  return { basis, soort };
}

/**
 * Soort van een eenheid: 'length', 'area', 'volume', of null als de eenheid
 * onbekend is (px, pt, kg, °, '' ...). Een telling heeft geen eenheid en dus
 * geen soort: die wordt nooit omgerekend.
 */
export function eenheidSoort(eenheid) {
  return ontleed(eenheid)?.soort ?? null;
}

/** Is dit een metrische eenheid (mm, cm, m², m³ ...)? */
export function isMetrisch(eenheid) {
  const o = ontleed(eenheid);
  return !!o && METRISCH.has(o.basis);
}

/**
 * Exacte factor waarmee een waarde in `van` vermenigvuldigd wordt om in
 * `naar` uit te komen; null als de eenheden niet omrekenbaar zijn (onbekend,
 * of een andere soort: lengte tegen oppervlakte).
 */
export function omrekenFactor(van, naar) {
  const a = ontleed(van), b = ontleed(naar);
  if (!a || !b || a.soort !== b.soort) return null;
  const p = MACHT[a.soort];
  return (MM_PER[a.basis] / MM_PER[b.basis]) ** p;
}

/** Kunnen waarden in `van` naar `naar` omgerekend worden (of zijn ze gelijk)? */
export function omrekenbaar(van, naar) {
  if (normaliseerEenheid(van) === normaliseerEenheid(naar)) return true;
  return omrekenFactor(van, naar) != null;
}

/**
 * Reken een waarde om van `van` naar `naar`. Gelijke eenheden: de waarde
 * ongewijzigd (ook voor onbekende eenheden). Niet omrekenbaar: null.
 * Er wordt niet afgerond.
 * @param {number} waarde
 * @param {string} van
 * @param {string} naar
 * @returns {number|null}
 */
export function rekenOm(waarde, van, naar) {
  if (typeof waarde !== 'number' || Number.isNaN(waarde)) return null;
  if (normaliseerEenheid(van) === normaliseerEenheid(naar)) return waarde;
  const a = ontleed(van), b = ontleed(naar);
  if (!a || !b || a.soort !== b.soort) return null;
  const p = MACHT[a.soort];
  // Eerst vermenigvuldigen, dan delen: 4360 mm → 4,36 m en 2 m → 2000 mm
  // komen zo zonder tussentijdse breuk uit.
  return (waarde * MM_PER[a.basis] ** p) / MM_PER[b.basis] ** p;
}

/**
 * Voorkeurseenheid van een soort bij een documentschaal-eenheid: de lengte-
 * eenheid zelf, en de oppervlakte/inhoud daarvan zoals het blad hem toont
 * (mm² en mm³ worden m² en m³; zie normaliseerMeting).
 * @param {string|null|undefined} documentEenheid  bv. 'mm' of 'ft'
 * @param {'length'|'area'|'volume'} soort
 */
export function documentEenheidVoor(documentEenheid, soort) {
  const o = ontleed(documentEenheid);
  if (!o || o.soort !== 'length' || !MACHT[soort]) return null;
  if (soort === 'length') return o.basis;
  if (o.basis === 'mm') return 'm' + TEKEN[MACHT[soort]];
  return o.basis + TEKEN[MACHT[soort]];
}

/**
 * Kies de weergave-eenheid van een kolom.
 *  1. de eenheid die de gebruiker koos, als het een bekende eenheid is;
 *  2. anders de eenheid die het vaakst in de kolom voorkomt;
 *  3. bij gelijkspel de eenheid van de documentschaal (in die soort), dan een
 *     metrische eenheid, dan de eerst geziene;
 *  4. zonder enige rij-eenheid: de vaste eenheid van het veld.
 *
 * @param {{
 *   gekozen?: string|null,
 *   rijEenheden?: (string|null|undefined)[],
 *   vast?: string,
 *   documentEenheid?: string|null,
 * }} opties
 * @returns {string}
 */
export function kiesKolomEenheid({ gekozen, rijEenheden = [], vast = '', documentEenheid = null } = {}) {
  if (gekozen && eenheidSoort(gekozen)) return normaliseerEenheid(gekozen);
  const telling = new Map();
  for (const u of rijEenheden) {
    const e = normaliseerEenheid(u);
    if (!e) continue;
    telling.set(e, (telling.get(e) || 0) + 1);
  }
  if (!telling.size) return vast;
  const max = Math.max(...telling.values());
  const gelijk = [...telling.keys()].filter(e => telling.get(e) === max);
  if (gelijk.length === 1) return gelijk[0];
  for (const e of gelijk) {
    const soort = eenheidSoort(e);
    if (soort && e === documentEenheidVoor(documentEenheid, soort)) return e;
  }
  return gelijk.find(isMetrisch) || gelijk[0];
}
