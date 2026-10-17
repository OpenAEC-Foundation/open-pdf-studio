// Boekje afdrukken (#381): een geniet boekje (saddle-stitch).
//
// Twee pagina's per zijde van een liggend vel, in de volgorde waarin de vellen
// na dubbelzijdig afdrukken (kantelen over de korte zijde), op elkaar leggen en
// dubbelvouwen het boekje van voor naar achter lezen. Het aantal pagina's wordt
// aangevuld tot een viervoud met blanco pagina's achteraan. Kruip (creep, het
// naar buiten schuiven van de binnenste vellen) telt niet mee.
//
// Werkt net als meerdere pagina's per vel (print-meerperblad.js) op de al
// gebouwde print-PDF met één pagina per bronpagina, zodat raster- en vectorpad
// allebei zonder eigen boekjescode werken. Het voorbeeld in de printdialoog
// (voorbeeldBoekje) gebruikt dezelfde volgorde, hetzelfde vel en dezelfde
// plekken als maakBoekje.

import { PDFDocument } from 'pdf-lib';
import { berekenPlaatsing, printPaginaMaat, margesVoor } from './print-plaatsing.js';
import { BLAD_MARGE_PT } from './print-meerperblad.js';

const PT_PER_MM = 72 / 25.4;
const MM_PER_PT = 25.4 / 72;

/** De keuze in "Pagina's per vel" die een boekje maakt. */
export const BOEKJE = 'booklet';

/** Is de keuze voor pagina's per vel een boekje? */
export function isBoekje(perBlad) {
  return perBlad === BOEKJE;
}

/**
 * Katernen (#607): een dik boek wordt een stapel kleine boekjes van elk een
 * vast aantal vellen, die elk apart gevouwen en daarna samen gebonden worden.
 * De keuzes in de printdialoog; 0 = één boekje van alle pagina's.
 */
export const KATERN_KEUZES = Object.freeze([0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16]);
const KATERN_MAX = 32;

/** Vellen per katern als heel getal (0 = geen katernen, één boekje). */
export function geldigKatern(waarde) {
  const n = Math.round(Number(waarde));
  if (!Number.isFinite(n) || n < 1) return 0;
  return Math.min(KATERN_MAX, n);
}

/**
 * De genietvolgorde voor `aantal` pagina's (in printvolgorde, index vanaf 0).
 * Vel s (vanaf 0) van een boekje van `totaal` pagina's (een viervoud):
 * voorkant [totaal-1-2s, 2s], achterkant [2s+1, totaal-2-2s], links en rechts
 * van de vouw. Een index voorbij het laatste pagina is een blanco pagina (null).
 *
 * Met `katern` vellen per katern (#607): de pagina's in groepjes van
 * 4 x katern, elk groepje een eigen boekje in genietvolgorde; alleen het
 * laatste katern kan kleiner zijn en wordt aangevuld tot een viervoud.
 * Zonder katern (0) is alles één boekje.
 * @param {number} aantal
 * @param {number} [katern]
 * @returns {{ totaal:number, blanco:number,
 *   vellen: {voor:[number,number], achter:[number,number]}[],
 *   zijden: [number|null, number|null][],
 *   katernen: {start:number, paginas:number, vellen:number}[],
 *   katernVanVel: number[] }}
 *   vellen: de indexen zonder aanvulling (ook voor blanco's); zijden: in
 *   afdrukvolgorde (voor, achter, voor, ...) met null voor een blanco helft;
 *   katernen: per katern de eerste index, het aantal pagina's (aangevuld) en
 *   vellen; katernVanVel: per vel het nummer van zijn katern (vanaf 1).
 */
