// Posterafdruk: een grote pagina (A1/A0) in tegels over kleinere vellen (A4/A3).
//
// De keuze "Poster" bij Type in "Pagina plaatsing en schaling" van de
// printdialoog vervangt de schaalkeuze én het aantal pagina's per vel: elke
// pagina komt op tegelschaal (100 % = de ware maat van de tekening) en wordt
// in een raster van vellen gesneden. Aangrenzende tegels delen een strook
// (de overlap) om te knippen en te plakken; snijtekens en labels ("tegel 1,2")
// komen in een strook rond het venster, nooit over de tekening.
//
// Net als bij meerdere pagina's per vel (print-meerperblad.js) werkt de
// afdruk op de al gebouwde print-PDF: één pagina per bronpagina op haar eigen
// maat (raster- en vectorpad allebei, zonder eigen code), daarna zet
// maakPoster die pagina's in tegels op de vellen. Het voorbeeld in de
// printdialoog rekent met dezelfde regel (posterIndeling): wat het voorbeeld
// toont is wat er uit de printer komt.
//
// Maten: het vel in mm, de pagina in pt (zoals getoond, dus met draaiing).
// Rechthoeken op het vel in mm vanaf de linkerbovenhoek van het vel; een
// tegel in mm van de pagina op papier (dus na de tegelschaal), vanaf de
// linkerbovenhoek van de pagina.
//
// Het venster van een tegel is het bedrukbare gebied van de printer
// (printer_bedrukbaar, zoals in print-plaatsing.js), met snijtekens of labels
// nog RAND_MM daarbinnen: zo valt geen tegel in de onbedrukbare rand.

import {
  PDFDocument, StandardFonts, rgb, degrees,
  pushGraphicsState, popGraphicsState, rectangle, clip, endPath,
} from 'pdf-lib';
import { berekenPlaatsing, margesVoor } from './print-plaatsing.js';
import { leesGetalBegin } from '../core/getal-invoer.js';

const MM_PER_PT = 25.4 / 72;
const PT_PER_MM = 72 / 25.4;

/** Grenzen van de tegelschaal in procenten. */
export const POSTER_SCHAAL_MIN = 10;
export const POSTER_SCHAAL_MAX = 400;
/** Hoogste overlap in mm. */
export const OVERLAP_MAX_MM = 50;

/** Standaardkeuzes van de posterafdruk. */
export const POSTER_STANDAARD = Object.freeze({
  schaal: 100,
  overlap: 10,
  snijtekens: true,
  labels: true,
  alleenGroot: true,
  randAfsnijden: true,
});

/** Strook binnen het bedrukbare gebied voor snijtekens en labels (mm). */
export const RAND_MM = 7;
/** Een snijteken loopt van zoveel mm buiten het venster tot ... */
export const SNIJTEKEN_BEGIN_MM = 0.5;
/** ... zoveel mm buiten het venster. */
export const SNIJTEKEN_EIND_MM = 3.5;
/** Lijndikte van een snijteken in pt. */
export const SNIJTEKEN_DIKTE_PT = 0.3;
/** Lettergrootte van een label in pt. */
export const LABEL_PT = 6;
/** De basislijn van een label: zoveel mm onder het venster. */
export const LABEL_BASIS_MM = 6.3;
/** Kleiner dan dit (mm) mag een venster niet worden door de strook. */
const MIN_VENSTER_MM = 20;
/**
 * Speling per tegel (mm): zoveel mag een pagina per tegel langer zijn dan het
 * raster en toch dat aantal tegels houden (#855). ISO-maten zijn bij elke
 * halvering naar beneden afgerond op hele mm (2 x 420 = 840 mm, een A1 is
 * 841 mm) en een PDF-pagina is een geheel aantal punten (2384 pt = 841,02
 * mm); zonder speling werd een A1 op randloze A3 3 x 3 in plaats van 2 x 2.
 * Het raster ligt gecentreerd, dus het teveel valt verdeeld over beide
 * buitenranden (bij twee tegels hooguit 0,75 mm per kant, bij n tegels
 * hooguit n x 0,375 mm). De keuze randAfsnijden staat standaard aan; uit
 * dekt het raster de hele pagina, desnoods met een extra vel.
 */
