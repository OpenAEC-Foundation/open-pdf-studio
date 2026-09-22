/**
 * Plek van een zoekmarkering in de tekstlaag.
 *
 * Alle tekstlaagbouwers (PDF.js-laag op een enkele pagina, PDF.js TextLayer in
 * Doorlopend, Rust-spans in vectormodus) leggen hun laag uit in het
 * ONGEDRAAIDE paginakader: oorsprong linksboven van de paginabox (page.view),
 * Y omlaag, gelijkmatig geschaald. Paginarotatie en zoom doet de laag zelf met
 * een CSS-transform. Een markering in procenten van dat kader staat daardoor in
 * elke laag, op elke zoom en ook tijdens de opbouw van de laag goed, zonder de
 * laagschaal (--total-scale-factor) of de laaghoogte te lezen: die kwamen
 * vlak na een (her)opbouw nog van een voorouder of van de container, waardoor
 * markeringen op de verkeerde plek en op de verkeerde maat terechtkwamen.
 *
 * Omrekening zoals pdf.js' TextLayer: [1, 0, 0, -1, -x0, y1] × item.transform
 * (neemt de oorsprong van de paginabox mee), met de tekstrichting uit de
 * matrix zodat ook gedraaide tekst een passende markering krijgt.
 */

// Ascent als fractie van de letterhoogte; dezelfde conventie als de spans die
// de vectormodus-tekstlaag bouwt.
const ASCENT = 0.8;
// Minimale markeringsbreedte in punten (lege of piepkleine runs).
const MIN_BREEDTE = 2;

/**
 * Fracties [begin, eind] van de voortgang langs de basislijn voor tekens
 * start..end van `str`. Met `measure(tekst) → breedte` (bv. canvas
 * measureText in het lettertype van het item) volgt de verhouding de echte
 * tekenbreedtes; zonder meter is het het aandeel tekens.
 */
export function matchFractions(str, start, end, measure) {
  const len = str.length || 1;
  if (typeof measure === 'function') {
    const totaal = measure(str);
    if (totaal > 0) {
      return [measure(str.slice(0, start)) / totaal, measure(str.slice(0, end)) / totaal];
    }
  }
  return [start / len, end / len];
}

/**
 * Rechthoek van (een deel van) een tekstitem in het ongedraaide paginakader,
 * in punten: linkerbovenhoek (x, y), breedte langs de tekst, hoogte, en de
 * draaihoek van de tekst in radialen (0 = gewone horizontale tekst).
 * `view` = [x0, y0, x1, y1] van de pagina (pdf.js page.view).
 * Geeft null als er geen bruikbare geometrie is.
 */
export function matchBoxInPageFrame(transform, width, height, fracStart, fracEnd, view) {
  if (!Array.isArray(transform) || transform.length < 6) return null;
  if (!Array.isArray(view) || view.length < 4) return null;
  const [x0, y0, x1, y1] = view.map(Number);
  if (!(x1 - x0 > 0) || !(y1 - y0 > 0)) return null;
  const [a, b, c, d, e, f] = transform.map(Number);
  // [1, 0, 0, -1, -x0, y1] × transform
  const tx = [a, -b, c, -d, e - x0, y1 - f];
  const hoek = Math.atan2(tx[1], tx[0]);
  const hoogte = Math.hypot(tx[2], tx[3]) || Number(height) || 10;
  const breedte = Number(width) || 0;
  const cos = Math.cos(hoek);
  const sin = Math.sin(hoek);
  const vanaf = breedte * fracStart;
  const tot = breedte * fracEnd;
  const asc = hoogte * ASCENT;
  return {
    x: tx[4] + vanaf * cos + asc * sin,
    y: tx[5] + vanaf * sin - asc * cos,
    w: Math.max(tot - vanaf, MIN_BREEDTE),
    h: hoogte,
    angle: Math.abs(hoek) < 1e-9 ? 0 : hoek,
  };
}

/**
 * Zet een rechthoek uit matchBoxInPageFrame om naar CSS-procenten van de
 * tekstlaag (left/width t.o.v. de paginabreedte, top/height t.o.v. de
 * paginahoogte).
 */
export function boxToLayerPercent(box, view) {
  const [x0, y0, x1, y1] = view.map(Number);
  const W = x1 - x0;
  const H = y1 - y0;
  return {
    left: (100 * box.x) / W,
    top: (100 * box.y) / H,
    width: (100 * box.w) / W,
    height: (100 * box.h) / H,
    angle: box.angle,
  };
}
