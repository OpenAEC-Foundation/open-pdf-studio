/**
 * filledAreaTool — multi-click contour with optional arcs and holes,
 * resulting in a filled annotation (solid color or hatch pattern).
 *
 * Flow:
 *   - Click points to extend the outer contour.
 *   - Press 'A' to mark the next point as an arc segment (uses bulge factor,
 *     adjustable with the mouse wheel while arc-mode is active).
 *   - Click near the first point or right-click with >= 3 points to close
 *     the outer contour and enter the holes phase.
 *   - In holes phase, draw additional sub-contours; clicking near the first
 *     point of a hole or right-clicking finalizes that hole. Right-click on
 *     an empty hole-phase commits the annotation.
 *
 * The annotation type is 'filledArea'. Reuses the arc-aware {x,y,arc,bulge}
 * point structure already used by measureArea, plus a holes[][] array.
 */

import { state, getActiveDocument } from '../../core/state.js';
import { applyToolTransform } from '../tool-context.js';
import { createAnnotation } from '../../annotations/factory.js';
import { recordAdd } from '../../core/undo-manager.js';
import i18next from '../../i18n/config.js';
import { redrawAnnotations, redrawContinuous } from '../../annotations/rendering.js';
import { getRegionScaleFactor } from '../../annotations/scale-region.js';
import {
  enterTypeLengthMode,
  exitTypeLengthMode,
  setTypeLengthStart,
  applyToEndpoint,
  typeLengthHasBuffer,
} from '../type-length-input.js';

// Arc-mode toggle for the next-placed point. 'A' toggles, mouse wheel
// adjusts bulge while active.
const arcState = { active: false, bulge: 0.3 };

// Last preview point (snap + Shift-ortho applied). Enter-committed typed
// lengths place the next vertex along THIS direction so what you see in the
// rubber-band is what you get.
const _faPreview = { x: 0, y: 0 };

// Direction anchor frozen at the first typed character — keeps a
// Shift-straightened segment straight while typing digits, regardless of
// where the mouse moves. Cleared when the buffer empties or the vertex is
// placed.
const _faDirLock = { x: null, y: null };

