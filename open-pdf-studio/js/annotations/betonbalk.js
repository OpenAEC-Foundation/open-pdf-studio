// Betonbalk — pure geometrie-module (GEEN UI/DOM/app-state-deps).
//
// Dit is de ENIGE bron van waarheid voor de vorm van een betonbalk in
// plattegrond: de canvas-rendering (annotations/rendering.js via
// rendering/betonbalk-draw.js), de hit-test (annotations/geometry.js) en de
// PDF-appearance-generatie (saver → buildBetonbalkAP) gebruiken allemaal
// buildBetonbalk(). Zo kunnen scherm en PDF per definitie niet uit elkaar
// lopen.
//
// Model: één balk = één LIJNSTUK (startX/startY/endX/endY, zoals 'line' en
// 'wall'). Daardoor werken de CAD-gereedschappen (trim/extend/split, G/MV,
// eindpunt-grips, object-snap) automatisch. Een doorgaande ligger met
// knikken teken je als losse, aansluitende balken; de hoeken worden bij het
// renderen opgeschoond:
//
//  * L-/hoekaansluiting (uiteinde op uiteinde): beide randen worden in
//    VERSTEK gesneden met de randen van de aansluitende balk (zelfde
//    randparing als de wand-joins), en de eindkap vervalt.
//  * T-aansluiting (uiteinde op het lijf): de eigen randen én de hartlijn
//    worden doorgetrokken/afgekort tot de NABIJE rand van de doelbalk, en
//    de eindkap vervalt — de doorgaande balk houdt zijn eigen rand.
//
// De doelbalk wordt daarbij NOOIT gemuteerd: het opschonen gebeurt puur bij
// het (her)berekenen van de eigen geometrie (render- en AP-tijd), zodat
// verplaatsen/verwijderen altijd omkeerbaar blijft.
//
// Rotatie-veiligheid: ALLE geometrie wordt afgeleid uit start/eind zelf.
// Er is GEEN rotation-veld; een schuine balk ontstaat doordat de punten
// schuin liggen. De AP-stream houdt /Matrix = (translatie-)identiteit en
// BBox = /Rect-maat.

/** Toegestane lijnstijlen. 'gestippeld' = balk boven het aanzichtvlak
 *  (NL-conventie): randen onderbroken, hartlijn doorgetrokken dun. */
export const BETONBALK_LIJNSTIJLEN = ['doorgetrokken', 'gestippeld'];

/**
 * Gangbare betonbalk-doorsneden (b × h in mm) voor de profielkeuzelijst.
 * De BREEDTE bepaalt de getekende bandbreedte in plattegrond; de HOOGTE is
 * administratief (paneel + tag).
 */
export const BETONBALK_PROFIELEN = [
  { breedteMm: 200, hoogteMm: 300 },
  { breedteMm: 250, hoogteMm: 350 },
  { breedteMm: 300, hoogteMm: 400 },
  { breedteMm: 350, hoogteMm: 400 },
  { breedteMm: 350, hoogteMm: 500 },
  { breedteMm: 400, hoogteMm: 400 },
  { breedteMm: 400, hoogteMm: 500 },
  { breedteMm: 400, hoogteMm: 600 },
  { breedteMm: 500, hoogteMm: 500 },
  { breedteMm: 500, hoogteMm: 600 },
];

/** Profielnaam "bxh" zoals in de keuzelijst en de standaard-tag. */
export function betonbalkProfielNaam(breedteMm, hoogteMm) {
  return `${Math.round(Number(breedteMm) || 0)}x${Math.round(Number(hoogteMm) || 0)}`;
}

/** Defaults, één plek — gebruikt door de creator én als fallback bij render. */
export const BETONBALK_DEFAULTS = {
  breedteMm: 300,
  hoogteMm: 400,
  lijnstijl: 'doorgetrokken',
  toonHartlijn: false,
  tagTonen: false,
  tagFontSize: 12,
};

/** Bereik van de instelbare doorsnedematen (mm). */
export const BETONBALK_BREEDTE_RANGE = { min: 10, max: 2000 };
export const BETONBALK_HOOGTE_RANGE = { min: 10, max: 3000 };

