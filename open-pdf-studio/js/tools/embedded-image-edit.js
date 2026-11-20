// Foto's in de paginainhoud verplaatsen, verkleinen en vervangen.
//
// Bouwt voort op embedded-image-parser.js: elke afbeelding die met `/Naam Do`
// in de content stream staat heeft een plaatsingsmatrix (CTM) en een tekstbereik.
// Een wijziging vervangt dat bereik door `q M cm /Naam Do Q`, waarin M de
// verschuiving en schaling is die de afbeelding naar het nieuwe kader brengt.
// De rest van de pagina blijft ongemoeid. Geen DOM: alleen pdf-lib, dus testbaar
// onder Node.

import { PDFName } from 'pdf-lib';
import { embedPngSnel } from '../pdf/embed-png-rust.js';
import {
  parsePageImages, bboxFromCtm, getInherited,
} from './embedded-image-parser.js';

const IDENTITY = [1, 0, 0, 1, 0, 0];

// Vermenigvuldiging in dezelfde volgorde als de parser: mul(A, B) past B eerst toe.
export function mul(A, B) {
  return [
    A[0] * B[0] + A[2] * B[1],
    A[1] * B[0] + A[3] * B[1],
    A[0] * B[2] + A[2] * B[3],
    A[1] * B[2] + A[3] * B[3],
    A[0] * B[4] + A[2] * B[5] + A[4],
    A[1] * B[4] + A[3] * B[5] + A[5],
  ];
}

