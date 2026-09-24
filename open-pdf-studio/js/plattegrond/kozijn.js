// Een kozijn in een wand, zoals de symbolen `door` en `window` het tekenen.
//
// Deze module rekent de indeling van één kozijn uit in werkelijke mm en
// zet die om in tekenopdrachten voor het symbool. De profielen zelf
// (stijl met sponning, glas, deurblad, raamhout) komen uit kozijnprofiel.js.
//
// Assen zoals in kozijnprofiel.js: u langs de wand, u = 0 is de linker
// buitenkant van het kozijn en u = breedte de rechter; v dwars, v = 0 is het
// BUITENvlak van de wand (of van het hele wandpakket bij een spouwmuur) en
// v = wanddikte het binnenvlak. Het kozijn staat op v = positie .. positie +
// diepte.
//
// In het symbool staat de BINNENzijde bovenaan (v = vMax op de bovenrand van
// het vak). Een deur draait standaard naar binnen, dus naar boven — net als
// het oude deursymbool, zodat de rotatieafspraak van gehoste deuren gelijk
// blijft.
//
// Params (de sleutels van het symbool; oude documenten missen de nieuwe):
//   width              kozijnmaat buitenwerks (mm) = de sparing in de laag
//                      waarin het kozijn staat
//   wallThickness      wanddikte, of de dikte van het hele pakket (mm)
//   stijlBreedteMm     kozijnhout langs de wand (67)
//   stijlDiepteMm      kozijnhout dwars (114); nooit dieper dan de wand
//   kozijnPositieMm    buitenvlak wand -> buitenvlak kozijn; leeg = midden
//   aanslagMm          aanslag van het buitenblad over het kozijn (0)
//   binnenSpelingMm    speling tussen kozijn en dagkant binnenblad (0)
//   borstweringMm      raam: > 0 tekent de borstwering in aanzicht
//   type               raam: fixed | turn | pivot | tilt
//   swing              left | right: draairichting; scharnieren links of
//                      rechts gezien vanaf de kant waar de deur van weg draait
//   draaiNaar          deur: binnen | buiten
//   angle              deur: openingshoek
//   deurbladDikteMm    deur: 40

import {
  KOZIJN_STANDAARD, kozijnstijl, deurVormen, raamVormen, kozijnDetail,
  vormenOmhullende, vormenNaarTekenopdrachten,
} from './kozijnprofiel.js';

const STANDAARD_BREEDTE = { deur: 900, raam: 1200 };
const STANDAARD_WAND = { deur: 100, raam: 240 };

