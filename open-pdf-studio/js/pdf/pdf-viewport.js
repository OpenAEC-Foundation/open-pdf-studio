// pdf-viewport.js — Unified viewport: fixed canvas, transform zoom/pan, RAF loop.
// Modeled after Open2D Studio's CADRenderer pattern.
// The ONLY render path for PDF pages. No fallback, no CSS-scale, no debounce.

import { renderVectorPage } from './vector-renderer.js';
import { state, getActiveDocument } from '../core/state.js';
import { findAnnotationAt as _findAnnotationAt } from '../annotations/geometry.js';
import { getTextLayerCssMatrix, resolveTextEditPageGeometry } from '../text/text-edit-appearance.js';
import {
  computeZoomBucket,
  getBestAvailableBitmap,
  ensureBitmap,
  getCachedBitmap,
} from './page-bitmap-cache.js';

// ─── Viewport State (singleton via window to survive HMR/dynamic imports) ───
if (!window.__pdfViewport) {
  window.__pdfViewport = {
    zoom: 1.5,
    offsetX: 0,
    offsetY: 0,
    pageW: 0,
    pageH: 0,
    originX: 0,      // MediaBox x0 (can be negative)
    originY: 0,      // MediaBox y0 (can be negative)
    filePath: null,
    pageNum: 1,
    rotation: 0,    // user-applied rotation (0/90/180/270) — part of cache key
    dirty: true,
    active: false,
    // NEW: bitmap + tile state for unified render loop
    currentBitmap: null,    // ImageBitmap or null — whole-page raster for current zoom-bucket
    currentTile: null,      // ImageBitmap or null — visible-region high-zoom augment
    currentTileMeta: null,  // { regionXpt, regionYpt, regionWpt, regionHpt, zoom } so _render() can position it
    pageType: 'unknown',    // 'raster' | 'vector' | 'unknown'
  };
}
export const viewport = window.__pdfViewport;

let _canvas = null;
let _ctx = null;
let _rafId = 0;
let _annotationRedraw = null; // callback for annotation overlay
let _resizeObserver = null;

// ─── Init / Teardown ────────────────────────────────────────────────────────

export function initViewport(canvas, annotationRedrawFn) {
  // Stop previous loop if re-initializing
  if (_rafId) cancelAnimationFrame(_rafId);
  _canvas = canvas;
  _ctx = canvas.getContext('2d');
  _annotationRedraw = annotationRedrawFn || null;
  _resizeCanvas();
  window.removeEventListener('resize', _resizeCanvas);
  window.addEventListener('resize', _resizeCanvas);

  // ResizeObserver on #pdf-container — fires whenever the container's box
  // size changes for ANY reason (right panel toggled, properties panel
  // opened, palettes shown/hidden, ribbon collapsed, …). Without this the
  // canvas keeps its old width when a side panel opens, the clamp uses the
  // stale (too-large) canvas width, and the user can pan the page off into
  // the area covered by the panel — visible as grey on the right edge.
  if (_resizeObserver) {
    _resizeObserver.disconnect();
    _resizeObserver = null;
  }
  const container = document.getElementById('pdf-container');
  if (container && typeof ResizeObserver !== 'undefined') {
    _resizeObserver = new ResizeObserver(() => _resizeCanvas());
    _resizeObserver.observe(container);
  }

  // Watch for cross-monitor DPI changes so the page re-renders sharp at the
  // new devicePixelRatio (issue #263). Idempotent: re-arming replaces the
  // previous listener, so repeated init calls never stack watchers.
  _armDprWatcher();

  _startLoop();
}

export function destroyViewport() {
  viewport.active = false;
  cancelAnimationFrame(_rafId);
  window.removeEventListener('resize', _resizeCanvas);
  if (_resizeObserver) {
    _resizeObserver.disconnect();
    _resizeObserver = null;
  }
  _canvas = null;
  _ctx = null;
}

// Canvas backing-store DPR multiplier. window.devicePixelRatio (1.0–3.0 typical)
// is multiplied so the canvas pixel grid matches the screen pixel grid, giving
// crisp rendering on HiDPI displays. CSS dimensions stay logical-px so all
// existing coordinate math (mouse, panning, zoom) keeps working unchanged.
function _getDpr() { return window.devicePixelRatio || 1; }

function _resizeCanvas() {
  if (!_canvas) return;
  const container = document.getElementById('pdf-container');
  if (!container) return;
  const w = container.clientWidth;
  const h = container.clientHeight;
  const dpr = _getDpr();
  const bw = Math.round(w * dpr);
  const bh = Math.round(h * dpr);
  if (_canvas.width !== bw || _canvas.height !== bh) {
    // Re-anchor: capture the world (PDF-space) point currently at the canvas
    // center BEFORE resizing, then restore it AFTER.
    const oldVpW = _canvas.width / dpr;
    const oldVpH = _canvas.height / dpr;
    let worldCenterX = null;
    let worldCenterY = null;
    if (oldVpW > 0 && oldVpH > 0 && viewport.zoom > 0 && viewport.pageW > 0) {
      worldCenterX = (oldVpW / 2 - viewport.offsetX) / viewport.zoom;
      worldCenterY = (oldVpH / 2 - viewport.offsetY) / viewport.zoom;
    }

    // Backing store at device-pixel resolution; CSS at logical-pixel size
    _canvas.width = bw;
    _canvas.height = bh;
    _canvas.style.width = w + 'px';
    _canvas.style.height = h + 'px';

    // Annotation + highlight canvases stay in CSS-pixel backing for now (existing
    // coordinate math uses canvas.width as CSS pixels). The PDF canvas is the only
    // one that needs HiDPI backing for crisp rendering.
    const ann = container.querySelector('.annotation-canvas, #annotation-canvas');
    if (ann && (ann.width !== w || ann.height !== h)) {
      ann.width = w;
      ann.height = h;
    }
    const hl = container.querySelector('#text-highlight-canvas');
    if (hl && (hl.width !== w || hl.height !== h)) {
      hl.width = w;
      hl.height = h;
    }

    // When the user hasn't manually zoomed/panned (_anchorActive=false) the
    // viewport is still in "fit" mode — re-fit so a page that was first laid
    // out before the container reached its real size doesn't end up rendered
    // at the smaller fit-zoom inside a now-larger canvas (visible as a grey
    // "frame" of empty backdrop around the page that survives later zoom-in/
    // out, because zoomStepAtPoint anchors at the centered point and never
    // refits). Once the user has anchored (zoom-to-cursor or pan), preserve
    // their zoom and just re-anchor the world center.
    if (!_anchorActive && viewport.pageW > 0) {
      fitToViewport();
    } else if (worldCenterX !== null) {
      viewport.offsetX = w / 2 - worldCenterX * viewport.zoom;
      viewport.offsetY = h / 2 - worldCenterY * viewport.zoom;
    }

    viewport.dirty = true;
  }
}

