import { state } from '../core/state.js';
import { createAnnotation } from '../annotations/factory.js';
import { redrawAnnotations, redrawContinuous } from '../annotations/rendering.js';
import { getSelectionRectsForAnnotation, getSelectionQuadPoints } from './text-selection.js';

/**
 * Text Markup Annotations Module
 * Handles creation of text markup annotations (highlight, strikethrough, underline)
 */

/**
 * Creates a text markup annotation from the current selection
 * @param {string} type - 'textHighlight', 'textStrikethrough', or 'textUnderline'
 * @param {string} color - The annotation color
 * @param {number} opacity - The annotation opacity
 */
export function createTextMarkupAnnotation(type, color, opacity) {
  const rects = getSelectionRectsForAnnotation();
  if (rects.length === 0) return null;

  const quadPoints = getSelectionQuadPoints();
  if (quadPoints.length === 0) return null;

  // Get the page number from the first rect
  const pageNum = rects[0].page;

  // Calculate bounding box for the annotation
  const minX = Math.min(...rects.map(r => r.x));
  const minY = Math.min(...rects.map(r => r.y));
  const maxX = Math.max(...rects.map(r => r.x + r.width));
  const maxY = Math.max(...rects.map(r => r.y + r.height));

  const annotation = createAnnotation({
    id: Date.now(),
    type: type,
    page: pageNum,
    // Bounding box
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    // QuadPoints for precise text areas
    quadPoints: quadPoints,
    // Individual rects for rendering
    rects: rects.map(r => ({ x: r.x, y: r.y, width: r.width, height: r.height })),
    // Appearance
    color: color,
    opacity: opacity
  });

  state.annotations.push(annotation);

  // Redraw
  if (state.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }

  return annotation;
}

/**
 * Gets text markup annotation defaults by type
 * @param {string} type - The annotation type
 * @returns {Object} Default properties for the type
 */
export function getTextMarkupDefaults(type) {
  switch (type) {
    case 'textHighlight':
      return {
        color: '#FFFF00',
        opacity: 0.3
      };
    case 'textStrikethrough':
      return {
        color: '#FF0000',
        opacity: 1.0
      };
    case 'textUnderline':
      return {
        color: '#0000FF',
        opacity: 1.0
      };
    default:
      return {
        color: '#FFFF00',
        opacity: 0.5
      };
  }
}
