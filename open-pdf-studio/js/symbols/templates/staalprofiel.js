// Parametric steel profile CROSS-SECTIONS (doorsneden) — dynamic-block style:
// place once, then switch size (HEA 100/120/…) from the properties panel.
// The bbox is sized to the REAL profile dimensions via the measure scale at
// the placement point (see symbols/real-size.js); render() always fits the
// section into the current bbox so manual resizing still behaves.
//
// Tables: [maat, h, b, tw, tf, r] in mm (European hot-rolled sections).
// Koker (cold-formed hollow sections): [maat, h, b, t] in mm.

const HEA = [
  ['HEA 100', 96, 100, 5, 8, 12],
  ['HEA 120', 114, 120, 5, 8, 12],
  ['HEA 140', 133, 140, 5.5, 8.5, 12],
  ['HEA 160', 152, 160, 6, 9, 15],
  ['HEA 180', 171, 180, 6, 9.5, 15],
  ['HEA 200', 190, 200, 6.5, 10, 18],
  ['HEA 220', 210, 220, 7, 11, 18],
  ['HEA 240', 230, 240, 7.5, 12, 21],
  ['HEA 260', 250, 260, 7.5, 12.5, 24],
  ['HEA 280', 270, 280, 8, 13, 24],
  ['HEA 300', 290, 300, 8.5, 14, 27],
  ['HEA 320', 310, 300, 9, 15.5, 27],
  ['HEA 340', 330, 300, 9.5, 16.5, 27],
  ['HEA 360', 350, 300, 10, 17.5, 27],
  ['HEA 400', 390, 300, 11, 19, 27],
  ['HEA 450', 440, 300, 11.5, 21, 27],
  ['HEA 500', 490, 300, 12, 23, 27],
  ['HEA 550', 540, 300, 12.5, 24, 27],
  ['HEA 600', 590, 300, 13, 25, 27],
  ['HEA 650', 640, 300, 13.5, 26, 27],
  ['HEA 700', 690, 300, 14.5, 27, 27],
  ['HEA 800', 790, 300, 15, 28, 30],
  ['HEA 900', 890, 300, 16, 30, 30],
  ['HEA 1000', 990, 300, 16.5, 31, 30],
];

const HEB = [
  ['HEB 100', 100, 100, 6, 10, 12],
  ['HEB 120', 120, 120, 6.5, 11, 12],
  ['HEB 140', 140, 140, 7, 12, 12],
  ['HEB 160', 160, 160, 8, 13, 15],
  ['HEB 180', 180, 180, 8.5, 14, 15],
  ['HEB 200', 200, 200, 9, 15, 18],
  ['HEB 220', 220, 220, 9.5, 16, 18],
  ['HEB 240', 240, 240, 10, 17, 21],
  ['HEB 260', 260, 260, 10, 17.5, 24],
  ['HEB 280', 280, 280, 10.5, 18, 24],
  ['HEB 300', 300, 300, 11, 19, 27],
  ['HEB 320', 320, 300, 11.5, 20.5, 27],
  ['HEB 340', 340, 300, 12, 21.5, 27],
  ['HEB 360', 360, 300, 12.5, 22.5, 27],
  ['HEB 400', 400, 300, 13.5, 24, 27],
  ['HEB 450', 450, 300, 14, 26, 27],
  ['HEB 500', 500, 300, 14.5, 28, 27],
  ['HEB 550', 550, 300, 15, 29, 27],
  ['HEB 600', 600, 300, 15.5, 30, 27],
  ['HEB 650', 650, 300, 16, 31, 27],
  ['HEB 700', 700, 300, 17, 32, 27],
  ['HEB 800', 800, 300, 17.5, 33, 30],
  ['HEB 900', 900, 300, 18.5, 35, 30],
  ['HEB 1000', 1000, 300, 19, 36, 30],
];

