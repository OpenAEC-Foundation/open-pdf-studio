// Blender-style rotate mode — THE single interactive rotate engine.
//
// Architecture contract (mirror of g-move-mode.js — keep it this way):
//   * applyRotateGeneric() in annotations/transforms.js is the ONE per-type
//     rotate primitive: a walker over the SAME field tables applyMove uses,
//     so every current and future annotation kind rotates without per-type
//     code elsewhere.
//   * This module is the ONE interactive session around that primitive
//     (preview, angle snap, commit/cancel, undo). All entry points funnel
//     here: the 'RO' command chord and any future Rotate button call
//     tryStartGRotate().
//   * Target resolution lives in the edit-ops layer (selection → fresh
//     hover) — one rule shared by every edit operation.
//
// While rotate mode is active:
//   - the selection rotates around the COMMON pivot (centre of the joint
//     selection bounds), following the cursor angle around that pivot
//   - Shift snaps to preferences.angleSnapDegrees (45°); without Shift a
//     magnetic ±3° snap engages on multiples of 45° (0/45/90/…)
//   - left click or 'Enter' commits (records undo)
//   - 'Escape', right-click or 'R' again cancels and restores originals

import { state, getActiveDocument, getAnnotationBounds } from '../core/state.js';
import { cloneAnnotation } from '../annotations/factory.js';
import { applyRotateGeneric } from '../annotations/transforms.js';
import { redrawAnnotations, redrawContinuous } from '../annotations/rendering.js';
import { recordModify, recordBulkModify } from '../core/undo-manager.js';
import { isPdfAReadOnly } from '../pdf/loader.js';
import { applyTemplateRealSize } from '../symbols/real-size.js';
import { getEditTargets, trackerFresh } from './edit-ops.js';
import { pointerToAppCoords } from './g-move-mode.js';
import { snapAngle } from '../utils/helpers.js';
import { getEffectiveScale } from './effective-scale.js';

// Dode zone rond het draaipunt (de hoek is daar onbepaald), in SCHERMPIXELS.
// Was 2 paginapunten: bij 6400 % een dode zone van 128 px rond een klein vormpje.
const _dodeZone = () => 2 / (getEffectiveScale() || 1);

// Module-level mode state. Mirrored onto state.gRotateMode for diagnostics
// and cross-module guards (g-move refuses to start while rotate is active).
let mode = null;

