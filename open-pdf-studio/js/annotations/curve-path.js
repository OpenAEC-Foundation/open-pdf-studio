// Paden met krommen (#1169): een polylijn of veelhoek waarvan een segment
// tussen twee knopen recht is of een kubische Bezier-kromme.
//
// Het model
// ---------
// `points` blijft wat het was: de knopen, als [{x, y}, ...]. Daarnaast staat
// (alleen als er minstens een kromme is) `curves`: een lijst met een plek per
// segment. Segment i loopt van knoop i naar knoop i + 1; bij een gesloten pad
// loopt het laatste segment van de laatste knoop terug naar de eerste.
//
//   curves[i] = null                      → recht segment
//   curves[i] = { c1x, c1y, c2x, c2y }    → kromme; (c1x, c1y) is het eerste
//       stuurpunt TEN OPZICHTE VAN de beginknoop, (c2x, c2y) het tweede TEN
//       OPZICHTE VAN de eindknoop.
//
// Omdat de stuurpunten relatief aan hun knoop staan, schuiven ze vanzelf mee
// als een knoop of het hele pad verschuift: code die alleen `points` kent,
// blijft goed werken. Een pad zonder krommen heeft geen `curves`-veld en is
// dus precies het model van voorheen. Alleen draaien, schalen en spiegelen
// moeten de stuurpunten meenemen (transformCurves), en het invoegen of
// weghalen van een knoop moet de lijst bijwerken (insertNode / deleteNode).
//
// Een knoop is "vloeiend" als zijn twee stuurpunten in elkaars verlengde
// liggen; dat volgt uit de stuurpunten zelf en staat niet apart in het model.
//
// Puur rekenwerk: geen DOM, geen state.

const isGetal = Number.isFinite;

/** Aantal segmenten van een pad met `n` knopen. */
export function segmentCount(n, closed) {
  if (!(n >= 2)) return 0;
  return closed ? n : n - 1;
}

/** Is dit lijstelement een geldige kromme? */
export function isCurve(seg) {
  return !!seg && isGetal(seg.c1x) && isGetal(seg.c1y) && isGetal(seg.c2x) && isGetal(seg.c2y);
}

/** Heeft deze lijst minstens een kromme? */
export function hasCurves(curves) {
  return Array.isArray(curves) && curves.some(isCurve);
}

/** Is segment `i` van deze lijst een kromme? */
export function isCurveSegment(curves, i) {
  return Array.isArray(curves) && isCurve(curves[i]);
}

/**
 * De lijst in vaste vorm: precies `count` plekken, elk null of een schone
 * kromme. Zonder krommen: undefined, zodat het model geen `curves`-veld
 * krijgt en gelijk blijft aan een pad van voorheen.
 */
export function normalizeCurves(curves, count) {
  if (!Array.isArray(curves) || !(count > 0)) return undefined;
  const uit = [];
  let een = false;
  for (let i = 0; i < count; i++) {
    const s = curves[i];
    if (isCurve(s)) {
      uit.push({ c1x: s.c1x, c1y: s.c1y, c2x: s.c2x, c2y: s.c2y });
      een = true;
    } else {
      uit.push(null);
    }
  }
  return een ? uit : undefined;
}

/**
 * Zet `curves` op het model (of haalt het veld weg als er geen kromme meer
 * is). Geeft het model terug.
 */
export function setCurves(ann, curves, closed) {
  const n = Array.isArray(ann?.points) ? ann.points.length : 0;
  const schoon = normalizeCurves(curves, segmentCount(n, closed));
  if (schoon) ann.curves = schoon;
  else delete ann.curves;
  return ann;
}

// ── Een enkele kromme ─────────────────────────────────────────────────────

/**
 * Segment `i` als kubische Bezier met absolute stuurpunten
 * ({ p0, p1, p2, p3 }), of null als het segment recht is of niet bestaat.
 */
