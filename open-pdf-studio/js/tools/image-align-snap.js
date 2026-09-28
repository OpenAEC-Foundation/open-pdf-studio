// Alignment snapping for IMAGE annotations.
//
// Two design-tool style behaviours, both hooked into the ONE interactive
// drag/resize path in tool-dispatcher.js (never a second input engine):
//
//   * MOVE   — while dragging an image, its left / centre-x / right and
//              top / centre-y / bottom lines snap to the same reference
//              lines of OTHER images on the page. A dashed guide line is
//              drawn for every axis that engaged.
//   * RESIZE — while dragging a resize handle, the resulting WIDTH (and
//              HEIGHT) snaps to the width/height of another image within
//              tolerance ("equal width" / "equal height"), with an indicator.
//
// The feature is deliberately scoped to type==='image' references (the user
// asked for image-to-image alignment). The math is generic on bounding boxes,
// so widening the reference set later is a one-line change.
//
// Coordinates are app-space (PDF space, pre-scale). Guides returned by the
// snap functions are drawn by drawImageAlignGuides() using the same
// "overlay after redraw" pattern the resize grip line already uses.

import { state } from '../core/state.js';
import { zetRechtopRond } from '../pdf/weergave-ruimte.js';

// A very large extent so guide lines visually span the page; the canvas clips.
const GUIDE_EXTENT = 50000;

function _bbox(ann) {
  return { x: ann.x, y: ann.y, w: ann.width, h: ann.height };
}

// Reference images on the current page, excluding the one(s) being edited.
export function collectImageAlignRefs(annotations, currentPage, excludeIds) {
  const refs = [];
  for (const ann of annotations) {
    if (ann.type !== 'image') continue;
    if (ann.page !== currentPage) continue;
    if (excludeIds && excludeIds.has(ann.id)) continue;
    if (ann.width == null || ann.height == null) continue;
    refs.push(ann);
  }
  return refs;
}

// ─── MOVE snapping ────────────────────────────────────────────────────────
// movingBox: the {x,y,w,h} of the moving image AFTER the raw delta.
// refs: array of reference image annotations.
// tol: tolerance in app-space units.
// Returns { dx, dy, guides } — dx/dy are additional adjustments to add to the
// raw delta so a line clicks exactly onto its reference; guides describe the
// lines to draw. Only the single best (closest) candidate per axis engages.
export function snapImageMove(movingBox, refs, tol) {
  const guides = [];
  let dx = 0, dy = 0;

  // Candidate lines of the moving box on each axis.
  const mLeft = movingBox.x;
  const mCenterX = movingBox.x + movingBox.w / 2;
  const mRight = movingBox.x + movingBox.w;
  const mTop = movingBox.y;
  const mCenterY = movingBox.y + movingBox.h / 2;
  const mBottom = movingBox.y + movingBox.h;

  const vCands = [ // vertical guide lines (constant x) → adjust dx
    { pos: mLeft, kind: 'left' },
    { pos: mCenterX, kind: 'centerX' },
    { pos: mRight, kind: 'right' },
  ];
  const hCands = [ // horizontal guide lines (constant y) → adjust dy
    { pos: mTop, kind: 'top' },
    { pos: mCenterY, kind: 'centerY' },
    { pos: mBottom, kind: 'bottom' },
  ];

  let bestV = null; // { delta, line, refBox }
  let bestH = null;

  for (const ref of refs) {
    const r = _bbox(ref);
    const rLines = {
      x: [r.x, r.x + r.w / 2, r.x + r.w],
      y: [r.y, r.y + r.h / 2, r.y + r.h],
    };
    // Vertical (x) alignment
    for (const c of vCands) {
      for (const rx of rLines.x) {
        const d = rx - c.pos;
        if (Math.abs(d) <= tol && (!bestV || Math.abs(d) < Math.abs(bestV.delta))) {
          bestV = { delta: d, x: rx, refBox: r, movingKind: c.kind };
        }
      }
    }
    // Horizontal (y) alignment
    for (const c of hCands) {
      for (const ry of rLines.y) {
        const d = ry - c.pos;
        if (Math.abs(d) <= tol && (!bestH || Math.abs(d) < Math.abs(bestH.delta))) {
          bestH = { delta: d, y: ry, refBox: r, movingKind: c.kind };
        }
      }
    }
  }

  if (bestV) {
    dx = bestV.delta;
    guides.push({ type: 'v', x: bestV.x, refBox: bestV.refBox, movingBox });
  }
  if (bestH) {
    dy = bestH.delta;
    guides.push({ type: 'h', y: bestH.y, refBox: bestH.refBox, movingBox });
  }

  return { dx, dy, guides };
}

