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
// Deze stap staat los, zodat de volgorde te testen is zonder PDF.js.

/**
 * @param {object} o
 * @param {() => void} [o.verbergLaadscherm]
 */
export function paginaGetekend({ verbergLaadscherm } = {}) {
  verbergLaadscherm?.();
}
