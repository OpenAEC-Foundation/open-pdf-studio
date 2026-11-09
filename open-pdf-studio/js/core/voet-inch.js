// Lengtes in voet-inch-breuken (#996): `12'-6 3/8"` in plaats van 12,53 ft.
//
// Architecten lezen en typen imperiale maten als voet, inch en een breuk van
// een inch; alleen ingenieurs werken met decimale voet. De voorkeur
// imperialLengthFormat kiest de weergave van lengtes in ft en in ('decimal'
// of 'feetInch'), imperialFractionPrecision de kleinste breuk (1/2 .. 1/64).
// Oppervlaktes blijven in sq ft. Puur: de app zet de bron van de voorkeur
// (stelVoetInchBronIn), tests geven de opties mee.

import { leesGetal } from './getal-invoer.js';

/** Toegestane noemers van de kleinste breuk. */
export const BREUK_PRECISIES = Object.freeze([2, 4, 8, 16, 32, 64]);
/** Toegestane waarden van imperialLengthFormat. */
export const LENGTE_FORMATEN = Object.freeze(['decimal', 'feetInch']);

const STANDAARD = Object.freeze({ formaat: 'decimal', precisie: 16 });

/** @type {null | (() => {formaat?: string, precisie?: number})} */
let bron = null;

/** Zet de bron van de voorkeur (de app: state.preferences). null = standaard. */
export function stelVoetInchBronIn(fn) {
  bron = typeof fn === 'function' ? fn : null;
}

/** Een geldige noemer (16 als de waarde onbruikbaar is). */
export function normaliseerPrecisie(p) {
  const n = Number(p);
  return BREUK_PRECISIES.includes(n) ? n : STANDAARD.precisie;
}

/** De lengtenotatie die nu geldt: { formaat, precisie }. */
export function lengteNotatie() {
  let invoer = {};
  if (bron) {
    try { invoer = bron() || {}; } catch { invoer = {}; }
  }
  return {
    formaat: LENGTE_FORMATEN.includes(invoer.formaat) ? invoer.formaat : STANDAARD.formaat,
    precisie: normaliseerPrecisie(invoer.precisie),
  };
}

/** Is dit een lengte-eenheid die in voet-inch getoond kan worden? */
export const isImperialeLengte = (unit) => unit === 'ft' || unit === 'in';

/** Toont deze notatie lengtes in deze eenheid als voet-inch? */
export function toontVoetInch(unit, notatie = lengteNotatie()) {
  return isImperialeLengte(unit) && notatie.formaat === 'feetInch';
}

/**
 * Een lengte als voet-inch-breuk: 12.53125 ft → `12'-6 3/8"`.
 * Afgerond op 1/precisie inch; 11 63/64" dat naar 12" afrondt wordt een voet.
 * @param {number} waarde
 * @param {'ft'|'in'} unit  de eenheid van `waarde`
 * @param {{precisie?: number}} [opties]
 * @returns {string}  '' voor geen getal
 */
export function formatVoetInch(waarde, unit, { precisie } = {}) {
  const n = Number(waarde);
  if (!Number.isFinite(n)) return '';
  const p = normaliseerPrecisie(precisie ?? lengteNotatie().precisie);
  const inches = unit === 'ft' ? n * 12 : n;
  let delen = Math.round(Math.abs(inches) * p);
  const negatief = inches < 0 && delen > 0;
  const perVoet = 12 * p;
  const voet = Math.floor(delen / perVoet);
  delen -= voet * perVoet;
  const heleInches = Math.floor(delen / p);
  let teller = delen - heleInches * p;
  let noemer = p;
  while (teller > 0 && teller % 2 === 0) { teller /= 2; noemer /= 2; }
  const breuk = teller > 0 ? `${teller}/${noemer}` : '';
  // Altijd hele inches voor de breuk: 0'-0 3/8", zoals de bouwtekening.
  const inchTekst = breuk ? `${heleInches} ${breuk}` : String(heleInches);
  return `${negatief ? '-' : ''}${voet}'-${inchTekst}"`;
}

const VOET = String.raw`(?:'|′|’|\s*ft\.?|\s*feet|\s*foot)`;
const INCH = String.raw`(?:"|″|”|''|\s*in\.?|\s*inch(?:es)?)`;
const GETAL = String.raw`\d+(?:[.,]\d+)?`;
// Inches: "6", "6.5", "6 3/8", "6-3/8", "3/8".
const INCHES = String.raw`(?:(${GETAL})(?:[\s-]+(\d+)\s*\/\s*(\d+))?|(\d+)\s*\/\s*(\d+))`;
const VOET_INCH = new RegExp(String.raw`^(-)?\s*(?:(${GETAL})\s*${VOET}\s*-?\s*(?:${INCHES}\s*(?:${INCH})?)?|${INCHES}\s*${INCH})$`, 'i');

const getal = (s) => (s == null ? 0 : leesGetal(s));

/**
 * Leest een voet-inchmaat: `12'-6 3/8"`, `12' 6"`, `12'6"`, `12'`, `6 3/8"`,
 * `3/8"`, `12.5'`, `150"`, `12 ft 6 in`. Een kaal getal is geen voet-inchmaat.
 * @param {unknown} tekst
 * @returns {number|null}  de lengte in inches, of null
 */
export function leesVoetInch(tekst) {
  if (typeof tekst !== 'string') return null;
  const m = VOET_INCH.exec(tekst.trim());
  if (!m) return null;
  const [, min, voet, i1, t1, n1, t2, n2, i3, t3, n3, t4, n4] = m;
  const inchDeel = (heel, teller, noemer, losTeller, losNoemer) => {
    if (losTeller != null) return Number(losNoemer) > 0 ? Number(losTeller) / Number(losNoemer) : NaN;
    if (teller != null) return Number(noemer) > 0 ? getal(heel) + Number(teller) / Number(noemer) : NaN;
    return getal(heel);
  };
  const inches = voet != null
    ? getal(voet) * 12 + inchDeel(i1, t1, n1, t2, n2)
    : inchDeel(i3, t3, n3, t4, n4);
  if (!Number.isFinite(inches)) return null;
  return min ? -inches : inches;
}

/** Millimeter per eenheid, voor het omrekenen van een getypte voet-inchmaat. */
const MM = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };

/**
 * Een getypte lengte in `unit`: een voet-inchmaat (`12'-6"`) wordt naar die
 * eenheid omgerekend, anders telt het getal (komma of punt) zoals het er staat.
 * @param {unknown} tekst
 * @param {string} unit  mm | cm | m | in | ft
 * @returns {number}  NaN bij onzin
 */
export function leesLengte(tekst, unit) {
  if (typeof tekst === 'number') return tekst;
  const inches = leesVoetInch(tekst);
  if (inches != null) return (inches * 25.4) / (MM[unit] || 1);
  return leesGetal(tekst);
}
