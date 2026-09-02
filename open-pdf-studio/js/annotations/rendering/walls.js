// Wall segments (plattegrond) — render + geometry helpers.
//
// A wall is a LINE-like annotation (startX/Y–endX/Y) with a real-world
// thickness `dikteMm` and a material hatch (`hatchPattern`). Because it
// stores plain start/end fields it inherits the whole CAD toolchain for
// free: G/MV move (generic applyMove walker), endpoint grips, object snap,
// and the trim/extend "make corner" tools.
//
// Corner joins: when two wall endpoints coincide (within JOIN_TOL) their
// band outlines are MITRED — each shared corner is the intersection of the
// matching band edges, so trimmed walls close perfectly. Free ends get a
// butt cap.

import { getMeasureScale } from '../measurement.js';
import { getRegionScaleFactor } from '../scale-region.js';
import { applyHatchFillPolygon } from './hatch-patterns.js';
import { kruisendeHoek } from '../hoek-trim.js';

const UNIT_TO_MM = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };
const JOIN_TOL = 1.5;     // page-pt endpoint coincidence tolerance
const MITER_LIMIT = 6;    // × max(halfW) — beyond this fall back to butt

// ── Wall material registry — SINGLE SOURCE for renderer + properties UI ───
// kind 'hatch' = TWO-layer fill: solid background colour (`bg`) + a line
// pattern from the hatch catalog in `fg` colour (NEN convention: metselwerk
// = red diagonal on light red, beton = black diagonal on grey, …).
// kind 'iso' = insulation: solid background + 60° zigzag spanning the full
// wall thickness (triangles scale with dikte).
// `dens` = pattern density (filledArea convention, 100 = standard; lower =
// denser).
// Colours/patterns for the stone materials come from the INB template
// (style-types NEN47 rows): metselwerk = BLACK paired 45° lines on brick red
// #CD7C61 at scale 213; kunststeen/kalkzandsteen = black single 45° on
// #C0C0C0 at 106. Beton = fine black diagonal on grey 128.
export const WALL_MATERIALS = [
  { id: 'nen47-metselwerk-baksteen', label: 'Metselwerk', kind: 'hatch', bg: '#CD7C61', fg: '#000000', pattern: 'wand-metselwerk', dens: 100 },
  { id: 'nen47-metselwerk-kunststeen', label: 'Kalkzandsteen', kind: 'hatch', bg: '#C0C0C0', fg: '#000000', pattern: 'nen47-metselwerk-kunststeen', dens: 500 },
  { id: 'nen47-beton-prefab', label: 'Prefab beton', kind: 'hatch', bg: '#808080', fg: '#000000', pattern: 'diagonal-left', dens: 180 },
  { id: 'nen47-beton-gewapend', label: 'Beton (gewapend)', kind: 'hatch', bg: '#9c9c9c', fg: '#000000', pattern: 'diagonal-right', dens: 180 },
  { id: 'isolatie', label: 'Isolatie', kind: 'iso' },
  { id: 'none', label: 'Geen arcering', kind: 'none' },
];

// Insulation sub-materials (param `isolatieType` on the wall): background
// colour per the reference sheet + a darker tone for the 60° zigzag.
export const ISOLATIE_MATERIALEN = [
  { id: 'steenwol', label: 'Steenwol', bg: '#b3a04a', fg: '#6f6328' },
  { id: 'glaswol', label: 'Glaswol', bg: '#fbe98a', fg: '#b3a14e' },
  { id: 'pir', label: 'PIR', bg: '#f2eec9', fg: '#b0a978' },
  { id: 'eps', label: 'EPS', bg: '#dbdbe3', fg: '#94949f' },
  { id: 'kooltherm', label: 'Kooltherm', bg: '#d98d7d', fg: '#96544a' },
  { id: 'pur', label: 'PUR', bg: '#ccd4b4', fg: '#8b9470' },
];

