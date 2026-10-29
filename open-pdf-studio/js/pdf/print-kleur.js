// Kleurmodus van de afdruk (#754): Kleur, Grijswaarden of Zwart-wit.
//
// Elke printweg van de app maakt eerst een beeld van de pagina (print-job.js,
// renderPrintBeeld): de printopdracht naar een printer, "Opslaan als PDF" bij
// een andere modus dan kleur, en het voorbeeld in de printdialoog. Op dat beeld
// zet deze module de pixels om, zodat de printer en het bestand precies krijgen
// wat het voorbeeld toont, ongeacht de driver:
// - Grijswaarden: de luminantie (ITU-R BT.601, 0,299 R + 0,587 G + 0,114 B).
// - Zwart-wit: diezelfde luminantie tegen een drempel, puur zwart of puur wit.
// De doorzichtigheid (alfa) blijft zoals ze is.

/** De kleurmodi, in de volgorde van de keuzelijst in de printdialoog. */
export const KLEUR_MODI = Object.freeze(['color', 'grayscale', 'bw']);

/** De standaard: in kleur afdrukken, zoals vóór deze keuze. */
export const KLEUR_STANDAARD = 'color';

/** Luminantie op of boven de drempel wordt wit bij zwart-wit. */
export const ZWART_WIT_DREMPEL = 128;

/** Een bekende kleurmodus, anders de standaard (kleur). */
export function geldigeKleurModus(modus) {
  return KLEUR_MODI.includes(modus) ? modus : KLEUR_STANDAARD;
}

/** Moeten de pixels omgezet worden? Alleen bij grijswaarden of zwart-wit. */
export function zetKleurOm(modus) {
  return geldigeKleurModus(modus) !== KLEUR_STANDAARD;
}

/** De luminantie (0..255, afgerond) van een RGB-kleur. */
export function luminantie(r, g, b) {
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}

/**
 * Zet RGBA-pixels ter plekke om naar de kleurmodus. `data` is de `data` van
 * een ImageData (Uint8ClampedArray) of een gewone array met vier waarden per
 * pixel. Bij kleur (of een onbekende modus) verandert er niets.
 * @param {Uint8ClampedArray|number[]} data
 * @param {string} modus  'color' | 'grayscale' | 'bw'
 * @param {{ drempel?: number }} [opties]
 * @returns {Uint8ClampedArray|number[]} dezelfde `data`
 */
export function zetPixelsOm(data, modus, { drempel = ZWART_WIT_DREMPEL } = {}) {
  const m = geldigeKleurModus(modus);
  if (m === KLEUR_STANDAARD) return data;
  const zwartWit = m === 'bw';
  for (let i = 0; i + 3 < data.length; i += 4) {
    const y = luminantie(data[i], data[i + 1], data[i + 2]);
    const v = zwartWit ? (y >= drempel ? 255 : 0) : y;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
  }
  return data;
}

/** Hoeveel rijen per keer gelezen worden: een A0 op 300 dpi past niet in één ImageData. */
const BAND_PIXELS = 4_000_000;

/**
 * Zet een canvas ter plekke om naar de kleurmodus, per band van rijen.
 * Bij kleur blijft het canvas onaangeroerd.
 * @param {HTMLCanvasElement|OffscreenCanvas} canvas
 * @param {string} modus
 * @returns het canvas zelf
 */
export function zetCanvasOm(canvas, modus) {
  if (!zetKleurOm(modus) || !canvas || !canvas.width || !canvas.height) return canvas;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const rijen = Math.max(1, Math.floor(BAND_PIXELS / canvas.width));
  for (let y = 0; y < canvas.height; y += rijen) {
    const hoogte = Math.min(rijen, canvas.height - y);
    const beeld = ctx.getImageData(0, y, canvas.width, hoogte);
    zetPixelsOm(beeld.data, modus);
    ctx.putImageData(beeld, 0, y);
  }
  return canvas;
}

/**
 * Het beeldformaat voor een omgezet paginabeeld in de print-PDF: zwart-wit
 * als PNG (JPEG zou de randen weer grijs maken), anders JPEG zoals altijd.
 * @returns {'png'|'jpeg'}
 */
export function beeldFormaatVoor(modus) {
  return geldigeKleurModus(modus) === 'bw' ? 'png' : 'jpeg';
}

/**
 * Kan "Opslaan als PDF" de bronpagina's als vectoren overnemen? Alleen in
 * kleur: de kleuren in de inhoud van de bron (tekst, lijnen, afbeeldingen,
 * kleurruimten) zijn niet betrouwbaar om te zetten, dus bij grijswaarden of
 * zwart-wit gaan de pagina's als (omgezet) beeld het bestand in.
 */
export function vectorMogelijk(modus) {
  return !zetKleurOm(modus);
}