export const filledAreaTool = {
  name: 'filledArea',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    const { x, y } = ctx;
    const prefs = state.preferences;

    // Right-click finishes (close outer or commit annotation).
    if (e.button === 2) {
      if (state.filledAreaPhase === 'holes') {
        _finishFilledAreaWithHoles(ctx);
      } else if (state.filledAreaPoints && state.filledAreaPoints.length >= 3) {
        _closeOuterAndEnterHolesPhase(ctx);
      } else {
        _finishFilledArea(ctx);
      }
      return;
    }

    if (!state.filledAreaPoints) state.filledAreaPoints = [];

    const allInProgress = _getAllInProgressPoints();
    const snap = ctx.snap(x, y, null, allInProgress);
    let ptX = snap.snapped ? snap.x : x;
    let ptY = snap.snapped ? snap.y : y;

    // Angle snap with Shift (ortho). Applied BEFORE the type-length lock so
    // a typed measurement follows the straightened direction.
    if (!snap.snapped && e.shiftKey && prefs.enableAngleSnap && state.filledAreaPoints.length > 0) {
      const last = state.filledAreaPoints[state.filledAreaPoints.length - 1];
      const dx = x - last.x, dy = y - last.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      const ang = Math.atan2(dy, dx) * (180 / Math.PI);
      const snapped = ctx.snapAngle(ang, prefs.angleSnapDegrees) * (Math.PI / 180);
      ptX = last.x + len * Math.cos(snapped);
      ptY = last.y + len * Math.sin(snapped);
    }

    // Type-length lock: typed value constrains this click to that distance
    // along the LOCKED direction (frozen at first keystroke) — or, without
    // a lock, the (snapped/ortho'd) direction computed above.
    if (typeLengthHasBuffer() && state.filledAreaPoints.length > 0) {
      const last = state.filledAreaPoints[state.filledAreaPoints.length - 1];
      const dirX = _faDirLock.x ?? ptX;
      const dirY = _faDirLock.y ?? ptY;
      const ep = applyToEndpoint(last.x, last.y, dirX, dirY);
      ptX = ep.x; ptY = ep.y;
      _faDirLock.x = null; _faDirLock.y = null;
    }

    // Close outer contour by clicking near first point.
    if (state.filledAreaPhase !== 'holes' && state.filledAreaPoints.length >= 3) {
      const first = state.filledAreaPoints[0];
      const dx = ptX - first.x, dy = ptY - first.y;
      if (Math.sqrt(dx * dx + dy * dy) < 10 / ctx.scale) {
        _closeOuterAndEnterHolesPhase(ctx);
        return;
      }
    }

    // In hole phase: clicking near the first point of the active hole closes it.
    if (state.filledAreaPhase === 'holes' && state.filledAreaPoints.length >= 3) {
      const first = state.filledAreaPoints[0];
      const dx = ptX - first.x, dy = ptY - first.y;
      if (Math.sqrt(dx * dx + dy * dy) < 10 / ctx.scale) {
        _closeCurrentHole(ctx);
        return;
      }
    }

    if (arcState.active) {
      state.filledAreaPoints.push({ x: ptX, y: ptY, arc: true, bulge: arcState.bulge });
      arcState.active = false; // reset after placing one arc point
    } else {
      state.filledAreaPoints.push({ x: ptX, y: ptY });
    }
    // Arm/refresh type-length capture for the NEXT segment — typing a number
    // + Enter now places the next vertex at that distance (CAD-style).
    if (state.filledAreaPoints.length === 1 && state.filledAreaPhase !== 'holes') {
      enterTypeLengthMode(ptX, ptY);
      state._typeLengthCommit = () => _commitFilledAreaSegmentByLength(ctx);
    } else {
      setTypeLengthStart(ptX, ptY);
    }
    ctx.redraw();
    _drawInProgress(ctx);
  },

  onPointerMove(ctx, e) {
    const { x, y, canvasCtx, scale } = ctx;
    const prefs = state.preferences;
    const inHoles = state.filledAreaPhase === 'holes';

    if (inHoles && (!state.filledAreaPoints || state.filledAreaPoints.length === 0)) {
      ctx.redraw();
      _drawHolesPhasePreview(ctx, x, y);
      _drawHoverSnap(ctx, x, y);
      return;
    }

    if (!state.filledAreaPoints || state.filledAreaPoints.length === 0) {
      _drawHoverSnap(ctx, x, y);
      return;
    }

    const allInProgress = _getAllInProgressPoints();
    const snap = ctx.snap(x, y, null, allInProgress);
    state.lastSnapResult = snap.snapped ? snap : null;
    let snapX = snap.snapped ? snap.x : x;
    let snapY = snap.snapped ? snap.y : y;
    let nearFirst = false;

    if (state.filledAreaPoints.length >= 3) {
      const first = state.filledAreaPoints[0];
      const dx = snapX - first.x, dy = snapY - first.y;
      if (Math.sqrt(dx * dx + dy * dy) < 10 / scale) {
        snapX = first.x; snapY = first.y; nearFirst = true;
      }
    }

    if (!snap.snapped && !nearFirst && e.shiftKey && prefs.enableAngleSnap) {
      const last = state.filledAreaPoints[state.filledAreaPoints.length - 1];
      const dx = x - last.x, dy = y - last.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      const ang = Math.atan2(dy, dx) * (180 / Math.PI);
      const snapped = ctx.snapAngle(ang, prefs.angleSnapDegrees) * (Math.PI / 180);
      snapX = last.x + len * Math.cos(snapped);
      snapY = last.y + len * Math.sin(snapped);
    }

    // Type-length lock for the rubber-band preview — DIRECTION LOCKED: the
    // first buffered character freezes the previous-frame (possibly ortho'd)
    // direction so the segment stays straight while typing.
    if (!nearFirst && typeLengthHasBuffer() && state.filledAreaPoints.length > 0) {
      if (_faDirLock.x == null) {
        _faDirLock.x = _faPreview.x;
        _faDirLock.y = _faPreview.y;
      }
      const last = state.filledAreaPoints[state.filledAreaPoints.length - 1];
      const ep = applyToEndpoint(last.x, last.y, _faDirLock.x, _faDirLock.y);
      snapX = ep.x; snapY = ep.y;
      state.lastSnapResult = null;
    } else if (!typeLengthHasBuffer()) {
      _faDirLock.x = null;
      _faDirLock.y = null;
    }

    // Enter-commit places the next vertex along this preview point.
    _faPreview.x = snapX;
    _faPreview.y = snapY;

    ctx.redraw();
    canvasCtx.save();
    applyToolTransform(canvasCtx);

    const strokeColor = prefs.filledAreaStrokeColor || '#000000';
    const fillColor = prefs.filledAreaFillNone ? null : (prefs.filledAreaFillColor || '#cccccc');
    const lineWidth = prefs.filledAreaLineWidth || 1;
    const borderStyle = prefs.filledAreaBorderStyle || 'solid';
    const opacity = (prefs.filledAreaOpacity ?? 100) / 100;
    // Region-aware preview: the hatch density (and thus the look) during
    // drawing must MATCH the final render exactly — same regionFactor
    // sampling as rendering.js does for committed filledAreas, so nothing
    // "jumps" at finish.
    const _faFirst = state.filledAreaPoints[0] || { x: snapX, y: snapY };
    const _faRegionFactor = getRegionScaleFactor(
      getActiveDocument()?.currentPage || 1, _faFirst.x, _faFirst.y
    );
    const hatchOpts = prefs.filledAreaHatchPattern && prefs.filledAreaHatchPattern !== 'none'
      ? {
          pattern: prefs.filledAreaHatchPattern,
          color: prefs.filledAreaHatchColor || strokeColor,
          scale: (prefs.filledAreaHatchScale ?? 100) * _faRegionFactor,
          angle: prefs.filledAreaHatchAngle ?? 0,
        }
      : null;

    canvasCtx.strokeStyle = strokeColor;
    canvasCtx.lineWidth = lineWidth;
    canvasCtx.globalAlpha = opacity;
    canvasCtx.lineCap = 'round';
    canvasCtx.lineJoin = 'round';

    if (inHoles) {
      const outer = state.filledAreaOuterPoints || [];
      const completed = state.filledAreaHoles || [];
      const previewPt = arcState.active
        ? { x: snapX, y: snapY, arc: true, bulge: arcState.bulge }
        : { x: snapX, y: snapY };
      const activeHolePreview = [...state.filledAreaPoints, previewPt];
      const allHoles = activeHolePreview.length >= 3
        ? [...completed, activeHolePreview]
        : completed;
      if (outer.length >= 3) {
        ctx.drawMeasureAreaShape(canvasCtx, outer, strokeColor, lineWidth, fillColor, borderStyle, allHoles, hatchOpts);
      }
      if (activeHolePreview.length < 3 && activeHolePreview.length >= 2) {
        canvasCtx.setLineDash([2, 4]);
        canvasCtx.beginPath();
        canvasCtx.moveTo(activeHolePreview[0].x, activeHolePreview[0].y);
        for (let i = 1; i < activeHolePreview.length; i++) {
          canvasCtx.lineTo(activeHolePreview[i].x, activeHolePreview[i].y);
        }
        canvasCtx.stroke();
        canvasCtx.setLineDash([]);
      }
    } else {
      const previewPt = arcState.active
        ? { x: snapX, y: snapY, arc: true, bulge: arcState.bulge }
        : { x: snapX, y: snapY };
      const previewPts = [...state.filledAreaPoints, previewPt];
      if (previewPts.length > 2) {
        ctx.drawMeasureAreaShape(canvasCtx, previewPts, strokeColor, lineWidth, fillColor, borderStyle, undefined, hatchOpts);
      } else {
        // Fallback: simple polyline preview
        canvasCtx.beginPath();
        canvasCtx.moveTo(previewPts[0].x, previewPts[0].y);
        for (let i = 1; i < previewPts.length; i++) {
          canvasCtx.lineTo(previewPts[i].x, previewPts[i].y);
        }
        canvasCtx.stroke();
      }
    }

    if (arcState.active) {
      canvasCtx.font = '10px Arial';
      canvasCtx.fillStyle = strokeColor;
      canvasCtx.globalAlpha = 0.7;
      canvasCtx.fillText(`Arc (bulge: ${arcState.bulge.toFixed(2)})`, snapX + 12, snapY - 8);
      canvasCtx.globalAlpha = opacity;
    }

    if (nearFirst) {
      const first = state.filledAreaPoints[0];
      canvasCtx.beginPath();
      canvasCtx.arc(first.x, first.y, 5 / scale, 0, Math.PI * 2);
      canvasCtx.fillStyle = strokeColor;
      canvasCtx.globalAlpha = 0.3;
      canvasCtx.fill();
      canvasCtx.globalAlpha = 1;
    }

    canvasCtx.globalAlpha = 1;
    canvasCtx.restore();
    if (snap.snapped && !nearFirst) ctx.drawSnapIndicator(snap);
  },

  onKeyDown(ctx, e) {
    if ((e.key === 'a' || e.key === 'A') && state.filledAreaPoints && state.filledAreaPoints.length > 0) {
      e.preventDefault();
      arcState.active = !arcState.active;
      ctx.redraw();
    } else if (e.key === 'Backspace' && state.filledAreaPoints && state.filledAreaPoints.length > 0) {
      e.preventDefault();
      _undoLastPoint(ctx);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (state.filledAreaPhase === 'holes') {
        _finishFilledAreaWithHoles(ctx);
      } else if (state.filledAreaPoints && state.filledAreaPoints.length >= 3) {
        _closeOuterAndEnterHolesPhase(ctx);
        // Immediately commit (Enter without holes)
        _finishFilledAreaWithHoles(ctx);
      }
    }
    // Escape loopt via onEscape (keyboard-handlers) — zelfde afronding als
    // rechtermuisklik (GitHub #273).
  },

  // Escape (GitHub #273): punten-tot-nu-toe committen met dezelfde
  // afrondroutines als rechtermuisklik — holes-fase → commit met gaten;
  // buitencontour ≥3 punten → commit als vlak; <3 punten → annuleren
  // (dat doet _finishFilledArea zelf). De keyboard-handler schakelt
  // daarna naar de selectietool.
  onEscape(ctx) {
    arcState.active = false;
    if (state.filledAreaPhase === 'holes') {
      _finishFilledAreaWithHoles(ctx);
      return true;
    }
    if (state.filledAreaPoints && state.filledAreaPoints.length > 0) {
      _finishFilledArea(ctx);
      return true;
    }
    return false;
  },

  onWheel(ctx, e) {
    if (arcState.active && state.filledAreaPoints && state.filledAreaPoints.length > 0) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.05 : 0.05;
      arcState.bulge = Math.max(-1, Math.min(1, arcState.bulge + delta));
      ctx.redraw();
    }
  },

  onDeactivate(ctx) {
    arcState.active = false;
    arcState.bulge = 0.3;
    _resetState();
    ctx.redraw();
  },
};

