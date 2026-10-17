// Meerdere pagina's per vel ("Pages per sheet", n-up).
//
// Werkt op de al gebouwde print-PDF (print-job.js: één pagina per bronpagina,
// op het gekozen vel gelegd): die pagina's worden ingebed en in een raster van
// kolommen x rijen op nieuwe vellen gezet, elk verkleind tot de cel. Zo werken
// raster- en vectorpad allebei zonder eigen n-up-code.
//
// Het voorbeeld in de printdialoog (voorbeeldMeerPerBlad) rekent met dezelfde
// regels: dezelfde plaatsing van elke pagina op haar eigen printpagina
// (print-plaatsing.js), hetzelfde vel (kiesBlad) en dezelfde cellen
// (velIndeling). Wat het voorbeeld toont is dus wat er uit de printer komt.

import { PDFDocument, rgb } from 'pdf-lib';
import { berekenPlaatsing, printPaginaMaat, margesVoor } from './print-plaatsing.js';

const PT_PER_MM = 72 / 25.4;
const MM_PER_PT = 25.4 / 72;
/** Witruimte rond het raster (buiten het bedrukbare gebied van de meeste printers). */
export const BLAD_MARGE_PT = 8 * PT_PER_MM;
/** Witruimte tussen twee cellen. */
export const CEL_TUSSENRUIMTE_PT = 4 * PT_PER_MM;

export const MAX_PER_AS = 10;

/** Vaste keuzes: pagina's per vel -> [kolommen, rijen]. */
export const MEER_PER_BLAD_STANDAARD = Object.freeze({
  1: [1, 1], 2: [2, 1], 4: [2, 2], 6: [3, 2], 9: [3, 3], 16: [4, 4],
});

export const PAGINAVOLGORDES = ['horizontal', 'horizontal-reversed', 'vertical', 'vertical-reversed'];

/**
 * Folder (#607): de keuze in "Pagina's per vel" die van elke pagina een vel
 * vol kopieën maakt, klaar om te snijden. Dezelfde vel- en celregels als
 * meerdere pagina's per vel; alleen komt in elke cel van een vel dezelfde
 * pagina.
 */
export const FLYER = 'flyer';

/** Kopieën per vel -> [kolommen, rijen] (het raster draait mee met het vel). */
export const FLYER_AANTALLEN = Object.freeze({
  2: [2, 1], 4: [2, 2], 6: [3, 2], 8: [4, 2], 9: [3, 3], 16: [4, 4],
});

/** Is de keuze voor pagina's per vel een folder? */
export function isFlyer(perBlad) {
  return perBlad === FLYER;
}

/**
 * Het raster van een folder met `aantal` kopieën per vel; een onbekend aantal
 * wordt 4. `draaibaar`: het raster draait mee met de stand van het vel.
 * @returns {{kolommen:number, rijen:number, flyer:true, draaibaar:true}}
 */
export function flyerRaster(aantal) {
  const [kolommen, rijen] = FLYER_AANTALLEN[Number(aantal)] || FLYER_AANTALLEN[4];
  return { kolommen, rijen, flyer: true, draaibaar: true };
}

function geheel(n, terugval) {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(MAX_PER_AS, Math.max(1, v)) : terugval;
}

/**
 * Kolommen en rijen uit de dialoogkeuze: een vast aantal (1, 2, 4, 6, 9, 16)
 * of 'custom' met eigen kolommen en rijen. Onbekend telt als 1 per vel.
 * @returns {{kolommen:number, rijen:number}}
 */
export function rasterVan({ perBlad = 1, kolommen = 1, rijen = 1 } = {}) {
  if (perBlad === 'custom') return { kolommen: geheel(kolommen, 1), rijen: geheel(rijen, 1) };
  const vast = MEER_PER_BLAD_STANDAARD[Number(perBlad)];
  return vast ? { kolommen: vast[0], rijen: vast[1] } : { kolommen: 1, rijen: 1 };
}

