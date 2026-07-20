import { state, getActiveDocument } from '../core/state.js';
import { resolvePointerCoords, buildToolContext, isModalOpen, applyToolTransform, getEffectiveScale } from './tool-context.js';
import { getTool } from './tool-registry.js';
import { cloneAnnotation } from '../annotations/factory.js';
import { applyResize, applyMove, applyRotation } from '../annotations/transforms.js';
import { redrawAnnotations, redrawContinuous, snapToGrid } from '../annotations/rendering.js';
import { showProperties, showMultiSelectionProperties } from '../ui/panels/properties-panel.js';
import { startTextEditing, finishTextEditing } from './text-editing.js';
import { openStickyPopup } from '../bridge.js';
import { findAnnotationAt } from '../annotations/geometry.js';
import { startPan, startContinuousPan, handlePanEnd, handleMiddleButtonPanEnd } from './pan-handler.js';
import { performSnap, drawSnapIndicator, drawAlignmentGuides, setPolarAnchor, clearPolarAnchor } from './snap-engine.js';
import { collectImageAlignRefs, snapImageMove, snapImageResize, drawImageAlignGuides } from './image-align-snap.js';
import {
  recordAdd,
  recordModify,
  recordBulkModify,
  recordBulkAdd,
  recordMeasureScale,
  beginUndoTransaction,
  endUndoTransaction,
} from '../core/undo-manager.js';
import { cloneForInsert } from './edit-ops.js';
import { markDocumentModified } from '../ui/chrome/tabs.js';
import { isPdfAReadOnly } from '../pdf/loader.js';
import { setTypeLengthCursorScreen } from './type-length-input.js';
import { getAnnotationType } from '../plugins/annotation-type-registry.js';
import { hideMenu } from '../bridge.js';
import { syncDocScale } from '../annotations/scale-bar.js';
import { recalculateAllMeasurements } from '../annotations/measurement.js';

