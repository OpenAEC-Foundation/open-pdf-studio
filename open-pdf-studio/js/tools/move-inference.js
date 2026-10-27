// Move inference session (#519): glue between the move mode (g-move-mode.js),
// the snap candidates (snap-engine.js / PDF content) and the pure inference
// engine (inference-engine.js). Builds the bounded candidate indexes once per
// session, runs the inference per mousemove, tracks acquired points and
// publishes the overlay (inference-overlay.js).

import {
  createPointIndex, createSegmentIndex, createAcquirer, inferMove, makeLine,
  screenAxis, isPointSnapType, snapPriority, resolveSnapPriority, INFERENCE_PRIORITY,
} from './inference-engine.js';
import { getEdgeSegments } from './snap-engine.js';
import { getPdfEdgeSegmentsNear } from './pdf-snap-extractor.js';
import { computeWallShape } from '../annotations/rendering/walls.js';
import { getMeasureScale } from '../annotations/measurement.js';
import { setMoveInferenceOverlay, clearMoveInferenceOverlay } from './inference-overlay.js';
import i18next from '../i18n/config.js';

export { isPointSnapType, snapPriority, resolveSnapPriority, INFERENCE_PRIORITY };

// Tolerances in SCREEN pixels (divided by the zoom where used).
const TRACK_TOL_PX = 6;
const REACH_PX = 1500;          // max distance along a tracking guide
const EXTENSION_REACH_PX = 400; // max distance beyond a line's endpoint
const ACQUIRE_MS = 400;
const MAX_ACQUIRED = 4;
const MAX_OWN_PROBES = 12;
const MAX_PDF_SEGMENTS = 400;   // per query; the PDF index is local already

export const GUIDE_COLORS = Object.freeze({
  x: '#e53935',         // screen X (horizontal)
  y: '#2e9d3a',         // screen Y (vertical)
  parallel: '#d000d0',  // parallel / perpendicular
  extension: '#ff8c00',
  polar: '#cc66cc',
  intersection: '#1565c0',
});

const OWN_TYPE_RANK = { corner: 0, endpoint: 0, vertex: 0, startpoint: 0, center: 1, quadrant: 2, midpoint: 2 };

/**
 * Pick at most `max` snap points of the moving selection as tracking probes:
 * corners/endpoints first, then centres, then midpoints; duplicates dropped.
 */
export function selectOwnProbes(ownPoints, max = MAX_OWN_PROBES) {
  const sorted = (ownPoints || []).slice().sort((a, b) => (OWN_TYPE_RANK[a.type] ?? 3) - (OWN_TYPE_RANK[b.type] ?? 3));
  const out = [];
  for (const p of sorted) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (out.some(q => Math.abs(q.x - p.x) < 1e-6 && Math.abs(q.y - p.y) < 1e-6)) continue;
    out.push(p);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Static segments of the page for extension / parallel inference: annotation
 * edges (lines, polylines, rectangles …) plus the FACES of walls (the band
 * outline, not only the axis). Annotations in `excludeIds` (the moving
 * selection) are skipped — moving never infers from itself.
 */
export function collectStaticSegments(annotations, page, excludeIds) {
  const segs = [];
  const onPage = (annotations || []).filter(a => a && a.page === page && a.type !== 'draw'
    && !(excludeIds && excludeIds.has(a.id)));
  const walls = (annotations || []).filter(a => a && a.page === page && a.type === 'wall');
  for (const ann of onPage) {
    try {
      for (const s of getEdgeSegments(ann)) segs.push({ x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, annotation: ann });
    } catch (_) { /* best-effort */ }
    if (ann.type === 'wall') {
      try {
        const poly = computeWallShape(ann, walls)?.poly;
        if (poly && poly.length > 1) {
          for (let i = 0; i < poly.length; i++) {
            const p = poly[i], q = poly[(i + 1) % poly.length];
            segs.push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y, annotation: ann, face: true });
          }
        }
      } catch (_) { /* best-effort */ }
    }
  }
  return segs;
}

function _t(key, fallback, opts) {
  try {
    const v = i18next?.t?.(`common:moveInference.${key}`, opts);
    if (typeof v === 'string' && v && !v.endsWith(`moveInference.${key}`)) return v;
  } catch (_) { /* i18n not ready */ }
  return fallback;
}

