// Meerdere pagina's per vel ("Pages per sheet", n-up).
//
// Werkt op de al gebouwde print-PDF (print-job.js: één pagina per bronpagina,
// op het gekozen vel gelegd): die pagina's worden ingebed en in een raster van
// kolommen x rijen op nieuwe vellen gezet, elk verkleind tot de cel. Zo werken
// raster- en vectorpad allebei zonder eigen n-up-code.

import { PDFDocument, rgb } from 'pdf-lib';

const PT_PER_MM = 72 / 25.4;
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
 * Het vel: afmetingen en stand. `papier` is {breedteMm, hoogteMm} als het vel
 * bekend is, anders volgt het de eerste pagina. `orientatie` 'portrait' /
 * 'landscape' staat vast; 'auto' kiest de stand waarin de eerste pagina het
 * grootst in zijn cel komt.
 */
export function kiesBlad({ papier, orientatie = 'auto', eerstePagina, kolommen, rijen }) {
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
  if (orientatie === 'portrait') return staand;
  if (orientatie === 'landscape') return liggend;
  const schaalIn = (blad) => {
    const { celB, celH } = celGeometrie({ ...blad, kolommen, rijen });
    return Math.min(celB / eerstePagina.breedte, celH / eerstePagina.hoogte);
  };
  return schaalIn(liggend) > schaalIn(staand) + 1e-9 ? liggend : staand;
}

/**
 * Bouw de print-PDF met meerdere pagina's per vel uit `pdf` (één pagina per
 * bronpagina). Geeft een nieuw PDFDocument; zonder meer dan één per vel komt
 * `pdf` zelf terug.
 * @param {PDFDocument} pdf
 * @param {{ kolommen:number, rijen:number, volgorde?:string, rand?:boolean,
 *           papier?:{breedteMm:number, hoogteMm:number}|null,
 *           orientatie?:'auto'|'portrait'|'landscape' }} opties
 */
export async function maakMeerPerBlad(pdf, opties) {
  const { kolommen, rijen, volgorde = 'horizontal', rand = false, papier = null, orientatie = 'auto' } = opties;
  if (!isMeerPerBlad({ kolommen, rijen })) return pdf;
  const bron = pdf.getPages();
  if (bron.length === 0) return pdf;

  const maten = bron.map((p) => {
    const { width, height } = p.getSize();
    return { breedte: width, hoogte: height };
  });
  const { bladB, bladH } = kiesBlad({ papier, orientatie, eerstePagina: maten[0], kolommen, rijen });

  const uit = await PDFDocument.create();
  const ingebed = await uit.embedPdf(pdf, bron.map((_, i) => i));
  const perBlad = kolommen * rijen;
  for (let start = 0; start < bron.length; start += perBlad) {
    const blad = uit.addPage([bladB, bladH]);
    for (let k = 0; k < perBlad && start + k < bron.length; k++) {
      const i = start + k;
      const { kol, rij } = celVoorVolgnummer(k, kolommen, rijen, volgorde);
      const p = plaatsInCel({
        bladB, bladH, kolommen, rijen, kol, rij, paginaB: maten[i].breedte, paginaH: maten[i].hoogte,
      });
      blad.drawPage(ingebed[i], { x: p.x, y: p.y, width: p.breedte, height: p.hoogte });
      if (rand) {
        blad.drawRectangle({
          x: p.x, y: p.y, width: p.breedte, height: p.hoogte,
          borderColor: rgb(0, 0, 0), borderWidth: 0.5,
        });
      }
    }
  }
  return uit;
}
