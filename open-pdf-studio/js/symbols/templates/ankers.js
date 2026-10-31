// Parametric ANCHORS in concrete (ankers) — side view as a section through
// the concrete, plus a plan view. Same drawing conventions and building
// blocks as the bolt (templates/bout.js): hex nut with facets and chamfer
// curves, ISO 7089 washer, thin continuous thread lines, thick thread-end
// line, 45° chamfered rod ends, thin dash-dot axis.
//
// Types (param `type`):
//   'stort-moer'  — cast-in anchor bolt, nut + washer at the bottom
//   'stort-plaat' — cast-in anchor bolt, square anchor plate + nut
//   'stort-L'     — cast-in anchor bolt with a 90° hook (L)
//   'stort-J'     — cast-in anchor bolt with a 180° hook (J)
//   'chemisch'    — chemical (bonded) anchor: threaded rod in a drilled hole
//                   filled with mortar
//   'keil'        — expansion (wedge) anchor: thread, neck, cone and
//                   expansion clip in a drilled hole
//   'kopbout'     — headed stud welded under a plate cast flush with the
//                   concrete surface
//
// Section conventions: the concrete is hatched, the drilled hole and the
// fixture plate are cut (their edges drawn), the anchor, washer and nut are
// not cut (drawn in elevation, as usual for fasteners). The concrete zone
// has no outline apart from the surface line; the hatch shows its extent.
//
// Local frame (mm): x across, axis at x = 0 (the drawing runs from
// -links to +rechts); y down, concrete surface at
// y = 0 (above the surface y < 0). realSizeMm is exactly the drawn extent.

import {
  BOUT_MATEN, zeskantHoekmaat, kernDiameter,
  zeskantZijaanzicht, ringZijaanzicht, schachtZijaanzicht, hartlijnZijaanzicht,
} from './bout.js';

export const ANKER_MATEN = Object.keys(BOUT_MATEN).filter((k) => k !== 'M6');

export const ANKER_TYPEN = [
  { value: 'stort-moer', label: 'Ankerbout ingestort, moer + ring', labelEn: 'Cast-in anchor bolt, nut + washer' },
  { value: 'stort-plaat', label: 'Ankerbout ingestort, ankerplaat', labelEn: 'Cast-in anchor bolt, anchor plate' },
  { value: 'stort-L', label: 'Ankerbout ingestort, L-haak', labelEn: 'Cast-in anchor bolt, L-hook' },
  { value: 'stort-J', label: 'Ankerbout ingestort, J-haak', labelEn: 'Cast-in anchor bolt, J-hook' },
  { value: 'chemisch', label: 'Chemisch anker (lijmanker)', labelEn: 'Chemical anchor' },
  { value: 'keil', label: 'Keilbout (expansieanker)', labelEn: 'Wedge anchor' },
  { value: 'kopbout', label: 'Kopbout (deuvel)', labelEn: 'Headed stud' },
];
const TYPE_WAARDEN = ANKER_TYPEN.map((t) => t.value);

/** Default embedment depth hef (mm) per anchor family and size. */
export const HEF_STANDAARD = {
  // cast-in: about 15·d
  stort: { M8: 120, M10: 150, M12: 180, M16: 240, M20: 300, M22: 330, M24: 360 },
  // bonded anchors, standard embedment (about 8–10·d)
  chemisch: { M8: 80, M10: 90, M12: 110, M16: 125, M20: 170, M22: 190, M24: 210 },
  // wedge anchors, standard embedment
  keil: { M8: 50, M10: 60, M12: 70, M16: 85, M20: 100, M22: 110, M24: 125 },
  // headed studs: stud length under the plate about 6·d
  kopbout: { M8: 50, M10: 65, M12: 75, M16: 100, M20: 125, M22: 140, M24: 150 },
};
// Smallest embedment the drawing supports, as a multiple of d.
const HEF_MIN = { stort: 6, chemisch: 4, keil: 4, kopbout: 3 };

