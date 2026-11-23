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
//
// Stand en draaien (#623), twee losse dingen:
// - het VEL: een in de Pagina-instelling voor dit document bevestigde stand
//   ligt vast (vellenStand in print-pagina-instelling.js); anders de stand
//   waarin het raster het best past (kiesBlad);
// - de PAGINA in haar cel: haar printpagina heeft altijd de stand van de
//   pagina zelf (CEL_PAGINA_STAND), de stand van het vel draait de inhoud
//   nooit mee. Met Automatisch draaien (`paginaDraaien`) komt ze een
//   kwartslag linksom in haar cel als ze daar echt groter in komt; bij gelijke
//   grootte blijft ze rechtop. Zonder Automatisch draaien nooit.

import { PDFDocument, rgb, degrees } from 'pdf-lib';
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

/**
 * De stand van de printpagina van elke cel (bij meerdere pagina's per vel, een
 * folder en een boekje): die van de pagina zelf, zoals berekenPlaatsing 'auto'
 * hem kiest. Nooit de stand van het vel: dan kwam een liggende pagina op een
 * staand vel gedraaid op haar printpagina en lag haar inhoud dwars in de cel,
 * ook met Automatisch draaien uit (#623). Draaien gebeurt alleen in de cel.
 */
export const CEL_PAGINA_STAND = 'auto';

/**
 * Het papier van de printpagina van een cel bij meerdere pagina's per vel:
 * de pagina zelf. Voorheen was dat het hele vel; een pagina met een andere
 * verhouding dan het papier (een dia op A4) kwam dan met de witruimte van dat
 * vel in haar cel en bleef veel kleiner dan de cel toeliet (#1234).
 */
export const CEL_PAPIER = 'pagina';

/** Hoeveel groter een gedraaide pagina moet worden voordat de kwartslag wint (relatief). */
const DRAAI_WINST = 1e-6;

/**
 * Hoe groot een pagina van `paginaB` x `paginaH` in een cel van `celB` x
 * `celH` komt: rechtop, of met `draaien` een kwartslag gedraaid als dat echt
 * groter is.
 * @returns {{schaal:number, kwartslag:boolean}}
 */
function passendInCel(celB, celH, paginaB, paginaH, draaien) {
  const rechtop = Math.min(celB / paginaB, celH / paginaH);
  if (!draaien) return { schaal: rechtop, kwartslag: false };
  const gedraaid = Math.min(celB / paginaH, celH / paginaB);
  return gedraaid > rechtop * (1 + DRAAI_WINST)
    ? { schaal: gedraaid, kwartslag: true }
    : { schaal: rechtop, kwartslag: false };
}

/**
 * Waar een pagina in haar cel komt: passend en gecentreerd. `draaien`
 * (Automatisch draaien): een kwartslag linksom als ze zo groter wordt. De
 * rechthoek (x, y, breedte, hoogte) is wat de pagina op het vel bedekt, dus
 * bij `kwartslag` met breedte en hoogte van de pagina gewisseld.
 */
