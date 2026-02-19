import { state, getPageRotation, setPageRotation } from '../core/state.js';
import { pdfCanvas, annotationCanvas, pdfCtx } from '../ui/dom-elements.js';
import { redrawAnnotations, renderAnnotationsForPage } from '../annotations/rendering.js';
import { ensureAnnotationsForPage, hidePdfABar } from './loader.js';
import { updateAllStatus } from '../ui/chrome/status-bar.js';
import { hideProperties } from '../ui/panels/properties-panel.js';
import { getCursorForTool } from '../tools/manager.js';
import { updateActiveThumbnail } from '../ui/panels/left-panel.js';
import { createSinglePageTextLayer, clearSinglePageTextLayer, createTextLayer, clearTextLayers } from '../text/text-layer.js';
import { createSinglePageLinkLayer, clearSinglePageLinkLayer, createLinkLayer, clearLinkLayers } from './link-layer.js';
import { createSinglePageFormLayer, clearSinglePageFormLayer, createFormLayer, clearFormLayers, hideFormFieldsBar } from './form-layer.js';

// Track current render task to cancel if needed
let currentRenderTask = null;

// Render PDF page (single page mode)
export async function renderPage(pageNum) {
  if (!state.pdfDoc) return;

  // Cancel any ongoing render task
  if (currentRenderTask) {
    try {
      currentRenderTask.cancel();
    } catch (e) {
      // Ignore cancel errors
    }
    currentRenderTask = null;
  }

  const page = await state.pdfDoc.getPage(pageNum);
  const extraRotation = getPageRotation(pageNum);
  const viewportOpts = { scale: state.scale };
  if (extraRotation) {
    viewportOpts.rotation = (page.rotate + extraRotation) % 360;
  }
  const viewport = page.getViewport(viewportOpts);

  // Set canvas dimensions
  pdfCanvas.width = viewport.width;
  pdfCanvas.height = viewport.height;
  annotationCanvas.width = viewport.width;
  annotationCanvas.height = viewport.height;

  // Set CSS scale variables for PDF.js text/annotation layers
  const container = document.getElementById('canvas-container');
  if (container) {
    container.style.setProperty('--scale-factor', viewport.scale);
    container.style.setProperty('--total-scale-factor', viewport.scale);
  }

  // Render PDF page
  const ctx = pdfCanvas.getContext('2d');
  const renderContext = {
    canvasContext: ctx,
    viewport: viewport,
    annotationMode: 0 // DISABLE - annotations are rendered by the app's overlay canvas
  };

  currentRenderTask = page.render(renderContext);

  try {
    await currentRenderTask.promise;
  } catch (e) {
    if (e.name === 'RenderingCancelledException') {
      return; // Render was cancelled, don't proceed
    }
    throw e;
  }

  currentRenderTask = null;

  // Create text layer for text selection
  try {
    await createSinglePageTextLayer(page, viewport);
  } catch (e) {
    console.warn('Failed to create text layer:', e);
  }

  // Create link layer for clickable links
  try {
    await createSinglePageLinkLayer(page, viewport);
  } catch (e) {
    console.warn('Failed to create link layer:', e);
  }

  // Create form layer for interactive form fields
  try {
    await createSinglePageFormLayer(page, viewport);
  } catch (e) {
    console.warn('Failed to create form layer:', e);
  }

  // Re-apply overlay state for newly created layers (setTool may not have run yet)
  if (state.currentTool === 'select' || state.currentTool === 'editText') {
    annotationCanvas.style.zIndex = '2';
    annotationCanvas.style.pointerEvents = 'none';
    const container = document.getElementById('canvas-container');
    if (container) {
      container.querySelectorAll('.formLayer section, .linkLayer .pdf-link').forEach(el => {
        el.style.pointerEvents = 'none';
      });
    }
  }

  // Ensure annotations for this page are loaded (on-demand if background hasn't reached it yet)
  await ensureAnnotationsForPage(pageNum);

  // Redraw annotations
  redrawAnnotations();

  // Update status bar
  updateAllStatus();
}

// Track which pages have been rendered in continuous mode
const _renderedPages = new Set();
let _continuousObserver = null;

