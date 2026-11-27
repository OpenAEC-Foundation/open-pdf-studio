// Welke tekenconventie geldt op dit blad (#1230)?
//
// Een blad in voet of inch tekent wanden, deuren, ramen en ruimten zoals een
// Amerikaanse plattegrond dat doet; een metrisch blad houdt de Nederlandse
// (NEN) standaarden. De regel staat hier op EEN plek:
//
//   imperiaal  =  de schaal op het klikpunt staat in ft of in,
//                 OF de voorkeur "Eenheden" staat op Imperiaal.
//
// Alles wat van de conventie afhangt (wandstandaard, diktelijst, ruimtetag,
// getypte breedtes en later het deur- en raamsymbool) vraagt het hier.
//
// Puur: geen app-state. De schaal komt van de aanroeper (getMeasureScale, zie
// blad-conventie-op-punt.js); de voorkeur komt uit scale-presets.js
// (stelSchaalSysteemBronIn, gezet in main.js) en tests geven haar mee.

import { schaalSysteem } from '../annotations/scale-presets.js';
import { isImperiaalStelsel } from '../annotations/eenhedenstelsel.js';
import { isImperialeLengte, inchesNaarEenheid, leesLengte } from '../core/voet-inch.js';

/** De twee conventies. */
export const CONVENTIES = Object.freeze(['metric', 'imperial']);

function eenheidVan(schaal) {
  if (typeof schaal === 'string') return schaal;
  return typeof schaal?.unit === 'string' ? schaal.unit : '';
}

/**
 * Is dit een imperiaal blad?
 * @param {{unit?: string} | string | null | undefined} schaal  de schaal op het
 *   klikpunt (of alleen haar eenheid): 'ft' en 'in' zijn imperiaal
 * @param {string} [stelsel]  de voorkeur scaleUnitSystem ('metric' |
 *   'imperial' | 'both'); standaard de voorkeur van de app
 * @returns {boolean}
 */
export function isImperiaalBlad(schaal, stelsel = schaalSysteem()) {
  return isImperialeLengte(eenheidVan(schaal)) || isImperiaalStelsel(stelsel);
}

/** De conventie als naam: 'imperial' of 'metric'. */
export function bladConventie(schaal, stelsel = schaalSysteem()) {
  return isImperiaalBlad(schaal, stelsel) ? 'imperial' : 'metric';
}

/** Inches naar millimeters, exact (1 in = 25,4 mm). */
export function inchNaarMm(inch) {
  return inchesNaarEenheid(Number(inch), 'mm');
}

// ── wand ─────────────────────────────────────────────────────────────────

/**
 * De wand die het gereedschap Wand zonder verdere keuze tekent.
 * Metrisch: 100 mm metselwerk. Imperiaal: een kale wand van 6 inch, twee
 * vlaklijnen zonder arcering.
 */
export const WAND_STANDAARD = Object.freeze({
  metric: Object.freeze({ dikteMm: 100, hatchPattern: 'nen47-metselwerk-baksteen' }),
  imperial: Object.freeze({ dikteMm: inchNaarMm(6), hatchPattern: 'none' }),
});

/** @param {boolean} imperiaal */
export function wandStandaard(imperiaal) {
  return imperiaal ? WAND_STANDAARD.imperial : WAND_STANDAARD.metric;
}

/**
 * De diktes in de keuzelijst. `soort` is een toevoeging achter de maat
 * ('partition', 'cmu'); de wand zelf bewaart alleen millimeters.
 */
export const WANDDIKTES = Object.freeze({
  metric: Object.freeze([100, 150, 200, 300].map((mm) => Object.freeze({
    id: `mm-${mm}`, dikteMm: mm, maat: `${mm} mm`, soort: null,
  }))),
  imperial: Object.freeze([
    { id: 'in-4-7-8', inch: 4.875, maat: '4-7/8"', soort: 'partition' },
    { id: 'in-6', inch: 6, maat: '6"', soort: null },
    { id: 'in-6-7-8', inch: 6.875, maat: '6-7/8"', soort: 'partition' },
    { id: 'in-8', inch: 8, maat: '8"', soort: 'cmu' },
    { id: 'in-12', inch: 12, maat: '12"', soort: 'cmu' },
  ].map((k) => Object.freeze({ ...k, dikteMm: inchNaarMm(k.inch) }))),
});

/** Engelse naam van een soort, voor wie geen vertaling meegeeft. */
const SOORT_NAAM = Object.freeze({ partition: 'partition', cmu: 'CMU' });

