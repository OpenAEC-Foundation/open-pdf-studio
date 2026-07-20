/**
 * Viewport tool — draw a rectangular region with its own scale.
 * Creates a 'viewport' annotation (separate type from scaleBar).
 * Uses the standard shape preview pipeline via buildAnnotationProps('viewport').
 */
import { getActiveDocument } from '../../core/state.js';
import { createAnnotation } from '../../annotations/factory.js';
import { redrawAnnotations, redrawContinuous } from '../../annotations/rendering.js';
import { openDialog } from '../../bridge.js';

function redraw() {
  const doc = getActiveDocument();
  if (doc?.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

export const viewportTool = {
  name: 'viewport',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    if (e.button !== 0) return;
    ctx.state.isDrawing = true;
  },

  onPointerMove(ctx, e) {
    const { x, y, state } = ctx;
    if (!state.isDrawing) return;
    ctx.drawShapePreview(x, y, e);
  },

  onPointerUp(ctx, e) {
    const { state } = ctx;
    if (!state.isDrawing) return false;
    state.isDrawing = false;

    const x1 = Math.min(state.startX, ctx.x);
    const y1 = Math.min(state.startY, ctx.y);
    const w = Math.abs(ctx.x - state.startX);
    const h = Math.abs(ctx.y - state.startY);

    if (w < 20 || h < 20) {
      ctx.redraw();
      return false;
    }

    const doc = getActiveDocument();
    if (!doc) return false;
    const pageNum = doc.currentPage || 1;

    // Create viewport annotation immediately (visible while dialog is open)
    const ann = createAnnotation({
      type: 'viewport',
      page: pageNum,
      x: x1,
      y: y1,
      width: w,
      height: h,
      name: 'Viewport',
      scaleRatio: '1:100',
      pixelsPerUnit: 72 / (25.4 * 100),
      unit: 'mm',
      color: '#0066cc',
      lineWidth: 1.5,
      opacity: 0.6,
    });

    doc.annotations.push(ann);
    // Don't recordAdd yet — dialog will record on Apply, or remove on Cancel
    redraw();

    // Open dialog to set scale
    openDialog('viewport-scale', { annotationId: ann.id, pageNum, isNew: true });

    // Auto-reset to select tool
    import("../../tools/manager.js").then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());

    return true;
  },

  onDeactivate() {},
};