export const SPELING_PER_TEGEL_MM = 0.75;

/** Het vel als het papier onbekend is: A4. */
export const STANDAARD_VEL = Object.freeze({ breedteMm: 210, hoogteMm: 297 });

function geldig(n) {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

function getal(v) {
  if (v === null || v === undefined || v === '') return NaN;
  return typeof v === 'string' ? leesGetalBegin(v) : Number(v);
}

/** Tegelschaal begrensd op 10..400 %, hele procenten; onzin → 100. */
export function geldigePosterSchaal(v) {
  const n = getal(v);
  if (!Number.isFinite(n)) return POSTER_STANDAARD.schaal;
  return Math.min(POSTER_SCHAAL_MAX, Math.max(POSTER_SCHAAL_MIN, Math.round(n)));
}

/** Overlap begrensd op 0..50 mm, op een tiende mm; onzin → de standaard. */
export function geldigeOverlap(v) {
  const n = getal(v);
  if (!Number.isFinite(n)) return POSTER_STANDAARD.overlap;
  return Math.min(OVERLAP_MAX_MM, Math.max(0, Math.round(n * 10) / 10));
}

/** De keuzes van de posterafdruk, gecontroleerd; ontbrekend = de standaard. */
export function posterOpties(o = {}) {
  const b = (v, terugval) => (typeof v === 'boolean' ? v : terugval);
  return {
    schaal: o.schaal === undefined ? POSTER_STANDAARD.schaal : geldigePosterSchaal(o.schaal),
    overlap: o.overlap === undefined ? POSTER_STANDAARD.overlap : geldigeOverlap(o.overlap),
    snijtekens: b(o.snijtekens, POSTER_STANDAARD.snijtekens),
    labels: b(o.labels, POSTER_STANDAARD.labels),
    alleenGroot: b(o.alleenGroot, POSTER_STANDAARD.alleenGroot),
    randAfsnijden: b(o.randAfsnijden, POSTER_STANDAARD.randAfsnijden),
  };
}

/**
 * Het vel van de tegels, staand in mm. Een tegel heeft altijd een vel nodig:
 * is het papier onbekend (de printer meldt niets, of "Opslaan als PDF"
 * zonder formaat), dan A4, met `aangenomen`.
 */
export function posterPapier(papier) {
  if (papier && typeof papier === 'object' && geldig(papier.breedteMm) && geldig(papier.hoogteMm)) {
    return {
      breedteMm: Math.min(papier.breedteMm, papier.hoogteMm),
      hoogteMm: Math.max(papier.breedteMm, papier.hoogteMm),
      bedrukbaar: papier.bedrukbaar || null,
      aangenomen: false,
    };
  }
  return { ...STANDAARD_VEL, bedrukbaar: null, aangenomen: true };
}

/**
 * Het raster langs één as: een pagina van `lengte` mm in vensters van
 * `venster` mm die `overlap` mm overlappen. Het raster ligt gecentreerd over
 * de pagina: `begin` is de plek van de eerste tegel (≤ 0, of iets meer dan 0
 * als de pagina binnen de speling langer is dan het raster), `stap` de
 * afstand tussen twee tegels. `randAfsnijden` false: geen speling, het
 * raster dekt de hele pagina.
 */
export function rasterLangs(lengte, venster, overlap, randAfsnijden = true) {
  const stap = venster - overlap;
  // n tegels dekken n * stap + overlap mm, met n * SPELING_PER_TEGEL_MM
  // speling: het kleinste n waarvoor dat de pagina haalt. De 1e-9 vangt
  // rekenruis op een precies veelvoud.
  const speling = randAfsnijden === false ? 0 : SPELING_PER_TEGEL_MM;
  const aantal = Math.max(1, Math.ceil((lengte - overlap) / (stap + speling) - 1e-9));
  const dekking = aantal === 1 ? venster : aantal * stap + overlap;
  return { aantal, begin: (lengte - dekking) / 2, stap };
}

function snijding(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const rechts = Math.min(a.x + a.breedte, b.x + b.breedte);
  const onder = Math.min(a.y + a.hoogte, b.y + b.hoogte);
  if (rechts <= x || onder <= y) return null;
  return { x, y, breedte: rechts - x, hoogte: onder - y };
}

/** Het raster van tegels voor één stand van het vel. */
function rasterVoorStand(vel, or, paginaMm, o) {
  const kort = vel.breedteMm;
  const lang = vel.hoogteMm;
  const velB = or === 'landscape' ? lang : kort;
  const velH = or === 'landscape' ? kort : lang;
  const marges = margesVoor(vel.bedrukbaar, or, velB, velH);
  const bedrukbaar = {
    x: marges.links,
    y: marges.boven,
    breedte: velB - marges.links - marges.rechts,
    hoogte: velH - marges.boven - marges.onder,
  };
  let rand = o.snijtekens || o.labels ? RAND_MM : 0;
  if (bedrukbaar.breedte - 2 * rand < MIN_VENSTER_MM || bedrukbaar.hoogte - 2 * rand < MIN_VENSTER_MM) rand = 0;
  const venster = {
    x: bedrukbaar.x + rand,
    y: bedrukbaar.y + rand,
    breedte: bedrukbaar.breedte - 2 * rand,
    hoogte: bedrukbaar.hoogte - 2 * rand,
  };
  const overlap = Math.min(o.overlap, venster.breedte / 2, venster.hoogte / 2);
  const x = rasterLangs(paginaMm.breedte, venster.breedte, overlap, o.randAfsnijden);
  const y = rasterLangs(paginaMm.hoogte, venster.hoogte, overlap, o.randAfsnijden);
  return { or, velB, velH, marges, bedrukbaar, rand, venster, overlap, x, y, aantal: x.aantal * y.aantal };
}

/** Eén tegel: het vel met zijn venster, de pagina erop, snijlijnen, -tekens en label. */
function tegelVel(r, rij, kol, pagina, paginaMm, schaal, o) {
  const { venster, overlap } = r;
  const tegel = {
    x: r.x.begin + kol * r.x.stap,
    y: r.y.begin + rij * r.y.stap,
    breedte: venster.breedte,
    hoogte: venster.hoogte,
  };
  const op = { x: venster.x - tegel.x, y: venster.y - tegel.y, breedte: paginaMm.breedte, hoogte: paginaMm.hoogte };
  const zichtbaar = snijding(op, venster);
  const bron = zichtbaar && {
    x: ((zichtbaar.x - op.x) / schaal) * PT_PER_MM,
    y: ((zichtbaar.y - op.y) / schaal) * PT_PER_MM,
    breedte: (zichtbaar.breedte / schaal) * PT_PER_MM,
    hoogte: (zichtbaar.hoogte / schaal) * PT_PER_MM,
  };
  const vel = { breedteMm: r.velB, hoogteMm: r.velH, orientatie: r.or };

  // De snijlijnen: aan de buitenkant van het raster de rand van de pagina,
  // tussen twee tegels het midden van de overlap. Twee buren hebben zo
  // dezelfde lijn op dezelfde plek van de tekening.
  const binnenX = (x) => Math.min(venster.x + venster.breedte, Math.max(venster.x, x));
  const binnenY = (y) => Math.min(venster.y + venster.hoogte, Math.max(venster.y, y));
  const snijlijnen = {
    links: kol === 0 ? binnenX(op.x) : venster.x + overlap / 2,
    rechts: kol === r.x.aantal - 1 ? binnenX(op.x + op.breedte) : venster.x + venster.breedte - overlap / 2,
    boven: rij === 0 ? binnenY(op.y) : venster.y + overlap / 2,
    onder: rij === r.y.aantal - 1 ? binnenY(op.y + op.hoogte) : venster.y + venster.hoogte - overlap / 2,
  };

  // Snijtekens: het verlengde van elke snijlijn in de strook buiten het venster.
  const snijtekens = [];
  if (o.snijtekens && r.rand > 0) {
    const boven = venster.y;
    const onder = venster.y + venster.hoogte;
    const links = venster.x;
    const rechts = venster.x + venster.breedte;
    for (const x of [snijlijnen.links, snijlijnen.rechts]) {
      snijtekens.push({ x1: x, y1: boven - SNIJTEKEN_BEGIN_MM, x2: x, y2: boven - SNIJTEKEN_EIND_MM });
      snijtekens.push({ x1: x, y1: onder + SNIJTEKEN_BEGIN_MM, x2: x, y2: onder + SNIJTEKEN_EIND_MM });
    }
    for (const y of [snijlijnen.boven, snijlijnen.onder]) {
      snijtekens.push({ x1: links - SNIJTEKEN_BEGIN_MM, y1: y, x2: links - SNIJTEKEN_EIND_MM, y2: y });
      snijtekens.push({ x1: rechts + SNIJTEKEN_BEGIN_MM, y1: y, x2: rechts + SNIJTEKEN_EIND_MM, y2: y });
    }
  }

  const label = o.labels && r.rand > 0
    ? { x: venster.x, y: venster.y + venster.hoogte + LABEL_BASIS_MM, grootteMm: LABEL_PT * MM_PER_PT }
    : null;

  return {
    nummer: rij * r.x.aantal + kol + 1,
    rij: rij + 1,
    kol: kol + 1,
    vel,
    marges: r.marges,
    bedrukbaar: r.bedrukbaar,
    venster,
    tegel,
    plaatsing: {
      bekend: true,
      vel,
      gedraaid: false,
      draaiing: 0,
      paginaPt: { breedtePt: pagina.breedtePt, hoogtePt: pagina.hoogtePt },
      pagina: op,
      zichtbaar,
      bron,
      schaal,
      marges: r.marges,
      bedrukbaar: r.bedrukbaar,
      afgesneden: false,
      buitenBedrukbaar: false,
    },
    snijlijnen,
    snijtekens,
    label,
  };
}

/**
 * Een pagina die niet getegeld wordt: op tegelschaal, gecentreerd, en zo
 * nodig verkleind tot het bedrukbare gebied ("Verkleinen" van de gewone
 * afdruk, met de tegelschaal als bovengrens). Dezelfde regel als de gewone
 * afdruk (berekenPlaatsing), dus ook de kwartslag op een vast vel.
 */
function enkelVel(vel, orientatie, pagina, s) {
  const geschaald = { breedtePt: pagina.breedtePt * s, hoogtePt: pagina.hoogtePt * s };
  const p = berekenPlaatsing({
    papier: { breedteMm: vel.breedteMm, hoogteMm: vel.hoogteMm, bedrukbaar: vel.bedrukbaar },
    orientatie,
    pagina: geschaald,
    schaling: 'shrink',
    centreren: true,
  });
  // Terug naar de echte pagina: dezelfde rechthoeken op het vel, de schaal
  // en de bron ten opzichte van de pagina op haar eigen maat.
  const plaatsing = {
    ...p,
    paginaPt: p.gedraaid
      ? { breedtePt: pagina.hoogtePt, hoogtePt: pagina.breedtePt }
      : { breedtePt: pagina.breedtePt, hoogtePt: pagina.hoogtePt },
    schaal: p.schaal * s,
    bron: p.bron && {
      x: p.bron.x / s, y: p.bron.y / s, breedte: p.bron.breedte / s, hoogte: p.bron.hoogte / s,
    },
  };
  return {
    nummer: 1,
    rij: 1,
    kol: 1,
    vel: p.vel,
    marges: p.marges,
    bedrukbaar: p.bedrukbaar,
    venster: null,
    tegel: null,
    plaatsing,
    snijlijnen: null,
    snijtekens: [],
    label: null,
  };
}

/**
 * De posterindeling van één pagina: het raster en per vel de tegel.
 *
 * @param {{ papier: {breedteMm:number, hoogteMm:number, bedrukbaar?:object}|'pagina'|null,
 *           orientatie?: 'auto'|'portrait'|'landscape',
 *           pagina: {breedtePt:number, hoogtePt:number},
 *           opties?: {schaal?:number, overlap?:number, snijtekens?:boolean,
 *                     labels?:boolean, alleenGroot?:boolean,
 *                     randAfsnijden?:boolean} }} p
 *   pagina = de pagina zoals getoond (met draaiing), dezelfde maat als de
 *   pagina in de print-PDF; orientatie 'auto' = de stand met de minste vellen
 *   (gelijk: die van de pagina).
 * @returns {null | {
 *   getegeld: boolean, aangenomen: boolean, schaal: number,
 *   paginaMm: {breedte:number, hoogte:number},
 *   kolommen: number, rijen: number, overlap: number,
 *   vel: {breedteMm:number, hoogteMm:number, orientatie:string},
 *   vellen: { nummer:number, rij:number, kol:number, vel:object,
 *             marges:object, bedrukbaar:object,
 *             venster: object|null, tegel: object|null,
 *             plaatsing: object, snijlijnen: object|null,
 *             snijtekens: {x1:number, y1:number, x2:number, y2:number}[],
 *             label: {x:number, y:number, grootteMm:number}|null }[] }}
 *   getegeld false: de pagina past op één vel ("alleen grote pagina's") en
 *   komt er gewoon op. Per vel: venster = waar de tegel op het vel komt;
 *   tegel = datzelfde stuk in mm van de pagina op papier; plaatsing = de
 *   pagina op het vel zoals print-plaatsing.js haar beschrijft (renderDeel
 *   werkt erop); snijlijnen en snijtekens in mm op het vel; label = de
 *   basislijn linksonder van de labeltekst.
 *   null als de paginamaat onbruikbaar is.
 */
export function posterIndeling({ papier, orientatie = 'auto', pagina, opties }) {
  if (!pagina || !geldig(pagina.breedtePt) || !geldig(pagina.hoogtePt)) return null;
  const o = posterOpties(opties);
  const vel = posterPapier(papier);
  const s = o.schaal / 100;
  const paginaMm = {
    breedte: pagina.breedtePt * MM_PER_PT * s,
    hoogte: pagina.hoogtePt * MM_PER_PT * s,
  };

  if (o.alleenGroot) {
    const ware = berekenPlaatsing({
      papier: { breedteMm: vel.breedteMm, hoogteMm: vel.hoogteMm, bedrukbaar: vel.bedrukbaar },
      orientatie,
      pagina: { breedtePt: pagina.breedtePt * s, hoogtePt: pagina.hoogtePt * s },
      schaling: 'actual',
      centreren: true,
    });
    if (ware && !ware.afgesneden) {
      const enkel = enkelVel(vel, orientatie, pagina, s);
      return {
        getegeld: false,
        aangenomen: vel.aangenomen,
        schaal: enkel.plaatsing.schaal,
        paginaMm,
        kolommen: 1,
        rijen: 1,
        overlap: 0,
        vel: enkel.vel,
        vellen: [enkel],
      };
    }
  }

  const standen = orientatie === 'portrait' || orientatie === 'landscape'
    ? [orientatie]
    : (paginaMm.breedte > paginaMm.hoogte ? ['landscape', 'portrait'] : ['portrait', 'landscape']);
  const r = standen
    .map((or) => rasterVoorStand(vel, or, paginaMm, o))
    .reduce((beste, kandidaat) => (kandidaat.aantal < beste.aantal ? kandidaat : beste));

  const vellen = [];
  for (let rij = 0; rij < r.y.aantal; rij++) {
    for (let kol = 0; kol < r.x.aantal; kol++) vellen.push(tegelVel(r, rij, kol, pagina, paginaMm, s, o));
  }
  return {
    getegeld: true,
    aangenomen: vel.aangenomen,
    schaal: s,
    paginaMm,
    kolommen: r.x.aantal,
    rijen: r.y.aantal,
    overlap: r.overlap,
    vel: vellen[0].vel,
    vellen,
  };
}

/**
 * Alle vellen van de afdruk achter elkaar: per pagina (in printvolgorde)
 * haar vellen. `indelingen` zijn de posterIndelingen van de pagina's.
 * @returns {{ paginaIndex:number, indeling:object, vel:object }[]}
 */
export function posterVellen(indelingen) {
  const uit = [];
  (indelingen || []).forEach((indeling, paginaIndex) => {
    if (!indeling) return;
    for (const vel of indeling.vellen) uit.push({ paginaIndex, indeling, vel });
  });
  return uit;
}

/**
 * Hoeveel mm de afdruk hooguit van één buitenrand van een pagina afsnijdt
 * (de speling van SPELING_PER_TEGEL_MM): het raster ligt gecentreerd, dus
 * een eerste tegel die op x of y > 0 begint, laat aan die kant en aan de
 * overkant evenveel weg. 0 als alles op papier komt.
 */
export function posterRandAfsnijding(indelingen) {
  let max = 0;
  for (const indeling of indelingen || []) {
    if (!indeling || !indeling.getegeld) continue;
    const tegel = indeling.vellen[0] && indeling.vellen[0].tegel;
    if (tegel) max = Math.max(max, tegel.x, tegel.y);
  }
  return max;
}

/** Hoeveel vellen de afdruk wordt. */
export function aantalPosterVellen(indelingen) {
  return (indelingen || []).reduce((n, i) => n + (i ? i.vellen.length : 0), 0);
}

// --- labels ------------------------------------------------------------------------

// Tekens die het standaardfont (Helvetica, WinAnsi) naast Latin-1 kan.
const WIN_ANSI_EXTRA = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
  0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x017e, 0x0178,
]);

