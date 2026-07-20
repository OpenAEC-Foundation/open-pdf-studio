import { state, getActiveDocument } from '../../core/state.js';
import { lineLineIntersection } from '../../annotations/geometry.js';
import { cloneAnnotation } from '../../annotations/factory.js';
import { recordModify, beginUndoTransaction, endUndoTransaction } from '../../core/undo-manager.js';
import { redrawAnnotations } from '../../annotations/rendering.js';

const _trimState = { cuttingEdge: null };

function getLineEndpoints(ann) {
  if (ann.startX !== undefined && ann.endX !== undefined) {
    return { p1: { x: ann.startX, y: ann.startY }, p2: { x: ann.endX, y: ann.endY } };
  }
  return null;
}

export const trimTool = {
  name: 'trim',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    const { x, y } = ctx;
    const clicked = ctx.findAnnotationAt(x, y);
    if (!clicked) return;
    const endpoints = getLineEndpoints(clicked);
    if (!endpoints) return;

    if (!_trimState.cuttingEdge) {
      _trimState.cuttingEdge = clicked;
      const doc = getActiveDocument();
      if (doc) { doc.selectedAnnotations = [clicked]; doc.selectedAnnotation = clicked; }
      redrawAnnotations();
      return;
    }

    const target = clicked;
    if (target === _trimState.cuttingEdge) { _trimState.cuttingEdge = null; return; }

    const targetPts = getLineEndpoints(target);
    const cutterPts = getLineEndpoints(_trimState.cuttingEdge);
    if (!targetPts || !cutterPts) { _trimState.cuttingEdge = null; return; }

    const ix = lineLineIntersection(targetPts.p1, targetPts.p2, cutterPts.p1, cutterPts.p2);
    if (!ix) { _trimState.cuttingEdge = null; return; }

    const distToStart = Math.hypot(x - target.startX, y - target.startY);
    const distToEnd = Math.hypot(x - target.endX, y - target.endY);

    const oldState = cloneAnnotation(target);

    // AutoCAD-style "make corner" — bring BOTH lines together so they share
    // the intersection point. For each line the endpoint nearest the user's
    // click is moved to the intersection (works whether the intersection is
    // inside the segment, requiring a cut, or outside, requiring an extend).
    const cutter = _trimState.cuttingEdge;
    const oldCutter = cloneAnnotation(cutter);

    // Move target's nearest endpoint to ix
    if (distToStart < distToEnd) {
      target.startX = ix.x; target.startY = ix.y;
    } else {
      target.endX = ix.x; target.endY = ix.y;
    }

    // Move cutter's nearest endpoint to ix as well (so the two lines meet).
    // We use the second click's coords (x,y) as the "near" reference for the
    // cutter too, since the user picked which side to keep on both lines with
    // a single click — the side furthest from intersection on the cutter is
    // the one to drop. With one click on the target we approximate by using
    // the cutter's endpoint nearest the second click.
    const cDistToStart = Math.hypot(x - cutter.startX, y - cutter.startY);
    const cDistToEnd = Math.hypot(x - cutter.endX, y - cutter.endY);
    if (cDistToStart < cDistToEnd) {
      cutter.startX = ix.x; cutter.startY = ix.y;
    } else {
      cutter.endX = ix.x; cutter.endY = ix.y;
    }

    target.modifiedAt = new Date().toISOString();
    cutter.modifiedAt = new Date().toISOString();
    beginUndoTransaction();
    recordModify(target.id, oldState, target);
    recordModify(cutter.id, oldCutter, cutter);
    endUndoTransaction();
    redrawAnnotations();
    _trimState.cuttingEdge = null;
    import("../../tools/manager.js").then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());
  },

  onDeactivate() { _trimState.cuttingEdge = null; },
};