const IPE = [
  ['IPE 80', 80, 46, 3.8, 5.2, 5],
  ['IPE 100', 100, 55, 4.1, 5.7, 7],
  ['IPE 120', 120, 64, 4.4, 6.3, 7],
  ['IPE 140', 140, 73, 4.7, 6.9, 7],
  ['IPE 160', 160, 82, 5, 7.4, 9],
  ['IPE 180', 180, 91, 5.3, 8, 9],
  ['IPE 200', 200, 100, 5.6, 8.5, 12],
  ['IPE 220', 220, 110, 5.9, 9.2, 12],
  ['IPE 240', 240, 120, 6.2, 9.8, 15],
  ['IPE 270', 270, 135, 6.6, 10.2, 15],
  ['IPE 300', 300, 150, 7.1, 10.7, 15],
  ['IPE 330', 330, 160, 7.5, 11.5, 18],
  ['IPE 360', 360, 170, 8, 12.7, 18],
  ['IPE 400', 400, 180, 8.6, 13.5, 21],
  ['IPE 450', 450, 190, 9.4, 14.6, 21],
  ['IPE 500', 500, 200, 10.2, 16, 21],
  ['IPE 550', 550, 210, 11.1, 17.2, 24],
  ['IPE 600', 600, 220, 12, 19, 24],
];

// U-channels (parallel-flange simplification of the tapered section):
// [maat, h, b, tw, tf, r]
const UNP = [
  ['UNP 80', 80, 45, 6, 8, 8],
  ['UNP 100', 100, 50, 6, 8.5, 8.5],
  ['UNP 120', 120, 55, 7, 9, 9],
  ['UNP 140', 140, 60, 7, 10, 10],
  ['UNP 160', 160, 65, 7.5, 10.5, 10.5],
  ['UNP 180', 180, 70, 8, 11, 11],
  ['UNP 200', 200, 75, 8.5, 11.5, 11.5],
  ['UNP 220', 220, 80, 9, 12.5, 12.5],
  ['UNP 240', 240, 85, 9.5, 13, 13],
  ['UNP 260', 260, 90, 10, 14, 14],
  ['UNP 280', 280, 95, 10, 15, 15],
  ['UNP 300', 300, 100, 10, 16, 16],
  ['UNP 320', 320, 100, 14, 17.5, 17.5],
  ['UNP 350', 350, 100, 14, 16, 16],
  ['UNP 380', 380, 102, 13.5, 16, 16],
  ['UNP 400', 400, 110, 14, 18, 18],
];

// Square + common rectangular hollow sections: [maat, h, b, t]
const KOKER = [
  ['Koker 40x40x3', 40, 40, 3],
  ['Koker 50x50x3', 50, 50, 3],
  ['Koker 60x60x4', 60, 60, 4],
  ['Koker 70x70x4', 70, 70, 4],
  ['Koker 80x80x4', 80, 80, 4],
  ['Koker 90x90x5', 90, 90, 5],
  ['Koker 100x100x5', 100, 100, 5],
  ['Koker 120x120x6', 120, 120, 6],
  ['Koker 140x140x6', 140, 140, 6],
  ['Koker 150x150x8', 150, 150, 8],
  ['Koker 160x160x8', 160, 160, 8],
  ['Koker 180x180x8', 180, 180, 8],
  ['Koker 200x200x10', 200, 200, 10],
  ['Koker 250x250x10', 250, 250, 10],
  ['Koker 300x300x12.5', 300, 300, 12.5],
  ['Koker 50x30x3', 30, 50, 3],
  ['Koker 60x40x4', 40, 60, 4],
  ['Koker 80x40x4', 40, 80, 4],
  ['Koker 80x60x4', 60, 80, 4],
  ['Koker 100x50x5', 50, 100, 5],
  ['Koker 100x60x5', 60, 100, 5],
  ['Koker 120x60x5', 60, 120, 5],
  ['Koker 120x80x6', 80, 120, 6],
  ['Koker 150x100x8', 100, 150, 8],
  ['Koker 160x80x8', 80, 160, 8],
  ['Koker 180x100x8', 100, 180, 8],
  ['Koker 200x100x10', 100, 200, 10],
  ['Koker 250x150x10', 150, 250, 10],
  ['Koker 300x200x12.5', 200, 300, 12.5],
];

