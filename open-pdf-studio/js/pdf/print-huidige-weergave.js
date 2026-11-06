// Afdrukken: Huidige weergave (#947).
//
// Precies wat in het documentvenster te zien is, op de huidige zoom en
// verschuiving, passend op het papier. Per pagina die in beeld is een
// uitsnede: het zichtbare deel van die pagina. Het grijze vlak naast de pagina
// telt niet mee (alleen de doorsnede met de pagina), en in de doorlopende
// weergave krijgt elke pagina die in beeld is haar eigen vel, van boven naar
// beneden. De uitsnede gaat daarna door dezelfde plaatsing als een hele
// pagina (print-plaatsing.js): de uitsnede is dan "de pagina".
//
// Ruimtes:
//  - scherm: CSS-pixels (clientX/Y), zoals getBoundingClientRect;
//  - paginaruimte: punten vanaf linksboven, na /Rotate en paginarotatie, de
//    ruimte waarin de printopdracht rendert (viewportOpties);
//  - weergaveruimte: de paginaruimte gedraaid over de weergaverotatie (#200),
//    zoals de gebruiker de pagina ziet. De afdruk volgt die stand.
// Geen DOM: de schermrechthoeken komen binnen als argument.

import { normaliseerRotatie, isKwartslag, weergaveMaat } from './weergave-rotatie.js';

/** Kleiner dan dit (CSS-px, per as) telt een strookje pagina niet als in beeld. */
export const MIN_ZICHTBAAR_PX = 8;

/** Bovengrenzen voor het beeld van één uitsnede (canvas-limieten van de WebView). */
export const MAX_ZIJDE_PX = 12000;
export const MAX_BEELD_PX = 64e6;