/**
 * Create the inference session for one move.
 *   staticIndex   createPointIndex over the static snap points (selection excluded)
 *   annotations, page, excludeIds
 *   ownPoints     snap points of the selection at their ORIGINAL position
 *   start         base point of the move
 *   onAcquire     callback when an acquisition timer fires (re-evaluate + redraw)
 */
export function createMoveInferenceSession({
  staticIndex, annotations, page, excludeIds, ownPoints, start, onAcquire, pdfSegments = true,
}) {
  const segIndex = createSegmentIndex(collectStaticSegments(annotations, page, excludeIds));
  const own = selectOwnProbes(ownPoints);
  const acquirer = createAcquirer({ delayMs: ACQUIRE_MS, max: MAX_ACQUIRED });
  let timer = null;
  let anchor = { x: start.x, y: start.y };

  function segmentQuery(x, y, r) {
    const out = segIndex.near(x, y, r);
    if (pdfSegments) {
      try {
        const pdf = getPdfEdgeSegmentsNear(page, x, y, r);
        const lim = Math.min(pdf.length, MAX_PDF_SEGMENTS);
        for (let i = 0; i < lim; i++) out.push(pdf[i]);
      } catch (_) { /* PDF geometry not loaded */ }
    }
    return out;
  }

  function clearTimer() {
    if (timer) { clearTimeout(timer); timer = null; }
  }

  return {
    page,
    setStart(p) { anchor = { x: p.x, y: p.y }; },
    acquired: () => acquirer.list(),
    /** Feed the hovered static snap point (or null); schedules acquisition. */
    hover(pt) {
      clearTimer();
      const r = acquirer.update(pt, performance.now());
      if (r.pendingMs > 0 && typeof onAcquire === 'function') {
        timer = setTimeout(() => {
          timer = null;
          const r2 = acquirer.update(pt, performance.now());
          if (r2.changed) onAcquire();
        }, r.pendingMs + 5);
      }
      return r.changed;
    },
    /**
     * Run the inference for the raw cursor. prefs = state.preferences.
     * Returns null or the engine result.
     */
    infer(cursor, { prefs, scale, lockLine = null } = {}) {
      const sc = scale > 0 ? scale : 1;
      const tol = TRACK_TOL_PX / sc;
      const enable = {
        tracking: prefs.moveInferenceTracking !== false,
        extension: prefs.moveInferenceExtension !== false,
        parallel: prefs.moveInferenceParallel !== false,
      };
      const polar = prefs.polarTrackingEnabled
        ? { incrementDeg: prefs.polarIncrement || 45, toleranceDeg: prefs.polarTolerance ?? 3 }
        : null;
      if (!enable.tracking && !enable.extension && !enable.parallel && !polar && !lockLine) return null;
      const dx = cursor.x - anchor.x, dy = cursor.y - anchor.y;
      const probes = own.map(op => ({ x: op.x + dx, y: op.y + dy, ox: op.x - anchor.x, oy: op.y - anchor.y, type: op.type }));
      return inferMove({
        start: anchor, cursor, probes, pointIndex: enable.tracking ? staticIndex : null,
        segmentQuery, acquired: enable.tracking ? acquirer.list() : [],
        tol, reach: REACH_PX / sc, angleTolDeg: Math.max(1, Math.min(prefs.polarTolerance ?? 3, 5)),
        polar, enable, lockLine,
        extensionReach: EXTENSION_REACH_PX / sc, extensionProbes: 5,
      });
    },
    dispose() {
      clearTimer();
      acquirer.clear();
      clearMoveInferenceOverlay();
    },
  };
}

function _guideColor(g, quarterTurn) {
  if (g.kind === 'parallel' || g.kind === 'perpendicular') return GUIDE_COLORS.parallel;
  const ax = screenAxis(g.line.dx, g.line.dy, quarterTurn);
  if (ax) return GUIDE_COLORS[ax];
  if (g.kind === 'extension') return GUIDE_COLORS.extension;
  if (g.kind === 'polar') return GUIDE_COLORS.polar;
  return GUIDE_COLORS.intersection;
}