const _MAT_BY_ID = new Map(WALL_MATERIALS.map(m => [m.id, m]));
const _ISO_BY_ID = new Map(ISOLATIE_MATERIALEN.map(m => [m.id, m]));

/** Resolve a wall's material — accepts the current ids AND the legacy
 *  'iso-<materiaal>' hatchPattern values (older walls keep rendering). */
export function resolveWallMaterial(ann) {
  const id = ann?.hatchPattern;
  if (!id || id === 'none') return null;
  if (id.startsWith('iso-')) {
    return { ..._MAT_BY_ID.get('isolatie'), iso: _ISO_BY_ID.get(id.slice(4)) || ISOLATIE_MATERIALEN[0] };
  }
  const mat = _MAT_BY_ID.get(id);
  if (!mat) return { id, kind: 'hatch', pattern: id }; // raw catalog pattern id
  if (mat.kind === 'iso') {
    return { ...mat, iso: _ISO_BY_ID.get(ann?.isolatieType) || ISOLATIE_MATERIALEN[0] };
  }
  return mat;
}

export function wallHalfWidthPx(ann) {
  const ms = getMeasureScale(ann.page, ann.startX, ann.startY);
  const pxPerMm = (ms.pixelsPerUnit || 1) / (UNIT_TO_MM[ms.unit || 'mm'] || 1);
  return Math.max(0.25, ((ann.dikteMm || 100) * pxPerMm) / 2);
}

function _unit(dx, dy) {
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  return { x: dx / len, y: dy / len };
}

// Line-line intersection (infinite lines through p along d).
function _isect(p1, d1, p2, d2) {
  const denom = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(denom) < 1e-9) return null; // parallel/collinear
  const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / denom;
  return { x: p1.x + d1.x * t, y: p1.y + d1.y * t };
}

// Find another wall whose endpoint coincides with (px,py), or — when the
// endpoints only PASS each other — whose centreline crosses ours right by
// both ends (see hoek-trim.js). The latter returns `at`: the corner point
// the two walls are trimmed/extended to.
function _jointPartner(walls, self, px, py, eigenVer, halfW) {
  for (const o of walls) {
    if (o === self || o.id === self.id) continue;
    if (Math.hypot(o.startX - px, o.startY - py) <= JOIN_TOL) {
      return { wall: o, far: { x: o.endX, y: o.endY } };
    }
    if (Math.hypot(o.endX - px, o.endY - py) <= JOIN_TOL) {
      return { wall: o, far: { x: o.startX, y: o.startY } };
    }
  }
  // Kruisende hoek: los getekende wanden die elkaar bij de hoek net
  // passeren (of net te kort blijven) horen óók één nette hoek te vormen.
  if (!eigenVer) return null;
  let beste = null;
  for (const o of walls) {
    if (o === self || o.id === self.id) continue;
    const kruis = kruisendeHoek(
      { x: px, y: py }, eigenVer,
      { x: o.startX, y: o.startY }, { x: o.endX, y: o.endY },
      halfW, wallHalfWidthPx(o),
    );
    if (kruis && (!beste || kruis.score < beste.score)) {
      beste = { wall: o, far: kruis.far, at: kruis.at, score: kruis.score };
    }
  }
  return beste;
}