/**
 * De keuzelijst met wanddiktes voor dit blad.
 * @param {boolean} imperiaal
 * @param {(soort: string, standaard: string) => string} [soortNaam]  vertaalt
 *   de toevoeging ('partition' / 'cmu')
 * @returns {Array<{id: string, dikteMm: number, label: string}>}
 */
export function wanddikteKeuzes(imperiaal, soortNaam = (_s, standaard) => standaard) {
  return (imperiaal ? WANDDIKTES.imperial : WANDDIKTES.metric).map((k) => ({
    id: k.id,
    dikteMm: k.dikteMm,
    label: k.soort ? `${k.maat} ${soortNaam(k.soort, SOORT_NAAM[k.soort])}` : k.maat,
  }));
}

const GELIJK_MM = 1e-6;

/** De keuze uit de lijst met deze dikte, of null (een eigen maat). */
export function wanddikteKeuze(dikteMm, imperiaal, soortNaam) {
  const d = Number(dikteMm);
  return wanddikteKeuzes(imperiaal, soortNaam).find((k) => Math.abs(k.dikteMm - d) < GELIJK_MM) || null;
}

/** Breuk van een inch in zestienden, zo ver mogelijk vereenvoudigd. */
function inchTekst(inch) {
  const zestienden = Math.round(inch * 16);
  if (Math.abs(inch * 16 - zestienden) > 1e-6) return `${Number(inch.toFixed(3))}"`;
  const heel = Math.floor(zestienden / 16);
  let teller = zestienden - heel * 16, noemer = 16;
  while (teller > 0 && teller % 2 === 0) { teller /= 2; noemer /= 2; }
  if (!teller) return `${heel}"`;
  return heel ? `${heel}-${teller}/${noemer}"` : `${teller}/${noemer}"`;
}

/**
 * Een wanddikte als tekst voor dit blad: de naam uit de lijst als ze erin
 * staat, anders de maat zelf (`5-1/2"` of `120 mm`).
 */
export function wanddikteLabel(dikteMm, imperiaal, soortNaam) {
  const keuze = wanddikteKeuze(dikteMm, imperiaal, soortNaam);
  if (keuze) return keuze.label;
  const d = Number(dikteMm);
  if (!Number.isFinite(d)) return '';
  return imperiaal ? inchTekst(d / 25.4) : `${Number(d.toFixed(3))} mm`;
}

// ── openingen ────────────────────────────────────────────────────────────

/**
 * De maten van een deur en een raam op een imperiaal blad (#1230): een deur
 * van 36 inch met een blad van 1-3/4 inch, een raam van 48 inch. De
 * metrische standaarden staan bij de sparing zelf (sparing.js).
 */
export const OPENING_STANDAARD_IMPERIAAL = Object.freeze({
  deur: Object.freeze({ breedteMm: inchNaarMm(36), bladDikteMm: inchNaarMm(1.75) }),
  raam: Object.freeze({ breedteMm: inchNaarMm(48) }),
});

/**
 * Een getypte breedte in millimeters.
 *
 * Op een imperiaal blad is een kaal getal inches (`32` is 32 inch) en lezen
 * `3'-0"`, `2'-8"`, `3'`, `2' 8"` en `2'-8 1/2"` als voet en inch. Op een
 * metrisch blad is een kaal getal millimeters; een voet-inchmaat wordt ook
 * daar omgerekend (1 inch = 25,4 mm, exact). De ontleding zelf is die van
 * core/voet-inch.js (leesLengte), zodat elke plek in de app dezelfde
 * schrijfwijzen leest.
 * @param {unknown} tekst
 * @param {boolean} imperiaal  zie isImperiaalBlad
 * @returns {number|null}  millimeters, of null bij onzin, nul of een negatieve maat
 */
export function leesBreedteMm(tekst, imperiaal) {
  if (typeof tekst !== 'string' && typeof tekst !== 'number') return null;
  if (typeof tekst === 'string' && !tekst.trim()) return null;
  const waarde = leesLengte(tekst, imperiaal ? 'in' : 'mm');
  if (!Number.isFinite(waarde) || waarde <= 0) return null;
  return imperiaal ? inchNaarMm(waarde) : waarde;
}

/**
 * Een breedte als tekst voor dit blad: hele en gebroken inches (`36"`,
 * `32-1/2"`) op een imperiaal blad, millimeters op een metrisch blad.
 */
export function breedteLabel(breedteMm, imperiaal) {
  const d = Number(breedteMm);
  if (!Number.isFinite(d)) return '';
  return imperiaal ? inchTekst(d / 25.4) : `${Number(d.toFixed(3))} mm`;
}
