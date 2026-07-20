// Blender-style move mode — THE single interactive move engine.
//
// Architecture contract (keep it this way):
//   * applyMove() in annotations/transforms.js is the ONE per-type move
//     primitive. Every annotation kind (lines, dimensions, hatches, symbols,
//     plugin types via its default branch) moves through it — never write
//     per-tool movement code elsewhere.
//   * This module is the ONE interactive session around that primitive
//     (preview, axis lock, commit/cancel, undo). All entry points funnel
//     here: the 'G' key, the 'mv' command chord, and any future Move button
//     should all call tryStartGMove().
//   * Selection fallback: with nothing selected, the annotation under the
//     cursor is grabbed (findAnnotationAt — which must support every type).
//
// Activation: pressing 'G' while one or more annotations are selected enters
// move mode. The selection then follows the mouse cursor (no button held).
// While in move mode:
//   - 'X' constrains movement to the X-axis
//   - 'Y' constrains movement to the Y-axis (press the same key again to clear)
//   - Mouse click (left) or 'Enter' commits the new position (records undo)
//   - 'Escape' or right-click cancels and restores original positions
//
// Implementation notes:
//   - originals[] holds deep clones (cloneAnnotation) of each selected annotation
//     captured at G-press time. Restoring from these clones is what makes Esc
//     and lockAxis switching work correctly.
//   - Coordinates are computed from clientX/Y relative to the annotation canvas
//     (single-page mode) or the page-canvas under the cursor (continuous mode),
//     so movement works in both view modes.
//   - Listeners are attached to `document` only while the mode is active and
//     are torn down on commit/cancel — no permanent global listeners.
//
// See GitHub issue #210.

import { state, getActiveDocument } from '../core/state.js';
import { cloneAnnotation } from '../annotations/factory.js';
import { applyMove } from './../annotations/transforms.js';
import { redrawAnnotations, redrawContinuous } from '../annotations/rendering.js';
import { recordModify, recordBulkModify, recordBulkAdd } from '../core/undo-manager.js';
import { isPdfAReadOnly } from '../pdf/loader.js';
import { annotationCanvas } from '../ui/dom-elements.js';
import { applyTemplateRealSize } from '../symbols/real-size.js';
import { getEditTargets, trackerFresh } from './edit-ops.js';
import { performSnap, collectSnapPoints } from './snap-engine.js';
import { getCachedPdfSnapPoints } from './pdf-snap-extractor.js';
import {
  enterTypeLengthMode, exitTypeLengthMode, typeLengthHasBuffer,
  consumeKey as typeLengthConsumeKey, applyToEndpoint as typeLengthApply,
  setTypeLengthCursorScreen,
} from './type-length-input.js';
import { snapAngle } from '../utils/helpers.js';

// Ids of every annotation in the move session — the moving selection must
// never snap onto itself (single OR multi).
function _excludeSet() {
  return mode ? new Set(mode.targets.map(t => t.id)) : undefined;
}

// Object-snap the session cursor so moves land EXACTLY on endpoints/corners
// of other geometry. Returns the full snap result (always has x/y).
// includeTargets: in the BASE-POINT pick phase ('mv', before the first click)
// the selection's own corners are the most natural grab points — nothing is
// moving yet, so they are valid snap targets. While tracking, they move with
// the cursor and must stay excluded (self-snap feedback loop).
function _snapSessionPoint(c, { includeTargets = false } = {}) {
  const doc = getActiveDocument();
  if (!doc) return { x: c.x, y: c.y, snapped: false };
  return performSnap(
    c.x, c.y, doc.annotations || [], doc.currentPage || 1, doc.scale || 1.5,
    includeTargets ? undefined : _excludeSet()
  );
}

// Corner-to-corner object snap: when a snap point OF THE MOVING SELECTION
// (corner, endpoint, midpoint…) lands within snap radius of a STATIC snap
// point, the delta is adjusted so the two points click together exactly —
// "de hoek van het element" snaps, not just the cursor. Candidates are
// cached at session start; own points simply translate with the delta.
const _OBJ_SNAP_MAX_STATIC = 6000; // guard against pathological documents

function _cacheObjectSnapPoints() {
  const doc = getActiveDocument();
  if (!doc || !mode) return;
  const page = doc.currentPage || 1;
  try {
    mode.ownPoints = collectSnapPoints(mode.targets, page);
    const statics = collectSnapPoints(doc.annotations || [], page, _excludeSet());
    if (state.preferences.snapToPdfContent) {
      for (const pt of getCachedPdfSnapPoints(page)) statics.push(pt);
    }
    const c2d = doc.cursor2D;
    if (c2d && c2d.page === page) statics.push({ x: c2d.x, y: c2d.y, type: 'endpoint', annotation: null });
    mode.staticPoints = statics.length <= _OBJ_SNAP_MAX_STATIC ? statics : [];
  } catch (_) {
    mode.ownPoints = [];
    mode.staticPoints = [];
  }
}

