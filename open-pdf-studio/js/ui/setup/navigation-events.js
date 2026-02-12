import { state } from '../../core/state.js';
import {
  annotationCanvas, pdfCanvas, prevPageBtn, nextPageBtn, zoomInBtn, zoomOutBtn, zoomLevel, pageInput
} from '../dom-elements.js';
import { hideProperties } from '../panels/properties-panel.js';
import { renderPage, renderContinuous, zoomIn, zoomOut, goToPage } from '../../pdf/renderer.js';
import { showLoading, hideLoading } from '../chrome/dialogs.js';

// Setup navigation event listeners
export function setupNavigationEvents() {
  document.getElementById('first-page')?.addEventListener('click', async () => {
    if (state.pdfDoc && state.currentPage !== 1) {
      state.currentPage = 1;
      hideProperties();
      await renderPage(state.currentPage);
    }
  });

  prevPageBtn?.addEventListener('click', async () => {
    if (state.currentPage > 1) {
      state.currentPage--;
      hideProperties();
      await renderPage(state.currentPage);
    }
  });

  nextPageBtn?.addEventListener('click', async () => {
    if (state.pdfDoc && state.currentPage < state.pdfDoc.numPages) {
      state.currentPage++;
      hideProperties();
      await renderPage(state.currentPage);
    }
  });

  document.getElementById('last-page')?.addEventListener('click', async () => {
    if (state.pdfDoc && state.currentPage !== state.pdfDoc.numPages) {
      state.currentPage = state.pdfDoc.numPages;
      hideProperties();
      await renderPage(state.currentPage);
    }
  });

  // Page input - go to page on Enter key
  pageInput?.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const pageNum = parseInt(pageInput.value, 10);
      if (state.pdfDoc && pageNum >= 1 && pageNum <= state.pdfDoc.numPages) {
        state.currentPage = pageNum;
        hideProperties();
        await renderPage(state.currentPage);
      } else {
        // Reset to current page if invalid
        pageInput.value = state.currentPage;
      }
      pageInput.blur();
    }
  });

  // Also validate on blur
  pageInput?.addEventListener('blur', () => {
    if (state.pdfDoc) {
      const pageNum = parseInt(pageInput.value, 10);
      if (isNaN(pageNum) || pageNum < 1 || pageNum > state.pdfDoc.numPages) {
        pageInput.value = state.currentPage;
      }
    }
  });

  zoomInBtn?.addEventListener('click', zoomIn);
  zoomOutBtn?.addEventListener('click', zoomOut);

  // Zoom input - set zoom on Enter key
  zoomLevel?.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Parse the zoom value (remove % if present)
      let zoomValue = zoomLevel.value.replace('%', '').trim();
      let zoomPercent = parseInt(zoomValue, 10);

      if (!isNaN(zoomPercent) && zoomPercent >= 10 && zoomPercent <= 500) {
        state.scale = zoomPercent / 100;
        if (state.viewMode === 'continuous') {
          await renderContinuous();
        } else if (state.pdfDoc) {
          await renderPage(state.currentPage);
        }
        zoomLevel.value = `${zoomPercent}%`;
      } else {
        // Reset to current zoom if invalid
        zoomLevel.value = `${Math.round(state.scale * 100)}%`;
      }
      zoomLevel.blur();
    }
  });

  // Also validate on blur
  zoomLevel?.addEventListener('blur', () => {
    let zoomValue = zoomLevel.value.replace('%', '').trim();
    let zoomPercent = parseInt(zoomValue, 10);

    if (isNaN(zoomPercent) || zoomPercent < 10 || zoomPercent > 500) {
      zoomLevel.value = `${Math.round(state.scale * 100)}%`;
    } else if (!zoomLevel.value.includes('%')) {
      zoomLevel.value = `${zoomPercent}%`;
    }
  });
}

// Setup wheel zoom
let _zoomRenderTimer = null;
let _zoomBaseScale = null; // scale at which the canvas was last truly rendered

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

      if (zoomLevel) {
        zoomLevel.value = `${Math.round(state.scale * 100)}%`;
      }

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

    const pdfContainer = document.getElementById('pdf-container');
    if (!pdfContainer) return;
    const scrollTop = pdfContainer.scrollTop;
    const scrollHeight = pdfContainer.scrollHeight;
    const clientHeight = pdfContainer.clientHeight;

    // Scrolling down at the bottom
    if (e.deltaY > 0 && scrollTop + clientHeight >= scrollHeight - 5) {
      if (state.currentPage < state.pdfDoc.numPages) {
        e.preventDefault();
        await goToPage(state.currentPage + 1);
        pdfContainer.scrollTop = 0;
      }
    }
    // Scrolling up at the top
    else if (e.deltaY < 0 && scrollTop <= 5) {
      if (state.currentPage > 1) {
        e.preventDefault();
        await goToPage(state.currentPage - 1);
        pdfContainer.scrollTop = pdfContainer.scrollHeight;
      }
    }
  }, { passive: false });
}