// ── Geometry helpers ───────────────────────────────────────────────────────
// Quarter-circle fillets are approximated with short line segments so the
// whole contour stays ONE closed polyline (the parametricSymbol renderer
// strokes polylines as a single path).
function _arcPts(cx, cy, r, a0, a1, n = 4) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * (i / n);
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return out;
}

function _roundedRectPts(x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (rr === 0) {
    return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  }
  return [
    ..._arcPts(x + rr, y + rr, rr, Math.PI, 1.5 * Math.PI),
    ..._arcPts(x + w - rr, y + rr, rr, 1.5 * Math.PI, 2 * Math.PI),
    ..._arcPts(x + w - rr, y + h - rr, rr, 0, 0.5 * Math.PI),
    ..._arcPts(x + rr, y + h - rr, rr, 0.5 * Math.PI, Math.PI),
  ];
}

// U-channel (C) outline in local coords — web on the LEFT, flanges opening
// to the right. Fillets at the inner web/flange corners.
function _uSectionPts(B, H, tw, tf, r) {
  const pts = [];
  pts.push({ x: 0, y: 0 }, { x: B, y: 0 }, { x: B, y: tf });
  pts.push({ x: tw + r, y: tf });
  pts.push(..._arcPts(tw + r, tf + r, r, -Math.PI / 2, -Math.PI));   // fillet under top flange
  pts.push({ x: tw, y: H - tf - r });
  pts.push(..._arcPts(tw + r, H - tf - r, r, Math.PI, Math.PI / 2)); // fillet above bottom flange
  pts.push({ x: B, y: H - tf }, { x: B, y: H }, { x: 0, y: H });
  return pts;
}

// I/H-section outline in local coords (0,0 = top-left of the B×H section).
function _iSectionPts(B, H, tw, tf, r) {
  const xl = B / 2 - tw / 2;   // web left face
  const xr = B / 2 + tw / 2;   // web right face
  const pts = [];
  pts.push({ x: 0, y: 0 }, { x: B, y: 0 }, { x: B, y: tf });
  pts.push({ x: xr + r, y: tf });
  pts.push(..._arcPts(xr + r, tf + r, r, -Math.PI / 2, -Math.PI));   // fillet under top flange (right)
  pts.push({ x: xr, y: H - tf - r });
  pts.push(..._arcPts(xr + r, H - tf - r, r, Math.PI, Math.PI / 2)); // fillet above bottom flange (right)
  pts.push({ x: B, y: H - tf }, { x: B, y: H }, { x: 0, y: H }, { x: 0, y: H - tf });
  pts.push({ x: xl - r, y: H - tf });
  pts.push(..._arcPts(xl - r, H - tf - r, r, Math.PI / 2, 0));       // fillet above bottom flange (left)
  pts.push({ x: xl, y: tf + r });
  pts.push(..._arcPts(xl - r, tf + r, r, 0, -Math.PI / 2));          // fillet under top flange (left)
  pts.push({ x: 0, y: tf });
  return pts;
}

function _scalePts(pts, x0, y0, s) {
  return pts.map(p => ({ x: x0 + p.x * s, y: y0 + p.y * s }));
}

function _labelCmd(text, bbox) {
  const size = Math.max(9, Math.min(14, bbox.height * 0.18));
  return {
    kind: 'text',
    x: bbox.x + bbox.width / 2,
    y: bbox.y - size * 0.8,
    text,
    size,
    bold: false,
  };
}

