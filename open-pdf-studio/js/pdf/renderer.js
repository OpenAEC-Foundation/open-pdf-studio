import { state } from '../core/state.js';
import {
  pdfCanvas, annotationCanvas, pdfCtx,
  pageInfo, pageInput, pageTotal, prevPageBtn, nextPageBtn, zoomLevel
} from '../ui/dom-elements.js';
import { redrawAnnotations, renderAnnotationsForPage } from '../annotations/rendering.js';
import { updateAllStatus } from '../ui/status-bar.js';
import { hideProperties } from '../ui/properties-panel.js';

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
  const viewport = page.getViewport({ scale: state.scale });

  // Set canvas dimensions
  pdfCanvas.width = viewport.width;
  pdfCanvas.height = viewport.height;
  annotationCanvas.width = viewport.width;
  annotationCanvas.height = viewport.height;

  // Render PDF page
  const ctx = pdfCanvas.getContext('2d');
  const renderContext = {
    canvasContext: ctx,
    viewport: viewport
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

  // Redraw annotations
  redrawAnnotations();

  // Update page info
  pageInput.value = pageNum;
  pageInput.max = state.pdfDoc.numPages;
  pageTotal.textContent = state.pdfDoc.numPages;
  prevPageBtn.disabled = pageNum === 1;
  nextPageBtn.disabled = pageNum === state.pdfDoc.numPages;

  // Update status bar
  updateAllStatus();
}

// Render all pages (continuous mode)
export async function renderContinuous() {
  if (!state.pdfDoc) return;

  const continuousContainer = document.getElementById('continuous-container');
  continuousContainer.innerHTML = ''; // Clear existing content

  for (let pageNum = 1; pageNum <= state.pdfDoc.numPages; pageNum++) {
    const page = await state.pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: state.scale });

    // Create wrapper for each page
    const pageWrapper = document.createElement('div');
    pageWrapper.className = 'page-wrapper';
    pageWrapper.dataset.page = pageNum;

    // Add page number label
    const pageLabel = document.createElement('div');
    pageLabel.className = 'page-number-label';
    pageLabel.textContent = `Page ${pageNum}`;
    pageWrapper.appendChild(pageLabel);

    // Create container for canvas layers
    const canvasContainer = document.createElement('div');
    canvasContainer.style.position = 'relative';
    canvasContainer.style.display = 'inline-block';

    // Create PDF canvas
    const pdfCanvasEl = document.createElement('canvas');
    pdfCanvasEl.className = 'pdf-canvas';
    pdfCanvasEl.width = viewport.width;
    pdfCanvasEl.height = viewport.height;
    pdfCanvasEl.dataset.page = pageNum;
    pdfCanvasEl.style.display = 'block';
    pdfCanvasEl.style.background = 'white';
    pdfCanvasEl.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.3)';

    // Create annotation canvas
    const annotationCanvasEl = document.createElement('canvas');
    annotationCanvasEl.className = 'annotation-canvas';
    annotationCanvasEl.width = viewport.width;
    annotationCanvasEl.height = viewport.height;
    annotationCanvasEl.dataset.page = pageNum;
    annotationCanvasEl.style.position = 'absolute';
    annotationCanvasEl.style.top = '0';
    annotationCanvasEl.style.left = '0';
    annotationCanvasEl.style.cursor = 'crosshair';

    // Append canvases to container
    canvasContainer.appendChild(pdfCanvasEl);
    canvasContainer.appendChild(annotationCanvasEl);
    pageWrapper.appendChild(canvasContainer);
    continuousContainer.appendChild(pageWrapper);

    // Render PDF page AFTER adding to DOM
    const pdfCtxEl = pdfCanvasEl.getContext('2d');
    try {
      await page.render({
        canvasContext: pdfCtxEl,
        viewport: viewport
      }).promise;
    } catch (error) {
      console.error(`Error rendering page ${pageNum}:`, error);
    }

    // Render annotations for this page
    const annotationCtxEl = annotationCanvasEl.getContext('2d');
    renderAnnotationsForPage(annotationCtxEl, pageNum, viewport.width, viewport.height);

    // Add event listeners for annotations (using closure to capture pageNum)
    setupContinuousPageEvents(annotationCanvasEl, pageNum);
  }

  // Update page info (disable input in continuous mode)
  pageInput.value = 1;
  pageInput.max = state.pdfDoc.numPages;
  pageInput.disabled = true;
  pageTotal.textContent = state.pdfDoc.numPages;
  prevPageBtn.disabled = true;
  nextPageBtn.disabled = true;

  // Update status bar
  updateAllStatus();
}

