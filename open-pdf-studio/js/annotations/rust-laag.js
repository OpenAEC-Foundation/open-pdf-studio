// Simple annotations drawn in Rust: what goes over the line.
//
// The first piece of annotation drawing in Rust (crate open-pdf-annot,
// command annot_layer_render): line, box, ellipse, polyline, plain ink and
// highlight, as drawAnnotation in rendering.js draws them in output mode
// (real line widths, no editing state). This module decides per annotation
// whether Rust may draw it and works out colour, opacity, line width and the
// dash pattern, exactly as the JS drawing does. Anything it is not sure
// about gives null, and the JS drawing keeps it.
//
// Not wired into the screen yet: js/annotations/rust-laag-proef.js compares
// the Rust layer with the JS drawing of the same page. See
// docs/rust-stappen.md.

// Pure module: runs under node in rust-laag.test.mjs.

/** The dash patterns of applyBorderStyle (rendering/decorations.js). */
const STREPEN = {
  dashed: [3, 4],
  dotted: [2, 4],
  'dash-dot': [10, 8, 2, 8],
  'dash-dot-dot': [10, 8, 2, 8, 2, 8],
  'long-dash': [20, 10],
  'long-dash-dot': [20, 10, 2, 10],
  'long-dash-dot-dot': [20, 10, 2, 10, 2, 10],
};

/** The smallest line width in output (rendering/lijndikte.js). */
const MIN_LIJNDIKTE_PT = 0.25;

const isGetal = (v) => typeof v === 'number' && Number.isFinite(v);
const isKleur = (c) => !!c && c !== 'none' && c !== 'transparent';
const alfa = (v) => (isGetal(v) ? Math.max(0, Math.min(1, v)) : null);

