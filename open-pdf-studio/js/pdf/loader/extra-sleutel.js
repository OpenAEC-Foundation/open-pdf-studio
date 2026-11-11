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
  // punten) bij annotaties zonder appearance. Ook gewoon nodig als het
  // laatste cijfer verschilt: de saver schrijft 160.64000000000001, pdf.js
  // leest dat als 160.64 (bij een zware set ruim een derde van de annotaties).
  const gevonden = vageSleutel(annotColorMap, x1, y1, x2, y2);
  return gevonden === undefined ? undefined : annotColorMap.get(gevonden);
}

// Index per kaart voor de vage match. Voorheen liep elke misser alle
// sleutels af (met een split per sleutel), en dat per aanroep: kwadratisch in
// het aantal annotaties van een blad, de grootste post bij het laden van een
// zware set. Zelfde uitkomst: de kleinste afstand onder 8, bij gelijke
// afstand de eerste in de volgorde van de kaart.
const VAK = 8;
const _vageIndex = new WeakMap();

function vageIndexVan(kaart) {
  let idx = _vageIndex.get(kaart);
  if (idx && idx.grootte === kaart.size) return idx;
  const vakken = new Map(); // floor(x0 / 8) -> [[volgnummer, x0, y0, x1, y1, sleutel], …]
  let i = 0;
  for (const k of kaart.keys()) {
    const delen = k.split(',').map(Number);
    if (delen.length !== 4) { i++; continue; }
    const vak = Math.floor(delen[0] / VAK);
    // Geen eindig getal: kan nooit binnen 8 liggen (NaN-afstand).
    if (Number.isFinite(vak)) {
      if (!vakken.has(vak)) vakken.set(vak, []);
      vakken.get(vak).push([i, delen[0], delen[1], delen[2], delen[3], k]);
    }
    i++;
  }
  idx = { grootte: kaart.size, vakken, onthouden: new Map() };
  _vageIndex.set(kaart, idx);
  return idx;
}

function vageSleutel(kaart, x1, y1, x2, y2) {
  const idx = vageIndexVan(kaart);
  const vraag = `${x1},${y1},${x2},${y2}`;
  if (idx.onthouden.has(vraag)) return idx.onthouden.get(vraag);
  let beste;
  let besteAfstand = Infinity;
  let besteVolg = Infinity;
  // |x0 - x1| < 8 is nodig voor een afstand onder 8.
  const van = Math.floor((x1 - VAK) / VAK);
  const tot = Math.floor((x1 + VAK) / VAK);
  if (Number.isFinite(van) && Number.isFinite(tot)) {
    for (let v = van; v <= tot; v++) {
      const lijst = idx.vakken.get(v);
      if (!lijst) continue;
      for (const [volg, a, b, c, d, k] of lijst) {
        const afstand = Math.abs(a - x1) + Math.abs(b - y1) + Math.abs(c - x2) + Math.abs(d - y2);
        if (afstand < 8 && (afstand < besteAfstand || (afstand === besteAfstand && volg < besteVolg))) {
          besteAfstand = afstand;
          besteVolg = volg;
          beste = k;
        }
      }
    }
  }
  idx.onthouden.set(vraag, beste);
  return beste;
}