// Dash-dot centre lines (hartlijnen) through the section centre, extending
// ~15% of the width/height beyond the section on each side.
function _hartlijnCmds(bbox) {
  const { x, y, width: w, height: h } = bbox;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const exW = w * 0.15;
  const exH = h * 0.15;
  const dashFor = (len) => {
    const u = Math.max(2.5, Math.min(12, len * 0.055));
    return [u, u * 0.45, u * 0.18, u * 0.45];
  };
  return [
    { kind: 'line', x1: x - exW, y1: cy, x2: x + w + exW, y2: cy, dash: dashFor(w + 2 * exW) },
    { kind: 'line', x1: cx, y1: y - exH, x2: cx, y2: y + h + exH, dash: dashFor(h + 2 * exH) },
  ];
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

// Scale factor param: real mm × schaal (CAD block scale — the bbox is NOT
// graphically resizable; see fixedSize + symbols/real-size.js).
function _schaalOf(params) {
  const v = parseFloat(params?.schaal);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

const _COMMON_PARAMS = [
  {
    key: 'aanzicht', label: 'Aanzicht', labelEn: 'View', type: 'enum',
    options: [
      { value: 'doorsnede', label: 'Doorsnede' },
      { value: 'boven', label: 'Bovenaanzicht' },
      { value: 'zij', label: 'Zijaanzicht' },
    ],
    default: 'doorsnede',
  },
  { key: 'schaal', label: 'Schaal', labelEn: 'Scale', type: 'number', default: 1, min: 0.1, step: 0.1 },
  { key: 'hartlijn', label: 'Hartlijnen', labelEn: 'Centre lines', type: 'boolean', default: true },
  { key: 'toonLabel', label: 'Naam tonen', labelEn: 'Show label', type: 'boolean', default: false },
];

// Line-form beam views (boven-/zijaanzicht): outline over the full bbox
// length with profile-specific inner lines. `inner` = [{ offMm, dashed }]
// offsets from the TOP edge in real mm; mmHeight = the band's real height.
function _beamViewCmds(bbox, mmHeight, inner, hartlijn) {
  const { x, y, width: w, height: h } = bbox;
  const k = h / mmHeight;
  const cmds = [{
    kind: 'polyline',
    points: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }],
    close: true,
  }];
  for (const ln of inner || []) {
    const ly = y + ln.offMm * k;
    cmds.push({
      kind: 'line', x1: x, y1: ly, x2: x + w, y2: ly,
      dash: ln.dashed ? [Math.max(3, h * 0.18), Math.max(2, h * 0.1)] : undefined,
    });
  }
  if (hartlijn) {
    const ex = w * 0.15;
    const cy = y + h / 2;
    const u = Math.max(2.5, Math.min(12, (w + 2 * ex) * 0.055));
    cmds.push({ kind: 'line', x1: x - ex, y1: cy, x2: x + w + ex, y2: cy, dash: [u, u * 0.45, u * 0.18, u * 0.45] });
  }
  return cmds;
}

