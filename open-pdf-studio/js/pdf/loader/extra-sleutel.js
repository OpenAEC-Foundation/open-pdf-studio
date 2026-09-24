// De extra annotatiegegevens die pdf-lib uitleest (extractAnnotationColors)
// zijn gesleuteld op de RAUWE /Rect uit het bestand. De lezer levert een
// genormaliseerde /Rect, en soms een iets opgerekte. Deze zoekroutine legt de
// twee bij elkaar.

const sleutel = (r) => `${r[0]},${r[1]},${r[2]},${r[3]}`;

/**
 * De extra gegevens van een annotatie zoals pdf.js haar levert: eerst op
 * objectverwijzing (plugin-annotaties, #467 — daar is de /Rect niet uniek),
 * anders op de /Rect.
 */
export function extraVoorAnnotatie(annotColorMap, annot) {
  return (annot?.id && annotColorMap?.get(`@ref:${annot.id}`)) || zoekExtraKleuren(annotColorMap, annot?.rect);
}

export function zoekExtraKleuren(annotColorMap, rect) {
  if (!annotColorMap || !rect || rect.length < 4) return undefined;
  const exact = annotColorMap.get(sleutel(rect));
  if (exact) return exact;

  // Omgekeerde hoeken: tekenpakketten schrijven /Rect ook wel als
  // [rechts onder links boven]. De lezer draait die om, dus zoek ook op de
  // gespiegelde varianten — anders missen zulke annotaties al hun extra
  // gegevens.
  const [x1, y1, x2, y2] = rect;
  for (const gespiegeld of [[x2, y1, x1, y2], [x1, y2, x2, y1], [x2, y2, x1, y1]]) {
    const treffer = annotColorMap.get(sleutel(gespiegeld));
    if (treffer) return treffer;
  }

  // Vage match: de lezer rekt /Rect soms met de lijndikte op (tot enkele
  // punten) bij annotaties zonder appearance.
  let beste;
  let besteAfstand = Infinity;
  for (const [k, v] of annotColorMap.entries()) {
    const delen = k.split(',').map(Number);
    if (delen.length !== 4) continue;
    const d = Math.abs(delen[0] - x1) + Math.abs(delen[1] - y1)
      + Math.abs(delen[2] - x2) + Math.abs(delen[3] - y2);
    if (d < besteAfstand && d < 8) {
      besteAfstand = d;
      beste = v;
    }
  }
  return beste;
}
