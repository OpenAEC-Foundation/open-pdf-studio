// Betonbalk — pure geometrie-module (GEEN UI/DOM/app-state-deps).
//
// Dit is de ENIGE bron van waarheid voor de vorm van een betonbalk in
// plattegrond: de canvas-rendering (annotations/rendering.js via
// rendering/betonbalk-draw.js), de hit-test (annotations/geometry.js) en de
// PDF-appearance-generatie (saver → buildBetonbalkAP) gebruiken allemaal
// buildBetonbalk(). Zo kunnen scherm en PDF per definitie niet uit elkaar
// lopen.
//
// Model: de gebruiker tekent een HARTLIJN (points, klik-voor-klik zoals een
// polylijn). De twee randlijnen liggen op ± halve breedte loodrecht op elk
// segment en worden per knik in VERSTEK gejoined (snijpunt van de twee
// offset-lijnen). Bij bijna-parallelle of zeer scherpe hoeken (uitschieter
// groter dan MITER_LIMIT_FACTOR × halve breedte) valt de join terug op een
// afgeschuinde (bevel) join. Vrije uiteinden krijgen een haakse eindkap.
//
// Inter-balk-join (T-/hoekaansluiting): eindigt of begint de hartlijn op het
// lijf of een uiteinde van een ANDERE betonbalk, dan worden de eigen
// randlijnen doorgetrokken/afgekort tot de randlijn van die doelbalk en
// vervalt de eindkap op het aansluitvlak. De doelbalk zelf wordt NOOIT
// gemuteerd: het opschonen gebeurt puur bij het (her)berekenen van de eigen
// geometrie (render- en AP-tijd), zodat verplaatsen/verwijderen altijd
// omkeerbaar blijft.
//
// Rotatie-veiligheid: ALLE geometrie wordt afgeleid uit de hartlijnpunten
// zelf. Er is GEEN rotation-veld en geen losse transform; een schuine balk
// ontstaat doordat de punten schuin liggen. De AP-stream kan daardoor
// /Matrix = (translatie-)identiteit en BBox = /Rect-maat houden.

/** Toegestane lijnstijlen. 'gestippeld' = balk boven het aanzichtvlak
 *  (NL-conventie): randen onderbroken, hartlijn doorgetrokken dun. */
export const BETONBALK_LIJNSTIJLEN = ['doorgetrokken', 'gestippeld'];

/** Defaults, één plek — gebruikt door de creator én als fallback bij render. */
export const BETONBALK_DEFAULTS = {
  breedteMm: 300,
  lijnstijl: 'doorgetrokken',
};

/** Bereik van de instelbare balkbreedte (mm). */
export const BETONBALK_BREEDTE_RANGE = { min: 10, max: 2000 };

/**
 * Vaste omrekening als er GEEN schaal(gebied) bekend is: 1:100.
 * 1 werkelijke mm = 0,01 papier-mm = 0,01 × 72/25,4 pt ≈ 0,0283 app-px.
 */
export const PX_PER_MM_1_100 = 72 / 25.4 / 100;

/**
 * Miter-limiet als factor × halve breedte: een verstekpunt dat verder dan
 * dit van de knik ligt wordt een bevel (voorkomt extreme uitschieters bij
 * scherpe hoeken).
 */
export const MITER_LIMIT_FACTOR = 4;

function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

/** Genormaliseerde parameters met defaults ingevuld (puur, muteert niets). */
export function resolveBetonbalkParams(ann) {
  const a = ann || {};
  const wRaw = Number(a.breedteMm);
  const breedteMm = Number.isFinite(wRaw) && wRaw > 0
    ? clamp(wRaw, BETONBALK_BREEDTE_RANGE.min, BETONBALK_BREEDTE_RANGE.max)
    : BETONBALK_DEFAULTS.breedteMm;
  const lijnstijl = BETONBALK_LIJNSTIJLEN.includes(a.lijnstijl)
    ? a.lijnstijl : BETONBALK_DEFAULTS.lijnstijl;
  return { breedteMm, lijnstijl };
}

/**
 * Halve balkbreedte in app-px. `pxPerMm` komt als PARAMETER binnen (de
 * schaalgebied-bewuste helper betonbalk-scale.js levert hem), zodat deze
 * module vrij van app-state blijft. Ontbreekt de schaal (0/ongeldig), dan
 * geldt de vaste 1:100-omrekening.
 */