function redraw() {
  if (getActiveDocument()?.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

// IDENTITY-SAFE target resolution — same contract as g-move-mode.js: UI
// flows may replace annotation objects in doc.annotations while keeping the
// id, so every apply/commit re-binds targets to the CURRENT object by id.
function _liveTarget(i) {
  if (!mode) return null;
  const doc = getActiveDocument();
  const t = mode.targets[i];
  if (!t || !doc?.annotations) return t;
  if (doc.annotations.includes(t)) return t;
  const byId = doc.annotations.find(a => a.id === t.id);
  if (byId) {
    console.warn('[grotate] target re-bound by id (identity drift):', t.type, t.id);
    mode.targets[i] = byId;
    return byId;
  }
  return t;
}

function _applyAll(deg) {
  if (!mode) return;
  for (let i = 0; i < mode.targets.length; i++) {
    const ann = _liveTarget(i);
    const orig = mode.originals[i];
    if (!ann || !orig) continue;
    // Reset to the original snapshot before applying — Esc and angle-snap
    // toggling always work from a known-good baseline.
    Object.assign(ann, cloneAnnotation(orig));
    applyRotateGeneric(ann, orig, mode.pivotX, mode.pivotY, deg);
  }
}

function onMouseMove(e) {
  if (!mode) return;
  // Capture-phase block: underlying tool handlers must not also react while
  // the rotate session owns the pointer.
  e.stopPropagation();
  const c = pointerToAppCoords(e);
  if (!c) return;
  const dx = c.x - mode.pivotX;
  const dy = c.y - mode.pivotY;
  if (Math.hypot(dx, dy) < _dodeZone()) return; // angle is undefined near the pivot
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  // First usable mousemove seeds the reference angle (when the tracker was
  // stale at chord time, or the cursor sat on the pivot).
  if (mode.lastAngle === null) {
    mode.lastAngle = angle;
    return;
  }
  // Unwrap so dragging past ±180° keeps accumulating (continuous turns).
  let diff = angle - mode.lastAngle;
  if (diff > 180) diff -= 360;
  else if (diff < -180) diff += 360;
  mode.accumDeg += diff;
  mode.lastAngle = angle;

  let deg = mode.accumDeg;
  if (e.shiftKey && state.preferences.enableAngleSnap) {
    deg = snapAngle(deg, state.preferences.angleSnapDegrees || 45);
  } else {
    // Magnetic snap on multiples of 45° — same feel as the rotate handle.
    const near = Math.round(deg / 45) * 45;
    if (Math.abs(deg - near) <= 3) deg = near;
  }
  mode.lastDeg = deg;
  _applyAll(deg);
  redraw();
}

function onKeyDown(e) {
  if (!mode) return;
  const inInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
  if (inInput) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    cancelRotate();
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    e.stopPropagation();
    commitRotate();
    return;
  }
  // 'R' again toggles off (cancel) — same muscle memory as 'G' in move mode.
  if (e.key === 'r' || e.key === 'R') {
    e.preventDefault();
    e.stopPropagation();
    cancelRotate();
    return;
  }
  // Block 'G' so a move session can't start on top of the rotate session.
  if (e.key === 'g' || e.key === 'G') {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
}

function onMouseDown(e) {
  if (!mode) return;
  if (e.button === 0) {
    e.preventDefault();
    e.stopPropagation();
    commitRotate();
  } else if (e.button === 2) {
    e.preventDefault();
    e.stopPropagation();
    cancelRotate();
  }
}

function onContextMenu(e) {
  if (mode) {
    e.preventDefault();
    e.stopPropagation();
  }
}

function attachListeners() {
  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('pointermove', onMouseMove, true);
  document.addEventListener('mousedown', onMouseDown, true);
  document.addEventListener('pointerdown', onMouseDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('contextmenu', onContextMenu, true);
}

function detachListeners() {
  document.removeEventListener('mousemove', onMouseMove, true);
  document.removeEventListener('pointermove', onMouseMove, true);
  document.removeEventListener('mousedown', onMouseDown, true);
  document.removeEventListener('pointerdown', onMouseDown, true);
  document.removeEventListener('keydown', onKeyDown, true);
  document.removeEventListener('contextmenu', onContextMenu, true);
}

function endMode() {
  detachListeners();
  state.gRotateMode = null;
  mode = null;
  document.body.style.cursor = '';
}

export function isGRotateModeActive() {
  return !!mode;
}

export function commitRotate() {
  if (!mode) return;
  for (let i = 0; i < mode.targets.length; i++) _liveTarget(i);
  const { targets, originals } = mode;
  // Real-size parametric symbols re-resolve their bbox at the destination
  // (a multi-rotate can orbit a profile into/out of a scale region).
  for (const ann of targets) {
    if (ann && ann.type === 'parametricSymbol') {
      try { applyTemplateRealSize(ann, 'center'); } catch (_) { /* keep rotated size */ }
    }
  }
  const changed = targets.some((ann, i) =>
    originals[i] && JSON.stringify(ann) !== JSON.stringify(originals[i])
  );
  if (changed) {
    if (targets.length > 1) {
      recordBulkModify(targets, originals);
    } else if (targets.length === 1) {
      recordModify(targets[0].id, originals[0], targets[0]);
    }
  }
  endMode();
  redraw();
}

export function cancelRotate() {
  if (!mode) return;
  for (let i = 0; i < mode.targets.length; i++) {
    const ann = _liveTarget(i);
    if (ann && mode.originals[i]) {
      Object.assign(ann, cloneAnnotation(mode.originals[i]));
    }
  }
  endMode();
  redraw();
}

/**
 * Try to enter rotate mode ('RO' chord). Returns true when the session
 * started. The selection then rotates around the joint bounds centre,
 * tracking the cursor angle, until click/Enter commits or Esc cancels.
 */
export function tryStartGRotate() {
  if (mode) return false; // already active
  if (state.gMoveMode) return false; // move session owns the pointer
  if (isPdfAReadOnly()) return false;
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return false;
  const selected = getEditTargets();
  if (selected.length === 0) return false;

  // Clear stale drag/resize state — same guard as g-move.
  state.isResizing = false;
  state.isDragging = false;
  state.activeHandle = null;
  state.originalAnnotation = null;

  // Pivot: centre of the joint selection bounds.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const t of selected) {
    const b = getAnnotationBounds(t);
    if (!b) continue;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + (b.width || 0));
    maxY = Math.max(maxY, b.y + (b.height || 0));
  }
  if (!isFinite(minX)) return false; // nothing with measurable bounds
  const pivotX = (minX + maxX) / 2;
  const pivotY = (minY + maxY) / 2;

  // Seed the reference angle from the mouse tracker ONLY when fresh —
  // otherwise the first mousemove seeds it (same stale-tracker rule as
  // g-move; see the "copy/move does nothing" bug).
  let lastAngle = null;
  if (trackerFresh()) {
    const dx = state._lastMouseAppX - pivotX;
    const dy = state._lastMouseAppY - pivotY;
    if (Math.hypot(dx, dy) >= _dodeZone()) {
      lastAngle = Math.atan2(dy, dx) * (180 / Math.PI);
    }
  }

  mode = {
    active: true,
    targets: selected.slice(),
    originals: selected.map(a => cloneAnnotation(a)),
    pivotX,
    pivotY,
    lastAngle,
    accumDeg: 0,
    lastDeg: 0
  };
  state.gRotateMode = mode;
  document.body.style.cursor = 'grab';
  attachListeners();
  return true;
}
