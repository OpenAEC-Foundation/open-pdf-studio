// The app state a skill of the assistant needs before it is sent (#452): is a
// document open, which page, what is selected, is there a measuring scale, and
// today's date. AssistantPanel.jsx reads it from the live document at the
// moment of sending; assistant-skills.js decides with it whether the skill may
// go (skillBlocker / skillInputProblem) and appends it for the model
// (skillContextNote).
//
// No app state is imported here: the caller passes the document, so the rules
// are testable under node. The scale follows the same order as a measurement
// (schaal-op-punt.js), with the scale region first, as findMeasureScale does.

import { verzamelSchaalBronnen, schaalgebiedenOpPagina, schaalOpPuntUitBronnen, documentHeeftSchaal } from './annotations/schaal-op-punt.js';
import { pixelsPerUnitFor, userUnitVanPagina } from './annotations/scale-region-scale.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** The bounding box of an annotation in page points (top-left origin), or null. */
export function annotationBox(a) {
  if (!a) return null;
  if ([a.x, a.y, a.width, a.height].every(isNum)) return { x: a.x, y: a.y, width: a.width, height: a.height };
  const pts = [];
  if ([a.startX, a.startY, a.endX, a.endY].every(isNum)) pts.push({ x: a.startX, y: a.startY }, { x: a.endX, y: a.endY });
  for (const list of [a.points, a.controlPoints, a.path]) {
    if (Array.isArray(list)) for (const p of list) if (p && isNum(p.x) && isNum(p.y)) pts.push(p);
  }
  if (!pts.length && isNum(a.x) && isNum(a.y)) pts.push({ x: a.x, y: a.y });
  if (!pts.length) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** The scale at a point of a page: scale region first, then the other sources. */
export function scaleAtPoint(doc, page, x, y) {
  if (!doc) return null;
  const bronnen = verzamelSchaalBronnen(doc);
  const gebied = schaalgebiedenOpPagina(bronnen, page)
    .find((r) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height);
  if (gebied) {
    return { pixelsPerUnit: pixelsPerUnitFor(gebied.scaleString || '1:100', gebied.units || 'mm', userUnitVanPagina(doc, page)), unit: gebied.units || 'mm', method: 'scaleRegion' };
  }
  return schaalOpPuntUitBronnen(bronnen, doc, page, x, y);
}

/** Local date as YYYY-MM-DD. */
export function localDate(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * The skill context of the active document.
 * @param {object} args
 * @param {object | null} args.doc            the active document (getActiveDocument())
 * @param {{hasSelection?: boolean, selectedText?: string} | null} [args.textSelection]  state.textSelection
 * @param {Date} [args.now]
 */
export function skillContextFromDocument({ doc, textSelection = null, now = new Date() } = {}) {
  const today = localDate(now);
  if (!doc) return { hasDocument: false, page: 0, pageCount: 0, selection: [], selectedText: '', scale: null, hasScale: false, today };
  const page = doc.currentPage || 1;
  const pageCount = doc.pdfDoc?.numPages || doc.pageCount || 0;
  const chosen = Array.isArray(doc.selectedAnnotations) && doc.selectedAnnotations.length
    ? doc.selectedAnnotations
    : (doc.selectedAnnotation ? [doc.selectedAnnotation] : []);
  const selection = chosen.filter(Boolean).map((a) => ({ id: a.id, type: a.type, page: a.page ?? page, ...(annotationBox(a) || {}) }));
  const selectedText = textSelection?.hasSelection ? String(textSelection.selectedText || '') : '';

  // The scale where it matters: at the middle of the first selected
  // annotation, otherwise anywhere on the current page or in the document.
  const first = selection.find((a) => isNum(a.x));
  let scale = first ? scaleAtPoint(doc, first.page, first.x + first.width / 2, first.y + first.height / 2) : null;
  if (!scale && doc.measureScale && doc.measureScale.pixelsPerUnit > 0) {
    scale = { pixelsPerUnit: doc.measureScale.pixelsPerUnit, unit: doc.measureScale.unit || 'mm', method: 'document' };
  }
  const hasScale = !!scale || documentHeeftSchaal(doc);
  return { hasDocument: true, page, pageCount, selection, selectedText, scale, hasScale, today };
}