// ─────────────────────────────────────────────────────────────────────

// Minimal ctx for API calls that originate OUTSIDE the tool dispatcher
// (the sketch toolbar overlay) — only redraw + recordAdd are needed by the
// internal helpers.
function _apiCtx() {
  return {
    redraw() {
      if (getActiveDocument()?.viewMode === 'continuous') redrawContinuous();
      else redrawAnnotations();
    },
    recordAdd(a) { recordAdd(a); },
  };
}

// Public command API for the sketch-mode toolbar (SketchModeBar.jsx). The
// SAME state machine the pointer/keyboard flow drives — buttons are just a
// visible synonym for 'A', click-near-first, Enter and Escape.
export const filledAreaSketch = {
  isActive() {
    return !!(
      (state.filledAreaPoints && state.filledAreaPoints.length > 0) ||
      (state.filledAreaPhase === 'holes' && state.filledAreaOuterPoints && state.filledAreaOuterPoints.length >= 3)
    );
  },
  status() {
    return {
      phase: state.filledAreaPhase === 'holes' ? 'holes' : 'outer',
      points: state.filledAreaPoints ? state.filledAreaPoints.length : 0,
      outerClosed: !!(state.filledAreaOuterPoints && state.filledAreaOuterPoints.length >= 3),
      holes: state.filledAreaHoles ? state.filledAreaHoles.length : 0,
      arcMode: arcState.active,
      bulge: arcState.bulge,
    };
  },
  setArcMode(on) {
    arcState.active = !!on;
    _apiCtx().redraw();
  },
  // Close the loop being drawn: outer contour → holes phase; active hole →
  // finalized hole. Requires >= 3 points (the "is it closed?" check).
  closeLoop() {
    const ctx = _apiCtx();
    if (!state.filledAreaPoints || state.filledAreaPoints.length < 3) return false;
    if (state.filledAreaPhase === 'holes') _closeCurrentHole(ctx);
    else _closeOuterAndEnterHolesPhase(ctx);
    return true;
  },
  // Finish: validate + commit the annotation, leave the mode.
  finish() {
    const ctx = _apiCtx();
    if (state.filledAreaPhase === 'holes') {
      _finishFilledAreaWithHoles(ctx);
    } else if (state.filledAreaPoints && state.filledAreaPoints.length >= 3) {
      _closeOuterAndEnterHolesPhase(ctx);
      _finishFilledAreaWithHoles(ctx);
    } else {
      // Open contour with < 3 points cannot be closed — discard the stub.
      _resetState();
      ctx.redraw();
    }
  },
  cancel() {
    const ctx = _apiCtx();
    arcState.active = false;
    _resetState();
    ctx.redraw();
  },
  // Remove the most recently placed point of the CURRENT contour (outer
  // or the hole being drawn) without discarding the rest of the sketch —
  // a misclick shouldn't force starting over.
  undoLastPoint() {
    return _undoLastPoint(_apiCtx());
  },
  canUndoPoint() {
    return !!(state.filledAreaPoints && state.filledAreaPoints.length > 0);
  },
};

