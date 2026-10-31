// Structural schematization symbols (constructieve schematisering): the
// building blocks of a calculation sketch — member, node, supports, point
// load, distributed load and moment.
//
// Two placement families, one principle: every symbol sits ON its system
// line or node, so snapping, rotation and two-point placement keep it there.
//
//   * Members and distributed loads ('staaf', 'verdeelde-last') are drawn
//     along a line (placement 'two-point'): the two clicked points are the
//     member axis or the loaded stretch. The band is symmetric about that
//     axis; its height is a paper size (defaultSize × symbol scale), the
//     length is real: `lengte` (mm) follows the drawn distance through the
//     measure scale and resizes the symbol when edited.
//   * Node symbols ('oplegging', 'puntlast', 'moment', 'knoop') are a box
//     centred on the node: a click puts the node exactly on the clicked
//     (snapped) point and a rotation turns the symbol about the node, so a
//     support or load on an inclined member stays attached.
//
// These are diagram symbols, not physical objects: their size is a paper
// size (like a level mark or a grid bubble) and the symbol scale applies.
// The drawing scale follows the box height; the box width follows the
// content (label length) via `breedteBijHoogte`, see symbols/real-size.js.
//
// Line weights relative to the symbol line width: members double, supports
// single, loads and hatching thin; arrowheads filled. Labels use a Dutch
// decimal comma.
//
// Legacy: 'oplegging' and 'puntlast' existed as plain box symbols with the
// node at the top or bottom edge. Placed annotations from before carry no
// `opzet` parameter and keep that layout ('vak'); new placements get the
// hidden default 'knoop' (node-centred).

// ── Shared drawing constants (local units: 1 unit = 1 pt at default size) ──
const T = 8;              // text height
const PIJL_L = 6;         // arrowhead length
const PIJL_B = 2.2;       // arrowhead half width
const LW_STAAF = 2;       // member: double symbol line width
const LW_LAST = 0.7;      // loads: thin
const LW_ARCERING = 0.5;  // hatching: thin

function getal(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function positief(v, d) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
}

/** Number as a Dutch label: at most 3 decimals, decimal comma. */
export function nlGetal(v) {
  const n = Math.round(getal(v, 0) * 1000) / 1000;
  return String(Object.is(n, -0) ? 0 : n).replace('.', ',');
}

// Approximate Arial advance widths (em). Only used to size the box and the
// editable-label rectangles; the renderer measures nothing.
const _BREEDTE = {
  ' ': 0.278, ',': 0.278, '.': 0.278, '/': 0.278, ':': 0.278, ';': 0.278,
  '=': 0.584, '+': 0.584, '-': 0.333, '–': 0.556, '²': 0.333, '³': 0.333,
  '(': 0.333, ')': 0.333, '[': 0.278, ']': 0.278, '…': 1,
  i: 0.222, j: 0.222, l: 0.222, f: 0.278, t: 0.278, r: 0.333, k: 0.5,
  s: 0.5, v: 0.5, x: 0.5, y: 0.5, z: 0.5, c: 0.5, m: 0.833, w: 0.722,
  I: 0.278, J: 0.5, M: 0.833, W: 0.944, N: 0.722, F: 0.611, T: 0.611,
  L: 0.556, E: 0.667, Z: 0.611, O: 0.778, Q: 0.778, G: 0.778, C: 0.722,
  D: 0.722, H: 0.722, R: 0.722, U: 0.722,
};

/** Estimated width of `tekst` at font size `size` (Arial). */
export function tekstBreedte(tekst, size) {
  let em = 0;
  for (const ch of String(tekst ?? '')) {
    if (_BREEDTE[ch] != null) em += _BREEDTE[ch];
    else if (ch >= '0' && ch <= '9') em += 0.556;
    else if (ch >= 'A' && ch <= 'Z') em += 0.667;
    else em += 0.556;
  }
  return em * size;
}

// ── Local building blocks (y down, node at the origin) ─────────────────────

function lijn(x1, y1, x2, y2, extra) {
  return { kind: 'line', x1, y1, x2, y2, ...extra };
}

/** Filled arrowhead with its tip at (tx, ty), pointing along (dx, dy). */
function pijlpunt(tx, ty, dx, dy, lengte = PIJL_L, half = PIJL_B, role = 'pijlpunt') {
  const n = Math.hypot(dx, dy) || 1;
  const ux = dx / n, uy = dy / n;
  const bx = tx - ux * lengte, by = ty - uy * lengte;
  return {
    kind: 'polyline', close: true, fill: true, lineWidthFactor: LW_LAST, role,
    points: [
      { x: tx, y: ty },
      { x: bx - uy * half, y: by + ux * half },
      { x: bx + uy * half, y: by - ux * half },
    ],
  };
}

