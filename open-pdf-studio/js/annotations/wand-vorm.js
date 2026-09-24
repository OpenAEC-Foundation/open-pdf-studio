// Wandvorm — de band van een wand met zijn aansluitingen. Pure module.
//
// Uit de wand en zijn buren op dezelfde pagina komen:
//   - poly: de band [S+, E+, E−, S−] voor vulling en arcering, met verstek
//     (hoek) of afgekapt op het vlak van een doorgaande wand (T);
//   - lijnen: de omtrek als losse lijnstukken. Een lange rand is onderbroken
//     waar een wand van hetzelfde materiaal als T aansluit; een kap staat
//     alleen op een vrij uiteinde en op de naad van een T met een ander
//     materiaal.
// Scherm (rendering/walls.js), opgeslagen appearance (saver.js) en objectsnap
// gebruiken dezelfde uitkomst. WIE de partner van een uiteinde is, beslist
// wand-join.js.
//
// halfW(w) geeft de halve dikte in paginapunten (de app rekent die om met de
// schaal van het blad; de tests gebruiken 1 pt = 1 mm).

import { zoekJoinPartner, tAansluiting, zelfdeLaag, JOIN_TOL } from './wand-join.js';

/** × max(halve dikte): verder weg liggende verstekpunten worden een stompe kap. */
export const MITER_LIMIT = 6;

function unit(dx, dy) {
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  return { x: dx / len, y: dy / len };
}

// Snijpunt van twee oneindige lijnen (p + d·t); null bij evenwijdig.
function isect(p1, d1, p2, d2) {
  const noemer = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(noemer) < 1e-9) return null;
  const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / noemer;
  return { x: p1.x + d1.x * t, y: p1.y + d1.y * t };
}

function isZelfde(a, b) {
  return a === b || (a?.id != null && a.id === b?.id);
}

function punt(w, eind) {
  return eind === 'start' ? { x: w.startX, y: w.startY } : { x: w.endX, y: w.endY };
}

// Hoekpunten van uiteinde `eind` (punt P0) van `ann`. dirIn = eenheidsvector
// van P0 de wand IN. plus/minus = de bandhoeken aan de +n/−n-kant (n = de
// loodrechte van dirIn). joined = geen kap op dit uiteinde.
function hoekenBij(ann, wanden, eind, P0, dirIn, h, halfW) {
  const n = { x: -dirIn.y, y: dirIn.x };
  const def = {
    plus: { x: P0.x + n.x * h, y: P0.y + n.y * h },
    minus: { x: P0.x - n.x * h, y: P0.y - n.y * h },
    joined: false,
  };
  const partner = zoekJoinPartner(ann, eind, wanden, halfW);
  if (!partner) return def;
  const h2 = halfW(partner.wall);
  const lim = MITER_LIMIT * Math.max(h, h2);

  if (partner.soort === 'T') {
    // Beide randen stoppen op het nabije vlak van de doorgaande wand. Zelfde
    // materiaal: geen kap (de doorgaande wand onderbreekt zijn vlaklijn,
    // zie tGaten). Ander materiaal: kap op de naad.
    const opVlak = (sigma) => {
      const e = { x: P0.x + sigma * n.x * h, y: P0.y + sigma * n.y * h };
      const ix = isect(e, dirIn, partner.vlak.p, partner.vlak.u);
      return ix && Math.hypot(ix.x - P0.x, ix.y - P0.y) <= lim ? ix : null;
    };
    const plus = opVlak(1), minus = opVlak(-1);
    if (!plus || !minus) return def;
    return { plus, minus, joined: partner.zelfdeLaag === true };
  }

  // Hoek. Bij een kruisende hoek ligt het hoekpunt op het snijpunt van de
  // hartlijnen: de band wordt daarheen getrimd of doorgetrokken. De
  // annotatie zelf blijft ongemoeid; dit is puur tekengeometrie.
  const P = partner.at || P0;
  const dir2 = unit(partner.far.x - P.x, partner.far.y - P.y);
  if (!dir2) return def;
  const n2 = { x: -dir2.y, y: dir2.x };
  // Bij de richting "weg van P" hoort de +σ-rand van deze wand bij de
  // −σ-rand van de partner (L-hoeken in beide draairichtingen).
  const mk = (sigma, fallback) => {
    const e1 = { x: P.x + sigma * n.x * h, y: P.y + sigma * n.y * h };
    const e2 = { x: P.x - sigma * n2.x * h2, y: P.y - sigma * n2.y * h2 };
    const ix = isect(e1, dirIn, e2, dir2);
    if (!ix || Math.hypot(ix.x - P.x, ix.y - P.y) > lim) return fallback;
    return ix;
  };
  return { plus: mk(1, def.plus), minus: mk(-1, def.minus), joined: true };
}

function zelfdeVlak(a, b) {
  if (Math.abs(a.u.x * b.u.y - a.u.y * b.u.x) > 1e-6) return false;
  const afstand = Math.abs((a.p.x - b.p.x) * b.u.y - (a.p.y - b.p.y) * b.u.x);
  return afstand <= JOIN_TOL;
}

