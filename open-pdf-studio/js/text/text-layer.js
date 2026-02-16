import { state } from '../core/state.js';
import * as pdfjsLib from 'pdfjs-dist';

/**
 * Text Layer Management Module
 * Creates text layers using PDF.js renderTextLayer() for text selection
 */

// Store references to text layers for cleanup
const textLayers = new Map();

/**
 * Creates a text layer for a PDF page
 * @param {Object} page - PDF.js page object
 * @param {Object} viewport - PDF.js viewport
 * @param {HTMLElement} container - Container element to append text layer to
 * @param {number} pageNum - Page number for tracking
 * @returns {Promise<HTMLElement>} The created text layer element
 */
export async function createTextLayer(page, viewport, container, pageNum) {
  // Get text content from PDF page
  const textContent = await page.getTextContent();

  // Create text layer div
  const textLayerDiv = document.createElement('div');
  textLayerDiv.className = 'textLayer';
  textLayerDiv.dataset.page = pageNum;

  const scale = viewport.scale;

  // Set text layer dimensions to match SCALED canvas
  textLayerDiv.style.width = `${viewport.width}px`;
  textLayerDiv.style.height = `${viewport.height}px`;
  textLayerDiv.style.setProperty('--scale-factor', scale);

  if (container) {
    container.style.setProperty('--scale-factor', scale);
  }

  // Append text layer to container
  container.appendChild(textLayerDiv);

  // Use manual rendering with correct scaled positions
  renderTextLayerManually(textContent, textLayerDiv, viewport, scale);
  textLayers.set(pageNum, { element: textLayerDiv, textLayer: null });

  // Make sure spans have proper styles for selection
  // Only enable text selection when select tool is active
  const isSelectTool = state.currentTool === 'select';
  const spans = textLayerDiv.querySelectorAll('span');
  spans.forEach(span => {
    span.style.pointerEvents = isSelectTool ? 'auto' : 'none';
    span.style.cursor = isSelectTool ? 'text' : 'default';
  });

  return textLayerDiv;
}

/**
 * Manual text layer rendering with proper coordinate transformation
 * Uses viewport.convertToViewportPoint() for accurate PDF to DOM coordinate conversion
 */
function renderTextLayerManually(textContent, container, viewport, scale) {
  const textItems = textContent.items;

  for (let i = 0; i < textItems.length; i++) {
    const item = textItems[i];
    if (!item.str || item.str.trim() === '') continue;

    const span = document.createElement('span');
    span.textContent = item.str;

    // Store PDF metadata for text editing
    span.dataset.pdfTransform = JSON.stringify(item.transform);
    span.dataset.pdfWidth = item.width || 0;
    span.dataset.itemIndex = i;

    // item.transform is [scaleX, skewY, skewX, scaleY, translateX, translateY]
    const tx = item.transform;

    // Calculate font height from transform matrix
    // Font height is sqrt(c² + d²) where c=skewX, d=scaleY
    const fontHeightUnscaled = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]);
    const fontHeight = fontHeightUnscaled * scale;

    // Use viewport.convertToViewportPoint to convert PDF coordinates to canvas coordinates
    const pdfX = tx[4];
    const pdfY = tx[5];
    const [canvasX, canvasY] = viewport.convertToViewportPoint(pdfX, pdfY);

    // The canvasY from convertToViewportPoint is the baseline position
    const domX = canvasX;
    const domY = canvasY - (fontHeight * 0.85);

    span.style.left = `${domX}px`;
    span.style.top = `${domY}px`;
    span.style.fontSize = `${fontHeight}px`;
    span.style.fontFamily = 'sans-serif';

    // Calculate rotation angle
    const angle = Math.atan2(tx[1], tx[0]);

    // Calculate expected width from PDF and scale text horizontally to match
    if (item.width && item.width > 0) {
      const expectedWidth = item.width * scale;

      // Append hidden to measure actual width
      span.style.visibility = 'hidden';
      container.appendChild(span);
      const actualWidth = span.getBoundingClientRect().width;
      span.style.visibility = '';

      if (actualWidth > 0) {
        const scaleX = expectedWidth / actualWidth;

        // Apply scaleX and rotation if present
        if (Math.abs(angle) > 0.001) {
          span.style.transform = `scaleX(${scaleX}) rotate(${angle}rad)`;
        } else {
          span.style.transform = `scaleX(${scaleX})`;
        }
        span.style.transformOrigin = '0% 0%';
      }
      // span is already appended
    } else {
      // No width info, just apply rotation if present
      if (Math.abs(angle) > 0.001) {
        span.style.transform = `rotate(${angle}rad)`;
        span.style.transformOrigin = '0% 0%';
      }
      container.appendChild(span);
    }
  }
}

/**
 * Creates text layer for single page mode
 * @param {Object} page - PDF.js page object
 * @param {Object} viewport - PDF.js viewport
 */
export async function createSinglePageTextLayer(page, viewport) {
  const container = document.getElementById('canvas-container');
  if (!container) return;

  // Remove existing text layer for current page
  clearSinglePageTextLayer();

  await createTextLayer(page, viewport, container, state.currentPage);
}

/**
 * Clears text layer for single page mode
 */
export function clearSinglePageTextLayer() {
  const container = document.getElementById('canvas-container');
  if (!container) return;

  const existingLayer = container.querySelector('.textLayer');
  if (existingLayer) {
    existingLayer.remove();
  }

  // Clear from tracking map
  textLayers.delete(state.currentPage);
}

/**
 * Clears all text layers (for re-render or cleanup)
 */
export function clearTextLayers() {
  // Remove all text layer elements
  document.querySelectorAll('.textLayer').forEach(layer => {
    layer.remove();
  });

  // Clear the tracking map
  textLayers.clear();
}

/**
 * Gets the text layer for a specific page
 * @param {number} pageNum - Page number
 * @returns {HTMLElement|null} The text layer element or null
 */
export function getTextLayer(pageNum) {
  const entry = textLayers.get(pageNum);
  return entry ? entry.element : null;
}
