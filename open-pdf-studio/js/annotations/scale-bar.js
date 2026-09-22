import { createAnnotation } from './factory.js';
import { getActiveDocument } from '../core/state.js';
import { detectScaleInDocument, scaleFromScaleBar } from './document-scale.js';
import { schaalOpPunt } from './schaal-op-punt.js';

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
 * Get the effective scale for a specific point on a specific page of the
 * active document: viewport annotation → scale bar on the page → viewport
 * from the PDF itself (/VP) → doc.measureScale → scale bar elsewhere. The
 * order lives in schaal-op-punt.js; this is the shared entry point for
 * getMeasureScale and the light scale bridges (stamps, systeemraster, …).
 * Returns null when nothing is known.
 */
export function getScaleForPoint(pageNum, x, y) {
  return schaalOpPunt(getActiveDocument(), pageNum, x, y);
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
