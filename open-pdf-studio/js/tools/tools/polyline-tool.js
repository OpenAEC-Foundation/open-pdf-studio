import { beginCloudNote, cancelCloudNote, placeCloudNote, previewCloudNote } from '../cloud-note-placement.js';
import { state as appState, getActiveDocument } from '../../core/state.js';
import { applyToolTransform, getEffectiveScale } from '../tool-context.js';
import { getAnnotationType } from '../../plugins/annotation-type-registry.js';
import {
  enterTypeLengthMode,
  exitTypeLengthMode,
  setTypeLengthStart,
  applyToEndpoint,
  typeLengthHasBuffer,
} from '../type-length-input.js';

// Last cursor position seen during onPointerMove — used to compute the
// direction for an Enter-committed segment.
const _polyCursor = { x: 0, y: 0 };

/**
 * Polyline tool — multi-click placement, double-click/right-click to finish
 * Also handles cloudPolyline
 */
export const polylineTool = {
  name: 'polyline',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    const { x, y, state, canvasCtx, scale } = ctx;
    const prefs = state.preferences;

    // Right-click finishes. Mark _suppressNextContextmenu zodat de
    // contextmenu-event die direct na deze pointerdown vuurt, niet ook
    // het selectie-menu opent. User-eis: 1e rechtermuisklik = polyline
    // sluiten, 2e rechtermuisklik (na sluiten) = menu zoals normaal.
    if (e.button === 2) {
      _finishPolyline(ctx);
      state._suppressNextContextmenu = true;
      return;
    }

    // Double-click finishes
    if (e.detail === 2) {
      _finishPolyline(ctx);
      return;
    }

    // Close-contour-snap: als pending, sluit polyline als polygon en stop.
    if (state._closeContourPending) {
      state._polylineClosedRequested = true;
      _finishPolyline(ctx);
      state._closeContourPending = false;
      state._polylineClosedRequested = false;
      return;
    }

    // Single click — add point (with snap; honor type-length buffer if active)
    let ptX, ptY;
    let usedTypeLength = false;
    if (typeLengthHasBuffer() && state.polylinePoints.length > 0) {
      const last = state.polylinePoints[state.polylinePoints.length - 1];
      const ep = applyToEndpoint(last.x, last.y, x, y);
      ptX = ep.x; ptY = ep.y;
      usedTypeLength = true;
    } else {
      const snap = ctx.snap(x, y, null, state.polylinePoints);
      ptX = snap.snapped ? snap.x : x;
      ptY = snap.snapped ? snap.y : y;
    }
    // Plugin shift-snap: when shift held + handler exposes snapHook, snap to last vertex.
    // 5th arg = full prior-points list so the handler can compute snaps relative
    // to the last segment direction (e.g. perpendicular/parallel for rect-drawing
    // at non-axis-aligned starting angles).
    if (e?.shiftKey && state.polylinePoints.length > 0) {
      const handler = getAnnotationType(state.currentTool);
      if (handler && typeof handler.snapHook === 'function') {
        const last = state.polylinePoints[state.polylinePoints.length - 1];
        const snapped = handler.snapHook(last.x, last.y, ptX, ptY, state.polylinePoints);
        ptX = snapped.x;
        ptY = snapped.y;
      }
    }

    state.polylinePoints.push({ x: ptX, y: ptY });
    state.isDrawingPolyline = true;
    // Arm type-length capture for next segment (anchored at the just-placed point)
    if (state.polylinePoints.length === 1) {
      enterTypeLengthMode(ptX, ptY);
      appState._typeLengthCommit = (length) => _commitPolySegmentByLength(ctx);
    } else {
      setTypeLengthStart(ptX, ptY);
    }
    ctx.redraw();

    // Draw in-progress polyline
    if (state.polylinePoints.length > 0) {
      canvasCtx.save();
      applyToolTransform(canvasCtx);
      canvasCtx.strokeStyle = prefs.polylineStrokeColor;
      canvasCtx.lineWidth = prefs.polylineLineWidth;
      canvasCtx.lineCap = 'round';
      canvasCtx.lineJoin = 'round';
      canvasCtx.beginPath();
      state.polylinePoints.forEach((point, index) => {
        if (index === 0) canvasCtx.moveTo(point.x, point.y);
        else canvasCtx.lineTo(point.x, point.y);
      });
      canvasCtx.stroke();
      canvasCtx.restore();
    }
  },

  onPointerMove(ctx, e) {
    const { x, y, state, canvasCtx, scale } = ctx;
    _polyCursor.x = x; _polyCursor.y = y;
    if (!state.isDrawingPolyline || state.polylinePoints.length === 0) {
      _drawHoverSnap(ctx, x, y);
      return;
    }

    const prefs = state.preferences;
    const snap = ctx.snap(x, y, null, state.polylinePoints);
    let snapX = snap.snapped ? snap.x : x;
    let snapY = snap.snapped ? snap.y : y;
    state.lastSnapResult = snap.snapped ? snap : null;
    // Type-length lock: when buffer non-empty, constrain preview endpoint
    if (typeLengthHasBuffer()) {
      const last = state.polylinePoints[state.polylinePoints.length - 1];
      const ep = applyToEndpoint(last.x, last.y, x, y);
      snapX = ep.x; snapY = ep.y;
      state.lastSnapResult = null;
    }

    // Plugin shift-snap preview: reflect snapped position before commit so user sees angle feedback.
    if (e?.shiftKey && state.polylinePoints.length > 0) {
      const handler = getAnnotationType(state.currentTool);
      if (handler && typeof handler.snapHook === 'function') {
        const last = state.polylinePoints[state.polylinePoints.length - 1];
        const snapped = handler.snapHook(last.x, last.y, snapX, snapY, state.polylinePoints);
        snapX = snapped.x;
        snapY = snapped.y;
      }
    }

    // Close-contour-snap: als cursor < 8 screen-pixels van eerste vertex (en >= 3 vertices),
    // snap cursor naar eerste vertex en zet visuele indicator.
    const closeTol = 8 / scale;
    if (state.polylinePoints.length >= 3) {
      const first = state.polylinePoints[0];
      const dToFirst = Math.hypot(snapX - first.x, snapY - first.y);
      if (dToFirst < closeTol) {
        snapX = first.x;
        snapY = first.y;
        state._closeContourPending = true;
      } else {
        state._closeContourPending = false;
      }
    } else {
      state._closeContourPending = false;
    }

    ctx.redraw();
    canvasCtx.save();
    applyToolTransform(canvasCtx);
    canvasCtx.strokeStyle = prefs.polylineStrokeColor;
    canvasCtx.lineWidth = prefs.polylineLineWidth;
    canvasCtx.lineCap = 'round';
    canvasCtx.lineJoin = 'round';
    canvasCtx.beginPath();
    state.polylinePoints.forEach((point, index) => {
      if (index === 0) canvasCtx.moveTo(point.x, point.y);
      else canvasCtx.lineTo(point.x, point.y);
    });
    canvasCtx.lineTo(snapX, snapY);
    canvasCtx.stroke();

    // Close-contour indicator: cyan cirkel rond eerste vertex als snap actief is.
    if (state._closeContourPending) {
      const first = state.polylinePoints[0];
      canvasCtx.strokeStyle = '#1D90E0';
      canvasCtx.lineWidth = 2 / scale;
      canvasCtx.beginPath();
      canvasCtx.arc(first.x, first.y, closeTol, 0, 2 * Math.PI);
      canvasCtx.stroke();
    }

    canvasCtx.restore();
    if (snap.snapped && !state._closeContourPending) {
      ctx.drawSnapIndicator(snap);
    }
  },

  // Escape (GitHub #273): zelfde afronding als rechtermuisklik — punten
  // tot-nu-toe committen (≥2) of annuleren (<2). De keyboard-handler
  // schakelt daarna naar de selectietool.
  onEscape(ctx) {
    const { state } = ctx;
    if (!state.isDrawingPolyline && (!state.polylinePoints || state.polylinePoints.length === 0)) {
      return false;
    }
    _finishPolyline(ctx);
    return true;
  },

  onDeactivate(ctx) {
    const { state } = ctx;
    if (state.isDrawingPolyline) {
      state.polylinePoints = [];
      state.isDrawingPolyline = false;
      ctx.redraw();
    }
    exitTypeLengthMode();
    appState._typeLengthCommit = null;
  },
};

