// Vector appearance-stream (/AP /N) builders for annotation types that OPDS
// previously wrote WITHOUT an appearance stream. Those types render correctly
// inside OPDS (own overlay canvas) but were INVISIBLE — or showed only a bare
// outline — in third-party PDF viewers, which rely on /AP. See issue #256.
//
// Every builder returns absolute-PDF-coordinate content-stream operators. The
// caller (saver.js) wraps them in a Form XObject with:
//     BBox   = the annotation /Rect  [x1,y1,x2,y2]
//     Matrix = [1,0,0,1,-x1,-y1]
// exactly like the existing FreeText /AP path, and adds a Helvetica font
// resource when `needsFont` is true.
//
// The module is PURE (no state/canvas/DOM). Geometry that depends on app state
// (wall band polygon, measurement scale) is resolved by the caller and passed
// in as plain points, so this module stays headless-testable.

import { hexToRgb } from './utils.js';
import { getHatchLineFamilies } from './hatch-catalog.js';
import { catmullRomToBezier, splineArrowEndTangent } from '../../annotations/spline-arrow-geometry.js';
import {
  rotToWorld as srRotToWorld,
  SYSTEEM_RAVEEL_OFFSET_MM as srRaveelOffsetMm,
  SYSTEEM_RAVEEL_STREEP_MM as srRaveelStreepMm,
} from '../../annotations/systeemraster.js';

// ── number / string formatting ──────────────────────────────────────────────
const f = (n) => {
  if (!isFinite(n)) return '0';
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};
const escapePdfText = (s) =>
  String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[\r\n]+/g, ' ');

// Dash arrays mirror rendering/decorations.js applyBorderStyle (screen px ==
// PDF pt at scale 1). Solid → null (no dash operator).
function dashArrayForStyle(borderStyle) {
  switch (borderStyle) {
    case 'dashed':            return [3, 4];
    case 'dotted':            return [2, 4];
    case 'dash-dot':          return [10, 8, 2, 8];
    case 'dash-dot-dot':      return [10, 8, 2, 8, 2, 8];
    case 'long-dash':         return [20, 10];
    case 'long-dash-dot':     return [20, 10, 2, 10];
    case 'long-dash-dot-dot': return [20, 10, 2, 10, 2, 10];
    default:                  return null;
  }
}
function dashOp(borderStyle) {
  const d = dashArrayForStyle(borderStyle);
  return d ? `[${d.join(' ')}] 0 d\n` : '[] 0 d\n';
}

// Emit an app-space point list as a PDF path (m/l), converting each point to
// PDF coordinates via X()/Y(). Optionally close.
function pathOps(pts, X, Y, close) {
  if (!pts || pts.length === 0) return '';
  let s = `${f(X(pts[0].x))} ${f(Y(pts[0].y))} m\n`;
  for (let i = 1; i < pts.length; i++) s += `${f(X(pts[i].x))} ${f(Y(pts[i].y))} l\n`;
  if (close) s += 'h\n';
  return s;
}

// ── hatch ───────────────────────────────────────────────────────────────────
// Reproduces rendering/hatch-patterns.js drawLineFamily + renderPattern, but
// emits PDF operators. Works in APP space (matches canvas), converting every
// endpoint to PDF coords via X()/Y(). The polygon clip path must already be set
// by the caller (W n) before these ops run.
function hatchFamilyOps(fam, bounds, scale, rot, center, colorRgb) {
  const angleRad = (fam.angle * Math.PI) / 180;
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);
  const spacing = (fam.deltaY || 10) * scale;
  if (spacing <= 0.01) return '';
  const deltaX = (fam.deltaX || 0) * scale;
  const originX = (fam.originX || 0) * scale;
  const originY = (fam.originY || 0) * scale;

  const { left, top, right, bottom } = bounds;
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const diagonal = Math.hypot(right - left, bottom - top);
  const halfDiag = diagonal / 2 + spacing * 2;
  const numLines = Math.ceil((halfDiag * 2) / spacing) + 2;

  // Rotate an app-space point around the polygon center by `rot` degrees.
  const rotRad = (rot || 0) * Math.PI / 180;
  const cr = Math.cos(rotRad), sr = Math.sin(rotRad);
  const rotate = (x, y) => {
    if (!rot) return [x, y];
    const dx = x - center.cx, dy = y - center.cy;
    return [center.cx + dx * cr - dy * sr, center.cy + dx * sr + dy * cr];
  };

  const lw = fam.strokeWidth != null ? fam.strokeWidth : 0.4;

  // Dot family (dashPattern contains 0) → grid of filled dots.
  if (fam.dashPattern && fam.dashPattern.includes(0)) {
    const dotR = Math.max(0.5, 1 * scale);
    const dotSpacing = deltaX || spacing;
    const dotsPerLine = Math.ceil((halfDiag * 2) / dotSpacing) + 2;
    let s = `${f(colorRgb[0])} ${f(colorRgb[1])} ${f(colorRgb[2])} rg\n`;
    const k = 0.5522847498;
    for (let i = -numLines; i <= numLines; i++) {
      const perp = i * spacing;
      const baseX = cx + perp * (-sinA);
      const baseY = cy + perp * cosA;
      for (let j = -dotsPerLine; j <= dotsPerLine; j++) {
        const along = j * dotSpacing;
        let dx = baseX + originX + along * cosA;
        let dy = baseY + originY + along * sinA;
        [dx, dy] = rotate(dx, dy);
        // bezier circle radius dotR centered at (dx,dy) in APP space; convert.
        s += `${f(gX(dx))} ${f(gY(dy + dotR))} m\n`;
        s += `${f(gX(dx + k * dotR))} ${f(gY(dy + dotR))} ${f(gX(dx + dotR))} ${f(gY(dy + k * dotR))} ${f(gX(dx + dotR))} ${f(gY(dy))} c\n`;
        s += `${f(gX(dx + dotR))} ${f(gY(dy - k * dotR))} ${f(gX(dx + k * dotR))} ${f(gY(dy - dotR))} ${f(gX(dx))} ${f(gY(dy - dotR))} c\n`;
        s += `${f(gX(dx - k * dotR))} ${f(gY(dy - dotR))} ${f(gX(dx - dotR))} ${f(gY(dy - k * dotR))} ${f(gX(dx - dotR))} ${f(gY(dy))} c\n`;
        s += `${f(gX(dx - dotR))} ${f(gY(dy + k * dotR))} ${f(gX(dx - k * dotR))} ${f(gY(dy + dotR))} ${f(gX(dx))} ${f(gY(dy + dotR))} c\n`;
        s += 'f\n';
      }
    }
    return s;
  }

  const dash = (fam.dashPattern && fam.dashPattern.length > 0)
    ? `[${fam.dashPattern.map(d => f(Math.abs(d) * scale)).join(' ')}] 0 d\n`
    : '[] 0 d\n';

  let s = `${f(colorRgb[0])} ${f(colorRgb[1])} ${f(colorRgb[2])} RG\n${f(lw)} w\n${dash}`;
  for (let i = -numLines; i <= numLines; i++) {
    const perp = i * spacing;
    const stagger = deltaX !== 0 ? i * deltaX : 0;
    const baseX = cx + perp * (-sinA);
    const baseY = cy + perp * cosA;
    const ox = baseX + originX + stagger * cosA;
    const oy = baseY + originY + stagger * sinA;
    let x1 = ox - halfDiag * cosA, y1 = oy - halfDiag * sinA;
    let x2 = ox + halfDiag * cosA, y2 = oy + halfDiag * sinA;
    [x1, y1] = rotate(x1, y1);
    [x2, y2] = rotate(x2, y2);
    s += `${f(gX(x1))} ${f(gY(y1))} m ${f(gX(x2))} ${f(gY(y2))} l S\n`;
  }
  return s;
}