export function halfWidthFromMm(breedteMm, pxPerMm) {
  const w = Number(breedteMm) > 0 ? Number(breedteMm) : BETONBALK_DEFAULTS.breedteMm;
  const k = Number(pxPerMm) > 0 ? Number(pxPerMm) : PX_PER_MM_1_100;
  return Math.max(0.25, (w * k) / 2);
}

/**
 * Lijnstijl → dash-patronen voor randen en hartlijn (papier-constant, in
 * app-px op schaal 1; gedeeld door canvas én PDF-appearance).
 *  - doorgetrokken: randen ononderbroken, hartlijn dun streep-punt.
 *  - gestippeld:    randen onderbroken, hartlijn doorgetrokken dun.
 */
export function betonbalkLineStyles(lijnstijl) {
  if (lijnstijl === 'gestippeld') {
    return { edgeDash: [6, 4], centerDash: null };
  }
  return { edgeDash: null, centerDash: [12, 4, 2, 4] };
}

/** Factor voor de hartlijn-dikte t.o.v. de rand-lijndikte. */
export const CENTERLINE_WIDTH_FACTOR = 0.5;

// ── basis-vectorhulpjes (lokaal; bewust geen import uit utils) ─────────────

function _unit(dx, dy) {
  const len = Math.hypot(dx, dy);
  if (!(len > 1e-9)) return null;
  return { x: dx / len, y: dy / len };
}

/** Snijpunt van twee ONEINDIGE lijnen (p langs richting d). Null = parallel. */
export function lineIntersection(p1, d1, p2, d2) {
  const denom = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / denom;
  return { x: p1.x + d1.x * t, y: p1.y + d1.y * t, t };
}

/** Afstand van punt tot lijnSEGMENT. */
function _distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// Geldige (niet-samenvallende) opeenvolgende punten van de hartlijn.
function _cleanPoints(points) {
  const out = [];
  for (const p of points || []) {
    const x = Number(p?.x), y = Number(p?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const prev = out[out.length - 1];
    if (prev && Math.hypot(x - prev.x, y - prev.y) < 1e-6) continue;
    out.push({ x, y });
  }
  return out;
}

/**
 * De twee randpolylijnen van een balk-hartlijn, met verstek-join per knik.
 *
 * Per knik worden de offset-lijnen van de twee aangrenzende segmenten
 * gesneden (exact verstekpunt). Ligt dat snijpunt verder dan
 * MITER_LIMIT_FACTOR × halve breedte van de knik (scherpe hoek), of zijn de
 * segmenten (bijna) parallel, dan komen er TWEE hoekpunten (bevel).
 *
 * @param {Array<{x:number,y:number}>} points  Hartlijnpunten (≥ 2).
 * @param {number} halfWidth                   Halve balkbreedte (app-px).
 * @returns {{left:Array, right:Array}|null}   Randen op +n resp. −n zijde
 *   (n = linksdraaiende loodrechte op de segmentrichting), of null bij een
 *   gedegenereerde hartlijn.
 */
export function beamOutline(points, halfWidth, miterLimitFactor = MITER_LIMIT_FACTOR) {
  const pts = _cleanPoints(points);
  if (pts.length < 2) return null;
  const h = Number(halfWidth) > 0 ? Number(halfWidth) : 1;

  // Richting + loodrechte per segment.
  const dirs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    dirs.push(_unit(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y));
  }
  const limit = miterLimitFactor * h;

  const side = (sigma) => {
    const edge = [];
    const n0 = { x: -dirs[0].y, y: dirs[0].x };
    edge.push({ x: pts[0].x + sigma * n0.x * h, y: pts[0].y + sigma * n0.y * h });
    for (let k = 1; k < pts.length - 1; k++) {
      const d1 = dirs[k - 1], d2 = dirs[k];
      const n1 = { x: -d1.y, y: d1.x };
      const n2 = { x: -d2.y, y: d2.x };
      const p1 = { x: pts[k].x + sigma * n1.x * h, y: pts[k].y + sigma * n1.y * h };
      const p2 = { x: pts[k].x + sigma * n2.x * h, y: pts[k].y + sigma * n2.y * h };
      // (Bijna) rechtdoor: offsets vallen samen — één punt volstaat.
      if (Math.hypot(p1.x - p2.x, p1.y - p2.y) < 1e-6) {
        edge.push(p1);
        continue;
      }
      const X = lineIntersection(p1, d1, p2, d2);
      if (!X || Math.hypot(X.x - pts[k].x, X.y - pts[k].y) > limit) {
        // Parallel (180°-knik) of voorbij de miter-limiet → bevel.
        edge.push(p1, p2);
      } else {
        edge.push({ x: X.x, y: X.y });
      }
    }
    const nl = { x: -dirs[dirs.length - 1].y, y: dirs[dirs.length - 1].x };
    const pe = pts[pts.length - 1];
    edge.push({ x: pe.x + sigma * nl.x * h, y: pe.y + sigma * nl.y * h });
    return edge;
  };

  return { left: side(1), right: side(-1) };
}