// ─── Cross-monitor DPI change (issue #263) ─────────────────────────────────
// When the window is dragged to a monitor with a different scale factor
// (e.g. 100% ↔ 150% Windows scaling) window.devicePixelRatio changes, but on
// WebView2 neither the `resize` event nor the container ResizeObserver fire
// reliably — the CSS box keeps its logical size, so nothing recomputes the
// backing store. The page then stays rendered at the OLD dpr: blurry when
// moved to a higher-DPI screen, over-/under-sized when moved to a lower one.
//
// Detection: the canonical matchMedia('(resolution: <dpr>dppx)') pattern.
// That query matches ONLY at exactly the current ratio, so its one-shot
// `change` fires the instant the ratio shifts — the reliable Chromium/WebView2
// signal for a DPI change (discrete `resize`-on-DPI is not guaranteed). The
// threshold is baked into the query, so we re-arm at the new ratio after every
// change. Stored on window so an HMR reload can remove the stale listener.
let _dprDebounce = null;

function _onDprChanged() {
  // Re-arm immediately at the new ratio so a further jump mid-drag isn't
  // missed while the debounce below is still pending.
  _armDprWatcher();
  // Coalesce the several ratio steps a slow drag across the monitor edge can
  // emit into a single re-render once the drag settles.
  if (_dprDebounce) clearTimeout(_dprDebounce);
  _dprDebounce = setTimeout(_applyDprChange, 120);
}

// Public entry so modes that never touch initViewport (e.g. a session that
// restores straight into continuous view) can still install the DPI watcher.
export function ensureDprWatcher() { _armDprWatcher(); }

function _armDprWatcher() {
  if (typeof window.matchMedia !== 'function') return;
  const prev = window.__pdfDprMql;
  if (prev && prev.mql) {
    try { prev.mql.removeEventListener('change', prev.handler); } catch { /* older engines */ }
  }
  const dpr = window.devicePixelRatio || 1;
  const mql = window.matchMedia(`(resolution: ${dpr}dppx)`);
  mql.addEventListener('change', _onDprChanged);
  window.__pdfDprMql = { mql, handler: _onDprChanged };
}

async function _applyDprChange() {
  _dprDebounce = null;
  const doc = getActiveDocument();
  if (doc && doc.viewMode === 'continuous') {
    // Continuous/book/facing mode paints per-page canvases sized at
    // getCanvasDPR() when they are built. Rebuild them at the new dpr so they
    // stay crisp, and restore the logical scroll position across the rebuild
    // (the innerHTML reset collapses scrollHeight → scrollTop would snap to 0).
    try {
      const scrollEl = document.getElementById('pdf-container');
      const prevTop = scrollEl ? scrollEl.scrollTop : 0;
      const prevH = scrollEl ? scrollEl.scrollHeight : 0;
      const m = await import('./renderer.js');
      await m.renderContinuous(true);
      if (scrollEl && prevH > 0) {
        scrollEl.scrollTop = (prevTop / prevH) * scrollEl.scrollHeight;
      }
    } catch { /* re-render is best-effort */ }
    return;
  }
  // Single-page (viewport) mode. _resizeCanvas() re-sizes the backing store to
  // the new dpr AND re-anchors the world-space center it captured first, so
  // the current zoom and scroll/pan position are preserved across the switch.
  _resizeCanvas();
  viewport.dirty = true; // vector pages re-paint from the RAF loop at fresh dpr
  if (viewport.pageType === 'raster') {
    // Raster bitmaps are cached per zoom*dpr bucket; the new dpr lands in a new
    // bucket, so kick the orchestrator to render a sharp bitmap for it.
    import('./bitmap-orchestrator.js').then(orch => {
      orch.ensureBitmapForCurrentView();
      if (_canvas) orch.ensureTileForCurrentView(_canvas);
    }).catch(() => {});
  }
}

// ─── Smooth Scroll: Velocity + Momentum ────────────────────────────────────
// Wheel-driven pan accumulates into _vx/_vy. The RAF loop then applies and
// decays the velocity each frame so a single wheel notch glides to a smooth
// stop instead of jumping in a single instantaneous step. Tuned to feel like
// macOS / iOS rubber-banding scroll without rubber-band overshoot (we just
// clamp at edges via clampAndCenter()).
let _vx = 0;
let _vy = 0;
// Per-frame decay. Closer to 1 = longer glide. 0.88 ≈ velocity halves in
// ~5 frames (~83ms @ 60fps); feels responsive but smooth, no over-floaty.
const _VELOCITY_FRICTION = 0.88;
// Hard stop threshold so we don't burn frames on sub-pixel residue.
const _VELOCITY_MIN = 0.15;
// How much of a wheel notch becomes velocity. The OS sends ~100 per notch;
// we want ~25 CSS px/frame at impact, which a single notch of 100 * 0.25
// produces. Trackpad inertia already smooths fine deltas so this scale
// works for both.
const _WHEEL_TO_VELOCITY = 0.25;

// Debounce timer for tile re-renders triggered by pan. ensureTileForCurrentView
// is cheap when zoom <= cap (early-returns + clears tile state) but the Rust
// region-render call is expensive at high zoom, so coalesce rapid pan updates
// into a single re-check 100 ms after the last pan event.
let _panTileTimer = null;

// Debounce timer for the FULL orchestrator kick (bitmap + tile) triggered by
// zoom. Without this, each wheel-tick on a huge page (e.g. NKD1a p5, 5156x2384 pt
// where the whole-page bitmap caps at 1x and every zoom-bucket transition
// re-renders a tile) queues a Rust render that takes 200-1000 ms each. Five
// rapid wheels = five queued renders = ~5 seconds wait before the last one
// (the only non-stale one) lands. With debounce: user keeps wheeling, no
// Rust call fires; user stops, one render fires for the final zoom level.
//
// The synchronous getBestAvailableBitmap fallback inside ensureBitmap-
// ForCurrentView still surfaces the best cached bitmap at the new zoom
// transform during the debounce window, so the page never appears blank —
// only the CRISPNESS upgrade is delayed.
let _zoomOrchTimer = null;
function _kickOrchestratorAfterZoom() {
  if (viewport.pageType !== 'raster') return;
  if (_zoomOrchTimer) clearTimeout(_zoomOrchTimer);
  _zoomOrchTimer = setTimeout(() => {
    _zoomOrchTimer = null;
    import('./bitmap-orchestrator.js').then(orch => {
      orch.ensureBitmapForCurrentView();
      if (_canvas) orch.ensureTileForCurrentView(_canvas);
    }).catch(() => {});
  }, 150);
}

// ─── ZOOM-FREEZE (rapid-zoom debounce) ──────────────────────────────────────
// When the user clicks +/- rapidly (or holds it down), each step changes
// viewport.zoom and the RAF loop normally re-runs renderVectorPage — which
// can be 100-500 ms per call on complex vector pages (NKD1a, Zware vector PDF).
// 8 steps = 8 full re-renders = laggy.
//
// FREEZE strategy: on the first zoom step, snapshot the current canvas
// pixels to an OffscreenCanvas. While the freeze is active (every step
// extends it 150 ms forward), _render() draws the SNAPSHOT stretched to
// the new viewport.zoom / offset — no vector re-paint, no orchestrator
// IPC. After 150 ms of zoom-stillness, drop the snapshot and trigger ONE
// fresh full render at the final zoom level.
//
// User experience: each click immediately rescales the visible image
// (snapshot stretch is sub-ms even at 4K) and the crisp final render
// settles 150 ms after the last click.
let _zoomFreezeBitmap = null;     // OffscreenCanvas snapshot, or null
let _zoomFreezeZoom = 0;          // viewport.zoom at snapshot time
let _zoomFreezeOffsetX = 0;       // viewport.offsetX at snapshot time
let _zoomFreezeOffsetY = 0;       // viewport.offsetY at snapshot time
let _zoomFreezeDpr = 1;           // dpr at snapshot time (so dest math matches)
let _zoomFreezeTimer = null;

