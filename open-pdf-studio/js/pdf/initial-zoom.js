import { percentToScale, MIN_ZOOM_INVOER, MAX_ZOOM_INVOER } from '../core/zoom-display.js';

export function normalizeInitialZoom(value) {
  if (value === 'width') return value;
  return Number.isFinite(value) && value >= MIN_ZOOM_INVOER && value <= MAX_ZOOM_INVOER ? value : 'page';
}

/// Compute the zoom factor needed to fit a page into a canvas under one of
/// the standard fit modes. SINGLE SOURCE OF TRUTH for fit math — every
/// fit-to-* path in the app should call this instead of computing its own
/// `min(canvasW/pageW, canvasH/pageH)`-style expression.
///
/// @param {'page'|'width'|'height'} mode  How to fit
/// @param {number} pageW    Page width in PDF user units (post-rotation)
/// @param {number} pageH    Page height in PDF user units (post-rotation)
/// @param {number} canvasW  Available canvas / container width in pixels
/// @param {number} canvasH  Available canvas / container height in pixels
/// @param {number} [padding=0]  Pixels of breathing room around the page on
///                              each side (the canvasW/H is shrunk by 2x
///                              this before computing). Pass 0 for edge-to-edge.
/// @returns {number}  The zoom factor (multiplier from PDF units to pixels)
export function computeFitZoom(mode, pageW, pageH, canvasW, canvasH, padding = 0) {
  const availW = Math.max(1, canvasW - padding * 2);
  const availH = Math.max(1, canvasH - padding * 2);
  switch (mode) {
    case 'width':  return availW / pageW;
    case 'height': return availH / pageH;
    case 'page':
    default:       return Math.min(availW / pageW, availH / pageH);
  }
}

export function initialScale(mode, pageW, pageH, canvasW, canvasH) {
  return typeof mode === 'number' ? percentToScale(mode) : computeFitZoom(mode, pageW, pageH, canvasW, canvasH);
}
