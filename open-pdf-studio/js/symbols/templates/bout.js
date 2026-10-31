// Parametric BOLTS / ANCHORS (bouten) — dynamic-block style, metric sizes.
//
// One template, five drawing views (aanzicht param):
//   'bout'        — side elevation: hex head (three faces, 30° chamfer
//                   curves on the top), washer, plain shank + threaded part
//                   with a chamfered tip
//   'doorsteek'   — through-bolt / concrete anchor: the same bolt with a
//                   washer + nut (chamfered both ends) + protruding thread
//   'moer-boven'  — nut top view: hexagon, chamfer circle (across flats),
//                   thread per ISO 6410: thick minor circle + thin 3/4
//                   major circle
//   'zeskant'     — plain hexagon top view with bore
//   'plattegrond' — bolt-head top view: hexagon + chamfer circle,
//                   optionally with the washer ring
//
// Drawing conventions (ISO 128 / ISO 6410):
//   * visible outlines in the symbol line weight, facet lines and chamfer
//     curves slightly lighter, thread minor-diameter lines thin and
//     continuous, the axis as a thin dash-dot line;
//   * the end of the useful thread is a thick line across the major Ø;
//   * the side view looks square onto one flat, so three faces show: the
//     middle face (width e/2) between two foreshortened faces (e/4 each),
//     total height = across-corners e;
//   * the 30° chamfer cone meets each flat face in a hyperbola — drawn as
//     the true curve, which is what the classic chamfer "arcs" approximate.
//
// Sizes (mm): d = nominal Ø, s = width across flats, k = head height,
// m = nut height, P = coarse pitch, ringD/ringT = washer outer Ø and
// thickness per ISO 7089 (normal series).
// Same contract as the steel profiles: fixed real-world size (mm × schaal),
// scale-region aware via realSizeMm, snappable bbox points.

const _MATEN = {
  'M6':  { d: 6,  s: 10, k: 4,    m: 5,   P: 1,    ringD: 12, ringT: 1.6 },
  'M8':  { d: 8,  s: 13, k: 5.3,  m: 6.5, P: 1.25, ringD: 16, ringT: 1.6 },
  'M10': { d: 10, s: 17, k: 6.4,  m: 8,   P: 1.5,  ringD: 20, ringT: 2 },
  'M12': { d: 12, s: 19, k: 7.5,  m: 10,  P: 1.75, ringD: 24, ringT: 2.5 },
  'M16': { d: 16, s: 24, k: 10,   m: 13,  P: 2,    ringD: 30, ringT: 3 },
  'M20': { d: 20, s: 30, k: 12.5, m: 16,  P: 2.5,  ringD: 37, ringT: 3 },
  'M22': { d: 22, s: 34, k: 14,   m: 18,  P: 2.5,  ringD: 39, ringT: 3 },
  'M24': { d: 24, s: 36, k: 15,   m: 19,  P: 3,    ringD: 44, ringT: 4 },
};

// Ook gebruikt door de staalverbindingen (kopplaat, voetplaat).
export const BOUT_MATEN = _MATEN;

// Line weights as a fraction of the symbol line width.
const LW_DETAIL = 0.7;   // facet lines, chamfer curves and circle
const LW_DUN = 0.5;      // thread minor diameter, thin 3/4 thread circle
const LW_AS = 0.35;      // centre line

const TAN30 = Math.tan(Math.PI / 6);

/** Across-corners width e of a hexagon with width across flats s. */
export function zeskantHoekmaat(s) {
  return s / Math.cos(Math.PI / 6);
}

/** Minor (core) diameter of an external ISO metric thread: d3 = d − 1.22687·P. */
export function kernDiameter(g) {
  const P = g.P > 0 ? g.P : 0.15 * g.d;
  return g.d - 1.22687 * P;
}

/**
 * Thread length b (ISO 4014) for a bolt of nominal length l (mm, under the
 * head): 2d + 6 up to 125, 2d + 12 up to 200, 2d + 25 beyond. A bolt whose
 * plain shank would be shorter than half a diameter is fully threaded.
 */
export function draadLengte(g, l) {
  const b = g.d * 2 + (l <= 125 ? 6 : l <= 200 ? 12 : 25);
  return l - b < 0.5 * g.d ? l : b;
}