function _captureZoomFreeze() {
  if (_zoomFreezeBitmap) return;   // already frozen
  if (!_canvas || _canvas.width <= 0 || _canvas.height <= 0) return;
  try {
    const off = new OffscreenCanvas(_canvas.width, _canvas.height);
    off.getContext('2d').drawImage(_canvas, 0, 0);
    _zoomFreezeBitmap = off;
    _zoomFreezeZoom = viewport.zoom;
    _zoomFreezeOffsetX = viewport.offsetX;
    _zoomFreezeOffsetY = viewport.offsetY;
    _zoomFreezeDpr = _getDpr();
  } catch (e) {
    _zoomFreezeBitmap = null;       // OffscreenCanvas may not exist on very old WebView; degrade gracefully
  }
}

function _scheduleZoomFreezeRelease() {
  if (_zoomFreezeTimer) clearTimeout(_zoomFreezeTimer);
  _zoomFreezeTimer = setTimeout(() => {
    _zoomFreezeTimer = null;
    _zoomFreezeBitmap = null;
    viewport.dirty = true;          // trigger ONE fresh full render at the final zoom
  }, 150);
}

function _scheduleTileRecheckAfterPan() {
  if (viewport.pageType !== 'raster' || !_canvas) return;
  if (_panTileTimer) clearTimeout(_panTileTimer);
  _panTileTimer = setTimeout(() => {
    _panTileTimer = null;
    import('./bitmap-orchestrator.js').then(orch => {
      orch.ensureTileForCurrentView(_canvas);
    }).catch(() => {});
  }, 100);
}

/**
 * Add wheel deltas to the pan-momentum accumulator. Called from the wheel
 * handler in navigation-events.js on plain (non-ctrl) wheel events when the
 * vector viewport is active. The RAF loop applies velocity over multiple
 * frames with friction-based decay, producing smooth Apple-style scroll.
 *
 * No-op when momentum is suppressed by clamping on both axes (page fits).
 */
export function addPanVelocity(dx, dy) {
  _vx += dx * _WHEEL_TO_VELOCITY;
  _vy += dy * _WHEEL_TO_VELOCITY;
  viewport.dirty = true; // wake the RAF loop
  _anchorActive = true;  // user-positioned, don't auto-center
}

/**
 * Halt any in-flight pan momentum. Called when a new gesture begins
 * (pointer-down for click-pan, ctrl+wheel for zoom, edge-triggered page
 * nav) so the new gesture doesn't fight a still-decaying old one.
 */
export function stopPanMomentum() {
  _vx = 0;
  _vy = 0;
}

// ─── Render Loop ────────────────────────────────────────────────────────────

// ─── Marching-ants redaction animation driver ──────────────────────────────
// A dedicated, self-terminating RAF loop that advances state.redactAntsOffset
// while a redaction is being drawn or a pending redaction mark exists, then
// triggers the correct annotation redraw for the current view mode. Kept
// separate from the main viewport loop so it works in ALL view modes
// (single / continuous / book) regardless of whether the viewport render loop
// is currently active — and so it can spin down to ZERO cost the moment no
// redaction remains (e.g. after "Apply" turns marks into black boxes).

// Lazily-cached continuous-mode annotation redraw. Imported on demand to keep
// this module free of a static dependency on the rendering module (avoids any
// import-cycle risk).
let _redrawContinuousFn = null;
let _redrawAnnotationsFn = null;
import('../annotations/rendering.js')
  .then(m => { _redrawContinuousFn = m.redrawContinuous; _redrawAnnotationsFn = m.redrawAnnotations; })
  .catch(() => {});

let _redactAntsRafId = 0;

// TRUE only while a redaction is actively being drawn, or while at least one
// pending redaction mark (still type 'redaction') exists on the active
// document. Once "Apply" converts them to black boxes (type 'box'), no
// redaction remains and this returns false — the loop stops on its own.
function _redactionAnimationActive() {
  if (state.isDrawing && state.currentTool === 'redaction') return true;
  const doc = getActiveDocument();
  const anns = doc && doc.annotations;
  if (!anns || anns.length === 0) return false;
  for (let i = 0; i < anns.length; i++) {
    if (anns[i].type === 'redaction') return true;
  }
  return false;
}

function _redactAntsTick() {
  if (!_redactionAnimationActive()) {
    // Nothing left to animate — stop the loop (no perpetual repaint).
    _redactAntsRafId = 0;
    return;
  }
  // Advance the dash phase; rendering reads state.redactAntsOffset as a
  // negative lineDashOffset so the dashes appear to "march" outward.
  state.redactAntsOffset += 0.6;
  if (state.redactAntsOffset > 1e6) state.redactAntsOffset = 0; // avoid unbounded growth

  if (getActiveDocument()?.viewMode === 'continuous') {
    // Continuous/book: redraw all visible page overlays directly.
    if (_redrawContinuousFn) { try { _redrawContinuousFn(); } catch {} }
  } else if (viewport.active) {
    // Single-page with the vector viewport: let the main render loop repaint.
    viewport.dirty = true;
  } else if (_redrawAnnotationsFn) {
    // Single-page fallback (blank/legacy docs without the vector viewport).
    try { _redrawAnnotationsFn(); } catch {}
  }
  _redactAntsRafId = requestAnimationFrame(_redactAntsTick);
}

// Start the marching-ants loop if it isn't already running. Idempotent and
// cheap: call it whenever a redaction gesture starts or a redaction mark is
// created. The loop self-terminates once no redaction remains pending.
export function kickRedactAnts() {
  if (_redactAntsRafId || typeof requestAnimationFrame === 'undefined') return;
  _redactAntsRafId = requestAnimationFrame(_redactAntsTick);
}

function _startLoop() {
  function tick() {
    if (viewport.active) {
      // Apply pan momentum before the dirty check so a velocity > 0 keeps
      // the loop alive even when nothing else marked dirty.
      if (_vx !== 0 || _vy !== 0) {
        const dpr = _getDpr();
        const vpW = _canvas ? _canvas.width / dpr : 0;
        const vpH = _canvas ? _canvas.height / dpr : 0;
        const pageScreenW = viewport.pageW * viewport.zoom;
        const pageScreenH = viewport.pageH * viewport.zoom;

        // Skip the velocity update on any axis where the page already fits
        // (clampAndCenter would just snap it back, producing a buzzy oscillation
        // for an axis the user can't pan anyway). Also kill that axis's
        // velocity outright so we don't waste frames decaying it.
        if (pageScreenW > vpW + 0.5) {
          viewport.offsetX -= _vx;
        } else {
          _vx = 0;
        }
        if (pageScreenH > vpH + 0.5) {
          viewport.offsetY -= _vy;
        } else {
          _vy = 0;
        }

        // Decay
        _vx *= _VELOCITY_FRICTION;
        _vy *= _VELOCITY_FRICTION;
        if (Math.abs(_vx) < _VELOCITY_MIN) _vx = 0;
        if (Math.abs(_vy) < _VELOCITY_MIN) _vy = 0;

        viewport.dirty = true;

        if (_vx !== 0 || _vy !== 0) {
          _scheduleTileRecheckAfterPan();
        }
      }
      if (viewport.dirty) {
        viewport.dirty = false;
        _render();
      }
    }
    _rafId = requestAnimationFrame(tick);
  }
  _rafId = requestAnimationFrame(tick);
}

