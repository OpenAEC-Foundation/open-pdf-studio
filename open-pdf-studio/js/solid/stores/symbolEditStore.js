// Symbol Type Editor store
// -------------------------
// Drives the dedicated "Edit Type" environment: a full-cover editor where the
// user reshapes the LINES of a placed symbol-stamp type. On save the edited
// geometry is written back to a clean SVG string, stored as a user-override in
// preferences (keyed by the original source SVG), applied to the selected stamp,
// and reused by all future placements of that type.
//
// Scope (v1):
//   • Editable geometry: <line>, <polyline>, <polygon>, and <path> (the "lines").
//     Their vertices become draggable points. Path curves are flattened to their
//     on-path anchor points; re-serialized as straight segments between anchors.
//   • Non-line elements (<text>, <circle>, <rect>, <ellipse>, <image>, …) are
//     preserved verbatim and rendered as read-only context.
//   • Per-editor stroke width + stroke colour overrides.
// The canonical output viewBox is "0 0 64 64" (y-down), matching the source
// symbol library.

import { createSignal } from 'solid-js';
import { state, getActiveDocument } from '../../core/state.js';
import { recordModify } from '../../core/undo-manager.js';
import { cloneAnnotation } from '../../annotations/factory.js';
import { updateStampImage } from '../../annotations/stamps.js';
import { setSymbolTypeOverride, resolveSymbolSvg } from './symbolStore.js';
import { saneerSvg } from '../../core/svg-veilig.js';

const VIEWBOX = 64;

// --- Reactive editor state ---
const [editorOpen, setEditorOpen] = createSignal(false);
// Parsed editable line-shapes: [{ id, points:[{x,y},...], closed, stroke, strokeWidth }]
const [shapes, setShapes] = createSignal([]);
// Raw markup of non-line elements, preserved and re-emitted on save
const [staticMarkup, setStaticMarkup] = createSignal('');
const [typeName, setTypeName] = createSignal('Symbol');

// Non-reactive edit session context
let session = null; // { ann, baseSvg, oldSnapshot }

function num(v, fallback = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

// Parse a "d" attribute into a flat list of anchor points, honouring M/L/H/V/C/
// S/Q/T/Z (curves reduced to their end anchors). Relative commands supported.
function parsePathPoints(d) {
  const pts = [];
  let closed = false;
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
  let i = 0;
  let cx = 0, cy = 0;
  let cmd = '';
  const read = () => num(tokens[i++]);
  while (i < tokens.length) {
    const t = tokens[i];
    if (/[a-zA-Z]/.test(t)) { cmd = t; i++; }
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === 'M' || C === 'L') {
      let x = read(), y = read();
      if (rel) { x += cx; y += cy; }
      cx = x; cy = y; pts.push({ x, y });
      if (C === 'M') cmd = rel ? 'l' : 'L'; // subsequent implicit lineto
    } else if (C === 'H') {
      let x = read(); if (rel) x += cx; cx = x; pts.push({ x: cx, y: cy });
    } else if (C === 'V') {
      let y = read(); if (rel) y += cy; cy = y; pts.push({ x: cx, y: cy });
    } else if (C === 'C') {
      read(); read(); read(); read(); let x = read(), y = read();
      if (rel) { x += cx; y += cy; } cx = x; cy = y; pts.push({ x, y });
    } else if (C === 'S' || C === 'Q') {
      read(); read(); let x = read(), y = read();
      if (rel) { x += cx; y += cy; } cx = x; cy = y; pts.push({ x, y });
    } else if (C === 'T') {
      let x = read(), y = read();
      if (rel) { x += cx; y += cy; } cx = x; cy = y; pts.push({ x, y });
    } else if (C === 'Z') {
      closed = true;
    } else {
      // Unknown token — skip defensively to avoid an infinite loop
      i++;
    }
  }
  return { pts, closed };
}

function parsePointsAttr(str) {
  const nums = (str.match(/-?\d*\.?\d+/g) || []).map(Number);
  const pts = [];
  for (let k = 0; k + 1 < nums.length; k += 2) pts.push({ x: nums[k], y: nums[k + 1] });
  return pts;
}