function redraw() {
  if (getActiveDocument()?.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

/**
 * Main pointer-down handler (replaces handleMouseDown + handleContinuousMouseDown)
 */
export function handlePointerDown(e) {
  if (!getActiveDocument()?.pdfDoc) return;
  if (isModalOpen()) return;

  // Dismiss context menu on any canvas click (left or right)
  hideMenu();

  // Reclaim focus from a non-canvas text input (assistant chat, a properties
  // field, the OpenAEC controls, etc.) when the user clicks the page. Without
  // this the keydown lands on that input and handleKeydown's "typing in an
  // input" guard silently swallows Ctrl+Z / Ctrl+C / Ctrl+V for annotations.
  const _ae = document.activeElement;
  if (_ae && typeof _ae.matches === 'function'
      && _ae.matches('input, textarea')
      && !_ae.classList.contains('inline-text-editor')) {
    _ae.blur();
  }

  // Safety: reset stuck drag/resize state
  if (state.isDragging || state.isResizing) {
    console.warn('[dispatcher] pointerdown with stuck state — resetting');
    state.isDragging = false;
    state.isResizing = false;
    state.activeHandle = null;
    state.originalAnnotation = null;
    state.originalAnnotations = [];
    state._ctrlDragCopy = false;
    state._ctrlCopiesCreated = false;
  }

  // Finish inline text editing. A left-click while editing is the user
  // clicking AWAY to commit the text — consume that click so the SAME gesture
  // doesn't also place a brand-new textbox/shape (the old behaviour dropped a
  // fresh textbox every time you clicked away, so editing never "ended").
  // Middle/right buttons fall through so panning and the 2D-cursor gesture
  // keep working while a textbox is open.
  if (state.isEditingText) {
    finishTextEditing();
    if (e.button === 0) return;
  }

  const coords = resolvePointerCoords(e);
  const ctx = buildToolContext(e, coords);

  // Object snap start point, fall back to grid
  const doc = getActiveDocument();
  const scale = doc?.scale || 1.5;
  const startSnap = performSnap(coords.x, coords.y, doc?.annotations || [], coords.pageNum, scale);
  state.startX = startSnap.snapped ? startSnap.x : snapToGrid(coords.x);
  state.startY = startSnap.snapped ? startSnap.y : snapToGrid(coords.y);
  state.lastSnapResult = startSnap.snapped ? startSnap : null;
  // Polar tracking: anchor at the drag-start point so subsequent moves can
  // engage the polar pass. Cleared in _finishDrawing / Escape.
  setPolarAnchor(state.startX, state.startY, coords.pageNum);
  state.dragStartX = coords.x;
  state.dragStartY = coords.y;
  state._dragExitedDeadzone = false;

  // Set continuous mode context
  if (getActiveDocument()?.viewMode === 'continuous') {
    state.activeContinuousCanvas = coords.canvas;
    state.activeContinuousPage = coords.pageNum;
    const __doc = getActiveDocument();
    if (__doc) __doc.currentPage = coords.pageNum;
  }

  // Middle mouse button: panning (works regardless of tool)
  if (e.button === 1) {
    if (getActiveDocument()?.viewMode === 'continuous') startContinuousPan(e, true);
    else startPan(e, true);
    return;
  }

  // Blender-style 2D cursor: Shift+RIGHT-click places (or moves) it —
  // regardless of the active tool. Hidden until first placed; drawn in the
  // overlay pass (rendering.js) and exposed as a snap point (snap-engine).
  // While the right button stays down the cursor FOLLOWS the pointer
  // (drag-to-place); release fixes it.
  if (e.button === 2 && e.shiftKey) {
    e.preventDefault();
    e.stopPropagation();
    if (doc) {
      doc.cursor2D = {
        page: coords.pageNum || doc.currentPage || 1,
        x: state.startX,   // snapped position (object snap ran above)
        y: state.startY,
      };
    }
    state._cursor2DDragging = true;
    state._suppressNextContextmenu = true;
    redraw();
    return;
  }

  // Look up current tool
  const tool = getTool(state.currentTool);
  if (!tool) {
    // Fallback: check plugin registry for non-click drawModes
    const typeHandler = getAnnotationType(state.currentTool);
    if (typeHandler?.drawMode === 'click') {
      const clickTool = getTool('_plugin_click');
      if (clickTool) clickTool.onPointerDown(ctx, e);
    } else if (typeHandler?.drawMode === 'polyline') {
      // Polyline-mode plugin: delegate to native polyline-tool;
      // plugin's typeHandler.create() is invoked from _finishPolyline (see patch in polyline-tool.js).
      const polyTool = getTool('polyline');
      if (polyTool) polyTool.onPointerDown(ctx, e);
    } else if (typeHandler) {
      // Drag-mode plugin: use shape tool behavior
      const shapeTool = getTool('box'); // shape tool handles all drag-to-create
      if (shapeTool) shapeTool.onPointerDown(ctx, e);
    }
    return;
  }

  // Block annotation tools when PDF/A read-only
  if (isPdfAReadOnly() && !['hand', 'select', 'editText'].includes(state.currentTool)) {
    return;
  }

  // Right-click: delegate to tool (for polyline/measurement finish)
  // or handle dimension/polyline/cloudPolyline cancellation
  if (e.button === 2) {
    if (tool.onPointerDown) tool.onPointerDown(ctx, e);
    return;
  }

  // Capture pointer for reliable event delivery
  if (coords.canvas && e.pointerId !== undefined) {
    try { coords.canvas.setPointerCapture(e.pointerId); } catch (_) {}
  }

  if (tool.onPointerDown) tool.onPointerDown(ctx, e);
}

/**
 * Main pointer-move handler (replaces handleMouseMove + handleContinuousMouseMove)
 */
export function handlePointerMove(e) {
  if (!getActiveDocument()?.pdfDoc) return;
  if (isModalOpen()) return;
  if (state.isPanning) return;

  const coords = resolvePointerCoords(e);
  const ctx = buildToolContext(e, coords);

  // 2D-cursor drag: while Shift+right stays down the cursor follows the
  // pointer (object-snapped); release ends the drag.
  if (state._cursor2DDragging) {
    const doc2d = getActiveDocument();
    if (doc2d?.cursor2D) {
      const snap2d = performSnap(coords.x, coords.y, doc2d.annotations || [], coords.pageNum, doc2d.scale || 1.5);
      doc2d.cursor2D = {
        page: coords.pageNum || doc2d.currentPage || 1,
        x: snap2d.snapped ? snap2d.x : coords.x,
        y: snap2d.snapped ? snap2d.y : coords.y,
      };
      redraw();
    }
    return;
  }

  // Track screen-space cursor for the TypeLengthHUD overlay
  setTypeLengthCursorScreen(e.clientX, e.clientY);

  // Handle resizing (shared across hand/select tools)
  if (state.isResizing && state.activeHandle) {
    _handleResize(ctx, e, coords);
    return;
  }

  // Handle dragging/moving (shared across hand/select tools)
  const _dragDoc = getActiveDocument();
  if (state.isDragging && _dragDoc && _dragDoc.selectedAnnotations.length > 0) {
    _handleDrag(ctx, e, coords);
    return;
  }

  // Delegate to the active tool
  const tool = getTool(state.currentTool);
  if (tool && tool.onPointerMove) {
    tool.onPointerMove(ctx, e);
  } else {
    // Plugin tool fallback: drag/polyline-mode preview
    const typeHandler = getAnnotationType(state.currentTool);
    if (typeHandler?.drawMode === 'polyline') {
      const polyTool = getTool('polyline');
      if (polyTool && polyTool.onPointerMove) polyTool.onPointerMove(ctx, e);
    } else if (typeHandler) {
      const shapeTool = getTool('box');
      if (shapeTool && shapeTool.onPointerMove) shapeTool.onPointerMove(ctx, e);
    }
  }
}

/**
 * Main pointer-up handler (replaces handleMouseUp + handleContinuousMouseUp)
 */
export function handlePointerUp(e) {
  if (!getActiveDocument()?.pdfDoc) return;
  if (isModalOpen()) return;
  // End the 2D-cursor drag on right-button release.
  if (state._cursor2DDragging && (e.button === 2 || e.buttons === 0)) {
    state._cursor2DDragging = false;
    state._suppressNextContextmenu = true;
    return;
  }
  if (state.isPanning) {
    // End the pan — pointer capture may prevent document-level listeners from firing
    if (state.isMiddleButtonPanning) {
      handleMiddleButtonPanEnd(e);
    } else {
      handlePanEnd(e);
    }
    return;
  }

  const coords = resolvePointerCoords(e);
  const ctx = buildToolContext(e, coords);

  // Handle end of drag/resize (shared logic)
  if (state.isDragging || state.isResizing) {
    _finishDragResize(ctx, e, coords);
    return;
  }

  // Delegate to the active tool
  const tool = getTool(state.currentTool);
  if (tool && tool.onPointerUp) {
    const handled = tool.onPointerUp(ctx, e);
    if (handled) return;
  } else {
    // Plugin tool fallback: shape tool up
    const typeHandler = getAnnotationType(state.currentTool);
    if (typeHandler?.drawMode === 'polyline') {
      // Polyline-mode plugin: pointer-up is a no-op (placement is click-driven,
      // finish happens on right-click / double-click in polyline-tool itself).
      return;
    }
    if (typeHandler && typeHandler.drawMode !== 'click') {
      const shapeTool = getTool('box');
      if (shapeTool && shapeTool.onPointerUp) shapeTool.onPointerUp(ctx, e);
      return;
    }
  }

  // Generic drawing tool up (for tools that set isDrawing=true and haven't handled up)
  if (state.isDrawing) {
    _finishDrawing(ctx, e, coords);
  }
}

/**
 * Double-click handler (replaces handleDblClick + handleContinuousDblClick)
 */
export function handleDblClick(e) {
  if (!getActiveDocument()?.pdfDoc) return;
  if (isModalOpen()) return;
  if (isPdfAReadOnly()) return;

  const coords = resolvePointerCoords(e);
  if (!coords.canvas) return;

  // Set correct page for continuous mode
  if (getActiveDocument()?.viewMode === 'continuous') {
    const dblClickDoc = getActiveDocument();
    if (dblClickDoc) dblClickDoc.currentPage = coords.pageNum;
  }

  // Delegate to current tool first — multi-click tools (polyline, spline, arc,
  // measureArea, ...) listen for `e.detail === 2` to finish a shape. PointerDown
  // events have detail=0 in Chromium so without this delegation a real
  // dblclick never finalises the in-progress geometry.
  const activeTool = state.currentTool && getTool(state.currentTool);
  if (activeTool && typeof activeTool.onPointerDown === 'function') {
    const synth = { detail: 2, button: 0, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, clientX: e.clientX, clientY: e.clientY, target: e.target, preventDefault: ()=>e.preventDefault?.(), stopPropagation: ()=>e.stopPropagation?.() };
    const ctx = buildToolContext(synth, coords);
    if (ctx) {
      try { activeTool.onPointerDown(ctx, synth); } catch(err) { console.error('[dispatcher] tool dblclick delegation error', err); }
    }
  }

  const clicked = findAnnotationAt(coords.x, coords.y);
  if (clicked) {
    const dblDoc = getActiveDocument();
    if (['textbox', 'callout'].includes(clicked.type)) {
      state.isDrawing = false;
      if (dblDoc) { dblDoc.selectedAnnotations = [clicked]; dblDoc.selectedAnnotation = clicked; }
      showProperties(clicked);
      startTextEditing(clicked);
    } else if (clicked.type === 'comment') {
      state.isDrawing = false;
      if (dblDoc) { dblDoc.selectedAnnotations = [clicked]; dblDoc.selectedAnnotation = clicked; }
      showProperties(clicked);
      openStickyPopup(clicked);
    } else if (clicked.type === 'stamp' && clicked.stampSvgBuilder) {
      state.isDrawing = false;
      if (dblDoc) { dblDoc.selectedAnnotations = [clicked]; dblDoc.selectedAnnotation = clicked; }
      import('../bridge.js').then(m => {
        m.openDialog('title-block-edit', {
          annotation: clicked,
          rebuildAndUpdate: async (ann) => {
            const { updateStampImage } = await import('../annotations/stamps.js');
            const fields = {};
            for (const key of Object.keys(ann)) {
              if (key.startsWith('tb')) fields[key] = ann[key];
            }
            if (typeof ann.stampSvgBuilder === 'function') {
              await updateStampImage(ann, ann.stampSvgBuilder(fields));
            }
          }
        });
      });
    }
  }
}

// --- Shared drag/resize/drawing logic ---

function _handleResize(ctx, e, coords) {
  const _resDoc = getActiveDocument();
  const _selAnns = _resDoc ? _resDoc.selectedAnnotations : [];
  const ann = _selAnns.length === 1 ? _selAnns[0] : null;
  if (!ann || !state.originalAnnotation) return;
  const canvasCtx = coords.canvasCtx;

  if (state.activeHandle === 'rotate') {
    Object.assign(ann, cloneAnnotation(state.originalAnnotation));
    state.shiftKeyPressed = e.shiftKey;
    applyRotation(ann, coords.x, coords.y, state.originalAnnotation);
    redraw();
    return;
  }

  // Snap cursor position during resize.
  // Exception: the 8 box-resize handles (corners + edges) of a text box or
  // callout must NOT object-snap. On content-dense drawings object snap
  // (enableObjectSnap + snapToPdfContent, both on by default) pins the dragged
  // edge onto nearby PDF/annotation geometry, so the height/width can't be
  // dragged freely past those points and the box appears "capped" at a certain
  // size (issue #284). Leader tip/knee handles keep snapping — a leader is
  // meant to point AT something.
  const resizeDoc = getActiveDocument();
  const resizeScale = getEffectiveScale();
  const RECT_RESIZE_HANDLES = ['tl', 'tr', 'bl', 'br', 't', 'b', 'l', 'r'];
  const skipResizeSnap = (ann.type === 'textbox' || ann.type === 'callout') &&
    RECT_RESIZE_HANDLES.includes(state.activeHandle);
  const snap = skipResizeSnap
    ? { snapped: false }
    : performSnap(coords.x, coords.y, resizeDoc?.annotations || [], coords.pageNum, resizeScale, ann.id);
  const snappedX = snap.snapped ? snap.x : coords.x;
  const snappedY = snap.snapped ? snap.y : coords.y;
  state.lastSnapResult = snap.snapped ? snap : null;

  let deltaX, deltaY;
  if (snap.snapped) {
    const orig = state.originalAnnotation;
    const h = state.activeHandle;
    let ox, oy;
    // Textbox leader tip/knee: pull origin from the matching leader on originalAnn
    if (typeof h === 'string' && (h.startsWith('leader_tip_') || h.startsWith('leader_knee_'))) {
      const isTipL = h.startsWith('leader_tip_');
      const lid = h.substring(isTipL ? 'leader_tip_'.length : 'leader_knee_'.length);
      const ldrs = Array.isArray(orig.leaders) ? orig.leaders : [];
      const found = ldrs.find(l => l.id === lid);
      if (found) {
        ox = isTipL ? found.tipX : found.kneeX;
        oy = isTipL ? found.tipY : found.kneeY;
      }
    } else
    if (typeof h === 'string' && h.startsWith('polyline_node_')) {
      // Check for hole node: polyline_node_hole_<holeIdx>_<nodeIdx>
      const holeSnapMatch = h.match(/^polyline_node_hole_(\d+)_(\d+)$/);
      if (holeSnapMatch && orig.holes) {
        const hi = parseInt(holeSnapMatch[1], 10);
        const ni = parseInt(holeSnapMatch[2], 10);
        if (hi < orig.holes.length && ni < orig.holes[hi].length) {
          ox = orig.holes[hi][ni].x;
          oy = orig.holes[hi][ni].y;
        }
      } else if (orig.points) {
        const nodeIdx = parseInt(h.split('_').pop(), 10);
        if (!isNaN(nodeIdx) && nodeIdx < orig.points.length) {
          ox = orig.points[nodeIdx].x;
          oy = orig.points[nodeIdx].y;
        }
      } else if (orig.type === 'measureAngle' && orig.point1 && orig.vertex && orig.point2) {
        const maNodeIdx = parseInt(h.split('_').pop(), 10);
        const maPts = [orig.point1, orig.vertex, orig.point2];
        if (!isNaN(maNodeIdx) && maNodeIdx < 3) {
          ox = maPts[maNodeIdx].x;
          oy = maPts[maNodeIdx].y;
        }
      }
    }
    // Label move handle
    if (h === 'label_move' && orig.points) {
      if (orig.labelX != null && orig.labelY != null) {
        ox = orig.labelX;
        oy = orig.labelY;
      } else {
        let clx = 0, cly = 0;
        for (const p of orig.points) { clx += p.x; cly += p.y; }
        ox = clx / orig.points.length;
        oy = cly / orig.points.length;
      }
    }
    // Label move on a dimension line (measureDistance text handle): anchor =
    // dimension-line midpoint + textOffset. Without this the generic x/width
    // fallback below would produce NaN (dimensions have no x/width).
    if (h === 'label_move' && ox === undefined
        && typeof orig.startX === 'number' && typeof orig.endX === 'number') {
      ox = (orig.startX + orig.endX) / 2 + (orig.textOffsetX || 0);
      oy = (orig.startY + orig.endY) / 2 + (orig.textOffsetY || 0);
    }
    if (ox === undefined) {
      ox = h === 'line_start' ? orig.startX
        : h === 'line_end' ? orig.endX
        : h === 'line_mid' ? (orig.startX + orig.endX) / 2
        : h === 'leader_start' ? orig.leaderStartX
        : h === 'leader_end' ? orig.leaderEndX
        : h === 'callout_arrow' ? (orig.arrowX || orig.x)
        : h === 'callout_knee' ? (orig.kneeX || orig.x)
        : h === 'circle_center' ? ((orig.x !== undefined ? orig.x : orig.centerX - (orig.radius || 0)) + (orig.width || (orig.radius || 0) * 2) / 2)
        : h === 'rect_center' ? (orig.x + (orig.width || 0) / 2)
        : (h === 'tl' || h === 'l' || h === 'bl') ? orig.x
        : (h === 'tr' || h === 'r' || h === 'br') ? orig.x + orig.width
        : orig.x + orig.width / 2;
      oy = h === 'line_start' ? orig.startY
        : h === 'line_end' ? orig.endY
        : h === 'line_mid' ? (orig.startY + orig.endY) / 2
        : h === 'leader_start' ? orig.leaderStartY
        : h === 'leader_end' ? orig.leaderEndY
        : h === 'callout_arrow' ? (orig.arrowY || orig.y)
        : h === 'callout_knee' ? (orig.kneeY || orig.y)
        : h === 'circle_center' ? ((orig.y !== undefined ? orig.y : orig.centerY - (orig.radius || 0)) + (orig.height || (orig.radius || 0) * 2) / 2)
        : h === 'rect_center' ? (orig.y + (orig.height || 0) / 2)
        : (h === 'tl' || h === 't' || h === 'tr') ? orig.y
        : (h === 'bl' || h === 'b' || h === 'br') ? orig.y + orig.height
        : orig.y + orig.height / 2;
    }
    deltaX = snappedX - ox;
    deltaY = snappedY - oy;
  } else {
    deltaX = coords.x - state.dragStartX;
    deltaY = coords.y - state.dragStartY;
  }

  Object.assign(ann, cloneAnnotation(state.originalAnnotation));
  applyResize(ann, state.activeHandle, deltaX, deltaY, state.originalAnnotation, e.shiftKey, e.ctrlKey);

  // Image "equal width/height" snapping: after the resize is applied, snap the
  // resulting width/height to another image's width/height within tolerance.
  // Only the box-style side/corner handles change size, so guard on those.
  // When the aspect ratio is locked (images do this by default), snapImageResize
  // snaps a single axis and derives the other from the ratio, so the lock is
  // preserved — hence we no longer skip locked images here. Shift is a caller
  // override that we keep respecting via lockRatio below.
  state._imageAlignGuides = null;
  const _rh = state.activeHandle;
  const _isBoxHandle = _rh === 'tl' || _rh === 'tr' || _rh === 'bl' || _rh === 'br' ||
    _rh === 't' || _rh === 'b' || _rh === 'l' || _rh === 'r';
  const _lockRatio = e.shiftKey || ann.lockAspectRatio;
  if (state.preferences.enableImageAlignSnap && ann.type === 'image' && _isBoxHandle) {
    const excludeIds = new Set([ann.id]);
    const refs = collectImageAlignRefs(resizeDoc?.annotations || [], coords.pageNum, excludeIds);
    const tol = (state.preferences.objectSnapRadius || 12) / resizeScale;
    const box = { x: ann.x, y: ann.y, w: ann.width, h: ann.height };
    const _aspectRatio = state.originalAnnotation.originalWidth && state.originalAnnotation.originalHeight
      ? state.originalAnnotation.originalWidth / state.originalAnnotation.originalHeight
      : (state.originalAnnotation.height ? state.originalAnnotation.width / state.originalAnnotation.height : 1);
    const res = snapImageResize(box, _rh, refs, tol, { lockRatio: _lockRatio, aspectRatio: _aspectRatio });
    if (res.guides.length > 0) {
      ann.x = res.box.x; ann.y = res.box.y;
      ann.width = res.box.w; ann.height = res.box.h;
      state._imageAlignGuides = res.guides;
      state._imageAlignGuidesPage = coords.pageNum;
    }
  }

  redraw();

  if (state.lastSnapResult) {
    canvasCtx.save();
    applyToolTransform(canvasCtx);
    drawSnapIndicator(canvasCtx, state.lastSnapResult, resizeScale);
    canvasCtx.restore();
  }

  if (state._imageAlignGuides) {
    canvasCtx.save();
    applyToolTransform(canvasCtx);
    drawImageAlignGuides(canvasCtx, state._imageAlignGuides, resizeScale);
    canvasCtx.restore();
  }

  // ─── Grip-stretch tracking line + tooltip ──────────────────────────────
  // While dragging any grip-style handle, draw a 1 px dashed line from the
  // grip's original location (basePoint) to the current cursor position
  // (livePoint), plus a small "<length> < <angle>°" tooltip. Per the
  // grippoints design spec.
  {
    const orig = state.originalAnnotation;
    const h = state.activeHandle;
    let bx, by;
    if (typeof h === 'string' && h.startsWith('polyline_node_') && !h.includes('hole') && Array.isArray(orig.points)) {
      const ni = parseInt(h.split('_').pop(), 10);
      if (!isNaN(ni) && ni < orig.points.length) {
        bx = orig.points[ni].x; by = orig.points[ni].y;
      }
    } else if (h === 'line_start') { bx = orig.startX; by = orig.startY; }
    else if (h === 'line_end') { bx = orig.endX; by = orig.endY; }
    else if (h === 'line_mid') { bx = (orig.startX + orig.endX) / 2; by = (orig.startY + orig.endY) / 2; }
    else if (h === 'rect_center') { bx = orig.x + (orig.width || 0) / 2; by = orig.y + (orig.height || 0) / 2; }
    else if (h === 'circle_center') {
      const cw = orig.width || (orig.radius || 0) * 2;
      const ch = orig.height || (orig.radius || 0) * 2;
      const cx0 = orig.x !== undefined ? orig.x : (orig.centerX - (orig.radius || 0));
      const cy0 = orig.y !== undefined ? orig.y : (orig.centerY - (orig.radius || 0));
      bx = cx0 + cw / 2; by = cy0 + ch / 2;
    } else if (h === 'tl') { bx = orig.x; by = orig.y; }
    else if (h === 'tr') { bx = orig.x + orig.width; by = orig.y; }
    else if (h === 'bl') { bx = orig.x; by = orig.y + orig.height; }
    else if (h === 'br') { bx = orig.x + orig.width; by = orig.y + orig.height; }
    else if (h === 't') { bx = orig.x + orig.width / 2; by = orig.y; }
    else if (h === 'b') { bx = orig.x + orig.width / 2; by = orig.y + orig.height; }
    else if (h === 'l') { bx = orig.x; by = orig.y + orig.height / 2; }
    else if (h === 'r') { bx = orig.x + orig.width; by = orig.y + orig.height / 2; }

    if (bx !== undefined && by !== undefined) {
      const lx = state.lastSnapResult ? state.lastSnapResult.x : coords.x;
      const ly = state.lastSnapResult ? state.lastSnapResult.y : coords.y;
      const lineColor = ann.strokeColor || ann.color || ann.lineColor || '#0078d4';
      canvasCtx.save();
      applyToolTransform(canvasCtx);
      canvasCtx.strokeStyle = lineColor;
      canvasCtx.lineWidth = 1 / resizeScale;
      canvasCtx.setLineDash([4 / resizeScale, 4 / resizeScale]);
      canvasCtx.beginPath();
      canvasCtx.moveTo(bx, by);
      canvasCtx.lineTo(lx, ly);
      canvasCtx.stroke();
      canvasCtx.setLineDash([]);
      // Tooltip text "<length> < <angle>°" near cursor
      const dxT = lx - bx, dyT = ly - by;
      const len = Math.sqrt(dxT * dxT + dyT * dyT);
      const ang = Math.atan2(dyT, dxT) * 180 / Math.PI;
      const measureScale = (getActiveDocument()?.measureScale) || 1;
      const measureUnit = (getActiveDocument()?.measureUnit) || 'px';
      const lenLabel = (len * measureScale).toFixed(1) + ' ' + measureUnit;
      const label = `${lenLabel} < ${ang.toFixed(1)}°`;
      const fontPx = 11 / resizeScale;
      canvasCtx.font = `${fontPx}px sans-serif`;
      const textW = canvasCtx.measureText(label).width;
      const padTT = 3 / resizeScale;
      const tx = lx + 10 / resizeScale;
      const ty = ly - 10 / resizeScale - fontPx;
      canvasCtx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      canvasCtx.fillRect(tx - padTT, ty - padTT, textW + padTT * 2, fontPx + padTT * 2);
      canvasCtx.strokeStyle = '#888';
      canvasCtx.lineWidth = 1 / resizeScale;
      canvasCtx.strokeRect(tx - padTT, ty - padTT, textW + padTT * 2, fontPx + padTT * 2);
      canvasCtx.fillStyle = '#000';
      canvasCtx.textBaseline = 'top';
      canvasCtx.fillText(label, tx, ty);
      canvasCtx.restore();
    }
  }

  // Draw alignment guides for polyline/polygon node dragging
  const h = state.activeHandle;
  if (typeof h === 'string' && h.startsWith('polyline_node_') && !h.includes('hole') && ann.points) {
    const nodeIdx = parseInt(h.split('_').pop(), 10);
    if (!isNaN(nodeIdx) && nodeIdx < ann.points.length) {
      canvasCtx.save();
      applyToolTransform(canvasCtx);
      drawAlignmentGuides(canvasCtx, ann, nodeIdx, resizeScale);
      canvasCtx.restore();
    }
  }

  // Draw alignment guides for measureDistance leader handle dragging
  if (ann.type === 'measureDistance' && (h === 'leader_start' || h === 'leader_end')) {
    const dimPts = { points: [
      { x: ann.leaderStartX, y: ann.leaderStartY },
      { x: ann.leaderEndX, y: ann.leaderEndY },
    ]};
    const dragIdx = h === 'leader_start' ? 0 : 1;
    canvasCtx.save();
    applyToolTransform(canvasCtx);
    drawAlignmentGuides(canvasCtx, dimPts, dragIdx, resizeScale);
    canvasCtx.restore();
  }

  // Draw alignment guides for measureAngle node dragging
  if (ann.type === 'measureAngle' && typeof h === 'string' && h.startsWith('polyline_node_') && ann.point1 && ann.vertex && ann.point2) {
    const angleIdx = parseInt(h.split('_').pop(), 10);
    if (!isNaN(angleIdx) && angleIdx < 3) {
      const anglePts = { points: [ann.point1, ann.vertex, ann.point2] };
      canvasCtx.save();
      applyToolTransform(canvasCtx);
      drawAlignmentGuides(canvasCtx, anglePts, angleIdx, resizeScale);
      canvasCtx.restore();
    }
  }
}

function _handleDrag(ctx, e, coords) {
  const deltaX = coords.x - state.dragStartX;
  const deltaY = coords.y - state.dragStartY;

  // Deadzone: don't start moving until cursor exceeds 3 screen-pixels from click point
  const dragScale = getActiveDocument()?.scale || 1.5;
  const deadzone = 3 / dragScale;
  if (!state._dragExitedDeadzone) {
    if (Math.abs(deltaX) < deadzone && Math.abs(deltaY) < deadzone) return;
    state._dragExitedDeadzone = true;
  }

  const _dDoc = getActiveDocument();
  const _dSel = _dDoc ? _dDoc.selectedAnnotations : [];

  // Ctrl+drag copy: create clones on first meaningful move. Duplication
  // goes through the edit-ops primitive (cloneForInsert) — same identity
  // convention as CO and the array tool.
  if (state._ctrlDragCopy && !state._ctrlCopiesCreated && (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2)) {
    const selected = _dSel;
    const originals = state.originalAnnotations;

    try {
      if (selected.length > 1) {
        for (let i = 0; i < selected.length; i++) {
          if (originals[i]) Object.assign(selected[i], cloneAnnotation(originals[i]));
        }
        const copies = originals.map(orig => {
          const copy = cloneForInsert(orig);
          if (_dDoc) _dDoc.annotations.push(copy);
          return copy;
        });
        if (_dDoc) { _dDoc.selectedAnnotations = copies; _dDoc.selectedAnnotation = copies[0] || null; }
        state.originalAnnotations = copies.map(c => cloneAnnotation(c));
        state._ctrlCopiesCreated = true;
      } else if (selected.length === 1) {
        const ann = selected[0];
        const orig = state.originalAnnotation || originals[0];
        if (ann && orig) {
          Object.assign(ann, cloneAnnotation(orig));
          const copy = cloneForInsert(orig);
          if (_dDoc) _dDoc.annotations.push(copy);
          if (_dDoc) { _dDoc.selectedAnnotations = [copy]; _dDoc.selectedAnnotation = copy; }
          state.originalAnnotation = cloneAnnotation(copy);
          state.originalAnnotations = [cloneAnnotation(copy)];
          state._ctrlCopiesCreated = true;
          showProperties(copy);
        }
      }
    } catch (err) {
      console.error('[dispatcher] copy error:', err);
    }
  }

  // Re-read after potential copy (selectedAnnotations may have changed)
  const _dSel2 = _dDoc ? _dDoc.selectedAnnotations : [];

  // Image alignment snapping: when the moving selection is images only, nudge
  // the delta so the selection's edges/centres click onto other images'
  // edges/centres. Purely additive to the raw drag delta; falls through to the
  // unmodified delta when nothing is within tolerance.
  let adjDX = deltaX, adjDY = deltaY;
  state._imageAlignGuides = null;
  if (state.preferences.enableImageAlignSnap && _dSel2.length > 0 &&
      _dSel2.every(a => a.type === 'image') && !e.shiftKey) {
    // Origin (pre-move) union bbox of the selection, from the captured originals.
    const origs = _dSel2.length === 1
      ? [state.originalAnnotation || state.originalAnnotations[0]]
      : state.originalAnnotations;
    const validOrigs = origs.filter(Boolean);
    if (validOrigs.length === _dSel2.length) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const o of validOrigs) {
        if (o.x < minX) minX = o.x;
        if (o.y < minY) minY = o.y;
        if (o.x + o.width > maxX) maxX = o.x + o.width;
        if (o.y + o.height > maxY) maxY = o.y + o.height;
      }
      const movingBox = { x: minX + deltaX, y: minY + deltaY, w: maxX - minX, h: maxY - minY };
      const excludeIds = new Set(_dSel2.map(a => a.id));
      const refs = collectImageAlignRefs(_dDoc?.annotations || [], coords.pageNum, excludeIds);
      const alignScale = getActiveDocument()?.scale || 1.5;
      const tol = (state.preferences.objectSnapRadius || 12) / alignScale;
      const snap = snapImageMove(movingBox, refs, tol);
      adjDX += snap.dx;
      adjDY += snap.dy;
      if (snap.guides.length > 0) {
        state._imageAlignGuides = snap.guides;
        state._imageAlignGuidesPage = coords.pageNum;
      }
    }
  }

  // Apply move to all selected annotations
  if (_dSel2.length > 1 && state.originalAnnotations.length > 0) {
    for (let i = 0; i < _dSel2.length; i++) {
      if (state.originalAnnotations[i]) {
        Object.assign(_dSel2[i], cloneAnnotation(state.originalAnnotations[i]));
        applyMove(_dSel2[i], adjDX, adjDY);
      }
    }
  } else if (_dSel2.length === 1) {
    const ann = _dSel2[0];
    const orig = state.originalAnnotation || state.originalAnnotations[0];
    if (ann && orig) {
      Object.assign(ann, cloneAnnotation(orig));
      applyMove(ann, adjDX, adjDY);
    }
  }

  redraw();

  // Overlay the alignment guides after the redraw (same pattern as the resize
  // grip line — drawn straight onto the page canvas in app-space).
  if (state._imageAlignGuides && coords.canvasCtx) {
    const gScale = getEffectiveScale();
    coords.canvasCtx.save();
    applyToolTransform(coords.canvasCtx);
    drawImageAlignGuides(coords.canvasCtx, state._imageAlignGuides, gScale);
    coords.canvasCtx.restore();
  }
}