function winAnsiTeken(c) {
  const n = c.codePointAt(0);
  return (n >= 0x20 && n <= 0x7e) || (n >= 0xa0 && n <= 0xff) || WIN_ANSI_EXTRA.has(n);
}

/** Kan het standaardfont van de labels deze tekst zetten? */
export function isWinAnsi(tekst) {
  return [...String(tekst)].every(winAnsiTeken);
}

/** De tekst met elk teken dat het standaardfont niet kan als '?'. */
export function winAnsiTekst(tekst) {
  return [...String(tekst)].map((c) => (winAnsiTeken(c) ? c : '?')).join('');
}

const MAX_BESTANDSNAAM = 48;

/** De Engelse labeltekst: als de vertaling niet in het standaardfont past. */
function engelsLabel({ file, page, row, col, rows, cols }) {
  return `${file} - page ${page} - tile ${row},${col} (${rows} x ${cols})`;
}

/**
 * De tekst van een label: bestandsnaam, paginanummer en de tegel (rij,
 * kolom, en het raster). `vertaal` geeft de tekst in de taal van de app;
 * past die niet in het standaardfont van de PDF (Chinees, Arabisch, ...), dan
 * de Engelse. Een lange bestandsnaam wordt ingekort, tekens die het font niet
 * kan worden '?'. Het voorbeeld en de afdruk tonen dezelfde tekst.
 */
