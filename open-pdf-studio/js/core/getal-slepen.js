// Getal slepen — de rekenkunde achter "klik en sleep op een getal" (#1168).
//
// Puur: pixels naar een waarde, de keuze van de as, de stap per pixel, de
// toetsen die sneller of fijner maken, begrenzen en afronden. De DOM-kant
// (aanwijzer vangen, het veld bijwerken) staat in ui/getal-slepen.js.
//
// - De as ligt vast zodra de aanwijzer de drempel (4 px) passeert: de
//   richting met de grootste afstand wint. Naar rechts en omhoog is meer.
// - Elke PIXELS_PER_STAP pixels is één stap van het veld. Shift maakt de
//   stap tien keer zo groot, Alt of Ctrl tien keer zo klein.
// - Wisselt de toets halverwege, dan gaat de sleep verder vanaf de waarde
//   van dat moment: de waarde verspringt niet.
// - Een veld voor hele getallen stapt nooit fijner dan 1.

/** Zoveel pixels moet de aanwijzer bewegen voor een klik een sleep wordt. */
export const SLEEP_DREMPEL = 4;
/** Zoveel pixels slepen is één stap. */
export const PIXELS_PER_STAP = 2;

const MAX_DECIMALEN = 10;

/** Het aantal decimalen van een getal zoals het geschreven wordt. */
export function aantalDecimalen(n) {
  const s = String(n);
  const e = /e-(\d+)$/i.exec(s);
  if (e) return Number(e[1]) + ((s.split('e')[0].split('.')[1] || '').length);
  return (s.split('.')[1] || '').length;
}

/**
 * De as van de sleep, of null zolang de drempel niet gehaald is.
 * @param {number} dx  verplaatsing naar rechts sinds het indrukken
 * @param {number} dy  verplaatsing omlaag sinds het indrukken
 * @param {number} [drempel]
 * @returns {'x'|'y'|null}
 */
export function kiesAs(dx, dy, drempel = SLEEP_DREMPEL) {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (!(Math.max(ax, ay) >= drempel)) return null;
  return ax >= ay ? 'x' : 'y';
}

/** De afstand langs de as: naar rechts en omhoog is positief. */
export function sleepPixels(as, dx, dy) {
  return as === 'y' ? -dy : dx;
}

/** De versnelling van de toetsen: Shift x10, Alt/Ctrl x0,1; samen heffen ze elkaar op. */
export function factorVoor({ shift = false, fijn = false } = {}) {
  if (shift && !fijn) return 10;
  if (fijn && !shift) return 0.1;
  return 1;
}

/**
 * De stap voor een veld zonder eigen stap: de precisie van wat er staat
 * (0,25 -> 0,01; 1,5 -> 0,1), en voor hele getallen de grootte (14 -> 1;
 * 2500 -> 10; 40000 -> 100).
 * @param {number} waarde
 * @param {number} [decimalen] decimalen van de getoonde tekst
 */
export function standaardStap(waarde, decimalen = aantalDecimalen(waarde)) {
  if (decimalen > 0) return Number((10 ** -Math.min(decimalen, 3)).toFixed(3));
  const grootte = Math.abs(Number(waarde)) || 0;
  if (grootte < 1000) return 1;
  return 10 ** (Math.floor(Math.log10(grootte)) - 2);
}

/**
 * De stap waarmee een veld sleept: de eigen sleepstap (data-step), anders
 * step, anders de standaard bij de waarde. Een veld voor hele getallen
 * stapt in hele getallen.
 * @param {{sleepStap?: unknown, stap?: unknown, waarde: number, decimalen?: number, geheel?: boolean}} veld
 * @returns {number}
 */
export function stapVoorVeld({ sleepStap, stap, waarde, decimalen, geheel = false }) {
  let s = Number(sleepStap);
  if (!(s > 0) || !Number.isFinite(s)) s = Number(stap);
  if (!(s > 0) || !Number.isFinite(s)) s = standaardStap(waarde, decimalen);
  if (geheel) s = Math.max(1, Math.round(s));
  return s;
}

function grens(g) {
  if (g == null || g === '') return NaN;
  const n = Number(g);
  return Number.isFinite(n) ? n : NaN;
}

function effectieveStap(st, factor) {
  // Een veld met eigen stappen (voet-inch: 1/16 inch fijn, een voet grof).
  if (factor < 1 && st.fijneStap > 0) return st.fijneStap;
  if (factor > 1 && st.groveStap > 0) return st.groveStap;
  const s = st.stap * factor;
  return st.geheel ? Math.max(1, Math.round(s)) : s;
}

function rondAf(waarde, st, stap) {
  if (st.geheel) return Math.round(waarde);
  const dec = Math.min(MAX_DECIMALEN, Math.max(aantalDecimalen(stap), aantalDecimalen(st.basis)));
  return Number(waarde.toFixed(dec));
}

function begrens(waarde, st) {
  let w = waarde;
  if (Number.isFinite(st.min) && w < st.min) w = st.min;
  if (Number.isFinite(st.max) && w > st.max) w = st.max;
  return w;
}

/**
 * Begint een sleep.
 * @param {{waarde: number, stap: number, min?: unknown, max?: unknown, geheel?: boolean, fijneStap?: number, groveStap?: number}} veld
 *   stap: zie stapVoorVeld; min/max: grenzen (leeg = geen);
 *   geheel: alleen hele getallen; fijneStap/groveStap: eigen stap met
 *   Alt/Ctrl en met Shift in plaats van een tiende en het tienvoud
 * @returns {object} de toestand voor sleepNaar
 */
export function beginSleep({ waarde, stap, min, max, geheel = false, fijneStap = 0, groveStap = 0 }) {
  const start = Number(waarde);
  return {
    start,
    waarde: start,
    basis: start,
    basisPixels: 0,
    pixels: 0,
    factor: 1,
    stap: stap > 0 ? stap : 1,
    min: grens(min),
    max: grens(max),
    geheel: !!geheel,
    fijneStap: fijneStap > 0 ? fijneStap : 0,
    groveStap: groveStap > 0 ? groveStap : 0,
  };
}

/**
 * De toestand nadat de aanwijzer `pixels` langs de as heeft afgelegd.
 * @param {object} st  toestand van beginSleep of een eerdere sleepNaar
 * @param {number} pixels  afstand sinds het indrukken (rechts/omhoog positief)
 * @param {{shift?: boolean, fijn?: boolean}} [toetsen]
 * @returns {object} nieuwe toestand; `.waarde` is de waarde van het veld
 */
export function sleepNaar(st, pixels, toetsen = {}) {
  const factor = factorVoor(toetsen);
  let { basis, basisPixels } = st;
  if (factor !== st.factor) {
    // Andere snelheid: verder vanaf waar de sleep nu staat.
    basis = st.waarde;
    basisPixels = st.pixels;
  }
  const basisSt = { ...st, basis, basisPixels, factor, pixels };
  const stap = effectieveStap(st, factor);
  const stappen = Math.trunc((pixels - basisPixels) / PIXELS_PER_STAP);
  const waarde = begrens(rondAf(basis + stappen * stap, basisSt, stap), st);
  return { ...basisSt, waarde };
}