function geldig(n) {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

function snij(a, b) {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  if (!(right > left) || !(bottom > top)) return null;
  return { left, top, width: right - left, height: bottom - top };
}

/**
 * De zichtbare delen van de pagina's op het scherm: per pagina de doorsnede
 * van haar schermrechthoek met het venster. Strookjes kleiner dan `minPx`
 * vallen weg. Volgorde: van boven naar beneden, dan van links naar rechts.
 * @param {{pageNum:number, rect:{left:number, top:number, width:number, height:number}}[]} paginas
 * @param {{left:number, top:number, width:number, height:number}} venster
 * @returns {{pageNum:number, rect:{left:number, top:number, width:number, height:number}}[]}
 */
export function zichtbareDelen(paginas, venster, minPx = MIN_ZICHTBAAR_PX) {
  if (!venster || !geldig(venster.width) || !geldig(venster.height)) return [];
  const uit = [];
  for (const p of paginas || []) {
    if (!p?.rect || !(p.pageNum > 0)) continue;
    const s = snij(p.rect, venster);
    if (s && s.width >= minPx && s.height >= minPx) uit.push({ pageNum: p.pageNum, rect: s });
  }
  return uit.sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
}

/**
 * De uitsnede voor de printopdracht uit het zichtbare deel in paginaruimte
 * (`rect`, punten, zoals clientRectNaarPagina het geeft), begrensd op de
 * pagina (`paginaMaat` in paginaruimte). `rotatie` is de weergaverotatie: de
 * afdruk ligt zoals op het scherm.
 * @param {{x:number, y:number, width:number, height:number}} rect
 * @param {{breedte:number, hoogte:number}} paginaMaat
 * @returns {null | { pagina:{x:number, y:number, breedte:number, hoogte:number},
 *                    rotatie:0|90|180|270, breedtePt:number, hoogtePt:number }}
 *   breedtePt/hoogtePt: de maat van de uitsnede zoals ze getoond wordt (en
 *   op het vel komt).
 */
export function maakUitsnede(rect, paginaMaat, rotatie = 0) {
  if (!rect || !paginaMaat || !geldig(paginaMaat.breedte) || !geldig(paginaMaat.hoogte)) return null;
  const x0 = Math.max(0, Number(rect.x) || 0);
  const y0 = Math.max(0, Number(rect.y) || 0);
  const x1 = Math.min(paginaMaat.breedte, (Number(rect.x) || 0) + (Number(rect.width) || 0));
  const y1 = Math.min(paginaMaat.hoogte, (Number(rect.y) || 0) + (Number(rect.height) || 0));
  if (!(x1 - x0 > 0.01) || !(y1 - y0 > 0.01)) return null;
  const r = normaliseerRotatie(rotatie);
  const pagina = { x: x0, y: y0, breedte: x1 - x0, hoogte: y1 - y0 };
  const getoond = weergaveMaat(pagina.breedte, pagina.hoogte, r);
  return { pagina, rotatie: r, breedtePt: getoond.breedte, hoogtePt: getoond.hoogte };
}

/**
 * Pixels per punt voor het beeld van een uitsnede in de printopdracht: `dpi`
 * op het papier. Anders dan bij een hele pagina (printPxPerPt) mag dat fijner
 * zijn dan `dpi` van de pagina zelf: een ingezoomd detail wordt vergroot
 * afgedrukt en moet daarbij scherp blijven. Begrensd op wat een canvas aankan.
 * @param {{schaal:number}} plaatsing  berekenPlaatsing voor de uitsnede
 * @param {{breedtePt:number, hoogtePt:number}} uitsnede
 */
export function uitsnedePxPerPt(plaatsing, uitsnede, dpi = 300, { maxZijde = MAX_ZIJDE_PX, maxPixels = MAX_BEELD_PX } = {}) {
  const schaal = plaatsing && geldig(plaatsing.schaal) ? plaatsing.schaal : 1;
  let s = (dpi / 72) * schaal;
  const b = uitsnede?.breedtePt;
  const h = uitsnede?.hoogtePt;
  if (geldig(b) && geldig(h)) {
    s = Math.min(s, maxZijde / Math.max(b, h), Math.sqrt(maxPixels / (b * h)));
  }
  return s;
}

/**
 * De maat in pixels van het beeld van de uitsnede op `pxPerPt`, zoals
 * getoond. Dezelfde afronding als renderDeel (print-plaatsing.js) voor een
 * pagina van die maat, zodat diens pixelvakken er precies in vallen.
 */
export function uitsnedeBeeldMaat(uitsnede, pxPerPt) {
  return {
    breedte: Math.max(1, Math.ceil(uitsnede.breedtePt * pxPerPt - 1e-6)),
    hoogte: Math.max(1, Math.ceil(uitsnede.hoogtePt * pxPerPt - 1e-6)),
  };
}

/**
 * Welke pixels van een rendering van de HELE pagina (paginaruimte, op
 * `pxPerPt`) de uitsnede vormen: een vak in hele pixels, dat na de draaiing
 * over de weergaverotatie precies `uitsnedeBeeldMaat` groot is.
 * @returns {{x:number, y:number, breedte:number, hoogte:number}}
 */
export function uitsnedeRenderVak(uitsnede, pxPerPt) {
  const beeld = uitsnedeBeeldMaat(uitsnede, pxPerPt);
  const kwart = isKwartslag(uitsnede.rotatie);
  return {
    x: Math.max(0, Math.floor(uitsnede.pagina.x * pxPerPt + 1e-6)),
    y: Math.max(0, Math.floor(uitsnede.pagina.y * pxPerPt + 1e-6)),
    breedte: kwart ? beeld.hoogte : beeld.breedte,
    hoogte: kwart ? beeld.breedte : beeld.hoogte,
  };
}

/**
 * Een gesnapshotte weergave (lijst van {pageNum, uitsnede}) als opzoektabel
 * per pagina, plus de paginavolgorde. Een pagina komt hooguit één keer voor.
 */
export function uitsnedenPerPagina(lijst) {
  const map = new Map();
  for (const item of lijst || []) {
    if (item?.uitsnede && item.pageNum > 0 && !map.has(item.pageNum)) map.set(item.pageNum, item.uitsnede);
  }
  return { paginas: [...map.keys()], uitsneden: map };
}
