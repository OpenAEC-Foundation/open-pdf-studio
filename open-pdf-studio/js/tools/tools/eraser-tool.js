import { getActiveDocument } from '../../core/state.js';
import { execute } from '../../core/undo-manager.js';
import { cloneAnnotation } from '../../annotations/factory.js';
import { eraserHitsPath } from './eraser-hit.js';

// Ink eraser (issue #329) — drag over freehand ink strokes to remove them.
//
// - Whole-stroke erase only: any ink ('draw') annotation whose path is swept
//   within the eraser radius is removed entirely (partial erase = future work).
// - ONLY 'draw' annotations are affected — never the PDF page content and
//   never any other annotation type.
// - One drag = one undo step: hits are removed live (immediate feedback) and
//   committed as a single bulkDelete on pointer-up, so Ctrl+Z restores the
//   whole stroke at once.
// - Pointer events (dispatcher-wide) make pen/stylus work out of the box.

// Eraser radius in SCREEN pixels; converted to app coordinates per stroke so
// the felt size is zoom-independent. Matches the cursor circle in ui/cursor.js.
export const ERASER_RADIUS_PX = 8;

// Module-local stroke state (never on `state` — the generic _finishDrawing
// path in the dispatcher must not see this as a drawing gesture).
let _stroke = null;

function _eraseHitsAt(ctx, x0, y0, x1, y1) {
  const doc = getActiveDocument();
  if (!doc || !_stroke) return;
  const baseTol = Math.max(ERASER_RADIUS_PX / (ctx.scale || 1.5), 1.5);
  const pageNum = _stroke.pageNum;

  const hits = new Set();
  for (let i = 0; i < doc.annotations.length; i++) {
    const ann = doc.annotations[i];
    if (ann.type !== 'draw') continue; // ink only — never other types
    if (ann.page !== pageNum) continue;
    if (ann.locked) continue;
    // Half the stroke width counts too, so touching the visible line erases.
    // NOTE: like findAnnotationAt's 'draw' case, the raw path is tested
    // (rotation-parity with the existing selection hit-test).
    const tol = baseTol + (ann.lineWidth || 2) / 2;
    if (!eraserHitsPath(x0, y0, x1, y1, ann.path, tol)) continue;

    _stroke.items.push({
      annotation: cloneAnnotation(ann),
      // Index in the pre-stroke array: undo re-inserts ascending by index,
      // which reconstructs the original order only with ORIGINAL indices
      // (post-removal indices would scramble multi-hit strokes).
      index: _stroke.origIndex.get(ann) ?? i,
    });
    hits.add(ann);
  }
  if (hits.size === 0) return;
  // REASSIGN (not splice) like the keyboard delete flow — panels observe the
  // array reference.
  doc.annotations = doc.annotations.filter(a => !hits.has(a));
  if (doc.selectedAnnotations?.some(a => hits.has(a))) {
    doc.selectedAnnotations = doc.selectedAnnotations.filter(a => !hits.has(a));
  }
  ctx.redraw();
}

function _commitStroke(ctx) {
  if (!_stroke) return;
  const items = _stroke.items;
  _stroke = null;
  if (items.length === 0) return;
  // Same command shape as recordBulkDelete — but with pre-stroke indices,
  // recorded AFTER the live removal (execute() only records; it re-applies
  // on redo, which is a no-op-safe id-based splice).
  execute({ type: 'bulkDelete', items });
  // Refresh the doc-info panel (annotation totals) the same way the keyboard
  // delete flow does after removing annotations.
  if (ctx?.hideProperties) ctx.hideProperties();
}

export const eraserTool = {
  name: 'eraser',
  cursor: 'crosshair', // actual circle cursor comes from ui/cursor.js

  onPointerDown(ctx, e) {
    if (e.button !== 0) return;
    if (ctx.isPdfAReadOnly && ctx.isPdfAReadOnly()) return;
    const doc = getActiveDocument();
    if (!doc) return;

    _stroke = {
      pageNum: ctx.pageNum,
      lastX: ctx.x,
      lastY: ctx.y,
      items: [],
      origIndex: new Map(doc.annotations.map((a, i) => [a, i])),
    };
    // A click without movement erases at the down-point too.
    _eraseHitsAt(ctx, ctx.x, ctx.y, ctx.x, ctx.y);
  },

  onPointerMove(ctx, e) {
    if (!_stroke) return;
    if (e.buttons === 0) { _commitStroke(ctx); return; }
    // Continuous mode: crossing onto another page restarts the sweep segment
    // there instead of sweeping "through" the gap between pages.
    if (ctx.pageNum !== _stroke.pageNum) {
      _stroke.pageNum = ctx.pageNum;
      _stroke.lastX = ctx.x;
      _stroke.lastY = ctx.y;
    }
    _eraseHitsAt(ctx, _stroke.lastX, _stroke.lastY, ctx.x, ctx.y);
    if (_stroke) {
      _stroke.lastX = ctx.x;
      _stroke.lastY = ctx.y;
    }
  },

  onPointerUp(ctx, e) {
    if (!_stroke) return false;
    _commitStroke(ctx);
    return true;
  },

  onDeactivate() {
    _commitStroke();
  },
};