// Find the best own-point→static-point pairing for a candidate delta.
// Returns { dist, ddx, ddy, sp } or null.
function _bestObjectSnap(dx, dy, tol) {
  if (!mode?.ownPoints?.length || !mode?.staticPoints?.length) return null;
  let best = null;
  for (const op of mode.ownPoints) {
    const px = op.x + dx, py = op.y + dy;
    for (const sp of mode.staticPoints) {
      const ddx = sp.x - px, ddy = sp.y - py;
      const d = Math.hypot(ddx, ddy);
      if (d <= tol && (!best || d < best.dist)) best = { dist: d, ddx, ddy, sp };
    }
  }
  return best;
}

// Module-level mode state. Mirrored onto state.gMoveMode for diagnostics.
let mode = null;

function redraw() {
  if (getActiveDocument()?.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

function getCanvasAndScale(e) {
  const doc = getActiveDocument();
  const scale = doc?.scale || 1.5;
  if (doc?.viewMode === 'continuous') {
    // Find the annotation-canvas under the pointer
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const canvas = el && el.closest ? el.closest('.annotation-canvas') : null;
    if (canvas) return { canvas, scale };
    return { canvas: null, scale };
  }
  return { canvas: annotationCanvas, scale };
}

// Shared with g-rotate-mode.js — ONE pointer→app-space mapping for all
// interactive sessions (single-page viewport transform + continuous mode).
export function pointerToAppCoords(e) {
  const { canvas, scale } = getCanvasAndScale(e);
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const vp = window.__pdfViewport;
  if (vp && vp.active && getActiveDocument()?.viewMode !== 'continuous') {
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    return {
      x: (screenX - vp.offsetX) / vp.zoom,
      y: (screenY - vp.offsetY) / vp.zoom
    };
  }
  return {
    x: (e.clientX - rect.left) / scale,
    y: (e.clientY - rect.top) / scale
  };
}

// IDENTITY-SAFE target resolution. Some UI flows replace annotation objects
// in doc.annotations while keeping the id (observed for 'box' via the
// selection/properties pipeline) — a session that holds direct references
// would then mutate ORPHANS and the visible annotation never moves. Every
// apply/commit therefore re-binds each target to the CURRENT document
// object by id. Edit operations must never depend on object identity.
function _liveTarget(i) {
  if (!mode) return null;
  const doc = getActiveDocument();
  const t = mode.targets[i];
  if (!t || !doc?.annotations) return t;
  if (doc.annotations.includes(t)) return t;
  const byId = doc.annotations.find(a => a.id === t.id);
  if (byId) {
    console.warn('[gmove] target re-bound by id (identity drift):', t.type, t.id);
    mode.targets[i] = byId;
    return byId;
  }
  return t;
}

function applyDeltaToAll(dx, dy) {
  if (!mode) return;
  for (let i = 0; i < mode.targets.length; i++) {
    const ann = _liveTarget(i);
    const orig = mode.originals[i];
    if (!ann || !orig) continue;
    // Reset to the original snapshot before applying delta — this lets Esc
    // and axis switching always work from a known-good baseline.
    Object.assign(ann, cloneAnnotation(orig));
    applyMove(ann, dx, dy);
  }
}

function onMouseMove(e) {
  if (!mode) return;
  // Capture-phase block: underlying tool handlers (select-tool drag/resize,
  // hover logic) must NOT also react while G-mode owns the pointer —
  // otherwise a stale resize state can drag a single endpoint while G moves
  // the whole annotation.
  e.stopPropagation();
  const cRaw = pointerToAppCoords(e);
  if (!cRaw) return;
  // Keep the coord-input HUD glued to the cursor.
  setTypeLengthCursorScreen(e.clientX, e.clientY);
  // Base-point flow ('mv'): nothing moves until the base point is clicked,
  // but the snap indicator must track the cursor so the user SEES which
  // corner/endpoint the pick will land on (own corners included).
  if (mode.awaitingBase) {
    const baseSnap = _snapSessionPoint(cRaw, { includeTargets: true });
    state.lastSnapResult = baseSnap.snapped ? baseSnap : null;
    redraw();
    return;
  }
  // First valid mousemove seeds the start position if it wasn't established
  // (e.g. cursor was off-canvas at G-press time, so _lastMouseAppX/Y stayed 0).
  // Without this, delta would be huge on the first move and annotations would
  // jump off-screen — particularly noticeable for measureDistance/Area/Perimeter.
  if (!mode.startSeeded) {
    mode.startX = cRaw.x;
    mode.startY = cRaw.y;
    mode.startSeeded = true;
    enterTypeLengthMode(mode.startX, mode.startY);
    return;
  }
  // Shift = CAD ortho/angle constraint: snap the start→cursor direction to
  // preferences.angleSnapDegrees multiples (45°). The constrained cursor is
  // the basis for everything below (typed distance follows the snapped ray).
  let cur = cRaw;
  if (e.shiftKey && state.preferences.enableAngleSnap) {
    const ddx = cRaw.x - mode.startX;
    const ddy = cRaw.y - mode.startY;
    const len = Math.hypot(ddx, ddy);
    if (len > 1e-6) {
      const ang = snapAngle(Math.atan2(ddy, ddx) * (180 / Math.PI),
        state.preferences.angleSnapDegrees || 45) * (Math.PI / 180);
      cur = { x: mode.startX + len * Math.cos(ang), y: mode.startY + len * Math.sin(ang) };
    }
  }
  mode.lastCursor = cur;

  // Typed coordinate input ("100", "100,50", "100<45", "=x,y") overrides
  // every snap: the number IS the instruction.
  const typed = typeLengthApply(mode.startX, mode.startY, cur.x, cur.y);
  if (typed.constrained) {
    let dx = typed.x - mode.startX;
    let dy = typed.y - mode.startY;
    if (mode.lockAxis === 'x') dy = 0;
    else if (mode.lockAxis === 'y') dx = 0;
    state.lastSnapResult = null;
    mode.lastDx = dx;
    mode.lastDy = dy;
    applyDeltaToAll(dx, dy);
    redraw();
    return;
  }

  // Two independent snap candidates against the (possibly angle-constrained)
  // cursor; the closest one wins (stacking them would double-correct):
  //   1. cursor snap — the cursor itself lands on a static point (also the
  //      precision channel of the 'mv' base-point flow)
  //   2. object snap — a corner/endpoint of the MOVING selection lands on a
  //      static point ("hoek van het element" klikt vast)
  let dx = cur.x - mode.startX;
  let dy = cur.y - mode.startY;
  if (mode.lockAxis === 'x') dy = 0;
  else if (mode.lockAxis === 'y') dx = 0;

  let indicator = null;
  // While Shift constrains the angle, object/cursor snaps are off — the
  // constraint is the instruction.
  const constrainAngle = e.shiftKey && state.preferences.enableAngleSnap;
  const cursorSnap = constrainAngle ? { snapped: false } : _snapSessionPoint(cur);
  const cursorDist = cursorSnap.snapped ? Math.hypot(cursorSnap.x - cur.x, cursorSnap.y - cur.y) : Infinity;
  const doc = getActiveDocument();
  const tol = (state.preferences.objectSnapRadius || 12) / (doc?.scale || 1.5);
  // Object snap: skipped while an axis is locked (it would break the lock)
  // and in the base-point flow (the user picked their reference point).
  const objSnap = (!mode.lockAxis && !mode.basePointFlow && !constrainAngle)
    ? _bestObjectSnap(dx, dy, tol) : null;

  if (objSnap && objSnap.dist <= cursorDist) {
    dx += objSnap.ddx;
    dy += objSnap.ddy;
    indicator = { x: objSnap.sp.x, y: objSnap.sp.y, snapped: true, type: objSnap.sp.type || 'endpoint' };
  } else if (cursorSnap.snapped) {
    dx = cursorSnap.x - mode.startX;
    dy = cursorSnap.y - mode.startY;
    if (mode.lockAxis === 'x') dy = 0;
    else if (mode.lockAxis === 'y') dx = 0;
    indicator = cursorSnap;
  }
  state.lastSnapResult = indicator;

  mode.lastDx = dx;
  mode.lastDy = dy;
  applyDeltaToAll(dx, dy);
  redraw();
}

function onKeyDown(e) {
  if (!mode) return;
  // Don't intercept keys while typing in inputs (paranoia — G-mode shouldn't
  // be entered while typing, but guard anyway).
  const inInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
  if (inInput) return;

  // CAD coord-input first: typed distances ("100"), offsets ("100,50"),
  // polar ("100<45") and absolute ("=x,y") drive the move exactly. Enter
  // with a valid buffer commits at the typed position; un-handled keys
  // (Escape with empty buffer, x/y, plain Enter) fall through below.
  if (!mode.awaitingBase && mode.startSeeded) {
    const r = typeLengthConsumeKey(e.key);
    if (r.handled) {
      e.preventDefault();
      e.stopPropagation();
      const lc = mode.lastCursor || { x: mode.startX + 1, y: mode.startY };
      if (r.committed) {
        const p = typeLengthApply(mode.startX, mode.startY, lc.x, lc.y);
        applyDeltaToAll(p.x - mode.startX, p.y - mode.startY);
        mode.lastDx = p.x - mode.startX;
        mode.lastDy = p.y - mode.startY;
        commitMove();
        return;
      }
      // Buffer edited (or cleared via Esc): live re-preview at the cursor.
      const p = typeLengthApply(mode.startX, mode.startY, lc.x, lc.y);
      mode.lastDx = p.x - mode.startX;
      mode.lastDy = p.y - mode.startY;
      applyDeltaToAll(mode.lastDx, mode.lastDy);
      redraw();
      return;
    }
  }

  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    cancelMove();
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    e.stopPropagation();
    commitMove();
    return;
  }
  if (e.key === 'x' || e.key === 'X') {
    e.preventDefault();
    e.stopPropagation();
    mode.lockAxis = mode.lockAxis === 'x' ? null : 'x';
    // Re-apply delta with new lock
    let dx = mode.lastDx, dy = mode.lastDy;
    if (mode.lockAxis === 'x') dy = 0;
    else if (mode.lockAxis === 'y') dx = 0;
    applyDeltaToAll(dx, dy);
    redraw();
    return;
  }
  if (e.key === 'y' || e.key === 'Y') {
    e.preventDefault();
    e.stopPropagation();
    mode.lockAxis = mode.lockAxis === 'y' ? null : 'y';
    let dx = mode.lastDx, dy = mode.lastDy;
    if (mode.lockAxis === 'x') dy = 0;
    else if (mode.lockAxis === 'y') dx = 0;
    applyDeltaToAll(dx, dy);
    redraw();
    return;
  }
  // 'G' again toggles off (cancel) — matches Blender muscle memory
  if (e.key === 'g' || e.key === 'G') {
    e.preventDefault();
    e.stopPropagation();
    cancelMove();
    return;
  }
}

let _lastDownT = 0;

function onMouseDown(e) {
  if (!mode) return;
  // ONE physical click fires BOTH pointerdown and mousedown (and synthetic
  // dispatchers mirror that). Without dedup the base-point pick ('mv') is
  // immediately followed by the duplicate event falling through to
  // commitMove() with a zero delta — "MV does nothing".
  const _now = performance.now();
  if (_now - _lastDownT < 80) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  _lastDownT = _now;
  // Left click: in the base-point flow the FIRST click picks the (snapped)
  // base point — the selection then tracks the cursor from that exact
  // point; the SECOND click commits. Plain G commits on the first click.
  if (e.button === 0) {
    e.preventDefault();
    e.stopPropagation();
    if (mode.awaitingBase) {
      const c = pointerToAppCoords(e);
      if (c) {
        // Own corners are valid pick targets here — see _snapSessionPoint.
        const snapped = _snapSessionPoint(c, { includeTargets: true });
        mode.startX = snapped.x;
        mode.startY = snapped.y;
        mode.startSeeded = true;
        mode.awaitingBase = false;
        state.lastSnapResult = snapped.snapped ? snapped : null;
        // From the base point on, typed distances steer the move ("100",
        // "100,50", "100<45", "=x,y") — scale-region aware at the anchor.
        enterTypeLengthMode(mode.startX, mode.startY);
      }
      return;
    }
    commitMove();
  } else if (e.button === 2) {
    e.preventDefault();
    e.stopPropagation();
    cancelMove();
  }
}

function onContextMenu(e) {
  // Suppress the context menu during G-mode (right-click is "cancel")
  if (mode) {
    e.preventDefault();
    e.stopPropagation();
  }
}

function attachListeners() {
  // Capture phase so we beat the canvas-level handlers (pointerdown etc.)
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
  exitTypeLengthMode();
  state.gMoveMode = null;
  state.lastSnapResult = null;
  mode = null;
  document.body.style.cursor = '';
}

export function isGMoveModeActive() {
  return !!mode;
}

export function commitMove() {
  if (!mode) return;
  // Re-bind every target by id FIRST — see _liveTarget.
  for (let i = 0; i < mode.targets.length; i++) _liveTarget(i);
  const { targets, originals } = mode;
  // Real-size parametric symbols (steel profiles) re-resolve their bbox at
  // the DESTINATION: moving into / out of a scale region resizes them to
  // stay true-to-scale there. No-op for every other annotation type.
  for (const ann of targets) {
    if (ann && ann.type === 'parametricSymbol') {
      try { applyTemplateRealSize(ann, 'center'); } catch (_) { /* keep moved size */ }
    }
  }
  // Detect any change vs. originals before recording (avoid empty undo entries)
  const changed = targets.some((ann, i) =>
    originals[i] && JSON.stringify(ann) !== JSON.stringify(originals[i])
  );
  if (mode.insertedCopies) {
    recordBulkAdd(targets);
  } else if (changed) {
    if (targets.length > 1) {
      recordBulkModify(targets, originals);
    } else if (targets.length === 1) {
      recordModify(targets[0].id, originals[0], targets[0]);
    }
  }
  endMode();
  redraw();
}

export function cancelMove() {
  if (!mode) return;
  if (mode.insertedCopies) {
    const doc = getActiveDocument();
    const insertedIds = new Set(mode.targets.map(annotation => annotation.id));
    doc.annotations = doc.annotations.filter(annotation => !insertedIds.has(annotation.id));
    doc.selectedAnnotations = mode.restoreSelection || [];
    doc.selectedAnnotation = doc.selectedAnnotations[0] || null;
    endMode();
    redraw();
    return;
  }
  // Restore originals (identity-safe: re-bind by id first)
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
 * Try to enter G-move mode. Returns true if mode was started, false otherwise.
 * Caller should preventDefault on the keypress when this returns true.
 */
/**
 * options.basePoint: true → AutoCAD-style two-click flow ('mv' chord):
 * click 1 picks the (object-snapped) BASE point, the selection then tracks
 * the cursor relative to it, click 2 commits — exact point-to-point moves.
 * Default (G key): Blender-style, selection follows immediately.
 */
export function tryStartGMove(options = {}) {
  if (mode) return false; // already active
  if (state.gRotateMode) return false; // rotate session owns the pointer
  if (isPdfAReadOnly()) return false;
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return false;
  // Target resolution lives in the edit-ops layer (selection → fresh-hover
  // fallback) — ONE rule shared by every edit operation.
  const selected = getEditTargets();
  if (selected.length === 0) return false;

  // Clear any stale drag/resize state so G ALWAYS moves whole annotations —
  // a leftover activeHandle from a prior select-tool interaction would
  // otherwise resize one endpoint instead.
  state.isResizing = false;
  state.isDragging = false;
  state.activeHandle = null;
  state.originalAnnotation = null;

  // Seed the move origin from the tracker ONLY when it is FRESH. A stale
  // tracker (cursor left the canvas before the keypress) would make the
  // first real mouse move apply a huge delta — annotations teleporting
  // off-page was exactly the reported "copy/move does nothing" bug. When
  // not fresh, the first onMouseMove seeds the origin instead (startSeeded).
  const hasTracker = trackerFresh();
  const startX = hasTracker ? state._lastMouseAppX : 0;
  const startY = hasTracker ? state._lastMouseAppY : 0;

  mode = {
    active: true,
    targets: selected.slice(),
    originals: selected.map(a => cloneAnnotation(a)),
    lockAxis: null,
    startX,
    startY,
    startSeeded: hasTracker,
    awaitingBase: !!options.basePoint,
    basePointFlow: !!options.basePoint,
    insertedCopies: !!options.insertedCopies,
    restoreSelection: options.restoreSelection?.slice() || [],
    lastDx: 0,
    lastDy: 0,
    lastCursor: hasTracker ? { x: startX, y: startY } : null,
    ownPoints: [],
    staticPoints: []
  };
  // Candidates for corner-to-corner object snap; own points translate with
  // the delta, static geometry doesn't change during the session.
  _cacheObjectSnapPoints();
  // Typed distances work from the moment the session has an anchor (plain G
  // with a fresh cursor); the 'mv' flow re-anchors at the picked base point.
  if (hasTracker && !options.basePoint) enterTypeLengthMode(startX, startY);
  state.gMoveMode = mode;
  document.body.style.cursor = 'move';
  attachListeners();
  return true;
}

// Track the most recent mouse position (in app-space) so that pressing G
// uses the cursor's current location as the move origin rather than (0,0).
// The timestamp lets the edit-ops layer reject STALE positions.
function trackMouse(e) {
  const c = pointerToAppCoords(e);
  if (c) {
    state._lastMouseAppX = c.x;
    state._lastMouseAppY = c.y;
    state._lastMouseAppT = performance.now();
  }
}

let trackingInstalled = false;
export function installGMoveMouseTracker() {
  if (trackingInstalled) return;
  trackingInstalled = true;
  document.addEventListener('mousemove', trackMouse, true);
}
