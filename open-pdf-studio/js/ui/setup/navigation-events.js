import { state, getActiveDocument } from '../../core/state.js';
import { goToPage } from '../../pdf/renderer.js';
import { viewport, zoomStepAtPoint, suppressNextFit, markAnchored } from '../../pdf/pdf-viewport.js';
import { getTool } from '../../tools/tool-registry.js';

// ─── Wheel Zoom + Pan + Page Navigation ───────────────────────────────────
// Single source of truth for the wheel event on the main view.
// In vector viewport mode:
//   Ctrl+wheel  → zoom at cursor (snaps to discrete preset levels)
//   plain wheel → pan inside the current page; at the page edge in the wheel
//                 direction, navigate to next/previous page.
// In legacy mode it falls back to scroll-position-based page nav.

let _pageNavCooldown = false;
// Pixels of slack at the page edge before we treat the page as "at the edge"
// and trigger a page change. Without this, sub-pixel float offsets prevent nav.
const EDGE_SLACK = 1;

// Trackpad pinch-zoom synthesizes wheel events with `ctrlKey` set and small
// deltaY values (often 1–10). A real mouse wheel notch sends ~100. We
// accumulate small deltas across events and only fire a discrete zoom step
// when the accumulator exceeds the threshold, so a single trackpad pinch
// doesn't slingshot through 5 zoom levels.
let _zoomAccum = 0;
let _zoomAccumSign = 0;
const ZOOM_DELTA_THRESHOLD = 50;
let _zoomAccumResetTimer = null;
function _resetZoomAccumSoon() {
  if (_zoomAccumResetTimer) clearTimeout(_zoomAccumResetTimer);
  _zoomAccumResetTimer = setTimeout(() => {
    _zoomAccum = 0;
    _zoomAccumSign = 0;
    _zoomAccumResetTimer = null;
  }, 200);
}

