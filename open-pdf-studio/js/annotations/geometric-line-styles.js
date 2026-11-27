// Geometrische lijnpatronen (#1223). Eén pad in app-punten voor Canvas en
// PDF; geen fonts of bitmaptegels. De hartlijn blijft apart bewerkbaar.
import { flattenPath, hasCurves } from './curve-path.js';

export const GEOMETRIC_LINE_STYLES = Object.freeze([
  'fence-circle', 'fence-square', 'gas', 'hot-water', 'zigzag',
  'insulation', 'double', 'tracks', 'road',
]);
export const isGeometricLineStyle = style => GEOMETRIC_LINE_STYLES.includes(style);
export const supportsGeometricLineStyle = type => type === 'line' || type === 'polyline';
export const canApplyLineStyle = (type, style) => !isGeometricLineStyle(style) || supportsGeometricLineStyle(type);

// Kleine vectorletters: dezelfde GAS/HW-markering zonder afhankelijkheid
// van geïnstalleerde fonts of fontresources in het opgeslagen PDF-bestand.
const GLYPHS = {
  G: [[[4, 1], [3, 0], [1, 0], [0, 1], [0, 5], [1, 6], [4, 6], [4, 3], [2, 3]]],
  A: [[[0, 6], [2, 0], [4, 6]], [[1, 3], [3, 3]]],
  S: [[[4, 0], [0, 0], [0, 3], [4, 3], [4, 6], [0, 6]]],
  H: [[[0, 0], [0, 6]], [[4, 0], [4, 6]], [[0, 3], [4, 3]]],
  W: [[[0, 0], [1, 6], [2, 3], [3, 6], [4, 0]]],
};

