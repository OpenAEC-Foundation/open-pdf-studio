// Beleid: wanneer slaan we het uitlezen van PDF-vectorgeometrie (snap-punten
// en -randen) voor een pagina over?
//
// Het uitlezen loopt via PDF.js `page.getOperatorList()`. Voor een pagina die
// alleen een grote rasterafbeelding bevat (gescande tekening, 100+ megapixel)
// decodeert PDF.js daarvoor de volledige JPEG in JavaScript: 2 tot 6 s per
// pagina in de PDF.js-worker, terwijl er niets te snappen valt. Bovendien
// staan tekstlaag, annotaties en bladwijzers dan in de rij achter die decode.
//
// De regel is bewust smal: alleen een pagina die als rasterblad ('tile') is
// geclassificeerd ÉN een vrijwel lege content-stream heeft (één
// afbeeldingsplaatsing is ~50 bytes gecomprimeerd) wordt overgeslagen.
// Gemengde bladen (onderlegger + lijnwerk) hebben een grotere content-stream
// en worden gewoon uitgelezen; bij onbekende grootte (webversie, fout) geldt
// het oude gedrag.

/** Onder deze gecomprimeerde content-stream-grootte (bytes) bevat een
 *  rasterblad geen vectorgeometrie van betekenis. */
export const SNAP_MIN_CONTENT_BYTES = 200;

/**
 * @param {{ pageType: string|null|undefined, contentBytes: number|null|undefined }} o
 *   pageType: 'vector' | 'tile' | null (onbekend); contentBytes: gecomprimeerde
 *   content-stream-grootte, 0/null bij onbekend.
 * @returns {boolean} true = extractie overslaan (lege snap-set cachen).
 */
export function slaSnapExtractieOver({ pageType, contentBytes }) {
  if (pageType !== 'tile') return false;
  if (!(Number(contentBytes) > 0)) return false;
  return Number(contentBytes) < SNAP_MIN_CONTENT_BYTES;
}