// Helper: invoked from keyboard handler when user presses Enter while a
// type-length buffer is active. Adds a polyline vertex at the typed length
// in the current cursor direction.
function _commitPolySegmentByLength(ctx) {
  const pts = appState.polylinePoints;
  if (!pts || pts.length === 0) return;
  const last = pts[pts.length - 1];
  const ep = applyToEndpoint(last.x, last.y, _polyCursor.x, _polyCursor.y);
  pts.push({ x: ep.x, y: ep.y });
  // Re-arm type-length for the next segment
  setTypeLengthStart(ep.x, ep.y);
  ctx.redraw();
}

export const cloudPolylineTool = {
  name: 'cloudPolyline',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    if (placeCloudNote(ctx, e)) return;
    const { x, y, state, canvasCtx, scale } = ctx;
    const prefs = state.preferences;

    // Right-click finishes
    if (e.button === 2) {
      if (state.isDrawingCloudPolyline) state._suppressNextContextmenu = true;
      _finishCloudPolyline(ctx);
      return;
    }

    // Double-click finishes
    if (e.detail === 2) {
      _finishCloudPolyline(ctx);
      return;
    }

    // Single click — add point (with snap)
    const snap = ctx.snap(x, y, null, state.cloudPolylinePoints);
    const ptX = snap.snapped ? snap.x : x;
    const ptY = snap.snapped ? snap.y : y;

    // Close shape when clicking near the first point
    if (state.cloudPolylinePoints.length >= 3) {
      const first = state.cloudPolylinePoints[0];
      const dx = ptX - first.x;
      const dy = ptY - first.y;
      if (Math.sqrt(dx * dx + dy * dy) < 10 / scale) {
        _finishCloudPolyline(ctx);
        return;
      }
    }

    state.cloudPolylinePoints.push({ x: ptX, y: ptY });
    state.isDrawingCloudPolyline = true;
    ctx.redraw();

    // Draw in-progress cloud polyline
    if (state.cloudPolylinePoints.length > 1) {
      canvasCtx.save();
      applyToolTransform(canvasCtx);
      canvasCtx.strokeStyle = prefs.cloudPolylineStrokeColor;
      canvasCtx.lineWidth = prefs.cloudPolylineLineWidth;
      ctx.buildCloudPolylinePath(canvasCtx, state.cloudPolylinePoints, false);
      canvasCtx.stroke();
      canvasCtx.restore();
    }
  },

  onPointerMove(ctx, e) {
    if (previewCloudNote(ctx, e)) return;
    const { x, y, state, canvasCtx, scale } = ctx;
    if (!state.isDrawingCloudPolyline || state.cloudPolylinePoints.length === 0) {
      _drawHoverSnap(ctx, x, y);
      return;
    }

    const prefs = state.preferences;
    const snap = ctx.snap(x, y, null, state.cloudPolylinePoints);
    let snapX = snap.snapped ? snap.x : x;
    let snapY = snap.snapped ? snap.y : y;
    let nearFirst = false;
    state.lastSnapResult = snap.snapped ? snap : null;

    // Snap to first point when near it (close shape hint)
    if (state.cloudPolylinePoints.length >= 3) {
      const first = state.cloudPolylinePoints[0];
      const dx = snapX - first.x;
      const dy = snapY - first.y;
      if (Math.sqrt(dx * dx + dy * dy) < 10 / scale) {
        snapX = first.x;
        snapY = first.y;
        nearFirst = true;
      }
    }

    ctx.redraw();
    canvasCtx.save();
    applyToolTransform(canvasCtx);
    canvasCtx.strokeStyle = prefs.cloudPolylineStrokeColor;
    canvasCtx.lineWidth = prefs.cloudPolylineLineWidth;
    const previewPts = [...state.cloudPolylinePoints, { x: snapX, y: snapY }];
    ctx.buildCloudPolylinePath(canvasCtx, previewPts, nearFirst);
    canvasCtx.stroke();

    if (nearFirst) {
      const first = state.cloudPolylinePoints[0];
      canvasCtx.beginPath();
      canvasCtx.arc(first.x, first.y, 5 / scale, 0, Math.PI * 2);
      canvasCtx.fillStyle = prefs.cloudPolylineStrokeColor;
      canvasCtx.globalAlpha = 0.3;
      canvasCtx.fill();
      canvasCtx.globalAlpha = 1;
    }

    canvasCtx.restore();
    if (snap.snapped && !nearFirst) {
      ctx.drawSnapIndicator(snap);
    }
  },

  // Escape (GitHub #273): zelfde afronding als rechtermuisklik — wolk
  // committen (≥3 punten) of annuleren.
  onEscape(ctx) {
    if (cancelCloudNote()) return true;
    const { state } = ctx;
    if (!state.isDrawingCloudPolyline && (!state.cloudPolylinePoints || state.cloudPolylinePoints.length === 0)) {
      return false;
    }
    _finishCloudPolyline(ctx, false);
    return true;
  },

  onDeactivate(ctx) {
    cancelCloudNote();
    const { state } = ctx;
    if (state.isDrawingCloudPolyline) {
      state.cloudPolylinePoints = [];
      state.isDrawingCloudPolyline = false;
      ctx.redraw();
    }
  },
};