/** Null betekent: gewoon lijnpatroon. [] betekent: geen geldig pad. */
export function geometricLinePaths(annotation, lineWidth = annotation.lineWidth ?? 1) {
  if (!supportsGeometricLineStyle(annotation.type) || !isGeometricLineStyle(annotation.borderStyle)) return null;
  let points = annotation.type === 'line'
    ? [{ x: annotation.startX, y: annotation.startY }, { x: annotation.endX, y: annotation.endY }]
    : annotation.points;
  if (!Array.isArray(points) || points.length < 2 || points.length > 10000
    || points.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return [];
  if (annotation.type === 'polyline' && hasCurves(annotation.curves)) {
    points = flattenPath(points, annotation.curves, { tolerance: 0.1 });
  }
  const segments = [];
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], d = Math.hypot(b.x - a.x, b.y - a.y);
    if (!Number.isFinite(d)) return [];
    if (d < 1e-7) continue;
    segments.push({ a, start: length, end: length + d, ux: (b.x - a.x) / d, uy: (b.y - a.y) / d });
    length += d;
  }
  if (!segments.length || !Number.isFinite(length)) return [];
  // Minimaal één punt als patroon-eenheid; een dunne pen behoudt leesbare
  // symbolen. Bij extreme paden begrenzen we het aantal herhalingen.
  const u = Math.max(1, Number.isFinite(lineWidth) ? Math.abs(lineWidth) : 1);
  const step = Math.max(24 * u, length / 1000);
  const half = 4 * u;
  const locate = distance => {
    const d = Math.max(0, Math.min(length, distance));
    let lo = 0, hi = segments.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (segments[m].end < d) lo = m + 1; else hi = m; }
    return { segment: segments[lo], distance: d };
  };
  const at = (d, offset = 0) => {
    const { segment: s, distance } = locate(d);
    return { x: s.a.x + (distance - s.start) * s.ux - offset * s.uy,
      y: s.a.y + (distance - s.start) * s.uy + offset * s.ux };
  };
  const paths = [];
  const add = p => { if (p.length > 1) paths.push(p); };
  // Bevelled joins: include both normals at a corner instead of a long
  // miter spike. Also retain corners when a dash spans multiple segments.
  const along = (from, to, offset = 0) => {
    const p = [at(from, offset)];
    for (const s of segments) {
      if (s.end > from && s.end < to) p.push(at(s.end, offset));
      if (s.start > from && s.start < to) p.push({ x: s.a.x - offset * s.uy, y: s.a.y + offset * s.ux });
    }
    p.push(at(to, offset)); add(p);
  };
  const style = annotation.borderStyle;
  if (['double', 'tracks', 'road'].includes(style)) {
    along(0, length, -half); along(0, length, half);
    if (style === 'tracks') {
      for (let d = step / 2; d < length; d += step) add([at(d, -half * 1.5), at(d, half * 1.5)]);
    } else if (style === 'road') {
      for (let d = 0; d < length; d += step) along(d, Math.min(length, d + step * 0.6));
    }
  } else if (style === 'insulation') {
    // Eén doorlopende isolatielus: brede afgeronde lobben wisselen van kant,
    // met teruglopende verbindingsbogen (geen losse, afgeschuinde ellipsen).
    // De referentie in #1284 heeft een steek van 0,4 maal de strookbreedte.
    const usable = length - 2 * half;
    if (usable <= 0) {
      along(0, length);
    } else {
      const turns = Math.min(1000, Math.max(1, Math.floor(usable / (3.2 * u) + 1e-9)));
      const pitch = usable / turns;
      const p = [];
      for (let j = 0; j <= turns * 64; j++) {
        const phase = (j % 64) * 2 * Math.PI / 64;
        const d = half + j * pitch / 64 + 1.2 * u * Math.sin(2 * phase);
        p.push(at(d, -half * Math.cos(phase)));
      }
      add(p);
    }
  } else if (style === 'zigzag') {
    const periods = Math.max(1, Math.ceil(length / (step / 2)));
    const pitch = length / periods, p = [];
    for (let i = 0; i < periods; i++) {
      for (let j = 0; j < 4; j++) p.push(at((i + j / 4) * pitch, [0, -half, 0, half][j]));
    }
    p.push(at(length)); add(p);
  } else {
    const text = style === 'gas' ? 'GAS' : style === 'hot-water' ? 'HW' : null;
    const symbolWidth = text ? (text.length * 6 - 2) * u : half * 2;
    const gap = symbolWidth / 2 + 2 * u;
    const spacing = Math.max(step, symbolWidth + 16 * u);
    let previous = 0;
    for (let d = spacing / 2; d + gap <= length; d += spacing) {
      along(previous, d - gap);
      if (text) {
        // A rigid marker on the local tangent stays legible at bends.
        const { segment: s } = locate(d), centre = at(d);
        const mark = (x, y) => ({ x: centre.x + x * s.ux - y * s.uy, y: centre.y + x * s.uy + y * s.ux });
        [...text].forEach((char, k) => GLYPHS[char].forEach(glyph => add(glyph.map(([x, y]) =>
          mark((k * 6 + x) * u - symbolWidth / 2, (y - 3) * u)))));
      } else {
        const n = style === 'fence-circle' ? 32 : 4;
        const { segment: s } = locate(d), centre = at(d);
        const p = [];
        for (let j = 0; j <= n; j++) {
          const angle = 2 * Math.PI * j / n + (n === 4 ? Math.PI / 4 : 0);
          const r = n === 4 ? half * Math.SQRT2 : half;
          const x = r * Math.cos(angle), y = r * Math.sin(angle);
          p.push({ x: centre.x + x * s.ux - y * s.uy, y: centre.y + x * s.uy + y * s.ux });
        }
        add(p);
      }
      previous = d + gap;
    }
    along(previous, length);
  }
  return paths;
}

export function geometricPathsBounds(paths, lineWidth = 1) {
  if (!paths?.length) return null;
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
  for (const path of paths) for (const p of path) {
    x = Math.min(x, p.x); y = Math.min(y, p.y); right = Math.max(right, p.x); bottom = Math.max(bottom, p.y);
  }
  const pad = Math.max(0.5, Math.abs(lineWidth)) / 2;
  return { x: x - pad, y: y - pad, width: right - x + 2 * pad, height: bottom - y + 2 * pad };
}

export function drawGeometricLine(ctx, annotation) {
  // Thin-lines view affects only the pen, never symbol size or spacing.
  const paths = geometricLinePaths(annotation);
  if (paths === null) return false;
  ctx.save(); ctx.setLineDash([]); ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const path of paths) path.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  ctx.stroke(); ctx.restore();
  return true;
}