// Module-scoped mappers set per-call (keeps hatchFamilyOps signature small).
let gX = (x) => x, gY = (y) => y;

// Build the full hatch fill (clip to polygon+holes, then all line families).
// `points`/`holes` are app-space. Returns ops (already includes q/Q).
function hatchFillOps({ points, holes, hatchPattern, hatchColorRgb, hatchScale, hatchAngle, X, Y }) {
  const families = getHatchLineFamilies(hatchPattern);
  if (families === null) return '';
  gX = X; gY = Y;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
  }
  const bw = maxX - minX, bh = maxY - minY;
  const pad = Math.max(Math.hypot(bw, bh), bw, bh) * 0.6;
  const bounds = { left: minX - pad, top: minY - pad, right: maxX + pad, bottom: maxY + pad };
  const scale = (hatchScale != null ? hatchScale : 100) / 100;
  const center = { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };

  let s = 'q\n';
  // Clip path: outer + holes, even-odd.
  s += pathOps(points, X, Y, true);
  if (holes && holes.length) for (const h of holes) if (h && h.length >= 3) s += pathOps(h, X, Y, true);
  s += 'W* n\n';

  if (!families.length) {
    // Solid fill using hatch color.
    s += `${f(hatchColorRgb[0])} ${f(hatchColorRgb[1])} ${f(hatchColorRgb[2])} rg\n`;
    s += pathOps(points, X, Y, true);
    if (holes && holes.length) for (const h of holes) if (h && h.length >= 3) s += pathOps(h, X, Y, true);
    s += 'f*\n';
  } else {
    for (const fam of families) s += hatchFamilyOps(fam, bounds, scale, hatchAngle || 0, center, hatchColorRgb);
  }
  s += 'Q\n';
  return s;
}

// Solid fill of a polygon (+holes) using even-odd, app-space points.
function solidFillOps(points, holes, fillRgb, X, Y) {
  let s = `${f(fillRgb[0])} ${f(fillRgb[1])} ${f(fillRgb[2])} rg\n`;
  s += pathOps(points, X, Y, true);
  if (holes && holes.length) for (const h of holes) if (h && h.length >= 3) s += pathOps(h, X, Y, true);
  s += 'f*\n';
  return s;
}

// Stroke a polygon outline (+holes), app-space points.
function strokeOutlineOps(points, holes, strokeRgb, lineWidth, borderStyle, X, Y) {
  let s = `${f(strokeRgb[0])} ${f(strokeRgb[1])} ${f(strokeRgb[2])} RG\n${f(lineWidth)} w\n${dashOp(borderStyle)}`;
  s += pathOps(points, X, Y, true) + 'S\n';
  if (holes && holes.length) for (const h of holes) if (h && h.length >= 3) s += pathOps(h, X, Y, true) + 'S\n';
  return s;
}

// White-backed centered text label (Helvetica). `x,y` app-space anchor.
// Mirrors the on-screen measurement label look (white plate + coloured text).
function labelOps({ text, x, y, fontSize, colorRgb, X, Y }) {
  if (!text) return '';
  const fs = fontSize || 11;
  const px = X(x), py = Y(y);
  const tw = escapePdfText(text).length * fs * 0.5; // Helvetica avg width estimate
  const padX = 2, padY = 2;
  const bx = px - tw / 2 - padX;
  const by = py - fs / 2 - padY;
  let s = 'q\n1 1 1 rg\n';
  s += `${f(bx)} ${f(by)} ${f(tw + padX * 2)} ${f(fs + padY * 2)} re f\n`;
  s += `${f(colorRgb[0])} ${f(colorRgb[1])} ${f(colorRgb[2])} rg\n`;
  s += 'BT\n';
  s += `/Helv ${f(fs)} Tf\n`;
  s += `${f(px - tw / 2)} ${f(py - fs / 2 + fs * 0.25)} Td\n`;
  s += `(${escapePdfText(text)}) Tj\n`;
  s += 'ET\nQ\n';
  return s;
}