/** Circle as a closed polyline, so it can be filled (white = masks lines). */
function schijf(cx, cy, r, fill, extra) {
  const points = [];
  const N = 28;
  for (let i = 0; i < N; i++) {
    const a = (2 * Math.PI * i) / N;
    points.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return { kind: 'polyline', close: true, fill, points, ...extra };
}

/**
 * Ground or clamp hatching under a line at height y, from x0 to x1: 45°
 * strokes down-left, kept inside [x0, x1].
 */
function arcering(x0, x1, y, diepte = 4, stap = 3.2) {
  const cmds = [];
  for (let x = x0 + diepte; x <= x1 + 1e-6; x += stap) {
    cmds.push(lijn(x, y, x - diepte, y + diepte, { lineWidthFactor: LW_ARCERING, role: 'arcering' }));
  }
  return cmds;
}

function tekst(x, y, text, extra) {
  return { kind: 'text', x, y, text, size: T, ...extra };
}

// ── Local → page mapping ────────────────────────────────────────────────────

/** Extent of local commands; text uses the estimated width. */
export function omhullende(cmds) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const p = (x, y) => {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  };
  for (const c of cmds) {
    if (c.kind === 'line') { p(c.x1, c.y1); p(c.x2, c.y2); }
    else if (c.kind === 'circle') { p(c.cx - c.r, c.cy - c.r); p(c.cx + c.r, c.cy + c.r); }
    else if (c.kind === 'arc') {
      const N = 48;
      for (let i = 0; i <= N; i++) {
        const a = c.a0 + ((c.a1 - c.a0) * i) / N;
        p(c.cx + c.r * Math.cos(a), c.cy + c.r * Math.sin(a));
      }
    } else if (c.kind === 'text') {
      const w = tekstBreedte(c.text, c.size);
      p(c.x - w / 2, c.y - c.size / 2); p(c.x + w / 2, c.y + c.size / 2);
    } else if (Array.isArray(c.points)) {
      for (const q of c.points) p(q.x, q.y);
    }
  }
  if (!Number.isFinite(x0)) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  return { x0, y0, x1, y1 };
}

/** Map local commands with scale S and origin (ox, oy) to the page. */
function plaats(cmds, S, ox, oy) {
  const X = (v) => ox + v * S;
  const Y = (v) => oy + v * S;
  return cmds.map((c) => {
    switch (c.kind) {
      case 'line': return { ...c, x1: X(c.x1), y1: Y(c.y1), x2: X(c.x2), y2: Y(c.y2) };
      case 'circle': return { ...c, cx: X(c.cx), cy: Y(c.cy), r: c.r * S };
      case 'arc': return { ...c, cx: X(c.cx), cy: Y(c.cy), r: c.r * S };
      case 'text': return { ...c, x: X(c.x), y: Y(c.y), size: c.size * S };
      default:
        return Array.isArray(c.points)
          ? { ...c, points: c.points.map((q) => ({ x: X(q.x), y: Y(q.y) })) }
          : { ...c };
    }
  });
}

/**
 * Box-symbol layout: scale and node position in the page.
 * opzet 'knoop' (new): node in the box centre, scale from the fixed half
 * height HY (or the content width when the box is narrower).
 * opzet 'vak' (legacy): the drawing's extent fitted into the box.
 */
function vakIndeling(lok, params, bbox) {
  const w = Math.max(1e-6, bbox.width);
  const h = Math.max(1e-6, bbox.height);
  if (params?.opzet === 'knoop') {
    const S = Math.min(w / (2 * lok.HX), h / (2 * lok.HY));
    return { S, ox: bbox.x + w / 2, oy: bbox.y + h / 2 };
  }
  const e = omhullende(lok.cmds);
  const ew = Math.max(1e-6, e.x1 - e.x0);
  const eh = Math.max(1e-6, e.y1 - e.y0);
  const S = Math.min(w / ew, h / eh);
  return {
    S,
    ox: bbox.x + (w - ew * S) / 2 - e.x0 * S,
    oy: bbox.y + (h - eh * S) / 2 - e.y0 * S,
  };
}

/** Editable-label rectangle around a page text command. */
function labelRect(c) {
  const w = tekstBreedte(c.text, c.size);
  return { x: c.x - w / 2, y: c.y - c.size * 0.6, width: w, height: c.size * 1.2 };
}