const LW_DUN = 0.5;
const BETON_KLEUR = '#808080';
const MORTEL_KLEUR = '#c8c8c8';

function _getal(v, standaard) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : standaard;
}

function _familie(type) {
  return type.startsWith('stort') ? 'stort' : type;
}

/** Drilled-hole diameter d0 of a chemical anchor: d + 2 up to M16, d + 4 above. */
export function boorgatChemisch(d) {
  return d + (d <= 16 ? 2 : 4);
}

/** Normalised parameters (with the automatic values filled in). */
export function ankerParams(params = {}) {
  const p = params || {};
  const maat = ANKER_MATEN.includes(p.maat) ? p.maat : 'M16';
  const g = { naam: maat, ...BOUT_MATEN[maat] };
  const type = TYPE_WAARDEN.includes(p.type) ? p.type : 'stort-moer';
  const fam = _familie(type);
  const d = g.d;
  const hefIn = _getal(p.hef, 0);
  const plaatDikte = Math.max(0, _getal(p.plaatDikte, 10));
  // A headed stud needs at least one diameter of shank under its plate.
  const hef = Math.max(
    hefIn > 0 ? hefIn : HEF_STANDAARD[fam][maat], HEF_MIN[fam] * d,
    type === 'kopbout' ? plaatDikte + d : 0,
  );
  const stub = 0.6 * d;
  const uitsteekMin = type === 'kopbout' ? 0 : plaatDikte + g.ringT + g.m + stub;
  const uitsteekIn = Math.max(0, _getal(p.uitsteek, 0));
  const uitsteek = type === 'kopbout' ? 0 : Math.max(uitsteekIn, uitsteekMin);
  const haakIn = Math.max(0, _getal(p.haakLengte, 0));
  const haakLengte = haakIn > 0 ? haakIn : (type === 'stort-J' ? 3 * d : 4 * d);
  const schaal = _getal(p.schaal, 1) > 0 ? _getal(p.schaal, 1) : 1;
  return {
    maat, g, type, familie: fam, hef, plaatDikte, uitsteek, haakLengte,
    aanzicht: p.aanzicht === 'boven' ? 'boven' : 'zij',
    betonArcering: p.betonArcering !== false,
    schaal,
  };
}

/**
 * All geometry of the side view in local mm (see the frame above): the
 * width of the drawing left and right of the axis, the extent above and
 * below the surface and the type-specific dimensions.
 */
export function ankerGeometrie(params) {
  const q = ankerParams(params);
  const { g, type, hef, plaatDikte: tf } = q;
  const d = g.d;
  const e = zeskantHoekmaat(g.s);
  const geo = { ...q, d, e };

  // Bar bend for the hooks: inner radius 2d, centre-line radius R.
  geo.R = 2.5 * d;
  // Anchor plate (cast-in): square, side 3.5d, thickness 0.5d (min 6).
  geo.plaatZijde = 3.5 * d;
  geo.plaatT = Math.max(6, Math.round(0.5 * d));
  // Headed stud: head Ø about 2d, head height about 0.55d (ISO 13918 range).
  geo.kopD = 2 * d;
  geo.kopH = 0.55 * d;
  // Drilled holes: drill point 118° → point depth 0.6·r.
  if (type === 'chemisch') {
    geo.d0 = boorgatChemisch(d);
    geo.h0 = hef;
  } else if (type === 'keil') {
    geo.d0 = d;
    geo.h0 = hef + 0.3 * d;
  }
  if (geo.d0) geo.boorpunt = 0.6 * (geo.d0 / 2);
  // Fixture-plate clearance hole and visible plate width.
  geo.df = d + 2;

  let diepste;
  let reik = 0;                                 // reach right of the axis (hooks)
  switch (type) {
    case 'stort-moer': diepste = hef + g.ringT + g.m + 0.6 * d; break;
    case 'stort-plaat': diepste = hef + geo.plaatT + g.m + 0.6 * d; break;
    case 'stort-L': diepste = hef; reik = geo.R + q.haakLengte; break;
    case 'stort-J': diepste = hef; reik = 2 * geo.R + d / 2; break;
    case 'chemisch':
    case 'keil': diepste = geo.h0 + geo.boorpunt; break;
    case 'kopbout': diepste = hef + geo.kopH; break;
    default: diepste = hef;
  }
  geo.diepste = diepste;
  // Concrete zone left and right of the axis; a hook only widens the side
  // it points to.
  const basis = Math.max(
    g.ringD / 2 + 1.5 * d,
    3 * d,
    type === 'stort-plaat' ? geo.plaatZijde / 2 + 1.5 * d : 0,
    type === 'kopbout' ? geo.kopD / 2 + 2.5 * d : 0,
  );
  geo.links = basis;
  geo.rechts = Math.max(basis, reik + d);
  // Visible width of the fixture plate (on top) or the embedded plate.
  geo.plaatHalf = type === 'kopbout'
    ? Math.min(basis - d, geo.kopD / 2 + 1.5 * d)
    : Math.min(basis - d, g.ringD / 2 + 1.5 * d);
  geo.boven = q.uitsteek;                       // extent above the surface
  geo.onder = diepste + Math.max(1.5 * d, 0.12 * diepste); // concrete zone depth
  return geo;
}

