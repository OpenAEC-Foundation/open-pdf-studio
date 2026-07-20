// Split & Break — click-driven CAD edit tools that operate on straight lines
// (line / arrow / measureDistance). They follow the same interaction contract
// as trim-tool / extend-tool: work purely off pointer clicks, no drag preview.
//
//   * Split — one click on a line splits it in two at the clicked point.
//   * Break — two clicks on the SAME line remove the span between the picks,
//             leaving a gap (two shorter lines).
//
// Both keep the original annotation as the FIRST piece (recordModify) and add
// the remaining piece(s) as fresh line annotations (recordAdd), matching the
// non-atomic multi-step undo convention already used by trim-tool.

import { getActiveDocument } from '../../core/state.js';
import { cloneAnnotation } from '../../annotations/factory.js';
import { recordModify, recordAdd, beginUndoTransaction, endUndoTransaction } from '../../core/undo-manager.js';
import { redrawAnnotations, redrawContinuous } from '../../annotations/rendering.js';

function _redraw() {
  if (getActiveDocument()?.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

function _newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 11);
}

// A straight line annotation exposes start/end endpoints.
function _isLine(ann) {
  return ann && ann.startX !== undefined && ann.endX !== undefined &&
    (ann.type === 'line' || ann.type === 'arrow' || ann.type === 'measureDistance');
}

// Project point p onto the infinite line through a→b; returns { x, y, t }
// where t is the normalised position along a→b (0 at a, 1 at b).
function _project(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return { x: a.x, y: a.y, t: 0 };
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  return { x: a.x + t * dx, y: a.y + t * dy, t };
}

// Build a fresh line clone of `src` between two points, preserving style.
function _lineFrom(src, p1, p2) {
  const c = cloneAnnotation(src);
  c.id = _newId();
  c.type = 'line';                 // a broken piece is a plain line segment
  c.startX = p1.x; c.startY = p1.y;
  c.endX = p2.x; c.endY = p2.y;
  // Drop measurement-specific fields so a split measureDistance doesn't carry
  // a stale label; the piece becomes a neutral line.
  delete c.measureText; delete c.measureValue; delete c.measureUnit;
  delete c.measurePixels; delete c.leaderStartX; delete c.leaderStartY;
  delete c.leaderEndX; delete c.leaderEndY;
  const now = new Date().toISOString();
  c.createdAt = now; c.modifiedAt = now;
  return c;
}

export const splitTool = {
  name: 'split',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    if (e.button !== 0) return;
    const { x, y } = ctx;
    const clicked = ctx.findAnnotationAt(x, y);
    if (!_isLine(clicked)) return;

    const a = { x: clicked.startX, y: clicked.startY };
    const b = { x: clicked.endX, y: clicked.endY };
    const pr = _project({ x, y }, a, b);
    // Ignore clicks that project onto (or beyond) an endpoint — nothing to split.
    if (pr.t <= 0.02 || pr.t >= 0.98) return;
    const cut = { x: pr.x, y: pr.y };

    const doc = getActiveDocument();
    const oldState = cloneAnnotation(clicked);

    // First half stays in the original annotation; drop measure fields so a
    // split dimension becomes two neutral lines.
    clicked.type = 'line';
    clicked.endX = cut.x; clicked.endY = cut.y;
    delete clicked.measureText; delete clicked.measureValue; delete clicked.measureUnit;
    delete clicked.measurePixels; delete clicked.leaderStartX; delete clicked.leaderStartY;
    delete clicked.leaderEndX; delete clicked.leaderEndY;
    clicked.modifiedAt = new Date().toISOString();
    const second = _lineFrom(oldState, cut, b);
    if (doc) doc.annotations.push(second);
    beginUndoTransaction();
    recordModify(clicked.id, oldState, clicked);
    recordAdd(second);

    if (doc) { doc.selectedAnnotations = [clicked, second]; doc.selectedAnnotation = clicked; }
    endUndoTransaction();
    _redraw();
    import('../../tools/manager.js').then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());
  },

  onDeactivate() {},
};

const _breakState = { line: null, first: null };

export const breakTool = {
  name: 'break',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    if (e.button !== 0) return;
    const { x, y } = ctx;

    if (!_breakState.line) {
      const clicked = ctx.findAnnotationAt(x, y);
      if (!_isLine(clicked)) return;
      const a = { x: clicked.startX, y: clicked.startY };
      const b = { x: clicked.endX, y: clicked.endY };
      const pr = _project({ x, y }, a, b);
      if (pr.t <= 0.02 || pr.t >= 0.98) return;
      _breakState.line = clicked;
      _breakState.first = { x: pr.x, y: pr.y, t: pr.t };
      const doc = getActiveDocument();
      if (doc) { doc.selectedAnnotations = [clicked]; doc.selectedAnnotation = clicked; }
      _redraw();
      return;
    }

    // Second click: only valid on the SAME line.
    const line = _breakState.line;
    const a = { x: line.startX, y: line.startY };
    const b = { x: line.endX, y: line.endY };
    const pr2 = _project({ x, y }, a, b);
    if (pr2.t <= 0.02 || pr2.t >= 0.98) { _reset(); return; }

    // Order the two cut params so p1 is nearer the start.
    let t1 = _breakState.first.t, p1 = { x: _breakState.first.x, y: _breakState.first.y };
    let t2 = pr2.t, p2 = { x: pr2.x, y: pr2.y };
    if (t2 < t1) { [t1, t2] = [t2, t1]; [p1, p2] = [p2, p1]; }
    if (t2 - t1 < 0.02) { _reset(); return; } // gap too small — nothing to do

    const doc = getActiveDocument();
    const oldState = cloneAnnotation(line);

    // Keep the head (start → p1) in the original; add the tail (p2 → end).
    line.type = 'line';
    line.endX = p1.x; line.endY = p1.y;
    delete line.measureText; delete line.measureValue; delete line.measureUnit;
    delete line.measurePixels; delete line.leaderStartX; delete line.leaderStartY;
    delete line.leaderEndX; delete line.leaderEndY;
    line.modifiedAt = new Date().toISOString();
    const tail = _lineFrom(oldState, p2, b);
    if (doc) doc.annotations.push(tail);
    beginUndoTransaction();
    recordModify(line.id, oldState, line);
    recordAdd(tail);

    if (doc) { doc.selectedAnnotations = [line, tail]; doc.selectedAnnotation = line; }
    endUndoTransaction();
    _reset();
    _redraw();
    import('../../tools/manager.js').then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());
  },

  onDeactivate() { _reset(); },
};

function _reset() {
  _breakState.line = null;
  _breakState.first = null;
}