/**
 * Template parts shared by every box symbol: render, snap point at the
 * node, box width that follows the content, editable value label.
 */
function vakSymbool(lokaal, { labelVeld = null, snapSoorten = ['endpoint'] } = {}) {
  const indeling = (params, bbox) => {
    const lok = lokaal(params || {});
    return { lok, ...vakIndeling(lok, params, bbox) };
  };
  return {
    render(params = {}, bbox) {
      const { lok, S, ox, oy } = indeling(params, bbox);
      return plaats(lok.cmds, S, ox, oy);
    },
    snapPoints(params = {}, bbox) {
      const { S, ox, oy } = indeling(params, bbox);
      void S;
      return snapSoorten.map((kind) => ({ kind, x: ox, y: oy }));
    },
    /** Node position (page, unrotated box) — for tests and tools. */
    knoopPunt(params = {}, bbox) {
      const { ox, oy } = indeling(params, bbox);
      return { x: ox, y: oy };
    },
    /** Box width that fits the content at this box height (node-centred only). */
    breedteBijHoogte(params = {}, hoogte) {
      if (params?.opzet !== 'knoop' || !(hoogte > 0)) return null;
      const lok = lokaal(params);
      return (2 * lok.HX * hoogte) / (2 * lok.HY);
    },
    editableLabels(params = {}, bbox) {
      if (!labelVeld) return [];
      const { lok, S, ox, oy } = indeling(params, bbox);
      const label = plaats(lok.cmds, S, ox, oy).find((c) => c.role === 'label');
      return label ? [{ id: 'label', rect: labelRect(label), fields: [labelVeld] }] : [];
    },
  };
}

// Hidden layout switch: absent on symbols placed before this layout existed.
const OPZET_PARAM = {
  key: 'opzet', label: 'Opzet', labelEn: 'Layout', type: 'enum', hidden: true,
  options: [
    { value: 'knoop', label: 'Knoop in het midden' },
    { value: 'vak', label: 'Vak (oud)' },
  ],
  default: 'knoop',
};

// ── Oplegging (support) ─────────────────────────────────────────────────────

export const OPLEGGING_TYPEN = [
  { value: 'scharnier', label: 'Scharnierend', labelEn: 'Pinned' },
  { value: 'rol', label: 'Rol', labelEn: 'Roller' },
  { value: 'inklemming', label: 'Inklemming', labelEn: 'Fixed' },
  { value: 'veer', label: 'Verend (translatieveer)', labelEn: 'Spring (translational)' },
  { value: 'rotatieveer', label: 'Rotatieveer (verende inklemming)', labelEn: 'Rotational spring' },
];
const OPL_HX = 12;
const OPL_HY = 20;

function opleggingLokaal(params) {
  const type = OPLEGGING_TYPEN.some((t) => t.value === params.type) ? params.type : 'scharnier';
  const cmds = [];
  const grond = (y, half = OPL_HX, extra = {}) => {
    cmds.push(lijn(-half, y, half, y, { role: 'grond', ...extra }));
    cmds.push(...arcering(-half, half, y));
  };
  const driehoek = (hoogte, half) => cmds.push({
    kind: 'polyline', close: true, role: 'driehoek',
    points: [{ x: 0, y: 0 }, { x: -half, y: hoogte }, { x: half, y: hoogte }],
  });

  if (type === 'scharnier') {
    driehoek(14, 8);
    grond(14);
  } else if (type === 'rol') {
    if (params.rolStijl === 'lijn') {
      // Triangle on a line, then the hatched ground: the "double line".
      driehoek(11.5, 8);
      grond(14.5);
    } else {
      // Triangle on two rollers.
      driehoek(11, 8);
      const r = 1.6;
      for (const rx of [-4.5, 4.5]) cmds.push({ kind: 'circle', cx: rx, cy: 11 + r, r, role: 'rol' });
      grond(11 + 2 * r);
    }
  } else if (type === 'inklemming') {
    // Thick clamp line through the node, hatching behind it.
    grond(0, OPL_HX, { lineWidthFactor: LW_STAAF });
  } else if (type === 'veer') {
    const top = 2, onder = 13, amp = 3.5, slagen = 8;
    const pts = [{ x: 0, y: 0 }, { x: 0, y: top }];
    for (let k = 1; k < slagen; k++) {
      pts.push({ x: k % 2 ? amp : -amp, y: top + ((onder - top) * k) / slagen });
    }
    pts.push({ x: 0, y: onder }, { x: 0, y: 15 });
    cmds.push({ kind: 'polyline', points: pts, role: 'veer' });
    grond(15, 9);
  } else {
    // Rotational spring: a spiral round the node whose outer end is held by
    // a clamped base.
    const r0 = 1, r1 = 5.5, slagen = 1.75;
    const aMax = slagen * 2 * Math.PI;
    const aStart = Math.PI / 2 - aMax;   // ends pointing straight down
    const pts = [];
    const N = 60;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const a = aStart + aMax * t;
      const r = r0 + (r1 - r0) * t;
      pts.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
    }
    cmds.push({ kind: 'polyline', points: pts, role: 'veer' });
    cmds.push(lijn(0, r1, 0, 12, { role: 'veer' }));
    grond(12, 8, { lineWidthFactor: LW_STAAF });
  }

  // Optional hinge circle at the node (pinned and roller supports).
  if (params.scharnierTonen === true && (type === 'scharnier' || type === 'rol')) {
    cmds.push(schijf(0, 0, 1.8, '#ffffff', { role: 'scharnier' }));
  }
  return { cmds, HX: OPL_HX, HY: OPL_HY };
}