function _maatLokaal(geo) {
  if (geo.aanzicht === 'boven') {
    const s = geo.type === 'kopbout' ? geo.kopD : Math.max(geo.e, geo.g.ringD);
    return { w: s, h: s };
  }
  return { w: geo.links + geo.rechts, h: geo.boven + geo.onder };
}

// Symmetric stepped outline: segments [{ y0, y1, r }] from top to bottom.
function _trapOmtrek(segmenten) {
  const rechts = [], links = [];
  for (const s of segmenten) {
    rechts.push({ x: s.r, y: s.y0 }, { x: s.r, y: s.y1 });
    links.unshift({ x: -s.r, y: s.y1 }, { x: -s.r, y: s.y0 });
  }
  return [...rechts, ...links];
}

// Centre line of a hooked bar from the bend start (0, yb) on: arc + leg.
function _haakAs(geo, yb) {
  const { R, haakLengte, type } = geo;
  const pts = [];
  const N = 16;
  const hoek = type === 'stort-J' ? Math.PI : Math.PI / 2;
  for (let i = 0; i <= N; i++) {
    const a = Math.PI - (hoek * i) / N;        // from the left of the centre (R, yb)
    pts.push({ x: R + R * Math.cos(a), y: yb + R * Math.sin(a) });
  }
  const eind = pts[pts.length - 1];
  if (type === 'stort-J') pts.push({ x: eind.x, y: eind.y - haakLengte });
  else pts.push({ x: eind.x + haakLengte, y: eind.y });
  return pts;
}

// Offset a polyline sideways by ±h (normals from the local direction).
function _verschuif(pts, h) {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x, dy = b.y - a.y;
    const l = Math.hypot(dx, dy) || 1;
    return { x: p.x - (dy / l) * h, y: p.y + (dx / l) * h };
  });
}

function _bovenaanzicht(geo, X, Y, S, cmds) {
  const { g, type } = geo;
  const cx = X(0), cy = Y(0);
  const rond = (r, extra) => ({ kind: 'circle', cx, cy, r: r * S, ...extra });
  if (type === 'kopbout') {
    // Under the plate the stud is hidden; without a plate it is visible.
    const verborgen = geo.plaatDikte > 0;
    const streep = verborgen ? { dash: [0.25 * g.d * S, 0.15 * g.d * S] } : {};
    cmds.push(rond(geo.kopD / 2, { role: 'kop', ...streep }));
    cmds.push(rond(g.d / 2, { role: 'anker', ...streep }));
    return;
  }
  cmds.push(rond(g.ringD / 2, { role: 'ring' }));
  const e = geo.e;
  const hex = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    hex.push({ x: X((e / 2) * Math.cos(a)), y: Y((e / 2) * Math.sin(a)) });
  }
  cmds.push({ kind: 'polyline', close: true, points: hex, role: 'moer' });
  cmds.push(rond(g.s / 2, { lineWidthFactor: 0.7, role: 'afschuining' }));
  // Rod end seen end-on (external thread, ISO 6410): major Ø thick and
  // closed, minor Ø thin and three-quarters.
  cmds.push(rond(g.d / 2, { role: 'anker' }));
  cmds.push({
    kind: 'arc', cx, cy, r: (kernDiameter(g) / 2) * S, a0: 0, a1: 1.5 * Math.PI,
    lineWidthFactor: LW_DUN, role: 'draad',
  });
}