// Parse an SVG string into { shapes, staticMarkup, viewBox }.
function parseSvg(svgStr) {
  // De niet-bewerkbare delen komen als markup in de editor (innerHTML):
  // eerst alleen bekende tekenelementen en attributen overhouden, en geen
  // <style> (dat zou de hele app opmaken).
  const schoon = saneerSvg(svgStr, { zonderStijl: true }) || '<svg xmlns="http://www.w3.org/2000/svg"/>';
  const parser = new DOMParser();
  const doc = parser.parseFromString(schoon, 'image/svg+xml');
  const svg = doc.querySelector('svg');
  const parsedShapes = [];
  const staticNodes = [];

  let counter = 0;
  const rootCtx = {
    stroke: svg?.getAttribute('stroke') || '#000',
    strokeWidth: num(svg?.getAttribute('stroke-width'), 2),
    fill: svg?.getAttribute('fill') || 'none',
  };

  // A preserved (read-only) element that lived inside a stroked/filled <g> loses
  // its inherited paint once we lift it out into the flat static layer. Re-apply
  // the ancestor stroke/stroke-width/fill it was relying on, but only for the
  // attributes it does not set itself — so a <circle>/arc-<path> keeps rendering
  // as a crisp outline (not a solid black blob) in the editor preview.
  const withInheritedStyle = (el, ctx) => {
    for (const [attr, val] of [['stroke', ctx.stroke], ['stroke-width', ctx.strokeWidth], ['fill', ctx.fill]]) {
      if (val != null && !el.hasAttribute(attr)) el.setAttribute(attr, String(val));
    }
    return el.outerHTML;
  };

  // Walk the tree so geometry nested inside <g> groups (the common case for the
  // symbol library — every stamp wraps its paths in a stroked <g>) is editable,
  // inheriting stroke/stroke-width/fill from ancestor groups. Transformed groups
  // are kept verbatim to avoid mispositioning without applying the transform.
  const walk = (parent, ctx) => {
    for (const el of Array.from(parent.children)) {
      const tag = el.tagName.toLowerCase();
      const stroke = el.getAttribute('stroke') || ctx.stroke;
      const sw = el.hasAttribute('stroke-width') ? num(el.getAttribute('stroke-width'), ctx.strokeWidth) : ctx.strokeWidth;
      const fill = el.getAttribute('fill') || ctx.fill;
      if (tag === 'g') {
        if (el.hasAttribute('transform')) { staticNodes.push(el.outerHTML); continue; }
        walk(el, { stroke, strokeWidth: sw, fill });
      } else if (tag === 'line') {
        parsedShapes.push({
          id: 's' + (counter++),
          points: [
            { x: num(el.getAttribute('x1')), y: num(el.getAttribute('y1')) },
            { x: num(el.getAttribute('x2')), y: num(el.getAttribute('y2')) },
          ],
          closed: false, stroke, strokeWidth: sw,
        });
      } else if (tag === 'polyline' || tag === 'polygon') {
        const pts = parsePointsAttr(el.getAttribute('points') || '');
        if (pts.length >= 2) {
          parsedShapes.push({
            id: 's' + (counter++), points: pts,
            closed: tag === 'polygon', stroke, strokeWidth: sw,
            fill: tag === 'polygon' ? fill : 'none',
          });
        } else {
          staticNodes.push(withInheritedStyle(el, { stroke, strokeWidth: sw, fill }));
        }
      } else if (tag === 'path') {
        const { pts, closed } = parsePathPoints(el.getAttribute('d') || '');
        if (pts.length >= 2) {
          parsedShapes.push({
            id: 's' + (counter++), points: pts, closed,
            stroke, strokeWidth: sw, fill,
          });
        } else {
          // Arc-only paths (M…A…) flatten to a single anchor → keep them as
          // read-only context so the curve renders smoothly, not as segments.
          staticNodes.push(withInheritedStyle(el, { stroke, strokeWidth: sw, fill }));
        }
      } else {
        // text, circle, rect, ellipse, image, … kept verbatim (with inherited paint)
        staticNodes.push(withInheritedStyle(el, { stroke, strokeWidth: sw, fill }));
      }
    }
  };
  if (svg) walk(svg, rootCtx);

  return { shapes: parsedShapes, staticMarkup: staticNodes.join('') };
}

// Serialize editor state back into a clean 0 0 64 64 SVG string.
function serializeSvg(shapeList, staticStr) {
  const parts = [];
  for (const sh of shapeList) {
    const pointsStr = sh.points.map(p =>
      `${round(p.x)},${round(p.y)}`).join(' ');
    const strokeAttr = `stroke="${escAttr(sh.stroke || '#000')}" stroke-width="${escAttr(sh.strokeWidth ?? 2)}"`;
    if (sh.closed) {
      const fill = sh.fill && sh.fill !== 'none' ? sh.fill : 'none';
      parts.push(`<polygon points="${pointsStr}" fill="${escAttr(fill)}" ${strokeAttr}/>`);
    } else {
      parts.push(`<polyline points="${pointsStr}" fill="none" ${strokeAttr}/>`);
    }
  }
  const body = parts.join('') + (staticStr || '');
  const svg = `<svg viewBox="0 0 ${VIEWBOX} ${VIEWBOX}" xmlns="http://www.w3.org/2000/svg" fill="none">${body}</svg>`;
  return saneerSvg(svg, { zonderStijl: true }) || `<svg viewBox="0 0 ${VIEWBOX} ${VIEWBOX}" xmlns="http://www.w3.org/2000/svg" fill="none"></svg>`;
}