// Shared helpers
function _finishPolyline(ctx) {
  const { state } = ctx;
  if (state.polylinePoints.length >= 2) {
    const prefs = state.preferences;
    const doc = getActiveDocument();

    // Plugin polyline-flow: if active tool is a plugin-handler with drawMode='polyline',
    // delegate annotation-creation to typeHandler.create() with the collected points.
    // This lets plugins emit custom annotation-types (e.g. symitech.scheur, symitech.vloer-contour)
    // instead of always producing a generic 'polyline' annotation.
    const typeHandler = getAnnotationType(state.currentTool);
    if (typeHandler && typeHandler.drawMode === 'polyline' && typeof typeHandler.create === 'function') {
      const currentPage = doc?.currentPage || 1;
      const dims = doc?.pageDims?.[currentPage];
      const enrichedState = {
        ...state,
        polylinePoints: [...state.polylinePoints],
        docScale: doc?.scale || 1,
        devicePixelRatio: window.devicePixelRatio || 1,
        pageWidth: dims?.widthPt,
        pageHeight: dims?.heightPt,
        currentPage,
        closed: state._polylineClosedRequested === true,
      };
      const annProps = typeHandler.create(0, 0, 0, 0, null, enrichedState);
      if (annProps) {
        const ann = ctx.createAnnotation({
          ...annProps,
          page: currentPage,
          ...state.toolOverrides,
        });
        if (doc) doc.annotations.push(ann);
        ctx.recordAdd(ann);
      }
    } else {
      // Default: generic polyline annotation (legacy behavior)
      const ann = ctx.createAnnotation({
        type: 'polyline',
        page: doc?.currentPage || 1,
        points: [...state.polylinePoints],
        color: prefs.polylineStrokeColor,
        strokeColor: prefs.polylineStrokeColor,
        lineWidth: prefs.polylineLineWidth,
        opacity: (prefs.polylineOpacity || 100) / 100
      });
      if (doc) doc.annotations.push(ann);
      ctx.recordAdd(ann);
    }
  }
  state.polylinePoints = [];
  state.isDrawingPolyline = false;
  exitTypeLengthMode();
  appState._typeLengthCommit = null;
  ctx.redraw();

  // Auto-reset to select tool — alleen voor de built-in polyline-tool.
  // Plugin-types met drawMode='polyline' (symitech.scheur, vloer-contour,
  // doorvoer-polyline-closed, etc.) blijven actief zodat de gebruiker
  // direct het volgende exemplaar kan tekenen zonder de tool opnieuw te
  // selecteren. User-eis: "na rechtermuisklik-sluiten van scheur direct
  // de volgende kunnen tekenen".
  const stillPluginPolyline = (() => {
    const h = getAnnotationType(state.currentTool);
    return h && h.drawMode === 'polyline';
  })();
  if (!stillPluginPolyline) {
    import("../../tools/manager.js").then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());
  }
}

