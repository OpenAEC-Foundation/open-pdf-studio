/**
 * Hoekgeometrie voor Fillet (afronden) en Chamfer (afkanten) — puur, zonder
 * app-state, zodat het los te testen is (hoek-geometrie.test.mjs).
 *
 * Beide bewerkingen werken op twee lijnstukken die (in het oneindige) elkaar
 * snijden:
 *   1. Het snijpunt I van beide lijnen.
 *   2. Per lijn een richting "ray" van I af, gekozen aan de kant waar het
 *      merendeel van het segment ligt (middelpuntregel) — dus aan de kant
 *      waar de hoek zich bevindt.
 *   3. Het aangrijppunt T ligt op die ray op afstand d van I:
 *        fillet:  d = R / tan(θ/2)        (θ = hoek tussen de rays)
 *        chamfer: d1 / d2 (opgegeven)
 *   4. Het eindpunt van elke lijn dat het dichtst bij I ligt wordt vervangen
 *      door T — precies één eindpunt per lijn, zodat de rest van de tekening
 *      onaangeroerd blijft (zelfde filosofie als het Trim-gereedschap).
 *
 * Segmentvorm: { x1, y1, x2, y2 } (zelfde als lijn-/pijl-annotaties).
 * Retourneert óf { lijn1, lijn2, arc|chamfer } óf { error } met
 * error ∈ 'parallel' | 'degenerate'.
 *
 * De snijrekening staat hier lokaal (identiek aan lineLineIntersection in
 * geometry.js): geometry.js sleept core/state + DOM mee en is daardoor niet
 * importeerbaar in de node-eenheidstests.
 */

const EPS = 1e-9;

/** Snijpunt van de twee oneindige lijnen (p1,p2) en (p3,p4); null bij
 *  evenwijdige lijnen. Zelfde contract als lineLineIntersection in geometry.js. */
function _snijpunt(p1, p2, p3, p4) {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;
  return { x: p1.x + t * d1x, y: p1.y + t * d1y, t, u };
}

/** Eenheidvector van a naar b, of null bij nul lengte. */
function _unit(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (!(len > EPS)) return null;
  return { x: dx / len, y: dy / len };
}

/**
 * Richting "van I het segment in" — de kant waar het middelpunt van het
 * segment ligt. Null als het middelpunt exact op I ligt (ontaard geval).
 */
function _ray(seg, I) {
  const u = _unit({ x: seg.x1, y: seg.y1 }, { x: seg.x2, y: seg.y2 });
  if (!u) return null;
  const mx = (seg.x1 + seg.x2) / 2 - I.x;
  const my = (seg.y1 + seg.y2) / 2 - I.y;
  const s = mx * u.x + my * u.y;
  if (Math.abs(s) < EPS) return null;
  return { x: Math.sign(s) * u.x, y: Math.sign(s) * u.y };
}

/** Vervang het eindpunt dat het dichtst bij I ligt door T; null als het
 *  resterende eindpunt exact op T zou liggen (nul-lengte segment). */
function _vervangDichtsteEindpunt(seg, I, T) {
  const e1 = { x: seg.x1, y: seg.y1 };
  const e2 = { x: seg.x2, y: seg.y2 };
  const d1 = Math.hypot(e1.x - I.x, e1.y - I.y);
  const d2 = Math.hypot(e2.x - I.x, e2.y - I.y);
  const dichtst = d1 <= d2 ? e1 : e2;
  const ander = d1 <= d2 ? e2 : e1;
  if (Math.hypot(T.x - ander.x, T.y - ander.y) < EPS) return null;
  if (dichtst === e1) return { x1: T.x, y1: T.y, x2: seg.x2, y2: seg.y2 };
  return { x1: seg.x1, y1: seg.y1, x2: T.x, y2: T.y };
}

/** Gedeelde voorbereiding: snijpunt, rays en de hoek ertussen. */
function _hoekbasis(seg1, seg2) {
  const I = _snijpunt(
    { x: seg1.x1, y: seg1.y1 }, { x: seg1.x2, y: seg1.y2 },
    { x: seg2.x1, y: seg2.y1 }, { x: seg2.x2, y: seg2.y2 },
  );
  if (!I) return { error: 'parallel' };
  const r1 = _ray(seg1, I);
  const r2 = _ray(seg2, I);
  if (!r1 || !r2) return { error: 'degenerate' };
  const cosT = Math.min(1, Math.max(-1, r1.x * r2.x + r1.y * r2.y));
  const theta = Math.acos(cosT);
  // Rays evenwichtig (lijnen evenwijdig) of exact tegenovergesteld:
  // snijpunt bestaat wel maar de hoek is 0° of 180° — geen hoek te maken.
  if (theta < 1e-6 || Math.PI - theta < 1e-6) return { error: 'parallel' };
  return { I, r1, r2, theta };
}