export function posterLabel({ vertaal = null, bestand = '', pagina, rij, kol, rijen, kolommen }) {
  let naam = String(bestand || '');
  if ([...naam].length > MAX_BESTANDSNAAM) naam = `${[...naam].slice(0, MAX_BESTANDSNAAM - 1).join('')}…`;
  const waarden = { file: winAnsiTekst(naam), page: pagina, row: rij, col: kol, rows: rijen, cols: kolommen };
  let tekst = null;
  if (typeof vertaal === 'function') {
    try { tekst = vertaal(waarden); } catch { tekst = null; }
  }
  if (typeof tekst !== 'string' || !tekst.trim() || !isWinAnsi(tekst)) tekst = engelsLabel(waarden);
  return tekst;
}

// --- de print-PDF ---------------------------------------------------------------------

/**
 * Teken één vel van de poster: de tegel (de pagina, geknipt tot het venster)
 * of de hele pagina, en de snijtekens en het label.
 */
function tekenPosterVel(uit, ingebed, v, { font, labelTekst }) {
  const k = PT_PER_MM;
  const B = v.vel.breedteMm * k;
  const H = v.vel.hoogteMm * k;
  const blad = uit.addPage([B, H]);
  const r = v.plaatsing.pagina;
  if (v.venster) {
    const w = v.venster;
    blad.pushOperators(
      pushGraphicsState(),
      rectangle(w.x * k, H - (w.y + w.hoogte) * k, w.breedte * k, w.hoogte * k),
      clip(),
      endPath(),
    );
    blad.drawPage(ingebed, { x: r.x * k, y: H - (r.y + r.hoogte) * k, width: r.breedte * k, height: r.hoogte * k });
    blad.pushOperators(popGraphicsState());
  } else if (v.plaatsing.gedraaid) {
    // Een kwartslag linksom (de bovenrand naar links), zoals DRAAIING_HAAKS:
    // de oorsprong van de pagina komt rechtsonder in haar rechthoek.
    blad.drawPage(ingebed, {
      x: (r.x + r.breedte) * k,
      y: H - (r.y + r.hoogte) * k,
      width: r.hoogte * k,
      height: r.breedte * k,
      rotate: degrees(90),
    });
  } else {
    blad.drawPage(ingebed, { x: r.x * k, y: H - (r.y + r.hoogte) * k, width: r.breedte * k, height: r.hoogte * k });
  }
  for (const s of v.snijtekens) {
    blad.drawLine({
      start: { x: s.x1 * k, y: H - s.y1 * k },
      end: { x: s.x2 * k, y: H - s.y2 * k },
      thickness: SNIJTEKEN_DIKTE_PT,
      color: rgb(0, 0, 0),
    });
  }
  if (v.label && font && labelTekst) {
    blad.drawText(labelTekst, { x: v.label.x * k, y: H - v.label.y * k, size: LABEL_PT, font, color: rgb(0, 0, 0) });
  }
  return blad;
}

