// Pure hulpfuncties voor de documentinfo in het eigenschappen-paneel
// (sectie "Document": Pagina's / Paginaformaat).
//
// populateDocInfo() is async (getPage/getMetadata) en wordt vanuit meerdere
// plekken aangeroepen: deselecteren, tabwissel, en het reactieve effect in
// DocInfoView dat meeloopt met het laden van een document en met
// scroll-gestuurde paginawissels in de doorlopende weergave. Overlappende
// aanroepen mogen elkaar niet met verouderde waarden overschrijven; daarvoor
// dient createLatestOnly().

/** Waarde die het paneel toont als een gegeven (nog) niet bekend is. */
export const DOC_INFO_EMPTY = '-';

const PT_PER_INCH = 72;
const MM_PER_INCH = 25.4;

/**
 * "huidige / totaal", bijv. "3 / 28". Zonder geldig paginatotaal: '-'.
 * Een ongeldige of buiten het bereik vallende huidige pagina wordt begrensd.
 */
export function formatDocPages(currentPage, numPages) {
  if (!Number.isInteger(numPages) || numPages < 1) return DOC_INFO_EMPTY;
  const cur = Number.isInteger(currentPage)
    ? Math.min(Math.max(currentPage, 1), numPages)
    : 1;
  return `${cur} / ${numPages}`;
}

/**
 * Paginaformaat in millimeters met één decimaal, bijv. "210.0 x 297.0 mm".
 * Invoer in PDF-punten (1/72 inch). Ongeldige afmetingen: '-'.
 */
export function formatPageSizeMm(widthPt, heightPt) {
  const ok = (v) => Number.isFinite(v) && v > 0;
  if (!ok(widthPt) || !ok(heightPt)) return DOC_INFO_EMPTY;
  const toMm = (pt) => (pt / PT_PER_INCH * MM_PER_INCH).toFixed(1);
  return `${toMm(widthPt)} x ${toMm(heightPt)} mm`;
}

/**
 * Volgnummer-bewaker voor overlappende async verversingen: alleen de laatst
 * gestarte aanroep (begin()) is nog "actueel" en mag wegschrijven.
 */
export function createLatestOnly() {
  let generation = 0;
  return {
    begin() {
      generation += 1;
      return generation;
    },
    isCurrent(token) {
      return token === generation;
    },
  };
}

/**
 * Leest precies de velden van het actieve document waar de paginagegevens
 * van afhangen. Binnen een Solid-effect maakt juist dit lezen ze tot
 * afhankelijkheden (state is een createMutable-store).
 */
export function readDocInfoDeps(doc) {
  if (!doc) return [null, null, null, null];
  const pdfDoc = doc.pdfDoc ?? null;
  return [doc.filePath ?? null, pdfDoc, pdfDoc?.numPages ?? null, doc.currentPage ?? null];
}