// ── Template factories ─────────────────────────────────────────────────────
// Shared factory for [maat, h, b, tw, tf, r] section families; the contour
// function decides the shape (I/H vs U).
function _iProfileTemplate(id, familyName, table, defaultMaat, sectionPtsFn = _iSectionPts) {
  const byName = new Map(table.map(row => [row[0], row]));
  return {
    id,
    name: familyName,
    nameEn: familyName,
    category: 'NL Constructie',
    defaultSize: { width: 60, height: 60 },
    // No graphic resize handles — size comes from maat × schaal (real mm).
    fixedSize: true,
    params: [
      {
        key: 'maat', label: 'Maat', labelEn: 'Size', type: 'enum',
        options: table.map(r => r[0]),
        default: defaultMaat,
      },
      ..._COMMON_PARAMS,
    ],
    // Real-world size in mm → bbox sizing (symbols/real-size.js).
    // Doorsnede: vaste b×h. Boven-/zijaanzicht: LINE-FORM — height locked to
    // the profile dimension, width (= lengte van de ligger) stays free and
    // is adjustable with the left/right grips.
    realSizeMm(params) {
      const row = byName.get(params?.maat) || byName.get(defaultMaat);
      if (!row) return null;
      const f = _schaalOf(params);
      const az = params?.aanzicht || 'doorsnede';
      if (az === 'boven') return { width: null, height: row[2] * f }; // flensbreedte b
      if (az === 'zij') return { width: null, height: row[1] * f };   // profielhoogte h
      return { width: row[2] * f, height: row[1] * f };
    },
    freeAxis(params) {
      return (params?.aanzicht || 'doorsnede') !== 'doorsnede' ? 'x' : null;
    },
    snapPoints: _snapPoints,
    render(params, bbox) {
      const row = byName.get(params?.maat) || byName.get(defaultMaat);
      if (!row) return [];
      const [maat, H, B, tw, tf, r] = row;
      const az = params?.aanzicht || 'doorsnede';
      if (az === 'boven') {
        // Top view: flange width band; the web is hidden → dashed lines.
        // U-profile: web against one edge (visible top face → solid).
        const inner = sectionPtsFn === _uSectionPts
          ? [{ offMm: tw, dashed: false }]
          : [
              { offMm: B / 2 - tw / 2, dashed: true },
              { offMm: B / 2 + tw / 2, dashed: true },
            ];
        const cmds = _beamViewCmds(bbox, B, inner, params?.hartlijn !== false);
        if (params?.toonLabel) cmds.push(_labelCmd(maat, bbox));
        return cmds;
      }
      if (az === 'zij') {
        // Side elevation: profile height band; flange faces are visible
        // edges → solid lines at tf from top and bottom.
        const cmds = _beamViewCmds(bbox, H, [
          { offMm: tf, dashed: false },
          { offMm: H - tf, dashed: false },
        ], params?.hartlijn !== false);
        if (params?.toonLabel) cmds.push(_labelCmd(maat, bbox));
        return cmds;
      }
      const s = Math.min(bbox.width / B, bbox.height / H);
      const x0 = bbox.x + (bbox.width - B * s) / 2;
      const y0 = bbox.y + (bbox.height - H * s) / 2;
      // Solid black section (NL drafting: steel = solid fill).
      const cmds = [{
        kind: 'rings',
        loops: [_scalePts(sectionPtsFn(B, H, tw, tf, r), x0, y0, s)],
        fill: true,
      }];
      if (params?.hartlijn !== false) cmds.push(..._hartlijnCmds(bbox));
      if (params?.toonLabel) cmds.push(_labelCmd(maat, bbox));
      return cmds;
    },
  };
}

function _kokerTemplate() {
  const byName = new Map(KOKER.map(row => [row[0], row]));
  const defaultMaat = 'Koker 100x100x5';
  return {
    id: 'staal-koker',
    name: 'Koker',
    nameEn: 'Hollow section',
    category: 'NL Constructie',
    defaultSize: { width: 60, height: 60 },
    fixedSize: true,
    params: [
      {
        key: 'maat', label: 'Maat', labelEn: 'Size', type: 'enum',
        options: KOKER.map(r => r[0]),
        default: defaultMaat,
      },
      ..._COMMON_PARAMS,
    ],
    realSizeMm(params) {
      const row = byName.get(params?.maat) || byName.get(defaultMaat);
      if (!row) return null;
      const f = _schaalOf(params);
      const az = params?.aanzicht || 'doorsnede';
      if (az === 'boven') return { width: null, height: row[2] * f };
      if (az === 'zij') return { width: null, height: row[1] * f };
      return { width: row[2] * f, height: row[1] * f };
    },
    freeAxis(params) {
      return (params?.aanzicht || 'doorsnede') !== 'doorsnede' ? 'x' : null;
    },
    snapPoints: _snapPoints,
    render(params, bbox) {
      const row = byName.get(params?.maat) || byName.get(defaultMaat);
      if (!row) return [];
      const [maat, H, B, t] = row;
      const az = params?.aanzicht || 'doorsnede';
      if (az === 'boven' || az === 'zij') {
        // Hollow section beam view: walls are hidden → dashed inner lines.
        const dim = az === 'boven' ? B : H;
        const cmds = _beamViewCmds(bbox, dim, [
          { offMm: t, dashed: true },
          { offMm: dim - t, dashed: true },
        ], params?.hartlijn !== false);
        if (params?.toonLabel) cmds.push(_labelCmd(maat, bbox));
        return cmds;
      }
      const s = Math.min(bbox.width / B, bbox.height / H);
      const x0 = bbox.x + (bbox.width - B * s) / 2;
      const y0 = bbox.y + (bbox.height - H * s) / 2;
      // Cold-formed corner radii: outer ≈ 2t, inner ≈ t. Walls solid black
      // via evenodd rings (inner loop cuts the opening).
      const ro = 2 * t, ri = t;
      const cmds = [{
        kind: 'rings',
        loops: [
          _scalePts(_roundedRectPts(0, 0, B, H, ro), x0, y0, s),
          _scalePts(_roundedRectPts(t, t, B - 2 * t, H - 2 * t, ri), x0, y0, s),
        ],
        fill: true,
      }];
      if (params?.hartlijn !== false) cmds.push(..._hartlijnCmds(bbox));
      if (params?.toonLabel) cmds.push(_labelCmd(maat, bbox));
      return cmds;
    },
  };
}