const _oplegging = vakSymbool(opleggingLokaal);

export const opleggingTemplate = {
  id: 'oplegging',
  name: 'Oplegging',
  nameEn: 'Support',
  category: 'NL Constructie',
  defaultSize: { width: 2 * OPL_HX, height: 2 * OPL_HY },
  params: [
    {
      key: 'type', label: 'Type', labelEn: 'Type', type: 'enum',
      options: OPLEGGING_TYPEN.map(({ value, label }) => ({ value, label })),
      default: 'scharnier',
    },
    {
      key: 'rolStijl', label: 'Weergave rol', labelEn: 'Roller style', type: 'enum',
      options: [
        { value: 'rollen', label: 'Driehoek op rollen' },
        { value: 'lijn', label: 'Driehoek met dubbele lijn' },
      ],
      default: 'rollen',
    },
    { key: 'scharnierTonen', label: 'Scharniercirkel', labelEn: 'Hinge circle', type: 'boolean', default: false },
    OPZET_PARAM,
  ],
  ..._oplegging,
};

// ── Puntlast (point load) ───────────────────────────────────────────────────

const PL_LENGTE = 28;
const PL_HY = PL_LENGTE + 2.5 + T;

export function puntlastLabel(params = {}) {
  const sym = String(params.symbool ?? 'F').trim() || 'F';
  const eenheid = params.eenheid === 'N' ? 'N' : 'kN';
  return `${sym} = ${nlGetal(positiefOfNul(params.kracht, 10))} ${eenheid}`;
}

