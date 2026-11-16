// Getalopmaak van een maat: decimalen of voet-inch met een breuk.
//
// Eén plek voor de tekst van een lengtemaat, zodat tekenen, slepen, het
// eigenschappenpaneel, een schaalwijziging en MCP dezelfde tekst geven.
//
// Een opmaak is { decimalen: n } of { fractie: noemer } (noemer 1 = hele
// inches, 2 .. 64 = de kleinste breuk van een inch). Een breuk toont voet-inch
// (2'-2 3/16") bij een maat in voet, alleen inches (26 3/16") bij een maat in
// inches of met `inch: true` (een viewport die alleen inches toont). Waar hij
// vandaan komt:
//   1. de maat zelf: measureFraction (voet-inch) of measurePrecision;
//   2. de viewport van de pagina (/VP /Measure /D in de PDF);
//   3. de voorkeur (imperialLengthFormat / imperialFractionPrecision).
//
// PDF 32000-1, 12.9.2 (getalopmaak): /D is een reeks opmaken; elke volgende
// rekent het restant van de vorige om met /C (voet → inch: C 12). /F is de
// soort: /D decimaal (standaard), /F breuk, /R afronden, /T afkappen. Bij
// decimaal is /D de noemer van de precisie (100 = 2 decimalen), bij een
// breuk de noemer van de breuk (16 = 1/16).
//
// Puur: geen app-staat en geen pdf-lib; de aanroeper geeft de waarden mee.

import { formatVoetInch, formatInchBreuk, BREUK_PRECISIES, isImperialeLengte } from './voet-inch.js';
import { formatGetal } from './maat-notatie.js';

/** Eenheid uit een /U-label of modelwaarde: ' en ft worden 'ft', " en in 'in'. */
export function maatEenheid(u) {
  if (typeof u !== 'string') return u;
  const k = u.trim().toLowerCase().replace(/\.$/, '');
  if (k === "'" || k === '′' || k === 'ft' || k === 'feet' || k === 'foot') return 'ft';
  if (k === '"' || k === '″' || k === "''" || k === 'in' || k === 'inch' || k === 'inches') return 'in';
  return u.trim();
}

/** Een geldige breuknoemer, anders null. */
export function geldigeFractie(n) {
  const v = Number(n);
  return BREUK_PRECISIES.includes(v) ? v : null;
}

/** Een geldig aantal decimalen (0 .. 9), anders null. */
export function geldigeDecimalen(n) {
  const v = Number(n);
  return Number.isInteger(v) && v >= 0 && v <= 9 ? v : null;
}

/**
 * De opmaak uit een /D-reeks, als gewone objecten: [{ U, C, F, D }, …]
 * (U tekst, F 'D' | 'F' | 'R' | 'T', C en D getallen).
 * @returns {{unit: string, fractie?: number, decimalen?: number} | null}
 */