function _getAllInProgressPoints() {
  const pts = [];
  if (state.filledAreaPoints) pts.push(...state.filledAreaPoints);
  if (state.filledAreaPhase === 'holes') {
    if (state.filledAreaOuterPoints) pts.push(...state.filledAreaOuterPoints);
    for (const h of (state.filledAreaHoles || [])) pts.push(...h);
  }
  return pts;
}

// Backspace / the toolbar's "Undo point" button: drop the last vertex of
// whichever contour is currently being drawn. No-op with zero points —
// the outer contour's first click stays a hard commitment (use Cancel/
// Escape to abandon it entirely).
function _undoLastPoint(ctx) {
  if (!state.filledAreaPoints || state.filledAreaPoints.length === 0) return false;
  state.filledAreaPoints.pop();
  if (state.filledAreaPoints.length === 0) {
    // Re-arm type-length capture from scratch, same as the very first click.
    exitTypeLengthMode();
    state._typeLengthCommit = null;
  }
  arcState.active = false;
  ctx.redraw();
  _drawInProgress(ctx);
  return true;
}

function _resetState() {
  state.filledAreaPoints = null;
  state.filledAreaPhase = 'outer';
  state.filledAreaOuterPoints = null;
  state.filledAreaHoles = [];
  _faDirLock.x = null;
  _faDirLock.y = null;
  exitTypeLengthMode();
  state._typeLengthCommit = null;
}