// Corner pair at endpoint P of `ann`. dirIn = unit vector from P INTO the
// wall body. Returns { plus, minus, joined } where plus/minus are the band
// corners on the +perp / -perp side (perp of dirIn).
function _cornersAt(ann, walls, P0, dirIn, halfW, eigenVer) {
  const n = { x: -dirIn.y, y: dirIn.x };
  const def = {
    plus: { x: P0.x + n.x * halfW, y: P0.y + n.y * halfW },
    minus: { x: P0.x - n.x * halfW, y: P0.y - n.y * halfW },
    joined: false,
  };
  const partner = _jointPartner(walls, ann, P0.x, P0.y, eigenVer, halfW);
  if (!partner) return def;
  // Bij een kruisende hoek ligt het hoekpunt op het snijpunt van de
  // hartlijnen — de band wordt daarheen getrimd of doorgetrokken. De
  // annotatie zelf blijft ongemoeid; dit is puur rendergeometrie.
  const P = partner.at || P0;
  const dir2 = _unit(partner.far.x - P.x, partner.far.y - P.y);
  if (!dir2) return def;
  const h2 = wallHalfWidthPx(partner.wall);
  const n2 = { x: -dir2.y, y: dir2.x };
  const lim = MITER_LIMIT * Math.max(halfW, h2);
  // Matching edge pairing for the away-from-P direction convention: the
  // +σ edge of this wall meets the -σ edge of the partner (see derivation
  // in the corner cases: L-joints both turn directions).
  const mk = (sigma, fallback) => {
    const e1 = { x: P.x + sigma * n.x * halfW, y: P.y + sigma * n.y * halfW };
    const e2 = { x: P.x - sigma * n2.x * h2, y: P.y - sigma * n2.y * h2 };
    const ix = _isect(e1, dirIn, e2, dir2);
    if (!ix || Math.hypot(ix.x - P.x, ix.y - P.y) > lim) return fallback;
    return ix;
  };
  return {
    plus: mk(1, def.plus),
    minus: mk(-1, def.minus),
    joined: true,
  };
}

// Band polygon for a wall, mitred against joined neighbours.
// Returns { poly: [sPlus, ePlus, eMinus, sMinus], joinedStart, joinedEnd }
// or null for degenerate walls.
export function computeWallShape(ann, annotations) {
  const u = _unit(ann.endX - ann.startX, ann.endY - ann.startY);
  if (!u) return null;
  const halfW = wallHalfWidthPx(ann);
  const walls = (annotations || []).filter(a => a.type === 'wall' && a.page === ann.page);
  const S = { x: ann.startX, y: ann.startY };
  const E = { x: ann.endX, y: ann.endY };
  // dirIn at S is u; at E it is -u. perp(u) = n; perp(-u) = -n — so the
  // band edge on +n is σ=+1 at S and σ=-1 at E.
  const cs = _cornersAt(ann, walls, S, u, halfW, E);
  const ce = _cornersAt(ann, walls, E, { x: -u.x, y: -u.y }, halfW, S);
  return {
    poly: [cs.plus, ce.minus, ce.plus, cs.minus],
    joinedStart: cs.joined,
    joinedEnd: ce.joined,
  };
}

// Insulation fill: solid background + 60° triangle-wave zigzag spanning the
// full band thickness (apexes slightly inset so they stay visible inside
// the outline). Drawn clipped to the (mitred) band polygon so corners stay
// clean; the zigzag runs along the wall axis. Colours per ISOLATIE_MATERIALEN.
function _drawIsolatieFill(ctx, ann, shape, mat) {
  const u = _unit(ann.endX - ann.startX, ann.endY - ann.startY);
  if (!u) return;
  const n = { x: -u.y, y: u.x };
  const halfW = wallHalfWidthPx(ann);
  const len = Math.hypot(ann.endX - ann.startX, ann.endY - ann.startY);
  // 60° legs relative to the wall axis → run per leg = D/tan60.
  const step = Math.max((2 * halfW) / Math.tan(Math.PI / 3), 0.5);
  const iso = mat.iso || {};

  ctx.save();
  ctx.beginPath();
  const p = shape.poly;
  ctx.moveTo(p[0].x, p[0].y);
  for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y);
  ctx.closePath();
  ctx.clip();

  // Background colour
  ctx.fillStyle = iso.bg || mat.bg || '#eeeeee';
  ctx.fill();

  // Zigzag in a darker tone of the material colour. Overshoot half a step
  // on both ends so mitred corners stay covered; apexes inset ~8% so the
  // triangle tips don't get clipped flat by the outline.
  ctx.strokeStyle = iso.fg || '#7a7a7a';
  ctx.lineWidth = Math.max(0.35, Math.min(0.7, halfW * 0.07));
  const amp = halfW * 0.92;
  ctx.beginPath();
  let along = -step;
  let side = -1;
  const pt = (a, s) => ({
    x: ann.startX + u.x * a + n.x * s * amp,
    y: ann.startY + u.y * a + n.y * s * amp,
  });
  const first = pt(along, side);
  ctx.moveTo(first.x, first.y);
  while (along < len + step) {
    along += step;
    side = -side;
    const q = pt(along, side);
    ctx.lineTo(q.x, q.y);
  }
  ctx.stroke();
  ctx.restore();
}

