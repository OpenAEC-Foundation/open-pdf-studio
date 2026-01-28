import { state } from '../core/state.js';
import { goToPage } from './renderer.js';
import { openExternal } from '../tauri-api.js';

/**
 * Link Layer Management Module
 * Creates clickable link overlays for PDF link annotations
 */

// Store references to link layers for cleanup
const linkLayers = new Map();

/**
 * Creates a link layer for a PDF page
 * @param {Object} page - PDF.js page object
 * @param {Object} viewport - PDF.js viewport
 * @param {HTMLElement} container - Container element to append link layer to
 * @param {number} pageNum - Page number for tracking
 * @returns {Promise<HTMLElement>} The created link layer element
 */
export async function createLinkLayer(page, viewport, container, pageNum) {
  // Get annotations from PDF page with intent 'display' to include link annotations
  const annotations = await page.getAnnotations({ intent: 'display' });

  // Filter for link annotations
  const linkAnnotations = annotations.filter(ann => ann.subtype === 'Link');

  if (linkAnnotations.length === 0) {
    return null; // No links on this page
  }

  // Create link layer div
  const linkLayerDiv = document.createElement('div');
  linkLayerDiv.className = 'linkLayer';
  linkLayerDiv.dataset.page = pageNum;

  // Set link layer dimensions to match canvas
  linkLayerDiv.style.width = `${viewport.width}px`;
  linkLayerDiv.style.height = `${viewport.height}px`;
  linkLayerDiv.style.position = 'absolute';
  linkLayerDiv.style.top = '0';
  linkLayerDiv.style.left = '0';
  linkLayerDiv.style.pointerEvents = 'none'; // Let clicks pass through except on links

  // Create link elements for each annotation
  for (const ann of linkAnnotations) {
    const linkElement = createLinkElement(ann, viewport, pageNum);
    if (linkElement) {
      linkLayerDiv.appendChild(linkElement);
    }
  }

  // Append link layer at the end so it's on top of everything
  container.appendChild(linkLayerDiv);

  // Store reference for cleanup
  linkLayers.set(pageNum, linkLayerDiv);

  return linkLayerDiv;
}

/**
 * Creates a clickable link element from a PDF annotation
 * @param {Object} ann - PDF annotation object
 * @param {Object} viewport - PDF.js viewport
 * @param {number} pageNum - Current page number
 * @returns {HTMLElement|null} The link element or null
 */
function createLinkElement(ann, viewport, pageNum) {
  if (!ann.rect || ann.rect.length < 4) return null;

  // Convert PDF coordinates to viewport coordinates
  const [x1, y1, x2, y2] = ann.rect;

  // PDF coordinates have origin at bottom-left, viewport has origin at top-left
  const viewportRect = viewport.convertToViewportRectangle(ann.rect);

  // viewportRect is [x1, y1, x2, y2] but may need normalization
  const left = Math.min(viewportRect[0], viewportRect[2]);
  const top = Math.min(viewportRect[1], viewportRect[3]);
  const width = Math.abs(viewportRect[2] - viewportRect[0]);
  const height = Math.abs(viewportRect[3] - viewportRect[1]);

  // Create link element
  const linkEl = document.createElement('a');
  linkEl.className = 'pdf-link';
  linkEl.style.position = 'absolute';
  linkEl.style.left = `${left}px`;
  linkEl.style.top = `${top}px`;
  linkEl.style.width = `${width}px`;
  linkEl.style.height = `${height}px`;
  linkEl.style.pointerEvents = 'auto';
  linkEl.style.cursor = 'pointer';

  // Determine link type and set up click handler
  if (ann.url) {
    // External URL link
    linkEl.href = ann.url;
    linkEl.title = ann.url;
    linkEl.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openExternalLink(ann.url);
    });
  } else if (ann.dest) {
    // Internal destination (named destination or page reference)
    linkEl.href = '#';
    linkEl.title = `Go to page`;
    linkEl.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await handleInternalLink(ann.dest);
    });
  } else if (ann.action) {
    // Action-based link (GoTo, GoToR, URI, etc.)
    setupActionLink(linkEl, ann.action);
  } else {
    // Unknown link type, make it non-interactive
    return null;
  }

  return linkEl;
}