// Render a single page inside its wrapper (used by lazy rendering)
async function renderContinuousPage(pageNum) {
  if (_renderedPages.has(pageNum)) return;
  _renderedPages.add(pageNum);

  const pageWrapper = document.querySelector(`.page-wrapper[data-page="${pageNum}"]`);
  if (!pageWrapper) return;

  const canvasContainer = pageWrapper.querySelector('.canvas-container-cont');
  if (!canvasContainer) return;

  const page = await state.pdfDoc.getPage(pageNum);
  const extraRotation = getPageRotation(pageNum);
  const vpOpts = { scale: state.scale };
  if (extraRotation) {
    vpOpts.rotation = (page.rotate + extraRotation) % 360;
  }
  const viewport = page.getViewport(vpOpts);

  canvasContainer.style.setProperty('--scale-factor', viewport.scale);
  canvasContainer.style.setProperty('--total-scale-factor', viewport.scale);

  // Create PDF canvas
  const pdfCanvasEl = document.createElement('canvas');
  pdfCanvasEl.className = 'pdf-canvas';
  pdfCanvasEl.width = viewport.width;
  pdfCanvasEl.height = viewport.height;
  pdfCanvasEl.dataset.page = pageNum;
  pdfCanvasEl.style.display = 'block';
  pdfCanvasEl.style.background = 'white';

  // Create annotation canvas
  const annotationCanvasEl = document.createElement('canvas');
  annotationCanvasEl.className = 'annotation-canvas';
  annotationCanvasEl.width = viewport.width;
  annotationCanvasEl.height = viewport.height;
  annotationCanvasEl.dataset.page = pageNum;
  annotationCanvasEl.style.position = 'absolute';
  annotationCanvasEl.style.top = '0';
  annotationCanvasEl.style.left = '0';
  annotationCanvasEl.style.cursor = getCursorForTool();
  // Apply text-access overrides if select or editText tool is active
  if (state.currentTool === 'select' || state.currentTool === 'editText') {
    annotationCanvasEl.style.zIndex = '2';
    annotationCanvasEl.style.pointerEvents = 'none';
  }

  canvasContainer.appendChild(pdfCanvasEl);
  canvasContainer.appendChild(annotationCanvasEl);

  // Render PDF page
  const pdfCtxEl = pdfCanvasEl.getContext('2d');
  try {
    await page.render({
      canvasContext: pdfCtxEl,
      viewport: viewport,
      annotationMode: 0
    }).promise;
  } catch (error) {
    console.error(`Error rendering page ${pageNum}:`, error);
  }

  // Create text layer
  try {
    await createTextLayer(page, viewport, canvasContainer, pageNum);
  } catch (e) {
    console.warn(`Failed to create text layer for page ${pageNum}:`, e);
  }

  // Create link layer
  try {
    await createLinkLayer(page, viewport, canvasContainer, pageNum);
  } catch (e) {
    console.warn(`Failed to create link layer for page ${pageNum}:`, e);
  }

  // Create form layer
  try {
    await createFormLayer(page, viewport, canvasContainer, pageNum);
  } catch (e) {
    console.warn(`Failed to create form layer for page ${pageNum}:`, e);
  }

  // Re-apply overlay state for newly created form/link layers
  if (state.currentTool === 'select' || state.currentTool === 'editText') {
    canvasContainer.querySelectorAll('.formLayer section, .linkLayer .pdf-link').forEach(el => {
      el.style.pointerEvents = 'none';
    });
  }

  // Render annotations
  const annotationCtxEl = annotationCanvasEl.getContext('2d');
  renderAnnotationsForPage(annotationCtxEl, pageNum, viewport.width, viewport.height);

  // Setup mouse events
  setupContinuousPageEvents(annotationCanvasEl, pageNum);
}

