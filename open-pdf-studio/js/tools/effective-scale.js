import { getActiveDocument } from '../core/state.js';

/**
 * De actuele zoom: schermpixels per paginapunt.
 * Vector mode: viewport zoom. Legacy mode: doc.scale.
 *
 * Staat in een eigen module (alleen afhankelijk van de state) zodat ook de
 * raaktest, de vormen-makers en de opdrachtmodi hun grenzen in schermpixels
 * kunnen uitdrukken (px / zoom) zonder de hele tool-context mee te trekken.
 */
export function getEffectiveScale() {
  const doc = getActiveDocument();
  const vp = (typeof window !== 'undefined') ? window.__pdfViewport : null;
  // Same blank-doc guard as resolvePointerCoords.
  if (vp && vp.active && doc?.filePath) return vp.zoom;
  return doc?.scale || 1.5;
}
