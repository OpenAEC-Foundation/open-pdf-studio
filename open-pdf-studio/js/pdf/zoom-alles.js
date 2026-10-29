// "Zoom alles" na een dubbelklik met de middelste muisknop (issue #767).
//
// Enkele pagina: precies "Passend op pagina". Doorlopende weergave: de pagina
// die nu in beeld is wordt passend gemaakt én blijft de referentie — de
// weergave springt niet naar pagina 1 en ook niet naar de bovenrand van de
// pagina, maar centreert die pagina in het venster.
//
// Alle DOM- en renderer-afhankelijkheden worden meegegeven (zie renderer.js,
// zoomAlles()), zodat de volgorde los te testen is.

/**
 * Scroll-correctie die het midden van `pagina` op het midden van `venster`
 * legt. Beide zijn client-rects ({left, top, width, height}).
 * @returns {{dx: number, dy: number}} op te tellen bij scrollLeft/scrollTop
 */
export function centreerCorrectie(pagina, venster) {
  if (!pagina || !venster) return { dx: 0, dy: 0 };
  return {
    dx: (pagina.left + pagina.width / 2) - (venster.left + venster.width / 2),
    dy: (pagina.top + pagina.height / 2) - (venster.top + venster.height / 2),
  };
}

/**
 * @param {object} d
 * @param {() => string} d.weergaveModus     doc.viewMode
 * @param {() => boolean} [d.boekweergave]   facing-spread: één spread, niet scrollend
 * @param {() => number|null} d.referentiePagina pagina die nu het midden van het venster vult
 * @param {(p: number) => void} d.zetHuidigePagina
 * @param {() => Promise<void>|void} d.passendOpPagina  bestaande Fit page
 * @param {(p: number) => void} d.centreerPagina
 */
export async function voerZoomAllesUit(d) {
  const doorlopend = d.weergaveModus() === 'continuous' && !(d.boekweergave && d.boekweergave());
  if (!doorlopend) {
    await d.passendOpPagina();
    return;
  }
  // Fit page rekent met de maat van doc.currentPage. Die volgt het scrollen
  // met vertraging; daarom eerst de pagina in het midden vastleggen.
  const ref = d.referentiePagina();
  if (ref) d.zetHuidigePagina(ref);
  await d.passendOpPagina();
  if (ref) {
    d.centreerPagina(ref);
    // Het centreren scrollt; de scroll-synchronisatie kiest daarna dezelfde
    // pagina, maar zet hem ook hier zodat statusbalk en miniaturen meteen kloppen.
    d.zetHuidigePagina(ref);
  }
}