export function setupWheelZoom() {
  document.querySelector('.main-view')?.addEventListener('wheel', async (e) => {
    const activeDoc = getActiveDocument();
    if (!activeDoc?.pdfDoc) return;

    // Delegate to active tool first (e.g. arc bulge adjustment)
    const _wheelTool = getTool(state.currentTool);
    if (_wheelTool && _wheelTool.onWheel) {
      const _wheelCtx = { state, redraw: () => {
        viewport.dirty = true;
      }};
      _wheelTool.onWheel(_wheelCtx, e);
      if (e.defaultPrevented) return;
    }

    // Ctrl+wheel = zoom (snaps to discrete preset levels at the cursor).
    // When wheelZoomWithoutCtrl is enabled, plain wheel also zooms.
    const _wheelZoomWithoutCtrl = state.preferences.wheelZoomWithoutCtrl;
    if (e.ctrlKey || e.metaKey || _wheelZoomWithoutCtrl) {
      e.preventDefault();
      // Blank docs (no filePath) bypass the vector viewport entirely; their
      // zoom path is doc.scale + renderPage. Route ctrl+wheel through the
      // legacy zoomIn/zoomOut helpers for those.
      if (!viewport.active) {
        const dy = e.deltaY || 0;
        const direction = dy < 0 ? 1 : -1;
        const m = await import('../../pdf/renderer.js');
        if (direction > 0) await m.zoomIn(); else await m.zoomOut();
        return;
      }
      // Always anchor to pdf-canvas rect. The cursor may be over a non-canvas
      // overlay (textLayer span, annotation overlay child) whose own rect is
      // offset from the canvas — using e.target.getBoundingClientRect() in
      // that case gives wrong sx/sy and the zoom anchor drifts. The
      // pdf-canvas, annotation-canvas and text-highlight-canvas all share the
      // same rect, so the pdf-canvas rect is the authoritative reference.
      const _pdfCanvas = document.getElementById('pdf-canvas');
      const rect = _pdfCanvas?.getBoundingClientRect()
        || e.target.closest('canvas')?.getBoundingClientRect()
        || e.target.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const dy = e.deltaY || 0;
      const direction = dy < 0 ? 1 : -1;  // wheel up = zoom in (+1)

      // Mouse wheel notch (large deltaY) → step immediately.
      // Trackpad pinch (small deltaY) → accumulate, only step at threshold.
      if (Math.abs(dy) >= ZOOM_DELTA_THRESHOLD) {
        _zoomAccum = 0;
        _zoomAccumSign = 0;
        zoomStepAtPoint(sx, sy, direction);
      } else {
        // Reset accumulator if direction reversed
        if (_zoomAccumSign !== 0 && _zoomAccumSign !== direction) {
          _zoomAccum = 0;
        }
        _zoomAccumSign = direction;
        _zoomAccum += Math.abs(dy);
        if (_zoomAccum >= ZOOM_DELTA_THRESHOLD) {
          _zoomAccum = 0;
          zoomStepAtPoint(sx, sy, direction);
        }
        _resetZoomAccumSoon();
      }
      return;
    }

    // ─── Vector viewport mode: pan + edge-triggered page nav ──────────────
    if (viewport.active) {
      e.preventDefault();
      const pdfCanvas = document.getElementById('pdf-canvas');
      if (!pdfCanvas) return;

      const dx = e.deltaX || 0;
      const dy = e.deltaY || 0;
      const pageScreenH = viewport.pageH * viewport.zoom;
      const pageScreenW = viewport.pageW * viewport.zoom;
      const canvasH = pdfCanvas.height;
      const canvasW = pdfCanvas.width;

      // Where the page edges sit on the visible canvas right now
      const pageTop = viewport.offsetY;
      const pageBottom = viewport.offsetY + pageScreenH;
      const pageLeft = viewport.offsetX;
      const pageRight = viewport.offsetX + pageScreenW;

      // "At edge" tests — true if the page bottom/top is already inside the viewport
      const atTop = pageTop >= -EDGE_SLACK;                       // can't pan up further
      const atBottom = pageBottom <= canvasH + EDGE_SLACK;        // can't pan down further

      // Page nav: only if scroll direction matches an exhausted edge AND we're
      // single-page mode AND not already cooling down from a previous nav.
      if (activeDoc.viewMode === 'single' && !_pageNavCooldown && Math.abs(dy) > Math.abs(dx)) {
        if (dy > 0 && atBottom && activeDoc.currentPage < activeDoc.pdfDoc.numPages) {
          _pageNavCooldown = true;
          // Tell the next setPage() to keep the current zoom instead of
          // running fitToViewport(), so the user's zoom level survives the
          // page change with no flash to fit-zoom in between.
          suppressNextFit();
          await goToPage(activeDoc.currentPage + 1);
          alignPageToTop();
          setTimeout(() => { _pageNavCooldown = false; }, 250);
          return;
        }
        if (dy < 0 && atTop && activeDoc.currentPage > 1) {
          _pageNavCooldown = true;
          suppressNextFit();
          await goToPage(activeDoc.currentPage - 1);
          alignPageToBottom();
          setTimeout(() => { _pageNavCooldown = false; }, 250);
          return;
        }
      }

      // Normal pan inside the page. The viewport's clampAndCenter() runs at
      // the start of every render so we don't need to clamp here — but we
      // still skip the update entirely on axes where the page already fits,
      // otherwise wheel input would briefly knock the centered page off-center
      // before the next render snaps it back.
      let newOffsetX = (pageScreenW <= canvasW) ? viewport.offsetX : viewport.offsetX - dx;
      let newOffsetY = (pageScreenH <= canvasH) ? viewport.offsetY : viewport.offsetY - dy;

      if (newOffsetX !== viewport.offsetX || newOffsetY !== viewport.offsetY) {
        viewport.offsetX = newOffsetX;
        viewport.offsetY = newOffsetY;
        // Wheel-pan is explicit user positioning → don't let clampAndCenter
        // re-center a fit-axis on the next render.
        markAnchored();
        viewport.dirty = true;
      }
      return;
    }

    // ─── Legacy mode: scroll-position-based page nav ──────────────────────
    if (activeDoc?.viewMode !== 'single') return;
    if (_pageNavCooldown) return;

    const pdfContainer = document.getElementById('pdf-container');
    if (!pdfContainer) return;

    const canScroll = pdfContainer.scrollHeight > pdfContainer.clientHeight + 1;
    const atBottomLegacy = !canScroll || pdfContainer.scrollTop + pdfContainer.clientHeight >= pdfContainer.scrollHeight - 5;
    const atTopLegacy = !canScroll || pdfContainer.scrollTop <= 5;

    if (e.deltaY > 0 && atBottomLegacy && activeDoc.currentPage < activeDoc.pdfDoc.numPages) {
      e.preventDefault();
      _pageNavCooldown = true;
      await goToPage(activeDoc.currentPage + 1);
      setTimeout(() => { _pageNavCooldown = false; }, 300);
    } else if (e.deltaY < 0 && atTopLegacy && activeDoc.currentPage > 1) {
      e.preventDefault();
      _pageNavCooldown = true;
      await goToPage(activeDoc.currentPage - 1);
      setTimeout(() => { _pageNavCooldown = false; }, 300);
    }
  }, { passive: false });
}

// After advancing forward via wheel, snap the new page so its TOP is at the
// top of the viewport (so the user can keep scrolling down through it).
// If the new page fits the viewport entirely it will be centered instead —
// the viewport's clampAndCenter() in _render() handles that automatically,
// but we set offsetY = 0 here so the FIRST paint is already correct (no
// one-frame flash to a stale position).
function alignPageToTop() {
  viewport.offsetY = 0;
  viewport.dirty = true;
}

// After going back via wheel, snap the new page so its BOTTOM is at the
// bottom of the viewport. clampAndCenter() will center it later if it fits.
function alignPageToBottom() {
  const pdfCanvas = document.getElementById('pdf-canvas');
  if (!pdfCanvas) return;
  const pageScreenH = viewport.pageH * viewport.zoom;
  viewport.offsetY = pdfCanvas.height - pageScreenH;
  viewport.dirty = true;
}

export function cancelPendingZoom() {
  // No-op — viewport zoom is instant, no pending renders
}