// Render all pages (continuous mode) — creates placeholders, lazily renders visible pages
export async function renderContinuous() {
  if (!state.pdfDoc) return;

  // Cleanup previous observer
  if (_continuousObserver) {
    _continuousObserver.disconnect();
    _continuousObserver = null;
  }
  _renderedPages.clear();

  const continuousContainer = document.getElementById('continuous-container');
  continuousContainer.innerHTML = '';

  clearTextLayers();
  clearLinkLayers();
  clearFormLayers();

  // First pass: create all page wrappers with correct dimensions (no rendering)
  for (let pageNum = 1; pageNum <= state.pdfDoc.numPages; pageNum++) {
    const page = await state.pdfDoc.getPage(pageNum);
    const extraRotation = getPageRotation(pageNum);
    const vpOpts = { scale: state.scale };
    if (extraRotation) {
      vpOpts.rotation = (page.rotate + extraRotation) % 360;
    }
    const viewport = page.getViewport(vpOpts);

    const pageWrapper = document.createElement('div');
    pageWrapper.className = 'page-wrapper';
    pageWrapper.dataset.page = pageNum;

    const pageLabel = document.createElement('div');
    pageLabel.className = 'page-number-label';
    pageLabel.textContent = `Page ${pageNum}`;
    pageWrapper.appendChild(pageLabel);

    // Placeholder container with correct dimensions
    const canvasContainer = document.createElement('div');
    canvasContainer.className = 'canvas-container-cont';
    canvasContainer.style.position = 'relative';
    canvasContainer.style.display = 'inline-block';
    canvasContainer.style.width = `${viewport.width}px`;
    canvasContainer.style.height = `${viewport.height}px`;
    canvasContainer.style.background = 'white';
    canvasContainer.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.3)';

    pageWrapper.appendChild(canvasContainer);
    continuousContainer.appendChild(pageWrapper);
  }

  updateAllStatus();

  // Setup IntersectionObserver to lazily render pages as they scroll into view
  const scrollContainer = document.getElementById('pdf-container');
  _continuousObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        const pageNum = parseInt(entry.target.dataset.page, 10);
        if (pageNum && !_renderedPages.has(pageNum)) {
          renderContinuousPage(pageNum);
        }
      }
    }
  }, {
    root: scrollContainer,
    rootMargin: '200px 0px'
  });

  // Observe all page wrappers
  continuousContainer.querySelectorAll('.page-wrapper').forEach(wrapper => {
    _continuousObserver.observe(wrapper);
  });
}

// Setup mouse events for continuous mode pages
function setupContinuousPageEvents(canvas, pageNum) {
  // Import event handlers dynamically to avoid circular dependencies
  import('../tools/mouse-handlers.js').then(({ handleContinuousMouseDown, handleContinuousMouseMove, handleContinuousMouseUp }) => {
    canvas.addEventListener('mousedown', (e) => handleContinuousMouseDown(e, pageNum));
    canvas.addEventListener('mousemove', (e) => handleContinuousMouseMove(e, pageNum));
    canvas.addEventListener('mouseup', (e) => handleContinuousMouseUp(e, pageNum));
  });
}

// Switch view mode
export async function setViewMode(mode) {
  if (!state.pdfDoc) return;

  state.viewMode = mode;
  const singleContainer = document.getElementById('canvas-container');
  const continuousContainer = document.getElementById('continuous-container');

  if (mode === 'single') {
    singleContainer.style.display = 'inline-block';
    continuousContainer.style.display = 'none';
    await renderPage(state.currentPage);
  } else if (mode === 'continuous') {
    singleContainer.style.display = 'none';
    continuousContainer.style.display = 'flex';
    await renderContinuous();
  }
}