// ─── RESIZE (equal width / height) snapping ─────────────────────────────────
// Given the resized box BEFORE snapping and the active handle, snap its width
// and/or height to a reference image's width/height. Only dimensions that the
// handle actually changes are considered:
//   - corner handles (tl/tr/bl/br): width AND height
//   - l/r: width only ;  t/b: height only
// The anchor edge (the one opposite the dragged handle) stays fixed, matching
// applyResize semantics, so we adjust x/y when the left/top edge moves.
//
// opts.lockRatio — images resize proportionally by default (lockAspectRatio).
//   When set, only ONE dimension is snapped to a reference and the other is
//   derived from opts.aspectRatio, so the aspect lock is preserved. The primary
//   axis is width for the horizontal/corner handles and height for t/b.
//
// Returns { box:{x,y,w,h}, guides } — box is the snapped geometry (or the
// input unchanged), guides describe the equal-size indicator(s).
export function snapImageResize(box, handleType, refs, tol, opts = {}) {
  const guides = [];
  const h = handleType;
  const affectsW = h === 'l' || h === 'r' || h === 'tl' || h === 'tr' || h === 'bl' || h === 'br';
  const affectsH = h === 't' || h === 'b' || h === 'tl' || h === 'tr' || h === 'bl' || h === 'br';
  // Which edge is anchored (fixed) — the opposite of the moving edge.
  const leftMoves = h === 'l' || h === 'tl' || h === 'bl';
  const topMoves = h === 't' || h === 'tl' || h === 'tr';
  // t/b resize the box symmetrically about its horizontal centre under lock
  // (matches applyResize), and l/r about its vertical centre.
  const centreX = h === 't' || h === 'b';
  const centreY = h === 'l' || h === 'r';

  let out = { x: box.x, y: box.y, w: box.w, h: box.h };

  const lockRatio = !!opts.lockRatio;
  const aspect = lockRatio
    ? (opts.aspectRatio || (box.h !== 0 ? box.w / box.h : 1))
    : 1;

  if (lockRatio) {
    // Proportional snap: pick the primary axis, snap it to a reference of the
    // same axis, then derive the other axis from the aspect ratio.
    const primaryIsWidth = affectsW; // corners + l/r → width; t/b → height
    let best = null;
    for (const ref of refs) {
      const refDim = primaryIsWidth ? ref.width : ref.height;
      const curDim = primaryIsWidth ? out.w : out.h;
      const d = refDim - curDim;
      if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.delta))) {
        best = { delta: d, refDim, refBox: _bbox(ref) };
      }
    }
    if (best) {
      let newW, newH;
      if (primaryIsWidth) { newW = best.refDim; newH = newW / aspect; }
      else { newH = best.refDim; newW = newH * aspect; }
      // Re-anchor the fixed edge(s) so the snapped box grows/shrinks from the
      // same corner/centre applyResize used.
      if (centreX) out.x = out.x + (out.w - newW) / 2;
      else if (leftMoves) out.x = out.x + out.w - newW;
      if (centreY) out.y = out.y + (out.h - newH) / 2;
      else if (topMoves) out.y = out.y + out.h - newH;
      out.w = newW; out.h = newH;
      guides.push({ type: primaryIsWidth ? 'equalW' : 'equalH', box: { ...out }, refBox: best.refBox });
    }
    return { box: out, guides };
  }

  // Equal WIDTH
  if (affectsW) {
    let best = null;
    for (const ref of refs) {
      const d = ref.width - out.w;
      if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.delta))) {
        best = { delta: d, refWidth: ref.width, refBox: _bbox(ref) };
      }
    }
    if (best) {
      const newW = best.refWidth;
      if (leftMoves) out.x = out.x + out.w - newW; // right edge fixed
      out.w = newW;
      guides.push({ type: 'equalW', box: { ...out }, refBox: best.refBox });
    }
  }

  // Equal HEIGHT
  if (affectsH) {
    let best = null;
    for (const ref of refs) {
      const d = ref.height - out.h;
      if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.delta))) {
        best = { delta: d, refHeight: ref.height, refBox: _bbox(ref) };
      }
    }
    if (best) {
      const newH = best.refHeight;
      if (topMoves) out.y = out.y + out.h - newH; // bottom edge fixed
      out.h = newH;
      guides.push({ type: 'equalH', box: { ...out }, refBox: best.refBox });
    }
  }

  return { box: out, guides };
}

