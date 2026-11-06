/**
 * Dynamic markup scaling — adjusts annotation visual properties (line width,
 * font size, etc.) based on the viewport scale where the annotation is placed.
 *
 * Concept: If the page is at 1:100 and a viewport is at 1:50 (2x larger detail),
 * markups in the viewport should be scaled down by 0.5x so they appear the same
 * relative size to the drawing content.
 *
 * The reference scale is the document/page-level scale. Viewport scales are compared
 * against it to derive a scale factor.
 */
import { state, getActiveDocument } from '../core/state.js';
import { getScaleForPoint } from './scale-bar.js';
import { documentSchaalOpPagina } from './scale-region-scale.js';
import { MM_PER_UNIT } from './scale-from-measurement.js';

/**
 * Paginaeenheden per echte millimeter. Schalen tellen elk in hun eigen eenheid:
 * de documentschaal uit de titelhoek in mm, een /VP met /Measure van een
 * CAD-plot vaak in m (#981). Pas na omrekening naar één eenheid zijn ze te
 * vergelijken; anders leek een 1:50-viewport in een 1:50-document duizend keer
 * zo gedetailleerd en kromp de tekst van een nieuwe tekstballon naar het minimum.
 * Onbekende eenheid: null (dan geen correctie).
 */
export function pixelsPerMm(schaal) {
  if (!schaal || !(schaal.pixelsPerUnit > 0)) return null;
  const mm = MM_PER_UNIT[schaal.unit || 'mm'];
  return mm ? schaal.pixelsPerUnit / mm : null;
}

/**
 * Get the scale factor for a point on the page.
 * Returns 1.0 if no viewport adjustment is needed.
 * Returns < 1.0 if the viewport is a larger-scale detail (e.g., 1:50 in a 1:100 doc).
 * Returns > 1.0 if the viewport is a smaller-scale overview.
 */
export function getViewportScaleFactor(pageNum, x, y) {
  const doc = getActiveDocument();
  if (!doc) return 1;

  // Get the document-level (reference) scale
  const docScale = documentSchaalOpPagina(doc, pageNum);
  if (!docScale) return 1;

  // Get the scale at this specific point (may be from a viewport)
  const pointScale = getScaleForPoint(pageNum, x, y);
  if (!pointScale || pointScale.pixelsPerUnit <= 0) return 1;

  // Beide in paginaeenheden per mm: de eenheden mogen verschillen (#981).
  const docPpm = pixelsPerMm({ ...docScale, unit: docScale.unit || 'mm' });
  const puntPpm = pixelsPerMm(pointScale);
  if (!docPpm || !puntPpm) return 1;

  // Dezelfde schaal (relatief, los van de eenheid): geen aanpassing.
  if (Math.abs(puntPpm - docPpm) <= 1e-6 * docPpm) return 1;

  // Scale factor = doc scale / viewport scale
  // If viewport is 1:50 (larger detail) and doc is 1:100:
  //   docPPU = 72/(25.4*100) = 0.02835
  //   vpPPU  = 72/(25.4*50)  = 0.05669
  //   factor = 0.02835 / 0.05669 = 0.5 (markups should be half size)
  return docPpm / puntPpm;
}

/**
 * Apply dynamic scaling to annotation properties.
 * Call this when creating an annotation to adjust its visual properties
 * based on the viewport it's placed in.
 *
 * @param {object} props - Annotation properties (mutated in place)
 * @param {number} pageNum - Page number
 * @param {number} x - X position of the annotation
 * @param {number} y - Y position of the annotation
 * @returns {object} The same props object, scaled
 */
export function applyDynamicScaling(props, pageNum, x, y) {
  if (!isDynamicScalingEnabled()) return props;
  const factor = getViewportScaleFactor(pageNum, x, y);
  if (factor === 1) return props;

  // Scale visual properties
  if (props.lineWidth != null) {
    props.lineWidth = Math.max(0.5, Math.round(props.lineWidth * factor * 10) / 10);
  }
  if (props.fontSize != null) {
    props.fontSize = Math.max(4, Math.round(props.fontSize * factor));
  }
  if (props.textFontSize != null) {
    props.textFontSize = Math.max(4, Math.round(props.textFontSize * factor));
  }

  // Store the scale factor on the annotation for reference
  props.viewportScaleFactor = factor;

  return props;
}

/**
 * Check if dynamic scaling is enabled.
 * Requires: a document-level scale AND the preference to be on.
 */
export function isDynamicScalingEnabled() {
  const doc = getActiveDocument();
  if (!doc?.measureScale?.pixelsPerUnit) return false;
  return state.preferences.dynamicMarkupScaling !== false; // default on
}

/**
 * Toggle dynamic scaling on/off.
 */
export function setDynamicScalingEnabled(enabled) {
  state.preferences.dynamicMarkupScaling = enabled;
}