function _guideLabel(g, quarterTurn, angleDeg) {
  switch (g.kind) {
    case 'axis': {
      const ax = screenAxis(g.line.dx, g.line.dy, quarterTurn);
      return ax === 'y' ? _t('onAxisY', 'On Y axis') : _t('onAxisX', 'On X axis');
    }
    case 'tracking':
    case 'acquired': return _t('fromPoint', 'From point');
    case 'extension': return _t('extension', 'On extension');
    case 'parallel': return _t('parallel', 'Parallel');
    case 'perpendicular': return _t('perpendicular', 'Perpendicular');
    case 'polar': return `${_t('polar', 'Polar')} ${angleDeg.toFixed(0)}°`;
    case 'locked': return _t('locked', 'Locked');
    default: return '';
  }
}

/**
 * Overlay for an inference result. `delta` is the applied move (result −
 * start); own-point guides are drawn at the probe's real position.
 */
export function buildInferenceOverlay(result, {
  page, start, acquired = [], quarterTurn = false, scale = 1, showDistance = true,
} = {}) {
  const sc = scale > 0 ? scale : 1;
  const lines = [];
  const markers = [];
  for (const a of acquired) markers.push({ x: a.x, y: a.y, kind: 'acquired', color: GUIDE_COLORS.extension });
  let label = null;
  if (result) {
    const R = { x: result.x, y: result.y };
    const far = 50000;
    const over = 30 / sc;
    for (const g of result.guides || []) {
      const color = _guideColor(g, quarterTurn);
      const ox = g.probe ? g.probe.ox : 0, oy = g.probe ? g.probe.oy : 0;
      const P = { x: R.x + ox, y: R.y + oy }; // where the probe really is
      const throughStart = g.kind === 'axis' || g.kind === 'polar' || g.kind === 'parallel'
        || g.kind === 'perpendicular' || g.kind === 'locked';
      if (throughStart) {
        lines.push({ x1: g.line.px - g.line.dx * far, y1: g.line.py - g.line.dy * far,
          x2: g.line.px + g.line.dx * far, y2: g.line.py + g.line.dy * far, color, width: g.kind === 'locked' ? 1.4 : 0.8 });
      } else if (g.source) {
        const vx = P.x - g.source.x, vy = P.y - g.source.y;
        const len = Math.hypot(vx, vy) || 1;
        lines.push({ x1: g.source.x, y1: g.source.y, x2: P.x + (vx / len) * over, y2: P.y + (vy / len) * over, color });
        markers.push({ x: g.source.x, y: g.source.y, kind: 'source', color });
      }
      if (g.segment && (g.kind === 'parallel' || g.kind === 'perpendicular')) {
        const s = g.segment;
        lines.push({ x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, color, dash: false, width: 1.6 });
        const ang = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
        markers.push({ x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2, kind: g.kind, color, angle: ang });
      }
    }
    if (result.kind === 'intersection') markers.push({ x: R.x, y: R.y, kind: 'intersection', color: GUIDE_COLORS.intersection });
    const g0 = (result.guides || [])[0];
    let text = '';
    let color = '#333333';
    if (result.kind === 'intersection') {
      text = _t('intersection', 'Intersection');
      color = GUIDE_COLORS.intersection;
    } else if (g0) {
      const ang = ((Math.atan2(-g0.line.dy, g0.line.dx) * 180) / Math.PI + 360) % 360;
      text = _guideLabel(g0, quarterTurn, ang);
      color = _guideColor(g0, quarterTurn);
    }
    if (text && showDistance && start) {
      const len = Math.hypot(R.x - start.x, R.y - start.y);
      try {
        const ms = getMeasureScale(page, start.x, start.y);
        const ppu = ms?.pixelsPerUnit > 0 ? ms.pixelsPerUnit : 1;
        text += ` · ${(len / ppu).toFixed(2)} ${ms?.unit || 'mm'}`;
      } catch (_) { /* no scale */ }
    }
    if (text) label = { x: R.x, y: R.y, text, color };
  }
  return { page, lines, markers, label };
}

/** Publish (or clear with null) the overlay for the render passes. */
export function publishInferenceOverlay(overlay) {
  if (overlay && (overlay.lines.length || overlay.markers.length || overlay.label)) setMoveInferenceOverlay(overlay);
  else clearMoveInferenceOverlay();
}

/** Lock line for an X/Y axis lock through the base point. */
export function axisLockLine(start, lockAxis) {
  if (lockAxis === 'x') return makeLine(start.x, start.y, 1, 0);
  if (lockAxis === 'y') return makeLine(start.x, start.y, 0, 1);
  return null;
}

export { createPointIndex };