// ─── Rendering ──────────────────────────────────────────────────────────────
// ctx must already be transformed to app-space (applyToolTransform). scale is
// the effective app→screen scale so line/label sizes stay constant on screen.
export function drawImageAlignGuides(ctx, guides, scale) {
  if (!guides || guides.length === 0) return;
  const lw = 0.75 / scale;
  const dash = 5 / scale;
  const dotR = 2.5 / scale;
  const color = '#FF00FF';

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lw;

  for (const g of guides) {
    if (g.type === 'v') {
      ctx.setLineDash([dash, dash]);
      ctx.beginPath();
      ctx.moveTo(g.x, -GUIDE_EXTENT);
      ctx.lineTo(g.x, GUIDE_EXTENT);
      ctx.stroke();
      ctx.setLineDash([]);
      // Small dots at the reference edge extremities.
      _dot(ctx, g.x, g.refBox.y, dotR);
      _dot(ctx, g.x, g.refBox.y + g.refBox.h, dotR);
    } else if (g.type === 'h') {
      ctx.setLineDash([dash, dash]);
      ctx.beginPath();
      ctx.moveTo(-GUIDE_EXTENT, g.y);
      ctx.lineTo(GUIDE_EXTENT, g.y);
      ctx.stroke();
      ctx.setLineDash([]);
      _dot(ctx, g.refBox.x, g.y, dotR);
      _dot(ctx, g.refBox.x + g.refBox.w, g.y, dotR);
    } else if (g.type === 'equalW' || g.type === 'equalH') {
      _drawEqualSize(ctx, g, scale);
    }
  }

  ctx.restore();
}

function _dot(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

// Draw a "= width" / "= height" indicator: a double-headed span on the moving
// box and on the matching reference box, plus a small label.
function _drawEqualSize(ctx, g, scale) {
  const isW = g.type === 'equalW';
  const label = isW ? '= breedte' : '= hoogte';
  const cap = 4 / scale;

  const spans = [g.box, g.refBox];
  for (const b of spans) {
    let x1, y1, x2, y2;
    if (isW) {
      const y = b.y - 6 / scale;
      x1 = b.x; x2 = b.x + b.w; y1 = y2 = y;
    } else {
      const x = b.x - 6 / scale;
      y1 = b.y; y2 = b.y + b.h; x1 = x2 = x;
    }
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    // End caps
    if (isW) {
      ctx.beginPath();
      ctx.moveTo(x1, y1 - cap); ctx.lineTo(x1, y1 + cap);
      ctx.moveTo(x2, y2 - cap); ctx.lineTo(x2, y2 + cap);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(x1 - cap, y1); ctx.lineTo(x1 + cap, y1);
      ctx.moveTo(x2 - cap, y2); ctx.lineTo(x2 + cap, y2);
      ctx.stroke();
    }
  }

  if (state.preferences.showSnapTypeLabel !== false) {
    const fontSize = 9 / scale;
    ctx.font = `${fontSize}px Arial`;
    const tw = ctx.measureText(label).width;
    const lx = isW ? g.box.x + g.box.w + 4 / scale : g.box.x + 4 / scale;
    const ly = isW ? g.box.y - 8 / scale : g.box.y - 4 / scale;
    ctx.save();
    // Rechtop op het scherm, ook in een gedraaide weergave (#200).
    zetRechtopRond(ctx, lx, ly);
    const prevFill = ctx.fillStyle;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillRect(lx - 1 / scale, ly - fontSize, tw + 2 / scale, fontSize + 2 / scale);
    ctx.fillStyle = prevFill;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(label, lx, ly);
    ctx.restore();
  }
}