const _snapPoints = (params, bbox) => {
  const { x, y, width: w, height: h } = bbox;
  return [
    { kind: 'center', x: x + w / 2, y: y + h / 2 },
    { kind: 'endpoint', x, y }, { kind: 'endpoint', x: x + w, y },
    { kind: 'endpoint', x, y: y + h }, { kind: 'endpoint', x: x + w, y: y + h },
    { kind: 'midpoint', x: x + w / 2, y }, { kind: 'midpoint', x: x + w / 2, y: y + h },
    { kind: 'midpoint', x, y: y + h / 2 }, { kind: 'midpoint', x: x + w, y: y + h / 2 },
  ];
};

function _schaalOf(params) {
  const v = parseFloat(params?.schaal);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

function _maatOf(params) {
  return _MATEN[params?.maat] || _MATEN['M12'];
}

function _lengteOf(params, g) {
  const v = parseFloat(params?.lengte);
  return Number.isFinite(v) && v > 0 ? v : g.d * 10;
}

/** Thread stub beyond the nut in the 'doorsteek' view. */
function _stubOf(g) {
  return 0.6 * g.d;
}

// Local-space (mm, y-down) drawing size per view. Side views run along x:
// head/washer at the left, shaft to the right; their height is the larger
// of the hexagon across corners and the washer outer Ø.
function _localSize(view, g, L, ringPlattegrond = true) {
  const e = zeskantHoekmaat(g.s);
  const hZij = Math.max(e, g.ringD);
  switch (view) {
    case 'plattegrond': {
      const size = ringPlattegrond ? Math.max(e, g.ringD) : e;
      return { w: size, h: size };
    }
    case 'moer-boven':
    case 'zeskant':
      return { w: e, h: e };
    case 'doorsteek':
      // head + washer + clamp length L + washer + nut + thread stub
      return { w: g.k + g.ringT + L + g.ringT + g.m + _stubOf(g), h: hZij };
    case 'bout':
    default:
      return { w: g.k + g.ringT + L, h: hZij };
  }
}

// Hexagon points (point-side left/right, like the reference sheet),
// across-corners e, centred on (cx, cy).
function _hexPts(cx, cy, e) {
  const r = e / 2;
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i; // 0°, 60°, … → vertices on the x-axis
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

// ─── Side-view building blocks in a local (u, v) frame ──────────────────
// u runs along the bolt axis, v across it; `map(u, v)` returns the canvas
// point. Any similarity map works (rotated or mirrored), which is how the
// steel connections reuse these for horizontal and vertical bolts.

/**
 * Hex head or nut seen square onto one flat, between the end faces u0 and
 * u1. `afschuining` = [chamfer at u0, chamfer at u1] (30° chamfer cone that
 * starts at the across-flats circle). Returns drawing commands; the outline
 * carries `role`, the facet lines and chamfer curves `role + '-detail'`.
 */
export function zeskantZijaanzicht(map, u0, u1, s, { afschuining = [true, false], role = 'zeskant' } = {}) {
  const e = zeskantHoekmaat(s);
  const c = ((e - s) / 2) * TAN30;            // chamfer set-back at the corners
  const c0 = afschuining[0] ? c : 0;
  const c1 = afschuining[1] ? c : 0;
  const cmds = [];

  // Outline (silhouette): corners at ±e/2, chamfered ends start at ±s/2.
  const pts = [];
  if (c0) pts.push(map(u0 + c0, -e / 2), map(u0, -s / 2), map(u0, s / 2), map(u0 + c0, e / 2));
  else pts.push(map(u0, -e / 2), map(u0, e / 2));
  if (c1) pts.push(map(u1 - c1, e / 2), map(u1, s / 2), map(u1, -s / 2), map(u1 - c1, -e / 2));
  else pts.push(map(u1, e / 2), map(u1, -e / 2));
  cmds.push({ kind: 'polyline', close: true, points: pts, role });

  // Facet lines between the middle face and the two outer faces.
  for (const v of [-e / 4, e / 4]) {
    const a = map(u0 + c0, v), b = map(u1 - c1, v);
    cmds.push({ kind: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y, lineWidthFactor: LW_DETAIL, role: role + '-detail' });
  }

  // Chamfer curves: on each flat the cone gives the set-back
  // z(t) = (√(s²/4 + t²) − s/2)·tan 30°, t along the face from its centre.
  const half = e / 4;                           // half the face width
  const N = 12;
  const kromme = (uEind, richting, vVan) => {
    const points = [];
    for (let i = 0; i <= N; i++) {
      const t = -half + (2 * half * i) / N;
      const z = (Math.sqrt((s * s) / 4 + t * t) - s / 2) * TAN30;
      points.push(map(uEind + richting * z, vVan(t)));
    }
    return { kind: 'polyline', points, lineWidthFactor: LW_DETAIL, role: role + '-detail' };
  };
  const sin60 = Math.sin(Math.PI / 3);
  const vlakken = [
    (t) => t,                                   // middle face
    (t) => (s / 2) * sin60 + t / 2,             // outer face, +v side
    (t) => -((s / 2) * sin60 + t / 2),          // outer face, −v side
  ];
  if (c0) for (const f of vlakken) cmds.push(kromme(u0, 1, f));
  if (c1) for (const f of vlakken) cmds.push(kromme(u1, -1, f));
  return cmds;
}

/** Plain washer (ISO 7089) in side view between u0 and u1. */
export function ringZijaanzicht(map, u0, u1, ringD, role = 'ring') {
  const r = ringD / 2;
  return [{
    kind: 'polyline', close: true, role,
    points: [map(u0, -r), map(u1, -r), map(u1, r), map(u0, r)],
  }];
}

/**
 * Bolt shank between u0 and u1 in side view. The thread runs from uDraad to
 * the end u1 (uDraad ≤ u0 = threaded over the whole visible length, no
 * thread-end line). `punt` adds the 45° chamfered tip at u1.
 */
export function schachtZijaanzicht(map, u0, u1, g, { uDraad = u0, punt = false, role = 'schacht' } = {}) {
  const r = g.d / 2;
  const rc = kernDiameter(g) / 2;
  const ch = punt ? r - rc : 0;                  // 45° chamfer to the minor Ø
  const uT = Math.min(Math.max(uDraad, u0), u1);
  const cmds = [];
  const lijn = (ua, va, ub, vb, extra) => {
    const a = map(ua, va), b = map(ub, vb);
    cmds.push({ kind: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y, role, ...extra });
  };
  if (punt) {
    cmds.push({
      kind: 'polyline', role,
      points: [map(u0, -r), map(u1 - ch, -r), map(u1, -rc), map(u1, rc), map(u1 - ch, r), map(u0, r)],
    });
  } else {
    lijn(u0, -r, u1, -r);
    lijn(u0, r, u1, r);
  }
  if (uT < u1 - 1e-9) {
    // Thin continuous minor-diameter lines over the threaded length.
    lijn(uT, -rc, u1, -rc, { lineWidthFactor: LW_DUN, role: 'draad' });
    lijn(uT, rc, u1, rc, { lineWidthFactor: LW_DUN, role: 'draad' });
    // Thread end: thick line across the major diameter.
    if (uT > u0 + 1e-9) lijn(uT, -r, uT, r, { role: 'draadeinde' });
  }
  return cmds;
}

/** Thin dash-dot centre line from u0 to u1; `eenheid` = dash unit (canvas). */
export function hartlijnZijaanzicht(map, u0, u1, eenheid) {
  const a = map(u0, 0), b = map(u1, 0);
  const u = Math.max(eenheid, 1e-6);
  return {
    kind: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y,
    dash: [u * 2.4, u * 0.5, u * 0.3, u * 0.5], lineWidthFactor: LW_AS, role: 'hartlijn',
  };
}

export const boutTemplate = {
  id: 'bout',
  name: 'Bout / anker',
  nameEn: 'Bolt / anchor',
  category: 'NL Constructie',
  defaultSize: { width: 80, height: 18 },
  fixedSize: true,
  params: [
    { key: 'maat', label: 'Maat', labelEn: 'Size', type: 'enum', options: Object.keys(_MATEN), default: 'M12' },
    {
      key: 'aanzicht', label: 'Aanzicht', labelEn: 'View', type: 'enum',
      options: [
        { value: 'bout', label: 'Zijaanzicht bout' },
        { value: 'doorsteek', label: 'Doorsteekbout' },
        { value: 'plattegrond', label: 'Plattegrond' },
        { value: 'moer-boven', label: 'Moer bovenaanzicht' },
        { value: 'zeskant', label: 'Zeskant bovenaanzicht' },
      ],
      default: 'bout',
    },
    {
      key: 'ringPlattegrond', label: 'Ring in plattegrond', labelEn: 'Washer in plan view',
      type: 'boolean', default: true,
    },
    { key: 'lengte', label: 'Lengte (mm)', labelEn: 'Length (mm)', type: 'number', default: 120, min: 10, step: 5 },
    { key: 'schaal', label: 'Schaal', labelEn: 'Scale', type: 'number', default: 1, min: 0.1, step: 0.1 },
  ],
  realSizeMm(params) {
    const g = _maatOf(params);
    const L = _lengteOf(params, g);
    const f = _schaalOf(params);
    const { w, h } = _localSize(
      params?.aanzicht || 'bout', g, L, params?.ringPlattegrond !== false,
    );
    return { width: w * f, height: h * f };
  },
  snapPoints: _snapPoints,
  render(params, bbox) {
    const g = _maatOf(params);
    const L = _lengteOf(params, g);
    const view = params?.aanzicht || 'bout';
    const ringPlattegrond = params?.ringPlattegrond !== false;
    const { w, h } = _localSize(view, g, L, ringPlattegrond);
    const S = Math.min(bbox.width / w, bbox.height / h);
    const x0 = bbox.x + (bbox.width - w * S) / 2;
    const yMid = bbox.y + bbox.height / 2;
    const X = (v) => x0 + v * S;          // local x (mm) → canvas
    const Y = (v) => yMid + v * S;        // local y centred on the axis
    const cmds = [];
    const e = zeskantHoekmaat(g.s);

    if (view === 'plattegrond' || view === 'moer-boven' || view === 'zeskant') {
      const cx = X(w / 2), cy = Y(0);
      const rond = (r, extra) => ({ kind: 'circle', cx, cy, r: r * S, ...extra });
      if (view === 'plattegrond' && ringPlattegrond) {
        cmds.push(rond(g.ringD / 2, { role: 'ring' }));
      }
      cmds.push({
        kind: 'polyline', close: true, role: view === 'plattegrond' ? 'boutkop' : 'zeskant',
        points: _hexPts(0, 0, e).map(p => ({ x: X(w / 2 + p.x), y: Y(p.y) })),
      });
      if (view === 'zeskant') {
        cmds.push(rond(g.d / 2, { role: 'gat' }));
        return cmds;
      }
      // Chamfer circle: where the 30° chamfer meets the end face (across flats).
      cmds.push(rond(g.s / 2, { lineWidthFactor: LW_DETAIL, role: 'afschuining' }));
      if (view === 'moer-boven') {
        // ISO 6410, internal thread seen end-on: minor Ø thick and closed,
        // major Ø thin and three-quarters (open in the upper-right quadrant).
        cmds.push(rond(kernDiameter(g) / 2, { role: 'draadkern' }));
        cmds.push({
          kind: 'arc', cx, cy, r: (g.d / 2) * S, a0: 0, a1: 1.5 * Math.PI,
          lineWidthFactor: LW_DUN, role: 'draad',
        });
      }
      return cmds;
    }

    // Side views — head (chamfered top at u = 0) + washer at the left.
    const map = (u, v) => ({ x: X(u), y: Y(v) });
    const shaftStart = g.k + g.ringT;
    cmds.push(...zeskantZijaanzicht(map, 0, g.k, g.s, { afschuining: [true, false], role: 'boutkop' }));
    cmds.push(...ringZijaanzicht(map, g.k, shaftStart, g.ringD));

    if (view === 'doorsteek') {
      // Clamp length L, then washer + nut (chamfered both ends) + thread stub.
      const xRing2 = shaftStart + L;
      const xNut = xRing2 + g.ringT;
      const xStub = xNut + g.m;
      const xTip = xStub + _stubOf(g);
      const xDraad = xTip - draadLengte(g, xTip - g.k);
      cmds.push(...schachtZijaanzicht(map, shaftStart, xRing2, g, { uDraad: xDraad }));
      cmds.push(...ringZijaanzicht(map, xRing2, xNut, g.ringD));
      cmds.push(...zeskantZijaanzicht(map, xNut, xStub, g.s, { afschuining: [true, true], role: 'moer' }));
      cmds.push(...schachtZijaanzicht(map, xStub, xTip, g, { uDraad: xStub, punt: true }));
    } else {
      const xTip = shaftStart + L;
      const xDraad = xTip - draadLengte(g, xTip - g.k);
      cmds.push(...schachtZijaanzicht(map, shaftStart, xTip, g, { uDraad: xDraad, punt: true }));
    }
    cmds.push(hartlijnZijaanzicht(map, 0, w, 0.5 * g.d * S));
    return cmds;
  },
};