/**
 * Fillet: rond de hoek af met straal `radius` (0 = scherpe hoek, dan alleen
 * tot het snijpunt trimmen — arc: null).
 * Retourneert { lijn1, lijn2, arc } of { error }.
 *   arc = { centerX, centerY, radius, startAngle, endAngle } — hoeken in
 *   radialen, zodanig dat ctx.arc(start → end) (met,412 clockwise=false) de
 *   boog tussen de twee aangrijppunten doorloopt.
 */
export function filletGeometry(seg1, seg2, radius) {
  if (!Number.isFinite(radius) || radius < 0) return { error: 'degenerate' };
  const basis = _hoekbasis(seg1, seg2);
  if (basis.error) return basis;
  const { I, r1, r2, theta } = basis;

  const d = radius / Math.tan(theta / 2);
  const T1 = { x: I.x + d * r1.x, y: I.y + d * r1.y };
  const T2 = { x: I.x + d * r2.x, y: I.y + d * r2.y };

  const lijn1 = _vervangDichtsteEindpunt(seg1, I, T1);
  const lijn2 = _vervangDichtsteEindpunt(seg2, I, T2);
  if (!lijn1 || !lijn2) return { error: 'degenerate' };

  if (radius < 1e-6) return { lijn1, lijn2, arc: null };

  // Middelpunt op de bissectrice, op R/sin(θ/2) van I; de boog ligt aan de
  // kant van de hoek (dus van I weg langs de bissectrice).
  const half = Math.sin(theta / 2);
  const dist = radius / half;
  const len = Math.hypot(r1.x + r2.x, r1.y + r2.y);
  if (!(len > EPS)) return { error: 'parallel' };
  const bis = { x: (r1.x + r2.x) / len, y: (r1.y + r2.y) / len };
  const O = { x: I.x + dist * bis.x, y: I.y + dist * bis.y };

  const a1 = Math.atan2(T1.y - O.y, T1.x - O.x);
  const a2 = Math.atan2(T2.y - O.y, T2.x - O.x);
  // Middelpunt van de boog: van O uit in de richting van I (de boog bulkt
  // richting de hoek). Bepaal de richting van start→eind zodat die hoek
  // in de sweep valt (zelfde normalisatie als de 3-punts boog in arc-tool).
  const M = { x: O.x - radius * bis.x, y: O.y - radius * bis.y };
  const am = Math.atan2(M.y - O.y, M.x - O.x);
  const norm = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const midInSweep = norm(am - a1) <= norm(a2 - a1);

  return {
    lijn1,
    lijn2,
    arc: {
      centerX: O.x,
      centerY: O.y,
      radius,
      startAngle: midInSweep ? a1 : a2,
      endAngle: midInSweep ? a2 : a1,
    },
  };
}

/**
 * Chamfer: vervangt de hoek door een rechte kant op afstand d1 (lijn 1) en
 * d2 (lijn 2) vanaf het snijpunt. Retourneert { lijn1, lijn2, chamfer } of
 * { error }; chamfer = { x1, y1, x2, y2 } (null als d1 én d2 nul zijn).
 */
export function chamferGeometry(seg1, seg2, d1, d2) {
  if (!Number.isFinite(d1) || !Number.isFinite(d2) || d1 < 0 || d2 < 0
      || (d1 === 0 && d2 === 0)) return { error: 'degenerate' };
  const basis = _hoekbasis(seg1, seg2);
  if (basis.error) return basis;
  const { I, r1, r2 } = basis;

  const T1 = { x: I.x + d1 * r1.x, y: I.y + d1 * r1.y };
  const T2 = { x: I.x + d2 * r2.x, y: I.y + d2 * r2.y };

  const lijn1 = _vervangDichtsteEindpunt(seg1, I, T1);
  const lijn2 = _vervangDichtsteEindpunt(seg2, I, T2);
  if (!lijn1 || !lijn2) return { error: 'degenerate' };

  const chamfer = Math.hypot(T2.x - T1.x, T2.y - T1.y) < EPS
    ? null
    : { x1: T1.x, y1: T1.y, x2: T2.x, y2: T2.y };
  return { lijn1, lijn2, chamfer };
}
