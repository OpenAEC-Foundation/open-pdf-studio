// Waar de pagina op het vel komt, en hoe groot: de schaal uit de printdialoog.
//
// De dialoog bewaarde Type (passend, werkelijke grootte, verkleinen, aangepaste
// schaal), Paginazoom en Automatisch centreren wel, maar niets deed er iets
// mee: het voorbeeld toonde de pagina altijd paginavullend en de printer
// paste elke pagina altijd passend in zijn afdrukgebied. Hier staat de pure
// rekenregel die het voorbeeld en de printopdracht allebei gebruiken, zodat
// wat je ziet is wat eruit komt. Geen DOM, geen state — volledig te testen.
//
// Maten: het vel in mm, de pagina in pt (zoals getoond, dus met draaiing).
// Rechthoeken op het vel in mm vanaf de linkerbovenhoek van het vel zoals het
// uit de printer komt; rechthoeken op de pagina in pt vanaf de linkerbovenhoek
// van de pagina.

import { paginaOrientatie } from './print-pagina-instelling.js';

const MM_PER_PT = 25.4 / 72;
const PT_PER_MM = 72 / 25.4;

/** Schaaltypen van de printdialoog, zoals print-instellingen.js ze bewaart. */
export const SCHALINGEN = Object.freeze(['fit', 'actual', 'shrink', 'custom-scale']);

/** Grenzen van de Paginazoom in procenten (dezelfde als in de dialoog). */
export const ZOOM_MIN = 10;
export const ZOOM_MAX = 400;

/**
 * Hoeveel mm een pagina aan een rand buiten het vel mag steken voordat ze als
 * afgesneden telt. Papiermaten zijn afgerond (Letter staat als 216 x 279 mm in
 * de lijst, het vel is 215,9 x 279,4 mm); daarvoor geen melding.
 */
export const AFSNIJ_SPELING_MM = 0.5;

function geldig(n) {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/** Paginazoom begrensd op 10..400 %, hele procenten; onzin → 100. */
export function geldigeZoom(zoom) {
  const n = typeof zoom === 'string' ? Number.parseFloat(zoom) : zoom;
  if (typeof n !== 'number' || !Number.isFinite(n)) return 100;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(n)));
}

/**
 * Oriëntatie van het vel: de gevraagde, of bij 'auto' die van de pagina
 * (breder dan hoog = liggend), zoals print_pdf per pagina draait.
 */
export function velOrientatie(orientatie, breedtePt, hoogtePt) {
  if (orientatie === 'portrait' || orientatie === 'landscape') return orientatie;
  return paginaOrientatie(breedtePt, hoogtePt);
}

/**
 * Schaalfactor pagina → vel.
 * - 'fit': passend in het vel, vergroten mag;
 * - 'actual': ware grootte (1);
 * - 'shrink': alleen verkleinen als de pagina niet past;
 * - 'custom-scale': Paginazoom ten opzichte van ware grootte.
 * Een onbekend type telt als 'fit' (de standaard van de dialoog).
 */
export function schaalFactor(schaling, zoom, passend) {
  switch (schaling) {
    case 'actual': return 1;
    case 'shrink': return Math.min(1, passend);
    case 'custom-scale': return geldigeZoom(zoom) / 100;
    default: return passend;
  }
}

function snijding(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const rechts = Math.min(a.x + a.breedte, b.x + b.breedte);
  const onder = Math.min(a.y + a.hoogte, b.y + b.hoogte);
  if (rechts <= x || onder <= y) return null;
  return { x, y, breedte: rechts - x, hoogte: onder - y };
}

