// Lengtes in voet-inch-breuken (#996): `12'-6 3/8"` in plaats van 12,53 ft.
//
// Architecten lezen en typen imperiale maten als voet, inch en een breuk van
// een inch; alleen ingenieurs werken met decimale voet. De voorkeur
// imperialLengthFormat kiest de weergave van lengtes in ft en in ('decimal'
// of 'feetInch'), imperialFractionPrecision de kleinste breuk (hele inch, 1/2 .. 1/64).
// Oppervlaktes blijven in sq ft. Puur: de app zet de bron van de voorkeur
// (stelVoetInchBronIn), tests geven de opties mee.

import { leesGetal, leesGetalBegin } from './getal-invoer.js';

/** Toegestane noemers van de kleinste breuk. */
export const BREUK_PRECISIES = Object.freeze([1, 2, 4, 8, 16, 32, 64]);
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

/**
 * Een lengte in alleen inches met een breuk: 2.1828 ft → `26 3/16"`, 0,2" →
 * `3/16"`. Afgerond op 1/precisie inch, zoals formatVoetInch.
 * @param {number} waarde
 * @param {'ft'|'in'} unit  de eenheid van `waarde`
 * @param {{precisie?: number}} [opties]
 * @returns {string}  '' voor geen getal
 */
export function formatInchBreuk(waarde, unit, { precisie } = {}) {
  const n = Number(waarde);
  if (!Number.isFinite(n)) return '';
  const p = normaliseerPrecisie(precisie ?? lengteNotatie().precisie);
  const inches = unit === 'ft' ? n * 12 : n;
  const delen = Math.round(Math.abs(inches) * p);
  const negatief = inches < 0 && delen > 0;
  const heel = Math.floor(delen / p);
  let teller = delen - heel * p;
  let noemer = p;
  while (teller > 0 && teller % 2 === 0) { teller /= 2; noemer /= 2; }
  const breuk = teller > 0 ? `${teller}/${noemer}` : '';
  const tekst = breuk ? (heel > 0 ? `${heel} ${breuk}` : breuk) : String(heel);
  return `${negatief ? '-' : ''}${tekst}"`;
}

const VOET = String.raw`(?:'|′|’|\s*ft\.?|\s*feet|\s*foot)`;
const INCH = String.raw`(?:"|″|”|''|\s*in\.?|\s*inch(?:es)?)`;
const GETAL = String.raw`\d+(?:[.,]\d+)?`;
// Inches: "6", "6.5", "6 3/8", "6-3/8", "3/8".
const INCHES = String.raw`(?:(${GETAL})(?:[\s-]+(\d+)\s*\/\s*(\d+))?|(\d+)\s*\/\s*(\d+))`;
const VOET_INCH = new RegExp(String.raw`^(-)?\s*(?:(${GETAL})\s*${VOET}\s*-?\s*(?:${INCHES}\s*(?:${INCH})?)?|${INCHES}\s*${INCH})$`, 'i');

const getal = (s) => (s == null ? 0 : leesGetal(s));

/**
 * Ontleedt een voet-inchmaat: `12'-6 3/8"`, `12' 6"`, `12'6"`, `12'`, `6 3/8"`,
 * `3/8"`, `12.5'`, `6.25"`, `150"`, `12 ft 6 in`. Een kaal getal is geen
 * voet-inchmaat, een breuk zonder inchteken ook niet (`6 3/8`), en een breuk
 * achter decimale inches (`6.5 3/8"`) is onzin.
 * @param {unknown} tekst
 * @returns {{inches: number, metVoet: boolean}|null}  metVoet: er staat een voetdeel
 */