// ── cloud outline sampling ──────────────────────────────────────────────────
// Sample an arc (canvas ctx.arc semantics, anticlockwise=false) into points.
function sampleArc(cx, cy, r, a0, a1, out, steps = 8) {
  let end = a1;
  if (end < a0) end += Math.PI * 2; // false = increasing angle
  for (let i = 1; i <= steps; i++) {
    const a = a0 + (end - a0) * (i / steps);
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
}

// Rectangular cloud outline (mirrors shapes.js buildCloudPath).
export function cloudRectOutlinePts(x, y, w, h, puff = 15) {
  const W = Math.max(1, w), H = Math.max(1, h);
  const THETA = 252 * Math.PI / 180;
  const perim = [];
  const addEdge = (x0, y0, x1, y1) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(2, Math.round(len / puff));
    for (let i = 0; i < n; i++) perim.push([x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]);
  };
  addEdge(x, y, x + W, y);
  addEdge(x + W, y, x + W, y + H);
  addEdge(x + W, y + H, x, y + H);
  addEdge(x, y + H, x, y);
  const sinHalf = Math.sin(THETA / 2), cosHalf = Math.cos(THETA / 2);
  const out = [];
  for (let i = 0; i < perim.length; i++) {
    const [x0, y0] = perim[i];
    const [x1, y1] = perim[(i + 1) % perim.length];
    const dx = x1 - x0, dy = y1 - y0, c = Math.hypot(dx, dy);
    if (c < 0.01) continue;
    const r = c / (2 * sinHalf);
    const nx = dy / c, ny = -dx / c;
    const ccx = (x0 + x1) / 2 + nx * r * cosHalf;
    const ccy = (y0 + y1) / 2 + ny * r * cosHalf;
    const a0 = Math.atan2(y0 - ccy, x0 - ccx);
    const a1 = Math.atan2(y1 - ccy, x1 - ccx);
    if (out.length === 0) out.push({ x: x0, y: y0 });
    sampleArc(ccx, ccy, r, a0, a1, out);
  }
  return out;
}