export function drawWall(ctx, ann, annotations) {
  const shape = computeWallShape(ann, annotations);
  if (!shape) return;
  const [sP, eP, eM, sM] = shape.poly;
  const stroke = ann.strokeColor || ann.color || '#000000';

  const mat = resolveWallMaterial(ann);

  if (mat && mat.kind === 'iso') {
    // Insulation material: bg colour + thickness-scaled 60° zigzag.
    _drawIsolatieFill(ctx, ann, shape, mat);
  } else if (mat) {
    // Two-layer material fill: solid background colour first…
    if (mat?.bg) {
      ctx.save();
      ctx.beginPath();
      const p = shape.poly;
      ctx.moveTo(p[0].x, p[0].y);
      for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y);
      ctx.closePath();
      ctx.fillStyle = mat.bg;
      ctx.fill();
      ctx.restore();
    }
    // …then the line pattern in the material's own colour. Material
    // hatches are PAPER-FIXED (constant pitch on paper, NEN practice):
    // dens 100 = standard pitch, lower = denser. No region factor.
    // hatchScale === 100 counts as "default" (older walls had 100 baked in
    // at creation) — only a deliberately different value overrides dens.
    const densEff = (ann.hatchScale != null && ann.hatchScale !== 100)
      ? ann.hatchScale
      : (mat.dens ?? 100);
    // The pattern is ALIGNED WITH THE WALL: its 45° runs relative to the
    // wall axis, so a sloped wall keeps the same look as a horizontal one.
    const wallAngleDeg = Math.atan2(ann.endY - ann.startY, ann.endX - ann.startX) * 180 / Math.PI;
    applyHatchFillPolygon(
      ctx, shape.poly, null,
      mat.pattern || mat.id,
      ann.hatchColor || mat.fg || stroke,
      densEff,
      (ann.hatchAngle ?? 0) + wallAngleDeg
    );
  }

  // Outline: walk the band polygon edge-by-edge. poly order is
  // [S+, E+, E−, S−] when read as consecutive corners, so the LONG edges are
  // poly[0]→poly[1] and poly[2]→poly[3]; the end caps are poly[1]→poly[2]
  // (E) and poly[3]→poly[0] (S). Long edges always stroke; caps only on
  // free (unjoined) ends so a joined corner stays open and the partner
  // wall runs through. (Pairing the wrong corners draws an X through the
  // band — the original bug.)
  ctx.strokeStyle = stroke;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(sP.x, sP.y); ctx.lineTo(eP.x, eP.y);   // long edge 1
  ctx.moveTo(eM.x, eM.y); ctx.lineTo(sM.x, sM.y);   // long edge 2
  if (!shape.joinedEnd) { ctx.moveTo(eP.x, eP.y); ctx.lineTo(eM.x, eM.y); }
  if (!shape.joinedStart) { ctx.moveTo(sM.x, sM.y); ctx.lineTo(sP.x, sP.y); }
  ctx.stroke();
}

// Hit-test helper for geometry.js: inside the band (or near its centreline).
export function isPointOnWall(ann, x, y, tol) {
  const halfW = wallHalfWidthPx(ann);
  // Distance from point to the centreline SEGMENT
  const dx = ann.endX - ann.startX, dy = ann.endY - ann.startY;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((x - ann.startX) * dx + (y - ann.startY) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const px = ann.startX + t * dx, py = ann.startY + t * dy;
  return Math.hypot(x - px, y - py) <= halfW + (tol || 0);
}