/**
 * De plaatsing van één pagina op het vel.
 *
 * `papier` is het vel staand in mm (volgorde maakt niet uit), of null als het
 * papier onbekend is: dan blijft het gedrag van vóór de schaalkeuze, de pagina
 * is het vel (het voorbeeld toont de pagina, de printer past haar in).
 *
 * @param {{ papier: {breedteMm:number, hoogteMm:number}|null,
 *           orientatie?: 'auto'|'portrait'|'landscape',
 *           pagina: {breedtePt:number, hoogtePt:number},
 *           schaling?: string, zoom?: number, centreren?: boolean }} p
 * @returns {null | {
 *   bekend: boolean,
 *   vel: {breedteMm:number, hoogteMm:number, orientatie:'portrait'|'landscape'},
 *   paginaPt: {breedtePt:number, hoogtePt:number},
 *   pagina: {x:number, y:number, breedte:number, hoogte:number},
 *   zichtbaar: {x:number, y:number, breedte:number, hoogte:number}|null,
 *   bron: {x:number, y:number, breedte:number, hoogte:number}|null,
 *   schaal: number,
 *   afgesneden: boolean }}
 *   pagina = de hele pagina op het vel (mm, mag buiten het vel steken);
 *   zichtbaar = het deel daarvan dat op het vel valt (mm);
 *   bron = datzelfde deel in paginacoördinaten (pt);
 *   schaal = mm op het vel per mm op de pagina (1 = ware grootte).
 *   null als de paginamaat onbruikbaar is.
 */
export function berekenPlaatsing({
  papier, orientatie = 'auto', pagina, schaling = 'fit', zoom = 100, centreren = true,
}) {
  if (!pagina || !geldig(pagina.breedtePt) || !geldig(pagina.hoogtePt)) return null;
  const paginaPt = { breedtePt: pagina.breedtePt, hoogtePt: pagina.hoogtePt };
  const pagB = pagina.breedtePt * MM_PER_PT;
  const pagH = pagina.hoogtePt * MM_PER_PT;

  if (!papier || !geldig(papier.breedteMm) || !geldig(papier.hoogteMm)) {
    const heel = { x: 0, y: 0, breedte: pagB, hoogte: pagH };
    return {
      bekend: false,
      vel: { breedteMm: pagB, hoogteMm: pagH, orientatie: paginaOrientatie(pagina.breedtePt, pagina.hoogtePt) },
      paginaPt,
      pagina: heel,
      zichtbaar: { ...heel },
      bron: { x: 0, y: 0, breedte: pagina.breedtePt, hoogte: pagina.hoogtePt },
      schaal: 1,
      afgesneden: false,
    };
  }

  const kort = Math.min(papier.breedteMm, papier.hoogteMm);
  const lang = Math.max(papier.breedteMm, papier.hoogteMm);
  const or = velOrientatie(orientatie, pagina.breedtePt, pagina.hoogtePt);
  const velB = or === 'landscape' ? lang : kort;
  const velH = or === 'landscape' ? kort : lang;

  const passend = Math.min(velB / pagB, velH / pagH);
  const schaal = schaalFactor(schaling, zoom, passend);
  const b = pagB * schaal;
  const h = pagH * schaal;
  const x = centreren ? (velB - b) / 2 : 0;
  const y = centreren ? (velH - h) / 2 : 0;
  const op = { x, y, breedte: b, hoogte: h };
  const zichtbaar = snijding(op, { x: 0, y: 0, breedte: velB, hoogte: velH });
  const bron = zichtbaar && {
    x: ((zichtbaar.x - x) / schaal) * PT_PER_MM,
    y: ((zichtbaar.y - y) / schaal) * PT_PER_MM,
    breedte: (zichtbaar.breedte / schaal) * PT_PER_MM,
    hoogte: (zichtbaar.hoogte / schaal) * PT_PER_MM,
  };
  const afgesneden = x < -AFSNIJ_SPELING_MM || y < -AFSNIJ_SPELING_MM
    || x + b > velB + AFSNIJ_SPELING_MM || y + h > velH + AFSNIJ_SPELING_MM;

  return {
    bekend: true,
    vel: { breedteMm: velB, hoogteMm: velH, orientatie: or },
    paginaPt,
    pagina: op,
    zichtbaar,
    bron,
    schaal,
    afgesneden,
  };
}