export function segmentCubic(points, curves, i, closed) {
  const n = points?.length || 0;
  if (!(i >= 0 && i < segmentCount(n, closed))) return null;
  const s = curves?.[i];
  if (!isCurve(s)) return null;
  const a = points[i];
  const b = points[(i + 1) % n];
  return {
    p0: { x: a.x, y: a.y },
    p1: { x: a.x + s.c1x, y: a.y + s.c1y },
    p2: { x: b.x + s.c2x, y: b.y + s.c2y },
    p3: { x: b.x, y: b.y },
  };
}

/** Het rechte segment `i` als kromme met stuurpunten op een derde. */
export function lineAsCubic(a, b) {
  return {
    p0: { x: a.x, y: a.y },
    p1: { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 },
    p2: { x: b.x + (a.x - b.x) / 3, y: b.y + (a.y - b.y) / 3 },
    p3: { x: b.x, y: b.y },
  };
}

/** De relatieve stuurpunten ({ c1x, c1y, c2x, c2y }) van een kromme. */
export function cubicToCurve(bez) {
  return {
    c1x: bez.p1.x - bez.p0.x, c1y: bez.p1.y - bez.p0.y,
    c2x: bez.p2.x - bez.p3.x, c2y: bez.p2.y - bez.p3.y,
  };
}

/** Het punt op de kromme bij parameter t (0..1). */
export function cubicPoint(bez, t) {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return {
    x: a * bez.p0.x + b * bez.p1.x + c * bez.p2.x + d * bez.p3.x,
    y: a * bez.p0.y + b * bez.p1.y + c * bez.p2.y + d * bez.p3.y,
  };
}

/** De afgeleide (raakvector) bij parameter t. */
export function cubicDerivative(bez, t) {
  const u = 1 - t;
  const a = 3 * u * u, b = 6 * u * t, c = 3 * t * t;
  return {
    x: a * (bez.p1.x - bez.p0.x) + b * (bez.p2.x - bez.p1.x) + c * (bez.p3.x - bez.p2.x),
    y: a * (bez.p1.y - bez.p0.y) + b * (bez.p2.y - bez.p1.y) + c * (bez.p3.y - bez.p2.y),
  };
}

const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/**
 * De kromme bij parameter t in tweeën (de Casteljau). Samen beschrijven de
 * twee delen exact dezelfde kromme.
 */
export function splitCubic(bez, t) {
  const p01 = lerp(bez.p0, bez.p1, t);
  const p12 = lerp(bez.p1, bez.p2, t);
  const p23 = lerp(bez.p2, bez.p3, t);
  const p012 = lerp(p01, p12, t);
  const p123 = lerp(p12, p23, t);
  const m = lerp(p012, p123, t);
  return [
    { p0: { ...bez.p0 }, p1: p01, p2: p012, p3: m },
    { p0: { ...m }, p1: p123, p2: p23, p3: { ...bez.p3 } },
  ];
}

// Afstand van punt p tot de lijn door a en b (tot a als a en b samenvallen).
function afstandTotLijn(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

// Stuurpunten buiten het lijnstuk (voor of voorbij een eindpunt) maken de
// kromme langer dan de koorde zonder dat ze van de lijn afwijken; ook dat
// telt als "niet vlak".
function buitenKoorde(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-24) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  if (t < 0) return -t * Math.sqrt(len2);
  if (t > 1) return (t - 1) * Math.sqrt(len2);
  return 0;
}

function vlakGenoeg(bez, tol) {
  return afstandTotLijn(bez.p1, bez.p0, bez.p3) <= tol
    && afstandTotLijn(bez.p2, bez.p0, bez.p3) <= tol
    && buitenKoorde(bez.p1, bez.p0, bez.p3) <= tol
    && buitenKoorde(bez.p2, bez.p0, bez.p3) <= tol;
}

function vlakMaak(bez, tol, uit, diepte) {
  if (diepte >= 18 || vlakGenoeg(bez, tol)) {
    uit.push({ x: bez.p3.x, y: bez.p3.y });
    return;
  }
  const [l, r] = splitCubic(bez, 0.5);
  vlakMaak(l, tol, uit, diepte + 1);
  vlakMaak(r, tol, uit, diepte + 1);
}