function _finishCloudPolyline(ctx, attach = true) {
  let cloud;
  const { state } = ctx;
  if (state.cloudPolylinePoints.length >= 3) {
    cloud = _createCloudPolylineAnnotation(ctx, state.cloudPolylinePoints);
  }
  state.cloudPolylinePoints = [];
  state.isDrawingCloudPolyline = false;
  ctx.redraw();
  if (attach && beginCloudNote(ctx, cloud)) return;

  // Auto-reset to select tool
  import("../../tools/manager.js").then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());
}

function _createCloudPolylineAnnotation(ctx, points) {
  const { state } = ctx;
  const prefs = state.preferences;
  const pts = [...points];
  const xs = pts.map(p => p.x);
  const ys = pts.map(p => p.y);
  const ann = ctx.createAnnotation({
    type: 'cloudPolyline',
    page: ctx.pageNum || getActiveDocument()?.currentPage || 1,
    points: pts,
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
    color: prefs.cloudPolylineStrokeColor,
    strokeColor: prefs.cloudPolylineStrokeColor,
    lineWidth: prefs.cloudPolylineLineWidth,
    opacity: (prefs.cloudPolylineOpacity || 100) / 100
  });
  const doc = getActiveDocument();
  if (doc) doc.annotations.push(ann);
  ctx.recordAdd(ann);
  return ann;
}

function _drawHoverSnap(ctx, x, y) {
  const snap = ctx.snap(x, y);
  const { state } = ctx;
  if (snap.snapped) {
    state.lastSnapResult = snap;
    ctx.redraw();
    ctx.drawSnapIndicator(snap);
  } else if (state.lastSnapResult) {
    state.lastSnapResult = null;
    ctx.redraw();
  }
}