// Cloud outline along arbitrary points (mirrors shapes.js buildCloudPolylinePath).
export function cloudPolyOutlinePts(points, closed = true) {
  if (!points || points.length < 2) return [];
  const TARGET_BUMP = 12;
  const out = [];
  const len = closed ? points.length : points.length - 1;
  for (let i = 0; i < len; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const edgeLen = Math.hypot(dx, dy);
    if (edgeLen < 1) continue;
    const numBumps = Math.max(1, Math.round(edgeLen / (TARGET_BUMP * 1.5)));
    const bumpRadius = edgeLen / numBumps / 2;
    const angle = Math.atan2(dy, dx);
    for (let j = 0; j < numBumps; j++) {
      const t = (j + 0.5) / numBumps;
      const ccx = p1.x + dx * t, ccy = p1.y + dy * t;
      sampleArc(ccx, ccy, bumpRadius, angle + Math.PI, angle, out);
    }
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// Public builders — each returns { content, needsFont }.
// ════════════════════════════════════════════════════════════════════════════

// filledArea: optional solid fill + optional hatch + outline.
export function buildFilledAreaAP({ points, holes, X, Y, fillColorHex, strokeColorHex,
  lineWidth, borderStyle, hatchPattern, hatchColorHex, hatchScale, hatchAngle }) {
  if (!points || points.length < 3) return null;
  const stroke = hexToRgb(strokeColorHex || '#000000');
  let s = '';
  if (fillColorHex && fillColorHex !== 'none' && fillColorHex !== 'transparent') {
    s += solidFillOps(points, holes, hexToRgb(fillColorHex), X, Y);
  }
  if (hatchPattern && hatchPattern !== 'none') {
    s += hatchFillOps({ points, holes, hatchPattern,
      hatchColorRgb: hexToRgb(hatchColorHex || strokeColorHex || '#000000'),
      hatchScale, hatchAngle, X, Y });
  }
  s += strokeOutlineOps(points, holes, stroke, lineWidth ?? 1, borderStyle, X, Y);
  return { content: s, needsFont: false };
}

// measureArea: fill + optional hatch + outline + centroid label.
export function buildMeasureAreaAP({ points, holes, X, Y, fillColorHex, strokeColorHex,
  lineWidth, borderStyle, hatchPattern, hatchColorHex, hatchScale, hatchAngle,
  text, labelX, labelY }) {
  if (!points || points.length < 3) return null;
  const stroke = hexToRgb(strokeColorHex || '#ff0000');
  let s = '';
  if (fillColorHex && fillColorHex !== 'none' && fillColorHex !== 'transparent') {
    s += solidFillOps(points, holes, hexToRgb(fillColorHex), X, Y);
  }
  if (hatchPattern && hatchPattern !== 'none') {
    s += hatchFillOps({ points, holes, hatchPattern,
      hatchColorRgb: hexToRgb(hatchColorHex || strokeColorHex || '#ff0000'),
      hatchScale, hatchAngle, X, Y });
  }
  s += strokeOutlineOps(points, holes, stroke, lineWidth ?? 1, borderStyle, X, Y);
  let cx = 0, cy = 0;
  for (const p of points) { cx += p.x; cy += p.y; }
  cx /= points.length; cy /= points.length;
  s += labelOps({ text, x: labelX != null ? labelX : cx, y: labelY != null ? labelY : cy,
    fontSize: 11, colorRgb: stroke, X, Y });
  return { content: s, needsFont: true };
}

// measurePerimeter / measureAngle: open polyline + label at centroid.
export function buildPolylineMeasureAP({ points, X, Y, strokeColorHex, lineWidth, borderStyle,
  text, labelX, labelY }) {
  if (!points || points.length < 2) return null;
  const stroke = hexToRgb(strokeColorHex || '#ff0000');
  let s = `${f(stroke[0])} ${f(stroke[1])} ${f(stroke[2])} RG\n${f(lineWidth ?? 1)} w\n${dashOp(borderStyle)}`;
  s += pathOps(points, X, Y, false) + 'S\n';
  let cx = 0, cy = 0;
  for (const p of points) { cx += p.x; cy += p.y; }
  cx /= points.length; cy /= points.length;
  if (text) s += labelOps({ text, x: labelX != null ? labelX : cx, y: labelY != null ? labelY : cy,
    fontSize: 11, colorRgb: stroke, X, Y });
  return { content: s, needsFont: !!text };
}

// measureDistance: dimension line + extension lines + label at line midpoint.
export function buildMeasureDistanceAP({ startX, startY, endX, endY,
  leaderStartX, leaderStartY, leaderEndX, leaderEndY,
  X, Y, strokeColorHex, lineWidth, borderStyle, text, textOffsetX, textOffsetY }) {
  const stroke = hexToRgb(strokeColorHex || '#ff0000');
  const lw = lineWidth ?? 1;
  let s = `${f(stroke[0])} ${f(stroke[1])} ${f(stroke[2])} RG\n${f(lw)} w\n${dashOp(borderStyle)}`;
  // Extension lines from base object to dimension line, if present.
  if (leaderStartX != null) {
    s += `${f(X(leaderStartX))} ${f(Y(leaderStartY))} m ${f(X(startX))} ${f(Y(startY))} l S\n`;
    s += `${f(X(leaderEndX))} ${f(Y(leaderEndY))} m ${f(X(endX))} ${f(Y(endY))} l S\n`;
  }
  // Dimension line.
  s += `${f(X(startX))} ${f(Y(startY))} m ${f(X(endX))} ${f(Y(endY))} l S\n`;
  const midX = (startX + endX) / 2 + (textOffsetX || 0);
  const midY = (startY + endY) / 2 + (textOffsetY || 0);
  if (text) s += labelOps({ text, x: midX, y: midY, fontSize: 11, colorRgb: stroke, X, Y });
  return { content: s, needsFont: !!text };
}

// wall: fill band (bg colour) + optional material hatch + outline. `bandPoints`
// is the mitred band polygon (app-space) computed by the caller.
export function buildWallAP({ bandPoints, X, Y, strokeColorHex, lineWidth,
  fillBgHex, hatchPattern, hatchColorHex, hatchScale, hatchAngle }) {
  if (!bandPoints || bandPoints.length < 3) return null;
  const stroke = hexToRgb(strokeColorHex || '#000000');
  let s = '';
  if (fillBgHex && fillBgHex !== 'none' && fillBgHex !== 'transparent') {
    s += solidFillOps(bandPoints, null, hexToRgb(fillBgHex), X, Y);
  }
  if (hatchPattern && hatchPattern !== 'none') {
    s += hatchFillOps({ points: bandPoints, holes: null, hatchPattern,
      hatchColorRgb: hexToRgb(hatchColorHex || strokeColorHex || '#000000'),
      hatchScale, hatchAngle, X, Y });
  }
  s += strokeOutlineOps(bandPoints, null, stroke, lineWidth ?? 1, 'solid', X, Y);
  return { content: s, needsFont: false };
}

// betonbalk: twee randpolylijnen (verstek-joins al in de geometrie verwerkt),
// eindkappen op vrije uiteinden en een dunne hartlijn. `geom` komt uit
// buildBetonbalk() (annotations/betonbalk.js) — dezelfde bron als het canvas,
// inclusief de inter-balk-trims van het moment van opslaan. Dash-patronen
// volgen geom.styles (lijnstijl 'doorgetrokken'/'gestippeld').
export function buildBetonbalkAP({ geom, X, Y, strokeColorHex, lineWidth }) {
  if (!geom || !geom.edges || !geom.edges.left || geom.edges.left.length < 2) return null;
  const stroke = hexToRgb(strokeColorHex || '#000000');
  const lw = lineWidth ?? 1;
  const edgeDash = geom.styles && geom.styles.edgeDash;
  const centerDash = geom.styles && geom.styles.centerDash;
  let s = `${f(stroke[0])} ${f(stroke[1])} ${f(stroke[2])} RG\n${f(lw)} w\n0 J 0 j\n`;
  s += edgeDash ? `[${edgeDash.map(f).join(' ')}] 0 d\n` : '[] 0 d\n';
  // Randen als RUNS (open T-aansluitingen zijn er al uitgeknipt).
  if (geom.edgeRuns) {
    for (const side of ['left', 'right']) {
      for (const r of geom.edgeRuns[side]) {
        s += `${f(X(r.x1))} ${f(Y(r.y1))} m ${f(X(r.x2))} ${f(Y(r.y2))} l S\n`;
      }
    }
  } else {
    s += pathOps(geom.edges.left, X, Y, false) + 'S\n';
    s += pathOps(geom.edges.right, X, Y, false) + 'S\n';
  }
  for (const c of geom.caps || []) {
    s += `${f(X(c.x1))} ${f(Y(c.y1))} m ${f(X(c.x2))} ${f(Y(c.y2))} l S\n`;
  }
  // Hartlijn (optioneel, toonHartlijn): dun — zelfde factor als het canvas
  // (betonbalk-draw.js). Bij een T-join is geom.center al ingekort tot de
  // nabije doelrand.
  if (geom.params && geom.params.toonHartlijn !== false) {
    s += `${f(Math.max(0.3, lw * 0.5))} w\n`;
    s += centerDash ? `[${centerDash.map(f).join(' ')}] 0 d\n` : '[] 0 d\n';
    s += pathOps(geom.center, X, Y, false) + 'S\n';
  }

  // Tag: gecentreerd boven de hartlijn, meegeroteerd met de balkrichting.
  // App-hoek is y-omlaag; PDF y-omhoog → hoek spiegelen.
  let needsFont = false;
  if (geom.tag) {
    const t = geom.tag;
    const phi = -t.angle;
    const c = Math.cos(phi), sn = Math.sin(phi);
    const cx = X(t.x), cy = Y(t.y);
    const bx = cx - (t.width / 2) * c;
    const by = cy - (t.width / 2) * sn;
    s += `BT\n/Helv ${f(t.fontSize)} Tf\n${f(stroke[0])} ${f(stroke[1])} ${f(stroke[2])} rg\n`;
    s += `${f(c)} ${f(sn)} ${f(-sn)} ${f(c)} ${f(bx)} ${f(by)} Tm\n`;
    s += `(${escapePdfText(t.text)}) Tj\nET\n`;
    needsFont = true;
  }
  return { content: s, needsFont };
}

// systeemraster: gesloten contour + rasterlijnen (al geclipt op de contour)
// en de plaatmaat-tag. `geom` komt uit buildSysteemraster()
// (annotations/systeemraster.js) — dezelfde bron als het canvas
// (systeemraster-draw.js), dus scherm en PDF zijn per definitie gelijk.
// Systeemraster-contourpad met echte bogen: kwadratische Béziers (controle-
// punt loodrecht op de koorde, offset = bulge × koorde — zie arcControl in
// annotations/systeemraster.js) omgezet naar kubische (c-operator) met
// c1 = a + 2/3·(cp−a), c2 = b + 2/3·(cp−b). Zelfde beeld als het canvas.
function systeemrasterContourOps(nodes, X, Y) {
  const n = nodes.length;
  let s = `${f(X(nodes[0].x))} ${f(Y(nodes[0].y))} m\n`;
  for (let i = 0; i < n; i++) {
    const a = nodes[i], b = nodes[(i + 1) % n];
    if (b.arc === true) {
      const bulge = typeof b.bulge === 'number' ? b.bulge : 0.3;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 1;
      const cpx = (a.x + b.x) / 2 + (-dy / dist) * bulge * dist;
      const cpy = (a.y + b.y) / 2 + (dx / dist) * bulge * dist;
      const c1x = a.x + (2 / 3) * (cpx - a.x), c1y = a.y + (2 / 3) * (cpy - a.y);
      const c2x = b.x + (2 / 3) * (cpx - b.x), c2y = b.y + (2 / 3) * (cpy - b.y);
      s += `${f(X(c1x))} ${f(Y(c1y))} ${f(X(c2x))} ${f(Y(c2y))} ${f(X(b.x))} ${f(Y(b.y))} c\n`;
    } else {
      s += `${f(X(b.x))} ${f(Y(b.y))} l\n`;
    }
  }
  s += 'h\n';
  return s;
}

export function buildSysteemrasterAP({ geom, X, Y, strokeColorHex, lineWidth }) {
  if (!geom || !geom.contour || geom.contour.length < 3) return null;
  const stroke = hexToRgb(strokeColorHex || '#000000');
  const lw = lineWidth ?? 1;
  const nodes = geom.nodes || geom.contour;
  // Rasterhoek: lijnen/panelen zijn rasterruimte-coördinaten; per punt naar
  // de wereld draaien vóór de X()/Y()-conversie (zelfde beeld als canvas).
  const W = (x, y) => srRotToWorld(geom.rot || null, { x, y });
  const ln = (x1, y1, x2, y2) => {
    const a = W(x1, y1), b = W(x2, y2);
    return `${f(X(a.x))} ${f(Y(a.y))} m ${f(X(b.x))} ${f(Y(b.y))} l S\n`;
  };
  let s = `${f(stroke[0])} ${f(stroke[1])} ${f(stroke[2])} RG\n${f(lw)} w\n0 J 0 j\n[] 0 d\n`;
  // Contour (gesloten, met echte bogen).
  s += systeemrasterContourOps(nodes, X, Y) + 'S\n';
  // Rasterlijnen: verticaal (x, y-interval) en horizontaal (x-interval, y)
  // in rasterruimte — per eindpunt naar de wereld gedraaid.
  for (const l of geom.linesV || []) {
    for (const seg of l.segs) {
      s += ln(l.x, seg.a, l.x, seg.b);
    }
  }
  for (const l of geom.linesH || []) {
    for (const seg of l.segs) {
      s += ln(seg.a, l.y, seg.b, l.y);
    }
  }
  // Pas-markeringen (strook-layout): dunne extra lijn aan de paszijde.
  if ((geom.pasLijnen || []).length > 0) {
    s += `${f(Math.max(lw * 0.5, 0.35))} w\n`;
    for (const pl of geom.pasLijnen) {
      for (const seg of pl.segs) {
        s += ln(pl.x, seg.a, pl.x, seg.b);
      }
    }
    s += `${f(lw)} w\n`;
  }
  // Sparing-rechthoek (rasterruimte) als PDF-pad via de W()-transform.
  const sparingRectOps = (sp) => {
    const c1 = W(sp.x, sp.y), c2 = W(sp.x + sp.w, sp.y);
    const c3 = W(sp.x + sp.w, sp.y + sp.h), c4 = W(sp.x, sp.y + sp.h);
    return `${f(X(c1.x))} ${f(Y(c1.y))} m ${f(X(c2.x))} ${f(Y(c2.y))} l `
      + `${f(X(c3.x))} ${f(Y(c3.y))} l ${f(X(c4.x))} ${f(Y(c4.y))} l h\n`;
  };
  // Paneel-overrides — render-STIJL uit het paneeltype-assortiment
  // (ventilatie = diagonaal kruis, licht = 45°-arcering) én COMPONENT-in-
  // cel. Componenten tekenen als herkenbare placeholder (vierkant +
  // diagonalen + naamlabel): de bibliotheeksymbolen zijn PNG-/SVG-beelden
  // zonder vector-AP-bouwer — gedocumenteerde terugval, zelfde beeld als
  // het canvas vóór het symboolbeeld geladen is. Alles geclipt op de
  // contour zodat randpanelen netjes afgesneden worden.
  let needsFont = false;
  const decorated = (geom.panels || []).filter(p => p.stijl !== 'tegel' || p.component);
  if (decorated.length > 0) {
    // Clip: contour mét de sparingen als gaten (even-odd, W* n) — de
    // decoraties stoppen dus op de sparingsrand; de onderliggende tekening
    // blijft in het gat zichtbaar (uitsparing i.p.v. witte vlek).
    let clipOps = systeemrasterContourOps(nodes, X, Y);
    for (const sp of geom.sparingen || []) clipOps += sparingRectOps(sp);
    s += 'q\n' + clipOps + ((geom.sparingen || []).length > 0 ? 'W* n\n' : 'W n\n');
    s += `${f(Math.max(lw * 0.6, 0.4))} w\n`;
    for (const p of decorated) {
      if (p.component) {
        // Placeholder gecentreerd, 80% van de kleinste celmaat — draait
        // mee met de rasterhoek via de per-punt W()-transform.
        const maat = Math.min(p.w, p.h) * 0.8;
        const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
        const q1 = W(cx - maat / 2, cy - maat / 2), q2 = W(cx + maat / 2, cy - maat / 2);
        const q3 = W(cx + maat / 2, cy + maat / 2), q4 = W(cx - maat / 2, cy + maat / 2);
        s += `${f(X(q1.x))} ${f(Y(q1.y))} m ${f(X(q2.x))} ${f(Y(q2.y))} l `
          + `${f(X(q3.x))} ${f(Y(q3.y))} l ${f(X(q4.x))} ${f(Y(q4.y))} l h\nS\n`;
        s += ln(cx - maat / 2, cy - maat / 2, cx + maat / 2, cy + maat / 2);
        s += ln(cx + maat / 2, cy - maat / 2, cx - maat / 2, cy + maat / 2);
        const label = p.component.naam || p.component.symbolId;
        const fs = Math.max(4, maat * 0.18);
        const anker = W(cx - maat / 2, cy + maat * 0.72);
        s += `BT\n/Helv ${f(fs)} Tf\n${f(stroke[0])} ${f(stroke[1])} ${f(stroke[2])} rg\n`;
        s += `1 0 0 1 ${f(X(anker.x))} ${f(Y(anker.y))} Tm\n`;
        s += `(${escapePdfText(label)}) Tj\nET\n`;
        needsFont = true;
      } else if (p.stijl === 'ventilatie') {
        s += ln(p.x, p.y, p.x + p.w, p.y + p.h);
        s += ln(p.x + p.w, p.y, p.x, p.y + p.h);
      } else if (p.stijl === 'licht') {
        const pitch = Math.max(2, Math.min(p.w, p.h) / 5);
        // Paneel-clip: de vier (gedraaide) hoekpunten als polygoon.
        const c1 = W(p.x, p.y), c2 = W(p.x + p.w, p.y);
        const c3 = W(p.x + p.w, p.y + p.h), c4 = W(p.x, p.y + p.h);
        s += `q\n${f(X(c1.x))} ${f(Y(c1.y))} m ${f(X(c2.x))} ${f(Y(c2.y))} l `
          + `${f(X(c3.x))} ${f(Y(c3.y))} l ${f(X(c4.x))} ${f(Y(c4.y))} l h\nW n\n`;
        for (let c = p.x - p.h; c <= p.x + p.w; c += pitch) {
          s += ln(c, p.y + p.h, c + p.h, p.y);
        }
        s += 'Q\n';
      }
    }
    s += 'Q\n';
  }
  // Sparingsranden (per regime) + raveelijzers — zelfde beeld als canvas.
  for (const sp of geom.sparingen || []) {
    s += `${f(sp.regime === 'verzwaard' ? lw * 2.2 : Math.max(lw * 0.6, 0.4))} w\n`;
    s += sparingRectOps(sp) + 'S\n';
  }
  if ((geom.raveels || []).length > 0) {
    const kAp = geom.pxPerMm || 1;
    const off = srRaveelOffsetMm * kAp;
    const steek = srRaveelStreepMm * kAp;
    for (const r of geom.raveels) {
      s += `${f(lw * 1.8)} w\n`;
      s += ln(r.x1, r.y - off, r.x2, r.y - off);
      s += ln(r.x1, r.y + off, r.x2, r.y + off);
      s += `${f(Math.max(lw * 0.8, 0.5))} w\n`;
      for (let xx = r.x1 + steek / 2; xx < r.x2; xx += steek) {
        s += ln(xx, r.y - off, xx, r.y + off);
      }
    }
    s += `${f(lw)} w\n`;
  }
  // Randprofiel per CONTOURSEGMENT (type-basis + instantie-overrides):
  // hoeklijn = zwaardere lijn óp het segment; schaduwvoeg = dunne
  // gestreepte binnenlijn; 'geen' = niets. Zelfde beeld als het canvas.
  const openPad = (pts) => {
    let o = `${f(X(pts[0].x))} ${f(Y(pts[0].y))} m\n`;
    for (let i = 1; i < pts.length; i++) o += `${f(X(pts[i].x))} ${f(Y(pts[i].y))} l\n`;
    return o;
  };
  for (const es of geom.edgeSegs || []) {
    if (es.profiel === 'hoeklijn' && es.pts.length >= 2) {
      s += `${f(lw * 2.5)} w\n` + openPad(es.pts) + 'S\n' + `${f(lw)} w\n`;
    } else if (es.profiel === 'schaduwvoeg' && es.insetPts && es.insetPts.length >= 2) {
      s += `${f(Math.max(lw * 0.6, 0.4))} w\n[4 3] 0 d\n`;
      s += openPad(es.insetPts) + 'S\n';
      s += `[] 0 d\n${f(lw)} w\n`;
    }
  }
  // Tag (plaatmaat "B×H"), horizontaal, links uitgelijnd op het anker.
  if (geom.tag) {
    const t = geom.tag;
    s += `BT\n/Helv ${f(t.fontSize)} Tf\n${f(stroke[0])} ${f(stroke[1])} ${f(stroke[2])} rg\n`;
    s += `1 0 0 1 ${f(X(t.x))} ${f(Y(t.y))} Tm\n`;
    s += `(${escapePdfText(t.text)}) Tj\nET\n`;
    needsFont = true;
  }
  return { content: s, needsFont };
}

// cloud / cloudPolyline: scalloped outline (optional fill).
export function buildCloudAP({ kind, x, y, w, h, points, puff, X, Y,
  fillColorHex, strokeColorHex, lineWidth, borderStyle }) {
  const outline = kind === 'rect'
    ? cloudRectOutlinePts(x, y, w, h, puff || 15)
    : cloudPolyOutlinePts(points, true);
  if (!outline || outline.length < 3) return null;
  const stroke = hexToRgb(strokeColorHex || '#000000');
  let s = '';
  if (fillColorHex && fillColorHex !== 'none' && fillColorHex !== 'transparent') {
    s += solidFillOps(outline, null, hexToRgb(fillColorHex), X, Y);
  }
  s += `${f(stroke[0])} ${f(stroke[1])} ${f(stroke[2])} RG\n${f(lineWidth ?? 1)} w\n${dashOp(borderStyle)}`;
  s += pathOps(outline, X, Y, true) + 'S\n';
  return { content: s, needsFont: false };
}

// splineArrow: smooth Catmull-Rom curve (as cubic Béziers) through the clicked
// points, plus an arrowhead at the end (and optionally the start). All geometry
// is computed in APP space and converted per-point via X()/Y(), so the PDF
// appearance matches the on-screen canvas (issue #267).
const _FILLED_HEADS = new Set(['closed', 'closedReversed', 'diamond', 'square', 'circle']);

// Emit one arrowhead at app-space tip (tx,ty) pointing along `angle`
// (screen/app space, y-down). Mirrors decorations.js drawArrowheadOnCanvas:
// half-angle 30°, tip at the point, back corners at (-size, ±size·tan30°).
function arrowheadOps(tx, ty, angle, size, style, strokeRgb, fillRgb, lineWidth, X, Y) {
  const t = Math.tan(Math.PI / 6);
  const cos = Math.cos(angle), sin = Math.sin(angle);
  // Rotate a local (lx,ly) into app space around the tip.
  const world = (lx, ly) => ({ x: tx + lx * cos - ly * sin, y: ty + lx * sin + ly * cos });
  const bl = world(-size, -size * t);
  const br = world(-size, size * t);
  let s = `${f(strokeRgb[0])} ${f(strokeRgb[1])} ${f(strokeRgb[2])} RG\n${f(lineWidth ?? 1)} w\n[] 0 d\n`;
  if (_FILLED_HEADS.has(style)) {
    // Filled triangle: tip -> back-left -> back-right, close, fill+stroke.
    const fill = fillRgb || strokeRgb;
    s += `${f(fill[0])} ${f(fill[1])} ${f(fill[2])} rg\n`;
    s += `${f(X(tx))} ${f(Y(ty))} m ${f(X(bl.x))} ${f(Y(bl.y))} l ${f(X(br.x))} ${f(Y(br.y))} l h\nB\n`;
  } else {
    // Open V: back-left -> tip -> back-right, stroked only.
    s += `${f(X(bl.x))} ${f(Y(bl.y))} m ${f(X(tx))} ${f(Y(ty))} l ${f(X(br.x))} ${f(Y(br.y))} l S\n`;
  }
  return s;
}

export function buildSplineArrowAP({ points, X, Y, strokeColorHex, fillColorHex,
  lineWidth, borderStyle, startHead, endHead, headSize }) {
  const segs = catmullRomToBezier(points);
  if (segs.length === 0) return null;
  const stroke = hexToRgb(strokeColorHex || '#000000');
  const fill = fillColorHex && fillColorHex !== 'none' && fillColorHex !== 'transparent'
    ? hexToRgb(fillColorHex) : null;
  const lw = lineWidth ?? 1;
  const size = headSize || 8;

  // Curve (bezier chain).
  let s = `${f(stroke[0])} ${f(stroke[1])} ${f(stroke[2])} RG\n${f(lw)} w\n1 J 1 j\n${dashOp(borderStyle)}`;
  s += `${f(X(segs[0].x0))} ${f(Y(segs[0].y0))} m\n`;
  for (const seg of segs) {
    s += `${f(X(seg.c1x))} ${f(Y(seg.c1y))} ${f(X(seg.c2x))} ${f(Y(seg.c2y))} ${f(X(seg.x1))} ${f(Y(seg.y1))} c\n`;
  }
  s += 'S\n';

  // End arrowhead.
  if (endHead && endHead !== 'none') {
    const tip = points[points.length - 1];
    s += arrowheadOps(tip.x, tip.y, splineArrowEndTangent(points), size, endHead, stroke, fill, lw, X, Y);
  }
  // Start arrowhead (curve reversed to get the outgoing tangent at the start).
  if (startHead && startHead !== 'none') {
    const tip = points[0];
    const revAngle = splineArrowEndTangent([...points].reverse());
    s += arrowheadOps(tip.x, tip.y, revAngle, size, startHead, stroke, fill, lw, X, Y);
  }
  return { content: s, needsFont: false };
}

// ── stavenreeks (wapeningsstaven-reeks) ────────────────────────────────────
// AFWIJKEND van de builders hierboven: deze levert content in LOKALE
// coördinaten (0..w, 0..h, y omhoog), relatief aan de annotatie-/Rect.
// De caller schrijft daarom:
//     /BBox   [0 0 w h]      (= /Rect-afmeting)
//     /Matrix [1 0 0 1 0 0]  (= IDENTITEIT)
// Dat is de canonieke conventie uit docs/superpowers/
// research-pdf-rotatie-mechanica.md §12.5.5: de getransformeerde appearance-box
// is dan exact de BBox, dus matrix A uit stap (b) wordt een zuivere translatie
// met sx = sy = 1. Geen vervorming, en verplaatsen in een andere editor
// (die alleen /Rect verschuift) laat de tekening netjes meeschuiven.
//
// Een SCHUINE reeks wordt getekend via de coördinaten IN de stream — er komt
// geen rotatie-matrix aan te pas.
//
// `geom` is het resultaat van buildStavenreeks() en `local` het resultaat van
// toLocalPrimitives(geom.primitives, geom.aabb, { flipY: true }).
export function buildStavenreeksAP({ geom, local, strokeColorHex, lineWidth }) {
  if (!geom || !local) return null;
  const rgb = hexToRgb(strokeColorHex || '#000000');
  const lw = lineWidth ?? 1;
  const col = `${f(rgb[0])} ${f(rgb[1])} ${f(rgb[2])}`;

  let s = `${col} RG\n${col} rg\n${f(lw)} w\n1 J\n1 j\n`;

  // Reekslijn + poten (alle 'line'-primitieven) in één pad.
  const lines = local.filter(p => p.kind === 'line');
  if (lines.length) {
    for (const l of lines) {
      s += `${f(l.x1)} ${f(l.y1)} m ${f(l.x2)} ${f(l.y2)} l\n`;
    }
    s += 'S\n';
  }

  // Gevulde punten (staafposities). Cirkel via vier Bézier-segmenten.
  const K = 0.5522847498;
  for (const d of local.filter(p => p.kind === 'dot')) {
    const r = d.r, cx = d.x, cy = d.y, k = r * K;
    s += `${f(cx + r)} ${f(cy)} m\n`;
    s += `${f(cx + r)} ${f(cy + k)} ${f(cx + k)} ${f(cy + r)} ${f(cx)} ${f(cy + r)} c\n`;
    s += `${f(cx - k)} ${f(cy + r)} ${f(cx - r)} ${f(cy + k)} ${f(cx - r)} ${f(cy)} c\n`;
    s += `${f(cx - r)} ${f(cy - k)} ${f(cx - k)} ${f(cy - r)} ${f(cx)} ${f(cy - r)} c\n`;
    s += `${f(cx + k)} ${f(cy - r)} ${f(cx + r)} ${f(cy - k)} ${f(cx + r)} ${f(cy)} c\n`;
    s += 'f\n';
  }

  // Label "N ⌀ D". De tekstdelen gaan door Helvetica; het diameterteken wordt
  // als VECTOR getekend (cirkel + schuine streep + twee vlaggetjes — het
  // wapeningssymbool), omdat U+2300 niet in WinAnsiEncoding zit en het
  // wapeningssymbool in geen enkel standaardfont bestaat. Identiek aan wat
  // het canvas tekent: de geometrie komt uit dezelfde gedeelde module.
  let needsFont = false;
  const lbl = local.find(p => p.kind === 'text');
  if (lbl && Array.isArray(lbl.parts)) {
    const fs = lbl.size;
    const ca = Math.cos(lbl.angle), sa = Math.sin(lbl.angle);
    const x0 = lbl.startOffset || 0;
    // Roteer het label mee met de lijnrichting via een cm-transform binnen
    // q/Q. Dit is een LOKALE tekst-oriëntatie in de stream, geen annotatie-
    // rotatie: /Matrix blijft identiteit.
    s += `q\n${f(ca)} ${f(sa)} ${f(-sa)} ${f(ca)} ${f(lbl.x)} ${f(lbl.y)} cm\n`;
    for (const part of lbl.parts) {
      if (part.kind === 'text') {
        needsFont = true;
        s += 'BT\n';
        s += `/Helv ${f(fs)} Tf\n`;
        s += `${col} rg\n`;
        // Baseline ligt iets onder het midden (canvas gebruikt 'middle').
        s += `${f(x0 + part.dx)} ${f(-fs * 0.34)} Td\n`;
        s += `(${escapePdfText(part.text)}) Tj\n`;
        s += 'ET\n';
      } else {
        const r = lbl.signRadius;
        const cx = x0 + part.dx + part.w / 2;
        const k = r * K;
        s += `${col} RG\n${f(Math.max(0.4, fs * 0.07))} w\n`;
        s += `${f(cx + r)} 0 m\n`;
        s += `${f(cx + r)} ${f(k)} ${f(cx + k)} ${f(r)} ${f(cx)} ${f(r)} c\n`;
        s += `${f(cx - k)} ${f(r)} ${f(cx - r)} ${f(k)} ${f(cx - r)} 0 c\n`;
        s += `${f(cx - r)} ${f(-k)} ${f(cx - k)} ${f(-r)} ${f(cx)} ${f(-r)} c\n`;
        s += `${f(cx + k)} ${f(-r)} ${f(cx + r)} ${f(-k)} ${f(cx + r)} 0 c\n`;
        s += 'S\n';
        // Schuine streep + de twee vlaggetjes van het wapeningssymbool. De
        // lijnstukken komen uit de GEDEELDE module (diameterSignSegments via
        // labelLayout) en staan al in een y-OMHOOG frame — precies de
        // PDF-conventie, dus ze worden ongewijzigd overgenomen. Het canvas
        // spiegelt dezelfde segmenten; zo kunnen scherm en PDF niet
        // uiteenlopen.
        for (const seg of (lbl.signSegments || [])) {
          s += `${f(cx + seg.x1)} ${f(seg.y1)} m ${f(cx + seg.x2)} ${f(seg.y2)} l S\n`;
        }
      }
    }
    s += 'Q\n';
  }

  return { content: s, needsFont };
}

// Exposed for the caller to build the font resource dict only when needed.
export const HELV_FONT_NAME = 'Helv';
