// Uitsnede van het annotatiecanvas in de doorlopende weergave (ook boek en
// naast elkaar).
//
// Elke pagina heeft een eigen annotatiecanvas dat alleen het ZICHTBARE deel
// van de pagina dekt, plus een marge. Het canvas is ook het doel van de
// muisinvoer van de tekengereedschappen: buiten de uitsnede valt een klik op
// de tekstlaag en tekent er niets. De uitsnede moet dus na elke scroll mee.
//
// In de weergave naast elkaar (#506) gebeurde dat niet: de scrollafhandeling
// stopte daar meteen, omdat de huidige pagina daar het spread-anker is en
// niet mag meelopen met het scrollen. Daarmee bleef ook de uitsnede staan.
// Was de spread groter dan het venster en scrolde de gebruiker naar een ander
// deel van een pagina, dan landde een getekende rechthoek daar niet (de klik
// ging naar de tekstlaag) of werd hij buiten de oude uitsnede afgeknipt.

/** Marge (CSS-px) rond het zichtbare deel van de pagina. */
export const UITSNEDE_MARGE_PX = 256;

/**
 * De uitsnede van een pagina in CSS-px, relatief aan de linkerbovenhoek van
 * de pagina.
 *
 * @param {{left:number, top:number, right:number, bottom:number}} venster
 *   rechthoek van de scrollcontainer (getBoundingClientRect)
 * @param {{left:number, top:number, width:number, height:number}} pagina
 *   rechthoek van de paginacontainer (getBoundingClientRect)
 * @param {number} breedte  doelbreedte van de pagina in CSS-px
 * @param {number} hoogte   doelhoogte van de pagina in CSS-px
 * @param {number} [marge]
 * @returns {{x:number, y:number, breedte:number, hoogte:number}}
 */
export function annotatieUitsnede(venster, pagina, breedte, hoogte, marge = UITSNEDE_MARGE_PX) {
  const heel = { x: 0, y: 0, breedte, hoogte };
  if (!venster || !pagina || !(pagina.width > 1) || !(pagina.height > 1)) return heel;
  // Verhouding huidige rechthoek <-> doelmaat (de pagina kan net geresized zijn).
  const fx = breedte / pagina.width;
  const fy = hoogte / pagina.height;
  const links = Math.max(0, (venster.left - pagina.left) * fx - marge);
  const boven = Math.max(0, (venster.top - pagina.top) * fy - marge);
  const rechts = Math.min(breedte, (venster.right - pagina.left) * fx + marge);
  const onder = Math.min(hoogte, (venster.bottom - pagina.top) * fy + marge);
  if (rechts > links && onder > boven) {
    return { x: links, y: boven, breedte: rechts - links, hoogte: onder - boven };
  }
  // Pagina (nog) niet in beeld: minimaal canvas linksboven.
  return { x: 0, y: 0, breedte: Math.min(breedte, 2), hoogte: Math.min(hoogte, 2) };
}

/**
 * Wat er na het scrollen moet gebeuren. De uitsnedes lopen in elke
 * doorlopende variant mee; de huidige pagina volgt het scrollen niet in de
 * weergave naast elkaar, want daar is hij het anker van de getoonde spread
 * (vorige/volgende bladert per spread).
 * @param {{viewMode?: string, facingSpread?: boolean} | null | undefined} doc
 * @returns {{paginaVolgen: boolean, uitsnedesBijwerken: boolean}}
 */
export function naScrollen(doc) {
  if (!doc || doc.viewMode !== 'continuous') return { paginaVolgen: false, uitsnedesBijwerken: false };
  return { paginaVolgen: !doc.facingSpread, uitsnedesBijwerken: true };
}