// DISABLED (2026-05-15, free pan/zoom UX request).
//
// This function used to clamp viewport.offsetX/Y so the page couldn't be
// dragged off-screen, AND to auto-center the page on an axis where it fit
// the viewport. Both behaviors were running EVERY FRAME, which fought with
// wheel zoom-to-cursor and free pan: the cursor anchor was dragged back
// toward the centered position, and the user couldn't pan past page edges
// to see surrounding gray space.
//
// The free pan/zoom UX (as used by modern PDF viewers) allows:
//   • Cursor anchor to be fully honored at any zoom (page can extend off-screen)
//   • Free pan in any direction (no clamp to page edges)
// We now match that behavior by NEVER touching offsets on every render.
// Initial fit-to-viewport positioning is done explicitly by fitToViewport().
// The user can re-center with a Fit Page command if they pan into nothing.
//
// The function is kept (no-op body) so existing callers don't crash.
export function clampAndCenter() {
  // NO-OP — preserved as a function reference; all clamping/centering removed.
  return;
}

// Internal variant retained for the rare callers that genuinely want a
// minimal "snap into viewport if completely lost" behavior (e.g. setPage on
// a fresh document). Not called per-frame.
export function clampAndCenterUnused_keptForReference() {
  if (!_canvas || !viewport.pageW || !viewport.pageH) return;
  // Use CSS-pixel viewport size (backing is dpr * css)
  const dpr = _getDpr();
  const vpW = _canvas.width / dpr;
  const vpH = _canvas.height / dpr;
  const pageScreenW = viewport.pageW * viewport.zoom;
  const pageScreenH = viewport.pageH * viewport.zoom;

  // When the user has explicitly anchored the view (zoom-to-cursor, pan),
  // do NOT auto-center even if the page now fits the axis — otherwise the
  // anchor point drifts back to the viewport center on the very next frame.
  // For wheel zoom (cursor anchor) we also skip the on-screen clamp via
  // _strictAnchor: an [0, vpW - pageScreenW] clamp would drag a page the
  // cursor pulled off-center back toward 0, destroying the cursor anchor
  // (user complaint: "zoom moet ook altijd naar positie muiscursor").
  // For other anchored sources (setZoomAtPoint with center, pan) the on-
  // screen clamp is still desirable and keeps the page fully visible on a
  // fit-axis.
  const anchored = _anchorActive;
  const strict = _strictAnchor;

  // Over-pan slack: how far the page can be positioned past the viewport
  // edge on an overflow axis. Half-viewport means the user can scroll/pan
  // until at most 50% of the viewport is gray (page-left at viewport-middle,
  // or page-right at viewport-middle). Matches Edge/Chrome/Acrobat behavior
  // where you can scroll past page edges to see surrounding gray space.
  const OVERPAN_FRACTION = 0.5;

  if (pageScreenW <= vpW) {
    if (strict) {
      // Wheel zoom-to-cursor: leave offsetX exactly where _anchorAt placed it
    } else if (anchored) {
      const minX = 0;                  // page left can't go past viewport left
      const maxX = vpW - pageScreenW;  // page right can't go past viewport right
      if (viewport.offsetX < minX) viewport.offsetX = minX;
      if (viewport.offsetX > maxX) viewport.offsetX = maxX;
    } else {
      // Fits horizontally → center
      viewport.offsetX = (vpW - pageScreenW) / 2;
    }
  } else {
    // Page is bigger than viewport on this axis.
    if (strict) {
      // Wheel zoom-to-cursor: NO clamp. The cursor anchor math
      // (offsetX = screenX − wx * newZoom) guarantees the world point under
      // the cursor stays under the cursor — and thus on-screen — so the user
      // cannot lose the page by zooming. Clamping here was the cause of the
      // "geen fixatie rondom mijn muis" complaint at >200% zoom: the clamp
      // dragged the page back toward viewport edges, breaking the anchor.
    } else {
      // Pan / non-strict anchor / default: allow over-pan past page edges
      // with half-viewport slack. Previous behavior ("neither edge crosses
      // the viewport edge") made the page feel pinned and prevented the user
      // from panning past the page to see the surrounding gray area.
      const SLACK_X = vpW * OVERPAN_FRACTION;
      const minX = vpW - pageScreenW - SLACK_X;
      const maxX = SLACK_X;
      if (viewport.offsetX < minX) viewport.offsetX = minX;
      if (viewport.offsetX > maxX) viewport.offsetX = maxX;
    }
  }

  if (pageScreenH <= vpH) {
    if (strict) {
      // Wheel zoom-to-cursor: leave offsetY exactly where _anchorAt placed it
    } else if (anchored) {
      const minY = 0;
      const maxY = vpH - pageScreenH;
      if (viewport.offsetY < minY) viewport.offsetY = minY;
      if (viewport.offsetY > maxY) viewport.offsetY = maxY;
    } else {
      viewport.offsetY = (vpH - pageScreenH) / 2;
    }
  } else {
    if (strict) {
      // Same reasoning as X axis above — cursor anchor must be honored.
    } else {
      const SLACK_Y = vpH * OVERPAN_FRACTION;
      const minY = vpH - pageScreenH - SLACK_Y;
      const maxY = SLACK_Y;
      if (viewport.offsetY < minY) viewport.offsetY = minY;
      if (viewport.offsetY > maxY) viewport.offsetY = maxY;
    }
  }
}

// Sticky flag set by zoom-to-cursor / pan / setZoomAtPoint. Once the user
// has positioned the view themselves, clampAndCenter() must NOT auto-center
// on a fit-axis. Reset by fitToViewport(), page nav, and resize, which are
// the legitimate "re-center" entry points.
let _anchorActive = false;
// Stricter variant of _anchorActive: when true, clampAndCenter() also skips
// the [0, vpW - pageScreenW] on-screen clamp on a fit-axis. Used ONLY by
// wheel zoom-to-cursor / continuous zoom-at-point, where the contract is
// "world point under the cursor stays exactly under the cursor". Other
// anchor sources (pan, fit operations dispatched via setZoomAtPoint) leave
// this false so the page stays fully visible.
let _strictAnchor = false;
export function clearAnchor() { _anchorActive = false; _strictAnchor = false; }
export function markAnchored() { _anchorActive = true; }