function getal(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function positief(v, standaard) {
  const n = getal(v);
  return n !== null && n > 0 ? n : standaard;
}

/**
 * Heeft een symbool de nieuwe kozijnopbouw? Oude symbolen behouden hun oude
 * tekening, op het scherm en in een opgeslagen PDF:
 *   - een oude deur heeft geen wanddikte (haar vak is anders opgezet);
 *   - een oud raam heeft wel een wanddikte maar geen kozijnhout
 *     (`stijlBreedteMm`), dat zetten alleen het nieuwe symbool en
 *     app_floorplan.
 * @param {'deur'|'raam'} soort
 */
export function heeftKozijnOpbouw(params, soort = 'deur') {
  if ((getal(params?.stijlBreedteMm) ?? 0) > 0) return true;
  return soort === 'deur' && (getal(params?.wallThickness) ?? 0) > 0;
}

/**
 * De maten van een kozijn in zijn wand, genormaliseerd en begrensd.
 * @param {'deur'|'raam'} soort
 */
export function kozijnMaten(soort, params = {}) {
  const deur = soort === 'deur';
  const breedteMm = positief(params.width, STANDAARD_BREEDTE[deur ? 'deur' : 'raam']);
  const wandDikteMm = positief(params.wallThickness, STANDAARD_WAND[deur ? 'deur' : 'raam']);
  // Twee stijlen mogen elkaar niet raken: hooguit een derde van de breedte.
  const stijlBreedteMm = Math.min(positief(params.stijlBreedteMm, KOZIJN_STANDAARD.stijlBreedteMm), breedteMm / 3);
  // Een kozijn in een dunne wand is zo diep als de wand (binnendeur).
  const stijlDiepteMm = Math.min(positief(params.stijlDiepteMm, KOZIJN_STANDAARD.stijlDiepteMm), wandDikteMm);
  const vrij = wandDikteMm - stijlDiepteMm;
  const pos = getal(params.kozijnPositieMm);
  const positieMm = pos === null || pos < 0 ? vrij / 2 : Math.min(pos, vrij);
  const aanslagMm = Math.min(Math.max(0, getal(params.aanslagMm) ?? 0), stijlBreedteMm);
  const spelingMm = Math.max(0, getal(params.binnenSpelingMm) ?? 0);
  const borstweringMm = getal(params.borstweringMm);
  const draaiNaar = deur && params.draaiNaar === 'buiten' ? 'buiten' : 'binnen';
  // `swing` is de draairichting (links/rechtsdraaiend): de kant van de
  // scharnieren gezien vanaf de kant waar de deur van WEG draait — zo deed
  // het oude deursymbool het al. Draait de deur naar buiten, dan kijk je
  // vanaf de andere kant en wisselt links en rechts in het symbool.
  const rechts = (params.swing === 'right') !== (draaiNaar === 'buiten');
  return {
    soort: deur ? 'deur' : 'raam',
    breedteMm, wandDikteMm, stijlBreedteMm, stijlDiepteMm, positieMm, aanslagMm, spelingMm,
    // Oude ramen hebben geen borstwering in hun params: toen stond het
    // aanzicht er altijd, dus dat blijft zo.
    borstweringMm: borstweringMm === null ? (deur ? 0 : 1) : borstweringMm,
    raamtype: params.type || 'fixed',
    // Draairichting van een raam alleen op verzoek (zie raamVormen).
    toonDraairichting: params.draairichtingTonen === true,
    scharnier: rechts ? 'plus' : 'min',
    draaiNaar,
    hoekGraden: Math.max(1, Math.min(180, getal(params.angle) ?? 90)),
    deurbladDikteMm: positief(params.deurbladDikteMm, KOZIJN_STANDAARD.deurbladDikteMm),
    toonWand: !!params.showWall,
  };
}

function verschuif(punten, du, dv) {
  return punten.map((p) => ({ u: p.u + du, v: p.v + dv }));
}

/**
 * De indeling van het kozijn in mm: vormen plus het vak dat ze beslaan.
 * `vak` komt altijd uit de volle detaillering, zodat het symboolvak niet
 * verspringt tussen 1:50 en 1:100.
 * @returns {{ maten, vormen, vak: { uMin, uMax, vMin, vMax } }}
 */
export function kozijnIndeling(soort, params = {}, opties = {}) {
  const m = kozijnMaten(soort, params);
  const detail = opties.detail === 'eenvoudig' ? 'eenvoudig' : 'vol';
  const vormen = maakVormen(m, detail);
  const vak = detail === 'vol' ? vakVan(m, vormen) : vakVan(m, maakVormen(m, 'vol'));
  return { maten: m, vormen, vak };
}

function maakVormen(m, detail) {
  const { breedteMm: W, wandDikteMm: T, stijlBreedteMm: b, stijlDiepteMm: D, positieMm: p } = m;
  const deur = m.soort === 'deur';
  const draaiend = !deur && m.raamtype !== 'fixed';
  const vulling = detail === 'eenvoudig' ? 'open' : (deur ? 'deur' : (draaiend ? 'raam' : 'glas'));
  const zijde = deur ? m.draaiNaar : 'binnen';
  const stijlOpties = {
    breedteMm: b, diepteMm: D, vulling, zijde,
    deurbladDikteMm: m.deurbladDikteMm,
  };
  const links = kozijnstijl({ ...stijlOpties, dagkant: 'plus' });
  const rechts = kozijnstijl({ ...stijlOpties, dagkant: 'min' });
  const vormen = [
    { soort: 'vlak', rol: 'stijl', punten: verschuif(links.contour, b / 2, p) },
    { soort: 'vlak', rol: 'stijl', punten: verschuif(rechts.contour, W - b / 2, p) },
  ];
  const vak = { vanU: b, totU: W - b, diepteMm: T, vVan: p, vTot: p + D, detail };
  if (deur) {
    vormen.push(...deurVormen({
      ...vak, scharnier: m.scharnier, draaiNaar: m.draaiNaar,
      hoekGraden: m.hoekGraden, deurbladDikteMm: m.deurbladDikteMm,
    }));
    if (m.toonWand) {
      vormen.push({ soort: 'lijn', rol: 'aanzicht', streep: [6, 3], van: { u: 0, v: 0 }, tot: { u: W, v: 0 } });
      vormen.push({ soort: 'lijn', rol: 'aanzicht', streep: [6, 3], van: { u: 0, v: T }, tot: { u: W, v: T } });
    }
  } else {
    vormen.push(...raamVormen({ ...vak, type: m.raamtype, zijde: 'binnen', scharnier: m.scharnier, toonDraairichting: m.toonDraairichting }));
    if (m.borstweringMm > 0) {
      // De borstwering onder het raam, in aanzicht: buiten tussen de
      // dagkanten van het buitenblad (aanslag), binnen tussen die van het
      // binnenblad (speling).
      const a = m.aanslagMm, s = m.spelingMm;
      vormen.push({ soort: 'lijn', rol: 'aanzicht', van: { u: a, v: 0 }, tot: { u: W - a, v: 0 } });
      vormen.push({ soort: 'lijn', rol: 'aanzicht', van: { u: -s, v: T }, tot: { u: W + s, v: T } });
    }
  }
  return vormen;
}

function vakVan(m, vormen) {
  const o = vormenOmhullende(vormen) || { uMin: 0, uMax: m.breedteMm, vMin: 0, vMax: m.wandDikteMm };
  const nul = (x) => (x === 0 ? 0 : x);          // geen -0 in het vak
  return {
    uMin: nul(Math.min(-m.spelingMm, o.uMin)),
    uMax: nul(Math.max(m.breedteMm + m.spelingMm, o.uMax)),
    vMin: nul(Math.min(0, o.vMin)),
    vMax: nul(Math.max(m.wandDikteMm, o.vMax)),
  };
}

/**
 * Tekenopdrachten voor het symbool in zijn vak (paginapunten, ongedraaid).
 * De schaal volgt uit de vakbreedte: het vak is `vak`-breed in mm. Bij een
 * raam zonder draaicirkel bepaalt de vakhoogte de wanddikte, zodat een los
 * geplaatst raam altijd zijn vak vult.
 */
export function kozijnTekenopdrachten(soort, params, bbox) {
  const bw = Number(bbox?.width), bh = Number(bbox?.height);
  if (!(bw > 0) || !(bh > 0)) return [];
  let p = params || {};
  let { vak } = kozijnIndeling(soort, p);
  let k = bw / (vak.uMax - vak.uMin);
  if (soort === 'raam' && (p.type || 'fixed') !== 'turn') {
    // Het vak is zo diep als de wand: dat is de wanddikte op het blad.
    p = { ...p, wallThickness: bh / k };
    ({ vak } = kozijnIndeling(soort, p));
  }
  const detail = kozijnDetail(k);
  const { vormen } = kozijnIndeling(soort, p, { detail });
  return vormenNaarTekenopdrachten(vormen, {
    x0: bbox.x, y0: bbox.y, ptPerMm: k,
    uMin: vak.uMin, spiegelV: true, vMax: vak.vMax,
  });
}

/**
 * Waar in het symboolvak ligt een punt (mm) van de indeling? Voor het
 * plaatsen van een gehost kozijn: offset t.o.v. het midden van het vak in
 * lokale symboolassen (x langs de wand, y omlaag = naar buiten), in mm.
 */
export function vakOffsetMm(vak, u, v) {
  return {
    dx: u - (vak.uMin + vak.uMax) / 2,
    dy: (vak.vMin + vak.vMax) / 2 - v,
  };
}
