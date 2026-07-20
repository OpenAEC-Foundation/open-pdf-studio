/**
 * Scale Region tool — two-click placement.
 *
 * Click 1: top-left corner. Click 2: bottom-right corner. Between the two,
 * a live dashed-orange rectangle is drawn from P1 to the cursor. Esc or
 * right-click cancels.
 *
 * After the second click, opens the scale-region dialog so the user can pick
 * the scale ratio + units.
 */
import { state, getActiveDocument } from '../../core/state.js';
import { createScaleRegion, invalidateScaleRegionCache } from '../../annotations/scale-region.js';
import { redrawAnnotations, redrawContinuous } from '../../annotations/rendering.js';
import { annotationCtx } from '../../ui/dom-elements.js';
import { openDialog } from '../../bridge.js';

function redraw() {
  const doc = getActiveDocument();
  if (doc?.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

// Module-level placement state — survives across pointer events.
const _placement = { firstX: null, firstY: null };

function _reset() {
  _placement.firstX = _placement.firstY = null;
}

// Draw the orange dashed preview rectangle in app coordinates.
function _drawPreview(curX, curY) {
  if (_placement.firstX === null || !annotationCtx) return;
  redraw();
  const vp = window.__pdfViewport;
  const doc = getActiveDocument();
  const ctx = annotationCtx;
  ctx.save();
  if (vp && vp.active) {
    ctx.setTransform(vp.zoom, 0, 0, vp.zoom, vp.offsetX, vp.offsetY);
  } else {
    const scale = doc?.scale || 1.5;
    ctx.scale(scale, scale);
  }
  const x1 = Math.min(_placement.firstX, curX);
  const y1 = Math.min(_placement.firstY, curY);
  const w = Math.abs(curX - _placement.firstX);
  const h = Math.abs(curY - _placement.firstY);
  ctx.strokeStyle = '#ff9800';
  ctx.fillStyle = 'rgba(255, 152, 0, 0.10)';
  ctx.lineWidth = 1.5 / (vp?.zoom || doc?.scale || 1.5);
  ctx.setLineDash([6 / (vp?.zoom || 1), 4 / (vp?.zoom || 1)]);
  ctx.fillRect(x1, y1, w, h);
  ctx.strokeRect(x1, y1, w, h);
  ctx.restore();
}

export const scaleRegionTool = {
  name: 'scaleRegion',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    // Right-click cancels in-progress placement.
    if (e.button === 2) {
      if (_placement.firstX !== null) {
        _reset();
        ctx.redraw();
        e.preventDefault?.();
      }
      return;
    }
    if (e.button !== 0) return;

    if (_placement.firstX === null) {
      _placement.firstX = ctx.x;
      _placement.firstY = ctx.y;
      _drawPreview(ctx.x, ctx.y);
      return;
    }

    // Second click — finalise.
    const x1 = Math.min(_placement.firstX, ctx.x);
    const y1 = Math.min(_placement.firstY, ctx.y);
    const w = Math.abs(ctx.x - _placement.firstX);
    const h = Math.abs(ctx.y - _placement.firstY);
    _reset();
    ctx.redraw();

    if (w < 20 || h < 20) return;

    const doc = getActiveDocument();
    if (!doc) return;
    const pageNum = doc.currentPage || 1;

    const ann = createScaleRegion({
      page: pageNum,
      x: x1, y: y1, width: w, height: h,
      scaleString: '1:100',
      units: 'mm',
      label: '',
    });

    doc.annotations.push(ann);
    invalidateScaleRegionCache();
    redraw();

    openDialog('scale-region', { annotationId: ann.id, pageNum, isNew: true });

    import('../../tools/manager.js').then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());
  },

  onPointerMove(ctx) {
    if (_placement.firstX === null) return;
    _drawPreview(ctx.x, ctx.y);
  },

  // Escape (GitHub #273): zelfde annulering als rechtermuisklik — lopende
  // plaatsing weggooien. De keyboard-handler schakelt daarna naar de
  // selectietool.
  onEscape(ctx) {
    if (_placement.firstX === null) return false;
    _reset();
    ctx.redraw();
    return true;
  },

  onDeactivate() {
    _reset();
  },
};
