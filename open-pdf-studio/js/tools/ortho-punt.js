// Een punt recht houden ten opzichte van een eerste punt (#1090): met Shift
// ligt een getekende referentielijn precies horizontaal of verticaal, langs
// de as waarin de cursor het verst van het eerste punt staat. Puur, zodat
// het los te testen is.

/**
 * @param {{x:number, y:number}} p1  het eerste punt
 * @param {{x:number, y:number}} p   de cursor
 * @param {boolean} recht            Shift ingedrukt?
 * @returns {{x:number, y:number}}
 */
export function orthoPunt(p1, p, recht) {
  if (!recht || !p1) return { x: p.x, y: p.y };
  return Math.abs(p.x - p1.x) >= Math.abs(p.y - p1.y)
    ? { x: p.x, y: p1.y }
    : { x: p1.x, y: p.y };
}
