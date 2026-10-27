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
//   - Inference (#519, move-inference.js): tracking/alignment lines, acquired
//     points (hover briefly), extension lines, parallel/perpendicular and
//     polar guides; Shift locks the shown guide, Tab switches the typed
//     entry between distance and angle
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
import { viewportNaarPagina } from '../pdf/weergave-rotatie.js';
import { weergaveNaarPagina } from '../pdf/weergave-ruimte.js';
import { applyTemplateRealSize } from '../symbols/real-size.js';
import { getEditTargets, trackerFresh } from './edit-ops.js';
import { performSnap, collectSnapPoints } from './snap-engine.js';
import { getCachedPdfSnapPoints } from './pdf-snap-extractor.js';
import {
  enterTypeLengthMode, exitTypeLengthMode, typeLengthHasBuffer,
  consumeKey as typeLengthConsumeKey, applyToEndpoint as typeLengthApply,
  setTypeLengthCursorScreen, cycleTypeLengthField,
} from './type-length-input.js';
import { snapAngle } from '../utils/helpers.js';
import {
  createPointIndex, createMoveInferenceSession, buildInferenceOverlay, publishInferenceOverlay,
  axisLockLine, isPointSnapType, snapPriority, resolveSnapPriority, INFERENCE_PRIORITY,
} from './move-inference.js';
import { weergaveRotatie } from '../pdf/weergave-ruimte.js';
import { isKwartslag } from '../pdf/weergave-rotatie.js';

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
  const page = _sessionPage();
  const r = performSnap(
    c.x, c.y, doc.annotations || [], page, doc.scale || 1.5,
    includeTargets ? undefined : _excludeSet()
  );
  // Page tag: the continuous render path draws the indicator on this page only.
  return r.snapped ? { ...r, page } : r;
}

// The page the session works on: the page of the moved annotations (in
// continuous mode doc.currentPage need not be the page under the cursor).
function _sessionPage() {
  const doc = getActiveDocument();
  return mode?.targets?.[0]?.page || doc?.currentPage || 1;
}

// Corner-to-corner object snap: when a snap point OF THE MOVING SELECTION
// (corner, endpoint, midpoint…) lands within snap radius of a STATIC snap
// point, the delta is adjusted so the two points click together exactly —
// "de hoek van het element" snaps, not just the cursor. Candidates are
// cached at session start; own points simply translate with the delta.
// Static candidates live in a spatial index (inference-engine.js), so dense
// CAD pages keep object snap and inference instead of switching them off.
// PDF content beyond this many points is limited to a window around the
// cursor at session start.
const _OBJ_SNAP_MAX_STATIC = 250000;
const _PDF_WINDOW = 3000; // app units around the session start

function _cacheObjectSnapPoints() {
  const doc = getActiveDocument();
  if (!doc || !mode) return;
  const page = _sessionPage();
  try {
    mode.ownPoints = collectSnapPoints(mode.targets, page);
    const statics = collectSnapPoints(doc.annotations || [], page, _excludeSet());
    if (state.preferences.snapToPdfContent) {
      const pdf = getCachedPdfSnapPoints(page);
      const room = _OBJ_SNAP_MAX_STATIC - statics.length;
      if (pdf.length <= room) {
        for (const pt of pdf) statics.push(pt);
      } else {
        const cx = mode.startSeeded ? mode.startX : (state._lastMouseAppX || 0);
        const cy = mode.startSeeded ? mode.startY : (state._lastMouseAppY || 0);
        for (const pt of pdf) {
          if (statics.length >= _OBJ_SNAP_MAX_STATIC) break;
          if (Math.abs(pt.x - cx) <= _PDF_WINDOW && Math.abs(pt.y - cy) <= _PDF_WINDOW) statics.push(pt);
        }
      }
    }
    const c2d = doc.cursor2D;
    if (c2d && c2d.page === page) statics.push({ x: c2d.x, y: c2d.y, type: 'endpoint', annotation: null });
    mode.staticPoints = statics;
  } catch (_) {
    mode.ownPoints = [];
    mode.staticPoints = [];
  }
  mode.staticIndex = createPointIndex(mode.staticPoints);
  try {
    mode.inference = createMoveInferenceSession({
      staticIndex: mode.staticIndex,
      annotations: doc.annotations || [],
      page,
      excludeIds: _excludeSet(),
      ownPoints: mode.ownPoints,
      start: { x: mode.startX, y: mode.startY },
      pdfSegments: !!(state.preferences.snapToPdfContent && state.preferences.enableObjectSnap),
      onAcquire: () => {
        if (!mode || mode.awaitingBase || !mode.rawCursor) return;
        _track(mode.rawCursor, mode.lastShift);
        redraw();
      },
    });
  } catch (_) {
    mode.inference = null;
  }
}

