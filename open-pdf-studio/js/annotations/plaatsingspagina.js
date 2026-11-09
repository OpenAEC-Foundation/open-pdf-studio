// Op welke pagina komt iets dat na een klik pas via een venster geplaatst
// wordt (handtekening, stempelkeuze, eigen stempelafbeelding, stempel met
// velden)? Op de pagina waarop geklikt is (#1006). In de weergave met twee
// pagina's naast elkaar wijst doc.currentPage naar de linkerpagina van het
// paar, en tussen de klik en het sluiten van het venster kan de huidige
// pagina verschuiven; de aangeklikte pagina reist daarom mee met het venster.
// Zonder klik (opdracht uit het lint) blijft de huidige pagina gelden.
//
// Puur: geen DOM.

/**
 * @param {number|string|null|undefined} klikPagina  de aangeklikte pagina (1-based), of niets
 * @param {{currentPage?: number, pdfDoc?: {numPages?: number}}|null|undefined} doc
 * @returns {number} de pagina voor de nieuwe markering
 */
export function plaatsingsPagina(klikPagina, doc) {
  const n = Number(klikPagina);
  const aantal = Number(doc?.pdfDoc?.numPages);
  const binnenDocument = !(Number.isFinite(aantal) && aantal >= 1) || n <= aantal;
  if (Number.isInteger(n) && n >= 1 && binnenDocument) return n;
  return doc?.currentPage || 1;
}