export function opmaakUitGetalopmaken(reeks) {
  if (!Array.isArray(reeks) || reeks.length === 0) return null;
  const eerste = reeks[0] || {};
  const laatste = reeks[reeks.length - 1] || {};
  const unit = maatEenheid(eerste.U || '');
  const soort = String(laatste.F || 'D').replace(/^\//, '');
  const d = Number(laatste.D);
  if (soort === 'F') {
    // Een breuk van een inch: voet → inch (voet-inch), of één opmaak in
    // inches (alleen inches: 26 3/16").
    const fractie = geldigeFractie(d) ?? (d === 1 || !Number.isFinite(d) ? 1 : null);
    if (fractie && isImperialeLengte(unit)) {
      return reeks.length === 1 && unit === 'in' ? { unit, fractie, inch: true } : { unit, fractie };
    }
    return unit ? { unit, decimalen: 0 } : null;
  }
  if (soort === 'R' || soort === 'T') return unit ? { unit, decimalen: 0 } : null;
  const decimalen = Number.isFinite(d) && d >= 1 ? Math.round(Math.log10(d)) : null;
  if (decimalen === null) return unit ? { unit } : null;
  return { unit, decimalen: Math.min(9, Math.max(0, decimalen)) };
}

/**
 * De /D-reeks voor een opmaak, als gewone objecten (de saver maakt er
 * pdf-woordenboeken van). Voet-inch wordt voet → inch met /F /F; decimaal
 * één opmaak met /D 10^decimalen.
 * @param {string} unit  eenheid van de maat
 * @param {{fractie?: number, decimalen?: number}} opmaak
 */
export function getalopmaakVoorBestand(unit, opmaak = {}) {
  const u = maatEenheid(unit);
  const fractie = geldigeFractie(opmaak.fractie);
  if (fractie && isImperialeLengte(u)) {
    const inch = { U: '"', C: 12, F: 'F', D: fractie, FD: true, SS: '' };
    // Alleen inches: één opmaak in inches (vanuit voet: C 12).
    if (u === 'in') return [{ U: '"', C: 1, F: 'F', D: fractie, FD: true, SS: '' }];
    if (opmaak.inch) return [inch];
    return [{ U: "'", C: 1, F: 'F', D: fractie, FD: true, SS: '-' }, inch];
  }
  const decimalen = geldigeDecimalen(opmaak.decimalen) ?? 2;
  return [{ U: u, C: 1, D: 10 ** decimalen }];
}

/** Standaard decimalen per eenheid: mm 0, cm 1, de rest 2. */
export function standaardDecimalen(unit) {
  if (unit === 'mm') return 0;
  if (unit === 'cm' || unit === '°') return 1;
  return 2;
}

/**
 * De opmaak van een maat. measureFraction heeft drie standen:
 *   - een noemer (1 .. 64): een breuk van een inch, door de gebruiker of het
 *     bestand gekozen; voet-inch, of alleen inches bij measureInchOnly of
 *     een maat in inches;
 *   - 0: uitdrukkelijk decimaal, met measurePrecision (of de standaard per
 *     eenheid); gaat voor de viewport en de voorkeur voet-inch;
 *   - niet gezet: automatisch. Een maat met een eigen schaal neemt dan zijn
 *     measurePrecision (zoals altijd), een maat die de schaal van de pagina
 *     volgt de opmaak van de viewport, anders de standaard. Zo blijft de
 *     gereedschapsvoorkeur measureDistDimPrecision (standaard 0) zonder
 *     uitdrukkelijke keuze buiten spel.
 * @param {{measureFraction?: number, measurePrecision?: number}} ann
 * @param {{fractie?: number, decimalen?: number} | null} [viewportOpmaak]
 * @param {{eigenSchaal?: boolean}} [opties]  heeft de maat een eigen schaal?
 * @returns {{fractie?: number, decimalen?: number, decimaal?: true}}
 */
export function opmaakVanMaat(ann, viewportOpmaak = null, { eigenSchaal = true } = {}) {
  const fractie = geldigeFractie(ann?.measureFraction);
  // measureInchOnly: alleen inches (26 3/16") in plaats van voet-inch.
  if (fractie) return ann.measureInchOnly ? { fractie, inch: true } : { fractie };
  const decimalen = geldigeDecimalen(ann?.measurePrecision);
  if (ann?.measureFraction === 0) {
    return decimalen !== null ? { decimaal: true, decimalen } : { decimaal: true };
  }
  if (eigenSchaal && decimalen !== null) return { decimalen };
  if (viewportOpmaak && (viewportOpmaak.fractie || viewportOpmaak.decimalen !== undefined)) {
    if (viewportOpmaak.fractie) {
      return viewportOpmaak.inch ? { fractie: viewportOpmaak.fractie, inch: true } : { fractie: viewportOpmaak.fractie };
    }
    return { decimalen: viewportOpmaak.decimalen };
  }
  return {};
}

/**
 * De tekst van een lengte.
 * - Voet-inch als de opmaak een breuk heeft (eenheid ft of in), of als de
 *   voorkeur voet-inch is en de opmaak niet decimaal is (geen decimalen en
 *   niet uitdrukkelijk decimaal, `decimaal: true`).
 * - Anders decimaal: de decimalen van de opmaak, of standaard per eenheid.
 *   Millimeters altijd hele getallen (de afspraak van de app) en op een
 *   maatlijn zonder 'mm'.
 * @param {number} waarde
 * @param {string} eenheid
 * @param {{fractie?: number, decimalen?: number}} [opmaak]
 * @param {{maatlijn?: boolean, voorkeur?: {formaat?: string, precisie?: number}}} [opties]
 */
export function maatTekst(waarde, eenheid, opmaak = {}, { maatlijn = true, voorkeur = {} } = {}) {
  const unit = maatEenheid(eenheid || 'mm');
  const n = Number(waarde);
  if (!Number.isFinite(n)) return '';
  if (isImperialeLengte(unit)) {
    const fractie = geldigeFractie(opmaak.fractie);
    // Een breuk bij een maat in inches (of een viewport die alleen inches
    // toont): 26 3/16". Bij voet: 2'-2 3/16".
    if (fractie && (opmaak.inch || unit === 'in')) return formatInchBreuk(n, unit, { precisie: fractie });
    if (fractie) return formatVoetInch(n, unit, { precisie: fractie });
    if (voorkeur.formaat === 'feetInch' && !opmaak.decimaal && geldigeDecimalen(opmaak.decimalen) === null) {
      return formatVoetInch(n, unit, { precisie: voorkeur.precisie });
    }
  }
  if (unit === 'mm') {
    const v = formatGetal(Math.round(n), 0);
    return maatlijn ? v : `${v} mm`;
  }
  const decimalen = geldigeDecimalen(opmaak.decimalen) ?? standaardDecimalen(unit);
  const v = formatGetal(n, decimalen);
  return unit === 'px' || !unit ? v : `${v} ${unit}`;
}
