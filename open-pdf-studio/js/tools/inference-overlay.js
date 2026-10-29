// Overlay of the move inference (#519): dashed guide lines, markers and the
// tooltip naming the inference. The move session publishes a plain overlay
// description here; both render paths (single page and continuous) draw it
// inside their redraw so a viewport re-render can't wipe it.
//
// Deliberately light on imports (no snap-engine, no i18n): rendering.js
// imports this module, and the texts arrive already translated.

import { zetRechtopRond } from '../pdf/weergave-ruimte.js';

let _overlay = null;

/**
 * overlay: null | {
 *   page,
 *   lines:   [{ x1, y1, x2, y2, color, dash?: boolean, width?: number }],
 *   markers: [{ x, y, kind: 'acquired'|'source'|'intersection'|'parallel'|'perpendicular', color, angle? }],
 *   label:   { x, y, text, color } | null,
 * }  — all in page (app) coordinates.
 */
export function setMoveInferenceOverlay(overlay) {
  _overlay = overlay || null;
}

export function getMoveInferenceOverlay() {
  return _overlay;
}

export function clearMoveInferenceOverlay() {
  _overlay = null;
}

function _marker(ctx, m, scale) {
  const s = 4 / scale;
  ctx.strokeStyle = m.color;
  ctx.fillStyle = m.color;
  ctx.lineWidth = 1.2 / scale;
  ctx.beginPath();
  switch (m.kind) {
    case 'acquired': // small "+"
      ctx.moveTo(m.x - s, m.y); ctx.lineTo(m.x + s, m.y);
      ctx.moveTo(m.x, m.y - s); ctx.lineTo(m.x, m.y + s);
      ctx.stroke();
      break;
    case 'intersection': // "x"
      ctx.moveTo(m.x - s, m.y - s); ctx.lineTo(m.x + s, m.y + s);
      ctx.moveTo(m.x + s, m.y - s); ctx.lineTo(m.x - s, m.y + s);
      ctx.stroke();
      break;
    case 'parallel': { // "//" across the reference line
      const a = m.angle || 0;
      const ux = Math.cos(a), uy = Math.sin(a);
      const nx = -uy, ny = ux;
      for (const k of [-1, 1]) {
        const cx = m.x + ux * k * s * 0.6, cy = m.y + uy * k * s * 0.6;
        ctx.moveTo(cx - nx * s + ux * s * 0.5, cy - ny * s + uy * s * 0.5);
        ctx.lineTo(cx + nx * s - ux * s * 0.5, cy + ny * s - uy * s * 0.5);
      }
      ctx.stroke();
      break;
    }
    case 'perpendicular': { // right-angle mark in the corner
      const a = m.angle || 0;
      const ux = Math.cos(a), uy = Math.sin(a);
      const nx = -uy, ny = ux;
      const d = s * 1.6;
      ctx.moveTo(m.x + ux * d, m.y + uy * d);
      ctx.lineTo(m.x + ux * d + nx * d, m.y + uy * d + ny * d);
      ctx.lineTo(m.x + nx * d, m.y + ny * d);
      ctx.stroke();
      break;
    }
    default: // 'source': small dot on the referenced point
      ctx.arc(m.x, m.y, 2 / scale, 0, Math.PI * 2);
      ctx.fill();
  }
}

/** Draw the published overlay when it belongs to `pageNum`. ctx is in page space. */
export function drawMoveInferenceOverlay(ctx, pageNum, scale) {
  const o = _overlay;
  if (!o || (o.page != null && pageNum != null && o.page !== pageNum)) return;
  const sc = scale > 0 ? scale : 1;
  ctx.save();
  for (const l of o.lines || []) {
    ctx.strokeStyle = l.color;
    ctx.lineWidth = (l.width || 0.8) / sc;
    ctx.setLineDash(l.dash === false ? [] : [5 / sc, 4 / sc]);
    ctx.beginPath();
    ctx.moveTo(l.x1, l.y1);
    ctx.lineTo(l.x2, l.y2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const m of o.markers || []) _marker(ctx, m, sc);
  const lb = o.label;
  if (lb && lb.text) {
    // Upright on screen, also in a rotated view (#200).
    zetRechtopRond(ctx, lb.x, lb.y);
    const fontSize = 11 / sc;
    ctx.font = `${fontSize}px Arial`;
    const padX = 4 / sc, padY = 3 / sc;
    const tw = ctx.measureText(lb.text).width;
    const tx = lb.x + 14 / sc;
    // Above-right of the cursor: the snap label sits just below it and the
    // typed-distance field below-right.
    const ty = lb.y - 16 / sc;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
    ctx.fillRect(tx - padX, ty - fontSize, tw + padX * 2, fontSize + padY * 2);
    ctx.strokeStyle = lb.color || '#333333';
    ctx.lineWidth = 0.6 / sc;
    ctx.strokeRect(tx - padX, ty - fontSize, tw + padX * 2, fontSize + padY * 2);
    ctx.fillStyle = '#222222';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(lb.text, tx, ty);
  }
  ctx.restore();
}