function _zijaanzicht(geo, X, Y, S, cmds) {
  const { g, type, hef, d } = geo;
  const tf = geo.plaatDikte;
  const omhoog = (u, v) => ({ x: X(v), y: Y(-u) });   // u = height above the surface
  const omlaag = (u, v) => ({ x: X(v), y: Y(u) });    // u = depth below the surface
  const P = (x, y) => ({ x: X(x), y: Y(y) });
  const lijn = (x1, y1, x2, y2, extra) => ({ kind: 'line', x1: X(x1), y1: Y(y1), x2: X(x2), y2: Y(y2), ...extra });
  const poly = (pts, extra) => ({ kind: 'polyline', points: pts.map((p) => P(p.x, p.y)), ...extra });

  // ── What sits in the concrete: the void the hatch must leave open ──
  let gat = null;          // drilled hole outline (chemisch, keil)
  let inBeton;             // outline of everything inside the concrete
  let rand = d / 2;        // half the gap in the surface line
  let staafRecht = hef;    // depth to which the straight rod runs (hooks: bend start)
  if (geo.d0) {
    const r0 = geo.d0 / 2;
    gat = [
      { x: -r0, y: 0 }, { x: r0, y: 0 }, { x: r0, y: geo.h0 },
      { x: 0, y: geo.h0 + geo.boorpunt }, { x: -r0, y: geo.h0 },
    ];
    inBeton = gat;
    rand = r0;
  } else if (type === 'stort-L' || type === 'stort-J') {
    staafRecht = hef - d / 2 - geo.R;
    const as = [{ x: 0, y: 0 }, ..._haakAs(geo, staafRecht)];
    const l = _verschuif(as, d / 2), r = _verschuif(as, -d / 2);
    inBeton = [...l, ...r.reverse()];
  } else if (type === 'kopbout') {
    const yStud = tf;
    const segs = [];
    if (tf > 0) segs.push({ y0: 0, y1: tf, r: geo.plaatHalf });
    segs.push({ y0: yStud, y1: hef, r: d / 2 });
    segs.push({ y0: hef, y1: hef + geo.kopH, r: geo.kopD / 2 });
    inBeton = _trapOmtrek(segs);
    rand = tf > 0 ? geo.plaatHalf : d / 2;
  } else {
    const onderT = type === 'stort-plaat' ? geo.plaatT : g.ringT;
    const onderR = type === 'stort-plaat' ? geo.plaatZijde / 2 : g.ringD / 2;
    const yN = hef + onderT;
    inBeton = _trapOmtrek([
      { y0: 0, y1: hef, r: d / 2 },
      { y0: hef, y1: yN, r: onderR },
      { y0: yN, y1: yN + g.m, r: geo.e / 2 },
      { y0: yN + g.m, y1: yN + g.m + 0.6 * d, r: d / 2 },
    ]);
  }

  // Concrete hatch (section) with the anchor/hole left open.
  if (geo.betonArcering) {
    const buiten = [
      { x: -geo.links, y: 0 }, { x: geo.rechts, y: 0 },
      { x: geo.rechts, y: geo.onder }, { x: -geo.links, y: geo.onder },
    ];
    cmds.push({
      kind: 'hatch', role: 'beton',
      loops: [buiten.map((p) => P(p.x, p.y)), inBeton.map((p) => P(p.x, p.y))],
      pattern: 'diagonal-left', color: BETON_KLEUR, scale: 60, angle: 0,
    });
  }
  // Concrete surface, interrupted where the anchor/hole/plate enters.
  cmds.push(lijn(-geo.links, 0, -rand, 0, { role: 'betonrand' }));
  cmds.push(lijn(rand, 0, geo.rechts, 0, { role: 'betonrand' }));

  // ── Fixture on top: plate (cut, with clearance hole), washer, nut ──
  if (type !== 'kopbout') {
    if (tf > 0) {
      const ph = geo.plaatHalf, r = geo.df / 2;
      for (const [a, b] of [[-ph, -r], [r, ph]]) {
        cmds.push(poly([{ x: a, y: -tf }, { x: b, y: -tf }, { x: b, y: 0 }, { x: a, y: 0 }], { close: true, role: 'plaat' }));
      }
      // Rod through the plate hole (threaded).
      cmds.push(...schachtZijaanzicht(omhoog, 0, tf, g, { uDraad: 0, role: 'anker' }));
    }
    const uRing = tf, uMoer = tf + g.ringT, uTop = uMoer + g.m;
    cmds.push(...ringZijaanzicht(omhoog, uRing, uMoer, g.ringD));
    cmds.push(...zeskantZijaanzicht(omhoog, uMoer, uTop, g.s, { afschuining: [true, true], role: 'moer' }));
    cmds.push(...schachtZijaanzicht(omhoog, uTop, geo.uitsteek, g, { uDraad: uTop, punt: true, role: 'anker' }));
  }

  // ── In the concrete ──
  if (type === 'chemisch') {
    // Mortar fills the hole around the rod.
    const rc = kernDiameter(g) / 2, ch = d / 2 - rc;
    const staaf = [
      { x: -d / 2, y: 0 }, { x: d / 2, y: 0 }, { x: d / 2, y: hef - ch },
      { x: rc, y: hef }, { x: -rc, y: hef }, { x: -d / 2, y: hef - ch },
    ];
    cmds.push({
      kind: 'hatch', role: 'mortel', loops: [gat.map((p) => P(p.x, p.y)), staaf.map((p) => P(p.x, p.y))],
      pattern: 'solid', color: MORTEL_KLEUR, scale: 100, angle: 0,
    });
    cmds.push(poly([gat[0], gat[4], gat[3], gat[2], gat[1]], { role: 'boorgat' }));
    cmds.push(...schachtZijaanzicht(omlaag, 0, hef, g, { uDraad: 0, punt: true, role: 'anker' }));
  } else if (type === 'keil') {
    cmds.push(poly([gat[0], gat[4], gat[3], gat[2], gat[1]], { role: 'boorgat' }));
    const kegel = 1.2 * d;                      // cone length
    const yKegel = hef - kegel;                 // top of the cone
    const ySchouder = yKegel - 1.5 * d;         // end of the full-Ø shank
    const rHals = 0.35 * d, rKegel = 0.475 * d;
    const draadEind = Math.min(2 * d, ySchouder - 0.5 * d);
    cmds.push(...schachtZijaanzicht(omhoog, -ySchouder, 0, g, { uDraad: -draadEind, role: 'anker' }));
    for (const z of [-1, 1]) {
      cmds.push(lijn(z * d / 2, ySchouder, z * rHals, ySchouder, { role: 'anker' }));
      cmds.push(lijn(z * rHals, ySchouder, z * rHals, yKegel, { role: 'anker' }));
      // Expansion clip around the neck, pressed against the hole wall.
      cmds.push(poly([
        { x: z * rHals, y: yKegel - 1.1 * d }, { x: z * geo.d0 / 2, y: yKegel - 1.1 * d },
        { x: z * geo.d0 / 2, y: yKegel }, { x: z * rHals, y: yKegel },
      ], { close: true, fill: true, role: 'spreidclip' }));
    }
    cmds.push(poly([
      { x: -rHals, y: yKegel }, { x: -rKegel, y: hef }, { x: rKegel, y: hef }, { x: rHals, y: yKegel },
    ], { role: 'kegel' }));
  } else if (type === 'kopbout') {
    if (tf > 0) {
      cmds.push(poly([
        { x: -geo.plaatHalf, y: 0 }, { x: geo.plaatHalf, y: 0 },
        { x: geo.plaatHalf, y: tf }, { x: -geo.plaatHalf, y: tf },
      ], { close: true, role: 'plaat' }));
      // Weld collar at the stud root.
      const a = 0.2 * d;
      for (const z of [-1, 1]) {
        cmds.push(poly([
          { x: z * d / 2, y: tf }, { x: z * (d / 2 + a), y: tf }, { x: z * d / 2, y: tf + a },
        ], { close: true, fill: true, role: 'las' }));
      }
    } else {
      cmds.push(lijn(-d / 2, 0, d / 2, 0, { role: 'anker' }));
    }
    cmds.push(lijn(-d / 2, tf, -d / 2, hef, { role: 'anker' }));
    cmds.push(lijn(d / 2, tf, d / 2, hef, { role: 'anker' }));
    cmds.push(poly([
      { x: -geo.kopD / 2, y: hef }, { x: geo.kopD / 2, y: hef },
      { x: geo.kopD / 2, y: hef + geo.kopH }, { x: -geo.kopD / 2, y: hef + geo.kopH },
    ], { close: true, role: 'kop' }));
  } else if (type === 'stort-L' || type === 'stort-J') {
    cmds.push(...schachtZijaanzicht(omhoog, -staafRecht, 0, g, { uDraad: -2 * d, role: 'anker' }));
    const as = _haakAs(geo, staafRecht);
    const l = _verschuif(as, d / 2), r = _verschuif(as, -d / 2);
    cmds.push(poly(l, { role: 'anker' }), poly(r, { role: 'anker' }));
    const a = l[l.length - 1], b = r[r.length - 1];
    cmds.push(lijn(a.x, a.y, b.x, b.y, { role: 'anker' }));
  } else {
    // Straight cast-in bolt: thread at the top, plain shank, thread + washer
    // (or anchor plate) + nut at the bottom.
    const yMid = hef - 1.5 * d;
    cmds.push(...schachtZijaanzicht(omhoog, -yMid, 0, g, { uDraad: -2 * d, role: 'anker' }));
    cmds.push(...schachtZijaanzicht(omlaag, yMid, hef, g, { uDraad: hef - d, role: 'anker' }));
    const plaat = type === 'stort-plaat';
    const onderT = plaat ? geo.plaatT : g.ringT;
    cmds.push(...ringZijaanzicht(omlaag, hef, hef + onderT, plaat ? geo.plaatZijde : g.ringD, plaat ? 'ankerplaat' : 'ring'));
    const yN = hef + onderT;
    cmds.push(...zeskantZijaanzicht(omlaag, yN, yN + g.m, g.s, { afschuining: [true, true], role: 'moer' }));
    cmds.push(...schachtZijaanzicht(omlaag, yN + g.m, yN + g.m + 0.6 * d, g, { uDraad: yN + g.m, punt: true, role: 'anker' }));
  }

  // Axis over the straight part.
  const asOnder = (type === 'stort-L' || type === 'stort-J') ? staafRecht : geo.diepste;
  cmds.push(hartlijnZijaanzicht(omlaag, -geo.boven, asOnder, 0.5 * d * S));
}