export function boekjeVolgorde(aantal, katern = 0) {
  const n = Math.max(0, Math.floor(Number(aantal) || 0));
  const perKatern = geldigKatern(katern) * 4 || Math.max(4, Math.ceil(n / 4) * 4);
  const vellen = [];
  const zijden = [];
  const katernen = [];
  const katernVanVel = [];
  const echt = (i) => (i < n ? i : null);
  for (let start = 0; start < n; start += perKatern) {
    const totaalHier = Math.ceil(Math.min(perKatern, n - start) / 4) * 4;
    katernen.push({ start, paginas: totaalHier, vellen: totaalHier / 4 });
    for (let s = 0; s < totaalHier / 4; s++) {
      const voor = [start + totaalHier - 1 - 2 * s, start + 2 * s];
      const achter = [start + 2 * s + 1, start + totaalHier - 2 - 2 * s];
      vellen.push({ voor, achter });
      katernVanVel.push(katernen.length);
      zijden.push([echt(voor[0]), echt(voor[1])], [echt(achter[0]), echt(achter[1])]);
    }
  }
  const totaal = katernen.reduce((som, k) => som + k.paginas, 0);
  return { totaal, blanco: totaal - n, vellen, zijden, katernen, katernVanVel };
}

/** Hoeveel zijden (pagina's in de print-PDF) een boekje van `aantal` pagina's wordt. */
export function aantalBoekjeZijden(aantal, katern = 0) {
  return boekjeVolgorde(aantal, katern).zijden.length;
}

/** Vel (vanaf 1) en kant ('front' / 'back') van zijde `k` (vanaf 0). */
export function boekjeZijde(k) {
  return { vel: Math.floor(k / 2) + 1, kant: k % 2 === 0 ? 'front' : 'back' };
}

/**
 * Het vel van een boekje: altijd liggend. `papier` {breedteMm, hoogteMm} als
 * het vel bekend is; anders volgt het de eerste pagina (zoals kiesBlad bij
 * meerdere pagina's per vel), liggend gelegd.
 */
export function kiesBoekjeBlad({ papier, eerstePagina }) {
  let kort;
  let lang;
  if (papier && papier.breedteMm > 0 && papier.hoogteMm > 0) {
    kort = Math.min(papier.breedteMm, papier.hoogteMm) * PT_PER_MM;
    lang = Math.max(papier.breedteMm, papier.hoogteMm) * PT_PER_MM;
  } else {
    kort = Math.min(eerstePagina.breedte, eerstePagina.hoogte);
    lang = Math.max(eerstePagina.breedte, eerstePagina.hoogte);
  }
  return { bladB: lang, bladH: kort };
}

/**
 * De twee helften van een zijde (PDF-coördinaten, oorsprong linksonder). Elke
 * pagina past in haar helft, binnen de witrand van het vel maar zonder rand
 * aan de vouw: de linkerpagina eindigt op de vouw, de rechter begint erop.
 * Verticaal gecentreerd. Een blanco helft (null) geeft geen cel.
 * @param {{ bladB:number, bladH:number, maten: ({breedte:number, hoogte:number}|null)[] }} p
 * @returns {{k:number, kol:number, x:number, y:number, breedte:number, hoogte:number, schaal:number}[]}
 */
export function boekjeIndeling({ bladB, bladH, maten }) {
  const vouw = bladB / 2;
  const ruimB = vouw - BLAD_MARGE_PT;
  const ruimH = bladH - 2 * BLAD_MARGE_PT;
  const cellen = [];
  for (let k = 0; k < 2; k++) {
    const m = maten[k];
    if (!m || !(m.breedte > 0) || !(m.hoogte > 0)) continue;
    const schaal = Math.min(ruimB / m.breedte, ruimH / m.hoogte);
    const breedte = m.breedte * schaal;
    const hoogte = m.hoogte * schaal;
    cellen.push({
      k,
      kol: k,
      x: k === 0 ? vouw - breedte : vouw,
      y: (bladH - hoogte) / 2,
      breedte,
      hoogte,
      schaal,
    });
  }
  return cellen;
}

/**
 * Het voorbeeld van één zijde van het boekje, zoals de printopdracht haar
 * bouwt: elke pagina eerst passend op haar printpagina (berekenPlaatsing; de
 * schaalkeuze vervalt, zoals bij meerdere pagina's per vel), dan het liggende
 * vel (kiesBoekjeBlad, uit de eerste pagina van de hele afdruk) en de helften
 * (boekjeIndeling).
 *
 * @param {{ keuzes: { papier: object|'pagina'|null, orientatie?: string },
 *           eerstePagina: {breedtePt:number, hoogtePt:number},
 *           paginas: ({breedtePt:number, hoogtePt:number}|null)[] }} p
 *   paginas: links en rechts van de vouw; null = blanco.
 * @returns {null | { bekend:boolean, vel:{breedteMm:number, hoogteMm:number, orientatie:'landscape'},
 *   marges:object, bedrukbaar:object, rand:false, schaal:number|null,
 *   cellen:{k:number, plaatsing:object, schaal:number, opVel:{x:number, y:number, breedte:number, hoogte:number}}[] }}
 *   Dezelfde vorm als voorbeeldMeerPerBlad (mm vanaf linksboven).
 */