function _render() {
  if (!_ctx || !_canvas || !viewport.filePath) return;
  // CSS-pixel viewport (backing is dpr-scaled). All math below stays in CSS px;
  // the dpr multiplier is folded into the canvas transform so output
  // hits device pixels and stays crisp on HiDPI displays.
  const dpr = _getDpr();
  const vpW = _canvas.width / dpr;
  const vpH = _canvas.height / dpr;

  // ─── ZOOM-FREEZE FAST PATH ──────────────────────────────────────────────
  // During the rapid-zoom debounce window, skip clampAndCenter +
  // white-background + vector pass entirely. Just stretch the captured
  // snapshot to the new viewport transform. Sub-ms even at 4K. The proper
  // render fires once when the debounce timer releases.
  if (_zoomFreezeBitmap) {
    _ctx.setTransform(1, 0, 0, 1, 0, 0);
    _ctx.fillStyle = '#e0e0e0';
    _ctx.fillRect(0, 0, _canvas.width, _canvas.height);
    // The snapshot was captured at (_zoomFreezeZoom, _zoomFreezeOffsetX/Y).
    // For a world point W, its snapshot-pixel was:
    //   sx_px = (W_x * _zoomFreezeZoom + _zoomFreezeOffsetX) * _zoomFreezeDpr
    // We want that same world point to appear at the CURRENT pixel:
    //   cx_px = (W_x * viewport.zoom + viewport.offsetX) * dpr
    // Solving for the drawImage params (dest rect that maps src(0,0..w,h) → dst):
    //   k = (viewport.zoom * dpr) / (_zoomFreezeZoom * _zoomFreezeDpr)
    //   dw = _zoomFreezeBitmap.width * k
    //   dx = viewport.offsetX * dpr - _zoomFreezeOffsetX * _zoomFreezeDpr * k
    const k = (viewport.zoom * dpr) / (_zoomFreezeZoom * _zoomFreezeDpr);
    const dw = _zoomFreezeBitmap.width * k;
    const dh = _zoomFreezeBitmap.height * k;
    const dx = viewport.offsetX * dpr - _zoomFreezeOffsetX * _zoomFreezeDpr * k;
    const dy = viewport.offsetY * dpr - _zoomFreezeOffsetY * _zoomFreezeDpr * k;
    try {
      _ctx.drawImage(_zoomFreezeBitmap, dx, dy, dw, dh);
    } catch {
      // OffscreenCanvas drawImage shouldn't throw, but if it does just bail
      // — the next RAF will hit the normal render path once freeze releases.
    }
    // Annotation overlay redraw — keep annotations in sync with the
    // stretched page bitmap. The lightweight redraw reads viewport.zoom
    // and viewport.offsetX/Y directly so it follows the freeze transform
    // for free; calling it here just makes sure it runs on every freeze
    // frame (annotations move smoothly with the page instead of "sticking"
    // at the pre-zoom position).
    if (_annotationRedraw) {
      try { _annotationRedraw(); } catch {}
    }
    return;
  }

  // Always clamp + auto-center BEFORE drawing so a page that fits the
  // viewport ends up centered no matter how we got here (zoom out, resize,
  // page nav, etc.).
  clampAndCenter();

  // Reset transform and clear (in device-pixel space)
  _ctx.setTransform(1, 0, 0, 1, 0, 0);
  _ctx.clearRect(0, 0, _canvas.width, _canvas.height);

  // Background (outside page area)
  _ctx.fillStyle = '#e0e0e0';
  _ctx.fillRect(0, 0, _canvas.width, _canvas.height);

  // Display dimensions of the page (post-rotation). PDF page is pageW x pageH
  // in user-space; after a 90°/270° rotation the on-screen extent is swapped.
  const isRotated90 = (viewport.rotation === 90 || viewport.rotation === 270);
  const displayPageW = isRotated90 ? viewport.pageH : viewport.pageW;
  const displayPageH = isRotated90 ? viewport.pageW : viewport.pageH;

  // Dekt de (laatst gerenderde) tegel het volledige ZICHTBARE deel van de
  // pagina? Dan is de opgeschaalde volle-pagina-bitmap eronder onzichtbaar
  // nut en visueel storend (wazige "rasterversie" achter de scherpe tegel
  // bij zoomwissels) — we slaan hem dan over. De tegel wordt meta-gebaseerd
  // gepositioneerd en blijft dus ook bij een NIEUWE zoom correct geschaald
  // staan tot de verse tegel hem vervangt. Buiten de tegel-dekking blijft de
  // bitmap het vangnet (beter een wazige rand dan een gat bij pannen).
  let tileCoversVisible = false;
  if (viewport.currentTile && viewport.currentTileMeta) {
    const m = viewport.currentTileMeta;
    const cssW = _canvas.width / dpr;
    const cssH = _canvas.height / dpr;
    const visX0 = Math.max(0, -viewport.offsetX) / viewport.zoom;
    const visY0 = Math.max(0, -viewport.offsetY) / viewport.zoom;
    const visX1 = Math.min(displayPageW * viewport.zoom, cssW - viewport.offsetX) / viewport.zoom;
    const visY1 = Math.min(displayPageH * viewport.zoom, cssH - viewport.offsetY) / viewport.zoom;
    const eps = 0.5; // pt-tolerantie op de randen
    tileCoversVisible =
      visX1 > visX0 && visY1 > visY0 &&
      m.regionXpt <= visX0 + eps && m.regionYpt <= visY0 + eps &&
      m.regionXpt + m.regionWpt >= visX1 - eps &&
      m.regionYpt + m.regionHpt >= visY1 - eps;
  }

  // White page background. For RASTER we fill in screen space at the SAME
  // post-rotation extent as the bitmap (so a 90°/270° page has no uncovered
  // white band — the old user-space rect used the un-swapped pageW/pageH and
  // left a white strip after rotation). For VECTOR we keep the PDF user-space
  // (Y-flipped) transform that matches the vector commands drawn on top.
  if (viewport.currentBitmap) {
    _ctx.save();
    _ctx.setTransform(1, 0, 0, 1, 0, 0); // identity (device-pixel space)
    const destX = viewport.offsetX * dpr;
    const destY = viewport.offsetY * dpr;
    const destW = displayPageW * viewport.zoom * dpr;
    const destH = displayPageH * viewport.zoom * dpr;
    _ctx.fillStyle = '#ffffff';
    _ctx.fillRect(destX, destY, destW, destH);
    if (!tileCoversVisible) {
      _ctx.drawImage(viewport.currentBitmap, destX, destY, destW, destH);
    }
    _ctx.restore();
  } else {
    // No whole-page bitmap yet (vector page, or the brief window right after a
    // rotation cleared the stale raster). Fill the white page background in
    // SCREEN space at the POST-rotation extent (displayPageW/H) — identical to
    // the raster branch above. The previous user-space fill used the un-swapped
    // pageW × pageH with a Y-flip by pageH, so a 90°/270° page got its white
    // rectangle painted in the OLD orientation while the vector/raster content
    // drew rotated on top — the leftover white "spookvlak" of issue #262. The
    // vector command pass below keeps its own PDF user-space transform, so it
    // still lines up with the page content.
    _ctx.save();
    _ctx.setTransform(1, 0, 0, 1, 0, 0); // identity (device-pixel space)
    const destX = viewport.offsetX * dpr;
    const destY = viewport.offsetY * dpr;
    const destW = displayPageW * viewport.zoom * dpr;
    const destH = displayPageH * viewport.zoom * dpr;
    _ctx.fillStyle = '#ffffff';
    _ctx.fillRect(destX, destY, destW, destH);
    _ctx.restore();
  }

  // TILE AUGMENT — crisp visible-region overlay when zoom is above the
  // 4096 px-axis cap. The tile is rendered at the requested zoom for the
  // PDF-point region described by currentTileMeta.
  if (viewport.currentTile && viewport.currentTileMeta) {
    _ctx.save();
    _ctx.setTransform(1, 0, 0, 1, 0, 0);
    const m = viewport.currentTileMeta;
    const destX = (viewport.offsetX + m.regionXpt * viewport.zoom) * dpr;
    const destY = (viewport.offsetY + m.regionYpt * viewport.zoom) * dpr;
    const destW = m.regionWpt * viewport.zoom * dpr;
    const destH = m.regionHpt * viewport.zoom * dpr;
    _ctx.drawImage(viewport.currentTile, destX, destY, destW, destH);
    _ctx.restore();
  }

  // VECTOR CONTENT — only run when this is NOT a raster-only page. Hybrid
  // (mixed-content) pages can have both: raster background + vector overlay.
  // Until pageType='hybrid' exists we treat pageType==='raster' as
  // raster-only and skip the vector pass.
  if (viewport.pageType !== 'raster') {
    _ctx.save();
    renderVectorPage(_ctx, viewport.filePath, viewport.pageNum, {
      a: viewport.zoom * dpr,
      b: 0,
      c: 0,
      d: viewport.zoom * dpr,
      e: viewport.offsetX * dpr,
      f: viewport.offsetY * dpr,
    }, viewport.rotation);
    _ctx.restore();
  }

  // Status bar
  state.renderEngine = viewport.pageType === 'raster' ? 'Raster (PDFium)' : 'Vector';

  // Sync text layer with viewport.
  // PDF.js text layer (0,0) = page top-left at scale=1.
  // Page top-left on screen = (offsetX, offsetY).
  const textLayer = document.querySelector('.textLayer');
  if (textLayer) {
    const tx = viewport.offsetX;
    const ty = viewport.offsetY;
    const doc = getActiveDocument();
    const geometry = resolveTextEditPageGeometry(
      doc?.pageDims?.[viewport.pageNum],
      viewport.pageW,
      viewport.pageH,
      viewport.rotation,
    );
    const matrix = getTextLayerCssMatrix(
      geometry.pageWidth,
      geometry.pageHeight,
      geometry.rotation,
      viewport.zoom,
      tx,
      ty,
    );
    // The text layer lives in PDF user space (origin top-left after Y flip).
    // We size spans with --font-height in PDF points and let CSS compute
    // font-size = --total-scale-factor * --font-height. Setting the factor
    // to 1 means spans use raw PDF point sizes; the matrix transform below
    // scales the entire layer to match the canvas zoom. This keeps text
    // selection pixel-aligned with the rendered glyphs at any zoom level.
    textLayer.style.setProperty('--total-scale-factor', '1');
    // Sized to the unscaled PDF page; the matrix transform handles zoom.
    textLayer.style.position = 'absolute';
    textLayer.style.left = '0';
    textLayer.style.top = '0';
    textLayer.style.width = `${geometry.pageWidth}px`;
    textLayer.style.height = `${geometry.pageHeight}px`;
    textLayer.style.transform = `matrix(${matrix.join(', ')})`;
    textLayer.style.transformOrigin = '0 0';
    // Text layer: keep pointer-events as set by tool manager (don't override)
    // The tool manager sets pointer-events based on active tool (text select = auto, other = none)
    textLayer.style.opacity = '1';

    // Set up selection highlight styles (once)
    if (!textLayer._selectionStyled) {
      textLayer._selectionStyled = true;
      const style = document.createElement('style');
      style.textContent = `
        .textLayer span { color: transparent !important; }
        .textLayer ::selection { background: rgba(0, 100, 255, 0.3) !important; }
      `;
      textLayer.prepend(style);
    }
  }

  // Annotation overlay — sync with viewport transform
  const annCanvas = document.getElementById('annotation-canvas');
  if (annCanvas) {
    // Keep annotation canvas same size as pdf canvas
    if (annCanvas.width !== vpW || annCanvas.height !== vpH) {
      annCanvas.width = vpW;
      annCanvas.height = vpH;
    }
    // In vector mode: annotation canvas must match PDF canvas exactly (no DPR scaling)
    // Remove any legacy DPR-based CSS sizing from setupCanvasHiDPI()
    annCanvas.style.width = '';
    annCanvas.style.height = '';
    // Sync doc.scale so legacy code that reads it gets viewport zoom
    const doc = state.documents?.[state.activeDocumentIndex];
    if (doc) doc.scale = viewport.zoom;
  }
  // Keep the text-highlight canvas perfectly mirrored to the annotation canvas
  const hlCanvas = document.getElementById('text-highlight-canvas');
  if (hlCanvas) {
    if (hlCanvas.width !== vpW || hlCanvas.height !== vpH) {
      hlCanvas.width = vpW;
      hlCanvas.height = vpH;
    }
    hlCanvas.style.width = '';
    hlCanvas.style.height = '';
  }
  if (_annotationRedraw) {
    try { _annotationRedraw(); } catch {}
  }
}