// Hoeklijnen (L-profielen, EN 10056-1): [maat, h, b, t, r] in mm — h = de
// staande (lange) poot, b = de liggende poot, t = dikte, r = binnenradius.
// Gelijkzijdig en ongelijkzijdig in één familie; de maat wisselt in het
// eigenschappenpaneel.
const HOEKLIJN = [
  ['L 40x40x4', 40, 40, 4, 6],
  ['L 45x45x4.5', 45, 45, 4.5, 7],
  ['L 50x50x5', 50, 50, 5, 7],
  ['L 60x60x6', 60, 60, 6, 8],
  ['L 70x70x7', 70, 70, 7, 9],
  ['L 75x75x8', 75, 75, 8, 9],
  ['L 80x80x8', 80, 80, 8, 10],
  ['L 90x90x9', 90, 90, 9, 11],
  ['L 100x100x10', 100, 100, 10, 12],
  ['L 110x110x10', 110, 110, 10, 12],
  ['L 120x120x12', 120, 120, 12, 13],
  ['L 130x130x12', 130, 130, 12, 14],
  ['L 150x150x15', 150, 150, 15, 16],
  ['L 160x160x15', 160, 160, 15, 17],
  ['L 180x180x18', 180, 180, 18, 18],
  ['L 200x200x20', 200, 200, 20, 18],
  ['L 100x50x6', 100, 50, 6, 8],
  ['L 100x65x7', 100, 65, 7, 10],
  ['L 100x75x8', 100, 75, 8, 10],
  ['L 110x70x8', 110, 70, 8, 10],
  ['L 120x80x10', 120, 80, 10, 11],
  ['L 125x75x8', 125, 75, 8, 11],
  ['L 135x65x8', 135, 65, 8, 11],
  ['L 150x75x10', 150, 75, 10, 11],
  ['L 150x90x10', 150, 90, 10, 12],
  ['L 150x100x12', 150, 100, 12, 12],
  ['L 150x110x10', 150, 110, 10, 12],
  ['L 200x100x10', 200, 100, 10, 15],
  ['L 200x110x12', 200, 110, 12, 15],
  ['L 200x150x12', 200, 150, 12, 15],
];

// L-doorsnede in lokale coördinaten (0,0 = linksboven van b×h): staande
// poot links (dikte t, hoogte H), liggende poot onder (lengte B, dikte t),
// binnenradius r in de oksel.
function _hoeklijnPts(B, H, t, r) {
  const rr = Math.max(0, Math.min(r, (B - t) / 2, (H - t) / 2));
  const pts = [{ x: 0, y: 0 }, { x: t, y: 0 }, { x: t, y: H - t - rr }];
  if (rr > 0) pts.push(..._arcPts(t + rr, H - t - rr, rr, Math.PI, Math.PI / 2));
  else pts.push({ x: t, y: H - t });
  pts.push({ x: B, y: H - t }, { x: B, y: H }, { x: 0, y: H });
  return pts;
}

