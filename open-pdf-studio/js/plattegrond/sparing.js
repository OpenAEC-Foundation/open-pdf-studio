// Sparingen: een deur of raam onderbreekt de wand waarin hij zit.
//
// Het verschil met een los kozijnsymbool bovenop de wand: een sparing hoort
// BIJ een wand. Ze bewaart geen eigen x/y maar een verwijzing naar de wand
// plus een plaats LANGS die wand (hart, mm vanaf het beginpunt) en een
// dagmaat. Daaruit volgt alles: waar de wandband open moet, hoe diep het
// kozijn is (= de wanddikte), en onder welke hoek het staat.
//
// Deze module rekent alleen; ze kent geen annotaties, geen canvas en geen
// app-state. De aanroeper levert wanden als `{ id, startX, startY, endX,
// endY, dikteMm }` en sparingen als:
//
//   { id, soort: 'deur' | 'raam', dagmaatMm, hartMm,
//     borstweringMm?, hoogteMm?, draairichting?: 'links' | 'rechts' }
//
// `hartMm` is de afstand van het beginpunt van de wand tot het HART van de
// sparing, gemeten langs de hartlijn. Maten in mm; `pxPerMm` (paginapunten
// per werkelijke millimeter) komt uit de schaal van het blad.
//
// De wandband wordt niet "doorzichtig gemaakt" maar OPGEKNIPT: de wand
// levert per solide stuk een eigen lijnstuk op. Daardoor stopt de arcering
// echt bij de dag, krijgt het gat twee nette dagkanten (de bestaande
// wandrenderer zet een kop op een vrij einde) en blijft alles werken wat al
// werkte — verstek op de hoeken, objectsnap, grips.

import { wandAs, projecteer } from '../annotations/wand-geometrie.js';

/** Soorten sparing die deze module kent. */
export const SPARING_SOORTEN = Object.freeze(['deur', 'raam']);

/** Symboolsjabloon per soort (registry-id in js/symbols/). */
export const SPARING_SYMBOOL = Object.freeze({ deur: 'door', raam: 'window' });

/** Standaardmaten (mm) per soort — bouwkundig gangbaar, niet dwingend. */
export const SPARING_STANDAARD = Object.freeze({
  deur: { dagmaatMm: 900, borstweringMm: 0, hoogteMm: 2315 },
  raam: { dagmaatMm: 1200, borstweringMm: 850, hoogteMm: 1500 },
});

const EPS = 1e-6;

function dikteMm(wand) {
  const d = Number(wand?.dikteMm);
  return d > 0 ? d : 100;
}

/** Sparing met de standaardwaarden van haar soort aangevuld. */
export function normaliseerSparing(sparing) {
  const soort = SPARING_SOORTEN.includes(sparing?.soort) ? sparing.soort : 'deur';
  const std = SPARING_STANDAARD[soort];
  const dagmaatMm = Number(sparing?.dagmaatMm) > 0 ? Number(sparing.dagmaatMm) : std.dagmaatMm;
  return {
    ...sparing,
    soort,
    dagmaatMm,
    hartMm: Number(sparing?.hartMm) || 0,
    borstweringMm: Number.isFinite(Number(sparing?.borstweringMm))
      ? Number(sparing.borstweringMm) : std.borstweringMm,
    hoogteMm: Number(sparing?.hoogteMm) > 0 ? Number(sparing.hoogteMm) : std.hoogteMm,
    draairichting: sparing?.draairichting === 'rechts' ? 'rechts' : 'links',
  };
}

/**
 * Plaatsing van één sparing op haar wand.
 * @returns {null|{ id, soort, vanPt, totPt, hart:{x,y}, van:{x,y}, tot:{x,y},
 *   breedtePt, diktePt, rotatie, dagmaatMm, borstweringMm, hoogteMm,
 *   draairichting }}
 *   `rotatie` in graden (de hoek van de wand), `diktePt` = de wanddikte, want
 *   de sparing is precies zo diep als de wand.
 */
export function sparingPlaatsing(wand, sparing, pxPerMm) {
  const as = wandAs(wand);
  if (!as || !(pxPerMm > 0)) return null;
  const s = normaliseerSparing(sparing);
  const hart = s.hartMm * pxPerMm;
  const halve = (s.dagmaatMm * pxPerMm) / 2;
  const diktePt = dikteMm(wand) * pxPerMm;
  const punt = (t) => ({ x: wand.startX + as.u.x * t, y: wand.startY + as.u.y * t });
  return {
    id: s.id,
    soort: s.soort,
    wandId: wand.id,
    vanPt: hart - halve,
    totPt: hart + halve,
    hart: punt(hart),
    van: punt(hart - halve),
    tot: punt(hart + halve),
    breedtePt: halve * 2,
    diktePt,
    rotatie: (Math.atan2(as.u.y, as.u.x) * 180) / Math.PI,
    dagmaatMm: s.dagmaatMm,
    hartMm: s.hartMm,
    borstweringMm: s.borstweringMm,
    hoogteMm: s.hoogteMm,
    draairichting: s.draairichting,
  };
}

