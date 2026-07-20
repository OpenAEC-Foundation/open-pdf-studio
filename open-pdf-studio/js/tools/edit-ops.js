// ── THE high-level edit-operations layer ────────────────────────────────────
//
// Architecture contract (this is the law — see also annotations/transforms.js
// and g-move-mode.js):
//
//   Every edit operation in the app — move (G / MV), copy (CO, Ctrl+drag),
//   array, create-similar, future mirror/rotate/… — is built EXCLUSIVELY
//   from the generic primitives below. None of them may contain per-type
//   code. Because the primitives are field-walkers over conventional
//   geometry fields (x/y, start/end, points[], path[], controlPoints[],
//   holes, …) and JSON deep-clones, ANY annotation type — built-in, wall,
//   parametric symbol, plugin, or a type that does not exist yet — gets
//   every edit operation for free the moment it is created. If a new type
//   needs special behaviour, extend the PRIMITIVE (applyMove's field tables,
//   cloneForInsert), never the operations.
//
//   Primitives:
//     * target resolution  → getEditTargets()  (selection, else hover)
//     * movement           → applyMove/applyMoveGeneric (transforms.js)
//     * interactive move   → tryStartGMove (g-move-mode.js, ONE session)
//     * duplication        → cloneForInsert() (deep clone + fresh identity)
//     * undo               → recordAdd / recordModify / recordBulkModify
//
import { state, getActiveDocument } from '../core/state.js';
import { cloneAnnotation } from '../annotations/factory.js';
import { findAnnotationAt } from '../annotations/geometry.js';
import { recordBulkAdd } from '../core/undo-manager.js';
import { redrawAnnotations, redrawContinuous } from '../annotations/rendering.js';
import { tryStartGMove } from './g-move-mode.js';

// Types whose position is text-anchored — excluded from move/copy targets.
export const NON_EDITABLE_TYPES = new Set([
  'textHighlight', 'textStrikethrough', 'textUnderline',
]);

function _redraw() {
  if (getActiveDocument()?.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

/** Fresh-enough mouse tracker? Guards against seeding an edit session from a
 *  STALE cursor position (cursor left the canvas minutes ago) — the cause of
 *  clones/moves teleporting off-page on the first mouse move. */
export function trackerFresh(maxAgeMs = 800) {
  return state._lastMouseAppX != null
    && state._lastMouseAppT != null
    && (performance.now() - state._lastMouseAppT) <= maxAgeMs;
}

/** Generate a fresh annotation id (single id convention for ALL inserts). */
export function newAnnotationId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 11);
}

/**
 * Resolve the annotations an edit operation acts on: the current selection,
 * else (Blender-style) the annotation under the cursor — provided the
 * cursor position is FRESH. One rule for every operation.
 */
export function getEditTargets({ hover = true } = {}) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return [];
  let targets = (doc.selectedAnnotations || []).filter(
    a => a && !a.locked && !NON_EDITABLE_TYPES.has(a.type)
  );
  if (targets.length === 0 && hover && trackerFresh()) {
    const hovered = findAnnotationAt(state._lastMouseAppX, state._lastMouseAppY);
    if (hovered && !hovered.locked && !NON_EDITABLE_TYPES.has(hovered.type)) {
      doc.selectedAnnotations = [hovered];
      doc.selectedAnnotation = hovered;
      targets = [hovered];
    }
  }
  return targets;
}

/** Deep-clone an annotation with a fresh identity, ready for insertion.
 *  THE single duplication primitive — CO, Ctrl+drag copy and the array tool
 *  all go through here. */
export function cloneForInsert(ann) {
  const c = cloneAnnotation(ann);
  c.id = newAnnotationId();
  c.createdAt = new Date().toISOString();
  c.modifiedAt = c.createdAt;
  return c;
}

/**
 * Duplicate the current targets in place (clones become the selection).
 * Returns the clones ([] when nothing to duplicate). Undo-recorded.
 */
export function duplicateTargets({ recordUndo = true } = {}) {
  const doc = getActiveDocument();
  const targets = getEditTargets();
  if (!doc || targets.length === 0) return [];
  const clones = targets.map(cloneForInsert);
  doc.annotations.push(...clones);
  if (recordUndo) recordBulkAdd(clones);
  doc.selectedAnnotations = clones;
  doc.selectedAnnotation = clones[0];
  _redraw();
  return clones;
}

/** Interactive move of the current targets (the G key / 'mv' chord). */
export function moveTargets() {
  return tryStartGMove();
}

/** 'CO': duplicate the targets and move the copies AutoCAD-style — the
 *  first click picks the (object-snapped) BASE point, the second click (or
 *  a typed distance) drops the copies. One interactive session. */
export function copyAndMove() {
  const doc = getActiveDocument();
  const sourceSelection = doc?.selectedAnnotations?.slice() || [];
  const clones = duplicateTargets({ recordUndo: false });
  if (clones.length === 0) return false;
  if (!tryStartGMove({ basePoint: true, insertedCopies: true, restoreSelection: sourceSelection })) {
    const cloneIds = new Set(clones.map(annotation => annotation.id));
    doc.annotations = doc.annotations.filter(annotation => !cloneIds.has(annotation.id));
    doc.selectedAnnotations = sourceSelection;
    doc.selectedAnnotation = sourceSelection[0] || null;
    _redraw();
    return false;
  }
  return true;
}