// Go to specific page
export async function goToPage(pageNum) {
  if (!state.pdfDoc) return;

  if (pageNum < 1) pageNum = 1;
  if (pageNum > state.pdfDoc.numPages) pageNum = state.pdfDoc.numPages;

  state.currentPage = pageNum;
  hideProperties();

  if (state.viewMode === 'single') {
    await renderPage(pageNum);
    const pdfContainer = document.getElementById('pdf-container');
    if (pdfContainer) {
      pdfContainer.scrollTop = 0;
    }
  } else {
    // Scroll to page in continuous mode
    const pageWrapper = document.querySelector(`.page-wrapper[data-page="${pageNum}"]`);
    if (pageWrapper) {
      pageWrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // Update active thumbnail in left panel
  updateActiveThumbnail();
}

// Zoom controls
export async function zoomIn() {
  state.scale += 0.25;


  if (state.viewMode === 'continuous') {
    await renderContinuous();
  } else {
    await renderPage(state.currentPage);
  }
}

export async function zoomOut() {
  if (state.scale > 0.5) {
    state.scale -= 0.25;
  

    if (state.viewMode === 'continuous') {
      await renderContinuous();
    } else {
      await renderPage(state.currentPage);
    }
  }
}

export async function setZoom(newScale) {
  state.scale = newScale;


  if (state.viewMode === 'continuous') {
    await renderContinuous();
  } else {
    await renderPage(state.currentPage);
  }
}

export async function fitWidth() {
  if (!state.pdfDoc) return;

  const page = await state.pdfDoc.getPage(state.currentPage);
  const extraRot = getPageRotation(state.currentPage);
  const fwOpts = { scale: 1 };
  if (extraRot) fwOpts.rotation = (page.rotate + extraRot) % 360;
  const viewport = page.getViewport(fwOpts);
  const container = document.getElementById('pdf-container');
  const containerWidth = container.clientWidth - 40; // padding
  state.scale = containerWidth / viewport.width;



  if (state.viewMode === 'continuous') {
    await renderContinuous();
  } else {
    await renderPage(state.currentPage);
  }
}

export async function fitPage() {
  if (!state.pdfDoc) return;

  const page = await state.pdfDoc.getPage(state.currentPage);
  const extraRot2 = getPageRotation(state.currentPage);
  const fpOpts = { scale: 1 };
  if (extraRot2) fpOpts.rotation = (page.rotate + extraRot2) % 360;
  const viewport = page.getViewport(fpOpts);
  const container = document.getElementById('pdf-container');
  const containerWidth = container.clientWidth - 40;
  const containerHeight = container.clientHeight - 40;
  const scaleX = containerWidth / viewport.width;
  const scaleY = containerHeight / viewport.height;
  state.scale = Math.min(scaleX, scaleY);



  if (state.viewMode === 'continuous') {
    await renderContinuous();
  } else {
    await renderPage(state.currentPage);
  }
}

export async function actualSize() {
  state.scale = 1;

  if (state.pdfDoc) {
    if (state.viewMode === 'continuous') {
      await renderContinuous();
    } else {
      await renderPage(state.currentPage);
    }
  }
}

// Rotate the current page by a delta (±90)
export async function rotatePage(delta, targetPage) {
  if (!state.pdfDoc) return;
  const pageNum = targetPage || state.currentPage;
  const current = getPageRotation(pageNum);
  setPageRotation(pageNum, current + delta);

  // Mark document as modified
  const doc = state.documents[state.activeDocumentIndex];
  if (doc) doc.modified = true;

  // Re-render
  if (state.viewMode === 'continuous') {
    await renderContinuous();
  } else {
    await renderPage(pageNum);
  }

  // Update thumbnails
  const { invalidateThumbnail } = await import('../ui/panels/left-panel.js');
  invalidateThumbnail(pageNum);
}

// Clear the PDF view when no document is open
export function clearPdfView() {
  // Clear single page mode canvases
  pdfCtx.clearRect(0, 0, pdfCanvas.width, pdfCanvas.height);
  const annotationCtx = annotationCanvas.getContext('2d');
  annotationCtx.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);

  // Clear continuous mode container
  const continuousContainer = document.getElementById('continuous-container');
  if (continuousContainer) {
    continuousContainer.innerHTML = '';
  }

  // Clear text, link, and form layers
  clearSinglePageTextLayer();
  clearTextLayers();
  clearSinglePageLinkLayer();
  clearLinkLayers();
  clearSinglePageFormLayer();
  clearFormLayers();
  hideFormFieldsBar();
  hidePdfABar();

  // Show placeholder if no documents open
  const placeholder = document.getElementById('placeholder');
  const pdfContainer = document.getElementById('pdf-container');
  if (placeholder) placeholder.style.display = 'flex';
  if (pdfContainer) pdfContainer.classList.remove('visible');

  // Update status bar (derives from reactive state)
  updateAllStatus();
}