/**
 * Bouw de posterafdruk uit `pdf` (de print-PDF met één pagina per bronpagina
 * op haar eigen maat, zoals bouwPrintPdf/bouwVectorPrintPdf die maken met
 * papier null). Geeft een nieuw PDFDocument met de vellen in printvolgorde.
 *
 * @param {PDFDocument} pdf
 * @param {{ papier: object|'pagina'|null, orientatie?: 'auto'|'portrait'|'landscape',
 *           opties?: object, paginaNummers?: number[], bestand?: string,
 *           vertaal?: ((waarden:object) => string)|null }} o
 *   paginaNummers = het paginanummer in het document per pagina van `pdf`
 *   (voor het label); bestand = de naam van het document.
 */
export async function maakPoster(pdf, {
  papier = null, orientatie = 'auto', opties = {}, paginaNummers = [], bestand = '', vertaal = null,
} = {}) {
  const bron = pdf.getPages();
  if (bron.length === 0) return pdf;
  const o = posterOpties(opties);
  // Zoals maakMeerPerBlad: pas na flush staan lui ingebedde beelden en fonts
  // in de bron, anders kopieert embedPdf alleen de verwijzingen.
  await pdf.flush();
  const uit = await PDFDocument.create();
  const ingebed = await uit.embedPdf(pdf, bron.map((_, i) => i));
  const font = o.labels ? await uit.embedFont(StandardFonts.Helvetica) : null;
  for (let i = 0; i < bron.length; i++) {
    const { width, height } = bron[i].getSize();
    const indeling = posterIndeling({ papier, orientatie, pagina: { breedtePt: width, hoogtePt: height }, opties: o });
    if (!indeling) throw new Error(`page ${i + 1} has no usable size`);
    for (const v of indeling.vellen) {
      const labelTekst = v.label
        ? posterLabel({
          vertaal, bestand, pagina: paginaNummers[i] ?? i + 1,
          rij: v.rij, kol: v.kol, rijen: indeling.rijen, kolommen: indeling.kolommen,
        })
        : null;
      tekenPosterVel(uit, ingebed[i], v, { font, labelTekst });
    }
  }
  return uit;
}