export function plaatsInCel({ bladB, bladH, kolommen, rijen, kol, rij, paginaB, paginaH, draaien = false }) {
  const { celB, celH } = celGeometrie({ bladB, bladH, kolommen, rijen });
  const celX = BLAD_MARGE_PT + kol * (celB + CEL_TUSSENRUIMTE_PT);
  const celBoven = bladH - BLAD_MARGE_PT - rij * (celH + CEL_TUSSENRUIMTE_PT);
  const { schaal, kwartslag } = passendInCel(celB, celH, paginaB, paginaH, draaien);
  const b = (kwartslag ? paginaH : paginaB) * schaal;
  const h = (kwartslag ? paginaB : paginaH) * schaal;
  return {
    x: celX + (celB - b) / 2,
    y: celBoven - celH + (celH - h) / 2,
    breedte: b,
    hoogte: h,
    schaal,
    kwartslag,
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
 * blijft zoals getypt. `draaien` (Automatisch draaien): de pagina mag een
 * kwartslag in haar cel draaien (plaatsInCel); dat telt mee, maar bij gelijke
 * grootte wint een vel en raster waarin ze rechtop blijft.
 * @returns {{bladB:number, bladH:number, kolommen:number, rijen:number}}
 */
export function kiesBlad({
  papier, orientatie = 'auto', eerstePagina, kolommen, rijen, draaibaar = false, draaien = false,
}) {
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
  const passend = (kandidaat) => {
    const { celB, celH } = celGeometrie(kandidaat);
    return passendInCel(celB, celH, eerstePagina.breedte, eerstePagina.hoogte, draaien);
  };
  // Op volgorde van voorkeur (staand vóór liggend, het raster uit de lijst
  // vóór het gedraaide); alleen een echt grotere pagina wint, en bij gelijke
  // grootte wint een rechtop liggende pagina van een gedraaide.
  let beste = null;
  let bestePassend = null;
  for (const blad of bladen) {
    for (const raster of rasters) {
      const kandidaat = { ...blad, ...raster };
      const p = passend(kandidaat);
      const groter = beste === null || p.schaal > bestePassend.schaal + 1e-9;
      const evenGrootMaarRechtop = !groter && bestePassend.kwartslag && !p.kwartslag
        && p.schaal >= bestePassend.schaal - 1e-9;
      if (groter || evenGrootMaarRechtop) {
        beste = kandidaat;
        bestePassend = p;
      }
    }
  }
  return beste;
}

/**
 * De cellen van één vel: per pagina op dat vel (`maten`, in printvolgorde,
 * {breedte, hoogte} in pt) haar cel en haar plek (plaatsInCel, PDF-
 * coördinaten in pt). De afdruk en het voorbeeld gebruiken allebei deze regel.
 * `draaien`: Automatisch draaien, per pagina (plaatsInCel).
 * @returns {{k:number, kol:number, rij:number, x:number, y:number,
 *            breedte:number, hoogte:number, schaal:number, kwartslag:boolean}[]}
 */
export function velIndeling({ bladB, bladH, kolommen, rijen, volgorde = 'horizontal', maten, draaien = false }) {
  return maten.slice(0, kolommen * rijen).map((m, k) => {
    const { kol, rij } = celVoorVolgnummer(k, kolommen, rijen, volgorde);
    return {
      k, kol, rij,
      ...plaatsInCel({ bladB, bladH, kolommen, rijen, kol, rij, paginaB: m.breedte, paginaH: m.hoogte, draaien }),
    };
  });
}

/**
 * Waar het beeld van (een deel van) een printpagina in het voorbeeld komt.
 * `cel`: een cel van voorbeeldMeerPerBlad of voorbeeldBoekje (opVel in mm op
 * het vel, schaal = verkleining van de printpagina); `r`: het deel in mm op de
 * printpagina (renderDeel(...).opVel). Geeft de rechthoek op het vel (mm) die
 * het beeld bedekt en de hoek waarover het beeld linksom gedraaid in die
 * rechthoek komt: 0, 90 (`kwartslag`, zoals maakMeerPerBlad) of 180
 * (`gedraaid`, de achterkant van een boekje, gespiegeld in de cel).
 * @returns {{x:number, y:number, breedte:number, hoogte:number, hoek:0|90|180}}
 */
export function beeldInCel(cel, r) {
  const s = cel.schaal;
  const o = cel.opVel;
  if (cel.kwartslag) {
    // Linksom: de bovenrand van de printpagina komt links. Punt (x, y) van
    // een printpagina van B mm breed komt op (y, B - x).
    const paginaB = o.hoogte / s;
    return {
      x: o.x + r.y * s,
      y: o.y + (paginaB - r.x - r.breedte) * s,
      breedte: r.hoogte * s,
      hoogte: r.breedte * s,
      hoek: 90,
    };
  }
  if (cel.gedraaid) {
    return {
      x: o.x + o.breedte - (r.x + r.breedte) * s,
      y: o.y + o.hoogte - (r.y + r.hoogte) * s,
      breedte: r.breedte * s,
      hoogte: r.hoogte * s,
      hoek: 180,
    };
  }
  return { x: o.x + r.x * s, y: o.y + r.y * s, breedte: r.breedte * s, hoogte: r.hoogte * s, hoek: 0 };
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
 * Zonder pijlen (`pijlen: false`) alleen de nummers: bij een boekje, waar de
 * pagina's links en rechts van de vouw niet na elkaar komen, en bij een
 * folder, waar elke cel dezelfde pagina is.
 * @param {{k:number, opVel:{x:number, y:number, breedte:number, hoogte:number}}[]} cellen
 * @param {{pijlen?: boolean}} [opties]
 * @returns {{ straal:number, merken:{k:number, x:number, y:number}[],
 *             pijlen:{x1:number, y1:number, x2:number, y2:number}[] }}
 */
export function volgordeAanwijzer(cellen, { pijlen: metPijlen = true } = {}) {
  const lijst = (cellen || []).filter((c) => c && c.opVel);
  if (!lijst.length) return { straal: 0, merken: [], pijlen: [] };
  const kleinste = Math.min(...lijst.map((c) => Math.min(c.opVel.breedte, c.opVel.hoogte)));
  const straal = Math.max(0.5, Math.min(12, kleinste * 0.14));
  const merken = lijst
    .map((c) => ({ k: c.k, x: c.opVel.x + c.opVel.breedte / 2, y: c.opVel.y + c.opVel.hoogte / 2 }))
    .sort((a, b) => a.k - b.k);
  const ruimte = straal * 1.25;
  const pijlen = [];
  for (let i = 0; metPijlen && i + 1 < merken.length; i++) {
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
 * De keuzes waarmee de printopdracht de printpagina's bouwt (één per
 * bronpagina, vóór het raster, het boekje of de poster). Poster: elke pagina
 * op haar eigen maat (papier onbekend, passend = 1:1), geen raster. Boekje en
 * meerdere pagina's per vel (ook een folder): passend en gecentreerd, en elke
 * printpagina in de stand van haar pagina (CEL_PAGINA_STAND); de gekozen
 * stand geldt voor het vel, niet voor de inhoud (#623). Anders de keuzes
 * zoals ze zijn.
 * @returns {{vel:any, meerPerBlad:object|null, schaling:string, zoom:number,
 *            centreren:boolean, orientatie:string}}
 */
export function bronKeuzes({
  poster = null, vel = null, meerPerBlad = null, schaling, zoom, centreren, boekje = false, orientatie = 'auto',
}) {
  if (poster) return { vel: null, meerPerBlad: null, schaling: 'fit', zoom: 100, centreren: true, orientatie };
  if (boekje) {
    return { vel, meerPerBlad: null, schaling: 'fit', zoom: 100, centreren: true, orientatie: CEL_PAGINA_STAND };
  }
  if (isMeerPerBlad(meerPerBlad)) {
    return {
      vel: CEL_PAPIER, meerPerBlad, ...schaalVoorMeerPerBlad(meerPerBlad, schaling, zoom, centreren), orientatie: CEL_PAGINA_STAND,
    };
  }
  return { vel, meerPerBlad, schaling, zoom, centreren, orientatie };
}

/**
 * Het voorbeeld van één vel bij meerdere pagina's per vel, zoals de
 * printopdracht het bouwt: elke pagina eerst op haar printpagina
 * (berekenPlaatsing met het papier van de dialoog, in de stand van de pagina
 * zelf, de schaalkeuze vervalt), dan het vel (kiesBlad in de gekozen stand,
 * uit de eerste pagina van de hele afdruk) en de cellen (velIndeling).
 * `meerPerBlad.paginaDraaien` = Automatisch draaien: een pagina mag een
 * kwartslag in haar cel draaien als ze zo groter wordt (`kwartslag` per cel).
 *
 * @param {{ meerPerBlad: {kolommen:number, rijen:number, volgorde?:string, rand?:boolean,
 *                         draaibaar?:boolean, paginaDraaien?:boolean}|null,
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
 *   cellen: { k:number, plaatsing:object, schaal:number, kwartslag:boolean,
 *             opVel:{x:number, y:number, breedte:number, hoogte:number} }[] }}
 *   Rechthoeken in mm vanaf de linkerbovenhoek van het vel. Per cel:
 *   plaatsing = de pagina op haar printpagina (print-plaatsing.js), opVel =
 *   waar die printpagina op het vel komt (bij kwartslag gedraaid, zie
 *   beeldInCel), schaal = de verkleining daarbij.
 *   schaal = de schaal van de eerste pagina van het vel op het papier.
 *   null bij één pagina per vel of een onbruikbare paginamaat.
 */
export function voorbeeldMeerPerBlad({ meerPerBlad, keuzes, eerstePagina, paginas }) {
  if (!isMeerPerBlad(meerPerBlad) || !keuzes) return null;
  const {
    volgorde = 'horizontal', rand = false, draaibaar = false, snijtekens = false, paginaDraaien = false,
  } = meerPerBlad;
  const { papier: vel = null, orientatie = 'auto', schaling, zoom, centreren } = keuzes;
  // Zoals bronKeuzes: de printpagina in de stand van de pagina zelf.
  const celKeuzes = {
    papier: CEL_PAPIER, orientatie: CEL_PAGINA_STAND, ...schaalVoorMeerPerBlad(meerPerBlad, schaling, zoom, centreren),
  };
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
    kolommen: meerPerBlad.kolommen, rijen: meerPerBlad.rijen, draaibaar, draaien: paginaDraaien,
  });
  const velB = bladB * MM_PER_PT;
  const velH = bladH * MM_PER_PT;
  const stand = bladB > bladH ? 'landscape' : 'portrait';

  const indeling = velIndeling({
    bladB, bladH, kolommen, rijen, volgorde, maten: plaatsingen.map(maat), draaien: paginaDraaien,
  });
  const cellen = indeling
    .map((c) => ({
      k: c.k,
      plaatsing: plaatsingen[c.k],
      schaal: c.schaal,
      kwartslag: c.kwartslag,
      opVel: {
        x: c.x * MM_PER_PT,
        y: (bladH - c.y - c.hoogte) * MM_PER_PT,
        breedte: c.breedte * MM_PER_PT,
        hoogte: c.hoogte * MM_PER_PT,
      },
    }));

  const marges = margesVoor(papier && papier.bedrukbaar, stand, velB, velH);
  return {
    // Het vel is bekend als de dialoog papier heeft (een maat, of de pagina zelf).
    bekend: vel != null,
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
 * `orientatie` is de stand van het vel; `paginaDraaien` (Automatisch draaien)
 * laat een pagina een kwartslag linksom in haar cel draaien als ze zo groter
 * wordt (velIndeling), zoals het voorbeeld.
 * @param {PDFDocument} pdf
 * @param {{ kolommen:number, rijen:number, volgorde?:string, rand?:boolean,
 *           draaibaar?:boolean, paginaDraaien?:boolean, flyer?:boolean, snijtekens?:boolean,
 *           papier?:{breedteMm:number, hoogteMm:number}|null,
 *           orientatie?:'auto'|'portrait'|'landscape' }} opties
 */
export async function maakMeerPerBlad(pdf, opties) {
  const {
    volgorde = 'horizontal', rand = false, papier = null, orientatie = 'auto',
    draaibaar = false, paginaDraaien = false, flyer = false, snijtekens = false,
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
    draaien: paginaDraaien,
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
      bladB, bladH, kolommen, rijen, volgorde, maten: opVel.map((i) => maten[i]), draaien: paginaDraaien,
    });
    for (const p of cellen) {
      // Een kwartslag linksom om de linkeronderhoek van de pagina: die komt
      // dan rechtsonder in haar rechthoek; breedte en hoogte zijn die van de
      // pagina zelf.
      blad.drawPage(ingebed[opVel[p.k]], p.kwartslag
        ? { x: p.x + p.breedte, y: p.y, width: p.hoogte, height: p.breedte, rotate: degrees(90) }
        : { x: p.x, y: p.y, width: p.breedte, height: p.hoogte });
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
