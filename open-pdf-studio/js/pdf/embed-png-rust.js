// Een PNG insluiten zonder het pixelwerk op de interface-thread.
//
// embedPng() van de PDF-bibliotheek pakt de PNG in JavaScript uit, splitst in
// RGB en alfa en pakt beide bij het opslaan opnieuw in. embedPngSnel() laat
// het commando `png_naar_xobject` (crate open-pdf-image) dat doen en bouwt
// hier alleen de woordenboeken: dezelfde sleutels en waarden als embedPng,
// dezelfde pixels; alleen de gepakte bytes (en dus /Length) verschillen.
//
// Het resultaat is hetzelfde soort object (PDFImage), dus een aanroeper
// verandert verder niet.
//
// Standaard aan, binnen de grenzen van kiesPngRoute() (rust-routes.js;
// `window.__opdsRustPng = false` is JavaScript, `'altijd'` laat de grenzen
// vallen, om te vergelijken).
//
// JavaScript blijft: webversie, mobiel, een oudere backend,
// OPDS_RUST_PNG_EMBED=0, een PNG onder de gemeten grenzen (de oversteek kost
// dan meer dan het werk), een tekenreeks als invoer, zestien bit of geïnterlinieerd, en alles
// wat Rust terugstuurt (transparantietabel, animatie, een PNG die de strenge
// decoder afkeurt). Een fout van de aanroep zelf: één waarschuwing, daarna
// JavaScript voor de rest van de sessie.

import { PDFImage, PDFRawStream, PngEmbedder } from 'pdf-lib';
import { bytesOf, getBeeldRust } from './beeld-rust.js';
import { rustRoute } from './rust-routes.js';

const NONE = 0xffffffff;
/** Vanaf dit aantal pixels wint Rust in de echte app voor elke PNG. */
export const MIN_PIXELS = 1_000_000;
/** Vanaf dit aantal pixels wint Rust voor een PNG met weinig bytes per pixel. */
export const MIN_PIXELS_KLEINE_PNG = 300_000;
/** Hooguit zoveel PNG-bytes per pixel geldt als "weinig" (grijs, palet, vlakke tekening). */
export const MAX_BYTES_PER_PIXEL_KLEINE_PNG = 0.5;
/** Meer bytes per pixel dan dit: de oversteek van de PNG zelf weegt te zwaar. */
export const MAX_BYTES_PER_PIXEL = 64;

/**
 * Rust of JavaScript voor één PNG, naar de meting in de echte app
 * (docs/rust-stappen.md): Rust alleen waar het met de echte oversteek erbij
 * ongeveer 1,3 keer sneller is dan embedPng. De oversteek kost in de app
 * 23-31 ms per MB, niet de 1 ms uit het model van de eerste meting; daarom
 * ligt de grens veel hoger dan de 32.768 pixels die dat model voorspelde.
 *
 *   vanaf 1.000.000 pixels: Rust (foto-achtig, 1,6-2,5 PNG-bytes per pixel:
 *     1,05 MP 2,0x; 4-20 MP 2,4-2,8x)
 *   vanaf 300.000 pixels met hooguit 0,5 PNG-bytes per pixel: Rust (grijs,
 *     palet, vlakke tekening: 0,31 MP 1,8-2,4x; 4-20 MP 4,8-6,8x; onder
 *     0,3 MP niet gemeten)
 *   anders JavaScript (32.768 px: Rust 1,45x trager; 60.000-131.072 px
 *     gelijk; foto-achtig 0,26-0,31 MP 1,05-1,14x; 0,52 MP 1,23x)
 *
 * Geen bovengrens: de winst groeit met de maat. De grens van 64 bytes per
 * pixel is niet gemeten (alleen mogelijk met grote blokken die geen beeld
 * zijn) en blijft als uitsluiting staan.
 * @param {{ pixels: number, pngBytes: number }} png
 * @param {boolean|'altijd'} [keuze] de schakelaar; standaard die van de app
 * @returns {'rust'|'js'}
 */
export function kiesPngRoute({ pixels, pngBytes }, keuze = rustRoute('png')) {
  if (keuze === false) return 'js';
  if (keuze === 'altijd') return 'rust';
  if (pngBytes > pixels * MAX_BYTES_PER_PIXEL) return 'js';
  if (pixels >= MIN_PIXELS) return 'rust';
  return pixels >= MIN_PIXELS_KLEINE_PNG && pngBytes <= pixels * MAX_BYTES_PER_PIXEL_KLEINE_PNG ? 'rust' : 'js';
}

/**
 * Leest het antwoord van `png_naar_xobject` (opmaak: open-pdf-image,
 * png_xobject::response).
 * @returns {null | { width, height, bits, rgb: Uint8Array, alpha: Uint8Array|null }}
 *   null = dit beeld is voor JavaScript
 */