/**
 * De kromme als punten, ZONDER het beginpunt en MET het eindpunt. Geen punt
 * van de veellijn ligt verder dan (ongeveer) `tolerance` van de kromme: de
 * stuurpunten van elk deel liggen binnen die afstand van zijn koorde, en de
 * kromme ligt binnen de omhullende van zijn stuurpunten.
 */
export function flattenCubic(bez, tolerance = 0.25) {
  const uit = [];
  vlakMaak(bez, Math.max(tolerance, 1e-6), uit, 0);
  return uit;
}

/**
 * Het hele pad als punten binnen `tolerance`. Een gesloten pad herhaalt zijn
 * eerste punt niet. Zonder krommen: een kale kopie van de knopen.
 */
export function flattenPath(points, curves, { closed = false, tolerance = 0.25 } = {}) {
  const n = points?.length || 0;
  if (n === 0) return [];
  const uit = [{ x: points[0].x, y: points[0].y }];
  const segs = segmentCount(n, closed);
  for (let i = 0; i < segs; i++) {
    const bez = segmentCubic(points, curves, i, closed);
    const eind = points[(i + 1) % n];
    if (bez) {
      for (const p of flattenCubic(bez, tolerance)) uit.push(p);
    } else {
      uit.push({ x: eind.x, y: eind.y });
    }
  }
  // Gesloten: het laatste punt is de eerste knoop; die staat er al.
  if (closed && uit.length > 1) uit.pop();
  return uit;
}

// Gauss-Legendre met vijf punten op [0, 1].
const GL5 = [
  [0.5, 0.2844444444444444],
  [0.5 - 0.5 * 0.5384693101056831, 0.2393143352496832],
  [0.5 + 0.5 * 0.5384693101056831, 0.2393143352496832],
  [0.5 - 0.5 * 0.9061798459386640, 0.1184634425280945],
  [0.5 + 0.5 * 0.9061798459386640, 0.1184634425280945],
];

function lengteGL(bez, a, b) {
  let som = 0;
  for (const [x, w] of GL5) {
    const d = cubicDerivative(bez, a + (b - a) * x);
    som += w * Math.hypot(d.x, d.y);
  }
  return som * (b - a);
}

function lengteAdaptief(bez, a, b, heel, tol, diepte) {
  const m = (a + b) / 2;
  const links = lengteGL(bez, a, m);
  const rechts = lengteGL(bez, m, b);
  const som = links + rechts;
  if (diepte >= 24 || Math.abs(som - heel) <= tol) return som;
  return lengteAdaptief(bez, a, m, links, tol / 2, diepte + 1)
    + lengteAdaptief(bez, m, b, rechts, tol / 2, diepte + 1);
}

/**
 * De booglengte van een kromme. De fout is kleiner dan `tolerance` (in
 * dezelfde eenheid als de punten; standaard 1e-6): adaptieve Gauss-Legendre
 * die een deel verder halveert zolang de twee helften samen meer dan de
 * tolerantie van het geheel afwijken.
 */
export function cubicLength(bez, tolerance = 1e-6) {
  // Begin met vier delen: een enkele schatting kan bij een kromme met een
  // lus toevallig met zijn twee helften overeenkomen.
  let som = 0;
  const tol = Math.max(tolerance, 1e-12) / 4;
  for (let k = 0; k < 4; k++) {
    const a = k / 4, b = (k + 1) / 4;
    som += lengteAdaptief(bez, a, b, lengteGL(bez, a, b), tol, 0);
  }
  return som;
}

/** De lengte van het hele pad; fout per kromme kleiner dan `tolerance`. */
export function pathLength(points, curves, { closed = false, tolerance = 1e-6 } = {}) {
  const n = points?.length || 0;
  let som = 0;
  const segs = segmentCount(n, closed);
  for (let i = 0; i < segs; i++) {
    const bez = segmentCubic(points, curves, i, closed);
    if (bez) som += cubicLength(bez, tolerance);
    else {
      const a = points[i], b = points[(i + 1) % n];
      som += Math.hypot(b.x - a.x, b.y - a.y);
    }
  }
  return som;
}