// Dichtstbijzijnde segment-index van een hartlijn t.o.v. een punt.
function _nearestSegment(points, px, py) {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const d = _distToSegment(px, py, points[i].x, points[i].y, points[i + 1].x, points[i + 1].y);
    if (d < bestD) { bestD = d; best = i; }
  }
  return { index: best, dist: bestD };
}

/**
 * Zoek de doelbalk waarop een hartlijn-uiteinde aansluit.
 *
 * Aansluiting = het uiteinde ligt op het LIJF (binnen de band) of op een
 * uiteinde van een andere balk, met als tolerantie de halve breedte van de
 * DUNSTE van de twee balken.
 *
 * @param {{x:number,y:number}} P     Hartlijn-uiteinde van de eigen balk.
 * @param {number} ownHalfWidth       Eigen halve breedte.
 * @param {Array<{points:Array,halfWidth:number}>} others  Andere balken.
 * @returns {{beam:object, segIndex:number}|null}
 */
export function findJoinTarget(P, ownHalfWidth, others) {
  let best = null, bestD = Infinity;
  for (const ob of others || []) {
    const pts = _cleanPoints(ob?.points);
    if (pts.length < 2 || !(ob.halfWidth > 0)) continue;
    const tol = Math.min(Number(ownHalfWidth) || 0, ob.halfWidth);
    const near = _nearestSegment(pts, P.x, P.y);
    if (near.index < 0) continue;
    if (near.dist <= ob.halfWidth + tol && near.dist < bestD) {
      bestD = near.dist;
      best = { beam: { points: pts, halfWidth: ob.halfWidth }, segIndex: near.index };
    }
  }
  return best;
}

// Trim één rand-uiteinde tegen de twee randlijnen van het doelsegment.
// `edge` wordt IN PLACE aangepast; retourneert true als er getrimd is.
// which: 'start' (edge[0] beweegt) of 'end' (edge[laatste] beweegt).
function _trimEdgeEnd(edge, which, target, ownHalfWidth) {
  if (!edge || edge.length < 2) return false;
  const endIdx = which === 'start' ? 0 : edge.length - 1;
  const prevIdx = which === 'start' ? 1 : edge.length - 2;
  const B = edge[endIdx], A = edge[prevIdx];
  const d = _unit(B.x - A.x, B.y - A.y);
  if (!d) return false;
  const tPts = target.beam.points;
  const s = tPts[target.segIndex];
  const e = tPts[target.segIndex + 1];
  const u = _unit(e.x - s.x, e.y - s.y);
  if (!u) return false;
  const n = { x: -u.y, y: u.x };
  const hT = target.beam.halfWidth;
  const tB = Math.hypot(B.x - A.x, B.y - A.y); // parameter van het huidige uiteinde
  // Sanity-grens: trims horen in de buurt van het aansluitvlak te blijven.
  const maxShift = (hT + Math.min(ownHalfWidth, hT)) * MITER_LIMIT_FACTOR;
  let best = null, bestShift = Infinity;
  for (const sigma of [1, -1]) {
    const q = { x: s.x + sigma * n.x * hT, y: s.y + sigma * n.y * hT };
    const X = lineIntersection(A, d, q, u);
    if (!X) continue;
    const shift = Math.abs(X.t - tB);
    if (shift > maxShift) continue;
    // Dichtstbijzijnde doelrand wint; bij gelijke afstand de KORTSTE balk
    // (kleinste t), zodat een T-aansluiting op de nabije rand eindigt.
    if (shift < bestShift - 1e-9 || (Math.abs(shift - bestShift) <= 1e-9 && best && X.t < best.t)) {
      bestShift = shift;
      best = X;
    }
  }
  if (!best) return false;
  edge[endIdx] = { x: best.x, y: best.y };
  return true;
}

