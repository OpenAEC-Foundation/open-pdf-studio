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
//
// Haaks op het vel: staat de pagina liggend en het vel staand (of andersom),
// dan komt de pagina een kwartslag LINKSOM gedraaid op het vel te liggen, zodat
// ze het vel vult in plaats van er op zo'n 70 % met brede witranden op te
// staan. Dat gebeurt alleen bij een handmatig gekozen stand ("Automatisch
// draaien" uit): bij 'auto' volgt het vel de pagina. De printkern in Rust
// (print_plaatsing.rs, `draaiing_voor_vel`) gebruikt dezelfde regel en dezelfde
// richting voor het geval het stuurprogramma een ander vel geeft dan gevraagd.
// Alle rechthoeken op de pagina (`paginaPt`, `bron`, `renderDeel`) gelden dan
// voor de pagina zoals ze op het vel ligt; `ongedraaidDeel` rekent terug naar
// de pagina zoals ze getoond wordt.
//
// Bijna elke printer heeft een onbedrukbare rand. Die meldt Rust per
// oriëntatie (printer_bedrukbaar); "Passend" en "Verkleinen" blijven binnen
// dat gebied, zodat er niet bij elke afdruk een rand wegvalt. "Werkelijke
// grootte" en "Aangepaste schaal" blijven 1:1 op het vel — een tekening op
// schaal moet op papier op schaal blijven — en melden het als de pagina
// daardoor buiten het bedrukbare gebied valt.

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
 * De draaiing van een pagina die haaks op het vel staat: een kwartslag linksom
 * (de bovenrand van de pagina komt aan de linkerrand van het vel). Genoteerd
 * zoals /Rotate in een PDF: graden met de klok mee, dus 270.
 */
export const DRAAIING_HAAKS = 270;

/**
 * Staat de pagina haaks op het vel: liggend op een staand vel of staand op een
 * liggend vel? Een vierkante pagina of een vierkant vel staat nooit haaks;
 * onbruikbare maten ook niet.
 */
export function haaksOpVel(paginaB, paginaH, velB, velH) {
  if (![paginaB, paginaH, velB, velH].every(geldig)) return false;
  if (paginaB === paginaH || velB === velH) return false;
  return (paginaB > paginaH) !== (velB > velH);
}

/**
 * Schaalfactor pagina → vel.
 * - 'fit': passend, waarbij `passend` het bedrukbare gebied volgt (vergroten mag);
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

/** Geen onbedrukbare rand bekend: het hele vel is bedrukbaar. */
export const GEEN_MARGES = Object.freeze({ links: 0, boven: 0, rechts: 0, onder: 0 });

/**
 * De onbedrukbare rand (mm) voor het vel in deze oriëntatie, uit het antwoord
 * van printer_bedrukbaar. Onbekende, negatieve of onmogelijke marges (samen
 * groter dan het vel, of zo scheef dat er gecentreerd niets overblijft)
 * tellen als geen rand: dan blijft het gedrag van vóór deze meting.
 */
