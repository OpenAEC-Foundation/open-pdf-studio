// Wat er moet gebeuren zodra de PAGINA zelf op het canvas staat — nog vóór de
// tekst-, link- en formulierlaag en vóór de annotaties.
//
// renderPage() deed dat allemaal pas aan het eind. Op het bureaublad valt dat
// niet op, maar in de webversie doet PDF.js ook de miniaturen, en staat de
// tekstlaag van pagina 1 achter veertien miniaturen in de rij. Gemeten op een
// gewone PDF van 14 pagina's in een verse browser: de pagina staat er na een
// seconde, renderPage() is pas na ruim een minuut klaar. Al die tijd bleef
// "Loading PDF…" in beeld staan over een pagina die er gewoon al was (#456).
//
// Dezelfde vertraging trof de overlay-canvassen (#annotation-canvas en
// #text-highlight-canvas). Die werden ook pas aan het eind op maat gezet, dus
// bleven ze in de webversie op hun 300×150-standaard staan terwijl de pagina
// al zichtbaar was. Alles wat de gebruiker in dat gat tekent of markeert
// landt op de verkeerde plek: een canvas van 300×150 onder een pagina van
// 1377×1782 schaalt elke coördinaat mee.
//
// Deze stap staat los, zodat de volgorde te testen is zonder PDF.js.

import { pasOverlayMaatToe } from './overlay-canvas-size.js';

/**
 * @param {object} o
 * @param {Array<object|null>} [o.overlayCanvassen] #annotation-canvas en
 *   #text-highlight-canvas
 * @param {ReturnType<import('./overlay-canvas-size.js').bepaalOverlayMaat>} [o.overlayMaat]
 * @param {() => void} [o.verbergLaadscherm]
 * @returns {boolean} true als een canvas van maat veranderde
 */
export function paginaGetekend({ overlayCanvassen, overlayMaat, verbergLaadscherm } = {}) {
  let gewijzigd = false;
  for (const canvas of overlayCanvassen || []) {
    if (pasOverlayMaatToe(canvas, overlayMaat)) gewijzigd = true;
  }
  verbergLaadscherm?.();
  return gewijzigd;
}
