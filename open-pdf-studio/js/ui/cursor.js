// Reactive cursor for the PDF area.
//
// SINGLE SOURCE OF TRUTH for the cursor shown over the PDF view. The cursor
// is derived from app state (current tool, hover annotation, hover handle,
// drag/resize/pan state, busy/snap-pick mode) via a SolidJS createMemo. A
// createEffect applies the result to the .main-view element on every change.
//
// Tools, pan handlers, the dispatcher etc. NEVER touch element.style.cursor
// directly. They write to state (state.hoverAnnotation, state.hoverHandle,
// state.dragCursor, state.isPanning, state.busy, state.snapPick) and the
// cursor follows automatically.
//
// Why .main-view and not document.body: per projectregel the cursor must remain
// the system default outside the PDF area. Setting body cursor would change
// the cursor over the toolbar, sidebar, dialogs, etc.

import { createMemo, createEffect } from 'solid-js';
import { state, getActiveDocument } from '../core/state.js';
import { interactionState } from '../core/stores/interaction-store.js';
import { getAnnotationHoverCursor } from './cursors/annotation-cursors.js';
import { getCursorForHandle } from '../annotations/handles.js';
import { getAnnotationType } from '../plugins/annotation-type-registry.js';

// Ink-eraser cursor: a circle exactly the eraser's screen radius (8px, see
// ERASER_RADIUS_PX in tools/tools/eraser-tool.js), white halo + dark ring so
// it reads on light and dark pages. Hotspot = circle centre. Only applied to
// .main-view (the PDF area), per the project cursor rule.
const _eraserCursor = (() => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">' +
    '<circle cx="10" cy="10" r="8" fill="none" stroke="white" stroke-width="3"/>' +
    '<circle cx="10" cy="10" r="8" fill="none" stroke="black" stroke-width="1.4"/>' +
    '</svg>';
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 10 10, crosshair`;
})();

// Resolve the default cursor for a tool (no hover, no drag, no override).
function _toolCursor(tool) {
  switch (tool) {
    case 'select':         return 'default';
    case 'eraser':         return _eraserCursor;
    case 'selectComments': return 'text';
    case 'hand':           return 'grab';
    case 'text':
    case 'editText':       return 'text';
    default: {
      const t = getAnnotationType(tool);
      return (t && t.cursor) || 'crosshair';
    }
  }
}

// The reactive memo. Reading it returns the cursor that should be visible
// right NOW given the current state. Branches are ordered by priority —
// higher items in this function override lower ones.
const cursor = createMemo(() => {
  // 1. Pan in progress (any kind) → grabbing
  if (interactionState.isPanning) return 'grabbing';

  // 2. Resize handle being dragged → handle's directional cursor
  if (interactionState.isResizing && interactionState.activeHandle) {
    const ann = interactionState.originalAnnotation;
    return getCursorForHandle(interactionState.activeHandle, ann?.rotation, ann);
  }

  // 3. Annotation drag in progress → 'move' or 'copy' (Ctrl+drag)
  if (interactionState.isDragging) {
    return interactionState.dragCursor || 'move';
  }

  // 4. Long-running operation → wait
  if (interactionState.busy) return 'wait';

  // 5. Snap calibration / pick mode → crosshair
  if (interactionState.snapPick) return 'crosshair';

  // 6. Hovering a resize handle on the (single) selected annotation
  if (interactionState.hoverHandle) {
    const sel = getActiveDocument()?.selectedAnnotations || [];
    const hoverAnn = sel.length === 1 ? sel[0] : null;
    if (hoverAnn) {
      return getCursorForHandle(interactionState.hoverHandle, hoverAnn.rotation, hoverAnn);
    }
  }

  // 7. Hovering an annotation → annotation-type-specific hover cursor.
  // ONLY active in select-tool (and 'selectComments') — when a drawing
  // tool is active the user wants the draw-cursor (crosshair) regardless
  // of what's underneath, otherwise hovering over an existing annotation
  // would silently switch back to the arrow+badge "select-this" cursor
  // and the user can't tell they're in draw mode.
  if (interactionState.hoverAnnotation &&
      (state.currentTool === 'select' || state.currentTool === 'selectComments')) {
    return getAnnotationHoverCursor(interactionState.hoverAnnotation.type);
  }

  // 8. Default for the current tool
  return _toolCursor(state.currentTool);
});

// Cached .main-view ref. The element is created by SolidJS App.jsx and lives
// for the lifetime of the app, but isConnected goes false on hot reload, so
// re-resolve when needed.
let _mainView = null;
function _findMainView() {
  if (_mainView && _mainView.isConnected) return _mainView;
  _mainView = document.querySelector('.main-view');
  return _mainView;
}

// True when an "override" mode is active — meaning the cursor should win over
// any explicit inline cursor on child elements like text spans / link layer.
// In normal modes (default tool, hovering, dragging) we let the natural CSS
// cascade work and don't force overrides on children.
function _isOverrideMode() {
  return interactionState.isPanning ||
         interactionState.busy ||
         interactionState.snapPick;
}

// Single application point. Runs whenever any of the cursor's reactive deps
// change. The createEffect tracks dependencies automatically — there's no
// need to wire callbacks anywhere.
let _initialized = false;
export function initCursor() {
  if (_initialized) return;
  _initialized = true;

  createEffect(() => {
    const c = cursor();
    const el = _findMainView();
    if (el) el.style.cursor = c;
    document.body.classList.toggle('pdf-cursor-override', _isOverrideMode());
  });
}

// Exported for debugging — read the current derived cursor without subscribing.
export function getCurrentCursor() {
  return cursor();
}