// Gauss-Legendre met vier punten op [0, 1]: exact tot en met graad 7. De
// oppervlakte-integrand x·y' − y·x' van een kubische kromme heeft graad 5.
const GL4 = [
  [0.5 - 0.5 * 0.3399810435848563, 0.3260725774312731],
  [0.5 + 0.5 * 0.3399810435848563, 0.3260725774312731],
  [0.5 - 0.5 * 0.8611363115940526, 0.1739274225687269],
  [0.5 + 0.5 * 0.8611363115940526, 0.1739274225687269],
];

/**
 * De oppervlakte MET teken van het gesloten pad (positief als de knopen in
 * het assenstelsel van de punten met de x-as naar de y-as draaien). Exact op
 * afrondingsfouten na: de formule van Green, per kromme geïntegreerd met een
 * kwadratuur die voor deze graad exact is. Geen tolerantie nodig.
 */
export function signedPathArea(points, curves) {
  const n = points?.length || 0;
  if (n < 2) return 0;
  let som = 0;
  for (let i = 0; i < n; i++) {
    const bez = segmentCubic(points, curves, i, true);
    if (bez) {
      for (const [t, w] of GL4) {
        const p = cubicPoint(bez, t);
        const d = cubicDerivative(bez, t);
        som += w * (p.x * d.y - p.y * d.x);
      }
    } else {
      const a = points[i], b = points[(i + 1) % n];
      som += a.x * b.y - b.x * a.y;
    }
  }
  return som / 2;
}

/** De oppervlakte van het gesloten pad (zonder teken). */
export function pathArea(points, curves) {
  return Math.abs(signedPathArea(points, curves));
}

/**
 * Het punt op de kromme dat het dichtst bij (x, y) ligt:
 * { t, x, y, distance }. Grof bemonsteren en daarna het beste interval
 * verfijnen; de parameter klopt tot ongeveer 1e-6.
 */
export function nearestOnCubic(bez, x, y) {
  const N = 32;
  let besteI = 0, besteD = Infinity;
  for (let i = 0; i <= N; i++) {
    const p = cubicPoint(bez, i / N);
    const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
    if (d < besteD) { besteD = d; besteI = i; }
  }
  let a = Math.max(0, (besteI - 1) / N);
  let b = Math.min(1, (besteI + 1) / N);
  const d2 = (t) => { const p = cubicPoint(bez, t); return (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y); };
  // Gulden-snede-zoeken op het interval rond het beste monster.
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a), d = a + g * (b - a);
  let fc = d2(c), fd = d2(d);
  for (let k = 0; k < 40; k++) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = d2(c); }
    else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = d2(d); }
  }
  let t = (a + b) / 2;
  // De eindpunten zelf kunnen dichterbij zijn dan het interval-midden.
  for (const kandidaat of [0, 1]) if (d2(kandidaat) < d2(t)) t = kandidaat;
  const p = cubicPoint(bez, t);
  return { t, x: p.x, y: p.y, distance: Math.hypot(p.x - x, p.y - y) };
}

function nearestOnLine(a, b, x, y) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2)) : 0;
  const px = a.x + t * dx, py = a.y + t * dy;
  return { t, x: px, y: py, distance: Math.hypot(px - x, py - y) };
}

/**
 * Het punt op het pad dat het dichtst bij (x, y) ligt:
 * { segment, t, x, y, distance, curve }, of null bij een pad zonder segment.
 */
export function nearestOnPath(points, curves, x, y, { closed = false } = {}) {
  const n = points?.length || 0;
  const segs = segmentCount(n, closed);
  let beste = null;
  for (let i = 0; i < segs; i++) {
    const bez = segmentCubic(points, curves, i, closed);
    const r = bez ? nearestOnCubic(bez, x, y) : nearestOnLine(points[i], points[(i + 1) % n], x, y);
    if (!beste || r.distance < beste.distance) beste = { segment: i, curve: !!bez, ...r };
  }
  return beste;
}

