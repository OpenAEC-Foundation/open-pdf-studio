import { state, getActiveDocument } from '../../core/state.js';
import { goToPage } from '../../pdf/renderer.js';
import { viewport, zoomStepAtPoint, suppressNextFit, addPanVelocity, stopPanMomentum } from '../../pdf/pdf-viewport.js';
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

    // Ctrl+wheel = zoom — handled FIRST, before tool delegation, so the
    // user can always zoom regardless of the active tool (line, pencil,
    // select, polygon, etc.). Previously the wheel was delegated to the
    // tool first; if any tool's onWheel preventDefault'd (even by accident
    // mid-arc/polyline construction), ctrl+wheel zoom silently broke.
    // When the wheelZoomWithoutCtrl voorkeur aan staat, zoomt een gewoon
    // wielrol ook (Ctrl+wiel blijft altijd werken).
    if (e.ctrlKey || e.metaKey || state.preferences.wheelZoomWithoutCtrl) {
      e.preventDefault();
      // Starting a zoom gesture: kill any in-flight pan momentum so the page
      // doesn't keep gliding mid-zoom (would tear the cursor anchor away).
      stopPanMomentum();
      if (!viewport.active || !activeDoc.filePath) {
        // Continuous mode: the vector viewport is deliberately inactive
        // (renderContinuous() disables it) — route the zoom through the
        // continuous helper, anchored at the cursor's Y position so the
        // content under the mouse stays put.
        if (activeDoc.viewMode === 'continuous' && activeDoc.filePath) {
          const contDy = e.deltaY || 0;
          if (contDy !== 0) {
            const container = document.getElementById('pdf-container');
            const anchorY = container
              ? e.clientY - container.getBoundingClientRect().top
              : null;
            // Proportional zoom: scale tracks the wheel delta directly so the
            // page follows the cursor immediately instead of jumping a fixed
            // chunk per notch. Clamp per event so a high-res wheel can't
            // slingshot through several zoom levels at once.
            let zf = Math.pow(1.0012, -contDy);
            zf = Math.max(0.5, Math.min(2.0, zf));
            const m = await import('../../pdf/renderer.js');
            m.continuousZoomBy(zf, anchorY);
          }
          return;
        }
        // No PDF loaded → bail (preventDefault already ran).
        // Blank docs (filePath===null) bypass the vector viewport and use
        // PDF.js + doc.scale instead. zoomStepAtPoint() below would mutate
        // the stale viewport state from a previously-opened real PDF, not
        // the blank doc's doc.scale → ctrl+wheel appears dead. Fall back
        // to the legacy zoomIn/zoomOut path (loses cursor anchor, but at
        // least the user can zoom).
        if (activeDoc.pdfDoc && activeDoc.filePath === null) {
          const wheelDy = e.deltaY || 0;
          if (wheelDy !== 0) {
            const m = await import('../../pdf/renderer.js');
            if (wheelDy < 0) await m.zoomIn(); else await m.zoomOut();
          }
        }
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

    // Plain wheel (no modifier) — delegate to active tool first so tools
    // that consume wheel (e.g. arc-bulge adjustment in filled-area /
    // measurement tools) can intercept. If the tool preventDefaults, we
    // skip the pan/page-nav handling below.
    const _wheelTool = getTool(state.currentTool);
    if (_wheelTool && _wheelTool.onWheel) {
      const _wheelCtx = { state, redraw: () => {
        viewport.dirty = true;
      }};
      _wheelTool.onWheel(_wheelCtx, e);
      if (e.defaultPrevented) return;
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
      // CSS-pixels, niet de backing-store. viewport.offsetY/zoom rekenen in
      // CSS-pixels; `pdfCanvas.height` is dpr maal zo groot. Op een scherm met
      // dpr > 1 maakte dat het kijkvenster kunstmatig hoog, waardoor "onderaan
      // de pagina" te vroeg waar was en de pan-onderdrukking hieronder ook
      // pagina's blokkeerde die wél scrollruimte hadden.
      const canvasRect = pdfCanvas.getBoundingClientRect();
      const canvasH = canvasRect.height;
      const canvasW = canvasRect.width;

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
          // Kill any in-flight pan momentum so the new page doesn't inherit
          // the previous page's residual scroll velocity (would slingshot
          // past the top into the centered fit position).
          stopPanMomentum();
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
          stopPanMomentum();
          suppressNextFit();
          await goToPage(activeDoc.currentPage - 1);
          alignPageToBottom();
          setTimeout(() => { _pageNavCooldown = false; }, 250);
          return;
        }
      }

      // Smooth pan: feed wheel deltas into the velocity accumulator instead
      // of writing offsetX/Y directly. The RAF loop in pdf-viewport applies
      // and decays the velocity over multiple frames, producing Apple-style
      // momentum scroll — a single wheel notch glides to a smooth stop.
      // Skip the contribution on any axis where the page already fits the
      // viewport (no scroll headroom on that axis).
      const vx = (pageScreenW <= canvasW) ? 0 : dx;
      const vy = (pageScreenH <= canvasH) ? 0 : dy;
      if (vx !== 0 || vy !== 0) {
        addPanVelocity(vx, vy);
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

// Verticale uitlijning van een pagina na wiel-navigatie.
//
// Past de pagina volledig in het kijkvenster, dan is er niets uit te lijnen:
// boven- én onderrand zijn al zichtbaar. In dat geval hoort de pagina gewoon
// gecentreerd te staan, precies zoals na Pagina passend.
//
// Deze twee functies leunden daarvoor op clampAndCenter(), die een passende
// pagina elke frame hercentreerde. Die functie is later leeggemaakt (vrije
// pan/zoom), waardoor het vangnet wegviel: sindsdien bleef een passende pagina
// staan waar hier neergezet — boven-uitgelijnd bij naar beneden scrollen,
// onder-uitgelijnd bij naar boven scrollen. De pagina leek daardoor bij elke
// wielrol een stukje op en neer te springen terwijl er niets te scrollen viel.
//
// Rekenen in CSS-pixels; viewport.offsetY doet dat ook.
function _viewportHeightCss() {
  const pdfCanvas = document.getElementById('pdf-canvas');
  if (!pdfCanvas) return 0;
  return pdfCanvas.getBoundingClientRect().height;
}

// After advancing forward via wheel, snap the new page so its TOP is at the
// top of the viewport (so the user can keep scrolling down through it).
function alignPageToTop() {
  const vpH = _viewportHeightCss();
  const pageScreenH = viewport.pageH * viewport.zoom;
  viewport.offsetY = (vpH > 0 && pageScreenH <= vpH)
    ? (vpH - pageScreenH) / 2
    : 0;
  viewport.dirty = true;
}

// After going back via wheel, snap the new page so its BOTTOM is at the
// bottom of the viewport.
function alignPageToBottom() {
  const vpH = _viewportHeightCss();
  if (!vpH) return;
  const pageScreenH = viewport.pageH * viewport.zoom;
  viewport.offsetY = (pageScreenH <= vpH)
    ? (vpH - pageScreenH) / 2
    : vpH - pageScreenH;
  viewport.dirty = true;
}

export function cancelPendingZoom() {
  // No-op — viewport zoom is instant, no pending renders
}