/** '#rgb' or '#rrggbb' as [r, g, b]; anything else null (Rust does not draw it). */
export function hexKleur(kleur) {
  if (typeof kleur !== 'string') return null;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(kleur.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** The stroke as the JS drawing sets it; null when Rust should not draw this one. */
function lijn(ann, heeftVulling) {
  const rgb = hexKleur(ann.strokeColor || ann.color);
  if (!rgb) return null;
  let breedte = ann.lineWidth ?? 3;
  if (!isGetal(breedte) || breedte < 0) return null;
  if (breedte === 0) {
    // A line width of 0 with a fill keeps whatever width the canvas had.
    if (heeftVulling) return null;
    breedte = 0.5;
  }
  const stijl = ann.borderStyle;
  if (stijl && stijl !== 'solid' && !STREPEN[stijl]) return null;
  return { rgb, alpha: alfa(ann.opacity) ?? 1, width: Math.max(breedte, MIN_LIJNDIKTE_PT), dash: STREPEN[stijl] || [] };
}

/** What every type must have for Rust to draw it. */
function gewoon(ann) {
  if (!ann || ann.hidden || ann._ignoreViewFilters) return false;
  if (ann.blendMode && ann.blendMode !== 'normal') return false;
  if (ann.hatchPattern && ann.hatchPattern !== 'none') return false;
  if (ann.cross || ann.flipX || ann.flipY) return false;
  if (ann.opacity !== undefined && alfa(ann.opacity) === null) return false;
  return true;
}

/** A box or ellipse: fill and outline. */
function vlak(t, ann) {
  const w = t === 'circle' ? (ann.width || ann.radius * 2) : ann.width;
  const h = t === 'circle' ? (ann.height || ann.radius * 2) : ann.height;
  if (![ann.x, ann.y, w, h].every(isGetal) || w === 0 || h === 0) return null;
  if (ann.rotation !== undefined && ann.rotation !== null && !isGetal(ann.rotation)) return null;
  const vorm = { t, x: ann.x, y: ann.y, w, h, rot: ann.rotation || 0 };
  const gevuld = isKleur(ann.fillColor);
  if (gevuld) {
    const rgb = hexKleur(ann.fillColor);
    if (!rgb) return null;
    // The fill's own opacity, otherwise that of the line (vul-dekking.js).
    vorm.fill = { rgb, alpha: alfa(ann.fillOpacity) ?? alfa(ann.opacity) ?? 1 };
  }
  // 'none' on the raw field means no outline; unset falls back to `color`.
  if (ann.strokeColor !== 'none' && ann.strokeColor !== 'transparent') {
    const l = lijn(ann, gevuld);
    if (!l) return null;
    vorm.line = l;
  }
  return vorm.fill || vorm.line ? vorm : null;
}

function punten(lijst) {
  if (!Array.isArray(lijst) || lijst.length < 2) return null;
  const uit = [];
  for (const p of lijst) {
    if (!p || !isGetal(p.x) || !isGetal(p.y)) return null;
    uit.push(p.x, p.y);
  }
  return uit;
}

/**
 * The shape Rust draws for this annotation, or null when the JS drawing
 * keeps it. `isGladdeInkt`: the test for smooth or pressure-sensitive ink
 * (pressure-ink.js), which Rust does not draw.
 */
export function vormVoorRust(ann, { isGladdeInkt = () => false } = {}) {
  if (!gewoon(ann)) return null;
  switch (ann.type) {
    case 'line': {
      if (![ann.startX, ann.startY, ann.endX, ann.endY].every(isGetal)) return null;
      const l = lijn(ann, false);
      return l ? { t: 'line', x1: ann.startX, y1: ann.startY, x2: ann.endX, y2: ann.endY, line: l } : null;
    }
    case 'box':
      return vlak('box', ann);
    case 'circle':
      return vlak('circle', ann);
    case 'polyline': {
      const pts = punten(ann.points);
      const l = pts && lijn(ann, false);
      return l ? { t: 'path', pts, round: false, line: l } : null;
    }
    case 'draw': {
      if (isGladdeInkt(ann)) return null;
      const pts = punten(ann.path);
      const l = pts && lijn(ann, false);
      return l ? { t: 'path', pts, round: true, line: l } : null;
    }
    case 'highlight': {
      if (![ann.x, ann.y, ann.width, ann.height].every(isGetal) || ann.width === 0 || ann.height === 0) return null;
      if (ann.rotation !== undefined && ann.rotation !== null && !isGetal(ann.rotation)) return null;
      const rgb = hexKleur(ann.fillColor || ann.color);
      if (!rgb) return null;
      // A highlight without its own opacity is drawn at 0.3; its fill
      // opacity counts as for the shapes.
      const basis = ann.opacity !== undefined ? alfa(ann.opacity) : 0.3;
      return { t: 'box', x: ann.x, y: ann.y, w: ann.width, h: ann.height, rot: ann.rotation || 0, fill: { rgb, alpha: alfa(ann.fillOpacity) ?? basis } };
    }
    default:
      return null;
  }
}

/**
 * The annotations of one page split into what Rust draws and what stays.
 * @returns {{ shapes: object[], rest: object[] }}
 */
export function verdeelVoorRust(annotaties, pageNum, opties) {
  const shapes = [];
  const rest = [];
  for (const ann of annotaties || []) {
    if (!ann || ann.page !== pageNum) continue;
    const vorm = vormVoorRust(ann, opties);
    if (vorm) shapes.push(vorm); else rest.push(ann);
  }
  return { shapes, rest };
}

/** Answer of annot_layer_render: the number of shapes drawn (u32 LE), then RGBA. */
export function decodeLaag(buffer, width, height) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.byteLength !== 4 + width * height * 4) throw new Error('ANNOT_LAYER_ANSWER');
  const drawn = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
  return { drawn, width, height, rgba: new Uint8ClampedArray(bytes.buffer, bytes.byteOffset + 4, width * height * 4) };
}

/**
 * Draw the shapes in Rust.
 * @param {Function} invoke
 * @param {{width:number,height:number,scale:number,offsetX?:number,offsetY?:number}} view
 */
export async function tekenRustLaag(invoke, view, shapes) {
  const antwoord = await invoke('annot_layer_render', {
    view: { width: view.width, height: view.height, scale: view.scale, offset_x: view.offsetX || 0, offset_y: view.offsetY || 0 },
    shapes,
  });
  return decodeLaag(antwoord, view.width, view.height);
}
