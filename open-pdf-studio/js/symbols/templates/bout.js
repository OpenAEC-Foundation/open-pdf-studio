// Parametric BOLTS / ANCHORS (bouten) — dynamic-block style, metric sizes.
//
// One template, five drawing views (aanzicht param):
//   'bout'       — side elevation: hex head + washer + threaded shaft
//                  (dashed core lines), parametric length
//   'doorsteek'  — through-bolt / concrete anchor: same shaft but with a
//                  washer + nut + protruding thread stub at the far end
//   'moer-boven' — nut top view: hexagon + inscribed circle + bore
//   'zeskant'    — plain hexagon top view with bore
//
//   'plattegrond' — bolt-head top view, optionally with a washer ring
//
// Sizes follow the common DIN/ISO hex dimensions (mm):
//   d = nominal Ø, s = width across flats, k = head height, m = nut height.
// Same contract as the steel profiles: fixed real-world size (mm × schaal),
// scale-region aware via realSizeMm, snappable bbox points.

const _MATEN = {
  'M6':  { d: 6,  s: 10, k: 4,    m: 5 },
  'M8':  { d: 8,  s: 13, k: 5.3,  m: 6.5 },
  'M10': { d: 10, s: 17, k: 6.4,  m: 8 },
  'M12': { d: 12, s: 19, k: 7.5,  m: 10 },
  'M16': { d: 16, s: 24, k: 10,   m: 13 },
  'M20': { d: 20, s: 30, k: 12.5, m: 16 },
  'M22': { d: 22, s: 34, k: 14,   m: 18 },
  'M24': { d: 24, s: 36, k: 15,   m: 19 },
};

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