/** Is er meer dan één pagina per vel? */
export function isMeerPerBlad(raster) {
  return !!raster && raster.kolommen * raster.rijen > 1;
}

/** Cel (kolom, rij; rij 0 = bovenaan) van de k-de pagina op een vel. */
export function celVoorVolgnummer(k, kolommen, rijen, volgorde = 'horizontal') {
  switch (volgorde) {
    case 'horizontal-reversed':
      return { kol: kolommen - 1 - (k % kolommen), rij: Math.floor(k / kolommen) };
    case 'vertical':
      return { kol: Math.floor(k / rijen), rij: k % rijen };
    case 'vertical-reversed':
      return { kol: kolommen - 1 - Math.floor(k / rijen), rij: k % rijen };
    default:
      return { kol: k % kolommen, rij: Math.floor(k / kolommen) };
  }
}

/**
 * De cellen van één vel (PDF-coördinaten, oorsprong linksonder) en waar een
 * pagina van `paginaB` x `paginaH` erin komt: passend, gecentreerd.
 */
export function celGeometrie({ bladB, bladH, kolommen, rijen }) {
  const celB = (bladB - 2 * BLAD_MARGE_PT - (kolommen - 1) * CEL_TUSSENRUIMTE_PT) / kolommen;
  const celH = (bladH - 2 * BLAD_MARGE_PT - (rijen - 1) * CEL_TUSSENRUIMTE_PT) / rijen;
  return { celB, celH };
}

export function plaatsInCel({ bladB, bladH, kolommen, rijen, kol, rij, paginaB, paginaH }) {
  const { celB, celH } = celGeometrie({ bladB, bladH, kolommen, rijen });
  const celX = BLAD_MARGE_PT + kol * (celB + CEL_TUSSENRUIMTE_PT);
  const celBoven = bladH - BLAD_MARGE_PT - rij * (celH + CEL_TUSSENRUIMTE_PT);
  const schaal = Math.min(celB / paginaB, celH / paginaH);
  const b = paginaB * schaal;
  const h = paginaH * schaal;
  return {
    x: celX + (celB - b) / 2,
    y: celBoven - celH + (celH - h) / 2,
    breedte: b,
    hoogte: h,
    schaal,
  };
}

/**
 * Het vel: afmetingen, stand en raster. `papier` is {breedteMm, hoogteMm} als
 * het vel bekend is, anders volgt het de eerste pagina. `orientatie`
 * 'portrait' / 'landscape' staat vast; 'auto' kiest de stand waarin de eerste
 * pagina het grootst in haar cel komt. `draaibaar` (een vast aantal per vel
 * of een folder, geen eigen raster): het raster mag een kwartslag draaien
 * (3 x 2 wordt 2 x 3) als de eerste pagina daarin groter komt; bij gelijke
 * schaal blijft het raster zoals het in de lijst staat. Een eigen raster
 * blijft zoals getypt.
 * @returns {{bladB:number, bladH:number, kolommen:number, rijen:number}}
 */
export function kiesBlad({ papier, orientatie = 'auto', eerstePagina, kolommen, rijen, draaibaar = false }) {
  let kort;
  let lang;
  if (papier && papier.breedteMm > 0 && papier.hoogteMm > 0) {
    kort = Math.min(papier.breedteMm, papier.hoogteMm) * PT_PER_MM;
    lang = Math.max(papier.breedteMm, papier.hoogteMm) * PT_PER_MM;
  } else {
    kort = Math.min(eerstePagina.breedte, eerstePagina.hoogte);
    lang = Math.max(eerstePagina.breedte, eerstePagina.hoogte);
  }
  const staand = { bladB: kort, bladH: lang };
  const liggend = { bladB: lang, bladH: kort };
  const bladen = orientatie === 'portrait' ? [staand]
    : orientatie === 'landscape' ? [liggend] : [staand, liggend];
  const rasters = draaibaar && kolommen !== rijen
    ? [{ kolommen, rijen }, { kolommen: rijen, rijen: kolommen }]
    : [{ kolommen, rijen }];
  const schaalIn = (kandidaat) => {
    const { celB, celH } = celGeometrie(kandidaat);
    return Math.min(celB / eerstePagina.breedte, celH / eerstePagina.hoogte);
  };
  // Op volgorde van voorkeur (staand vóór liggend, het raster uit de lijst
  // vóór het gedraaide); alleen een echt grotere pagina wint.
  let beste = null;
  let besteSchaal = -Infinity;
  for (const blad of bladen) {
    for (const raster of rasters) {
      const kandidaat = { ...blad, ...raster };
      const schaal = schaalIn(kandidaat);
      if (beste === null || schaal > besteSchaal + 1e-9) {
        beste = kandidaat;
        besteSchaal = schaal;
      }
    }
  }
  return beste;
}