/**
 * Opens an external URL in the default browser
 * @param {string} url - URL to open
 */
function openExternalLink(url) {
  openExternal(url);
}

/**
 * Handles internal PDF link navigation
 * @param {string|Array} dest - Destination (named or explicit)
 */
async function handleInternalLink(dest) {
  if (!state.pdfDoc) return;

  try {
    let pageIndex;

    if (typeof dest === 'string') {
      // Named destination - resolve it
      const destination = await state.pdfDoc.getDestination(dest);
      if (destination) {
        const ref = destination[0];
        pageIndex = await state.pdfDoc.getPageIndex(ref);
      }
    } else if (Array.isArray(dest)) {
      // Explicit destination array [pageRef, type, ...params]
      const ref = dest[0];
      if (ref && typeof ref === 'object') {
        pageIndex = await state.pdfDoc.getPageIndex(ref);
      } else if (typeof ref === 'number') {
        pageIndex = ref;
      }
    }

    if (pageIndex !== undefined && pageIndex !== null) {
      // PDF.js uses 0-based index, our app uses 1-based page numbers
      await goToPage(pageIndex + 1);
    }
  } catch (e) {
    console.warn('Failed to navigate to internal link:', e);
  }
}

/**
 * Sets up a link element for action-based links
 * @param {HTMLElement} linkEl - Link element
 * @param {Object} action - PDF action object
 */
function setupActionLink(linkEl, action) {
  if (!action) return;

  switch (action.action) {
    case 'URI':
      if (action.uri) {
        linkEl.href = action.uri;
        linkEl.title = action.uri;
        linkEl.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          openExternalLink(action.uri);
        });
      }
      break;

    case 'GoTo':
      if (action.dest) {
        linkEl.href = '#';
        linkEl.title = 'Go to page';
        linkEl.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          await handleInternalLink(action.dest);
        });
      }
      break;

    case 'GoToR':
      // GoToR is "Go to Remote" - opens another PDF file
      // For now, just show a tooltip
      if (action.filename) {
        linkEl.title = `Open: ${action.filename}`;
        linkEl.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          // GoToR links to external PDFs not implemented
        });
      }
      break;

    case 'Launch':
      // Launch action - opens a file
      if (action.url) {
        linkEl.title = action.url;
        linkEl.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          openExternalLink(action.url);
        });
      }
      break;

    default:
      // Unknown action type
      linkEl.style.pointerEvents = 'none';
  }
}

/**
 * Creates link layer for single page mode
 * @param {Object} page - PDF.js page object
 * @param {Object} viewport - PDF.js viewport
 */
export async function createSinglePageLinkLayer(page, viewport) {
  const container = document.getElementById('canvas-container');
  if (!container) return;

  // Remove existing link layer
  clearSinglePageLinkLayer();

  await createLinkLayer(page, viewport, container, state.currentPage);
}

/**
 * Clears link layer for single page mode
 */
export function clearSinglePageLinkLayer() {
  const container = document.getElementById('canvas-container');
  if (!container) return;

  const existingLayer = container.querySelector('.linkLayer');
  if (existingLayer) {
    existingLayer.remove();
  }

  // Clear from tracking map
  linkLayers.delete(state.currentPage);
}

/**
 * Clears all link layers (for re-render or cleanup)
 */
export function clearLinkLayers() {
  // Remove all link layer elements
  document.querySelectorAll('.linkLayer').forEach(layer => {
    layer.remove();
  });

  // Clear the tracking map
  linkLayers.clear();
}

/**
 * Gets the link layer for a specific page
 * @param {number} pageNum - Page number
 * @returns {HTMLElement|null} The link layer element or null
 */
export function getLinkLayer(pageNum) {
  return linkLayers.get(pageNum) || null;
}