/**
 * De onderbrekingen in de randen van `ann`: waar een wand van hetzelfde
 * materiaal als T op `ann` stopt, verdwijnt de vlaklijn over de breedte van
 * die wand. Ook als de aansluitende wand zijn T bij een ander stuk van
 * dezelfde doorgaande wand vond (een wand in stukken): dan telt het deel van
 * zijn voetafdruk dat op dit stuk valt.
 * @returns {Array<{zijde:1|-1, t0:number, t1:number}>}  t langs de as vanaf
 *   het beginpunt; zijde volgens de normaal (-u.y, u.x).
 */
export function tGaten(ann, wanden, halfW) {
  const u = unit(ann.endX - ann.startX, ann.endY - ann.startY);
  if (!u) return [];
  const gaten = [];
  for (const w of wanden || []) {
    if (!w || isZelfde(w, ann) || !zelfdeLaag(w, ann)) continue;
    const hW = halfW(w);
    for (const eind of ['start', 'end']) {
      const t = tAansluiting(w, eind, ann, halfW, wanden, { marge: hW + JOIN_TOL });
      if (!t) continue;
      const p = zoekJoinPartner(w, eind, wanden, halfW);
      if (!p || p.soort !== 'T' || !p.zelfdeLaag || !zelfdeVlak(p.vlak, t.vlak)) continue;
      const uw = unit(w.endX - w.startX, w.endY - w.startY);
      const dirIn = eind === 'start' ? uw : { x: -uw.x, y: -uw.y };
      const nw = { x: -dirIn.y, y: dirIn.x };
      const P = punt(w, eind);
      const ts = [1, -1].map((s) => {
        const ix = isect({ x: P.x + s * nw.x * hW, y: P.y + s * nw.y * hW }, dirIn, t.vlak.p, t.vlak.u);
        return ix ? (ix.x - ann.startX) * u.x + (ix.y - ann.startY) * u.y : null;
      });
      if (ts.some((v) => v === null)) continue;
      gaten.push({ zijde: t.zijde, t0: Math.min(...ts), t1: Math.max(...ts) });
    }
  }
  return gaten;
}

/**
 * Rand p0 → p1 (evenwijdig aan de as S + u·t) zonder de gaten
 * [{t0, t1}] (t langs de as). Geeft de overblijvende lijnstukken.
 */
export function onderbreekRand(p0, p1, S, u, gaten) {
  const tVan = (p) => (p.x - S.x) * u.x + (p.y - S.y) * u.y;
  const ta = tVan(p0), tb = tVan(p1);
  const seg = (a, b) => ({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  if (!gaten || !gaten.length || Math.abs(tb - ta) < 1e-9) return [seg(p0, p1)];
  const op = (t) => {
    const f = (t - ta) / (tb - ta);
    return { x: p0.x + (p1.x - p0.x) * f, y: p0.y + (p1.y - p0.y) * f };
  };
  const lo = Math.min(ta, tb), hi = Math.max(ta, tb);
  const weg = gaten
    .map((g) => [Math.max(lo, Math.min(g.t0, g.t1)), Math.min(hi, Math.max(g.t0, g.t1))])
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  const stukken = [];
  let cursor = lo;
  for (const [a, b] of weg) {
    if (a > cursor + 1e-6) stukken.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (hi > cursor + 1e-6) stukken.push([cursor, hi]);
  // Richting van de oorspronkelijke rand aanhouden.
  return stukken.map(([a, b]) => (ta <= tb ? seg(op(a), op(b)) : seg(op(b), op(a))));
}

/**
 * De vorm van wand `ann` tussen zijn buren.
 * @returns {{poly:Array<{x,y}>, joinedStart:boolean, joinedEnd:boolean,
 *   lijnen:Array<{x1,y1,x2,y2}>}|null}  null bij een wand zonder lengte.
 */
export function wandVorm(ann, wanden, halfW) {
  const u = unit(ann.endX - ann.startX, ann.endY - ann.startY);
  if (!u) return null;
  const h = halfW(ann);
  const lijst = wanden || [];
  const S = { x: ann.startX, y: ann.startY };
  const E = { x: ann.endX, y: ann.endY };
  // dirIn bij S is u, bij E −u; loodrecht(u) = n, loodrecht(−u) = −n. De
  // rand aan de +n-kant is dus σ=+1 bij S en σ=−1 bij E.
  const cs = hoekenBij(ann, lijst, 'start', S, u, h, halfW);
  const ce = hoekenBij(ann, lijst, 'end', E, { x: -u.x, y: -u.y }, h, halfW);
  const poly = [cs.plus, ce.minus, ce.plus, cs.minus];

  // Lange randen: poly[0]→poly[1] (+n) en poly[2]→poly[3] (−n); kappen:
  // poly[1]→poly[2] (eind) en poly[3]→poly[0] (begin), alleen waar niet
  // gejoind. (De verkeerde hoeken koppelen tekent een X door de band.)
  const gaten = tGaten(ann, lijst, halfW);
  const lijnen = [
    ...onderbreekRand(poly[0], poly[1], S, u, gaten.filter((g) => g.zijde === 1)),
    ...onderbreekRand(poly[2], poly[3], S, u, gaten.filter((g) => g.zijde === -1)),
  ];
  if (!ce.joined) lijnen.push({ x1: poly[1].x, y1: poly[1].y, x2: poly[2].x, y2: poly[2].y });
  if (!cs.joined) lijnen.push({ x1: poly[3].x, y1: poly[3].y, x2: poly[0].x, y2: poly[0].y });
  return { poly, joinedStart: cs.joined, joinedEnd: ce.joined, lijnen };
}