function _kader(params, bbox) {
  const geo = ankerGeometrie(params);
  const { w, h } = _maatLokaal(geo);
  const S = Math.min(bbox.width / w, bbox.height / h);
  const links = geo.aanzicht === 'boven' ? w / 2 : geo.links;
  const cx = bbox.x + (bbox.width - w * S) / 2 + links * S;
  const top = bbox.y + (bbox.height - h * S) / 2;
  const yNul = geo.aanzicht === 'boven' ? top + (h / 2) * S : top + geo.boven * S;
  return { geo, S, X: (v) => cx + v * S, Y: (v) => yNul + v * S };
}

export const ankerTemplate = {
  id: 'anker',
  name: 'Anker in beton',
  nameEn: 'Anchor in concrete',
  category: 'NL Constructie',
  defaultSize: { width: 80, height: 240 },
  fixedSize: true,
  zoektermen: [
    'anker', 'ankerbout', 'stortanker', 'chemisch anker', 'lijmanker', 'injectieanker',
    'keilbout', 'expansieanker', 'kopbout', 'deuvel', 'anchor', 'wedge anchor', 'headed stud',
  ],
  params: [
    { key: 'type', label: 'Type', labelEn: 'Type', type: 'enum', options: ANKER_TYPEN, default: 'stort-moer' },
    { key: 'maat', label: 'Maat', labelEn: 'Size', type: 'enum', options: ANKER_MATEN, default: 'M16' },
    {
      key: 'aanzicht', label: 'Aanzicht', labelEn: 'View', type: 'enum', default: 'zij',
      options: [{ value: 'zij', label: 'Zijaanzicht (doorsnede)' }, { value: 'boven', label: 'Bovenaanzicht' }],
    },
    { key: 'hef', label: 'Verankeringsdiepte hef (mm, 0 = standaard)', labelEn: 'Embedment depth hef (mm, 0 = default)', type: 'number', default: 0, min: 0, step: 5 },
    { key: 'plaatDikte', label: 'Plaatdikte (mm, 0 = geen plaat)', labelEn: 'Plate thickness (mm, 0 = no plate)', type: 'number', default: 10, min: 0, step: 1 },
    { key: 'uitsteek', label: 'Uitsteek boven beton (mm, 0 = auto)', labelEn: 'Protrusion above concrete (mm, 0 = auto)', type: 'number', default: 0, min: 0, step: 5 },
    { key: 'haakLengte', label: 'Haaklengte L/J (mm, 0 = auto)', labelEn: 'Hook length L/J (mm, 0 = auto)', type: 'number', default: 0, min: 0, step: 5 },
    { key: 'betonArcering', label: 'Betonarcering', labelEn: 'Concrete hatch', type: 'boolean', default: true },
    { key: 'schaal', label: 'Schaal', labelEn: 'Scale', type: 'number', default: 1, min: 0.1, step: 0.1 },
  ],
  realSizeMm(params) {
    const geo = ankerGeometrie(params);
    const { w, h } = _maatLokaal(geo);
    return { width: w * geo.schaal, height: h * geo.schaal };
  },
  snapPoints(params, bbox) {
    const { x, y, width: w, height: h } = bbox;
    const pts = [
      { kind: 'center', x: x + w / 2, y: y + h / 2 },
      { kind: 'endpoint', x, y }, { kind: 'endpoint', x: x + w, y },
      { kind: 'endpoint', x, y: y + h }, { kind: 'endpoint', x: x + w, y: y + h },
      { kind: 'midpoint', x: x + w / 2, y }, { kind: 'midpoint', x: x + w / 2, y: y + h },
      { kind: 'midpoint', x, y: y + h / 2 }, { kind: 'midpoint', x: x + w, y: y + h / 2 },
    ];
    // Side view: the anchor axis at the concrete surface.
    const { geo, X, Y } = _kader(params, bbox);
    if (geo.aanzicht === 'zij') pts.push({ kind: 'endpoint', x: X(0), y: Y(0) });
    return pts;
  },
  render(params, bbox) {
    const { geo, S, X, Y } = _kader(params, bbox);
    const cmds = [];
    if (geo.aanzicht === 'boven') _bovenaanzicht(geo, X, Y, S, cmds);
    else _zijaanzicht(geo, X, Y, S, cmds);
    return cmds;
  },
};