// Enter pressed with a typed length: place the next vertex at that distance
// along the current rubber-band direction, then re-arm for the next segment.
function _commitFilledAreaSegmentByLength(ctx) {
  if (!state.filledAreaPoints || state.filledAreaPoints.length === 0) return;
  const last = state.filledAreaPoints[state.filledAreaPoints.length - 1];
  const ep = applyToEndpoint(last.x, last.y, _faPreview.x, _faPreview.y);
  if (arcState.active) {
    state.filledAreaPoints.push({ x: ep.x, y: ep.y, arc: true, bulge: arcState.bulge });
    arcState.active = false;
  } else {
    state.filledAreaPoints.push({ x: ep.x, y: ep.y });
  }
  _faDirLock.x = null;
  _faDirLock.y = null;
  setTypeLengthStart(ep.x, ep.y);
  ctx.redraw();
  _drawInProgress(ctx);
}

function _closeOuterAndEnterHolesPhase(ctx) {
  state.filledAreaOuterPoints = [...state.filledAreaPoints];
  state.filledAreaPhase = 'holes';
  state.filledAreaHoles = [];
  state.filledAreaPoints = [];
  ctx.redraw();
}

function _closeCurrentHole(ctx) {
  if (state.filledAreaPoints && state.filledAreaPoints.length >= 3) {
    state.filledAreaHoles = [...(state.filledAreaHoles || []), [...state.filledAreaPoints]];
  }
  state.filledAreaPoints = [];
  ctx.redraw();
}

function _finishFilledArea(ctx) {
  if (state.filledAreaPoints && state.filledAreaPoints.length >= 3) {
    const ann = _createFilledAreaAnnotation(ctx, state.filledAreaPoints);
    if (ann) {
      const doc = getActiveDocument();
      if (doc) doc.annotations.push(ann);
      ctx.recordAdd(ann);
    }
  }
  _resetState();
  ctx.redraw();
  import("../manager.js").then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());
}

