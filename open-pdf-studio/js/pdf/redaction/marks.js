// App redaction marks → redaction areas in PDF user space (#762).
//
// A mark is stored like other rectangle annotations: top-left origin, scale
// 1, in the displayed (rotated) page space, optionally rotated about its
// centre by `rotation` degrees. Each corner goes through the same mapping as
// the saver (makePointMapper), so a mark on a rotated page or with its own
// rotation becomes the quadrilateral the user sees.

import { makePointMapper } from '../saver/correction-dicts.js';
import { normaliseConvex, convexIntersect } from './geometry.js';

/** '#rrggbb' → [r, g, b] in 0..1 (black when invalid). */
export function fillOf(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return [0, 0, 0];
  const v = parseInt(m[1], 16);
  return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255];
}

/** Corners of a mark in app page space (clockwise on screen). */
export function markCorners(ann) {
  const { x, y, width: w, height: h } = ann;
  const pts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const deg = Number(ann.rotation) || 0;
  if (!deg) return pts;
  const cx = x + w / 2, cy = y + h / 2;
  const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  return pts.map(([px, py]) => [cx + (px - cx) * c - (py - cy) * s, cy + (px - cx) * s + (py - cy) * c]);
}

/** Is a mark's geometry usable (finite, positive size)? */
export function isValidMark(ann) {
  return !!ann && [ann.x, ann.y, ann.width, ann.height].every(Number.isFinite) && ann.width > 0 && ann.height > 0;
}

/**
 * Convert marks to areas.
 * @param {object[]} anns redaction marks (type 'redaction')
 * @param {(pageNum:number) => {rotation:number, cropBox:{x,y,width,height}}|null} pageInfo
 * @returns {{marks: object[], invalid: object[]}}
 */
export function marksFromAnnotations(anns, pageInfo) {
  const marks = [], invalid = [];
  for (const a of anns) {
    const info = pageInfo(a.page);
    if (!info || !isValidMark(a)) { invalid.push(a); continue; }
    const map = makePointMapper(info.rotation, info.cropBox);
    const quad = markCorners(a).map(([px, py]) => { const p = map(px, py); return [p.x, p.y]; });
    if (!normaliseConvex(quad)) { invalid.push(a); continue; }
    marks.push({ id: a.id, pageIndex: a.page - 1, quad, fill: fillOf(a.overlayColor || '#000000') });
  }
  return { marks, invalid };
}

/** Does an app-space rectangle {x,y,width,height} touch any mark (app space)? */
export function boundsTouchMarks(bounds, marks) {
  if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) return false;
  const b = [[bounds.x, bounds.y], [bounds.x + bounds.width, bounds.y], [bounds.x + bounds.width, bounds.y + bounds.height], [bounds.x, bounds.y + bounds.height]];
  return marks.some((m) => convexIntersect(b, markCorners(m)));
}

/** Does an OCR word ({left, top, width, height}: points, top-left of the CropBox) touch an area (PDF space)? */
export function ocrWordTouches(word, cropBox, quads) {
  if (!word || ![word.left, word.top, word.width, word.height].every(Number.isFinite)) return false;
  const x0 = cropBox.x + word.left, x1 = x0 + word.width;
  const yTop = cropBox.y + cropBox.height - word.top, y0 = yTop - word.height;
  const box = [[x0, y0], [x1, y0], [x1, yTop], [x0, yTop]];
  return quads.some((q) => convexIntersect(box, q));
}