export function margesVoor(bedrukbaar, orientatie, velB, velH) {
  const m = bedrukbaar && bedrukbaar[orientatie === 'landscape' ? 'liggend' : 'staand'];
  if (!m || typeof m !== 'object') return GEEN_MARGES;
  const { links, boven, rechts, onder } = m;
  const getal = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  if (![links, boven, rechts, onder].every(getal)) return GEEN_MARGES;
  if (velB - 2 * Math.max(links, rechts) <= 0 || velH - 2 * Math.max(boven, onder) <= 0) return GEEN_MARGES;
  return { links, boven, rechts, onder };
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
 * `papier: 'pagina'` (het doel "Opslaan als PDF" zonder formaat, waar geen
 * stuurprogramma meer inpast): het vel heeft de maat van de pagina zelf, maar
 * is een bekend vel — de gekozen stand en de schaal gelden erop, en een pagina
 * haaks op die stand komt gedraaid op het vel.
 *
 * @param {{ papier: {breedteMm:number, hoogteMm:number}|'pagina'|null,
 *           orientatie?: 'auto'|'portrait'|'landscape',
 *           pagina: {breedtePt:number, hoogtePt:number},
 *           schaling?: string, zoom?: number, centreren?: boolean }} p
 * @returns {null | {
 *   bekend: boolean,
 *   vel: {breedteMm:number, hoogteMm:number, orientatie:'portrait'|'landscape'},
 *   gedraaid: boolean, draaiing: 0|270,
 *   paginaPt: {breedtePt:number, hoogtePt:number},
 *   pagina: {x:number, y:number, breedte:number, hoogte:number},
 *   zichtbaar: {x:number, y:number, breedte:number, hoogte:number}|null,
 *   bron: {x:number, y:number, breedte:number, hoogte:number}|null,
 *   schaal: number,
 *   marges: {links:number, boven:number, rechts:number, onder:number},
 *   bedrukbaar: {x:number, y:number, breedte:number, hoogte:number},
 *   afgesneden: boolean, buitenBedrukbaar: boolean }}
 *   gedraaid = de pagina stond haaks op het vel en ligt er een kwartslag
 *   linksom op (draaiing = DRAAIING_HAAKS, anders 0);
 *   paginaPt = de pagina zoals ze op het vel ligt (gedraaid: breedte en hoogte
 *   gewisseld);
 *   pagina = de hele pagina op het vel (mm, mag buiten het vel steken);
 *   zichtbaar = het deel daarvan dat op het vel valt (mm);
 *   bron = datzelfde deel in coördinaten van de pagina zoals ze op het vel
 *   ligt (pt);
 *   schaal = mm op het vel per mm op de pagina (1 = ware grootte);
 *   bedrukbaar = het bedrukbare gebied op het vel (marges van de printer);
 *   afgesneden = steekt buiten het vel, buitenBedrukbaar = buiten dat gebied.
 *   null als de paginamaat onbruikbaar is.
 */
export function berekenPlaatsing({
  papier, orientatie = 'auto', pagina, schaling = 'fit', zoom = 100, centreren = true,
}) {
  if (!pagina || !geldig(pagina.breedtePt) || !geldig(pagina.hoogtePt)) return null;

  // Het vel is de pagina zelf: haar korte en lange zijde, als bekend vel.
  if (papier === 'pagina') {
    papier = {
      breedteMm: Math.min(pagina.breedtePt, pagina.hoogtePt) * MM_PER_PT,
      hoogteMm: Math.max(pagina.breedtePt, pagina.hoogtePt) * MM_PER_PT,
    };
  }

  if (!papier || !geldig(papier.breedteMm) || !geldig(papier.hoogteMm)) {
    const pagB = pagina.breedtePt * MM_PER_PT;
    const pagH = pagina.hoogtePt * MM_PER_PT;
    const heel = { x: 0, y: 0, breedte: pagB, hoogte: pagH };
    return {
      bekend: false,
      vel: { breedteMm: pagB, hoogteMm: pagH, orientatie: paginaOrientatie(pagina.breedtePt, pagina.hoogtePt) },
      gedraaid: false,
      draaiing: 0,
      paginaPt: { breedtePt: pagina.breedtePt, hoogtePt: pagina.hoogtePt },
      pagina: heel,
      zichtbaar: { ...heel },
      bron: { x: 0, y: 0, breedte: pagina.breedtePt, hoogte: pagina.hoogtePt },
      schaal: 1,
      marges: GEEN_MARGES,
      bedrukbaar: { ...heel },
      afgesneden: false,
      buitenBedrukbaar: false,
    };
  }

  const kort = Math.min(papier.breedteMm, papier.hoogteMm);
  const lang = Math.max(papier.breedteMm, papier.hoogteMm);
  const or = velOrientatie(orientatie, pagina.breedtePt, pagina.hoogtePt);
  const velB = or === 'landscape' ? lang : kort;
  const velH = or === 'landscape' ? kort : lang;

  // Haaks op het vel: de pagina komt een kwartslag linksom te liggen. Vanaf
  // hier is "de pagina" de pagina zoals ze op het vel ligt.
  const gedraaid = haaksOpVel(pagina.breedtePt, pagina.hoogtePt, velB, velH);
  const paginaPt = gedraaid
    ? { breedtePt: pagina.hoogtePt, hoogtePt: pagina.breedtePt }
    : { breedtePt: pagina.breedtePt, hoogtePt: pagina.hoogtePt };
  const pagB = paginaPt.breedtePt * MM_PER_PT;
  const pagH = paginaPt.hoogtePt * MM_PER_PT;

  // Het bedrukbare gebied van de printer (printer_bedrukbaar); onbekend = het
  // hele vel, zoals vóór deze meting.
  const marges = margesVoor(papier.bedrukbaar, or, velB, velH);
  const gebied = {
    x: marges.links,
    y: marges.boven,
    breedte: velB - marges.links - marges.rechts,
    hoogte: velH - marges.boven - marges.onder,
  };
  // Passend en verkleinen blijven binnen het bedrukbare gebied. Gecentreerd op
  // het vel moet de pagina aan béide kanten binnen dat gebied blijven, dus
  // telt per as de grootste marge; anders staat ze op de hoek van het gebied.
  const vak = centreren
    ? {
      breedte: velB - 2 * Math.max(marges.links, marges.rechts),
      hoogte: velH - 2 * Math.max(marges.boven, marges.onder),
    }
    : { breedte: gebied.breedte, hoogte: gebied.hoogte };
  const passend = Math.min(vak.breedte / pagB, vak.hoogte / pagH);
  const schaal = schaalFactor(schaling, zoom, passend);
  // Ware grootte en aangepaste schaal blijven 1:1 op het vel: een pagina op
  // schaal moet op papier op schaal blijven.
  const binnenGebied = schaling !== 'actual' && schaling !== 'custom-scale';
  const b = pagB * schaal;
  const h = pagH * schaal;
  const x = centreren ? (velB - b) / 2 : (binnenGebied ? gebied.x : 0);
  const y = centreren ? (velH - h) / 2 : (binnenGebied ? gebied.y : 0);
  const op = { x, y, breedte: b, hoogte: h };
  const zichtbaar = snijding(op, { x: 0, y: 0, breedte: velB, hoogte: velH });
  const bron = zichtbaar && {
    x: ((zichtbaar.x - x) / schaal) * PT_PER_MM,
    y: ((zichtbaar.y - y) / schaal) * PT_PER_MM,
    breedte: (zichtbaar.breedte / schaal) * PT_PER_MM,
    hoogte: (zichtbaar.hoogte / schaal) * PT_PER_MM,
  };
  const buiten = (vak_) => x < vak_.x - AFSNIJ_SPELING_MM || y < vak_.y - AFSNIJ_SPELING_MM
    || x + b > vak_.x + vak_.breedte + AFSNIJ_SPELING_MM
    || y + h > vak_.y + vak_.hoogte + AFSNIJ_SPELING_MM;

  return {
    bekend: true,
    vel: { breedteMm: velB, hoogteMm: velH, orientatie: or },
    gedraaid,
    draaiing: gedraaid ? DRAAIING_HAAKS : 0,
    paginaPt,
    pagina: op,
    zichtbaar,
    bron,
    schaal,
    marges,
    bedrukbaar: gebied,
    afgesneden: buiten({ x: 0, y: 0, breedte: velB, hoogte: velH }),
    buitenBedrukbaar: buiten(gebied),
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
 * Het deel uit `renderDeel` (pixels van de pagina zoals ze op het vel ligt)
 * terug naar de pixels van de pagina zoals ze getoond wordt: dat deel wordt
 * gerenderd en daarna een kwartslag linksom gedraaid. Niet gedraaid: hetzelfde
 * deel. Een kwartslag linksom legt punt (x, y) van een pagina van B pixels
 * breed op (y, B - x); hier de omgekeerde weg.
 */
export function ongedraaidDeel(plaatsing, pxPerPt, px) {
  if (!plaatsing || !plaatsing.gedraaid || !px) return px;
  // De breedte van de getoonde pagina is de hoogte van de gedraaide.
  const volB = Math.max(1, Math.ceil(plaatsing.paginaPt.hoogtePt * pxPerPt - 1e-6));
  return { x: volB - (px.y + px.hoogte), y: px.x, breedte: px.hoogte, hoogte: px.breedte };
}

/** Resolutie van het paginabeeld in de tijdelijke print-PDF. */
export const PRINT_DPI = 300;

/**
 * Pixels per paginapunt voor het paginabeeld van de printopdracht: `dpi` op
 * papier, maar bij vergroten niet fijner dan `dpi` van de pagina zelf. Zo
 * kost een vergrote pagina niet meer dan vóór de schaalkeuze (toen elke
 * pagina op 300 dpi van haar eigen maat ging), en een verkleinde minder.
 */
export function printPxPerPt(plaatsing, dpi = PRINT_DPI) {
  const schaal = plaatsing && geldig(plaatsing.schaal) ? plaatsing.schaal : 1;
  return (dpi / 72) * Math.min(1, schaal);
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

/**
 * Voeg de pagina toe aan de tijdelijke print-PDF: `pdf` is een pdf-lib
 * PDFDocument, `beeld` het ingebedde paginabeeld (de pixels van `deel`).
 * @returns de nieuwe pdf-lib-pagina
 */
export function voegPrintPaginaToe(pdf, plaatsing, deel, beeld) {
  const { maat, afbeelding } = pdfPagina(plaatsing, deel);
  const pagina = pdf.addPage(maat);
  pagina.drawImage(beeld, afbeelding);
  return pagina;
}