export function voorbeeldBoekje({ keuzes, eerstePagina, paginas }) {
  if (!keuzes || !eerstePagina) return null;
  const { papier: vel = null, orientatie = 'auto' } = keuzes;
  const celKeuzes = { papier: vel, orientatie, schaling: 'fit', zoom: 100, centreren: true };
  const plaats = (pagina) => (pagina ? berekenPlaatsing({ ...celKeuzes, pagina }) : null);
  const maat = (plaatsing) => {
    if (!plaatsing) return null;
    const [breedte, hoogte] = printPaginaMaat(plaatsing);
    return { breedte, hoogte };
  };

  const eerste = plaats(eerstePagina);
  if (!eerste) return null;
  const plaatsingen = [0, 1].map((k) => plaats((paginas || [])[k] || null));

  const papier = vel && typeof vel === 'object' ? vel : null;
  const { bladB, bladH } = kiesBoekjeBlad({ papier, eerstePagina: maat(eerste) });
  const velB = bladB * MM_PER_PT;
  const velH = bladH * MM_PER_PT;

  const cellen = boekjeIndeling({ bladB, bladH, maten: plaatsingen.map(maat) }).map((c) => ({
    k: c.k,
    plaatsing: plaatsingen[c.k],
    schaal: c.schaal,
    opVel: {
      x: c.x * MM_PER_PT,
      y: (bladH - c.y - c.hoogte) * MM_PER_PT,
      breedte: c.breedte * MM_PER_PT,
      hoogte: c.hoogte * MM_PER_PT,
    },
  }));

  const marges = margesVoor(papier && papier.bedrukbaar, 'landscape', velB, velH);
  return {
    bekend: eerste.bekend,
    vel: { breedteMm: velB, hoogteMm: velH, orientatie: 'landscape' },
    marges,
    bedrukbaar: {
      x: marges.links,
      y: marges.boven,
      breedte: velB - marges.links - marges.rechts,
      hoogte: velH - marges.boven - marges.onder,
    },
    rand: false,
    schaal: cellen.length ? cellen[0].plaatsing.schaal * cellen[0].schaal : null,
    cellen,
  };
}

/**
 * Bouw de print-PDF van een boekje uit `pdf` (één pagina per bronpagina, in
 * printvolgorde): elke zijde een liggend vel met links en rechts van de vouw
 * de pagina's in genietvolgorde. Zonder pagina's komt `pdf` zelf terug.
 * `katern`: vellen per katern (boekjeVolgorde), 0 = één boekje.
 * @param {PDFDocument} pdf
 * @param {{ papier?: {breedteMm:number, hoogteMm:number}|null, katern?: number }} opties
 */
export async function maakBoekje(pdf, { papier = null, katern = 0 } = {}) {
  const bron = pdf.getPages();
  if (bron.length === 0) return pdf;
  const maten = bron.map((p) => {
    const { width, height } = p.getSize();
    return { breedte: width, hoogte: height };
  });
  const { bladB, bladH } = kiesBoekjeBlad({ papier, eerstePagina: maten[0] });

  // Zoals maakMeerPerBlad: pas na flush staan lui ingebedde beelden en fonts
  // echt in het document, anders kopieert embedPdf lege verwijzingen.
  await pdf.flush();
  const uit = await PDFDocument.create();
  const ingebed = await uit.embedPdf(pdf, bron.map((_, i) => i));
  for (const zijde of boekjeVolgorde(bron.length, katern).zijden) {
    const blad = uit.addPage([bladB, bladH]);
    const cellen = boekjeIndeling({ bladB, bladH, maten: zijde.map((i) => (i === null ? null : maten[i])) });
    for (const c of cellen) {
      blad.drawPage(ingebed[zijde[c.k]], { x: c.x, y: c.y, width: c.breedte, height: c.hoogte });
    }
  }
  return uit;
}