export function ontleedVoetInch(tekst) {
  if (typeof tekst !== 'string') return null;
  const m = VOET_INCH.exec(tekst.trim());
  if (!m) return null;
  const [, min, voet, i1, t1, n1, t2, n2, i3, t3, n3, t4, n4] = m;
  const inchDeel = (heel, teller, noemer, losTeller, losNoemer) => {
    if (losTeller != null) return Number(losNoemer) > 0 ? Number(losTeller) / Number(losNoemer) : NaN;
    if (teller != null) {
      // Een breuk hoort achter hele inches: 6.5 3/8" raadt de app niet.
      if (/[.,]/.test(heel)) return NaN;
      return Number(noemer) > 0 ? getal(heel) + Number(teller) / Number(noemer) : NaN;
    }
    return getal(heel);
  };
  const inches = voet != null
    ? getal(voet) * 12 + inchDeel(i1, t1, n1, t2, n2)
    : inchDeel(i3, t3, n3, t4, n4);
  if (!Number.isFinite(inches)) return null;
  return { inches: min ? -inches : inches, metVoet: voet != null };
}

/**
 * Leest een voet-inchmaat (zie ontleedVoetInch).
 * @param {unknown} tekst
 * @returns {number|null}  de lengte in inches, of null
 */
export function leesVoetInch(tekst) {
  const r = ontleedVoetInch(tekst);
  return r ? r.inches : null;
}

/** Staat er een voet- of inchteken in de tekst? Dan is het geen kaal getal. */
export function lijktOpVoetInch(tekst) {
  return typeof tekst === 'string' && /['"′″’”]/.test(tekst);
}

/** Tekens die een voet-inchmaat naast cijfers nodig heeft (invoervelden). */
export const VOET_INCH_TEKENS = `'"′″’”/ `;

/** Het voorbeeld in tooltips en lege velden. */
export const VOET_INCH_VOORBEELD = `12'-6 3/8"`;

/** Millimeter per metrische eenheid, inches per imperiale eenheid. */
const MM = { mm: 1, cm: 10, m: 1000, km: 1e6 };
const INCH_PER = { in: 1, ft: 12, yd: 36, mi: 63360 };

/**
 * Inches in een lengte-eenheid: imperiaal een hele deling (6" = 0,5 ft),
 * metrisch via 25,4 mm per inch, zonder het staartje van de binaire breuk
 * (12 x 25,4 = 304,8 en niet 304,79999999999995).
 * @returns {number}  NaN voor een eenheid zonder vaste lengte (px)
 */
export function inchesNaarEenheid(inches, unit) {
  if (INCH_PER[unit]) return inches / INCH_PER[unit];
  if (MM[unit]) return Number(((inches * 25.4) / MM[unit]).toPrecision(15));
  return NaN;
}

/**
 * Een getypte lengte in `unit`: een voet-inchmaat (`12'-6"`) wordt naar die
 * eenheid omgerekend (1 inch = 25,4 mm, exact), ongeacht de voorkeur voor de
 * weergave; anders telt het getal (komma of punt) zoals het er staat. Wat op
 * een voet-inchmaat lijkt maar er geen is (`12' 6 x"`, `6 3/0"`) is onzin: de
 * app raadt niet. Een voet-inchmaat in een eenheid zonder vaste lengte (px)
 * is ook onzin.
 * @param {unknown} tekst
 * @param {string} unit  mm | cm | m | km | in | ft | yd | mi
 * @param {{begin?: boolean}} [opties]  begin: een kaal getal mag tekst erachter
 *   hebben ("12 mm"), zoals leesGetalBegin
 * @returns {number}  NaN bij onzin
 */
export function leesLengte(tekst, unit, { begin = false } = {}) {
  if (typeof tekst === 'number') return tekst;
  const inches = leesVoetInch(tekst);
  if (inches != null) return inchesNaarEenheid(inches, unit);
  if (lijktOpVoetInch(tekst)) return NaN;
  return begin ? leesGetalBegin(tekst) : leesGetal(tekst);
}

/**
 * Een getypte lengte met de eenheid die erin staat: `12'-6"` → 12,5 ft,
 * `6 3/8"` → 6,375 in. Voor een veld waarin de eenheid meegetypt wordt.
 * @param {unknown} tekst
 * @returns {{waarde: number, eenheid: 'ft'|'in'}|null}  null: geen voet-inchmaat
 */
export function leesVoetInchMaat(tekst) {
  const r = ontleedVoetInch(tekst);
  if (!r) return null;
  return r.metVoet ? { waarde: r.inches / 12, eenheid: 'ft' } : { waarde: r.inches, eenheid: 'in' };
}