/**
 * De cellen van één vel: per pagina op dat vel (`maten`, in printvolgorde,
 * {breedte, hoogte} in pt) haar cel en haar plek (plaatsInCel, PDF-
 * coördinaten in pt). De afdruk en het voorbeeld gebruiken allebei deze regel.
 * @returns {{k:number, kol:number, rij:number, x:number, y:number,
 *            breedte:number, hoogte:number, schaal:number}[]}
 */
export function velIndeling({ bladB, bladH, kolommen, rijen, volgorde = 'horizontal', maten }) {
  return maten.slice(0, kolommen * rijen).map((m, k) => {
    const { kol, rij } = celVoorVolgnummer(k, kolommen, rijen, volgorde);
    return {
      k, kol, rij,
      ...plaatsInCel({ bladB, bladH, kolommen, rijen, kol, rij, paginaB: m.breedte, paginaH: m.hoogte }),
    };
  });
}

/** Pagina's per vel: kolommen x rijen, of 1 zonder raster. */
function perVel(raster) {
  return isMeerPerBlad(raster) ? raster.kolommen * raster.rijen : 1;
}

/** Is dit raster een folder (elke cel van een vel dezelfde pagina)? */
function folder(raster) {
  return isMeerPerBlad(raster) && !!raster.flyer;
}

/** Hoeveel vellen `aantalPaginas` pagina's worden (zonder raster en bij een folder: één per pagina). */
export function aantalVellen(aantalPaginas, raster) {
  if (folder(raster)) return Math.max(0, aantalPaginas);
  return Math.ceil(Math.max(0, aantalPaginas) / perVel(raster));
}

/**
 * De pagina's (uit `paginas`, in printvolgorde) op vel `velIndex` (vanaf 0).
 * Een folder: zoveel kopieën van pagina `velIndex` als er cellen zijn.
 */
export function paginasOpVel(paginas, velIndex, raster) {
  const n = perVel(raster);
  if (folder(raster)) {
    return velIndex >= 0 && velIndex < paginas.length ? Array(n).fill(paginas[velIndex]) : [];
  }
  return paginas.slice(velIndex * n, velIndex * n + n);
}

/** Afstand van een snijteken tot de rand van het vel en tot het raster. */
const SNIJTEKEN_RAND_PT = 2 * PT_PER_MM;
const SNIJTEKEN_TUSSEN_PT = 1 * PT_PER_MM;
/** Lijndikte van de snijtekens van een folder (pt). */
export const SNIJTEKEN_LIJN_PT = 0.5;

/**
 * Snijtekens voor een vel met cellen (folder, #607): op het verlengde van elke
 * rand van elke geplaatste pagina een kort streepje in de witrand van het vel
 * (boven en onder voor de verticale randen, links en rechts voor de
 * horizontale), nooit over een pagina. Met een snijmachine snijd je langs de
 * streepjes. PDF-coördinaten in pt (oorsprong linksonder).
 * @param {{ bladB:number, bladH:number,
 *           cellen: {x:number, y:number, breedte:number, hoogte:number}[] }} p
 * @returns {{x1:number, y1:number, x2:number, y2:number}[]}
 */