/**
 * Inter-balk-join: trim/verleng de randen van `outline` op de uiteinden die
 * op een andere balk aansluiten, en meld welke uiteinden gejoined zijn.
 * Muteert ALLEEN de meegegeven outline (nooit de doelbalken).
 *
 * @param {{left:Array,right:Array}} outline  Eigen randen (uit beamOutline).
 * @param {Array<{x,y}>} centerPts            Eigen (opgeschoonde) hartlijn.
 * @param {number} ownHalfWidth
 * @param {Array<{points:Array,halfWidth:number}>} others
 * @returns {{joinedStart:boolean, joinedEnd:boolean}}
 */
export function trimAgainstBeams(outline, centerPts, ownHalfWidth, others) {
  const res = { joinedStart: false, joinedEnd: false };
  if (!outline || !centerPts || centerPts.length < 2 || !others || others.length === 0) return res;
  const ends = [
    { which: 'start', P: centerPts[0], flag: 'joinedStart' },
    { which: 'end', P: centerPts[centerPts.length - 1], flag: 'joinedEnd' },
  ];
  for (const end of ends) {
    const target = findJoinTarget(end.P, ownHalfWidth, others);
    if (!target) continue;
    // Beide randen naar de doelrand trekken; het aansluitvlak krijgt geen
    // eindkap, ook als één rand (parallel geval) niet te snijden was.
    _trimEdgeEnd(outline.left, end.which, target, ownHalfWidth);
    _trimEdgeEnd(outline.right, end.which, target, ownHalfWidth);
    res[end.flag] = true;
  }
  return res;
}

/**
 * Bouw de volledige betonbalk-geometrie.
 *
 * @param {object} ann  Annotatie met points + breedteMm + lijnstijl.
 * @param {object} [opts]
 * @param {number} [opts.halfWidth]  Halve breedte in app-px (schaalbewust,
 *        van betonbalk-scale.js). Ontbreekt hij, dan wordt hij uit
 *        breedteMm × 1:100 afgeleid.
 * @param {Array<{points:Array,halfWidth:number}>} [opts.others]
 *        Andere betonbalken op dezelfde pagina (voor de inter-balk-join).
 * @returns {{
 *   params:object, halfWidth:number,
 *   center:Array, edges:{left:Array,right:Array},
 *   caps:Array<{x1,y1,x2,y2}>, joinedStart:boolean, joinedEnd:boolean,
 *   outline:Array, styles:{edgeDash:Array|null,centerDash:Array|null},
 *   aabb:{x:number,y:number,width:number,height:number}
 * }|null}
 */
export function buildBetonbalk(ann, opts = {}) {
  const params = resolveBetonbalkParams(ann);
  const center = _cleanPoints(ann?.points);
  if (center.length < 2) return null;
  const halfWidth = Number(opts.halfWidth) > 0
    ? Number(opts.halfWidth)
    : halfWidthFromMm(params.breedteMm, 0);

  const edges = beamOutline(center, halfWidth);
  if (!edges) return null;

  const { joinedStart, joinedEnd } = trimAgainstBeams(edges, center, halfWidth, opts.others);

  // Eindkappen: alleen op vrije (niet-gejoinede) uiteinden, haaks dichtgezet.
  const caps = [];
  if (!joinedStart) {
    caps.push({
      x1: edges.left[0].x, y1: edges.left[0].y,
      x2: edges.right[0].x, y2: edges.right[0].y,
    });
  }
  if (!joinedEnd) {
    const li = edges.left[edges.left.length - 1];
    const ri = edges.right[edges.right.length - 1];
    caps.push({ x1: li.x, y1: li.y, x2: ri.x, y2: ri.y });
  }

  // Gesloten omtrek (voor hit-test en de /Vertices in de PDF).
  const outline = [...edges.left, ...edges.right.slice().reverse()];

  // AABB over randen + hartlijn (de hartlijn ligt per definitie binnen de
  // randen, maar bij een getrimde rand kan een hartlijnpunt er net buiten
  // steken — meenemen dus).
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of [...outline, ...center]) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  return {
    params,
    halfWidth,
    center,
    edges,
    caps,
    joinedStart,
    joinedEnd,
    outline,
    styles: betonbalkLineStyles(params.lijnstijl),
    aabb: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
  };
}