// ─── Load Page ──────────────────────────────────────────────────────────────

// When true, the next setPage() call leaves zoom/offset alone instead of
// running fitToViewport(), even if the file path changes. Mostly obsolete
// now that page-change-within-same-document automatically preserves zoom,
// but kept for any caller that explicitly wants to force the no-fit path.
let _suppressNextFit = false;
export function suppressNextFit() { _suppressNextFit = true; }

export function setPage(filePath, pageNum, pageW, pageH, originX, originY, rotation) {
  // Detect "first time loading this document" vs "navigating to a different
  // page within the same document". The first case should fit-to-viewport
  // (initial load convention); the second must preserve the current zoom
  // (so prev/next/keyboard/wheel/thumbnail nav doesn't reset what the user
  // chose). Identify the document by file path — that's stable across all
  // page navigation but changes when a different file is opened.
  const isNewDocument = viewport.filePath !== filePath;
  const isPageChange = viewport.pageNum !== pageNum;
  // Rotating the CURRENT page keeps the same file + page number, so without an
  // explicit rotation check neither branch below would fire — the stale bitmap
  // (rendered in the OLD orientation) would keep painting behind the newly
  // rotated page and the fit/offset would stay sized to the old footprint. That
  // leftover, wrong-orientation raster/white rectangle is the "spookvlak"
  // reported in issue #262. Treat a rotation delta like a page change.
  const isRotationChange = (viewport.rotation || 0) !== ((rotation || 0) % 360);

  // Clear stale raster state on page, document OR rotation change so the
  // unified render loop doesn't keep painting the PREVIOUS bitmap (stretched
  // to the NEW page's pageW × zoom rectangle) until the async bitmap-
  // orchestrator fills the cache for the new orientation. Without this clear,
  // the user sees the previous content "lag" through for ~10-50ms — visible
  // glitch on raster-classified PDFs (Tekst.pdf, rapport-constructie.pdf) and
  // a persistent old-orientation ghost after rotating.
  if (isNewDocument || isPageChange || isRotationChange) {
    viewport.currentBitmap = null;
    viewport.currentTile = null;
    viewport.currentTileMeta = null;
  }

  viewport.filePath = filePath;
  viewport.pageNum = pageNum;
  viewport.pageW = pageW;
  viewport.pageH = pageH;
  viewport.originX = originX || 0;
  viewport.originY = originY || 0;
  viewport.rotation = rotation || 0;
  viewport.active = true;

  if (_suppressNextFit) {
    _suppressNextFit = false;
    // suppressNextFit() is used by wheel-driven page nav, which then calls
    // alignPageToTop/Bottom to set its own offset → keep anchor active so
    // clampAndCenter doesn't auto-center over that explicit positioning.
    // Page-nav alignment isn't a cursor-anchor scenario → leave strict off.
    _anchorActive = true;
    _strictAnchor = false;
    viewport.dirty = true;
  } else if (isNewDocument || isRotationChange) {
    // First time we're seeing this file → fit to viewport. Rotating the
    // current page swaps its footprint (portrait ⇄ landscape), so re-fit as
    // well: keeping the old zoom/offset would leave the page sized/positioned
    // for the previous orientation, exposing an old-orientation gap.
    fitToViewport();
  } else {
    // Same document, different page → keep the user's zoom and let
    // clampAndCenter() (in the next _render) center the new page if it
    // fits, or clamp the old offsets if it doesn't. Clear the anchor so
    // a fitting page actually does re-center on this transition.
    _anchorActive = false;
    _strictAnchor = false;
    viewport.dirty = true;
  }
}

