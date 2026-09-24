// Een wandpakket (spouwmuur) met een kozijn erin: welke sparing krijgt
// elke laag, waar staat het kozijn, en hoe sluiten de lagen in een hoek.
//
// Een spouwmuur wordt getekend als losse wanden per laag (buitenblad,
// isolatie, binnenblad; de luchtspouw is ruimte en wordt niet getekend).
// Een kozijn staat in zo'n muur niet in één laag maar in het pakket:
//   - het buitenblad (de lagen vóór het kozijn) heeft een AANSLAG over het
//     kozijn: de sparing in het metselwerk is 2 x aanslag smaller;
//   - een laag waarin het kozijn staat (isolatie) sluit ertegen: sparing =
//     kozijnmaat;
//   - het binnenblad (de lagen achter het kozijn) heeft een dagkant met
//     SPELING: sparing = kozijnmaat + 2 x speling.
// Dat volgt allemaal uit de diepte van het kozijn in het pakket (positie
// vanaf het buitenvlak) — er is geen aparte regel per laagnaam.
//
// Deze module rekent alleen; de maten zijn werkelijke mm, lijnen in
// paginapunten. De lijn die de aanroeper geeft is het BUITENVLAK van het
// pakket (dezelfde afspraak als spouwmuurLagen in wand-geometrie.js).

import { spouwmuurLagen, wandAs, lijnSnijpunt } from '../annotations/wand-geometrie.js';
import { KOZIJN_STANDAARD } from './kozijnprofiel.js';

/** Nederlandse spouwmuur, van buiten naar binnen. */
export const SPOUWMUUR_STANDAARD = Object.freeze([
  Object.freeze({ dikteMm: 100, materiaal: 'nen47-metselwerk-baksteen' }),
  Object.freeze({ dikteMm: 40, materiaal: 'none' }),
  Object.freeze({ dikteMm: 100, materiaal: 'isolatie', isolatie: 'pir' }),
  Object.freeze({ dikteMm: 120, materiaal: 'nen47-metselwerk-kunststeen' }),
]);

/** Aanslag van het buitenblad en speling van het binnenblad (mm). */
export const KOZIJN_IN_SPOUW = Object.freeze({ aanslagMm: 20, spelingMm: 10 });

const EPS = 1e-6;

