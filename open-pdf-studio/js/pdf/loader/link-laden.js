// Een link die de app schreef (#953, saver/link-opslaan.js) weer lezen, met
// pdf-lib: het doel, de rand en de regelvakken precies zoals in het bestand.
// pdf.js normaliseert /Dest en /A (een paginaverwijzing, onveilige adressen
// weg) en laat quads buiten /Rect vallen; hier blijft alles bruikbaar voor het
// model.
//
// Alleen links met /OPS_Subtype (link) worden een bewerkbare annotatie. Een
// link van een ander programma (een inhoudsopgave, een webadres) blijft wat
// hij was: pdf/link-layer.js volgt hem, de saver laat hem staan.
//
// Alleen pdf-lib: ook in node te testen.

import { PDFName, PDFArray, PDFBool, PDFDict, PDFNumber, PDFRef, PDFString, PDFHexString } from 'pdf-lib';
import { colorArrayToHex } from '../../utils/colors.js';
import { LINK_STANDAARD_KLEUR } from '../../annotations/link/link-model.js';

const N = (n) => PDFName.of(n);
const naam = (v) => (v instanceof PDFName ? v.toString().replace(/^\//, '') : null);

function tekst(context, raw) {
  const v = raw instanceof PDFRef ? context.lookup(raw) : raw;
  if (v instanceof PDFString || v instanceof PDFHexString) {
    try { return v.decodeText(); } catch { return null; }
  }
  return null;
}

function getal(context, raw) {
  const v = raw instanceof PDFRef ? context.lookup(raw) : raw;
  return v instanceof PDFNumber ? v.asNumber() : null;
}

function getallen(context, raw) {
  const arr = raw instanceof PDFRef ? context.lookup(raw) : raw;
  if (!(arr instanceof PDFArray)) return null;
  const uit = arr.asArray().map((v) => getal(context, v));
  return uit.every((v) => v !== null) ? uit : null;
}

/** Staat dit woordenboek als link van de app in het bestand? */
export function isEigenLink(context, dict) {
  if (!(dict instanceof PDFDict)) return false;
  if (dict.get(N('Subtype'))?.toString() !== '/Link') return false;
  return tekst(context, dict.get(N('OPS_Subtype'))) === 'link';
}

/** Paginanummer (1-gebaseerd) van een paginaverwijzing, of null. */
function paginaVan(pdfDoc, ref) {
  if (!(ref instanceof PDFRef)) return null;
  const paginas = pdfDoc.getPages();
  for (let i = 0; i < paginas.length; i++) {
    if (paginas[i].ref?.tag === ref.tag) return i + 1;
  }
  return null;
}

/**
 * Een /Dest-array als paginadoel. Een verwijzing naar een pagina die niet
 * (meer) in het document staat, is een gebroken doel: niet stil een andere
 * pagina.
 */
function doelUitDest(context, pdfDoc, destRaw) {
  const dest = destRaw instanceof PDFRef ? context.lookup(destRaw) : destRaw;
  if (!(dest instanceof PDFArray) || dest.size() < 2) return null;
  const eerste = dest.get(0);
  const pagina = paginaVan(pdfDoc, eerste);
  const soort = naam(dest.get(1));
  const fit = soort === 'XYZ' ? 'xyz' : 'fit';
  if (!pagina) return eerste instanceof PDFRef ? gebrokenDoel(fit) : null;
  if (soort === 'XYZ') {
    return {
      kind: 'page', page: pagina, fit: 'xyz',
      left: getal(context, dest.get(2)), top: getal(context, dest.get(3)),
      zoom: (getal(context, dest.get(4)) || null),
    };
  }
  return { kind: 'page', page: pagina, fit: 'fit' };
}

const gebrokenDoel = (fit = 'xyz') => ({ kind: 'page', page: null, broken: true, fit });

/** Het doel van de link: /Dest, of /A met /GoTo, /URI of /Launch. */
export function leesLinkDoel(context, pdfDoc, dict) {
  // De app schreef een gebroken paginadoel (link-opslaan.js): geen /Dest.
  if (!dict.get(N('Dest')) && !dict.get(N('A')) && context.lookup(dict.get(N('OPS_BrokenDest'))) instanceof PDFBool
    && context.lookup(dict.get(N('OPS_BrokenDest'))).asBoolean()) return gebrokenDoel();
  if (dict.get(N('Dest'))) return doelUitDest(context, pdfDoc, dict.get(N('Dest')));
  const actie = context.lookup(dict.get(N('A')));
  if (!(actie instanceof PDFDict)) return null;
  const s = naam(context.lookup(actie.get(N('S'))));
  if (s === 'URI') {
    const uri = tekst(context, actie.get(N('URI')));
    return uri ? { kind: 'uri', uri } : null;
  }
  if (s === 'GoTo') return doelUitDest(context, pdfDoc, actie.get(N('D')));
  if (s === 'Launch') {
    const fRaw = context.lookup(actie.get(N('F')));
    let file = tekst(context, fRaw);
    if (!file && fRaw instanceof PDFDict) {
      file = tekst(context, fRaw.get(N('UF'))) || tekst(context, fRaw.get(N('F')));
    }
    return file ? { kind: 'file', file } : null;
  }
  return null;
}

/** De rand: geen, doorgetrokken of onderstreept, met dikte. */
export function leesLinkRand(context, dict) {
  const bs = context.lookup(dict.get(N('BS')));
  if (bs instanceof PDFDict) {
    const w = getal(context, bs.get(N('W')));
    const stijl = naam(context.lookup(bs.get(N('S'))));
    const dikte = w === null ? 1 : w;
    if (dikte <= 0) return { rand: 'none', dikte: 1 };
    return { rand: stijl === 'U' ? 'underline' : 'solid', dikte };
  }
  const border = getallen(context, dict.get(N('Border')));
  if (border && border.length >= 3 && border[2] > 0) return { rand: 'solid', dikte: border[2] };
  return { rand: 'none', dikte: 1 };
}

/**
 * Alles wat de converter van een eigen link nodig heeft, of null voor een link
 * van een ander programma. Quads in PDF-ruimte (platte lijst, 8 per regel).
 * @param {import('pdf-lib').PDFContext} context
 * @param {PDFDict} dict
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 */
export function leesEigenLink(context, dict, pdfDoc) {
  if (!isEigenLink(context, dict)) return null;
  const { rand, dikte } = leesLinkRand(context, dict);
  const kleur = getallen(context, dict.get(N('C')));
  const h = naam(context.lookup(dict.get(N('H'))));
  const quads = getallen(context, dict.get(N('QuadPoints')));
  return {
    doel: leesLinkDoel(context, pdfDoc, dict),
    rand,
    dikte,
    kleur: kleur && kleur.length >= 3 ? colorArrayToHex(kleur, LINK_STANDAARD_KLEUR) : LINK_STANDAARD_KLEUR,
    markering: ['I', 'N', 'O', 'P'].includes(h) ? h : 'I',
    quads: quads && quads.length >= 8 && quads.length % 8 === 0 ? quads : null,
  };
}