function escAttr(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function round(n) {
  return Math.round(n * 100) / 100;
}

// --- Public API ---

// Open the editor for a selected stamp annotation.
export function openSymbolTypeEditor(ann) {
  if (!ann) return;
  // Prefer the original source SVG as the override key; fall back to the current
  // rendered SVG. Parse the CURRENT geometry so an already-edited type opens
  // with its latest edits.
  const baseSvg = ann.stampBaseSvg || ann.stampSvg;
  if (!baseSvg) return;
  const currentSvg = ann.stampSvg || resolveSymbolSvg(baseSvg);

  const parsed = parseSvg(currentSvg);
  session = {
    ann,
    baseSvg,
    oldSnapshot: cloneAnnotation(ann),
  };
  setShapes(parsed.shapes);
  setStaticMarkup(parsed.staticMarkup);
  setTypeName(ann.stampName || 'Symbol');
  setEditorOpen(true);
}

// Update a single vertex (immutable update for reactivity).
export function moveVertex(shapeId, pointIndex, x, y) {
  const clamp = (v) => Math.max(0, Math.min(VIEWBOX, round(v)));
  setShapes(prev => prev.map(sh => {
    if (sh.id !== shapeId) return sh;
    const points = sh.points.map((p, i) =>
      i === pointIndex ? { x: clamp(x), y: clamp(y) } : p);
    return { ...sh, points };
  }));
}

// Remove a vertex from a shape (keeps ≥2 points, else removes the shape).
export function removeVertex(shapeId, pointIndex) {
  setShapes(prev => prev.flatMap(sh => {
    if (sh.id !== shapeId) return [sh];
    if (sh.points.length <= 2) return []; // drop degenerate shape
    return [{ ...sh, points: sh.points.filter((_, i) => i !== pointIndex) }];
  }));
}

// Insert a vertex at the midpoint of the segment starting at pointIndex.
export function splitSegment(shapeId, segIndex) {
  setShapes(prev => prev.map(sh => {
    if (sh.id !== shapeId) return sh;
    const a = sh.points[segIndex];
    const b = sh.points[(segIndex + 1) % sh.points.length];
    if (!a || !b) return sh;
    const mid = { x: round((a.x + b.x) / 2), y: round((a.y + b.y) / 2) };
    const points = [...sh.points];
    points.splice(segIndex + 1, 0, mid);
    return { ...sh, points };
  }));
}

// Apply stroke width / colour to every shape.
export function setAllStroke({ stroke, strokeWidth }) {
  setShapes(prev => prev.map(sh => ({
    ...sh,
    ...(stroke !== undefined ? { stroke } : {}),
    ...(strokeWidth !== undefined ? { strokeWidth } : {}),
  })));
}

// Build the SVG string reflecting current editor state (used for live preview).
export function currentSvg() {
  return serializeSvg(shapes(), staticMarkup());
}

// Save: persist override, update the annotation, register undo, close.
export async function saveSymbolType() {
  if (!session) { setEditorOpen(false); return; }
  const { ann, baseSvg, oldSnapshot } = session;
  const newSvg = serializeSvg(shapes(), staticMarkup());
  const name = typeName().trim() || 'Symbol';

  // 1) Persist as a user-override keyed by the original source SVG.
  setSymbolTypeOverride(baseSvg, newSvg, name);

  // 2) Update the selected annotation's geometry + re-rasterize.
  ann.stampSvg = newSvg;
  ann.stampName = name;
  // Force re-rasterization: drop any stale cached image reference.
  ann.imageId = null;
  ann._cachedImg = null;
  await updateStampImage(ann, newSvg);

  // 3) Register a single atomic undo step (old geometry ⇄ new geometry).
  //    recordModify applies newState via Object.assign; ann already carries it.
  const newSnapshot = cloneAnnotation(ann);
  recordModify(ann.id, oldSnapshot, newSnapshot);

  session = null;
  setEditorOpen(false);
}

// Cancel: discard edits, leave annotation untouched, close.
export function cancelSymbolTypeEdit() {
  session = null;
  setEditorOpen(false);
}

export {
  editorOpen, shapes, staticMarkup, typeName, setTypeName,
  VIEWBOX,
};