function _hoeklijnTemplate() {
  const byName = new Map(HOEKLIJN.map(row => [row[0], row]));
  const defaultMaat = 'L 100x100x10';
  return {
    id: 'staal-hoeklijn',
    name: 'Hoeklijn',
    nameEn: 'Angle',
    category: 'NL Constructie',
    defaultSize: { width: 60, height: 60 },
    fixedSize: true,
    params: [
      {
        key: 'maat', label: 'Maat', labelEn: 'Size', type: 'enum',
        options: HOEKLIJN.map(r => r[0]),
        default: defaultMaat,
      },
      ..._COMMON_PARAMS,
    ],
    realSizeMm(params) {
      const row = byName.get(params?.maat) || byName.get(defaultMaat);
      if (!row) return null;
      const f = _schaalOf(params);
      const az = params?.aanzicht || 'doorsnede';
      if (az === 'boven') return { width: null, height: row[2] * f }; // liggende poot b
      if (az === 'zij') return { width: null, height: row[1] * f };   // staande poot h
      return { width: row[2] * f, height: row[1] * f };
    },
    freeAxis(params) {
      return (params?.aanzicht || 'doorsnede') !== 'doorsnede' ? 'x' : null;
    },
    snapPoints: _snapPoints,
    render(params, bbox) {
      const row = byName.get(params?.maat) || byName.get(defaultMaat);
      if (!row) return [];
      const [maat, H, B, t, r] = row;
      const az = params?.aanzicht || 'doorsnede';
      if (az === 'boven') {
        // Van boven: de liggende poot als band, de staande poot tegen één
        // rand → zichtbare bovenkant, dus een doorgetrokken lijn op t.
        const cmds = _beamViewCmds(bbox, B, [{ offMm: t, dashed: false }], params?.hartlijn !== false);
        if (params?.toonLabel) cmds.push(_labelCmd(maat, bbox));
        return cmds;
      }
      if (az === 'zij') {
        // Van opzij: de staande poot als band, de liggende poot onderaan
        // zichtbaar → doorgetrokken lijn op H - t.
        const cmds = _beamViewCmds(bbox, H, [{ offMm: H - t, dashed: false }], params?.hartlijn !== false);
        if (params?.toonLabel) cmds.push(_labelCmd(maat, bbox));
        return cmds;
      }
      const s = Math.min(bbox.width / B, bbox.height / H);
      const x0 = bbox.x + (bbox.width - B * s) / 2;
      const y0 = bbox.y + (bbox.height - H * s) / 2;
      const cmds = [{
        kind: 'rings',
        loops: [_scalePts(_hoeklijnPts(B, H, t, r), x0, y0, s)],
        fill: true,
      }];
      if (params?.hartlijn !== false) cmds.push(..._hartlijnCmds(bbox));
      if (params?.toonLabel) cmds.push(_labelCmd(maat, bbox));
      return cmds;
    },
  };
}

export const heaTemplate = _iProfileTemplate('staal-hea', 'HEA', HEA, 'HEA 200');
export const hebTemplate = _iProfileTemplate('staal-heb', 'HEB', HEB, 'HEB 200');
export const ipeTemplate = _iProfileTemplate('staal-ipe', 'IPE', IPE, 'IPE 200');
export const unpTemplate = _iProfileTemplate('staal-unp', 'UNP', UNP, 'UNP 200', _uSectionPts);
export const kokerTemplate = _kokerTemplate();
export const hoeklijnTemplate = _hoeklijnTemplate();
export { _hoeklijnPts as hoeklijnPts, HOEKLIJN as HOEKLIJN_TABEL };

// Geometry/behaviour helpers, reused by the catalog-driven steel templates
// (js/symbols/steel-catalog.js) so downloaded country catalogs render and
// behave EXACTLY like the built-in NL profiles. Pure re-exports — the NL
// tables and templates above are untouched.
export {
  _arcPts as arcPts,
  _roundedRectPts as roundedRectPts,
  _iSectionPts as iSectionPts,
  _uSectionPts as uSectionPts,
  _scalePts as scalePts,
  _labelCmd as labelCmd,
  _hartlijnCmds as hartlijnCmds,
  _snapPoints as steelSnapPoints,
  _schaalOf as schaalOf,
  _COMMON_PARAMS as STEEL_COMMON_PARAMS,
  _beamViewCmds as beamViewCmds,
};