/**
 * Vaste omrekening als er GEEN schaal(gebied) bekend is: 1:100.
 * 1 werkelijke mm = 0,01 papier-mm = 0,01 × 72/25,4 pt ≈ 0,0283 app-px.
 */
export const PX_PER_MM_1_100 = 72 / 25.4 / 100;

/**
 * Miter-limiet als factor × halve breedte: een verstekpunt dat verder dan
 * dit van de knik ligt wordt niet gesneden (voorkomt extreme uitschieters
 * bij zeer scherpe hoeken).
 */
export const MITER_LIMIT_FACTOR = 4;

/** Tolerantie (app-px ≈ pt) waarbinnen twee uiteinden als HOEK gelden. */
export const CORNER_TOL = 1.5;

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
  const hRaw = Number(a.hoogteMm);
  const hoogteMm = Number.isFinite(hRaw) && hRaw > 0
    ? clamp(hRaw, BETONBALK_HOOGTE_RANGE.min, BETONBALK_HOOGTE_RANGE.max)
    : BETONBALK_DEFAULTS.hoogteMm;
  const lijnstijl = BETONBALK_LIJNSTIJLEN.includes(a.lijnstijl)
    ? a.lijnstijl : BETONBALK_DEFAULTS.lijnstijl;
  // Hartlijn tonen: standaard UIT — alleen een expliciete true zet hem aan.
  const toonHartlijn = a.toonHartlijn === true;
  const tagTonen = a.tagTonen === true;
  // Vrije tag-verplaatsing: offset in paginaruimte t.o.v. de standaardpositie
  // (gecentreerd boven het balkmidden). Bewust een paginaruimte-offset en
  // geen balk-lokale: robuust bij draaien/verslepen van de balk en één-op-één
  // hetzelfde in canvas en AP.
  const dxRaw = Number(a.tagOffsetX);
  const tagOffsetX = Number.isFinite(dxRaw) ? dxRaw : 0;
  const dyRaw = Number(a.tagOffsetY);
  const tagOffsetY = Number.isFinite(dyRaw) ? dyRaw : 0;
  const tagTekstRaw = a.tagTekst != null ? String(a.tagTekst) : '';
  const tagTekst = tagTekstRaw.trim() !== ''
    ? tagTekstRaw : betonbalkProfielNaam(breedteMm, hoogteMm);
  const tfRaw = Number(a.tagFontSize);
  const tagFontSize = Number.isFinite(tfRaw) && tfRaw > 0
    ? clamp(tfRaw, 4, 72) : BETONBALK_DEFAULTS.tagFontSize;
  return {
    breedteMm, hoogteMm, lijnstijl, toonHartlijn,
    tagTonen, tagTekst, tagFontSize, tagOffsetX, tagOffsetY,
  };
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

/**
 * Breedte-schatter voor de tag zonder canvas (zelfde heuristiek als de
 * stavenreeks); de renderer mag een echte meter meegeven.
 */
export function approxTextWidth(text, fontSize) {
  return String(text).length * fontSize * 0.55;
}

// ── basis-vectorhulpjes (lokaal; bewust geen import uit utils) ─────────────

function _unit(dx, dy) {
  const len = Math.hypot(dx, dy);
  if (!(len > 1e-9)) return null;
  return { x: dx / len, y: dy / len };
}

/** Snijpunt van twee ONEINDIGE lijnen (p langs richting d). Null = parallel.
 *  `t` is de parameter langs (p1, d1). */
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

/**
 * Hartlijn van een balk-annotatie: [start, eind]. Accepteert het huidige
 * tweepunts-model (startX/…/endY) én — als vangnet — een legacy points-array
 * (waarvan alleen de eerste twee punten tellen; de loader splitst oude
 * meerpunts-exemplaren al in losse balken).
 */
export function betonbalkCenterline(ann) {
  const a = ann || {};
  if ([a.startX, a.startY, a.endX, a.endY].every(Number.isFinite)) {
    const pts = [
      { x: a.startX, y: a.startY },
      { x: a.endX, y: a.endY },
    ];
    if (Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) < 1e-6) return null;
    return pts;
  }
  if (Array.isArray(a.points) && a.points.length >= 2) {
    const p0 = a.points[0], p1 = a.points[1];
    if ([p0?.x, p0?.y, p1?.x, p1?.y].every(Number.isFinite)
        && Math.hypot(p1.x - p0.x, p1.y - p0.y) > 1e-6) {
      return [{ x: p0.x, y: p0.y }, { x: p1.x, y: p1.y }];
    }
  }
  return null;
}

