import { createAnnotation } from './factory.js';
import { state, getActiveDocument } from '../core/state.js';
import { detectScaleInDocument, scaleFromScaleBar } from './document-scale.js';

/**
 * Create a scale bar annotation at the given position.
 * Uses the current document scale or defaults.
 */
export function createScaleBar(x, y) {
  const doc = getActiveDocument();
  const ms = doc?.measureScale;
  const unit = ms?.unit || 'mm';

  // Default: 5000mm (5m) scale bar with 5 divisions (each 1000mm = 1m)
  const totalUnits = 5000;
  const divisions = 5;

  let pixelsPerUnit = ms?.pixelsPerUnit || 0;
  let barWidth;

  if (pixelsPerUnit > 0) {
    barWidth = totalUnits * pixelsPerUnit;
  } else {
    // No scale calibrated yet — use a visual width and derive pixelsPerUnit
    barWidth = 300;
    pixelsPerUnit = barWidth / totalUnits;
  }

  const barHeight = 14;

  return createAnnotation({
    type: 'scaleBar',
    page: doc?.currentPage || 1,
    x, y,
    width: barWidth,
    height: barHeight,
    rotation: 0,
    pixelsPerUnit,
    unit,
    divisions,
    totalUnits,
    color: '#000000',
    lineWidth: 1,
    opacity: 1,
  });
}

/**
 * Get the effective scale for a specific point on a specific page.
 * Logic:
 *  - If there is exactly 1 scaleBar across all pages → use its scale everywhere
 *  - If there are scaleBars on different pages → use the one on the same page
 *  - If there are multiple on the same page → check if point is within a region
 *  - Fallback to doc.measureScale
 */
export function getScaleForPoint(pageNum, x, y) {
  const doc = getActiveDocument();
  if (!doc) return doc?.measureScale || null;

  // Check viewport annotations first (they define per-region scales)
  const viewports = (doc.annotations || []).filter(a => a.type === 'viewport' && a.page === pageNum);
  for (const vp of viewports) {
    if (x >= vp.x && x <= vp.x + vp.width && y >= vp.y && y <= vp.y + vp.height) {
      return { pixelsPerUnit: vp.pixelsPerUnit, unit: vp.unit, method: 'viewport' };
    }
  }

  // Then check scaleBar annotations (document/page level scale)
  const scaleBars = (doc.annotations || []).filter(a => a.type === 'scaleBar');

  if (scaleBars.length === 0) {
    return doc.measureScale || null;
  }

  // Prefer scale bar on same page
  const samePage = scaleBars.filter(sb => sb.page === pageNum);
  if (samePage.length > 0) {
    return { pixelsPerUnit: samePage[0].pixelsPerUnit, unit: samePage[0].unit, method: 'scaleBar' };
  }

  // Fallback to any scale bar or document scale
  return doc.measureScale || { pixelsPerUnit: scaleBars[0].pixelsPerUnit, unit: scaleBars[0].unit, method: 'scaleBar' };
}

/**
 * Try to detect the scale from the PDF's text content (title block).
 * Looks for patterns like "1:100", "SCHAAL 1:50", "SCALE: 1:200", "M 1:500".
 * Returns { ratio: number, scaleText: string } or null if not found.
 *
 * Reads the given document, or the active one when none is given. A caller
 * that works on a specific document (loadPDF, which also runs for background
 * tabs) MUST pass it: the active document can be a different PDF.
 */
export async function detectScaleFromPdf(pageNum, doc) {
  return detectScaleInDocument(doc || getActiveDocument(), pageNum);
}

/**
 * Sync the document-level measureScale from a scaleBar annotation.
 * Called after placing or modifying a scaleBar so that doc.measureScale
 * stays in sync and legacy code paths that read doc.measureScale still work.
 *
 * Writes to the given document, or to the active one when none is given
 * (placing/editing a scale bar always happens in the active document).
 */
export function syncDocScale(scaleBar, doc) {
  if (!doc) doc = getActiveDocument();
  if (!doc) return;
  const scale = scaleFromScaleBar(scaleBar);
  if (scale) doc.measureScale = scale;
}