/// Compute the zoom factor needed to fit a page into a canvas under one of
/// the standard fit modes. SINGLE SOURCE OF TRUTH for fit math — every
/// fit-to-* path in the app should call this instead of computing its own
/// `min(canvasW/pageW, canvasH/pageH)`-style expression.
///
/// @param {'page'|'width'|'height'} mode  How to fit
/// @param {number} pageW    Page width in PDF user units (post-rotation)
/// @param {number} pageH    Page height in PDF user units (post-rotation)
/// @param {number} canvasW  Available canvas / container width in pixels
/// @param {number} canvasH  Available canvas / container height in pixels
/// @param {number} [padding=0]  Pixels of breathing room around the page on
///                              each side (the canvasW/H is shrunk by 2x
///                              this before computing). Pass 0 for edge-to-edge.
/// @returns {number}  The zoom factor (multiplier from PDF units to pixels)
export function computeFitZoom(mode, pageW, pageH, canvasW, canvasH, padding = 0) {
  const availW = Math.max(1, canvasW - padding * 2);
  const availH = Math.max(1, canvasH - padding * 2);
  switch (mode) {
    case 'width':  return availW / pageW;
    case 'height': return availH / pageH;
    case 'page':
    default:       return Math.min(availW / pageW, availH / pageH);
  }
}

export function fitToViewport() {
  if (!_canvas || !viewport.pageW) return;
  // CSS-pixel viewport (backing store is dpr-scaled)
  const dpr = _getDpr();
  const cssW = _canvas.width / dpr;
  const cssH = _canvas.height / dpr;
  // Fit on the POST-ROTATION extent so a 90°/270° (e.g. landscape) page is
  // sized and centred correctly instead of using the un-swapped dimensions.
  const _rot90 = (viewport.rotation === 90 || viewport.rotation === 270);
  const fitW = _rot90 ? viewport.pageH : viewport.pageW;
  const fitH = _rot90 ? viewport.pageW : viewport.pageH;
  const newZoom = computeFitZoom('page', fitW, fitH, cssW, cssH, 0);
  const scaledW = fitW * newZoom;
  const scaledH = fitH * newZoom;
  const newOffsetX = (cssW - scaledW) / 2;
  const newOffsetY = (cssH - scaledH) / 2;

  // Re-centering reset: discard any prior zoom-to-cursor anchor so
  // clampAndCenter() resumes auto-centering on fit-axis as before.
  _anchorActive = false;
  _strictAnchor = false;
  // Fit is a "snap to here" operation — any in-flight pan-momentum from
  // before the fit is stale and would immediately drag the page off-center.
  stopPanMomentum();

  // Skip the dirty-mark when the fit would produce identical zoom + offsets.
  // ResizeObserver can fire on layout settling without an actual size change
  // that affects the fit (e.g. clientWidth identical after a parent reflow),
  // and re-marking dirty triggers a full RAF redraw — heavy `renderVectorPage`
  // + `redrawAnnotations` per frame. The redundant-mark guard keeps the canvas
  // path quiet when nothing visible changes.
  if (
    viewport.zoom === newZoom &&
    viewport.offsetX === newOffsetX &&
    viewport.offsetY === newOffsetY
  ) {
    return;
  }
  viewport.zoom = newZoom;
  viewport.offsetX = newOffsetX;
  viewport.offsetY = newOffsetY;
  viewport.dirty = true;

  // Raster: re-kick the orchestrator so the new fit-zoom-bucket's bitmap +
  // tile get async-fetched. Mirrors the hook in _anchorAt; fitToViewport
  // does NOT call _anchorAt (it sets viewport.zoom directly), so it needs
  // its own kick.
  _kickOrchestratorAfterZoom();
}

// ─── Zoom ───────────────────────────────────────────────────────────────────

// Discrete zoom levels — same set used by professional PDF viewers.
// Roughly geometric, with finer steps near 100% where users zoom most.
export const ZOOM_STEPS = [
  0.0625, 0.125, 0.25, 0.333, 0.50, 0.667, 0.75, 0.80, 0.90,
  1.00, 1.10, 1.25, 1.50, 1.75, 2.00, 2.50, 3.00, 4.00, 6.00,
  8.00, 12.00, 16.00, 24.00, 32.00, 64.00,
];
const ZOOM_MIN = ZOOM_STEPS[0];
const ZOOM_MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1];

// Find the next snap level above (direction=+1) or below (-1) the current zoom.
// Uses a small relative epsilon so being "almost exactly" at a step still
// counts as past it (otherwise repeated wheel ticks at e.g. 1.0 would never
// move because 1.0 is technically not strictly less than 1.0).
function nextZoomStep(current, direction) {
  const eps = current * 1e-4;
  if (direction > 0) {
    for (let i = 0; i < ZOOM_STEPS.length; i++) {
      if (ZOOM_STEPS[i] > current + eps) return ZOOM_STEPS[i];
    }
    return ZOOM_MAX;
  } else {
    for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
      if (ZOOM_STEPS[i] < current - eps) return ZOOM_STEPS[i];
    }
    return ZOOM_MIN;
  }
}

// Re-anchor pan offsets so the world point under (screenX, screenY) stays
// pinned while zoom changes from oldZoom → newZoom.
//
// `strict`: when true, _strictAnchor is set so clampAndCenter() will not
// drag the offset toward the centered position on a fit-axis. Use for
// wheel zoom-to-cursor where the cursor must stay fixed on its world
// point even if part of the page falls off-screen. Leave false (default)
// for fit / center-anchored zooms where keeping the page fully visible is
// preferable.
function _anchorAt(screenX, screenY, oldZoom, newZoom, strict = false) {
  // Snapshot BEFORE mutating viewport.zoom/offset so the freeze-render below
  // can stretch the captured pixels per the new transform. Idempotent —
  // additional zoom steps within the debounce window reuse the same snapshot
  // (so the page still anchors to its ORIGINAL appearance, not the previous
  // stretched freeze frame, which would compound rounding drift).
  _captureZoomFreeze();

  const wx = (screenX - viewport.offsetX) / oldZoom;
  const wy = (screenY - viewport.offsetY) / oldZoom;
  viewport.offsetX = screenX - wx * newZoom;
  viewport.offsetY = screenY - wy * newZoom;
  viewport.zoom = newZoom;
  // The user has explicitly placed the view at this anchor point.
  // Tell clampAndCenter() not to override it with auto-centering even if
  // the page fits an axis at the new zoom level.
  _anchorActive = true;
  _strictAnchor = strict;
  viewport.dirty = true;

  // Extend the freeze window for another 150 ms (debounce). Final cleanup
  // (drop snapshot, force one fresh render) happens in the scheduled timer.
  _scheduleZoomFreezeRelease();

  // For raster pages, kick the orchestrator so the new zoom-bucket's bitmap
  // and (if zoom > cap) tile get async-fetched. ensureBitmap dedups
  // concurrent requests; the sync fallback in the orchestrator surfaces
  // whatever bitmap is already cached so the canvas never blanks.
  _kickOrchestratorAfterZoom();
}