/**
 * Welke pixels van de pagina gerenderd worden bij `pxPerPt` pixels per
 * paginapunt, en waar die pixels op het vel komen.
 *
 * Alleen het zichtbare deel (`bron`), op hele pixels naar buiten afgerond.
 * Een rand die op de rand van de pagina ligt komt precies op de rand van de
 * pagina op het vel; een naar buiten afgeronde rand steekt hooguit één
 * pixel over de rand van het vel (die knipt het af).
 *
 * @returns {null | { px: {x:number, y:number, breedte:number, hoogte:number},
 *                    opVel: {x:number, y:number, breedte:number, hoogte:number} }}
 *   px in pixels van een rendering van de hele pagina op `pxPerPt`; opVel in mm.
 */
export function renderDeel(plaatsing, pxPerPt) {
  if (!plaatsing || !plaatsing.bron || !geldig(pxPerPt)) return null;
  const { bron, paginaPt, pagina, schaal } = plaatsing;
  const volB = Math.max(1, Math.ceil(paginaPt.breedtePt * pxPerPt - 1e-6));
  const volH = Math.max(1, Math.ceil(paginaPt.hoogtePt * pxPerPt - 1e-6));
  const x0 = Math.min(volB - 1, Math.max(0, Math.floor(bron.x * pxPerPt + 1e-6)));
  const y0 = Math.min(volH - 1, Math.max(0, Math.floor(bron.y * pxPerPt + 1e-6)));
  const x1 = Math.max(x0 + 1, Math.min(volB, Math.ceil((bron.x + bron.breedte) * pxPerPt - 1e-6)));
  const y1 = Math.max(y0 + 1, Math.min(volH, Math.ceil((bron.y + bron.hoogte) * pxPerPt - 1e-6)));

  // Van pixel (op de hele pagina) naar mm op het vel; de randen van de pagina exact.
  const mmPerPx = (MM_PER_PT * schaal) / pxPerPt;
  const opX = (px) => (px >= volB ? pagina.x + pagina.breedte : pagina.x + px * mmPerPx);
  const opY = (px) => (px >= volH ? pagina.y + pagina.hoogte : pagina.y + px * mmPerPx);
  const links = opX(x0);
  const boven = opY(y0);
  return {
    px: { x: x0, y: y0, breedte: x1 - x0, hoogte: y1 - y0 },
    opVel: { x: links, y: boven, breedte: opX(x1) - links, hoogte: opY(y1) - boven },
  };
}

/**
 * Pagina voor de tijdelijke print-PDF (pdf-lib): de maat van het vel in pt en
 * waar de gerenderde pixels (`renderDeel`) erop komen, met de oorsprong
 * linksonder zoals in PDF. Bij onbekend papier is het vel de pagina en vult
 * het beeld de pagina, precies als vóór de schaalkeuze.
 *
 * @returns {{ maat: [number, number],
 *             afbeelding: { x:number, y:number, width:number, height:number } }}
 */
export function pdfPagina(plaatsing, deel) {
  const velB = plaatsing.vel.breedteMm * PT_PER_MM;
  const velH = plaatsing.vel.hoogteMm * PT_PER_MM;
  // Onbekend papier: de pagina op haar eigen maat, zonder afrondingsverschil.
  const maat = plaatsing.bekend ? [velB, velH] : [plaatsing.paginaPt.breedtePt, plaatsing.paginaPt.hoogtePt];
  const k = maat[0] / plaatsing.vel.breedteMm;
  const r = deel.opVel;
  return {
    maat,
    afbeelding: {
      x: r.x * k,
      y: maat[1] - (r.y + r.hoogte) * k,
      width: r.breedte * k,
      height: r.hoogte * k,
    },
  };
}