// Find the best own-point→static-point pairing for a candidate delta.
// Returns { dist, ddx, ddy, sp } or null.
function _bestObjectSnap(dx, dy, tol) {
  if (!mode?.ownPoints?.length || !mode?.staticIndex?.size) return null;
  let best = null;
  for (const op of mode.ownPoints) {
    const px = op.x + dx, py = op.y + dy;
    const n = mode.staticIndex.nearest(px, py, tol);
    if (n && (!best || n.dist < best.dist)) {
      best = { dist: n.dist, ddx: n.point.x - px, ddy: n.point.y - py, sp: n.point };
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
  // Doorlopend: canvas is een viewport-uitsnede; pagina-oorsprong = container.
  const meetEl = (getActiveDocument()?.viewMode === 'continuous'
    && canvas.closest && canvas.closest('.canvas-container-cont')) || canvas;
  const rect = meetEl.getBoundingClientRect();
  const vp = window.__pdfViewport;
  const doc = getActiveDocument();
  // Met een gedraaide weergave (#200) van het scherm terug naar de pagina.
  if (vp && vp.active && doc?.viewMode !== 'continuous') {
    return viewportNaarPagina(vp, e.clientX - rect.left, e.clientY - rect.top);
  }
  const pagina = parseInt(canvas.dataset?.page ?? meetEl.dataset?.page, 10) || doc?.currentPage || 1;
  return weergaveNaarPagina(pagina, (e.clientX - rect.left) / scale, (e.clientY - rect.top) / scale, doc);
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
  _track(cRaw, e.shiftKey);
  redraw();
}

// One tracking step: cursor → (snapped / inferred / typed) delta, applied to
// the selection. Also run by the acquisition timer and on Shift release.
function _track(cRaw, shiftKey) {
  const prefs = state.preferences;
  const doc = getActiveDocument();
  const scale = doc?.scale || 1.5;
  const start = { x: mode.startX, y: mode.startY };
  const page = _sessionPage();
  mode.rawCursor = cRaw;
  mode.lastShift = !!shiftKey;
  if (mode.inference) mode.inference.setStart(start);

  // Shift: with a guide on screen it LOCKS that guide (the cursor may move
  // away, the move stays on the line); without one it is the CAD ortho/angle
  // constraint: the start→cursor direction snaps to angleSnapDegrees
  // multiples (45°).
  if (!shiftKey) mode.lockedLine = null;
  else if (!mode.lockedLine && mode.lastInference?.lockable) mode.lockedLine = mode.lastInference.lockable;
  const constrainAngle = !!shiftKey && !mode.lockedLine && prefs.enableAngleSnap;
  let cur = cRaw;
  if (constrainAngle) {
    const ddx = cRaw.x - mode.startX;
    const ddy = cRaw.y - mode.startY;
    const len = Math.hypot(ddx, ddy);
    if (len > 1e-6) {
      const ang = snapAngle(Math.atan2(ddy, ddx) * (180 / Math.PI),
        prefs.angleSnapDegrees || 45) * (Math.PI / 180);
      cur = { x: mode.startX + len * Math.cos(ang), y: mode.startY + len * Math.sin(ang) };
    }
  }

  // Candidates, resolved by priority (inference-engine.js):
  //   1. point object snaps — the cursor itself, or a corner/endpoint of the
  //      MOVING selection ("hoek van het element"), lands on a static point;
  //      of these two the closest wins (stacking them would double-correct)
  //   2. inference — intersections of guides, tracking / extension /
  //      parallel / perpendicular / polar / axis lines
  //   3. soft snaps — edge, nearest, grid
  // Typed coordinates override all of them (below).
  let dx = cur.x - start.x;
  let dy = cur.y - start.y;
  if (mode.lockAxis === 'x') dy = 0;
  else if (mode.lockAxis === 'y') dx = 0;

  const freeSnaps = !constrainAngle && !mode.lockedLine;
  const cursorSnap = freeSnaps ? _snapSessionPoint(cur) : { snapped: false };
  const cursorDist = cursorSnap.snapped ? Math.hypot(cursorSnap.x - cur.x, cursorSnap.y - cur.y) : Infinity;
  const tol = (prefs.objectSnapRadius || 12) / scale;
  // Object snap: skipped while an axis is locked (it would break the lock)
  // and in the base-point flow (the user picked their reference point).
  const objSnap = (!mode.lockAxis && !mode.basePointFlow && freeSnaps)
    ? _bestObjectSnap(dx, dy, tol) : null;

  const cands = [];
  if (objSnap && objSnap.dist <= cursorDist) {
    cands.push({ src: 'object', priority: INFERENCE_PRIORITY.point, dist: objSnap.dist, hover: objSnap.sp });
  } else if (cursorSnap.snapped) {
    cands.push({ src: 'cursor', priority: snapPriority(cursorSnap.type), dist: cursorDist,
      hover: isPointSnapType(cursorSnap.type) ? cursorSnap : null });
  }
  const pointWins = cands.length && cands[0].priority >= INFERENCE_PRIORITY.point;
  // Hovering a static point briefly acquires it as a tracking point.
  if (mode.inference) mode.inference.hover(pointWins ? cands[0].hover : null);

  let inferred = null;
  if (!pointWins && !constrainAngle && mode.inference) {
    const lockLine = mode.lockedLine || axisLockLine(start, mode.lockAxis);
    try {
      inferred = mode.inference.infer(cur, { prefs, scale, lockLine });
    } catch (err) {
      console.warn('[gmove] inference failed:', err);
      inferred = null;
    }
    // An X/Y axis lock alone is not an inference: only crossings with guides.
    if (inferred && inferred.kind === 'locked' && !mode.lockedLine) inferred = null;
    if (inferred) cands.push({ src: 'inference', priority: inferred.priority, dist: inferred.dist });
  }

  const win = resolveSnapPriority(cands);
  let indicator = null;
  if (win?.src === 'object') {
    dx += objSnap.ddx;
    dy += objSnap.ddy;
    indicator = { x: objSnap.sp.x, y: objSnap.sp.y, snapped: true, type: objSnap.sp.type || 'endpoint', page };
  } else if (win?.src === 'cursor') {
    dx = cursorSnap.x - start.x;
    dy = cursorSnap.y - start.y;
    if (mode.lockAxis === 'x') dy = 0;
    else if (mode.lockAxis === 'y') dx = 0;
    indicator = cursorSnap;
  } else if (win?.src === 'inference') {
    dx = inferred.x - start.x;
    dy = inferred.y - start.y;
    if (mode.lockAxis === 'x') dy = 0;
    else if (mode.lockAxis === 'y') dx = 0;
  }
  mode.lastInference = win?.src === 'inference' ? inferred : null;

  // The (snapped / inferred) position is the DIRECTION for a typed distance.
  const dir = Math.hypot(dx, dy) > 1e-9 ? { x: start.x + dx, y: start.y + dy } : cur;
  mode.lastCursor = dir;

  // Typed coordinate input ("100", "100,50", "100<45", "=x,y") overrides
  // every snap: the number IS the instruction. A plain distance moves along
  // the inferred direction.
  const typed = typeLengthApply(start.x, start.y, dir.x, dir.y);
  if (typed.constrained) {
    dx = typed.x - start.x;
    dy = typed.y - start.y;
    if (mode.lockAxis === 'x') dy = 0;
    else if (mode.lockAxis === 'y') dx = 0;
    indicator = null;
  }
  state.lastSnapResult = indicator;
  _publishOverlay();

  mode.lastDx = dx;
  mode.lastDy = dy;
  applyDeltaToAll(dx, dy);
}

function _publishOverlay() {
  if (!mode) return;
  const doc = getActiveDocument();
  publishInferenceOverlay(buildInferenceOverlay(mode.lastInference, {
    page: _sessionPage(),
    start: { x: mode.startX, y: mode.startY },
    acquired: mode.inference ? mode.inference.acquired() : [],
    quarterTurn: isKwartslag(weergaveRotatie(doc)),
    scale: doc?.scale || 1.5,
  }));
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
    // Tab switches the typed entry between distance and angle ("100" →
    // "100<", then toggles the field). Always swallowed: focus must not
    // leave the canvas mid-move.
    if (e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      if (cycleTypeLengthField()) {
        const lc = mode.lastCursor || { x: mode.startX + 1, y: mode.startY };
        const p = typeLengthApply(mode.startX, mode.startY, lc.x, lc.y);
        mode.lastDx = p.x - mode.startX;
        mode.lastDy = p.y - mode.startY;
        applyDeltaToAll(mode.lastDx, mode.lastDy);
        redraw();
      }
      return;
    }
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
        if (mode.inference) mode.inference.setStart({ x: mode.startX, y: mode.startY });
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

// Releasing Shift drops a locked guide at once (no mouse move needed).
function onKeyUp(e) {
  if (!mode || e.key !== 'Shift') return;
  if (mode.lockedLine && !mode.awaitingBase && mode.startSeeded && mode.rawCursor) {
    mode.lockedLine = null;
    _track(mode.rawCursor, false);
    redraw();
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
  document.addEventListener('keyup', onKeyUp, true);
  document.addEventListener('contextmenu', onContextMenu, true);
}

function detachListeners() {
  document.removeEventListener('mousemove', onMouseMove, true);
  document.removeEventListener('pointermove', onMouseMove, true);
  document.removeEventListener('mousedown', onMouseDown, true);
  document.removeEventListener('pointerdown', onMouseDown, true);
  document.removeEventListener('keydown', onKeyDown, true);
  document.removeEventListener('keyup', onKeyUp, true);
  document.removeEventListener('contextmenu', onContextMenu, true);
}

function endMode() {
  detachListeners();
  exitTypeLengthMode();
  try { mode?.inference?.dispose(); } catch (_) { /* overlay cleanup is best-effort */ }
  publishInferenceOverlay(null);
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
    staticPoints: [],
    staticIndex: null,
    // Inference (#519): session, last shown inference, Shift-locked guide.
    inference: null,
    lastInference: null,
    lockedLine: null,
    rawCursor: null,
    lastShift: false
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
