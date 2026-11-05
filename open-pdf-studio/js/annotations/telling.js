// Tellingen (#621).
//
// - De telmarkering van de app (type 'count'): één genummerde stip op een
//   punt. Zie saver/telling.js voor het opslaan.
// - Een telling van een ander programma: een /Polygon met /IT /PolygonCount;
//   elk hoekpunt is één getelde plek. De app laadt hem als veelhoek met de
//   ruwe sleutels (saver/ruwe-sleutels.js) en tekent hem als stippen op de
//   hoekpunten, niet als gesloten veelhoek: zo tekent dat programma hem ook.
//
// Puur: geen DOM, geen pdf-lib.

/** Straal van een telstip in punten (zoals het scherm de eigen telmarkering tekent). */
export const TELSTIP_STRAAL = 9;

/** Halve maat van het kader van een telmarkering: stip (straal 9) of symbool (22 pt). */
export const TELMARKERING_HALF = 11;

/**
 * Kader van de eigen telmarkering (type 'count'), gecentreerd op (x, y).
 * Het selectiekader van het selecteergereedschap, uitlijnen en de omhullende
 * van een selectie lezen dit; zonder kader viel de markering buiten elk
 * selectiekader (#934).
 * @returns {{x:number, y:number, width:number, height:number} | null}
 */
export function tellingKader(ann) {
  const x = Number(ann?.x), y = Number(ann?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const h = TELMARKERING_HALF;
  return { x: x - h, y: y - h, width: 2 * h, height: 2 * h };
}

/** Is dit een telling van een ander programma (/IT /PolygonCount)? */
export function isVreemdeTelling(ann) {
  return ann?.type === 'polygon' && ann?.pdfRaw?.sleutels?.IT?.n === 'PolygonCount';
}

/**
 * Straal van de stippen van een vreemde telling: /CountScale schaalt de
 * standaardmaat (zonder schaal 1). Begrensd, zodat een vreemde waarde geen
 * vlakvullende stip wordt.
 */
export function tellingStraal(ann) {
  const schaal = Number(ann?.pdfRaw?.sleutels?.CountScale);
  const s = Number.isFinite(schaal) && schaal > 0 ? Math.min(schaal, 10) : 1;
  return 4 * s;
}
