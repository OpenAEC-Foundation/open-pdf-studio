import { state } from '../../core/state.js';
import { annotationCanvas } from '../dom-elements.js';
import { renderPage, renderContinuous, goToPage } from '../../pdf/renderer.js';
import { showLoading, hideLoading } from '../chrome/dialogs.js';

// Setup wheel zoom
let _zoomRenderTimer = null;
let _zoomBaseScale = null; // scale at which the canvas was last truly rendered
let _pageNavCooldown = false; // prevent rapid page flipping from wheel events

export function setupWheelZoom() {
  document.querySelector('.main-view')?.addEventListener('wheel', async (e) => {
    if (!state.pdfDoc) return;

    // Check if Ctrl key is pressed for zoom functionality
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();

      const minZoom = 0.25;
      const maxZoom = 10.0;
      const oldScale = state.scale;

      // Multiplicative zoom: smooth at all levels, works with trackpad pinch too
      // Mouse wheel deltaY is ~+-100 per tick, trackpad gives smaller values
      const factor = Math.pow(0.999, e.deltaY);
      state.scale = Math.min(Math.max(state.scale * factor, minZoom), maxZoom);

      // Round to avoid floating point noise (e.g. 0.9999999 -> 1.0)
      state.scale = Math.round(state.scale * 1000) / 1000;

      if (state.scale === oldScale) return;

      const scrollContainer = document.getElementById('pdf-container');
      if (!scrollContainer) return;

      const isContinuous = state.viewMode === 'continuous';
      const canvas = isContinuous
        ? document.querySelector('#continuous-container .annotation-canvas')
        : annotationCanvas;
      if (!canvas) return;

      // Record the scale at which the canvas was actually rendered
      if (_zoomBaseScale === null) _zoomBaseScale = oldScale;

      // Anchor zoom to mouse cursor
      const canvasRect = canvas.getBoundingClientRect();
      const mouseOnCanvasX = e.clientX - canvasRect.left;
      const mouseOnCanvasY = e.clientY - canvasRect.top;
      const docX = mouseOnCanvasX / oldScale;
      const docY = mouseOnCanvasY / oldScale;

      // Scale canvases via CSS width/height for instant flicker-free feedback.
      // Unlike CSS transform, this updates layout (centering, scroll area)
      // without clearing the canvas pixel buffer.
      const cssScale = state.scale / _zoomBaseScale;
      const canvasSelector = isContinuous
        ? '#continuous-container canvas'
        : '#canvas-container canvas';
      document.querySelectorAll(canvasSelector).forEach(c => {
        c.style.width = (c.width * cssScale) + 'px';
        c.style.height = (c.height * cssScale) + 'px';
      });

      // Scroll so that the document point stays under the mouse cursor
      const newCanvasRect = canvas.getBoundingClientRect();
      const newPointViewportX = newCanvasRect.left + docX * state.scale;
      const newPointViewportY = newCanvasRect.top + docY * state.scale;
      scrollContainer.scrollLeft += newPointViewportX - e.clientX;
      scrollContainer.scrollTop += newPointViewportY - e.clientY;

      // Debounce the actual full-quality render (fires once after zooming stops)
      if (_zoomRenderTimer) clearTimeout(_zoomRenderTimer);
      _zoomRenderTimer = setTimeout(async () => {
        _zoomRenderTimer = null;
        _zoomBaseScale = null;

        // Show loading indicator for slow renders at high zoom
        let loadingShown = false;
        const loadingDelay = setTimeout(() => {
          loadingShown = true;
          showLoading('Rendering...');
        }, 200);

        // Reset CSS sizing and render at full quality
        document.querySelectorAll(canvasSelector).forEach(c => {
          c.style.width = '';
          c.style.height = '';
        });
        try {
          if (isContinuous) {
            await renderContinuous();
          } else {
            await renderPage(state.currentPage);
          }
        } finally {
          clearTimeout(loadingDelay);
          if (loadingShown) hideLoading();
        }
      }, 150);

      return;
    }

    // Page navigation in single page mode (without Ctrl)
    if (state.viewMode !== 'single') return;
    if (_pageNavCooldown) return;

    const pdfContainer = document.getElementById('pdf-container');
    if (!pdfContainer) return;
    const scrollTop = pdfContainer.scrollTop;
    const scrollHeight = pdfContainer.scrollHeight;
    const clientHeight = pdfContainer.clientHeight;

    // At low zoom the page fits entirely in the viewport — no scrollbar.
    // Scroll thresholds don't work here, so treat it as always at boundary.
    const canScroll = scrollHeight > clientHeight + 1;
    const atBottom = !canScroll || scrollTop + clientHeight >= scrollHeight - 5;
    const atTop = !canScroll || scrollTop <= 5;

    // Scrolling down at the bottom (or page fits in viewport)
    if (e.deltaY > 0 && atBottom) {
      if (state.currentPage < state.pdfDoc.numPages) {
        e.preventDefault();
        _pageNavCooldown = true;
        await goToPage(state.currentPage + 1);
        pdfContainer.scrollTop = 0;
        setTimeout(() => { _pageNavCooldown = false; }, 300);
      }
    }
    // Scrolling up at the top (or page fits in viewport)
    else if (e.deltaY < 0 && atTop) {
      if (state.currentPage > 1) {
        e.preventDefault();
        _pageNavCooldown = true;
        await goToPage(state.currentPage - 1);
        // Scroll to bottom of previous page only if it needs scrolling
        if (pdfContainer.scrollHeight > pdfContainer.clientHeight + 1) {
          pdfContainer.scrollTop = pdfContainer.scrollHeight - pdfContainer.clientHeight;
        }
        setTimeout(() => { _pageNavCooldown = false; }, 300);
      }
    }
  }, { passive: false });
}