/**
 * Past de sparing in de wand, en botst hij niet met een andere?
 * `minPenantMm` is het kleinste stuk wand dat naast een sparing moet
 * overblijven; 0 laat een kozijn tegen de hoek toe (komt op een plattegrond
 * genoeg voor), maar twee sparingen mogen elkaar nooit raken.
 * @returns {{ ok: boolean, reden?: string }}
 */
export function controleerSparing(wand, sparing, bestaande = [], pxPerMm = 1, minPenantMm = 0) {
  const as = wandAs(wand);
  if (!as) return { ok: false, reden: 'wall has no length' };
  if (!(pxPerMm > 0)) return { ok: false, reden: 'no scale' };
  const nieuw = sparingPlaatsing(wand, sparing, pxPerMm);
  if (!nieuw) return { ok: false, reden: 'opening could not be placed' };
  if (!(nieuw.breedtePt > 0)) return { ok: false, reden: 'opening width must be > 0' };
  const marge = Math.max(0, minPenantMm) * pxPerMm;
  if (nieuw.vanPt < marge - EPS || nieuw.totPt > as.len - marge + EPS) {
    return { ok: false, reden: 'opening falls outside the wall' };
  }
  for (const ander of bestaande) {
    if (!ander || ander.id === nieuw.id) continue;
    const p = sparingPlaatsing(wand, ander, pxPerMm);
    if (!p) continue;
    if (nieuw.vanPt < p.totPt + marge - EPS && p.vanPt < nieuw.totPt + marge - EPS) {
      return { ok: false, reden: 'opening overlaps another opening in the same wall' };
    }
  }
  return { ok: true };
}

/**
 * De wand opgeknipt door haar sparingen.
 *
 * @returns {{ segmenten: Array<{startX,startY,endX,endY,vanPt,totPt,lengteMm}>,
 *            sparingen: Array<object>, lengteMm: number }}
 *   `segmenten` zijn de SOLIDE stukken, in volgorde langs de wand. Sparingen
 *   die buiten de wand vallen worden afgeknipt; een sparing die precies tegen
 *   een uiteinde ligt levert geen segment van lengte nul op.
 */
export function wandMetSparingen(wand, sparingen, pxPerMm) {
  const as = wandAs(wand);
  if (!as || !(pxPerMm > 0)) return { segmenten: [], sparingen: [], lengteMm: 0 };
  const plaatsingen = [];
  for (const s of sparingen || []) {
    const p = sparingPlaatsing(wand, s, pxPerMm);
    if (!p) continue;
    const van = Math.max(0, p.vanPt);
    const tot = Math.min(as.len, p.totPt);
    if (tot - van <= EPS) continue;           // valt helemaal buiten de wand
    plaatsingen.push({ ...p, vanPt: van, totPt: tot });
  }
  plaatsingen.sort((a, b) => a.vanPt - b.vanPt);

  const segmenten = [];
  const punt = (t) => ({ x: wand.startX + as.u.x * t, y: wand.startY + as.u.y * t });
  const voegToe = (van, tot) => {
    if (tot - van <= EPS) return;
    const a = punt(van), b = punt(tot);
    segmenten.push({
      startX: a.x, startY: a.y, endX: b.x, endY: b.y,
      vanPt: van, totPt: tot, lengteMm: (tot - van) / pxPerMm,
    });
  };
  let cursor = 0;
  for (const p of plaatsingen) {
    voegToe(cursor, p.vanPt);
    cursor = Math.max(cursor, p.totPt);
  }
  voegToe(cursor, as.len);
  return { segmenten, sparingen: plaatsingen, lengteMm: as.len / pxPerMm };
}

/**
 * Bbox + rotatie voor het kozijnsymbool van een sparing: de dag breed, de
 * wand diep, om het hart van de sparing gecentreerd. Vorm die
 * `app_create_annotation` voor een parametricSymbol verwacht.
 */
export function sparingSymboolVak(plaatsing) {
  if (!plaatsing) return null;
  return {
    x: plaatsing.hart.x - plaatsing.breedtePt / 2,
    y: plaatsing.hart.y - plaatsing.diktePt / 2,
    width: plaatsing.breedtePt,
    height: plaatsing.diktePt,
    rotation: plaatsing.rotatie,
  };
}

/**
 * Sparing uit een aangewezen punt: welke plaats langs de wand hoort bij het
 * punt waar de gebruiker (of de assistent) klikte? Retourneert de afstand
 * van het beginpunt tot het HART in mm, binnen de wand geklemd.
 */
export function hartUitPunt(wand, punt, pxPerMm) {
  const pr = projecteer(punt, wand);
  if (!pr || !(pxPerMm > 0)) return 0;
  return Math.max(0, Math.min(pr.as.len, pr.t)) / pxPerMm;
}