export function inverse(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  return [
    m[3] / det, -m[1] / det, -m[2] / det, m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

function fmt(n) {
  const s = Number(n).toFixed(6);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

/**
 * De matrix M die vlak voor `/Naam Do` komt, zodat een afbeelding met
 * plaatsingsmatrix `ctm` van kader `oud` naar kader `nieuw` gaat. De kaders
 * staan in de ruimte van `vt` (de weergavetransformatie PDF-ruimte -> scherm).
 * Een draaiing van de pagina of een y-spiegeling klopt daardoor vanzelf.
 * @returns {number[]|null} null als een kader of matrix onbruikbaar is
 */
export function verplaatsMatrix(ctm, vt, oud, nieuw) {
  if (!oud || !nieuw || !(oud.width > 0) || !(oud.height > 0)) return null;
  if (!(nieuw.width > 0) || !(nieuw.height > 0)) return null;
  const V = vt || IDENTITY;
  const vInv = inverse(V);
  const cInv = inverse(ctm);
  if (!vInv || !cInv) return null;
  const sx = nieuw.width / oud.width;
  const sy = nieuw.height / oud.height;
  const D = [sx, 0, 0, sy, nieuw.x - sx * oud.x, nieuw.y - sy * oud.y];
  // C * M = V^-1 * D * V * C  =>  M = C^-1 * V^-1 * D * V * C
  return mul(cInv, mul(vInv, mul(D, mul(V, ctm))));
}

/** Staat de afbeelding recht op het scherm (geen schuine stand)? Dan mag ze ook geschaald worden. */
export function isRechtOpScherm(ctm, vt) {
  const V = vt || IDENTITY;
  const m = mul(V, ctm);
  const eps = 1e-6 * Math.max(1, Math.abs(m[0]) + Math.abs(m[1]) + Math.abs(m[2]) + Math.abs(m[3]));
  const recht = Math.abs(m[1]) < eps && Math.abs(m[2]) < eps;
  const kwart = Math.abs(m[0]) < eps && Math.abs(m[3]) < eps;
  return recht || kwart;
}

/** Past een afbeelding met `beeldVerhouding` (breedte/hoogte) passend en gecentreerd in `kader`. */
export function passendKader(kader, beeldVerhouding) {
  if (!kader || !(beeldVerhouding > 0)) return kader;
  const kaderVerhouding = kader.width / kader.height;
  let w = kader.width;
  let h = kader.height;
  if (beeldVerhouding > kaderVerhouding) h = w / beeldVerhouding;
  else w = h * beeldVerhouding;
  return { x: kader.x + (kader.width - w) / 2, y: kader.y + (kader.height - h) / 2, width: w, height: h };
}

/**
 * De afbeelding op het scherm is gedraaid over een kwartslag (pagina of plaatsing):
 * dan staan breedte en hoogte van het beeld verwisseld.
 */
export function isKwartslag(ctm, vt) {
  const m = mul(vt || IDENTITY, ctm);
  return Math.abs(m[0]) < 1e-6 * (Math.abs(m[1]) + 1) && Math.abs(m[3]) < 1e-6 * (Math.abs(m[2]) + 1)
    && (Math.abs(m[1]) > 0 || Math.abs(m[2]) > 0);
}

/** Vervang het `/Naam Do`-bereik door `q M cm /Naam Do Q`. */
export function bewerkteInhoud(text, image, M, nieuweNaam = null) {
  const bron = text.slice(image.start, image.end);
  const naam = nieuweNaam || (bron.match(/^\/[^\s/<>()[\]{}%]+/) || [])[0];
  if (!naam) throw new Error('image name not found in content stream');
  const kop = M ? `q ${M.map(fmt).join(' ')} cm ` : 'q ';
  return `${text.slice(0, image.start)}${kop}${naam} Do Q${text.slice(image.end)}`;
}

/** Zet de nieuwe inhoud terug als enige content stream van de pagina. */
function schrijfInhoud(pdfLibDoc, pageNum, nieuweTekst) {
  const context = pdfLibDoc.context;
  const ref = context.register(context.flateStream(nieuweTekst));
  pdfLibDoc.getPage(pageNum - 1).node.set(PDFName.of('Contents'), ref);
}

/**
 * Verplaats of schaal afbeelding `index` naar `nieuwKader` (zelfde ruimte als `vt`).
 * Wijzigt `pdfLibDoc`; opslaan en herladen doet de aanroeper.
 * @returns {boolean} gelukt
 */
export function verplaatsAfbeelding(pdfLibDoc, pageNum, index, vt, nieuwKader) {
  const { text, images } = parsePageImages(pdfLibDoc, pageNum);
  const image = images[index];
  if (!image) return false;
  const oud = bboxFromCtm(image.ctm, vt);
  const M = verplaatsMatrix(image.ctm, vt, oud, nieuwKader);
  if (!M) return false;
  schrijfInhoud(pdfLibDoc, pageNum, bewerkteInhoud(text, image, M));
  return true;
}

// Eigen kopie van Resources en XObject op de pagina, zodat een erfde of gedeeld
// woordenboek van andere pagina's niet wordt aangepast.
function eigenXObjects(pdfLibDoc, pageNum) {
  const context = pdfLibDoc.context;
  const node = pdfLibDoc.getPage(pageNum - 1).node;
  const bron = getInherited(node, 'Resources', context);
  const bronRes = bron ? context.lookup(bron) : null;
  const res = context.obj({});
  if (bronRes && typeof bronRes.entries === 'function') {
    for (const [k, v] of bronRes.entries()) res.set(k, v);
  }
  const xoBron = bronRes ? bronRes.get(PDFName.of('XObject')) : null;
  const xoOud = xoBron ? context.lookup(xoBron) : null;
  const xo = context.obj({});
  if (xoOud && typeof xoOud.entries === 'function') {
    for (const [k, v] of xoOud.entries()) xo.set(k, v);
  }
  res.set(PDFName.of('XObject'), xo);
  node.set(PDFName.of('Resources'), res);
  return xo;
}

function vrijeNaam(xo) {
  let n = 1;
  while (xo.has(PDFName.of(`OpsImg${n}`))) n++;
  return `OpsImg${n}`;
}

/**
 * Vervang afbeelding `index` door een nieuwe (PNG of JPEG), passend en
 * gecentreerd in het oude kader.
 * @param {Uint8Array} bytes
 * @param {'png'|'jpeg'} soort
 */
export async function vervangAfbeelding(pdfLibDoc, pageNum, index, vt, bytes, soort) {
  const { text, images } = parsePageImages(pdfLibDoc, pageNum);
  const image = images[index];
  if (!image) return false;
  const nieuw = soort === 'png' ? await embedPngSnel(pdfLibDoc, bytes) : await pdfLibDoc.embedJpg(bytes);
  const xo = eigenXObjects(pdfLibDoc, pageNum);
  const naam = vrijeNaam(xo);
  xo.set(PDFName.of(naam), nieuw.ref);

  const oud = bboxFromCtm(image.ctm, vt);
  let verhouding = nieuw.width / nieuw.height;
  if (isKwartslag(image.ctm, vt)) verhouding = 1 / verhouding;
  const kader = passendKader(oud, verhouding);
  const M = verplaatsMatrix(image.ctm, vt, oud, kader);
  if (!M) return false;
  schrijfInhoud(pdfLibDoc, pageNum, bewerkteInhoud(text, image, M, `/${naam}`));
  return true;
}