// Wortels in (0, 1) van a·t² + b·t + c.
function wortels(a, b, c) {
  const uit = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) uit.push(-c / b);
  } else {
    const D = b * b - 4 * a * c;
    if (D >= 0) {
      const s = Math.sqrt(D);
      uit.push((-b + s) / (2 * a), (-b - s) / (2 * a));
    }
  }
  return uit.filter((t) => t > 0 && t < 1);
}

/** De exacte omhullende van een kromme: { minX, minY, maxX, maxY }. */
export function cubicBounds(bez) {
  const ts = [0, 1];
  for (const k of ['x', 'y']) {
    const p0 = bez.p0[k], p1 = bez.p1[k], p2 = bez.p2[k], p3 = bez.p3[k];
    ts.push(...wortels(-p0 + 3 * p1 - 3 * p2 + p3, 2 * (p0 - 2 * p1 + p2), p1 - p0));
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const t of ts) {
    const p = cubicPoint(bez, t);
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** De exacte omhullende van het pad, of null zonder punten. */
export function pathBounds(points, curves, { closed = false } = {}) {
  const n = points?.length || 0;
  if (n === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const neem = (x, y) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  for (const p of points) neem(p.x, p.y);
  const segs = segmentCount(n, closed);
  for (let i = 0; i < segs; i++) {
    const bez = segmentCubic(points, curves, i, closed);
    if (!bez) continue;
    const g = cubicBounds(bez);
    neem(g.minX, g.minY);
    neem(g.maxX, g.maxY);
  }
  return { minX, minY, maxX, maxY };
}

/** Ligt (x, y) binnen het gesloten pad? Even-oneven, op het vlakgemaakte pad. */
export function pointInPath(points, curves, x, y, tolerance = 0.25) {
  const pts = hasCurves(curves) ? flattenPath(points, curves, { closed: true, tolerance }) : points;
  let binnen = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) binnen = !binnen;
  }
  return binnen;
}

// ── Bewerken (puur: geeft nieuwe lijsten terug) ───────────────────────────

function kopie(curves, count) {
  const uit = [];
  for (let i = 0; i < count; i++) {
    const s = curves?.[i];
    uit.push(isCurve(s) ? { c1x: s.c1x, c1y: s.c1y, c2x: s.c2x, c2y: s.c2y } : null);
  }
  return uit;
}

const kaal = (p) => ({ x: p.x, y: p.y });

/**
 * Segment `i` omzetten: naar een kromme (met de stuurpunten op een derde van
 * de koorde, dus eerst nog recht van vorm) of terug naar een recht segment.
 * Geeft de nieuwe `curves` (undefined als er geen kromme meer is), of null
 * bij een onbekend segment.
 */
export function setSegmentCurve(points, curves, i, closed, makeCurve) {
  const n = points?.length || 0;
  const segs = segmentCount(n, closed);
  if (!(i >= 0 && i < segs)) return null;
  const uit = kopie(curves, segs);
  if (makeCurve) {
    if (!uit[i]) uit[i] = cubicToCurve(lineAsCubic(points[i], points[(i + 1) % n]));
  } else {
    uit[i] = null;
  }
  return normalizeCurves(uit, segs);
}

/**
 * Segment `i` buigen: het punt bij parameter `t` verschuift over (dx, dy);
 * de knopen blijven staan. Een recht segment wordt daarbij een kromme. Het
 * punt op de kromme bij `t` volgt de verschuiving exact.
 */
export function bendSegment(points, curves, i, closed, t, dx, dy) {
  const n = points?.length || 0;
  const segs = segmentCount(n, closed);
  if (!(i >= 0 && i < segs)) return null;
  const uit = kopie(curves, segs);
  const s = uit[i] || cubicToCurve(lineAsCubic(points[i], points[(i + 1) % n]));
  // Dicht bij een knoop zou de deling ontploffen: houd t in het midden.
  const tt = Math.max(0.1, Math.min(0.9, t));
  // Verdeel de verschuiving over de twee stuurpunten: dicht bij de beginknoop
  // vooral het eerste, dicht bij de eindknoop vooral het tweede.
  let w;
  if (tt <= 1 / 6) w = 0;
  else if (tt <= 0.5) w = Math.pow((6 * tt - 1) / 2, 3) / 2;
  else if (tt <= 5 / 6) w = (1 - Math.pow((6 * (1 - tt) - 1) / 2, 3)) / 2 + 0.5;
  else w = 1;
  const f1 = (1 - w) / (3 * tt * (1 - tt) * (1 - tt));
  const f2 = w / (3 * tt * tt * (1 - tt));
  uit[i] = {
    c1x: s.c1x + f1 * dx, c1y: s.c1y + f1 * dy,
    c2x: s.c2x + f2 * dx, c2y: s.c2y + f2 * dy,
  };
  return normalizeCurves(uit, segs);
}

/**
 * Een knoop invoegen op segment `i` bij parameter `t` (0..1). Een kromme
 * wordt daar exact in tweeën gedeeld, zodat de vorm gelijk blijft.
 * @returns {{ points, curves, index }} de nieuwe lijsten en de plek van de
 *   nieuwe knoop, of null bij een onbekend segment
 */
export function insertNode(points, curves, i, t, closed) {
  const n = points?.length || 0;
  const segs = segmentCount(n, closed);
  if (!(i >= 0 && i < segs)) return null;
  const tt = Math.max(0, Math.min(1, isGetal(t) ? t : 0.5));
  const lijst = kopie(curves, segs);
  const bez = segmentCubic(points, curves, i, closed);
  const a = points[i], b = points[(i + 1) % n];
  let nieuw, links = null, rechts = null;
  if (bez) {
    const [l, r] = splitCubic(bez, tt);
    nieuw = { x: l.p3.x, y: l.p3.y };
    links = cubicToCurve(l);
    rechts = cubicToCurve(r);
  } else {
    nieuw = { x: a.x + (b.x - a.x) * tt, y: a.y + (b.y - a.y) * tt };
  }
  const pts = points.map((p) => ({ ...p }));
  pts.splice(i + 1, 0, nieuw);
  lijst.splice(i, 1, links, rechts);
  return { points: pts, curves: normalizeCurves(lijst, segmentCount(pts.length, closed)), index: i + 1 };
}

/**
 * Knoop `index` weghalen. De twee segmenten aan weerszijden worden een
 * segment: recht als ze allebei recht waren, anders een kromme die de
 * buitenste stuurpunten houdt (opgerekt naar de nieuwe lengte, zodat een
 * net ingevoegde knoop weghalen de oude kromme teruggeeft).
 * @returns {{ points, curves }} of null als er dan minder dan `min` knopen
 *   overblijven of de knoop niet bestaat
 */
export function deleteNode(points, curves, index, closed, min = closed ? 3 : 2) {
  const n = points?.length || 0;
  if (!(index >= 0 && index < n) || n - 1 < min) return null;
  const segs = segmentCount(n, closed);
  const lijst = kopie(curves, segs);
  const pts = points.map((p) => ({ ...p }));
  pts.splice(index, 1);
  if (!closed && index === 0) {
    lijst.splice(0, 1);
  } else if (!closed && index === n - 1) {
    lijst.splice(segs - 1, 1);
  } else {
    const vi = (index - 1 + segs) % segs;   // segment dat op de knoop uitkomt
    const ni = index % segs;                // segment dat er vertrekt
    const voor = lijst[vi], na = lijst[ni];
    let samen = null;
    if (voor || na) {
      const begin = points[(index - 1 + n) % n];
      const eind = points[(index + 1) % n];
      const midden = points[index];
      const bv = segmentCubic(points, curves, vi, closed);
      const bn = segmentCubic(points, curves, ni, closed);
      const lv = bv ? cubicLength(bv, 1e-3) : Math.hypot(midden.x - begin.x, midden.y - begin.y);
      const ln = bn ? cubicLength(bn, 1e-3) : Math.hypot(eind.x - midden.x, eind.y - midden.y);
      const tot = lv + ln;
      let tv = tot > 0 ? lv / tot : 0.5;
      // Een vloeiende knoop tussen twee krommen is (zo goed als zeker) een
      // deelpunt van een kromme: daar verhouden de twee stuurpunten zich als
      // t : (1 − t), en geeft terugrekenen exact de oude kromme.
      if (voor && na) {
        const li = Math.hypot(voor.c2x, voor.c2y), lo = Math.hypot(na.c1x, na.c1y);
        if (li + lo > 1e-9 && isSmoothNode(points, curves, index, closed)) tv = li / (li + lo);
      }
      tv = Math.max(0.05, Math.min(0.95, tv));
      const c1 = voor
        ? { x: voor.c1x / tv, y: voor.c1y / tv }
        : { x: (midden.x - begin.x) / 3 / tv, y: (midden.y - begin.y) / 3 / tv };
      const c2 = na
        ? { x: na.c2x / (1 - tv), y: na.c2y / (1 - tv) }
        : { x: (midden.x - eind.x) / 3 / (1 - tv), y: (midden.y - eind.y) / 3 / (1 - tv) };
      samen = { c1x: c1.x, c1y: c1.y, c2x: c2.x, c2y: c2.y };
    }
    if (closed && index === 0) {
      // De segmenten zijn het laatste (vi) en het eerste (ni): het
      // samengevoegde segment wordt het nieuwe laatste.
      lijst.splice(segs - 1, 1, samen);
      lijst.splice(0, 1);
    } else {
      lijst.splice(vi, 2, samen);
    }
  }
  return { points: pts, curves: normalizeCurves(lijst, segmentCount(pts.length, closed)) };
}

/**
 * De stuurpunten bij knoop `node`: `in` hoort bij het segment dat op de knoop
 * uitkomt (zijn tweede stuurpunt), `out` bij het segment dat er vertrekt
 * (zijn eerste). Elk { segment, which, dx, dy, x, y } of null.
 */
export function nodeHandles(points, curves, node, closed) {
  const n = points?.length || 0;
  const segs = segmentCount(n, closed);
  const uit = { in: null, out: null };
  if (!(node >= 0 && node < n)) return uit;
  const p = points[node];
  const si = closed ? (node - 1 + n) % n : node - 1;
  if (si >= 0 && si < segs && isCurve(curves?.[si])) {
    const s = curves[si];
    uit.in = { segment: si, which: 2, dx: s.c2x, dy: s.c2y, x: p.x + s.c2x, y: p.y + s.c2y };
  }
  const so = node;
  if (so < segs && isCurve(curves?.[so])) {
    const s = curves[so];
    uit.out = { segment: so, which: 1, dx: s.c1x, dy: s.c1y, x: p.x + s.c1x, y: p.y + s.c1y };
  }
  return uit;
}

/**
 * Is de knoop vloeiend: twee stuurpunten die (binnen `tolDeg` graden) in
 * elkaars verlengde liggen? Een knoop met minder dan twee stuurpunten is een
 * hoek.
 */
export function isSmoothNode(points, curves, node, closed, tolDeg = 1) {
  const h = nodeHandles(points, curves, node, closed);
  if (!h.in || !h.out) return false;
  const li = Math.hypot(h.in.dx, h.in.dy), lo = Math.hypot(h.out.dx, h.out.dy);
  if (li < 1e-9 || lo < 1e-9) return false;
  const kruis = (h.in.dx * h.out.dy - h.in.dy * h.out.dx) / (li * lo);
  const inwendig = (h.in.dx * h.out.dx + h.in.dy * h.out.dy) / (li * lo);
  return inwendig < 0 && Math.abs(kruis) <= Math.sin(tolDeg * Math.PI / 180);
}

/**
 * Een stuurpunt verzetten. `which` 1 = het eerste stuurpunt van segment
 * `segment` (bij de beginknoop), 2 = het tweede (bij de eindknoop);
 * (dx, dy) is de nieuwe plek ten opzichte van die knoop. Met `smooth` draait
 * het stuurpunt aan de andere kant van dezelfde knoop mee, zodat de twee in
 * elkaars verlengde blijven; zijn lengte blijft.
 */
export function moveHandle(points, curves, segment, which, closed, dx, dy, { smooth = false } = {}) {
  const n = points?.length || 0;
  const segs = segmentCount(n, closed);
  if (!(segment >= 0 && segment < segs) || !isCurve(curves?.[segment])) return null;
  const uit = kopie(curves, segs);
  if (which === 1) { uit[segment].c1x = dx; uit[segment].c1y = dy; }
  else { uit[segment].c2x = dx; uit[segment].c2y = dy; }
  if (smooth) {
    // De andere kant van dezelfde knoop.
    let ander, veld;
    if (which === 1) { ander = closed ? (segment - 1 + segs) % segs : segment - 1; veld = 'c2'; }
    else { ander = closed ? (segment + 1) % segs : segment + 1; veld = 'c1'; }
    const len = Math.hypot(dx, dy);
    if (ander >= 0 && ander < segs && ander !== segment && uit[ander] && len > 1e-9) {
      const eigen = Math.hypot(uit[ander][veld + 'x'], uit[ander][veld + 'y']);
      uit[ander][veld + 'x'] = -dx / len * eigen;
      uit[ander][veld + 'y'] = -dy / len * eigen;
    }
  }
  return normalizeCurves(uit, segs);
}

/**
 * De stuurpunten door een lineaire afbeelding halen (draaien, schalen,
 * spiegelen): x' = a·x + c·y, y' = b·x + d·y — de volgorde van een
 * canvas-matrix. Een verschuiving hoeft niet: de stuurpunten zijn relatief.
 */
export function transformCurves(curves, a, b, c, d) {
  if (!Array.isArray(curves)) return curves;
  return curves.map((s) => (isCurve(s) ? {
    c1x: a * s.c1x + c * s.c1y, c1y: b * s.c1x + d * s.c1y,
    c2x: a * s.c2x + c * s.c2y, c2y: b * s.c2x + d * s.c2y,
  } : null));
}

/** De stuurpunten over `graden` draaien (met de klok mee op het scherm). */
export function rotateCurves(curves, graden) {
  const r = graden * Math.PI / 180;
  const cos = Math.cos(r), sin = Math.sin(r);
  return transformCurves(curves, cos, sin, -sin, cos);
}

/** Het pad in omgekeerde richting: { points, curves }. */
export function reversePath(points, curves, closed) {
  const n = points?.length || 0;
  const segs = segmentCount(n, closed);
  const pts = points.map(kaal).reverse();
  if (!hasCurves(curves)) return { points: pts, curves: undefined };
  const oud = kopie(curves, segs);
  const uit = [];
  for (let j = 0; j < segs; j++) {
    // Nieuw segment j loopt van oude knoop n-1-j naar n-2-j: het oude segment
    // n-2-j (open) of (n-2-j) mod n (gesloten), omgekeerd.
    const k = closed ? ((n - 2 - j) % n + n) % n : n - 2 - j;
    const s = oud[k];
    uit.push(s ? { c1x: s.c2x, c1y: s.c2y, c2x: s.c1x, c2y: s.c1y } : null);
  }
  return { points: pts, curves: normalizeCurves(uit, segs) };
}

/**
 * Het pad op een canvas-achtige context zetten (moveTo / lineTo /
 * bezierCurveTo, en closePath bij een gesloten pad). Roept zelf geen
 * beginPath aan.
 */
export function tracePath(ctx, points, curves, closed) {
  const n = points?.length || 0;
  if (n === 0) return;
  ctx.moveTo(points[0].x, points[0].y);
  const segs = segmentCount(n, closed);
  for (let i = 0; i < segs; i++) {
    const b = points[(i + 1) % n];
    const s = curves?.[i];
    if (isCurve(s)) {
      const a = points[i];
      ctx.bezierCurveTo(a.x + s.c1x, a.y + s.c1y, b.x + s.c2x, b.y + s.c2y, b.x, b.y);
    } else if (!(closed && i === segs - 1)) {
      ctx.lineTo(b.x, b.y);
    }
  }
  if (closed) ctx.closePath();
}