export function snijtekensVoorCellen({ bladB, bladH, cellen }) {
  const uniek = (waarden) => {
    const uit = [];
    for (const w of waarden) if (!uit.some((u) => Math.abs(u - w) < 0.01)) uit.push(w);
    return uit.sort((a, b) => a - b);
  };
  const xs = uniek(cellen.flatMap((c) => [c.x, c.x + c.breedte]));
  const ys = uniek(cellen.flatMap((c) => [c.y, c.y + c.hoogte]));
  const binnen = BLAD_MARGE_PT - SNIJTEKEN_TUSSEN_PT;
  const tekens = [];
  for (const x of xs) {
    tekens.push({ x1: x, y1: SNIJTEKEN_RAND_PT, x2: x, y2: binnen });
    tekens.push({ x1: x, y1: bladH - binnen, x2: x, y2: bladH - SNIJTEKEN_RAND_PT });
  }
  for (const y of ys) {
    tekens.push({ x1: SNIJTEKEN_RAND_PT, y1: y, x2: binnen, y2: y });
    tekens.push({ x1: bladB - binnen, y1: y, x2: bladB - SNIJTEKEN_RAND_PT, y2: y });
  }
  return tekens;
}

/**
 * De volgorde-aanwijzer in het voorbeeld (#607; nooit in de afdruk): een merk
 * met het volgnummer midden in elke cel en een pijl van cel naar cel in de
 * printvolgorde. Werkt op de cellen van voorbeeldMeerPerBlad (mm vanaf
 * linksboven); de pijlen beginnen en eindigen buiten de merken.
 * @param {{k:number, opVel:{x:number, y:number, breedte:number, hoogte:number}}[]} cellen
 * @returns {{ straal:number, merken:{k:number, x:number, y:number}[],
 *             pijlen:{x1:number, y1:number, x2:number, y2:number}[] }}
 */
export function volgordeAanwijzer(cellen) {
  const lijst = (cellen || []).filter((c) => c && c.opVel);
  if (!lijst.length) return { straal: 0, merken: [], pijlen: [] };
  const kleinste = Math.min(...lijst.map((c) => Math.min(c.opVel.breedte, c.opVel.hoogte)));
  const straal = Math.max(0.5, Math.min(12, kleinste * 0.14));
  const merken = lijst
    .map((c) => ({ k: c.k, x: c.opVel.x + c.opVel.breedte / 2, y: c.opVel.y + c.opVel.hoogte / 2 }))
    .sort((a, b) => a.k - b.k);
  const ruimte = straal * 1.25;
  const pijlen = [];
  for (let i = 0; i + 1 < merken.length; i++) {
    const van = merken[i];
    const naar = merken[i + 1];
    const dx = naar.x - van.x;
    const dy = naar.y - van.y;
    const lengte = Math.hypot(dx, dy);
    if (lengte <= 2 * ruimte) continue;
    const ex = dx / lengte;
    const ey = dy / lengte;
    pijlen.push({
      x1: van.x + ex * ruimte, y1: van.y + ey * ruimte,
      x2: naar.x - ex * ruimte, y2: naar.y - ey * ruimte,
    });
  }
  return { straal, merken, pijlen };
}

/**
 * Per vel meerdere pagina's: de schaalkeuze telt dan niet. Elke bronpagina
 * wordt passend en gecentreerd op haar printpagina gezet, die daarna in zijn
 * cel komt.
 */
export function schaalVoorMeerPerBlad(meerPerBlad, schaling, zoom, centreren) {
  return isMeerPerBlad(meerPerBlad)
    ? { schaling: 'fit', zoom: 100, centreren: true }
    : { schaling, zoom, centreren };
}