function _annotationChanged(oldState, newState) {
  const keys = new Set([...Object.keys(oldState), ...Object.keys(newState)]);
  for (const k of keys) {
    if (k === 'id') continue;
    const a = oldState[k], b = newState[k];
    if (a !== b && JSON.stringify(a) !== JSON.stringify(b)) return true;
  }
  return false;
}

function _finishDragResize(ctx, e, coords) {
  const _fDoc = getActiveDocument();
  const _fSel = _fDoc ? _fDoc.selectedAnnotations : [];
  if (state._ctrlDragCopy && state._ctrlCopiesCreated) {
    recordBulkAdd(_fSel);
    markDocumentModified();
  } else {
    const modifiedScaleBars = _fSel.filter(a => a.type === 'scaleBar');
    const hasScaleBarChange = modifiedScaleBars.length > 0;
    if (hasScaleBarChange) beginUndoTransaction();
    const upAnn = _fSel.length === 1 ? _fSel[0] : null;
    if (_fSel.length > 1 && state.originalAnnotations.length > 0) {
      // Only record if at least one annotation actually changed
      const anyChanged = _fSel.some((ann, i) =>
        state.originalAnnotations[i] && _annotationChanged(state.originalAnnotations[i], ann)
      );
      if (anyChanged) recordBulkModify(_fSel, state.originalAnnotations);
    } else if (state.originalAnnotation && upAnn) {
      // For edit-contour insert-vertex operations, the "true" before state is
      // _editContourBefore (pre-insert); originalAnnotation is post-insert and
      // is only used as the drag-math baseline.
      const beforeForUndo = state._editContourBefore || state.originalAnnotation;
      if (_annotationChanged(beforeForUndo, upAnn)) {
        recordModify(upAnn.id, beforeForUndo, upAnn);
      }
    }

    // If a scaleBar was modified, recalculate pixelsPerUnit from the new width,
    // sync doc.measureScale, and recalculate all measurement annotations.
    if (hasScaleBarChange) {
      const oldMeasureScale = _fDoc.measureScale == null
        ? _fDoc.measureScale
        : JSON.parse(JSON.stringify(_fDoc.measureScale));
      const measurements = _fDoc.annotations.filter(annotation =>
        ['measureDistance', 'measureArea', 'measurePerimeter', 'measureAngle'].includes(annotation.type)
      );
      const measurementOriginals = measurements.map(annotation => cloneAnnotation(annotation));
      for (const sb of modifiedScaleBars) {
        if (sb.totalUnits > 0) {
          sb.pixelsPerUnit = sb.width / sb.totalUnits;
        }
        syncDocScale(sb);
      }
      recalculateAllMeasurements();
      recordBulkModify(measurements, measurementOriginals);
      recordMeasureScale(oldMeasureScale, _fDoc.measureScale);
      endUndoTransaction();
    }
  }

  state.isDragging = false;
  state.isResizing = false;
  state.activeHandle = null;
  state._dragExitedDeadzone = false;
  state.originalAnnotation = null;
  state.originalAnnotations = [];
  state._ctrlDragCopy = false;
  state._ctrlCopiesCreated = false;
  state._editContourBefore = null;
  state.lastSnapResult = null;
  state._imageAlignGuides = null;
  state._imageAlignGuidesPage = null;
  state.dragCursor = null;
  // Cursor is reactive — clearing the drag flags above causes the cursor
  // module to recompute and revert to the appropriate hover/tool cursor.

  // Repaint once so any image-alignment guides that were showing during the
  // drag are cleared now that state._imageAlignGuides is null (the redraw pass
  // is what draws them, so it is also what removes them).
  redraw();

  if (_fSel.length === 1) showProperties(_fSel[0]);
  else if (_fSel.length > 1) showMultiSelectionProperties();
}