// Geldige (niet-samenvallende) opeenvolgende punten van een hartlijn-array.
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
 * De twee randpolylijnen van een hartlijn (algemeen, ≥ 2 punten), met
 * verstek-join per knik en miter-limiet → bevel. Voor het tweepunts-model is
 * dit gewoon het rechte band-paar; de knik-logica blijft beschikbaar voor
 * hulpberekeningen en tests.
 *
 * @returns {{left:Array, right:Array}|null}  Randen op +n resp. −n zijde
 *   (n = (-uy, ux) van de segmentrichting u).
 */
export function beamOutline(points, halfWidth, miterLimitFactor = MITER_LIMIT_FACTOR) {
  const pts = _cleanPoints(points);
  if (pts.length < 2) return null;
  const h = Number(halfWidth) > 0 ? Number(halfWidth) : 1;

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
      if (Math.hypot(p1.x - p2.x, p1.y - p2.y) < 1e-6) {
        edge.push(p1);
        continue;
      }
      const X = lineIntersection(p1, d1, p2, d2);
      if (!X || Math.hypot(X.x - pts[k].x, X.y - pts[k].y) > limit) {
        edge.push(p1, p2); // parallel of voorbij de miter-limiet → bevel
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

/**
 * Zoek de aansluiting van een balk-uiteinde P op een andere balk.
 *
 *  - 'corner': P valt (binnen CORNER_TOL) samen met een uiteinde van de
 *    andere balk → L-/hoekverstek.
 *  - 'tee': P ligt op het lijf van de andere balk (afstand tot de hartlijn
 *    ≤ halve doelbreedte + tolerantie = halve breedte van de dunste balk).
 *
 * @param {{x:number,y:number}} P
 * @param {number} ownHalfWidth
 * @param {Array<{points:Array<{x,y}>, halfWidth:number}>} others
 * @returns {{kind:'corner'|'tee', beam:object, far?:{x,y}}|null}
 */
export function findJoinTarget(P, ownHalfWidth, others) {
  let bestCorner = null, bestCornerD = Infinity;
  let bestTee = null, bestTeeD = Infinity;
  for (const ob of others || []) {
    const pts = _cleanPoints(ob?.points);
    if (pts.length < 2 || !(ob.halfWidth > 0)) continue;
    const S = pts[0], E = pts[pts.length - 1];
    // Hoek: uiteinde op uiteinde.
    for (const [end, far] of [[S, E], [E, S]]) {
      const d = Math.hypot(P.x - end.x, P.y - end.y);
      if (d <= CORNER_TOL && d < bestCornerD) {
        bestCornerD = d;
        bestCorner = { kind: 'corner', beam: { points: pts, halfWidth: ob.halfWidth }, far };
      }
    }
    // T: uiteinde op het lijf.
    const tol = Math.min(Number(ownHalfWidth) || 0, ob.halfWidth);
    const d = _distToSegment(P.x, P.y, S.x, S.y, E.x, E.y);
    if (d <= ob.halfWidth + tol && d < bestTeeD) {
      bestTeeD = d;
      bestTee = { kind: 'tee', beam: { points: pts, halfWidth: ob.halfWidth } };
    }
  }
  return bestCorner || bestTee;
}

// Snijpunt van de (oneindige) lijn A→B met de NABIJE randlijn van de
// doelbalk: de kandidaat met de KLEINSTE parameter t (de eerste doelrand die
// de lijn in uitgaande richting kruist), binnen een redelijke afstand van
// het huidige uiteinde B. Bewust niet "dichtst bij B": een uiteinde dat al
// vóórbij de doel-hartlijn geklikt is zou dan op de VERRE rand belanden en
// dwars door de doelbalk steken (de oorspronkelijke T-bug).
function _nearFaceIntersection(A, B, target, ownHalfWidth) {
  const d = _unit(B.x - A.x, B.y - A.y);
  if (!d) return null;
  const tPts = target.beam.points;
  const s = tPts[0];
  const e = tPts[tPts.length - 1];
  const u = _unit(e.x - s.x, e.y - s.y);
  if (!u) return null;
  const n = { x: -u.y, y: u.x };
  const hT = target.beam.halfWidth;
  const tB = Math.hypot(B.x - A.x, B.y - A.y);
  const maxShift = (hT + Math.min(Number(ownHalfWidth) || 0, hT)) * MITER_LIMIT_FACTOR;
  let best = null;
  for (const sigma of [1, -1]) {
    const q = { x: s.x + sigma * n.x * hT, y: s.y + sigma * n.y * hT };
    const X = lineIntersection(A, d, q, u);
    if (!X) continue;
    if (Math.abs(X.t - tB) > maxShift) continue;
    if (!best || X.t < best.t) best = X;
  }
  return best;
}

// Trim één rand-uiteinde tegen de nabije randlijn van de doelbalk (T-join).
// `edge` wordt IN PLACE aangepast; retourneert true als er getrimd is.
function _trimEdgeEnd(edge, which, target, ownHalfWidth) {
  if (!edge || edge.length < 2) return false;
  const endIdx = which === 'start' ? 0 : edge.length - 1;
  const prevIdx = which === 'start' ? 1 : edge.length - 2;
  const cut = _nearFaceIntersection(edge[prevIdx], edge[endIdx], target, ownHalfWidth);
  if (!cut) return false;
  edge[endIdx] = { x: cut.x, y: cut.y };
  return true;
}

// L-/hoekverstek op uiteinde P: beide randen worden gesneden met de
// overeenkomstige rand van de aansluitende balk (zelfde randparing als de
// wand-joins: onze +σ-rand tegen de −σ-rand van de partner, in het frame
// van de naar-binnen-wijzende richting dirIn).
function _cornerJoin(edges, which, P, dirIn, h, target) {
  const d2 = _unit(target.far.x - P.x, target.far.y - P.y);
  if (!d2) return;
  const n = { x: -dirIn.y, y: dirIn.x };
  const n2 = { x: -d2.y, y: d2.x };
  const h2 = target.beam.halfWidth;
  const lim = MITER_LIMIT_FACTOR * Math.max(h, h2);
  // σ (in het dirIn-frame) ↔ rand: bij 'start' is dirIn = +u en ligt de
  // left-rand (+n(u)) op σ=+1; bij 'end' is dirIn = −u en ligt de left-rand
  // op σ=−1.
  const map = which === 'start' ? { left: 1, right: -1 } : { left: -1, right: 1 };
  for (const side of ['left', 'right']) {
    const sigma = map[side];
    const e1 = { x: P.x + sigma * n.x * h, y: P.y + sigma * n.y * h };
    const e2 = { x: P.x - sigma * n2.x * h2, y: P.y - sigma * n2.y * h2 };
    const X = lineIntersection(e1, dirIn, e2, d2);
    if (!X || Math.hypot(X.x - P.x, X.y - P.y) > lim) continue; // butt-terugval
    const arr = edges[side];
    arr[which === 'start' ? 0 : arr.length - 1] = { x: X.x, y: X.y };
  }
}

/**
 * Inter-balk-joins: verstek (hoek) of trim (T) op de uiteinden die op een
 * andere balk aansluiten. Muteert ALLEEN de meegegeven edges/center — nooit
 * de doelbalken.
 *
 * @param {{left:Array,right:Array}} edges  Eigen randen (uit beamOutline).
 * @param {Array<{x,y}>} center             Eigen TEKEN-hartlijn [S, E]; bij
 *        een T-join wordt het betreffende uiteinde ingekort tot de nabije
 *        doelrand (alleen de tekenlengte — nooit de annotatie-data).
 * @param {number} ownHalfWidth
 * @param {Array<{points:Array,halfWidth:number}>} others
 * @returns {{joinedStart:boolean, joinedEnd:boolean}}
 */
export function trimAgainstBeams(edges, center, ownHalfWidth, others) {
  const res = { joinedStart: false, joinedEnd: false };
  if (!edges || !center || center.length < 2 || !others || others.length === 0) return res;
  const S = center[0], E = center[center.length - 1];
  const u = _unit(E.x - S.x, E.y - S.y);
  if (!u) return res;
  const ends = [
    { which: 'start', P: S, dirIn: u, flag: 'joinedStart' },
    { which: 'end', P: E, dirIn: { x: -u.x, y: -u.y }, flag: 'joinedEnd' },
  ];
  for (const end of ends) {
    const target = findJoinTarget(end.P, ownHalfWidth, others);
    if (!target) continue;
    if (target.kind === 'corner') {
      _cornerJoin(edges, end.which, end.P, end.dirIn, ownHalfWidth, target);
    } else {
      // T: beide randen én de hartlijn stoppen op de NABIJE doelrand.
      _trimEdgeEnd(edges.left, end.which, target, ownHalfWidth);
      _trimEdgeEnd(edges.right, end.which, target, ownHalfWidth);
      const idx = end.which === 'start' ? 0 : center.length - 1;
      const prev = end.which === 'start' ? center[1] : center[center.length - 2];
      const cut = _nearFaceIntersection(prev, center[idx], target, ownHalfWidth);
      if (cut) center[idx] = { x: cut.x, y: cut.y };
    }
    res[end.flag] = true;
  }
  return res;
}

/**
 * Onderbrekingen ("cutouts") van de EIGEN randen waar een ANDERE balk met
 * een T op deze balk eindigt: de rand van de doorgaande balk wordt over
 * precies de aansluitbreedte opengelaten, zodat de aansluiting open is
 * (geen randlijn dwars over het aansluitvlak). Puur render-/AP-tijd — de
 * eigen én de andermans data blijven onaangetast.
 *
 * Het interval per aansluiting is de PROJECTIE van het aansluitvlak op de
 * rand: de snijpunten van de twee randlijnen van de aansluitende balk met
 * de eigen randlijn (dus ook correct bij schuine aansluitingen).
 *
 * @param {{left:Array,right:Array}} edges  Eigen randen (na joins; per rand
 *        een 2-punts segment).
 * @param {Array<{x,y}>} rawCenter          Eigen hartlijn [S, E].
 * @param {number} halfWidth
 * @param {Array<{points:Array,halfWidth:number}>} others
 * @returns {{left:Array<[number,number]>, right:Array<[number,number]>}}
 *        Gesorteerde, samengevoegde intervallen in afstand langs de rand
 *        (vanaf het rand-startpunt).
 */
export function edgeCutouts(edges, rawCenter, halfWidth, others) {
  const out = { left: [], right: [] };
  if (!edges || !rawCenter || rawCenter.length < 2 || !others || others.length === 0) return out;
  const S = rawCenter[0], E = rawCenter[rawCenter.length - 1];
  const u = _unit(E.x - S.x, E.y - S.y);
  if (!u) return out;
  const n = { x: -u.y, y: u.x };
  const self = { points: rawCenter, halfWidth };

  for (const ob of others) {
    const pts = _cleanPoints(ob?.points);
    if (pts.length < 2 || !(ob.halfWidth > 0)) continue;
    for (const [P, F] of [[pts[0], pts[pts.length - 1]], [pts[pts.length - 1], pts[0]]]) {
      // Alleen een T-aansluiting VAN die balk OP deze balk telt; hoeken
      // worden door de wederzijdse verstek-join afgehandeld.
      const join = findJoinTarget(P, ob.halfWidth, [self]);
      if (!join || join.kind !== 'tee') continue;
      const d = _unit(P.x - F.x, P.y - F.y);
      if (!d) continue;
      // Aankomstzijde: een stukje terug langs de aansluitende balk ligt
      // buiten de eigen band — het teken van de loodrechte component kiest
      // de rand (left = +n, right = −n).
      const back = halfWidth + ob.halfWidth;
      const q = { x: P.x - d.x * back - S.x, y: P.y - d.y * back - S.y };
      const sideSign = q.x * n.x + q.y * n.y;
      if (Math.abs(sideSign) < 1e-9) continue;
      const side = sideSign > 0 ? 'left' : 'right';
      const edge = edges[side];
      if (!edge || edge.length < 2) continue;
      const E0 = edge[0], E1 = edge[edge.length - 1];
      const eDir = _unit(E1.x - E0.x, E1.y - E0.y);
      if (!eDir) continue;
      const eLen = Math.hypot(E1.x - E0.x, E1.y - E0.y);
      const nO = { x: -d.y, y: d.x };
      const ts = [];
      for (const sigma of [1, -1]) {
        const q2 = { x: P.x + sigma * nO.x * ob.halfWidth, y: P.y + sigma * nO.y * ob.halfWidth };
        const X = lineIntersection(E0, eDir, q2, d);
        if (X) ts.push(X.t);
      }
      if (ts.length < 2) continue;
      const t1 = Math.max(0, Math.min(ts[0], ts[1]));
      const t2 = Math.min(eLen, Math.max(ts[0], ts[1]));
      if (t2 - t1 > 1e-6) out[side].push([t1, t2]);
    }
  }

  // Sorteren + overlappende intervallen samenvoegen.
  for (const side of ['left', 'right']) {
    const list = out[side].sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const iv of list) {
      const last = merged[merged.length - 1];
      if (last && iv[0] <= last[1] + 1e-6) last[1] = Math.max(last[1], iv[1]);
      else merged.push([iv[0], iv[1]]);
    }
    out[side] = merged;
  }
  return out;
}

// Zichtbare deelsegmenten van een 2-punts rand na aftrek van de cutouts.
function _edgeRuns(edge, cutouts) {
  const E0 = edge[0], E1 = edge[edge.length - 1];
  const len = Math.hypot(E1.x - E0.x, E1.y - E0.y);
  if (!(len > 1e-9)) return [];
  const dir = { x: (E1.x - E0.x) / len, y: (E1.y - E0.y) / len };
  const at = (t) => ({ x: E0.x + dir.x * t, y: E0.y + dir.y * t });
  const runs = [];
  let cur = 0;
  for (const [t1, t2] of cutouts || []) {
    if (t1 - cur > 1e-6) runs.push({ x1: at(cur).x, y1: at(cur).y, x2: at(t1).x, y2: at(t1).y });
    cur = Math.max(cur, t2);
  }
  if (len - cur > 1e-6) runs.push({ x1: at(cur).x, y1: at(cur).y, x2: at(len).x, y2: at(len).y });
  return runs;
}

/**
 * Ankerpunt (baseline-midden) + hoek van de tag, inclusief de vrije
 * paginaruimte-offset. Gedeeld door buildBetonbalk() en de tag-grip in
 * handles.js, zodat het grippunt exact op de getekende tekst ligt.
 *
 * Aanroepbaar met een kant-en-klaar frame ({rawCenter, halfWidth, params})
 * óf met (ann, halfWidth) — dan wordt het frame hier afgeleid.
 *
 * @returns {{x:number,y:number,angle:number}|null}
 */
export function betonbalkTagAnchor(frameOrAnn, halfWidthArg) {
  let rawCenter, halfWidth, params;
  if (frameOrAnn && Array.isArray(frameOrAnn.rawCenter)) {
    ({ rawCenter, halfWidth, params } = frameOrAnn);
  } else {
    params = resolveBetonbalkParams(frameOrAnn);
    rawCenter = betonbalkCenterline(frameOrAnn);
    halfWidth = Number(halfWidthArg) > 0
      ? Number(halfWidthArg)
      : halfWidthFromMm(params.breedteMm, 0);
  }
  if (!rawCenter) return null;
  const u = _unit(rawCenter[1].x - rawCenter[0].x, rawCenter[1].y - rawCenter[0].y);
  if (!u) return null;
  let angle = Math.atan2(u.y, u.x);
  let dx = u.x, dy = u.y;
  if (angle > Math.PI / 2 || angle < -Math.PI / 2) {
    angle += angle > 0 ? -Math.PI : Math.PI;
    dx = -dx; dy = -dy;
  }
  const midX = (rawCenter[0].x + rawCenter[1].x) / 2;
  const midY = (rawCenter[0].y + rawCenter[1].y) / 2;
  // "Boven" in leesrichting: −perp(d) (schermassen, y omlaag).
  const upX = dy, upY = -dx;
  const off = halfWidth + params.tagFontSize * 0.45;
  return {
    x: midX + upX * off + params.tagOffsetX,
    y: midY + upY * off + params.tagOffsetY,
    angle,
  };
}

/**
 * Bouw de volledige betonbalk-geometrie.
 *
 * @param {object} ann  Annotatie met startX/startY/endX/endY + parameters.
 * @param {object} [opts]
 * @param {number} [opts.halfWidth]  Halve breedte in app-px (schaalbewust,
 *        van betonbalk-scale.js). Ontbreekt hij, dan volgt hij uit
 *        breedteMm × 1:100.
 * @param {Array<{points:Array,halfWidth:number}>} [opts.others]
 *        Andere betonbalken op dezelfde pagina (voor de inter-balk-joins).
 * @param {(text:string,size:number)=>number} [opts.measureText]
 *        Echte tekstbreedte-meter voor de tag. Default: schatting.
 * @returns {{
 *   params:object, halfWidth:number,
 *   center:Array, rawCenter:Array, edges:{left:Array,right:Array},
 *   caps:Array<{x1,y1,x2,y2}>, joinedStart:boolean, joinedEnd:boolean,
 *   outline:Array, styles:{edgeDash:Array|null,centerDash:Array|null},
 *   tag:{text,x,y,angle,fontSize,width}|null,
 *   aabb:{x:number,y:number,width:number,height:number}
 * }|null}
 */
export function buildBetonbalk(ann, opts = {}) {
  const params = resolveBetonbalkParams(ann);
  const rawCenter = betonbalkCenterline(ann);
  if (!rawCenter) return null;
  const halfWidth = Number(opts.halfWidth) > 0
    ? Number(opts.halfWidth)
    : halfWidthFromMm(params.breedteMm, 0);

  const edges = beamOutline(rawCenter, halfWidth);
  if (!edges) return null;

  // Teken-hartlijn: kopie — een T-join kort het betreffende uiteinde in,
  // de annotatie-data (rawCenter) blijft onaangetast.
  const center = rawCenter.map(p => ({ x: p.x, y: p.y }));
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

  // Tag: standaard gecentreerd langs de balk, boven de hartlijn, meegeroteerd
  // met de balkrichting en nooit ondersteboven; daarna de vrije
  // paginaruimte-offset (versleepbaar grippunt) erbij.
  let tag = null;
  if (params.tagTonen) {
    const measure = typeof opts.measureText === 'function' ? opts.measureText : approxTextWidth;
    const anchor = betonbalkTagAnchor({ rawCenter, halfWidth, params });
    if (anchor) {
      tag = {
        text: params.tagTekst,
        x: anchor.x,
        y: anchor.y,
        angle: anchor.angle,
        fontSize: params.tagFontSize,
        width: measure(params.tagTekst, params.tagFontSize),
      };
    }
  }

  // Open T-aansluitingen: eigen randen onderbreken waar een andere balk op
  // deze balk eindigt (render-/AP-tijd; muteert niets).
  const cutouts = edgeCutouts(edges, rawCenter, halfWidth, opts.others);
  const edgeRuns = {
    left: _edgeRuns(edges.left, cutouts.left),
    right: _edgeRuns(edges.right, cutouts.right),
  };

  // Gesloten omtrek (voor hit-test en de /Vertices in de PDF).
  const outline = [...edges.left, ...edges.right.slice().reverse()];

  // AABB over randen + hartlijn + tagvak.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x, y) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  for (const p of [...outline, ...center, ...rawCenter]) grow(p.x, p.y);
  if (tag) {
    const c = Math.cos(tag.angle), s = Math.sin(tag.angle);
    const half = tag.fontSize * 0.6;
    for (const t of [-tag.width / 2, tag.width / 2]) {
      for (const v of [-half, half]) {
        grow(tag.x + c * t - s * v, tag.y + s * t + c * v);
      }
    }
  }

  return {
    params,
    halfWidth,
    center,
    rawCenter,
    edges,
    edgeRuns,
    cutouts,
    caps,
    joinedStart,
    joinedEnd,
    outline,
    styles: betonbalkLineStyles(params.lijnstijl),
    tag,
    aabb: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
  };
}