function getal(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isIsolatie(materiaal) {
  return materiaal === 'isolatie' || String(materiaal || '').startsWith('iso-');
}

/**
 * Lagen van buiten naar binnen, met hun diepte in het pakket.
 * Invoer per laag: { dikteMm | thicknessMm, materiaal | material,
 * isolatie | insulation }. Zonder materiaal: de buitenste laag metselwerk,
 * de binnenste kalkzandsteen, een laag met isolatiesoort isolatie, en
 * verder een luchtspouw.
 * @returns {{ lagen: Array<{ dikteMm, materiaal, isolatie?, v0Mm, v1Mm,
 *   rol: 'blad'|'isolatie'|'lucht', getekend: boolean }>, dikteMm: number }}
 */
export function normaliseerPakket(invoer) {
  const ruw = Array.isArray(invoer) ? invoer.filter(Boolean) : [];
  const lagen = [];
  let v = 0;
  ruw.forEach((l, i) => {
    const dikteMm = (getal(l.dikteMm ?? l.thicknessMm) ?? 0) > 0 ? getal(l.dikteMm ?? l.thicknessMm) : 100;
    const isolatie = l.isolatie || l.insulation || null;
    let materiaal = l.materiaal || l.material || null;
    if (!materiaal) {
      if (isolatie) materiaal = 'isolatie';
      else if (i === 0) materiaal = 'nen47-metselwerk-baksteen';
      else if (i === ruw.length - 1) materiaal = 'nen47-metselwerk-kunststeen';
      else materiaal = 'none';
    }
    const rol = materiaal === 'none' ? 'lucht' : (isIsolatie(materiaal) ? 'isolatie' : 'blad');
    lagen.push({
      dikteMm, materiaal, ...(isolatie ? { isolatie } : {}),
      v0Mm: v, v1Mm: v + dikteMm, rol, getekend: rol !== 'lucht',
    });
    v += dikteMm;
  });
  return { lagen, dikteMm: v };
}

/**
 * Het kozijn in het pakket, met standaardwaarden:
 *   - diepte 114, nooit dieper dan het pakket;
 *   - positie: in een spouwmuur direct achter het buitenblad (de eerste
 *     laag), in een enkele wand in het midden;
 *   - aanslag en speling alleen als er een laag vóór of achter het kozijn
 *     ligt (in een enkele wand dus 0).
 * @param {{ lagen, dikteMm }} pakket  uit normaliseerPakket
 * @param {{ positieMm?, diepteMm?, aanslagMm?, spelingMm? }} kozijn
 */
export function kozijnInPakket(pakket, kozijn = {}) {
  const T = pakket.dikteMm;
  const diepteMm = Math.min((getal(kozijn.diepteMm) ?? 0) > 0 ? getal(kozijn.diepteMm) : KOZIJN_STANDAARD.stijlDiepteMm, T);
  const vrij = T - diepteMm;
  const gelaagd = pakket.lagen.length > 1;
  let positieMm = getal(kozijn.positieMm);
  if (positieMm === null || positieMm < 0) {
    positieMm = gelaagd && pakket.lagen[0].rol === 'blad' ? pakket.lagen[0].v1Mm : vrij / 2;
  }
  positieMm = Math.max(0, Math.min(positieMm, vrij));
  const ervoor = pakket.lagen.some((l) => l.getekend && l.v1Mm <= positieMm + EPS);
  const erachter = pakket.lagen.some((l) => l.getekend && l.v0Mm >= positieMm + diepteMm - EPS);
  const aanslag = getal(kozijn.aanslagMm);
  const speling = getal(kozijn.spelingMm);
  return {
    positieMm,
    diepteMm,
    aanslagMm: Math.max(0, aanslag ?? (ervoor ? KOZIJN_IN_SPOUW.aanslagMm : 0)),
    spelingMm: Math.max(0, speling ?? (erachter ? KOZIJN_IN_SPOUW.spelingMm : 0)),
  };
}

/**
 * Breedte van de sparing in één laag (mm).
 * @param {{ v0Mm, v1Mm }} laag
 * @param {{ breedteMm, positieMm, diepteMm, aanslagMm, spelingMm }} kozijn
 */
export function laagSparingMm(laag, kozijn) {
  const W = Number(kozijn.breedteMm) || 0;
  const van = Number(kozijn.positieMm) || 0;
  const tot = van + (Number(kozijn.diepteMm) || 0);
  if (laag.v1Mm <= van + EPS) return Math.max(0, W - 2 * (Number(kozijn.aanslagMm) || 0));
  if (laag.v0Mm >= tot - EPS) return W + 2 * (Number(kozijn.spelingMm) || 0);
  return W;
}

/**
 * Hartlijnen per laag uit het buitenvlak van het pakket. `binnenzijde`:
 * 'rechts' (standaard; rechts van de tekenrichting — bij een met de klok
 * mee getekende omtrek de binnenkant) of 'links'.
 */
export function laagLijnen(start, end, pakket, pxPerMm, binnenzijde = 'rechts') {
  return spouwmuurLagen(start, end, pakket.lagen, pxPerMm, binnenzijde === 'links' ? 'links' : 'rechts');
}

/**
 * Hoek met een eerder getekende gevel van hetzelfde pakket. Bij het
 * hoekpunt S van het buitenvlak ligt het (nog niet verstekte) einde van
 * elke laag van die gevel precies op de normaal door S, op de afstand van
 * het hart van die laag. Zo'n wand van dezelfde dikte en hetzelfde
 * materiaal is de aansluitende laag; zijn einde en het begin van de nieuwe
 * laag gaan naar het snijpunt van beide laaghartlijnen, waarna de
 * wandrenderer de hoek zelf verstekt (samenvallende eindpunten).
 *
 * Werkt zonder extra gegevens op de wanden, dus ook na opslaan en
 * heropenen.
 *
 * @param {{x, y}} S          hoekpunt op het buitenvlak
 * @param {object} laag       laaglijn uit laagLijnen (startX.., dikteMm,
 *                            materiaal, v0Mm, v1Mm)
 * @param {Array} wanden      bestaande wand-annotaties
 * @returns {null|{ wand, eind: 'start'|'end', snijpunt: {x, y} }}
 */
export function zoekLaagHoek(S, laag, wanden, opties = {}) {
  const k = Number(opties.pxPerMm) || 1;
  const zijde = opties.binnenzijde === 'links' ? -1 : 1;
  const tol = opties.tol ?? 0.5;
  const offset = ((laag.v0Mm + laag.v1Mm) / 2) * k;
  const eigen = wandAs(laag);
  if (!eigen) return null;
  const grens = Math.max(10 * offset, 20);
  let beste = null;
  for (const w of wanden || []) {
    if (!w || w.type !== 'wall') continue;
    if (Math.abs((Number(w.dikteMm) || 100) - laag.dikteMm) > 0.5) continue;
    if ((w.hatchPattern || 'none') !== laag.materiaal) continue;
    const as = wandAs(w);
    if (!as) continue;
    const verwacht = { x: S.x + as.n.x * zijde * offset, y: S.y + as.n.y * zijde * offset };
    for (const eind of ['start', 'end']) {
      const P = eind === 'start' ? { x: w.startX, y: w.startY } : { x: w.endX, y: w.endY };
      const afstand = Math.hypot(P.x - verwacht.x, P.y - verwacht.y);
      if (afstand > tol) continue;
      const X = lijnSnijpunt(P, as.u, { x: laag.startX, y: laag.startY }, eigen.u);
      if (!X || Math.hypot(X.x - S.x, X.y - S.y) > grens) continue;
      if (!beste || afstand < beste.afstand) beste = { wand: w, eind, snijpunt: X, afstand };
    }
  }
  if (!beste) return null;
  return { wand: beste.wand, eind: beste.eind, snijpunt: beste.snijpunt };
}