// Snap to the next/previous discrete zoom level, anchored at a cursor point.
// direction: +1 = zoom in, -1 = zoom out
// Wheel zoom → strict cursor anchor (skip on-screen clamp on fit-axis).
export function zoomStepAtPoint(screenX, screenY, direction) {
  const oldZoom = viewport.zoom;
  const newZoom = nextZoomStep(oldZoom, direction);
  if (newZoom === oldZoom) return;
  _anchorAt(screenX, screenY, oldZoom, newZoom, true);
}

// Continuous (multiplicative) zoom. Kept for callers that want non-snapped
// zoom — e.g. animated keyboard zoom. Wheel zoom uses zoomStepAtPoint.
// Strict anchor: callers (trackpad pinch, animated keyboard zoom) all
// expect the cursor world point to stay fixed.
export function zoomAtPoint(screenX, screenY, factor) {
  const oldZoom = viewport.zoom;
  const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, oldZoom * factor));
  if (newZoom === oldZoom) return;
  _anchorAt(screenX, screenY, oldZoom, newZoom, true);
}

// Set the zoom level absolutely, anchored at a specific screen point.
// Use this for the status-bar zoom input ("type 200% + Enter") and any
// other UI that wants to set an exact zoom value.
// Non-strict: callers typically pass the canvas center as the anchor and
// expect the page to stay fully visible (clampAndCenter clamps).
export function setZoomAtPoint(screenX, screenY, newZoom) {
  const oldZoom = viewport.zoom;
  const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newZoom));
  if (clamped === oldZoom) return;
  _anchorAt(screenX, screenY, oldZoom, clamped, false);
}

// Convenience: zoom in/out by one preset step, anchored at the canvas
// center. Used by the status-bar +/- buttons and the toolbar zoom buttons.
// Center-anchored, so clamp is desirable — call zoomStep variant that
// does NOT set strict.
export function zoomStepAtCenter(direction) {
  if (!_canvas) return;
  const dpr = _getDpr();
  const sx = (_canvas.width / dpr) / 2;
  const sy = (_canvas.height / dpr) / 2;
  const oldZoom = viewport.zoom;
  const newZoom = nextZoomStep(oldZoom, direction);
  if (newZoom === oldZoom) return;
  _anchorAt(sx, sy, oldZoom, newZoom, false);
}

// ─── Pan ────────────────────────────────────────────────────────────────────

let _isPanning = false, _panStartX = 0, _panStartY = 0;

export function startPan(screenX, screenY) {
  _isPanning = true;
  _panStartX = screenX - viewport.offsetX;
  _panStartY = screenY - viewport.offsetY;
  // Kill any in-flight wheel-momentum so the page doesn't keep gliding
  // while the user is now dragging it. Without this the click-pan offset
  // races with the decaying velocity and produces visible jitter.
  stopPanMomentum();
}

export function updatePan(screenX, screenY) {
  if (!_isPanning) return;
  viewport.offsetX = screenX - _panStartX;
  viewport.offsetY = screenY - _panStartY;
  // User has explicitly positioned the view → don't let clampAndCenter
  // snap a fit-axis back to center on the next frame. Pan does NOT need
  // strict anchoring (the page should stay on-screen even if the user
  // drags fast), so clear strict in case a previous wheel-zoom set it.
  _anchorActive = true;
  _strictAnchor = false;
  viewport.dirty = true;
  _scheduleTileRecheckAfterPan();
}

export function endPan() {
  _isPanning = false;
}

export function isPanning() {
  return _isPanning;
}

// ─── Coordinate Conversion ──────────────────────────────────────────────────

export function screenToWorld(sx, sy) {
  return {
    x: (sx - viewport.offsetX) / viewport.zoom,
    y: (sy - viewport.offsetY) / viewport.zoom,
  };
}

export function worldToScreen(wx, wy) {
  return {
    x: wx * viewport.zoom + viewport.offsetX,
    y: wy * viewport.zoom + viewport.offsetY,
  };
}

// ─── Wire Events (call once after canvas is ready) ──────────────────────────

export function wireEvents(canvas) {
  // Wire events on the main-view (above tool dispatcher) for reliable capture
  const mainView = document.querySelector('.main-view') || canvas;

  // NOTE: wheel handling lives in navigation-events.js (single source of truth
  // for zoom + pan + page-nav-at-edges). Don't add a second wheel listener here
  // — they would race and cause panning + instant page jumps on the same event.

  // Pan: middle-click drag, or hand tool left-click drag.
  // Cursor is reactive — we set state.isPanning and js/ui/cursor.js derives
  // the grabbing cursor from it. The cursor module also toggles the body
  // class `pdf-cursor-override` so a CSS rule forces inheritance through
  // child elements that have their own explicit cursor (text spans, links).
  // No body classes, no !important written from this file.
  mainView.addEventListener('pointerdown', (e) => {
    if (!viewport.active) return;
    // Middle button always pans
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      const rect = canvas.getBoundingClientRect();
      startPan(e.clientX - rect.left, e.clientY - rect.top);
      mainView.setPointerCapture(e.pointerId);
      state.isPanning = true;
      state.isMiddleButtonPanning = true;
      return;
    }
    // Hand-tool left-click: only pan if NOT clicking on an annotation.
    // If the click is on an annotation, let the event fall through to the
    // annotation-canvas listener so hand-tool.onPointerDown can auto-switch
    // to Select tool and delegate the click for one-click selection.
    if (e.button === 0 && state.currentTool === 'hand') {
      // Hit-test annotations at the click location (in app coords)
      let isOnAnnotation = false;
      try {
        const doc = getActiveDocument();
        if (doc && doc.annotations && doc.annotations.length > 0) {
          const rect = canvas.getBoundingClientRect();
          // Convert client → app coordinates (inverse of viewport transform)
          const cx = e.clientX - rect.left;
          const cy = e.clientY - rect.top;
          const appX = (cx - viewport.offsetX) / viewport.zoom;
          const appY = (cy - viewport.offsetY) / viewport.zoom;
          // Lazy-import findAnnotationAt to avoid static cycle
          const ann = _findAnnotationAt && _findAnnotationAt(appX, appY);
          if (ann) isOnAnnotation = true;
        }
      } catch (_) {}
      if (!isOnAnnotation) {
        e.preventDefault();
        e.stopPropagation();
        const rect = canvas.getBoundingClientRect();
        startPan(e.clientX - rect.left, e.clientY - rect.top);
        mainView.setPointerCapture(e.pointerId);
        state.isPanning = true;
      }
      // else: let the event propagate so hand-tool.onPointerDown can handle it
    }
  }, { capture: true });

  mainView.addEventListener('pointermove', (e) => {
    if (!_isPanning) return;
    const rect = canvas.getBoundingClientRect();
    updatePan(e.clientX - rect.left, e.clientY - rect.top);
  });

  function _endPanAndCursor() {
    if (_isPanning) {
      state.isPanning = false;
      state.isMiddleButtonPanning = false;
    }
    endPan();
  }

  mainView.addEventListener('pointerup', _endPanAndCursor);
  mainView.addEventListener('pointercancel', _endPanAndCursor);
}