export function parsePngXObjectResponse(value) {
  const bytes = bytesOf(value);
  if (bytes[0] === 0) return null;
  if (bytes[0] !== 1 || bytes.length < 20 || bytes[2] !== 1) throw new TypeError('Unexpected PNG response');
  const view = new DataView(bytes.buffer, bytes.byteOffset, 20);
  const width = view.getUint32(4, true), height = view.getUint32(8, true);
  const rgbLen = view.getUint32(12, true), alphaLen = view.getUint32(16, true);
  const heeftAlfa = bytes[3] === 1;
  if (heeftAlfa !== (alphaLen !== NONE) || !width || !height || !rgbLen
    || bytes.length !== 20 + rgbLen + (heeftAlfa ? alphaLen : 0)) throw new TypeError('Unexpected PNG response');
  return {
    width, height, bits: bytes[1],
    rgb: bytes.subarray(20, 20 + rgbLen),
    alpha: heeftAlfa ? bytes.subarray(20 + rgbLen) : null,
  };
}

// Zelfde woordenboeken, in dezelfde volgorde, als de embedder van de
// bibliotheek; alleen zijn de streams hier al gepakt.
class KlaarPngEmbedder extends PngEmbedder {
  constructor(streams) {
    super({ bitsPerComponent: streams.bits, width: streams.width, height: streams.height });
    this.streams = streams;
  }

  async embedIntoContext(context, ref) {
    const { width, height, bits, rgb, alpha } = this.streams;
    const SMask = alpha
      ? context.register(PDFRawStream.of(context.obj({
        Type: 'XObject', Subtype: 'Image', Height: height, Width: width,
        BitsPerComponent: bits, ColorSpace: 'DeviceGray', Decode: [0, 1], Filter: 'FlateDecode',
      }), alpha))
      : undefined;
    const xObject = PDFRawStream.of(context.obj({
      Type: 'XObject', Subtype: 'Image', BitsPerComponent: bits, Width: width, Height: height,
      ColorSpace: this.colorSpace, SMask, Filter: 'FlateDecode',
    }), rgb);
    if (ref) {
      context.assign(ref, xObject);
      return ref;
    }
    return context.register(xObject);
  }
}

// Breedte × hoogte uit de kop, of 0 als dit geen PNG is die naar Rust mag
// (geen PNG, zestien bit, geïnterlinieerd): dan beslist embedPng zelf.
function pixelsVoorRust(bytes) {
  if (bytes.length < 33 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return 0;
  if (bytes[24] === 16 || bytes[28] !== 0) return 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset + 16, 8);
  return view.getUint32(0) * view.getUint32(4);
}

/**
 * @param {{ native: () => Promise<null | ((png: Uint8Array) => Promise<any>)>, warn?: Function, minPixels?: number }} dep
 *   `native` geeft de aanroep van `png_naar_xobject`, of null als die er niet is;
 *   `minPixels` (tests, meting) is een vaste ondergrens in plaats van kiesPngRoute
 * @returns {(pdfDoc, png) => Promise<PDFImage>}
 */
export function maakEmbedPng({ native, warn = console.warn, minPixels }) {
  let uit = false;
  return async (pdfDoc, png) => {
    const bytes = png instanceof Uint8Array ? png : (png instanceof ArrayBuffer ? new Uint8Array(png) : null);
    const pixels = bytes ? pixelsVoorRust(bytes) : 0;
    const naarRust = minPixels !== undefined ? pixels >= minPixels
      : pixels > 0 && kiesPngRoute({ pixels, pngBytes: bytes.length }) === 'rust';
    if (!uit && naarRust) {
      const roep = await native();
      if (roep) {
        let streams = null;
        try {
          streams = parsePngXObjectResponse(await roep(bytes));
        } catch (e) {
          uit = true;
          warn('[png embed] Rust route failed, using JavaScript:', e);
        }
        if (streams) {
          const ref = pdfDoc.context.nextRef();
          const image = PDFImage.of(ref, pdfDoc, new KlaarPngEmbedder(streams));
          pdfDoc.images.push(image);
          return image;
        }
      }
    }
    return pdfDoc.embedPng(png);
  };
}

const standaard = maakEmbedPng({
  native: async () => {
    const rust = await getBeeldRust();
    return rust.png ? (png) => rust.invoke('png_naar_xobject', png) : null;
  },
});

/**
 * Als `pdfDoc.embedPng(png)`, met het pixelwerk in Rust waar dat kan.
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @param {Uint8Array|ArrayBuffer|string} png
 * @returns {Promise<import('pdf-lib').PDFImage>}
 */
export function embedPngSnel(pdfDoc, png) {
  return standaard(pdfDoc, png);
}