function positiefOfNul(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function puntlastLokaal(params) {
  const cmds = [
    lijn(0, -PL_LENGTE, 0, -PIJL_L * 0.9, { lineWidthFactor: LW_LAST, role: 'pijl' }),
    pijlpunt(0, 0, 0, 1),
  ];
  let HX = PIJL_B + 0.5;
  if (params.labelTonen !== false) {
    const t = tekst(0, -(PL_LENGTE + 2.5 + T / 2), puntlastLabel(params), { role: 'label' });
    cmds.push(t);
    HX = Math.max(HX, tekstBreedte(t.text, T) / 2 + 0.5);
  }
  return { cmds, HX, HY: PL_HY };
}

const _puntlast = vakSymbool(puntlastLokaal, { labelVeld: 'kracht' });

export const puntlastTemplate = {
  id: 'puntlast',
  name: 'Puntlast',
  nameEn: 'Point load',
  category: 'NL Constructie',
  defaultSize: {
    width: Math.round(tekstBreedte('F = 10 kN', T) + 1),
    height: 2 * PL_HY,
  },
  params: [
    { key: 'symbool', label: 'Symbool', labelEn: 'Symbol', type: 'string', default: 'F' },
    { key: 'kracht', label: 'Kracht', labelEn: 'Force', type: 'number', default: 10, step: 1 },
    {
      key: 'eenheid', label: 'Eenheid', labelEn: 'Unit', type: 'enum',
      options: [{ value: 'kN', label: 'kN' }, { value: 'N', label: 'N' }], default: 'kN',
    },
    { key: 'labelTonen', label: 'Label tonen', labelEn: 'Show label', type: 'boolean', default: true },
    OPZET_PARAM,
  ],
  ..._puntlast,
};

// ── Moment ──────────────────────────────────────────────────────────────────

const MOM_R = 9;
const MOM_A0 = (3 * Math.PI) / 4;     // lower left
const MOM_A1 = (9 * Math.PI) / 4;     // lower right, through the top
const MOM_HY = MOM_R + 2.5 + T;

export function momentLabel(params = {}) {
  const sym = String(params.symbool ?? 'M').trim() || 'M';
  const eenheid = ['kNm', 'Nm', 'Nmm'].includes(params.eenheid) ? params.eenheid : 'kNm';
  return `${sym} = ${nlGetal(positiefOfNul(params.waarde, 10))} ${eenheid}`;
}

function momentLokaal(params) {
  const r = MOM_R;
  const P = (a) => ({ x: r * Math.cos(a), y: r * Math.sin(a) });
  const d = PIJL_L / r;                 // arrowhead length as an angle
  const rechtsom = params.richting !== 'linksom';
  // Canvas angles grow clockwise on screen (y down): a clockwise moment
  // ends at MOM_A1, an anticlockwise one at MOM_A0.
  const tipA = rechtsom ? MOM_A1 : MOM_A0;
  const baseA = rechtsom ? MOM_A1 - d : MOM_A0 + d;
  const tip = P(tipA);
  const basis = P(baseA);
  const cmds = [
    {
      kind: 'arc', cx: 0, cy: 0, r,
      a0: rechtsom ? MOM_A0 : MOM_A0 + d * 0.5,
      a1: rechtsom ? MOM_A1 - d * 0.5 : MOM_A1,
      lineWidthFactor: LW_LAST, role: 'boog',
    },
    pijlpunt(tip.x, tip.y, tip.x - basis.x, tip.y - basis.y),
  ];
  let HX = r + PIJL_B + 1;
  if (params.labelTonen !== false) {
    const t = tekst(0, -(r + 2.5 + T / 2), momentLabel(params), { role: 'label' });
    cmds.push(t);
    HX = Math.max(HX, tekstBreedte(t.text, T) / 2 + 0.5);
  }
  return { cmds, HX, HY: MOM_HY };
}

const _moment = vakSymbool(momentLokaal, { labelVeld: 'waarde', snapSoorten: ['endpoint', 'center'] });

export const momentTemplate = {
  id: 'moment',
  name: 'Moment',
  nameEn: 'Moment',
  category: 'NL Constructie',
  defaultSize: {
    width: Math.round(tekstBreedte('M = 10 kNm', T) + 1),
    height: 2 * MOM_HY,
  },
  params: [
    { key: 'symbool', label: 'Symbool', labelEn: 'Symbol', type: 'string', default: 'M' },
    { key: 'waarde', label: 'Moment', labelEn: 'Moment', type: 'number', default: 10, step: 1 },
    {
      key: 'eenheid', label: 'Eenheid', labelEn: 'Unit', type: 'enum',
      options: [{ value: 'kNm', label: 'kNm' }, { value: 'Nm', label: 'Nm' }, { value: 'Nmm', label: 'Nmm' }],
      default: 'kNm',
    },
    {
      key: 'richting', label: 'Draairichting', labelEn: 'Direction', type: 'enum',
      options: [
        { value: 'rechtsom', label: 'Rechtsom (met de klok mee)' },
        { value: 'linksom', label: 'Linksom (tegen de klok in)' },
      ],
      default: 'rechtsom',
    },
    { key: 'labelTonen', label: 'Label tonen', labelEn: 'Show label', type: 'boolean', default: true },
    { ...OPZET_PARAM },
  ],
  ..._moment,
};

// ── Knoop (node) ────────────────────────────────────────────────────────────

const KN_R = 2.4;
const KN_HY = KN_R + 1.5 + T;

const KN_NAAM_POSITIES = [
  { value: 'rechtsboven', label: 'Rechtsboven', fx: 1, fy: -1 },
  { value: 'linksboven', label: 'Linksboven', fx: -1, fy: -1 },
  { value: 'rechtsonder', label: 'Rechtsonder', fx: 1, fy: 1 },
  { value: 'linksonder', label: 'Linksonder', fx: -1, fy: 1 },
];

function knoopLokaal(params) {
  const scharnier = params.type === 'scharnier';
  const cmds = [scharnier
    // Hinge: open circle, white inside so a member through it stops at the rim.
    ? schijf(0, 0, KN_R, '#ffffff', { role: 'scharnier' })
    : schijf(0, 0, KN_R * 0.85, true, { role: 'knoop' })];
  let HX = KN_HY;
  const naam = String(params.naam ?? '').trim();
  if (naam) {
    const pos = KN_NAAM_POSITIES.find((p) => p.value === params.naamPositie) || KN_NAAM_POSITIES[0];
    const w = tekstBreedte(naam, T);
    const d = KN_R + 1.5;
    cmds.push(tekst(pos.fx * (d + w / 2), pos.fy * (d + T / 2), naam, { role: 'naam' }));
    HX = Math.max(HX, d + w + 0.5);
  }
  return { cmds, HX, HY: KN_HY };
}

export const knoopTemplate = {
  id: 'knoop',
  name: 'Knoop',
  nameEn: 'Node',
  category: 'NL Constructie',
  defaultSize: { width: 2 * KN_HY, height: 2 * KN_HY },
  params: [
    {
      key: 'type', label: 'Type', labelEn: 'Type', type: 'enum',
      options: [
        { value: 'knoop', label: 'Knoop (stijf)' },
        { value: 'scharnier', label: 'Scharnier' },
      ],
      default: 'knoop',
    },
    { key: 'naam', label: 'Naam', labelEn: 'Name', type: 'string', default: '' },
    {
      key: 'naamPositie', label: 'Positie naam', labelEn: 'Name position', type: 'enum',
      options: KN_NAAM_POSITIES.map(({ value, label }) => ({ value, label })), default: 'rechtsboven',
    },
    { ...OPZET_PARAM },
  ],
  ...vakSymbool(knoopLokaal, { snapSoorten: ['endpoint', 'center'] }),
};

// ── Line symbols (two-point) ────────────────────────────────────────────────

/** Axis of a two-point band: start/end x, axis y and the local scale. */
function band(bbox, halfHoogte) {
  const h = Math.max(1e-6, bbox.height);
  return {
    x0: bbox.x,
    x1: bbox.x + Math.max(0, bbox.width),
    yA: bbox.y + h / 2,
    S: h / (2 * halfHoogte),
  };
}

function lengteVan(params, d) {
  return positief(params?.lengte, d);
}

function bandSnapPoints(halfHoogte) {
  return (_params, bbox) => {
    const b = band(bbox, halfHoogte);
    return [
      { kind: 'endpoint', x: b.x0, y: b.yA },
      { kind: 'endpoint', x: b.x1, y: b.yA },
      { kind: 'midpoint', x: (b.x0 + b.x1) / 2, y: b.yA },
    ];
  };
}

// ── Staaf (member) ──────────────────────────────────────────────────────────

const ST_HB = 3 + T + 1;          // half band: a label on either side
const ST_R = 2.2;                 // hinge circle radius

export const STAAF_EINDEN = [
  { value: 'star', label: 'Star (doorgaand)' },
  { value: 'scharnier', label: 'Scharnier (open cirkel)' },
];

export function staafLengteLabel(params = {}) {
  const m = lengteVan(params, 6000) / 1000;
  return `L = ${(Math.round(m * 100) / 100).toFixed(2).replace('.', ',')} m`;
}

export const staafTemplate = {
  id: 'staaf',
  name: 'Staaf',
  nameEn: 'Member',
  category: 'NL Constructie',
  defaultSize: { width: 240, height: 2 * ST_HB },
  placement: 'two-point',
  params: [
    { key: 'begin', label: 'Begin', labelEn: 'Start', type: 'enum', options: STAAF_EINDEN, default: 'star' },
    { key: 'eind', label: 'Eind', labelEn: 'End', type: 'enum', options: STAAF_EINDEN, default: 'star' },
    { key: 'label', label: 'Naam / profiel', labelEn: 'Name / section', type: 'string', default: '' },
    {
      key: 'labelZijde', label: 'Naam aan zijde', labelEn: 'Name side', type: 'enum',
      options: [{ value: 'onder', label: 'Onder (lasten boven)' }, { value: 'boven', label: 'Boven' }],
      default: 'onder',
    },
    { key: 'lengteTonen', label: 'Lengte tonen', labelEn: 'Show length', type: 'boolean', default: false },
    { key: 'lengte', label: 'Lengte (mm)', labelEn: 'Length (mm)', type: 'number', default: 6000, min: 1, step: 100 },
  ],
  // Length is real (mm via the measure scale), the band height a paper size.
  realSizeMm(params) {
    return { width: lengteVan(params, 6000), height: null };
  },
  render(params = {}, bbox) {
    const { x0, x1, yA, S } = band(bbox, ST_HB);
    const L = x1 - x0;
    const r = Math.min(ST_R * S, L / 4);
    const cmds = [];
    // A hinge is an open circle ON the node: members meeting in one hinged
    // node share one circle. White inside, so whatever is drawn below (a
    // support apex, another member) stops at the rim.
    const begin = params.begin === 'scharnier';
    const eind = params.eind === 'scharnier';
    const a = begin ? x0 + r : x0;
    const b = eind ? x1 - r : x1;
    if (b > a) cmds.push(lijn(a, yA, b, yA, { lineWidthFactor: LW_STAAF, role: 'staaf' }));
    if (begin) cmds.push(schijf(x0, yA, r, '#ffffff', { role: 'scharnier' }));
    if (eind) cmds.push(schijf(x1, yA, r, '#ffffff', { role: 'scharnier' }));
    const midden = (x0 + x1) / 2;
    const afstand = (3 + T / 2) * S;
    const naamOnder = params.labelZijde !== 'boven';
    const naam = String(params.label ?? '').trim();
    if (naam) {
      cmds.push({ kind: 'text', x: midden, y: yA + (naamOnder ? afstand : -afstand), text: naam, size: T * S, role: 'label' });
    }
    if (params.lengteTonen === true) {
      // Opposite the name (or below when there is none).
      const onder = naam ? !naamOnder : true;
      cmds.push({
        kind: 'text', x: midden, y: yA + (onder ? afstand : -afstand),
        text: staafLengteLabel(params), size: T * S, role: 'lengte',
      });
    }
    return cmds;
  },
  snapPoints: bandSnapPoints(ST_HB),
};

// ── Verdeelde last (distributed load, uniform or linear) ────────────────────

const VL_TIP = 1;                 // gap between the arrow tips and the axis
const VL_H = 14;                  // arrow length at the largest value
const VL_HB = VL_TIP + VL_H + 2.5 + T + 0.5;
const VL_STAP = 9;                // target arrow spacing (local units)
const VL_PIJL_L = 4.5;            // arrowheads of a distributed load: smaller
const VL_PIJL_B = 1.6;

const VL_EENHEDEN = ['kN/m', 'kN/m²', 'N/mm'];

function vlEenheid(params) {
  return VL_EENHEDEN.includes(params?.eenheid) ? params.eenheid : 'kN/m';
}

function vlSymbool(params) {
  return String(params?.symbool ?? 'q').trim() || 'q';
}

/** q1 and q2 (q2 = q1 for a uniform load). */
export function verdeeldeLastWaarden(params = {}) {
  const q1 = getal(params.q1, 5);
  const q2 = params.verloop === 'trapezium' ? getal(params.q2, q1) : q1;
  return { q1, q2 };
}

/**
 * Arrow positions along a loaded stretch of `lengte` page units at local
 * scale S: equal spacing close to VL_STAP·S, arrows at both ends.
 */
export function verdeeldeLastPijlen(lengte, S) {
  if (!(lengte > 0)) return [];
  const stap = VL_STAP * S;
  const vakken = Math.max(1, Math.min(400, Math.round(lengte / stap)));
  const out = [];
  for (let i = 0; i <= vakken; i++) out.push((lengte * i) / vakken);
  return out;
}

function vlIndeling(params, bbox) {
  const { x0, x1, yA, S } = band(bbox, VL_HB);
  // End arrows stay inside the band: inset by the arrowhead half width.
  const inset = Math.min(VL_PIJL_B * S, (x1 - x0) / 4);
  const a = x0 + inset;
  const b = x1 - inset;
  const tipY = yA - VL_TIP * S;
  const { q1, q2 } = verdeeldeLastWaarden(params);
  const qMax = Math.max(Math.abs(q1), Math.abs(q2));
  const h1 = qMax > 0 ? (VL_H * Math.abs(q1)) / qMax : VL_H;
  const h2 = qMax > 0 ? (VL_H * Math.abs(q2)) / qMax : VL_H;
  const labelY = tipY - (VL_H + 2.5 + T / 2) * S;
  return { x0, x1, a, b, yA, S, tipY, q1, q2, h1, h2, labelY };
}

function vlLabels(params, ind) {
  const sym = vlSymbool(params);
  const eh = vlEenheid(params);
  const size = T * ind.S;
  const { q1, q2, a, b, labelY } = ind;
  if (params.labelTonen === false) return [];
  if (params.verloop !== 'trapezium' || q1 === q2) {
    return [{ kind: 'text', x: (a + b) / 2, y: labelY, text: `${sym} = ${nlGetal(q1)} ${eh}`, size, role: 'label', veld: 'q1' }];
  }
  const t1 = `${sym}1 = ${nlGetal(q1)} ${eh}`;
  const t2 = `${sym}2 = ${nlGetal(q2)} ${eh}`;
  const w1 = q1 !== 0 ? tekstBreedte(t1, size) : 0;
  const w2 = q2 !== 0 ? tekstBreedte(t2, size) : 0;
  if (w1 + w2 + 4 * ind.S > b - a) {
    // Too short for two labels: one combined label in the middle.
    return [{
      kind: 'text', x: (a + b) / 2, y: labelY,
      text: `${sym} = ${nlGetal(q1)} – ${nlGetal(q2)} ${eh}`, size, role: 'label', veld: 'q1',
    }];
  }
  const out = [];
  if (w1) out.push({ kind: 'text', x: a + w1 / 2, y: labelY, text: t1, size, role: 'label', veld: 'q1' });
  if (w2) out.push({ kind: 'text', x: b - w2 / 2, y: labelY, text: t2, size, role: 'label', veld: 'q2' });
  return out;
}

export const verdeeldeLastTemplate = {
  id: 'verdeelde-last',
  name: 'q-last (verdeelde belasting)',
  nameEn: 'Distributed load',
  category: 'NL Constructie',
  defaultSize: { width: 240, height: 2 * VL_HB },
  placement: 'two-point',
  params: [
    { key: 'symbool', label: 'Symbool', labelEn: 'Symbol', type: 'string', default: 'q' },
    {
      key: 'verloop', label: 'Verloop', labelEn: 'Distribution', type: 'enum',
      options: [
        { value: 'gelijkmatig', label: 'Gelijkmatig verdeeld' },
        { value: 'trapezium', label: 'Trapezium / driehoek (q1 → q2)' },
      ],
      default: 'gelijkmatig',
    },
    { key: 'q1', label: 'q / q1 (begin)', labelEn: 'q / q1 (start)', type: 'number', default: 5, step: 0.5 },
    { key: 'q2', label: 'q2 (eind, trapezium)', labelEn: 'q2 (end, trapezoid)', type: 'number', default: 5, step: 0.5 },
    {
      key: 'eenheid', label: 'Eenheid', labelEn: 'Unit', type: 'enum',
      options: VL_EENHEDEN.map((value) => ({ value, label: value })), default: 'kN/m',
    },
    { key: 'labelTonen', label: 'Label tonen', labelEn: 'Show label', type: 'boolean', default: true },
    { key: 'lengte', label: 'Lengte (mm)', labelEn: 'Length (mm)', type: 'number', default: 6000, min: 1, step: 100 },
  ],
  realSizeMm(params) {
    return { width: lengteVan(params, 6000), height: null };
  },
  render(params = {}, bbox) {
    const ind = vlIndeling(params, bbox);
    const { a, b, S, tipY, h1, h2 } = ind;
    const L = b - a;
    const cmds = [];
    if (L > 0) {
      cmds.push(lijn(a, tipY - h1 * S, b, tipY - h2 * S, { lineWidthFactor: LW_LAST, role: 'contour' }));
    }
    for (const dx of verdeeldeLastPijlen(L, S)) {
      const t = L > 0 ? dx / L : 0.5;
      const lengte = (h1 + (h2 - h1) * t) * S;
      // Near the zero end of a triangle: no stub arrows with tiny heads.
      if (lengte < VL_PIJL_L * 0.6 * S) continue;
      const kop = Math.min(VL_PIJL_L * S, lengte);
      const x = a + dx;
      if (lengte > kop * 1.01) {
        cmds.push(lijn(x, tipY - lengte, x, tipY - kop * 0.9, { lineWidthFactor: LW_LAST, role: 'pijl' }));
      }
      cmds.push(pijlpunt(x, tipY, 0, 1, kop, (VL_PIJL_B * kop) / VL_PIJL_L));
    }
    cmds.push(...vlLabels(params, ind));
    return cmds;
  },
  editableLabels(params = {}, bbox) {
    return vlLabels(params, vlIndeling(params, bbox))
      .map((c, i) => ({ id: `label${i}`, rect: labelRect(c), fields: [c.veld] }));
  },
  snapPoints: bandSnapPoints(VL_HB),
};

export const SCHEMATISERING_TEMPLATES = [
  staafTemplate, knoopTemplate, opleggingTemplate,
  puntlastTemplate, verdeeldeLastTemplate, momentTemplate,
];
