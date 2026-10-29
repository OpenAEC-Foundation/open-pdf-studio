// Afbeeldingsbron voor stempels en afbeeldingsannotaties (#749, #352).
//
// Een gekozen afbeeldingsbestand wordt een data:-URL met het juiste mimetype,
// en altijd PNG of JPEG: pdf-lib kan alleen die twee in een appearance
// insluiten. Een GIF, BMP, WebP of SVG ging anders als 'PNG' naar embedPng,
// dat faalde; het stempel kwam zonder appearance in het bestand en was na
// heropenen weg. Zonder mimetype laadde een SVG bovendien helemaal niet (een
// blob zonder type), zodat het stempel nooit op de tekening verscheen.
//
// Het herkennen en kiezen is puur (getest in afbeelding-bron.test.mjs); alleen
// het omzetten naar PNG vraagt een canvas en gebeurt in de browser.

export const MIME_BY_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml',
};

/** De extensies die de bestandskeuze voor een afbeelding aanbiedt. */
export const AFBEELDING_EXTENSIES = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'];

/** Mimetype bij een bestandspad, aan de extensie; null als die onbekend is. */
export function mimeVoorPad(pad) {
  const ext = String(pad || '').split(/[\\/]/).pop().split('.').pop().toLowerCase();
  return MIME_BY_EXT[ext] || null;
}

/**
 * Het beeldformaat aan de eerste bytes: 'png', 'jpeg', 'gif', 'bmp', 'webp',
 * 'svg' of null.
 * @param {Uint8Array} bytes
 */
export function beeldSoort(bytes) {
  if (!bytes || bytes.length < 4) return null;
  const b = bytes;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'gif';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'bmp';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  // SVG is tekst: na een eventuele BOM en witruimte begint het met '<'
  // (<?xml, <!-- of <svg) en bevat het een <svg-element.
  const kop = new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(0, Math.min(b.length, 2048)));
  if (/^﻿?\s*</.test(kop) && /<svg[\s>]/i.test(kop)) return 'svg';
  return null;
}

const MIME_BY_SOORT = {
  png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp',
  webp: 'image/webp', svg: 'image/svg+xml',
};

/** Mimetype van de bytes, met het pad als terugval. */
export function mimeVoorBytes(bytes, pad) {
  return MIME_BY_SOORT[beeldSoort(bytes)] || mimeVoorPad(pad) || 'image/png';
}

/** Kan pdf-lib dit formaat rechtstreeks insluiten? */
export function kanPdfInsluiten(soort) {
  return soort === 'png' || soort === 'jpeg';
}

/** De bytes uit een data:-URL (base64 of procent-gecodeerd). */
export function bytesUitDataUrl(dataUrl) {
  const s = String(dataUrl);
  const komma = s.indexOf(',');
  const kop = s.slice(0, komma);
  const inhoud = s.slice(komma + 1);
  if (/;base64$/i.test(kop)) return Uint8Array.from(atob(inhoud), (c) => c.charCodeAt(0));
  return new TextEncoder().encode(decodeURIComponent(inhoud));
}

/**
 * Bytes van ann.imageData om in te sluiten: altijd PNG of JPEG. Een
 * blob:-URL (oude sessiestaat) wordt gelezen; een ander formaat gaat door
 * `naarPng` (standaard: via een canvas in de browser).
 * @param {string} bron  data:- of blob:-URL
 * @param {{ naarPng?: (bytes: Uint8Array, mime: string) => Promise<Uint8Array> }} [opties]
 * @returns {Promise<{ bytes: Uint8Array, isJpeg: boolean }>}
 */
export async function insluitBytes(bron, { naarPng = rasterNaarPngBytes } = {}) {
  let bytes;
  if (String(bron).startsWith('blob:')) {
    bytes = new Uint8Array(await (await fetch(bron)).arrayBuffer());
  } else {
    bytes = bytesUitDataUrl(bron);
  }
  const soort = beeldSoort(bytes);
  if (kanPdfInsluiten(soort)) return { bytes, isJpeg: soort === 'jpeg' };
  const png = await naarPng(bytes, MIME_BY_SOORT[soort] || 'image/png');
  if (beeldSoort(png) !== 'png') throw new Error(`image format ${soort || 'unknown'} cannot be embedded`);
  return { bytes: png, isJpeg: false };
}

/** Bytes als data:-URL met het gegeven mimetype. */
export function dataUrlVan(bytes, mime) {
  let bin = '';
  const stap = 0x8000;
  for (let i = 0; i < bytes.length; i += stap) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + stap));
  }
  return `data:${mime};base64,${btoa(bin)}`;
}

/**
 * Pixelmaat om een geladen afbeelding naar PNG te rasteren. Een SVG zonder
 * eigen maat krijgt 300 × 150 (zoals de browser); een vector wordt op ten
 * minste 1024 pixels langste zijde gerasterd, zodat een vergroot stempel
 * scherp blijft.
 */
export function rasterMaat(breedte, hoogte, { vector = false } = {}) {
  let b = breedte > 0 ? breedte : 300;
  let h = hoogte > 0 ? hoogte : 150;
  if (vector) {
    const f = 1024 / Math.max(b, h);
    if (f > 1) { b *= f; h *= f; }
  }
  return { b: Math.max(1, Math.round(b)), h: Math.max(1, Math.round(h)) };
}

function laadImg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image could not be decoded'));
    img.src = src;
  });
}

/** Een geladen afbeelding als PNG-data-URL (browser: canvas). */
function imgNaarPngDataUrl(img, vector) {
  const { b, h } = rasterMaat(img.naturalWidth, img.naturalHeight, { vector });
  const canvas = document.createElement('canvas');
  canvas.width = b;
  canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, b, h);
  return canvas.toDataURL('image/png');
}

async function rasterNaarPngBytes(bytes, mime) {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    throw new Error('no canvas to convert the image');
  }
  const img = await laadImg(dataUrlVan(bytes, mime));
  return bytesUitDataUrl(imgNaarPngDataUrl(img, mime === 'image/svg+xml'));
}

/**
 * Bytes van een gekozen afbeeldingsbestand → geladen afbeelding + data:-URL
 * (PNG of JPEG) voor ann.imageData. De bitmap komt uit de data:-URL en blijft
 * eraan gekoppeld: een ingetrokken blob:-URL liet in WebKit alleen het kader
 * staan (#711).
 * @param {Uint8Array} bytes
 * @param {string} [pad]  bestandsnaam, voor het mimetype als de bytes het niet zeggen
 * @returns {Promise<{ img: HTMLImageElement, dataUrl: string }>}
 */
export async function laadAfbeeldingBytes(bytes, pad) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const mime = mimeVoorBytes(data, pad);
  const bron = dataUrlVan(data, mime);
  const img = await laadImg(bron);
  if (kanPdfInsluiten(beeldSoort(data))) return { img, dataUrl: bron };
  const dataUrl = imgNaarPngDataUrl(img, mime === 'image/svg+xml');
  return { img: await laadImg(dataUrl), dataUrl };
}