/**
 * Het voorbeeld van één vel bij meerdere pagina's per vel, zoals de
 * printopdracht het bouwt: elke pagina eerst op haar printpagina
 * (berekenPlaatsing met de keuzes van de dialoog, de schaalkeuze vervalt),
 * dan het vel (kiesBlad, uit de eerste pagina van de hele afdruk) en de
 * cellen (velIndeling).
 *
 * @param {{ meerPerBlad: {kolommen:number, rijen:number, volgorde?:string, rand?:boolean}|null,
 *           keuzes: { papier: object|'pagina'|null, orientatie?: string,
 *                     schaling?: string, zoom?: number, centreren?: boolean },
 *           eerstePagina: {breedtePt:number, hoogtePt:number},
 *           paginas: {breedtePt:number, hoogtePt:number}[] }} p
 *   eerstePagina = de eerste pagina van de afdruk (zoals getoond, met
 *   draaiing); paginas = de pagina's op dit vel, in printvolgorde.
 * @returns {null | {
 *   bekend: boolean,
 *   vel: {breedteMm:number, hoogteMm:number, orientatie:'portrait'|'landscape'},
 *   marges: {links:number, boven:number, rechts:number, onder:number},
 *   bedrukbaar: {x:number, y:number, breedte:number, hoogte:number},
 *   rand: boolean, schaal: number|null,
 *   cellen: { k:number, plaatsing:object, schaal:number,
 *             opVel:{x:number, y:number, breedte:number, hoogte:number} }[] }}
 *   Rechthoeken in mm vanaf de linkerbovenhoek van het vel. Per cel:
 *   plaatsing = de pagina op haar printpagina (print-plaatsing.js), opVel =
 *   waar die printpagina op het vel komt, schaal = de verkleining daarbij.
 *   schaal = de schaal van de eerste pagina van het vel op het papier.
 *   null bij één pagina per vel of een onbruikbare paginamaat.
 */