// Setup mouse events for continuous mode pages
function setupContinuousPageEvents(canvas, pageNum) {
  // Import event handlers dynamically to avoid circular dependencies
  import('../events/mouse-handlers.js').then(({ handleContinuousMouseDown, handleContinuousMouseMove, handleContinuousMouseUp }) => {
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
    pageInput.disabled = false;
    await renderPage(state.currentPage);

    // Update button states
    document.getElementById('single-page')?.classList.add('active');
    document.getElementById('continuous')?.classList.remove('active');
  } else if (mode === 'continuous') {
    singleContainer.style.display = 'none';
    continuousContainer.style.display = 'flex';
    await renderContinuous();

    // Update button states
    document.getElementById('single-page')?.classList.remove('active');
    document.getElementById('continuous')?.classList.add('active');
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
  } else {
    // Scroll to page in continuous mode
    const pageWrapper = document.querySelector(`.page-wrapper[data-page="${pageNum}"]`);
    if (pageWrapper) {
      pageWrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
}

// Zoom controls
export async function zoomIn() {
  state.scale += 0.25;
  zoomLevel.value = `${Math.round(state.scale * 100)}%`;

  if (state.viewMode === 'continuous') {
    await renderContinuous();
  } else {
    await renderPage(state.currentPage);
  }
}

export async function zoomOut() {
  if (state.scale > 0.5) {
    state.scale -= 0.25;
    zoomLevel.value = `${Math.round(state.scale * 100)}%`;

    if (state.viewMode === 'continuous') {
      await renderContinuous();
    } else {
      await renderPage(state.currentPage);
    }
  }
}

export async function setZoom(newScale) {
  state.scale = newScale;
  zoomLevel.value = `${Math.round(state.scale * 100)}%`;

  if (state.viewMode === 'continuous') {
    await renderContinuous();
  } else {
    await renderPage(state.currentPage);
  }
}

export async function fitWidth() {
  if (!state.pdfDoc) return;

  const page = await state.pdfDoc.getPage(state.currentPage);
  const viewport = page.getViewport({ scale: 1 });
  const container = document.querySelector('.main-view');
  const containerWidth = container.clientWidth - 40; // padding
  state.scale = containerWidth / viewport.width;

  zoomLevel.value = `${Math.round(state.scale * 100)}%`;

  if (state.viewMode === 'continuous') {
    await renderContinuous();
  } else {
    await renderPage(state.currentPage);
  }
}

export async function fitPage() {
  if (!state.pdfDoc) return;

  const page = await state.pdfDoc.getPage(state.currentPage);
  const viewport = page.getViewport({ scale: 1 });
  const container = document.querySelector('.main-view');
  const containerWidth = container.clientWidth - 40;
  const containerHeight = container.clientHeight - 40;
  const scaleX = containerWidth / viewport.width;
  const scaleY = containerHeight / viewport.height;
  state.scale = Math.min(scaleX, scaleY);

  zoomLevel.value = `${Math.round(state.scale * 100)}%`;

  if (state.viewMode === 'continuous') {
    await renderContinuous();
  } else {
    await renderPage(state.currentPage);
  }
}

export async function actualSize() {
  state.scale = 1;
  zoomLevel.value = '100%';

  if (state.pdfDoc) {
    if (state.viewMode === 'continuous') {
      await renderContinuous();
    } else {
      await renderPage(state.currentPage);
    }
  }
}