// Local-space (mm, y-down) drawing size per view. Side views run along x:
// head/washer at the left, shaft to the right.
function _localSize(view, g, L, ringPlattegrond = true) {
  const ringD = 2.2 * g.d;       // washer outer Ø
  const e = g.s / Math.cos(Math.PI / 6); // hexagon across corners
  switch (view) {
    case 'plattegrond': {
      const size = ringPlattegrond ? Math.max(e, ringD) : e;
      return { w: size, h: size };
    }
    case 'moer-boven':
    case 'zeskant':
      return { w: e, h: e };
    case 'doorsteek':
      // head + washer + shaft(L) + washer + nut + thread stub
      return { w: g.k + 0.15 * g.d + L + 0.15 * g.d + g.m + 0.6 * g.d, h: ringD };
    case 'bout':
    default:
      return { w: g.k + 0.15 * g.d + L, h: ringD };
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

// Side-view shaft with thread: solid outline ±d/2, dashed core ±0.42d,
// chamfered tip. xs = thread start, xe = thread end (local mm).
function _shaft(cmds, X, Y, S, xs, xe, g, withTip) {
  const r = g.d / 2;
  const rc = 0.42 * g.d; // thread core half-height
  const ch = 0.15 * g.d; // tip chamfer
  const xTip = withTip ? xe - ch : xe;
  const dash = [3 * S, 2 * S];
  cmds.push({ kind: 'line', x1: X(xs), y1: Y(-r), x2: X(xTip), y2: Y(-r) });
  cmds.push({ kind: 'line', x1: X(xs), y1: Y(r), x2: X(xTip), y2: Y(r) });
  cmds.push({ kind: 'line', x1: X(xs), y1: Y(-rc), x2: X(xe), y2: Y(-rc), dash });
  cmds.push({ kind: 'line', x1: X(xs), y1: Y(rc), x2: X(xe), y2: Y(rc), dash });
  if (withTip) {
    cmds.push({ kind: 'line', x1: X(xTip), y1: Y(-r), x2: X(xe), y2: Y(-rc) });
    cmds.push({ kind: 'line', x1: X(xTip), y1: Y(r), x2: X(xe), y2: Y(rc) });
    cmds.push({ kind: 'line', x1: X(xe), y1: Y(-rc), x2: X(xe), y2: Y(rc) });
  }
}

// Hex head / nut in side view: rectangle with the two chamfer arcs hinted
// by short vertical facet lines at 1/4 and 3/4 height.
function _hexSide(cmds, X, Y, x0, x1, halfH) {
  cmds.push({ kind: 'polyline', close: true, points: [
    { x: X(x0), y: Y(-halfH) }, { x: X(x1), y: Y(-halfH) },
    { x: X(x1), y: Y(halfH) }, { x: X(x0), y: Y(halfH) },
  ] });
  cmds.push({ kind: 'line', x1: X(x0), y1: Y(-halfH / 2), x2: X(x1), y2: Y(-halfH / 2) });
  cmds.push({ kind: 'line', x1: X(x0), y1: Y(halfH / 2), x2: X(x1), y2: Y(halfH / 2) });
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

    if (view === 'plattegrond') {
      const e = g.s / Math.cos(Math.PI / 6);
      const cx = w / 2, cy = 0;
      if (ringPlattegrond) {
        cmds.push({
          kind: 'circle', role: 'ring',
          cx: X(cx), cy: Y(cy), r: (1.1 * g.d) * S,
        });
      }
      cmds.push({
        kind: 'polyline', close: true, role: 'boutkop',
        points: _hexPts(0, 0, e).map(p => ({ x: X(cx + p.x), y: Y(cy + p.y) })),
      });
      return cmds;
    }

    if (view === 'moer-boven' || view === 'zeskant') {
      const e = g.s / Math.cos(Math.PI / 6);
      const cx = w / 2, cy = 0;
      cmds.push({ kind: 'polyline', close: true, points: _hexPts(0, 0, e).map(p => ({ x: X(cx + p.x), y: Y(cy + p.y) })) });
      if (view === 'moer-boven') {
        // Inscribed circle (across flats) — the machined face edge.
        cmds.push({ kind: 'circle', cx: X(cx), cy: Y(cy), r: (g.s / 2) * S });
      }
      // Bore.
      cmds.push({ kind: 'circle', cx: X(cx), cy: Y(cy), r: (g.d / 2) * S });
      return cmds;
    }

    // Side views — head + washer at the left.
    const ringT = 0.15 * g.d;   // washer thickness
    const ringR = 1.1 * g.d;    // washer half-height (outer Ø 2.2d)
    _hexSide(cmds, X, Y, 0, g.k, g.s / 2);
    cmds.push({ kind: 'line', x1: X(g.k), y1: Y(-ringR), x2: X(g.k), y2: Y(ringR) });
    cmds.push({ kind: 'line', x1: X(g.k + ringT), y1: Y(-ringR), x2: X(g.k + ringT), y2: Y(ringR) });
    cmds.push({ kind: 'line', x1: X(g.k), y1: Y(-ringR), x2: X(g.k + ringT), y2: Y(-ringR) });
    cmds.push({ kind: 'line', x1: X(g.k), y1: Y(ringR), x2: X(g.k + ringT), y2: Y(ringR) });

    const shaftStart = g.k + ringT;
    if (view === 'doorsteek') {
      // Shaft up to the far washer, then washer + nut + thread stub.
      const xRing2 = shaftStart + L;
      const xNut = xRing2 + ringT;
      const xStub = xNut + g.m;
      _shaft(cmds, X, Y, S, shaftStart, xRing2, g, false);
      cmds.push({ kind: 'line', x1: X(xRing2), y1: Y(-ringR), x2: X(xRing2), y2: Y(ringR) });
      cmds.push({ kind: 'line', x1: X(xNut), y1: Y(-ringR), x2: X(xNut), y2: Y(ringR) });
      cmds.push({ kind: 'line', x1: X(xRing2), y1: Y(-ringR), x2: X(xNut), y2: Y(-ringR) });
      cmds.push({ kind: 'line', x1: X(xRing2), y1: Y(ringR), x2: X(xNut), y2: Y(ringR) });
      _hexSide(cmds, X, Y, xNut, xStub, g.s / 2);
      _shaft(cmds, X, Y, S, xStub, xStub + 0.6 * g.d, g, true);
    } else {
      _shaft(cmds, X, Y, S, shaftStart, shaftStart + L, g, true);
    }
    return cmds;
  },
};