function _finishFilledAreaWithHoles(ctx) {
  // Finalize incomplete in-progress hole if it has 3+ points.
  if (state.filledAreaPoints && state.filledAreaPoints.length >= 3) {
    state.filledAreaHoles = [...(state.filledAreaHoles || []), [...state.filledAreaPoints]];
  }
  const outer = state.filledAreaOuterPoints;
  const holes = state.filledAreaHoles && state.filledAreaHoles.length > 0 ? state.filledAreaHoles : undefined;
  if (outer && outer.length >= 3) {
    const ann = _createFilledAreaAnnotation(ctx, outer, holes);
    if (ann) {
      const doc = getActiveDocument();
      if (doc) doc.annotations.push(ann);
      ctx.recordAdd(ann);
    }
  }
  _resetState();
  ctx.redraw();
  import("../manager.js").then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());
}

function _createFilledAreaAnnotation(ctx, points, holes) {
  const prefs = state.preferences;
  const props = {
    type: 'filledArea',
    page: getActiveDocument()?.currentPage || 1,
    points,
    color: prefs.filledAreaStrokeColor || '#000000',
    strokeColor: prefs.filledAreaStrokeColor || '#000000',
    fillColor: prefs.filledAreaFillNone ? null : (prefs.filledAreaFillColor || '#cccccc'),
    lineWidth: prefs.filledAreaLineWidth ?? 1,
    borderStyle: prefs.filledAreaBorderStyle || 'solid',
    opacity: (prefs.filledAreaOpacity ?? 100) / 100,
    hatchPattern: prefs.filledAreaHatchPattern || 'none',
    hatchColor: prefs.filledAreaHatchColor || '#000000',
    hatchScale: prefs.filledAreaHatchScale ?? 100,
    hatchAngle: prefs.filledAreaHatchAngle ?? 0,
  };
  if (holes && holes.length > 0) props.holes = holes;
  // Bounding box for selection helpers.
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  props.x = Math.min(...xs);
  props.y = Math.min(...ys);
  props.width = Math.max(...xs) - props.x;
  props.height = Math.max(...ys) - props.y;
  return createAnnotation(props);
}

function _drawInProgress(ctx) {
  // Lightweight redraw — full preview is handled in onPointerMove.
  ctx.redraw();
}

function _drawHolesPhasePreview(ctx, cursorX, cursorY) {
  const { canvasCtx, scale } = ctx;
  const prefs = state.preferences;
  const outer = state.filledAreaOuterPoints || [];
  const completed = state.filledAreaHoles || [];
  if (outer.length < 3) return;

  const strokeColor = prefs.filledAreaStrokeColor || '#000000';
  const fillColor = prefs.filledAreaFillNone ? null : (prefs.filledAreaFillColor || '#cccccc');
  const lineWidth = prefs.filledAreaLineWidth || 1;
  const borderStyle = prefs.filledAreaBorderStyle || 'solid';
  const opacity = (prefs.filledAreaOpacity ?? 100) / 100;
  const hatchOpts = prefs.filledAreaHatchPattern && prefs.filledAreaHatchPattern !== 'none'
    ? {
        pattern: prefs.filledAreaHatchPattern,
        color: prefs.filledAreaHatchColor || strokeColor,
        scale: prefs.filledAreaHatchScale ?? 100,
        angle: prefs.filledAreaHatchAngle ?? 0,
      }
    : null;

  canvasCtx.save();
  applyToolTransform(canvasCtx);
  canvasCtx.strokeStyle = strokeColor;
  canvasCtx.lineWidth = lineWidth;
  canvasCtx.globalAlpha = opacity;
  canvasCtx.lineCap = 'round';
  canvasCtx.lineJoin = 'round';

  ctx.drawMeasureAreaShape(canvasCtx, outer, strokeColor, lineWidth, fillColor, borderStyle, completed.length > 0 ? completed : undefined, hatchOpts);

  canvasCtx.font = '10px Arial';
  canvasCtx.fillStyle = strokeColor;
  canvasCtx.globalAlpha = 0.7;
  canvasCtx.fillText(i18next.t('statusbar:filledAreaSketch.holesPhaseHint'), cursorX + 12 / scale, cursorY - 4 / scale);
  canvasCtx.globalAlpha = 1;
  canvasCtx.restore();
}

function _drawHoverSnap(ctx, x, y) {
  const snap = ctx.snap(x, y);
  if (snap.snapped) {
    state.lastSnapResult = snap;
    ctx.redraw();
    ctx.drawSnapIndicator(snap);
  } else if (state.lastSnapResult) {
    state.lastSnapResult = null;
    ctx.redraw();
  }
}