function _finishDrawing(ctx, e, coords) {
  // Generic drag-to-create finalization — used when tool doesn't handle onPointerUp
  const rawEndX = coords.x, rawEndY = coords.y;
  const drawDoc = getActiveDocument();
  const drawScale = drawDoc?.scale || 1.5;
  const endSnap = performSnap(rawEndX, rawEndY, drawDoc?.annotations || [], coords.pageNum, drawScale);
  const endX = endSnap.snapped ? endSnap.x : snapToGrid(rawEndX);
  const endY = endSnap.snapped ? endSnap.y : snapToGrid(rawEndY);
  state.lastSnapResult = null;
  state.isDrawing = false;
  clearPolarAnchor();

  const { createAnnotationFromTool } = ctx;
  const ann = createAnnotationFromTool(state.currentTool, state.startX, state.startY, endX, endY, e);
  if (ann) {
    if (drawDoc) drawDoc.annotations.push(ann);
    recordAdd(ann);
  }
  redraw();

  if (ann && ['textbox', 'callout'].includes(ann.type)) {
    // For text annotations, switch to select FIRST then start editing
    // (startTextEditing requires select tool active to receive keyboard input)
    if (drawDoc) { drawDoc.selectedAnnotations = [ann]; drawDoc.selectedAnnotation = ann; }
    showProperties(ann);
    import('./manager.js').then(m => {
      m.setTool('select');
      startTextEditing(ann);
    });
  } else {
    // Auto-reset to select tool for non-text annotations
    import('./manager.js').then(m => m.setTool('select'));
  }

  // Clear continuous mode state
  if (getActiveDocument()?.viewMode === 'continuous') {
    state.activeContinuousCanvas = null;
    state.activeContinuousPage = null;
  }
}
