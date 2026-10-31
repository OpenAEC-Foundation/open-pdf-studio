// Pure geometry for the dialog preview, in displayed PDF page points.
import { watermarkTextPlacement, watermarkTextBox, watermarkPosition } from './watermark-layout.js';

export function previewPlacement(wm, width, height) {
  if (wm.type === 'textWatermark') {
    const placed = watermarkTextPlacement(wm, width, height);
    return { ...placed, height: watermarkTextBox(wm, placed.size).height };
  }
  const w = (wm.width || 200) * (wm.scale ?? 1), h = (wm.height || 200) * (wm.scale ?? 1);
  return { ...watermarkPosition(wm, width, height, w, h), width: w, height: h };
}

export function previewHit(wm, width, height, x, y) {
  const p = previewPlacement(wm, width, height);
  const angle = -(wm.rotation || 0) * Math.PI / 180;
  const dx = x - p.x, dy = y - p.y;
  return Math.abs(dx * Math.cos(angle) - dy * Math.sin(angle)) <= p.width / 2 + 3
    && Math.abs(dx * Math.sin(angle) + dy * Math.cos(angle)) <= p.height / 2 + 3;
}

/**
 * Custom X/Y while dragging: the start centre moved by the pointer, rounded
 * to 0.1 pt like watermarkCustomPosition. The centre stays on the page, so a
 * watermark cannot be dragged out of sight.
 */
export function previewDragPosition(origin, start, pointer, width, height) {
  const clamp = (v, max) => Math.min(max, Math.max(0, v));
  const round = v => Math.round(v * 10) / 10;
  return {
    x: round(clamp(origin.x + pointer.x - start.x, width)),
    y: round(clamp(origin.y + pointer.y - start.y, height)),
  };
}