export function voorbeeldMeerPerBlad({ meerPerBlad, keuzes, eerstePagina, paginas }) {
  if (!isMeerPerBlad(meerPerBlad) || !keuzes) return null;
  const {
    volgorde = 'horizontal', rand = false, draaibaar = false, snijtekens = false,
  } = meerPerBlad;
  const { papier: vel = null, orientatie = 'auto', schaling, zoom, centreren } = keuzes;
  const celKeuzes = { papier: vel, orientatie, ...schaalVoorMeerPerBlad(meerPerBlad, schaling, zoom, centreren) };
  const plaats = (pagina) => berekenPlaatsing({ ...celKeuzes, pagina });
  const maat = (plaatsing) => {
    const [breedte, hoogte] = printPaginaMaat(plaatsing);
    return { breedte, hoogte };
  };

  const eerste = plaats(eerstePagina);
  const plaatsingen = (paginas || []).map(plaats);
  if (!eerste || plaatsingen.some((p) => !p)) return null;

  // Zoals metMeerPerBlad in print-job.js: alleen een vel met maten telt als
  // papier; anders volgt het vel de eerste printpagina.
  const papier = vel && typeof vel === 'object' ? vel : null;
  const { bladB, bladH, kolommen, rijen } = kiesBlad({
    papier, orientatie, eerstePagina: maat(eerste),
    kolommen: meerPerBlad.kolommen, rijen: meerPerBlad.rijen, draaibaar,
  });
  const velB = bladB * MM_PER_PT;
  const velH = bladH * MM_PER_PT;
  const stand = bladB > bladH ? 'landscape' : 'portrait';

  const indeling = velIndeling({ bladB, bladH, kolommen, rijen, volgorde, maten: plaatsingen.map(maat) });
  const cellen = indeling
    .map((c) => ({
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

  const marges = margesVoor(papier && papier.bedrukbaar, stand, velB, velH);
  return {
    bekend: eerste.bekend,
    vel: { breedteMm: velB, hoogteMm: velH, orientatie: stand },
    marges,
    bedrukbaar: {
      x: marges.links,
      y: marges.boven,
      breedte: velB - marges.links - marges.rechts,
      hoogte: velH - marges.boven - marges.onder,
    },
    rand: !!rand,
    schaal: cellen.length ? cellen[0].plaatsing.schaal * cellen[0].schaal : null,
    kolommen,
    rijen,
    cellen,
    // Zoals maakMeerPerBlad ze tekent, in mm vanaf linksboven.
    snijtekens: snijtekens
      ? snijtekensVoorCellen({ bladB, bladH, cellen: indeling }).map((t) => ({
        x1: t.x1 * MM_PER_PT, y1: (bladH - t.y1) * MM_PER_PT,
        x2: t.x2 * MM_PER_PT, y2: (bladH - t.y2) * MM_PER_PT,
      }))
      : [],
  };
}

/**
 * Bouw de print-PDF met meerdere pagina's per vel uit `pdf` (één pagina per
 * bronpagina). Geeft een nieuw PDFDocument; zonder meer dan één per vel komt
 * `pdf` zelf terug. Een folder (`flyer`): per bronpagina één vel met in elke
 * cel diezelfde pagina; `snijtekens` zet er snijtekens in de witrand bij.
 * @param {PDFDocument} pdf
 * @param {{ kolommen:number, rijen:number, volgorde?:string, rand?:boolean,
 *           draaibaar?:boolean, flyer?:boolean, snijtekens?:boolean,
 *           papier?:{breedteMm:number, hoogteMm:number}|null,
 *           orientatie?:'auto'|'portrait'|'landscape' }} opties
 */
export async function maakMeerPerBlad(pdf, opties) {
  const {
    volgorde = 'horizontal', rand = false, papier = null, orientatie = 'auto',
    draaibaar = false, flyer = false, snijtekens = false,
  } = opties;
  if (!isMeerPerBlad({ kolommen: opties.kolommen, rijen: opties.rijen })) return pdf;
  const bron = pdf.getPages();
  if (bron.length === 0) return pdf;

  const maten = bron.map((p) => {
    const { width, height } = p.getSize();
    return { breedte: width, hoogte: height };
  });
  const { bladB, bladH, kolommen, rijen } = kiesBlad({
    papier, orientatie, eerstePagina: maten[0], kolommen: opties.kolommen, rijen: opties.rijen, draaibaar,
  });

  // pdf-lib schrijft lui ingebedde afbeeldingen en fonts (embedJpg/embedFont
  // in bouwPrintPdf) pas bij flush()/save() weg. Zonder flush kopieert
  // embedPdf alleen de verwijzingen en blijven de cellen leeg.
  await pdf.flush();
  const uit = await PDFDocument.create();
  const ingebed = await uit.embedPdf(pdf, bron.map((_, i) => i));
  const raster = { kolommen, rijen, flyer };
  const indexen = bron.map((_, i) => i);
  for (let vel = 0; vel < aantalVellen(bron.length, raster); vel++) {
    const opVel = paginasOpVel(indexen, vel, raster);
    const blad = uit.addPage([bladB, bladH]);
    const cellen = velIndeling({
      bladB, bladH, kolommen, rijen, volgorde, maten: opVel.map((i) => maten[i]),
    });
    for (const p of cellen) {
      blad.drawPage(ingebed[opVel[p.k]], { x: p.x, y: p.y, width: p.breedte, height: p.hoogte });
      if (rand) {
        blad.drawRectangle({
          x: p.x, y: p.y, width: p.breedte, height: p.hoogte,
          borderColor: rgb(0, 0, 0), borderWidth: 0.5,
        });
      }
    }
    if (snijtekens) {
      for (const t of snijtekensVoorCellen({ bladB, bladH, cellen })) {
        blad.drawLine({
          start: { x: t.x1, y: t.y1 }, end: { x: t.x2, y: t.y2 },
          thickness: SNIJTEKEN_LIJN_PT, color: rgb(0, 0, 0),
        });
      }
    }
  }
  return uit;
}
