import { getActiveDocument } from '../../core/state.js';
import { selectTool } from './select-tool.js';
import { setTool } from '../manager.js';
import { verwerkSlotKlik } from '../../annotations/stramien-slot.js';

/**
 * Hand tool — pan; on hover of an annotation, show pointer cursor;
 * on click of an annotation, auto-switch to Select tool and delegate the
 * click so the user gets selection + drag in a single click.
 */
export const handTool = {
  name: 'hand',
  cursor: 'grab',

  onPointerDown(ctx, e) {
    const { x, y, state } = ctx;
    const doc = getActiveDocument();
    const selAnns = doc ? doc.selectedAnnotations : [];

    // Resize handle on selected annotation
    const selAnn = selAnns.length === 1 ? selAnns[0] : null;
    if (selAnn) {
      const handleType = ctx.findHandleAt(x, y, selAnn);
      // Stramienslotje: omzetten in plaats van slepen (zelfde als select-tool).
      if (handleType && !ctx.isPdfAReadOnly() && verwerkSlotKlik(selAnn, handleType)) {
        ctx.redraw();
        return;
      }
      if (handleType) {
        state.isResizing = true;
        state.activeHandle = handleType;
        state.dragStartX = x;
        state.dragStartY = y;
        state.originalAnnotation = ctx.cloneAnnotation(selAnn);
        return;
      }
    }

    const clickedAnnotation = ctx.findAnnotationAt(x, y);
    if (clickedAnnotation) {
      // Switch to Select tool synchronously, then delegate this same click
      // to select-tool so the user gets selection + drag in one click.
      setTool('select');
      // Reset state flags that hand-tool may have set (panning) so select-tool
      // starts with a clean slate.
      state.isPanning = false;
      state.isMiddleButtonPanning = false;
      selectTool.onPointerDown(ctx, e);
      return;
    }

    // No annotation under cursor → start panning
    ctx.clearSelection();
    ctx.hideProperties();
    if (ctx.viewMode === 'continuous') {
      ctx.startContinuousPan(e, false);
    } else {
      ctx.startPan(e, false);
    }
    ctx.redraw();
  },

  // SINGLE onPointerMove: hover detection drives the cursor.
  // If cursor is over an annotation → 'pointer' to indicate it's clickable
  //   (and clicking will auto-switch to Select).
  // Else → 'grab' (pan affordance).
  onPointerMove(ctx, e) {
    const { x, y, state, canvas } = ctx;
    if (!canvas) return;

    // Update hover state for the cursor system in js/ui/cursor.js
    const doc = getActiveDocument();
    const selAnns = doc ? doc.selectedAnnotations : [];
    const selAnn = selAnns.length === 1 ? selAnns[0] : null;
    let hoverHandle = null;
    if (selAnn) {
      hoverHandle = ctx.findHandleAt(x, y, selAnn);
    }
    state.hoverHandle = hoverHandle;
    if (hoverHandle) {
      state.hoverAnnotation = null;
      canvas.title = '';
      // Cursor is set by the cursor system based on hoverHandle
      return;
    }
    const hoverAnnotation = ctx.findAnnotationAt(x, y);
    state.hoverAnnotation = hoverAnnotation || null;
    canvas.title = (hoverAnnotation?.type === 'comment' && !hoverAnnotation.popupOpen && hoverAnnotation.text)
      ? hoverAnnotation.text.split('\n').slice(0, 5).join('\n') : '';
    // Direct cursor override: pointer over an annotation, grab otherwise.
    // Set on ALL annotation canvases (continuous mode) and the container.
    if (!state.isPanning && !state.isDragging && !state.isResizing) {
      const cur = hoverAnnotation ? 'pointer' : 'grab';
      canvas.style.cursor = cur;
      try {
        document.querySelectorAll('.annotation-canvas, #annotation-canvas').forEach(c => { c.style.cursor = cur; });
      } catch (_) {}
    }
  },
};
