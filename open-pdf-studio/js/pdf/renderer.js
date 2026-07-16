import { state, getActiveDocument, getPageRotation, setPageRotation } from '../core/state.js';
import { isTauri, invoke } from '../core/platform.js';
// Always-fresh DOM refs (never stale regardless of init timing or bundler behavior)
function getPdfCanvas() { return document.getElementById('pdf-canvas'); }
function getAnnotationCanvas() { return document.getElementById('annotation-canvas'); }
import { redrawAnnotations, renderAnnotationsForPage } from '../annotations/rendering.js';
import { ensureAnnotationsForPage, hidePdfABar } from './loader.js';
import { updateAllStatus } from '../ui/chrome/status-bar.js';
import { hideProperties } from '../ui/panels/properties-panel.js';
import { updateActiveThumbnail, pauseThumbnails, resumeThumbnails, isThumbnailPipelineIdle } from '../ui/panels/left-panel.js';
import { createSinglePageTextLayer, clearSinglePageTextLayer, createTextLayer, clearTextLayers, createTextLayerFromRust } from '../text/text-layer.js';
import { createSinglePageLinkLayer, clearSinglePageLinkLayer, createLinkLayer, clearLinkLayers } from './link-layer.js';
import { createSinglePageFormLayer, clearSinglePageFormLayer, createFormLayer, clearFormLayers, hideFormFieldsBar } from './form-layer.js';
import { clearPdfVectorCache, prefetchPdfVectorGeometry } from '../tools/pdf-snap-extractor.js';
import { clearDetectionCache } from '../tools/pdf-element-detector.js';
import { onPageRendered, clearHighlights } from '../search/find-bar.js';
import { showPagePlaceholder, hidePagePlaceholderWhenReady } from './page-transition.js';
// Hi-DPI support: render canvases at device pixel ratio for sharp text
export function getCanvasDPR() { return window.devicePixelRatio || 1; }

// ─── JS-side bitmap CACHE (per-document, LRU-bounded) ───────────────────────
// Caches the fully-decoded ImageBitmap for each (file, page, scale, rotation)
// so revisits of an exact zoom level skip the entire Rust IPC + tempfile +
// ImageData rebuild pipeline (~300-500ms saved per hit). On a hit, render is
// just `drawImage(cachedBitmap)` which the GPU compositor handles in <10ms.
// Capacity 16 = enough for a Barn-sized 7-page doc with 2-3 zooms per page
// without pinning excessive memory (each ImageBitmap is GC'd when evicted).
const _BITMAP_JS_CACHE = new Map();
const _BITMAP_JS_CACHE_MAX = 16;
export function _bitmapJSCacheGet(key) {
  const entry = _BITMAP_JS_CACHE.get(key);
  if (entry) {
    // LRU touch: re-insert so the eviction order moves this entry to the end.
    _BITMAP_JS_CACHE.delete(key);
    _BITMAP_JS_CACHE.set(key, entry);
  }
  return entry || null;
}
export async function _bitmapJSCacheSet(key, imageData) {
  while (_BITMAP_JS_CACHE.size >= _BITMAP_JS_CACHE_MAX) {
    const firstKey = _BITMAP_JS_CACHE.keys().next().value;
    if (!firstKey) break;
    const old = _BITMAP_JS_CACHE.get(firstKey);
    try { old?.bitmap?.close?.(); } catch {}
    _BITMAP_JS_CACHE.delete(firstKey);
  }
  try {
    const bitmap = await createImageBitmap(imageData);
    _BITMAP_JS_CACHE.set(key, { bitmap, w: imageData.width, h: imageData.height });
  } catch (e) {
    console.warn('[bitmap-cache] createImageBitmap failed:', e);
  }
}
export function clearBitmapJSCacheForFile(filePath) {
  // Wipe all entries for this filePath (used on close / save / annotation
  // changes that invalidate the rendered pixels).
  for (const k of Array.from(_BITMAP_JS_CACHE.keys())) {
    if (k.startsWith(filePath + '|')) {
      const e = _BITMAP_JS_CACHE.get(k);
      try { e?.bitmap?.close?.(); } catch {}
      _BITMAP_JS_CACHE.delete(k);
    }
  }
}
/** Wipe every entry in the JS-side ImageBitmap cache. Exposed for the MCP
 *  `app_clear_caches` test tool so an AI-driven debug loop can rule out
 *  stale cache as a contributor to anomalies. */
export function _clearJSBitmapCache() {
  for (const k of Array.from(_BITMAP_JS_CACHE.keys())) {
    const e = _BITMAP_JS_CACHE.get(k);
    try { e?.bitmap?.close?.(); } catch {}
    _BITMAP_JS_CACHE.delete(k);
  }
}

// NOTE: an earlier prototype embedded MuPDF WASM rendering helpers here
// (loadMupdf / isMupdfAvailable / getMupdfDocument / renderPageWithMupdf).
// They were never wired up — the active path is the Rust vector renderer
// via `extract_draw_commands` + `vector-renderer.js`, with PDF.js as the
// fallback for raster-only pages. The unused helpers have been removed.
// `mupdf-renderer.js` is still imported once below for `closeDocument()`
// cleanup (no-op when the runtime never loaded the WASM module).

function setupCanvasHiDPI(canvas, width, height) {
  const dpr = getCanvasDPR();
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = Math.floor(width) + 'px';
  canvas.style.height = Math.floor(height) + 'px';
}

// Foreground-render generation counter. Bumped on every renderPage() entry;
// each in-flight invocation captures the value at start, then re-checks after
// each await. If the captured gen differs from the current gen, a newer
// renderPage() has been triggered — the older one must NOT write to the
// shared #pdf-canvas (its scale-N bitmap would clobber the newer scale-M
// result that already landed).
//
// User-visible symptom this fixes: rapid mouse-wheel zoom on raster PDFs
// (BARN) showed the page "springing back and forth" between intermediate
// zoom levels — earlier-started but slower-completing renders were stomping
// over the freshest user-requested zoom level.
let _foregroundRenderGen = 0;

// Returns true if `doc` is no longer the active document. Use this after every
// `await` in render code to abort late completions whose results would corrupt
// the SHARED #pdf-canvas / pdf-viewport singleton with a different document's
// content. Without this, a slow IPC chain (analyze_page_type +
// extract_draw_commands + prepareImages) for tab A can finish AFTER the user
// switched to tab B, then write A's filePath into the viewport singleton,
// making the RAF render loop draw A's pages on B's tab — the ghost/bleed-through
// the user reports when switching tabs rapidly across multiple PDFs.
function _isStaleDoc(doc) {
  return doc !== state.documents[state.activeDocumentIndex];
}


// ─── Main-thread jank detector ───────────────────────────────────────────
// Fires every 500ms. If a tick takes >1s to arrive, the main thread was blocked.
let _jankTimer = null;
let _jankLast = 0;
function _startJankDetector() {
  if (_jankTimer) return;
  _jankLast = performance.now();
  _jankTimer = setInterval(() => {
    const now = performance.now();
    const gap = now - _jankLast;
    if (gap > 1000) {
      console.warn(`[JANK] Main thread was blocked for ${gap.toFixed(0)}ms!`);
    }
    _jankLast = now;
  }, 500);
}
_startJankDetector();

// Render PDF page (single page mode)
export async function renderPage(pageNum) {
  // In-flight counter exposed for MCP test harness — `waitForRenderIdle()`
  // polls `window.__pdfRenderInFlight === 0` to know when a synthetic zoom
  // event has fully settled (bitmap painted, tile rendered, state updated).
  if (typeof window !== 'undefined') {
    window.__pdfRenderInFlight = (window.__pdfRenderInFlight || 0) + 1;
  }
  try {
    return await _renderPageImpl(pageNum);
  } finally {
    if (typeof window !== 'undefined') {
      window.__pdfRenderInFlight = Math.max(0, (window.__pdfRenderInFlight || 1) - 1);
    }
  }
}

async function _renderPageImpl(pageNum) {
  const _rp0 = performance.now();
  console.log(`[PERF] renderPage(${pageNum}) START`);
  // Clear search highlights immediately to prevent stale highlights
  // from appearing at wrong positions during canvas resize
  clearHighlights();

  const doc = state.documents[state.activeDocumentIndex];
  if (!doc || !doc.pdfDoc) return;
  const pdfDoc = doc.pdfDoc;
  const scale = doc.scale;

  // Validate page number against THIS document's page count
  if (!Number.isInteger(pageNum) || pageNum < 1 || pageNum > pdfDoc.numPages) return;

  // Stamp this invocation with a fresh render-generation. Re-checked after
  // each await before any canvas / viewport mutation — see `_isStaleGen`
  // below. Prevents the rapid-zoom out-of-order race.
  const _renderGen = ++_foregroundRenderGen;
  const _isStaleGen = () => _renderGen !== _foregroundRenderGen;

  const page = await pdfDoc.getPage(pageNum);
  if (_isStaleDoc(doc)) return; // user switched tabs while we awaited PDF.js page
  const extraRotation = getPageRotation(pageNum);
  const viewportOpts = { scale };
  if (extraRotation) {
    viewportOpts.rotation = (page.rotate + extraRotation) % 360;
  }
  const viewport = page.getViewport(viewportOpts);

  // High-zoom safety cap. The browser canvas has a max ~16384 px per axis
  // (Chromium); rendering BARN (1632×1056 pt page) at scale=10 would produce
  // a 16320×10560 buffer = exceeds limit, allocation fails, canvas turns
  // black, user sees "versringen". Cap the Rust render at a safe max-axis
  // and let CSS-stretch the bitmap to the user-requested CSS viewport size
  // (slightly blurry but stable — same approach as Edge/Chrome on heavy zoom).
  //
  // MAX_BITMAP_AXIS_PX chosen at 4096 = well under canvas limits, easy to
  // allocate even on weak hardware, and CSS-stretching from 4096 to e.g.
  // 8000 px is barely noticeable for tex/vector content (1 source pixel
  // covers 2 dest pixels via bilinear).
  const MAX_BITMAP_AXIS_PX = 4096;
  const _pageMaxAxisPt = Math.max(viewport.width, viewport.height) / scale;
  const _maxAllowedScale = MAX_BITMAP_AXIS_PX / _pageMaxAxisPt;
  const _effectiveScale = Math.min(scale, _maxAllowedScale);
  if (_effectiveScale < scale) {
    console.log(`[render] high-zoom safety cap: requested scale=${scale.toFixed(2)}, rendering at ${_effectiveScale.toFixed(2)} (CSS-stretch to viewport)`);
  }

  // Cache page dimensions in PDF points on the doc so plugin annotation
  // handlers can read them synchronously at click time without depending
  // on the pdf-viewport singleton (which is a noop for blank docs whose
  // vector path is gated off by the filePath check).
  if (!doc.pageDims) doc.pageDims = {};
  const [vx0, vy0, vx1, vy1] = page.view;
  doc.pageDims[pageNum] = {
    widthPt: vx1 - vx0,
    heightPt: vy1 - vy0,
    rotation: page.rotate || 0,
  };

  const pdfCanvas = getPdfCanvas();
  const annotationCanvas = getAnnotationCanvas();
  if (!pdfCanvas || !annotationCanvas) return;

  const dpr = getCanvasDPR();
  const bufferW = Math.floor(viewport.width * dpr);
  const bufferH = Math.floor(viewport.height * dpr);

  // Try Rust open-pdf-render first (pure Rust, fast), fall back to PDF.js
  const _t0 = performance.now();
  const _canUseTauri = isTauri();
  const _hasFilePath = !!doc.filePath;
  let _skipBitmapRender = false;

  // ─── VECTOR VIEWPORT MODE ──────────────────────────────────────────────
  // Extract draw commands once, then hand off to pdf-viewport.js render loop.
  // All zoom/pan is handled by the viewport — no re-rendering needed here.
  // The user-applied page rotation is part of the cache key so a rotated
  // page coexists with its un-rotated version in cache.
  if (_canUseTauri && _hasFilePath) {
    try {
      // Pause thumbnail rendering so Rust backend is free for page rendering
      pauseThumbnails();
      console.log(`[PERF] renderPage(${pageNum}) trying vector path: ${(performance.now() - _rp0).toFixed(0)}ms`);
      const vr = await import('./vector-renderer.js');
      if (_isStaleDoc(doc)) { resumeThumbnails(); return; }
      const userRotation = getPageRotation(pageNum);

      // Engine-override gate: vector path only runs in Auto mode (override===null).
      // If user picked 'pdfium' or 'rust-skia' in the status-bar dropdown,
      // skip Vector entirely — even for pages whose draw-commands are already
      // cached from a previous render. Without this gate, the override only
      // affected the raster engine (PDFium vs Rust-Skia at the worker-pool
      // level) but vector-classified pages still went through the Vector
      // engine, making "Engine: PDFium" appear to do nothing for those pages.
      // BELEID (2026-07-06): PDFium is de basis-engine; het vector-pad
      // (AEC-PDF v1) draait alléén nog met de expliciete diagnose-vlag
      // window.__aecVectorPath. Een null-override uit oude persisted
      // voorkeuren (dropdown-tijdperk) mag het pad niet meer aanzetten —
      // dat gaf o.a. een witte pagina op geroteerde vector-bladen.
      const _vectorAllowed = window.__aecVectorPath === true && state.renderEngineOverride == null;
      if (_vectorAllowed && !vr.hasCachedCommands(doc.filePath, pageNum, userRotation)) {
        console.log(`[PERF] renderPage(${pageNum}) analyze_page_type START: ${(performance.now() - _rp0).toFixed(0)}ms`);
        // JS-side cache check FIRST — populated by analyze_page_type_batch
        // at cold-open. Skips the IPC roundtrip (which can be 1+ second
        // queued behind thumbnail invokes during cold-open) for any page
        // the batch has classified. The Rust cache remains authoritative
        // for the rare cold-miss path below.
        const ptcMod = await import('./page-type-cache.js');
        let pageType = ptcMod.getCachedPageType(doc.filePath, pageNum - 1);
        if (pageType) {
          console.log(`[PERF] renderPage(${pageNum}) analyze_page_type=${pageType} (js-cache): ${(performance.now() - _rp0).toFixed(0)}ms`);
        } else {
          pageType = await invoke('analyze_page_type', { path: doc.filePath, pageIndex: pageNum - 1 });
          if (_isStaleDoc(doc)) { resumeThumbnails(); return; }
          ptcMod.cachePageType(doc.filePath, pageNum - 1, pageType);
          console.log(`[PERF] renderPage(${pageNum}) analyze_page_type=${pageType}: ${(performance.now() - _rp0).toFixed(0)}ms`);
        }
        // BELEID (2026-07-06): PDFium is de basis-engine voor álle weergaven.
        // Het eigen vector-replay-pad (AEC-PDF v1) staat uit tot het per
        // bladklasse bewezen is via de corpus-benchmark — het veroorzaakte
        // o.a. een witte pagina en gedraaide weergave op geroteerde bladen
        // (Originele bestanden/Technische tekening.pdf p1, /Rotate-blad).
        // Diagnose/ontwikkeling: window.__aecVectorPath = true heractiveert.
        if (pageType === 'vector' && !window.__aecVectorPath) {
          pageType = 'raster';
        }
        if (pageType === 'vector') {
          console.log(`[PERF] renderPage(${pageNum}) extract_draw_commands START: ${(performance.now() - _rp0).toFixed(0)}ms`);
          const cmdData = await invoke('extract_draw_commands', {
            path: doc.filePath,
            pageIndex: pageNum - 1,
            rotation: userRotation,
          });
          if (_isStaleDoc(doc)) { resumeThumbnails(); return; }
          const cmdBytes = cmdData instanceof Uint8Array ? cmdData : new Uint8Array(cmdData);
          console.log(`[PERF] renderPage(${pageNum}) extract_draw_commands DONE (${cmdBytes.length} bytes): ${(performance.now() - _rp0).toFixed(0)}ms`);
          vr.cacheCommands(doc.filePath, pageNum, cmdBytes, userRotation);
          // Pre-decode any images in the command buffer (async, must complete before render)
          console.log(`[PERF] renderPage(${pageNum}) prepareImages START: ${(performance.now() - _rp0).toFixed(0)}ms`);
          await vr.prepareImages(doc.filePath, pageNum, userRotation);
          if (_isStaleDoc(doc)) { resumeThumbnails(); return; }
          console.log(`[PERF] renderPage(${pageNum}) prepareImages DONE: ${(performance.now() - _rp0).toFixed(0)}ms`);
        }
      }

      if (_vectorAllowed && vr.hasCachedCommands(doc.filePath, pageNum, userRotation)) {
        const dims = vr.getCachedPageDimensions(doc.filePath, pageNum, userRotation);
        if (dims) {
          const { initViewport, setPage, wireEvents, viewport: pdfVP } = await import('./pdf-viewport.js');
          // CRITICAL: don't write a stale doc's filePath into the viewport
          // singleton. If we do, the RAF render loop will then draw the OLD
          // doc's content on the SHARED #pdf-canvas — that's the ghost the
          // user reports when switching tabs rapidly across multiple PDFs.
          if (_isStaleDoc(doc)) { resumeThumbnails(); return; }

          // Initialize viewport (idempotent — safe to call multiple times).
          // Call redrawAnnotations SYNCHRONOUSLY inside the viewport's RAF tick
          // (a dynamic import().then() would defer to a microtask, lagging
          // annotations one frame behind the PDF during zoom/pan). Use the
          // lightweight=true path so per-frame zoom skips the heavy SolidJS
          // status-bar / list / ribbon updates that would stall the frame.
          initViewport(pdfCanvas, () => redrawAnnotations(true));
          if (!pdfCanvas._vpEventsWired) {
            wireEvents(pdfCanvas);
            pdfCanvas._vpEventsWired = true;
          }
          const container = document.getElementById('pdf-container');
          if (container) container.style.overflow = 'hidden';

          // Load page into viewport (triggers fitToViewport + first render)
          setPage(doc.filePath, pageNum, dims.w, dims.h, dims.x0 || 0, dims.y0 || 0, userRotation);

          // Create text layer for text selection + search
          // Try Rust-extracted text spans first (faster, no PDF.js dependency),
          // fall back to PDF.js text layer if Rust extraction returns empty
          try {
            const canvasContainer = document.getElementById('canvas-container');
            const rustTextOk = await createTextLayerFromRust(
              canvasContainer || container, pageNum, dims.w, dims.h
            );
            if (_isStaleDoc(doc)) { resumeThumbnails(); return; }
            if (!rustTextOk) {
              const page = await pdfDoc.getPage(pageNum);
              if (_isStaleDoc(doc)) { resumeThumbnails(); return; }
              const textViewport = page.getViewport({ scale: 1.0 });
              await createSinglePageTextLayer(page, textViewport);
              if (_isStaleDoc(doc)) { resumeThumbnails(); return; }
            }
            if (window.__pdfViewport) window.__pdfViewport.dirty = true;
          } catch (e) {
            console.warn('[render] Text layer failed:', e);
          }

          console.log(`[render] ✅ Vector viewport: ${dims.w}x${dims.h} pt, origin=(${dims.x0},${dims.y0})`);
          // Mark page type so the unified render loop knows which branches to run
          if (window.__pdfViewport) window.__pdfViewport.pageType = 'vector';
          _skipBitmapRender = true;
        }
      }

      // ─── RASTER MODE: unified viewport ──────────────────────────────────
      // For raster-classified pages, activate the viewport singleton (same
      // one used by vector mode) and let the unified _render() loop handle
      // paint. The OLD bitmap-mode path further down still runs during this
      // transition; Task 5 will rip it.
      // Raster path runs when:
      //  - vector path didn't already claim the render (_skipBitmapRender),
      //  - AND either there are no cached vector commands, OR the user has
      //    forced a raster engine (override !== null), in which case cached
      //    vector commands must be bypassed.
      const _useRaster = !_skipBitmapRender &&
        (!_vectorAllowed || !vr.hasCachedCommands(doc.filePath, pageNum, userRotation));
      if (_useRaster) {
        const { initViewport, setPage, wireEvents, viewport: pdfVP } =
          await import('./pdf-viewport.js');
        if (_isStaleDoc(doc)) { resumeThumbnails(); return; }

        // Init viewport on the main PDF canvas if not already running.
        initViewport(pdfCanvas, () => redrawAnnotations(true));
        if (!pdfCanvas._vpEventsWired) {
          wireEvents(pdfCanvas);
          pdfCanvas._vpEventsWired = true;
        }

        // Container in fixed-overflow mode — viewport handles pan/zoom now.
        const _rasterContainer = document.getElementById('pdf-container');
        if (_rasterContainer) _rasterContainer.style.overflow = 'hidden';

        // Page dims for the viewport. page.view = [x0, y0, x1, y1] in PRE-
        // rotation user-space coords. The PDFium bitmap is rendered POST-
        // rotation (intrinsic /Rotate is applied by default), so if the PDF
        // has /Rotate=90 or 270 the bitmap's width/height are swapped vs
        // page.view. Match by swapping page.view dims here too — otherwise
        // _render() stretches a portrait bitmap into a landscape rectangle
        // (or vice versa) and the page appears with dims transposed.
        const _x0 = page.view[0], _y0 = page.view[1];
        const _x1 = page.view[2], _y1 = page.view[3];
        const _rawW = _x1 - _x0;
        const _rawH = _y1 - _y0;
        const _intrinsicRot = (page.rotate || 0) % 360;
        const _rotSwap = (_intrinsicRot === 90 || _intrinsicRot === 270);
        const _pageWpt = _rotSwap ? _rawH : _rawW;
        const _pageHpt = _rotSwap ? _rawW : _rawH;
        setPage(
          doc.filePath, pageNum,
          _pageWpt, _pageHpt,
          _x0, _y0,
          getPageRotation(pageNum) || 0
        );

        // Mark as raster so _render() takes the bitmap branch + skips vector
        pdfVP.pageType = 'raster';

        // Kick async bitmap fill — fires viewport.dirty when arrives.
        const _orch = await import('./bitmap-orchestrator.js');
        _orch.ensureBitmapForCurrentView();
        // Tile will be ensured on the first zoom change via the _anchorAt hook
        // (Step 4); for the initial fit we let _render() display whatever
        // getBestAvailableBitmap provides immediately.

        console.log(`[render] Raster viewport activated: ${_pageWpt}x${_pageHpt} pt (intrinsic /Rotate=${_intrinsicRot}°)`);
        // The new viewport path now OWNS the canvas (initViewport's
        // _resizeCanvas sets pdfCanvas.width = container size; _render's
        // setTransform scales content). The OLD bitmap path's
        // pdfCanvas.width = pageW*scale assignment is INCOMPATIBLE with
        // this model — leaving it active would thrash the canvas
        // dimensions every frame. So skip the old path now; Task 5
        // physically deletes its code from the file.
        _skipBitmapRender = true;
      }
      // Heavy IPC for the active page is done — let the thumbnail processor
      // resume immediately instead of waiting out the pause window.
      resumeThumbnails();
    } catch (e) {
      console.warn('[render] Vector mode failed:', e);
      // Failure path: still resume so thumbnails don't stay stuck paused.
      resumeThumbnails();
    }
  }

  // Bitmap rendering has moved to the unified viewport model (Task 4):
  // activated above in the raster-mode block; pixel-fill happens via
  // bitmap-orchestrator + drawImage in pdf-viewport.js _render() loop.
  // No predictive resize, no canvas-width mutation, no tile DOM canvas.
  //
  // EXCEPTION: blank in-memory docs (Bestand → Nieuw → A4/A3/etc.) have
  // `doc.filePath === null` and are gated out of BOTH vector AND raster
  // paths above. Without a fallback, pdf-canvas keeps its stale content
  // from the previous document (or remains at its previous oversized
  // dimensions) — the user sees "one big white screen" instead of an A4
  // page. Render directly to pdf-canvas via PDF.js for blank docs.
  if (!_hasFilePath && !_skipBitmapRender) {
    try {
      // Also deactivate the viewport singleton if it's leftover-active from
      // a previously-opened real PDF — its RAF loop would otherwise repaint
      // stale content over our PDF.js render every frame.
      const _vpMod = await import('./pdf-viewport.js');
      if (_vpMod.viewport && _vpMod.viewport.active && _vpMod.viewport.filePath !== doc.filePath) {
        _vpMod.viewport.active = false;
        _vpMod.viewport.filePath = null;
        _vpMod.viewport.currentBitmap = null;
      }

      const dpr = getCanvasDPR();
      pdfCanvas.width = Math.floor(viewport.width * dpr);
      pdfCanvas.height = Math.floor(viewport.height * dpr);
      pdfCanvas.style.width = Math.floor(viewport.width) + 'px';
      pdfCanvas.style.height = Math.floor(viewport.height) + 'px';
      const pdfCtx = pdfCanvas.getContext('2d');
      pdfCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      pdfCtx.fillStyle = '#ffffff';
      pdfCtx.fillRect(0, 0, viewport.width, viewport.height);
      await page.render({
        canvasContext: pdfCtx,
        viewport,
        annotationMode: 0,
      }).promise;
      if (_isStaleDoc(doc)) return;
      state.renderEngine = 'Raster (PDF.js)';
    } catch (e) {
      console.warn('[render] Blank-doc PDF.js render failed:', e);
    }
  }

  // Annotation canvas resize is deferred to just before redrawAnnotations()
  // so the clear+redraw happens in one synchronous block (no blink).

  // Set CSS scale variables for PDF.js text/annotation layers
  const container = document.getElementById('canvas-container');
  if (container) {
    container.style.setProperty('--scale-factor', viewport.scale);
    container.style.setProperty('--total-scale-factor', viewport.scale);
  }

  // Text/link/form layers: skip during vector zoom (expensive PDF.js operations)
  // Only create on first load or page change, not on every zoom
  if (!_skipBitmapRender || !document.querySelector('.textLayer')) {
    try {
      await createSinglePageTextLayer(page, viewport);
      if (_isStaleDoc(doc)) return;
    } catch (e) {
      console.warn('Failed to create text layer:', e);
    }

    try {
      await createSinglePageLinkLayer(page, viewport);
      if (_isStaleDoc(doc)) return;
    } catch (e) {
      console.warn('Failed to create link layer:', e);
    }

    try {
      await createSinglePageFormLayer(page, viewport);
      if (_isStaleDoc(doc)) return;
    } catch (e) {
      console.warn('Failed to create form layer:', e);
    }

    // editText tool: annotation-canvas must drop below the textLayer so
    // text-span clicks reach the span listeners (inline text editing).
    // For the 'select' tool we do NOT set pe:none statically — the dynamic
    // fall-through handler in tools/manager.js (_setSelectFallthroughEnabled)
    // toggles annotation-canvas pointer-events on mousemove based on
    // whether the cursor is over an annotation. Setting pe:none here on
    // first render would block the very first click on an annotation
    // (before any mousemove has fired) — symptom: "annotations visible
    // but not selectable" in raster-engine mode.
    if (state.currentTool === 'editText') {
      annotationCanvas.style.zIndex = '2';
      annotationCanvas.style.pointerEvents = 'none';
      const container = document.getElementById('canvas-container');
      if (container) {
        container.querySelectorAll('.formLayer section, .linkLayer .pdf-link').forEach(el => {
          el.style.pointerEvents = 'none';
        });
      }
    }
  }

  // Ensure annotations for this page are loaded (on-demand if background hasn't reached it yet)
  // Skip heavy operations during vector zoom (only needed on first load / page change)
  if (!_skipBitmapRender || !document.querySelector('.textLayer')) {
    console.log(`[PERF] renderPage(${pageNum}) ensureAnnotations START: ${(performance.now() - _rp0).toFixed(0)}ms`);
    await ensureAnnotationsForPage(pageNum);
    if (_isStaleDoc(doc)) return;
    console.log(`[PERF] renderPage(${pageNum}) ensureAnnotations DONE: ${(performance.now() - _rp0).toFixed(0)}ms`);
    if (state.preferences.snapToPdfContent) {
      prefetchPdfVectorGeometry(pageNum);
    }
  }

  // Final stale-doc check before mutating shared canvas — without this, an
  // earlier renderPage() that finished after a tab switch would resize and
  // overwrite the annotation canvas of the now-active document.
  if (_isStaleDoc(doc)) return;

  // Resize annotation canvas and redraw in one synchronous block — no blink
  setupCanvasHiDPI(annotationCanvas, viewport.width, viewport.height);
  redrawAnnotations();

  // Re-apply search highlights after re-render
  onPageRendered();

  // Update status bar
  updateAllStatus();

  // NOTE: prefetchAdjacentPages was removed — it causes Rust backend contention
  // with thumbnail rendering, making the app unresponsive on large files.
  // Annotations are loaded on-demand via ensureAnnotationsForPage() when
  // the user actually navigates to a page.
  console.log(`[PERF] renderPage(${pageNum}) TOTAL: ${(performance.now() - _rp0).toFixed(0)}ms`);
}

// Render page offscreen and swap canvases atomically to avoid zoom flicker.
// The visible canvas keeps its CSS-scaled content until the new render is done.
export async function renderPageOffscreen(pageNum) {
  clearHighlights();

  const doc = state.documents[state.activeDocumentIndex];
  if (!doc || !doc.pdfDoc) return;
  const pdfDoc = doc.pdfDoc;
  const scale = doc.scale;

  if (!Number.isInteger(pageNum) || pageNum < 1 || pageNum > pdfDoc.numPages) return;

  const page = await pdfDoc.getPage(pageNum);
  if (_isStaleDoc(doc)) return;
  const extraRotation = getPageRotation(pageNum);
  const viewportOpts = { scale };
  if (extraRotation) viewportOpts.rotation = (page.rotate + extraRotation) % 360;
  const viewport = page.getViewport(viewportOpts);
  const dpr = getCanvasDPR();

  const pdfCanvas = getPdfCanvas();
  const annotationCanvas = getAnnotationCanvas();
  if (!pdfCanvas || !annotationCanvas) return;

  // RUST-ONLY: this offscreen render path used to dual-fallback to PDF.js.
  // Per project policy ("geen fallback"), Rust failure is now a hard error
  // surfaced via state.renderEngine = 'ERROR' so any rasterizer bug is
  // immediately visible.
  // Deactivate the vector viewport singleton — same reason as renderPage().
  if (window.__pdfViewport) window.__pdfViewport.active = false;

  if (!isTauri() || !doc.filePath) {
    state.renderEngine = 'UNSUPPORTED';
    console.error('[render-offscreen] HARD ERROR: cannot render without Tauri+filePath. NO FALLBACK.');
    return;
  }
  try {
    const { renderPdfPage } = await import('./engine-router.js');
    const rgbaData = await renderPdfPage({
      path: doc.filePath,
      pageIndex: pageNum - 1,
      scale: scale,
    });
    if (_isStaleDoc(doc)) return;
    const _offBytes = rgbaData instanceof Uint8Array ? rgbaData : new Uint8Array(rgbaData);
    if (!_offBytes || _offBytes.length <= 8) {
      state.renderEngine = 'ERROR';
      console.error('[render-offscreen] HARD ERROR: Rust returned empty buffer. NO FALLBACK.');
      return;
    }
    const headerView = new DataView(_offBytes.buffer, _offBytes.byteOffset, 8);
    const rustW = headerView.getUint32(0, true);
    const rustH = headerView.getUint32(4, true);
    const rgba = new Uint8ClampedArray(_offBytes.buffer, _offBytes.byteOffset + 8, _offBytes.length - 8);
    pdfCanvas.width = rustW;
    pdfCanvas.height = rustH;
    pdfCanvas.style.width = Math.floor(viewport.width) + 'px';
    pdfCanvas.style.height = Math.floor(viewport.height) + 'px';
    const imageData = new ImageData(rgba, rustW, rustH);
    pdfCanvas.getContext('2d').putImageData(imageData, 0, 0);
    setupCanvasHiDPI(annotationCanvas, viewport.width, viewport.height);
    state.renderEngine = 'Raster (PDFium)';
  } catch (e) {
    state.renderEngine = 'ERROR';
    console.error('[render-offscreen] HARD ERROR: Rust render threw. NO FALLBACK.', e);
    return;
  }

  // Set CSS scale variables for text/annotation layers
  const container = document.getElementById('canvas-container');
  if (container) {
    container.style.setProperty('--scale-factor', viewport.scale);
    container.style.setProperty('--total-scale-factor', viewport.scale);
  }

  // Create text, link, form layers
  try { await createSinglePageTextLayer(page, viewport); } catch {}
  if (_isStaleDoc(doc)) return;
  try { await createSinglePageLinkLayer(page, viewport); } catch {}
  if (_isStaleDoc(doc)) return;
  try { await createSinglePageFormLayer(page, viewport); } catch {}
  if (_isStaleDoc(doc)) return;

  // Re-apply overlay state — see comment near renderer block ~line 455.
  // Only editText forces pe:none statically; select uses dynamic fallthrough.
  if (state.currentTool === 'editText') {
    annotationCanvas.style.zIndex = '2';
    annotationCanvas.style.pointerEvents = 'none';
  }
  if (state.currentTool === 'select' || state.currentTool === 'editText') {
    if (container) {
      container.querySelectorAll('.formLayer section, .linkLayer .pdf-link').forEach(el => {
        el.style.pointerEvents = 'none';
      });
    }
  }

  await ensureAnnotationsForPage(pageNum);
  if (_isStaleDoc(doc)) return;
  if (state.preferences.snapToPdfContent) prefetchPdfVectorGeometry(pageNum);
  redrawAnnotations();
  onPageRendered();
  updateAllStatus();
}

// Track which pages have been rendered in continuous mode
const _renderedPages = new Set();
let _renderedPagesScale = null; // scale at which pages were rendered
let _continuousObserver = null;

// Track active continuous page renders for cancellation
const _continuousRenderTasks = new Map(); // pageNum -> RenderTask

// Low-res preview cache for fast initial display
const _lowResCache = new Map(); // `${filePath}|${pageNum}` -> { canvas, scale }
const LOW_RES_SCALE = 0.5; // Render at 50% for fast preview

// Cache-key MUST include the document — a bare pageNum key served page N of
// whichever document happened to fill the cache first (wrong preview after a
// tab switch).
// Rotation is part of the key so a rotated page doesn't reuse the pre-rotation
// (old-orientation) preview canvas — that stale preview flashed in the OLD
// orientation on the continuous-view rebuild after rotating (issue #262).
function _lowResKey(pageNum) {
  return `${getActiveDocument()?.filePath || 'blank'}|${pageNum}|${getPageRotation(pageNum) || 0}`;
}

// Render a quick low-res preview of a page (fast, <50ms per page)
async function renderLowResPreview(pdfDoc, pageNum, targetWidth, targetHeight) {
  const cacheKey = _lowResKey(pageNum);
  if (_lowResCache.has(cacheKey)) return _lowResCache.get(cacheKey).canvas;

  const page = await pdfDoc.getPage(pageNum);
  const extraRotation = getPageRotation(pageNum);
  const vpOpts = { scale: LOW_RES_SCALE };
  if (extraRotation) vpOpts.rotation = (page.rotate + extraRotation) % 360;
  const viewport = page.getViewport(vpOpts);

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');

  try {
    await page.render({
      canvasContext: ctx,
      viewport,
      annotationMode: 0,
    }).promise;
  } catch (e) {
    if (e.name === 'RenderingCancelledException') return null;
    return null;
  }

  _lowResCache.set(cacheKey, { canvas, scale: LOW_RES_SCALE });
  return canvas;
}

// Clear low-res cache (on document close)
export function clearLowResCache() {
  _lowResCache.clear();
}

// Render a single page inside its wrapper (used by lazy rendering)
async function renderContinuousPage(pageNum) {
  if (_renderedPages.has(pageNum)) return;
  _renderedPages.add(pageNum);

  const pageWrapper = document.querySelector(`.page-wrapper[data-page="${pageNum}"]`);
  if (!pageWrapper) return;

  const canvasContainer = pageWrapper.querySelector('.canvas-container-cont');
  if (!canvasContainer) return;

  // Cancel any in-progress render for this page
  if (_continuousRenderTasks.has(pageNum)) {
    try { _continuousRenderTasks.get(pageNum).cancel(); } catch {}
    _continuousRenderTasks.delete(pageNum);
  }

  const doc = state.documents[state.activeDocumentIndex];
  if (!doc || !doc.pdfDoc) return;
  const page = await doc.pdfDoc.getPage(pageNum);
  if (_isStaleDoc(doc)) return; // tab switched while we awaited PDF.js page
  const extraRotation = getPageRotation(pageNum);
  const vpOpts = { scale: doc.scale };
  if (extraRotation) {
    vpOpts.rotation = (page.rotate + extraRotation) % 360;
  }
  const viewport = page.getViewport(vpOpts);

  canvasContainer.style.setProperty('--scale-factor', viewport.scale);
  canvasContainer.style.setProperty('--total-scale-factor', viewport.scale);

  // Reuse existing canvases if available (zoom re-render), or create new ones
  let pdfCanvasEl = canvasContainer.querySelector('.pdf-canvas');
  let annotationCanvasEl = canvasContainer.querySelector('.annotation-canvas');
  let isNewPage = false;

  if (!pdfCanvasEl) {
    isNewPage = true;
    pdfCanvasEl = document.createElement('canvas');
    pdfCanvasEl.className = 'pdf-canvas';
    pdfCanvasEl.dataset.page = pageNum;
    pdfCanvasEl.style.display = 'block';
    pdfCanvasEl.style.background = 'white';
    canvasContainer.appendChild(pdfCanvasEl);

    // Show low-res preview immediately while full render runs in background
    setupCanvasHiDPI(pdfCanvasEl, viewport.width, viewport.height);
    const lowRes = _lowResCache.get(_lowResKey(pageNum));
    if (lowRes) {
      const previewCtx = pdfCanvasEl.getContext('2d');
      previewCtx.drawImage(lowRes.canvas, 0, 0, pdfCanvasEl.width, pdfCanvasEl.height);
    }
  }

  if (!annotationCanvasEl) {
    annotationCanvasEl = document.createElement('canvas');
    annotationCanvasEl.className = 'annotation-canvas';
    annotationCanvasEl.dataset.page = pageNum;
    annotationCanvasEl.style.position = 'absolute';
    annotationCanvasEl.style.top = '0';
    annotationCanvasEl.style.left = '0';
    canvasContainer.appendChild(annotationCanvasEl);
  }

  // Update canvas dimensions for new scale. The annotation canvas may resize
  // immediately (it is redrawn below anyway), but a REUSED pdf-canvas keeps
  // its old bitmap as a CSS-stretched placeholder until the new render lands:
  // resizing a canvas wipes it, and that wipe was exactly the white flash
  // that made zooming in continuous mode unusable.
  setupCanvasHiDPI(annotationCanvasEl, viewport.width, viewport.height);
  if (isNewPage) {
    setupCanvasHiDPI(pdfCanvasEl, viewport.width, viewport.height);
  } else {
    pdfCanvasEl.style.width = Math.floor(viewport.width) + 'px';
    pdfCanvasEl.style.height = Math.floor(viewport.height) + 'px';
  }
  // Cursor is handled centrally by js/ui/cursor.js — no need to set it here.

  // Only editText forces pe:none statically; select uses dynamic fallthrough.
  // See comment near renderer block ~line 455.
  if (state.currentTool === 'editText') {
    annotationCanvasEl.style.zIndex = '2';
    annotationCanvasEl.style.pointerEvents = 'none';
  }

  // RUST-ONLY: continuous-mode page render. Used to dual-fallback to
  // PDF.js — removed per project policy. Rust failure surfaced via console
  // + state.renderEngine = 'ERROR' (the page stays blank rather than
  // showing a slow-rendered PDF.js fallback that hides the actual Rust bug).
  const pdfCtxEl = pdfCanvasEl.getContext('2d');

  if (!isTauri() || !doc.filePath) {
    state.renderEngine = 'UNSUPPORTED';
    console.error(`[render-continuous] HARD ERROR: page ${pageNum} cannot render without Tauri+filePath. NO FALLBACK.`);
    return;
  }

  // ─── PERF FIX #1 + #2 + #3 (BARN measurement scaffold) ───────────────
  //  #1: Drop the DPR multiplier — single-page mode renders at bare
  //      doc.scale and looks fine on 2x DPR displays. Multiplying the
  //      render scale was doing 4x the Rust pixel work per page for
  //      identical visual output.
  //  #2: Reuse the same JS-side ImageBitmap cache that renderPage uses
  //      (_BITMAP_JS_CACHE) so scrolling a page back into view does a
  //      <10ms drawImage instead of a 1.5-3s cold Rust render. Cache key
  //      mirrors the single-page path so a continuous→single switch at
  //      the same scale also hits warm.
  //  #3: Skip the tempfile roundtrip — Rust now returns RGBA bytes
  //      directly via tauri::ipc::Response (see lib.rs render_pdf_page).
  //      The invoke() now resolves to ArrayBuffer/Uint8Array, not a
  //      "path|w|h" string. No more allow_fs_scope + readBinaryFile +
  //      tempfile unlink chain — pure binary IPC.
  //
  // Instrumentation: every console.time/timeEnd is scoped to one render
  // call so DevTools shows you cache-lookup / invoke-render / canvas
  // putImageData / cache-store sub-timings per page. Compare totals
  // before vs after on the BARN Relocation PDF.
  // Bitmap-axis cap: a full-page render at high zoom on a large sheet would
  // blow past canvas limits and memory (A0 at 400% ≈ 19k px wide, 1.5 GB of
  // RGBA). Render at the largest scale that fits the cap and let CSS stretch
  // the bitmap to the logical size — same philosophy as MAX_BITMAP_AXIS_PX in
  // the single-page path. Sharp detail work at high zoom belongs to
  // single-page mode (tiles); continuous trades that for full-document flow.
  const CONT_MAX_AXIS_PX = 4096;
  const _maxViewAxis = Math.max(viewport.width, viewport.height);
  const renderScale = _maxViewAxis > CONT_MAX_AXIS_PX
    ? doc.scale * (CONT_MAX_AXIS_PX / _maxViewAxis)
    : doc.scale;

  const label = `[render p${pageNum} scale ${renderScale.toFixed(2)}]`;
  console.time(label);
  const _jsCacheKey = `${doc.filePath}|${pageNum}|${Math.round(renderScale * 10000)}|${extraRotation || 0}`;
  console.time(label + ' cache-lookup');
  const _cached = _bitmapJSCacheGet(_jsCacheKey);
  console.timeEnd(label + ' cache-lookup');
  if (_cached) {
    console.time(label + ' canvas-draw-cached');
    pdfCanvasEl.width = _cached.w;
    pdfCanvasEl.height = _cached.h;
    // CSS size = logical page size; differs from the backing store when the
    // axis cap reduced renderScale (CSS upscales the capped bitmap).
    pdfCanvasEl.style.width = Math.floor(viewport.width) + 'px';
    pdfCanvasEl.style.height = Math.floor(viewport.height) + 'px';
    pdfCtxEl.drawImage(_cached.bitmap, 0, 0);
    console.timeEnd(label + ' canvas-draw-cached');
    state.renderEngine = 'Raster (PDFium · cached)';
    console.timeEnd(label);
  } else {
    try {
      console.time(label + ' invoke-render');
      const { renderPdfPage } = await import('./engine-router.js');
      const rgbaData = await renderPdfPage({
        path: doc.filePath,
        pageIndex: pageNum - 1,
        scale: renderScale,
        // Pass the user page rotation so PDFium rasterises in the SAME
        // orientation as the wrapper/canvas box (sized from PDF.js's rotated
        // viewport). Omitting it rendered the page un-rotated into a rotated
        // box — the old-orientation remnant of issue #262 in continuous view.
        rotation: extraRotation || 0,
      });
      console.timeEnd(label + ' invoke-render');
      if (_isStaleDoc(doc)) { console.timeEnd(label); return; }
      const _contBytes = rgbaData instanceof Uint8Array ? rgbaData : new Uint8Array(rgbaData);
      if (!_contBytes || _contBytes.length <= 8) {
        state.renderEngine = 'ERROR';
        console.error(`[render-continuous] HARD ERROR: page ${pageNum} Rust returned empty buffer. NO FALLBACK.`);
        console.timeEnd(label);
        return;
      }
      const headerView = new DataView(_contBytes.buffer, _contBytes.byteOffset, 8);
      const rustW = headerView.getUint32(0, true);
      const rustH = headerView.getUint32(4, true);
      const rgba = new Uint8ClampedArray(_contBytes.buffer, _contBytes.byteOffset + 8, _contBytes.length - 8);
      console.time(label + ' canvas-putImageData');
      pdfCanvasEl.width = rustW;
      pdfCanvasEl.height = rustH;
      // CSS size = logical page size (see the cached branch above).
      pdfCanvasEl.style.width = Math.floor(viewport.width) + 'px';
      pdfCanvasEl.style.height = Math.floor(viewport.height) + 'px';
      const imageData = new ImageData(rgba, rustW, rustH);
      pdfCtxEl.putImageData(imageData, 0, 0);
      console.timeEnd(label + ' canvas-putImageData');
      state.renderEngine = 'Raster (PDFium)';
      // Cache the freshly-rendered bitmap (clone the RGBA into its own buffer
      // — the view into _contBytes becomes invalid once that array is GC'd).
      console.time(label + ' cache-store');
      const cacheImageData = new ImageData(new Uint8ClampedArray(rgba), rustW, rustH);
      _bitmapJSCacheSet(_jsCacheKey, cacheImageData);
      console.timeEnd(label + ' cache-store');
      console.timeEnd(label);
    } catch (e) {
      state.renderEngine = 'ERROR';
      console.error(`[render-continuous] HARD ERROR: page ${pageNum} Rust threw. NO FALLBACK.`, e);
      try { console.timeEnd(label); } catch {}
      return;
    }
  }

  // Create text layer
  try {
    await createTextLayer(page, viewport, canvasContainer, pageNum);
  } catch (e) {
    console.warn(`Failed to create text layer for page ${pageNum}:`, e);
  }
  if (_isStaleDoc(doc)) return;

  // Create link layer
  try {
    await createLinkLayer(page, viewport, canvasContainer, pageNum);
  } catch (e) {
    console.warn(`Failed to create link layer for page ${pageNum}:`, e);
  }
  if (_isStaleDoc(doc)) return;

  // Create form layer
  try {
    await createFormLayer(page, viewport, canvasContainer, pageNum);
  } catch (e) {
    console.warn(`Failed to create form layer for page ${pageNum}:`, e);
  }
  if (_isStaleDoc(doc)) return;

  // Re-apply overlay state for newly created form/link layers
  if (state.currentTool === 'select' || state.currentTool === 'editText') {
    canvasContainer.querySelectorAll('.formLayer section, .linkLayer .pdf-link').forEach(el => {
      el.style.pointerEvents = 'none';
    });
  }

  // Render annotations
  const annotationCtxEl = annotationCanvasEl.getContext('2d');
  renderAnnotationsForPage(annotationCtxEl, pageNum, viewport.width, viewport.height);

  // Re-apply search highlights after re-render
  onPageRendered();

  // Setup mouse events only for new pages (not re-renders)
  if (isNewPage) {
    setupContinuousPageEvents(annotationCanvasEl, pageNum);
  }
}

// Re-render only visible pages at new scale (keeps existing DOM structure)
export async function reRenderVisibleContinuousPages() {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc || !doc.pdfDoc) return;
  const scale = doc.scale;

  // Mark all pages as needing re-render at new scale
  _renderedPages.clear();
  _renderedPagesScale = scale;

  // Update wrapper dimensions for new scale without destroying canvases
  const continuousContainer = document.getElementById('continuous-container');
  if (!continuousContainer) return;

  for (const wrapper of continuousContainer.querySelectorAll('.page-wrapper')) {
    const pageNum = parseInt(wrapper.dataset.page, 10);
    if (!pageNum) continue;

    const page = await doc.pdfDoc.getPage(pageNum);
    const extraRotation = getPageRotation(pageNum);
    const vpOpts = { scale };
    if (extraRotation) vpOpts.rotation = (page.rotate + extraRotation) % 360;
    const viewport = page.getViewport(vpOpts);

    // Keep the scale-1 base dims fresh so instant zoom can resize synchronously.
    wrapper.dataset.baseW = viewport.width / scale;
    wrapper.dataset.baseH = viewport.height / scale;

    const cc = wrapper.querySelector('.canvas-container-cont');
    if (cc) {
      cc.style.width = `${viewport.width}px`;
      cc.style.height = `${viewport.height}px`;
    }
  }

  // IntersectionObserver will automatically trigger re-render for visible pages
  // Force a re-check by briefly disconnecting and reconnecting
  if (_continuousObserver) {
    _continuousObserver.disconnect();
    continuousContainer.querySelectorAll('.page-wrapper').forEach(wrapper => {
      _continuousObserver.observe(wrapper);
    });
  }
}

// ─── Continuous mode: zoom + scroll/page sync ───────────────────────────────

// Instant zoom: resize every page's container + its rendered canvases straight
// to the new scale and re-anchor the scroll in the SAME synchronous frame, so
// the page tracks the wheel/button immediately. The crisp Rust re-render is
// debounced (see continuousZoomBy) and swaps in once the gesture settles. The
// old approach awaited a full re-render BEFORE moving the scroll, which made
// the page lurch and lag a notch behind the wheel (schokkerig + vertraging).
function _applyContinuousZoomInstant(oldScale, anchorY = null) {
  const doc = getActiveDocument();
  const container = document.getElementById('pdf-container');
  const cont = document.getElementById('continuous-container');
  if (!doc || !container || !cont || !oldScale) return;
  const newScale = doc.scale;
  const factor = newScale / oldScale;
  const anchor = anchorY != null ? anchorY : container.clientHeight / 2;
  const target = (container.scrollTop + anchor) * factor - anchor;
  cont.querySelectorAll('.page-wrapper').forEach(wrapper => {
    const cc = wrapper.querySelector('.canvas-container-cont');
    if (!cc) return;
    const baseW = parseFloat(wrapper.dataset.baseW);
    const baseH = parseFloat(wrapper.dataset.baseH);
    // Exact size from scale-1 base (no drift); fall back to scaling the current
    // box if base dims are somehow missing.
    const w = (baseW && baseH) ? baseW * newScale : (parseFloat(cc.style.width) || cc.offsetWidth) * factor;
    const h = (baseW && baseH) ? baseH * newScale : (parseFloat(cc.style.height) || cc.offsetHeight) * factor;
    cc.style.width = `${w}px`;
    cc.style.height = `${h}px`;
    // Stretch the already-rendered bitmap(s) to the new box immediately; the
    // debounced re-render replaces them with a crisp render at the new scale.
    cc.querySelectorAll('canvas').forEach(cv => {
      cv.style.width = `${w}px`;
      cv.style.height = `${h}px`;
    });
  });
  container.scrollTop = Math.max(0, target);
}

let _contRerenderTimer = null;

// Core continuous zoom: multiply scale by `factor`, apply the instant visual
// zoom, then debounce the crisp re-render. Anchored at anchorY (px within
// #pdf-container) so content under the cursor stays put.
export function continuousZoomBy(factor, anchorY = null) {
  const doc = getActiveDocument();
  if (!doc || doc.viewMode !== 'continuous' || !factor) return;
  const old = doc.scale;
  let next = Math.min(24, Math.max(0.05, old * factor));
  next = Math.round(next * 1000) / 1000;
  if (next === old) return;
  doc.scale = next;
  _applyContinuousZoomInstant(old, anchorY);
  updateAllStatus(); // zoom % tracks the gesture immediately
  if (_contRerenderTimer) clearTimeout(_contRerenderTimer);
  _contRerenderTimer = setTimeout(() => {
    _contRerenderTimer = null;
    if (getActiveDocument()?.viewMode !== 'continuous') return;
    reRenderVisibleContinuousPages();
  }, 130);
}

// One discrete zoom step (zoom buttons / keyboard) anchored at anchorY.
export function continuousZoomStep(direction, anchorY = null) {
  continuousZoomBy(direction > 0 ? 1.25 : 0.8, anchorY);
}

// While the user scrolls freely, the page whose center sits closest to the
// viewport center becomes doc.currentPage — status bar and thumbnail
// highlight track the scroll just like explicit navigation does.
let _contScrollSyncBound = false;
function _bindContinuousScrollSync() {
  if (_contScrollSyncBound) return;
  const container = document.getElementById('pdf-container');
  if (!container) return;
  _contScrollSyncBound = true;
  let pending = null;
  container.addEventListener('scroll', () => {
    const doc = getActiveDocument();
    // Facing toont één spread zonder scroll-navigatie; scroll mag currentPage
    // (het spread-anker) niet naar de rechterpagina verschuiven, anders breekt
    // vorige/volgende. Daarom hier overslaan.
    if (!doc || doc.viewMode !== 'continuous' || doc.facingSpread) return;
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      _syncCurrentPageFromScroll(container);
    }, 120);
  }, { passive: true });
}

function _syncCurrentPageFromScroll(container) {
  const doc = getActiveDocument();
  if (!doc || doc.viewMode !== 'continuous' || doc.facingSpread) return;
  const box = container.getBoundingClientRect();
  const mid = box.top + box.height / 2;
  let bestPage = null;
  let bestDist = Infinity;
  document.querySelectorAll('#continuous-container .page-wrapper').forEach(w => {
    const r = w.getBoundingClientRect();
    const d = Math.abs((r.top + r.bottom) / 2 - mid);
    if (d < bestDist) {
      bestDist = d;
      bestPage = parseInt(w.dataset.page, 10);
    }
  });
  if (bestPage && doc.currentPage !== bestPage) {
    doc.currentPage = bestPage;
    updateActiveThumbnail();
    updateAllStatus();
  }
}

// Render all pages (continuous mode) — creates placeholders, lazily renders visible pages
export async function renderContinuous(forceRebuild) {
  // Clear search highlights immediately to prevent stale positions during re-render
  clearHighlights();

  const doc = state.documents[state.activeDocumentIndex];
  if (!doc || !doc.pdfDoc) return;
  const pdfDoc = doc.pdfDoc;
  const scale = doc.scale;

  // Install the cross-monitor DPI watcher (issue #263) even when a document is
  // only ever viewed in continuous mode — initViewport (single path) may never
  // run for it. Idempotent: re-arming replaces the previous listener.
  import('./pdf-viewport.js').then(m => m.ensureDprWatcher()).catch(() => {});

  // Continuous mode uses its own per-page canvases inside #continuous-container,
  // not the shared #pdf-canvas. Disable the vector viewport singleton so its
  // RAF loop can't redraw a previously-active single-page document on top of
  // continuous-mode content if the user toggled view modes / switched tabs.
  if (window.__pdfViewport) window.__pdfViewport.active = false;

  const continuousContainer = document.getElementById('continuous-container');

  // Boekweergave (issue #201): sync the spread-layout class + display with
  // the doc flag HERE so every re-render path (zoom, search, tab switch,
  // thin-lines toggle) keeps the book layout without knowing about it.
  continuousContainer.classList.toggle('book-spread', !!doc.bookSpread);
  // Facing (issue #164): één spread naast elkaar, niet-doorlopend. Eigen
  // layout-klasse zodat de left/right-plaatsing per pagina expliciet gaat (zie
  // de wrapper-lus onder) en niet afhangt van de DOM-kindindex zoals book-spread.
  continuousContainer.classList.toggle('facing-spread', !!doc.facingSpread);
  if (continuousContainer.style.display !== 'none') {
    continuousContainer.style.display = (doc.bookSpread || doc.facingSpread) ? 'grid' : 'flex';
  }

  // Cleanup previous observer
  if (_continuousObserver) {
    _continuousObserver.disconnect();
    _continuousObserver = null;
  }
  _renderedPages.clear();
  _renderedPagesScale = scale;

  continuousContainer.innerHTML = '';

  clearTextLayers();
  clearLinkLayers();
  clearFormLayers();

  // Facing-modus bouwt alleen de huidige spread (1-2 pagina's); doorlopend/boek
  // bouwt alle pagina's. doc.currentPage is in facing het spread-anker.
  const _pageList = doc.facingSpread
    ? _spreadPagesFor(_spreadAnchor(doc.currentPage), pdfDoc.numPages)
    : Array.from({ length: pdfDoc.numPages }, (_, i) => i + 1);

  // First pass: create all page wrappers with correct dimensions (no rendering)
  for (const pageNum of _pageList) {
    const page = await pdfDoc.getPage(pageNum);
    if (!doc.pageDims) doc.pageDims = {};
    const [pageX0, pageY0, pageX1, pageY1] = page.view;
    doc.pageDims[pageNum] = {
      widthPt: pageX1 - pageX0,
      heightPt: pageY1 - pageY0,
      rotation: page.rotate || 0,
    };
    const extraRotation = getPageRotation(pageNum);
    const vpOpts = { scale };
    if (extraRotation) {
      vpOpts.rotation = (page.rotate + extraRotation) % 360;
    }
    const viewport = page.getViewport(vpOpts);

    const pageWrapper = document.createElement('div');
    pageWrapper.className = 'page-wrapper';
    pageWrapper.dataset.page = pageNum;
    // Scale-1 base dims so instant zoom can resize synchronously without a
    // per-step getPage() round-trip — see _applyContinuousZoomInstant.
    pageWrapper.dataset.baseW = viewport.width / scale;
    pageWrapper.dataset.baseH = viewport.height / scale;

    // Facing: expliciete kolomplaatsing zodat het paar tegen de rug aansluit,
    // onafhankelijk van hoeveel wrappers er in de DOM staan. Linkerpagina (even)
    // → kolom 1; rechterpagina (oneven) en de alleenstaande pagina 1 → kolom 2.
    if (doc.facingSpread) {
      const rightSide = (pageNum === 1) || (pageNum % 2 === 1);
      pageWrapper.style.gridColumn = rightSide ? '2' : '1';
      pageWrapper.style.justifySelf = rightSide ? 'start' : 'end';
    }

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

  // Belt-and-suspenders: de IntersectionObserver mist soms zijn eerste fire als
  // de container-layout/zichtbaarheid nog niet is uitgekristalliseerd — precies
  // wat gebeurt vlak na een sessie-herstel/paginaherlaad of een moduswissel.
  // Gevolg: de bovenste pagina('s) blijven blanco tot je scrollt. Render daarom
  // expliciet wat er in beeld staat (dezelfde 200px-marge als de observer).
  // Veilig: pagina's die de observer al deed, worden overgeslagen via
  // _renderedPages. Twee pogingen (frame + korte timeout) dekken trage layout.
  const _renderVisibleContinuousNow = () => {
    if (!scrollContainer || getActiveDocument()?.pdfDoc !== pdfDoc) return;
    const contRect = scrollContainer.getBoundingClientRect();
    if (contRect.height === 0) return; // layout nog niet gezet
    continuousContainer.querySelectorAll('.page-wrapper').forEach(wrapper => {
      const pageNum = parseInt(wrapper.dataset.page, 10);
      if (!pageNum || _renderedPages.has(pageNum)) return;
      const r = wrapper.getBoundingClientRect();
      if (r.bottom >= contRect.top - 200 && r.top <= contRect.bottom + 200) {
        renderContinuousPage(pageNum);
      }
    });
  };
  requestAnimationFrame(_renderVisibleContinuousNow);
  setTimeout(_renderVisibleContinuousNow, 150);

  // Keep doc.currentPage in sync with free scrolling (status bar, thumbnails).
  _bindContinuousScrollSync();

  // Fire-and-forget: pre-render low-res previews in background for fast scroll
  // This runs without blocking — pages that scroll into view get full render via observer.
  // Facing toont maar één spread (geen scroll), dus geen zin om alle pagina's te primen.
  if (pdfDoc.numPages > 1 && !doc.facingSpread) {
    (async () => {
      for (let p = 1; p <= Math.min(pdfDoc.numPages, 200); p++) {
        if (_lowResCache.has(_lowResKey(p))) continue;
        try {
          await renderLowResPreview(pdfDoc, p, 0, 0);
        } catch {}
        // Yield to main thread every 5 pages
        if (p % 5 === 0) await new Promise(r => setTimeout(r, 0));
      }
    })();
  }
}

// Setup pointer events for continuous mode pages
function setupContinuousPageEvents(canvas, pageNum) {
  // Store pageNum in dataset for the dispatcher's resolvePointerCoords
  canvas.dataset.page = pageNum;
  // Import event handlers dynamically to avoid circular dependencies
  import('../tools/tool-dispatcher.js').then(({ handlePointerDown, handlePointerMove, handlePointerUp, handleDblClick }) => {
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('dblclick', handleDblClick);
  });
}

// ─── Spread-pariteit (facing/boek) ──────────────────────────────────────────
// Book-conventie: pagina 1 staat alleen (rechts), daarna de paren 2-3, 4-5, …
// De "anker"-pagina van een spread is de LINKERpagina van het paar (even), of
// pagina 1 voor de eerste spread. doc.currentPage bewaart in facing-modus altijd
// dit anker, zodat vorige/volgende deterministisch per spread springen.
function _spreadAnchor(p) {
  if (p <= 1) return 1;
  return (p % 2 === 0) ? p : p - 1; // even = linkerpagina; oneven = rechter → anker links
}
function _spreadPagesFor(anchor, numPages) {
  if (anchor <= 1) return [1];
  const pages = [anchor];
  if (anchor + 1 <= numPages) pages.push(anchor + 1);
  return pages;
}
function _nextSpreadAnchor(anchor, numPages) {
  if (anchor <= 1) return numPages >= 2 ? 2 : 1;
  return anchor + 2 <= numPages ? anchor + 2 : anchor;
}
function _prevSpreadAnchor(anchor) {
  return anchor <= 2 ? 1 : anchor - 2;
}

// Switch view mode
export async function setViewMode(mode) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return;

  // 'book' (boekweergave, issue #201) is a LAYOUT VARIANT of continuous:
  // spreads of two pages side by side with page 1 alone on the right, like
  // a real book. Internally doc.viewMode stays 'continuous' so every
  // existing `viewMode === 'continuous'` branch (redraw dispatch, hit
  // testing, search, clipboard, tools, zoom) keeps working unchanged;
  // the doc.bookSpread flag drives the grid layout in renderContinuous().
  //
  // 'facing' (issue #164, 4e modus) toont ÉÉN spread van twee pagina's naast
  // elkaar tegelijk, NIET-doorlopend: vorige/volgende bladert per spread. Ook
  // dit is intern doc.viewMode='continuous' (zelfde per-pagina-canvas/tekstlaag/
  // tool/hit-test-infrastructuur), maar met doc.facingSpread=true i.p.v.
  // bookSpread — zo licht de doorlopend/boek-knop niet op en bouwt
  // renderContinuous alleen de huidige spread i.p.v. alle pagina's.
  if (mode === 'book') {
    doc.viewMode = 'continuous';
    doc.bookSpread = true;
    doc.facingSpread = false;
  } else if (mode === 'facing') {
    doc.viewMode = 'continuous';
    doc.bookSpread = false;
    doc.facingSpread = true;
    // Normaliseer naar het spread-anker zodat navigatie consistent per spread
    // springt (currentPage = linkerpagina van het huidige paar, of 1).
    doc.currentPage = _spreadAnchor(doc.currentPage);
  } else {
    doc.viewMode = mode;
    doc.facingSpread = false;
    if (mode === 'continuous') doc.bookSpread = false;
  }
  const singleContainer = document.getElementById('canvas-container');
  const continuousContainer = document.getElementById('continuous-container');
  const pdfContainer = document.getElementById('pdf-container');

  if (doc.viewMode === 'single') {
    singleContainer.style.display = 'inline-block';
    continuousContainer.style.display = 'none';
    await renderPage(doc.currentPage);
  } else {
    singleContainer.style.display = 'none';
    continuousContainer.style.display = (doc.bookSpread || doc.facingSpread) ? 'grid' : 'flex';
    // CRUCIAAL: single-/rasterweergave zet #pdf-container inline op
    // `overflow:hidden` (het viewport-singleton bezit dan de pan/zoom).
    // Doorlopende/boekweergave scrollt juist NATIEF via deze container
    // (scrollTop/scrollIntoView/_continuousRezoom). Zonder deze reset blijft
    // de inline `hidden` staan na één single-render en kan de gebruiker niet
    // meer scrollen — alleen de eerste pagina('s) zijn zichtbaar. Terug naar
    // '' laat de CSS-regel (.main-view > #pdf-container.visible { overflow:auto })
    // het weer overnemen.
    if (pdfContainer) pdfContainer.style.overflow = '';
    await renderContinuous();
    // Stay on the page the user was reading — the rebuild starts at page 1.
    const wrapper = continuousContainer.querySelector(`.page-wrapper[data-page="${doc.currentPage}"]`);
    if (wrapper) wrapper.scrollIntoView({ block: 'start' });
  }
}

// ─── Adjacent-page prefetch (idle-gated) ────────────────────────────────────
// The original prefetchAdjacentPages was removed (see the renderPage() note)
// because it ran unconditionally and starved visible-thumbnail generation —
// Rust backend contention that froze the app on large files. This version only
// fires after a navigation settles AND the pipeline is genuinely idle, and it
// aborts the instant the user navigates again. It primes the NEXT page's vector
// draw-commands into the same cache renderPage() reads (vr.hasCachedCommands),
// so sequential paging becomes a cache hit instead of a cold Rust extract.
let _prefetchTimer = null;
const PREFETCH_DELAY_MS = 600;       // settle window after a navigation
const PREFETCH_RETRY_MS = 400;       // re-poll cadence while waiting for idle
const PREFETCH_MAX_WAIT_MS = 4000;   // give up after this — never busy-loop

export function schedulePrefetch(centerPage) {
  if (_prefetchTimer) clearTimeout(_prefetchTimer);
  _prefetchTimer = setTimeout(() => { _prefetchTimer = null; _runPrefetch(centerPage, 0); }, PREFETCH_DELAY_MS);
}

// The active doc IFF the user is still parked on `centerPage` (else navigation
// moved on and this prefetch is stale).
function _prefetchDocIfStill(centerPage) {
  const doc = getActiveDocument();
  return doc && doc.pdfDoc && doc.currentPage === centerPage ? doc : null;
}

async function _runPrefetch(centerPage, waited) {
  const doc = _prefetchDocIfStill(centerPage);
  if (!doc) return; // user navigated — the new nav scheduled its own prefetch
  // Don't compete with a foreground render or with visible-thumbnail work.
  // Re-poll for a bounded window (timer-based, never a busy loop), then give up.
  if ((window.__pdfRenderInFlight || 0) > 0 || !isThumbnailPipelineIdle()) {
    if (waited >= PREFETCH_MAX_WAIT_MS) return;
    _prefetchTimer = setTimeout(
      () => { _prefetchTimer = null; _runPrefetch(centerPage, waited + PREFETCH_RETRY_MS); },
      PREFETCH_RETRY_MS,
    );
    return;
  }
  // Forward first (normal reading direction), then backward.
  const targets = [];
  if (centerPage + 1 <= doc.pdfDoc.numPages) targets.push(centerPage + 1);
  if (centerPage - 1 >= 1) targets.push(centerPage - 1);
  for (const pn of targets) {
    if (!_prefetchDocIfStill(centerPage)) return; // user moved — stop starting new IPC
    if (!isThumbnailPipelineIdle()) return;       // visible thumbnails resumed — yield
    try { await _prefetchOnePage(doc, pn, centerPage); }
    catch { /* best-effort: a failed prefetch just means the next nav renders cold */ }
  }
}

// Cache-only mirror of renderPage()'s cold vector path: analyze → extract →
// prepareImages. Never touches #pdf-canvas or the viewport singleton.
async function _prefetchOnePage(doc, pageNum, centerPage) {
  if (!isTauri() || !doc.filePath) return;
  if (state.renderEngineOverride != null) return; // user forced a raster engine
  const rotation = getPageRotation(pageNum);
  const vr = await import('./vector-renderer.js');
  if (vr.hasCachedCommands(doc.filePath, pageNum, rotation)) return; // already primed
  const ptcMod = await import('./page-type-cache.js');
  let pageType = ptcMod.getCachedPageType(doc.filePath, pageNum - 1);
  if (!pageType) {
    pageType = await invoke('analyze_page_type', { path: doc.filePath, pageIndex: pageNum - 1 });
    ptcMod.cachePageType(doc.filePath, pageNum - 1, pageType);
  }
  if (pageType !== 'vector') return; // raster pages aren't command-cached
  if (!_prefetchDocIfStill(centerPage)) return;
  const cmdData = await invoke('extract_draw_commands', { path: doc.filePath, pageIndex: pageNum - 1, rotation });
  const cmdBytes = cmdData instanceof Uint8Array ? cmdData : new Uint8Array(cmdData);
  vr.cacheCommands(doc.filePath, pageNum, cmdBytes, rotation);
  if (!_prefetchDocIfStill(centerPage)) return;
  await vr.prepareImages(doc.filePath, pageNum, rotation);
  console.log(`[prefetch] primed page ${pageNum}`);
}

// Go to specific page
export async function goToPage(pageNum) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return;

  if (pageNum < 1) pageNum = 1;
  if (pageNum > doc.pdfDoc.numPages) pageNum = doc.pdfDoc.numPages;

  // Facing-modus (issue #164): niet-doorlopend, navigeert per SPREAD van twee
  // pagina's. Alle bestaande navigatie (statusbalk, ribbon, toetsen, thumbnails,
  // links) loopt via goToPage(currentPage ± 1) / goToPage(n); hier vertalen we
  // die naar spread-stappen zodat élke aanroeper vanzelf per spread bladert.
  if (doc.facingSpread) {
    const numPages = doc.pdfDoc.numPages;
    const curAnchor = _spreadAnchor(doc.currentPage);
    let targetAnchor = _spreadAnchor(pageNum);
    // Een vorige/volgende-knop levert currentPage ± 1: dat landt op de zíjpagina
    // van de huidige spread (zelfde anker). Dat interpreteren we als "spring een
    // hele spread in die richting".
    if (targetAnchor === curAnchor && pageNum !== curAnchor) {
      targetAnchor = pageNum > curAnchor
        ? _nextSpreadAnchor(curAnchor, numPages)
        : _prevSpreadAnchor(curAnchor);
    }
    doc.currentPage = targetAnchor;
    hideProperties();
    await renderContinuous();
    updateActiveThumbnail();
    updateAllStatus();
    return;
  }

  if (doc) doc.currentPage = pageNum;
  hideProperties();

  if (doc?.viewMode === 'single') {
    // Instant feedback: blit the page's cached thumbnail as a placeholder over
    // the canvas so the switch feels immediate even while the (possibly cold)
    // render runs. Hidden one frame after renderPage() resolves, so the crisp
    // page has painted underneath. No-op if the thumbnail isn't cached yet.
    const _phGen = showPagePlaceholder(pageNum);
    try {
      await renderPage(pageNum);
    } finally {
      // Keep the placeholder up until the real page content has painted (raster
      // bitmaps fill asynchronously after renderPage resolves) — avoids a blank
      // flash between hiding the thumbnail and the bitmap landing.
      hidePagePlaceholderWhenReady(_phGen);
    }
    const pdfContainer = document.getElementById('pdf-container');
    if (pdfContainer) {
      pdfContainer.scrollTop = 0;
    }
    // Prime the neighbouring pages while the backend is idle so the next
    // sequential nav is a cache hit (skips the cold Rust extract).
    schedulePrefetch(pageNum);
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

// Zoom controls.
//
// In vector viewport mode (the modern path) the truth is `viewport.zoom`,
// not `doc.scale` — `_render()` overwrites `doc.scale = viewport.zoom`
// every frame, so any function that mutates `doc.scale` and then re-renders
// via the legacy PDF.js path will have its change immediately stomped.
// We must therefore mutate the viewport directly when it's active, and
// only fall back to the legacy `doc.scale` path otherwise.
export async function zoomIn() {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc) return;
  const vp = window.__pdfViewport;
  // Only delegate to vector viewport if the ACTIVE doc actually uses it.
  // Blank docs (filePath===null) are rendered via PDF.js / legacy path
  // — vp.active may still be true from a previously-opened PDF, but
  // zoomStepAtCenter would mutate that stale page's zoom, not the blank
  // doc's doc.scale → button appears dead from the user's perspective.
  if (vp && vp.active && doc.filePath) {
    const m = await import('./pdf-viewport.js');
    m.zoomStepAtCenter(+1);
    return;
  }
  if (doc.viewMode === 'continuous') {
    await continuousZoomStep(+1);
    return;
  }
  doc.scale += 0.25;
  await renderPage(doc.currentPage);
}

export async function zoomOut() {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc) return;
  const vp = window.__pdfViewport;
  // Same blank-doc guard as zoomIn() — see comment there.
  if (vp && vp.active && doc.filePath) {
    const m = await import('./pdf-viewport.js');
    m.zoomStepAtCenter(-1);
    return;
  }
  if (doc.viewMode === 'continuous') {
    await continuousZoomStep(-1);
    return;
  }
  // Allow zooming out to 0.05 (5 %) for huge blank pages — A0 (2384×3370 pt)
  // at 0.05 = 119×169 px which fits any reasonable viewport with margin.
  // Floor of 0.1 was visible to the user as "kan niet zo ver uitzoomen om
  // het hele tekeningkader te zien" on A2/A1/A0 blank docs that bypass
  // the vector viewport (filePath===null skips the viewport singleton).
  if (doc.scale > 0.05) {
    if (doc.scale <= 0.2) doc.scale = Math.max(0.05, doc.scale - 0.025);
    else if (doc.scale <= 0.5) doc.scale = Math.max(0.05, doc.scale - 0.1);
    else doc.scale -= 0.25;
    await renderPage(doc.currentPage);
  }
}

export async function setZoom(newScale) {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc) return;
  const vp = window.__pdfViewport;
  // Same blank-doc guard as zoomIn() — see comment there.
  if (vp && vp.active && doc.filePath) {
    // Set absolute zoom anchored at the canvas center (CSS pixels — the
    // backing store is dpr-scaled and would mis-centre on 125%/150%).
    const pdfCanvas = document.getElementById('pdf-canvas');
    if (pdfCanvas) {
      const m = await import('./pdf-viewport.js');
      const dpr = window.devicePixelRatio || 1;
      m.setZoomAtPoint(pdfCanvas.width / dpr / 2, pdfCanvas.height / dpr / 2, newScale);
    }
    return;
  }
  if (doc.viewMode === 'continuous') {
    const _old = doc.scale;
    doc.scale = newScale;
    await _continuousRezoom(_old);
    return;
  }
  doc.scale = newScale;
  await renderPage(doc.currentPage);
}

// Helper: pick the right (pageW, pageH, canvasW, canvasH) tuple for the
// current rendering mode and return them. Vector viewport reads from the
// singleton; legacy mode reads PDF.js viewport + #pdf-container.
//
// Returns null if the rendering mode can't compute fit yet (no viewport or
// no page loaded).
async function _getFitInputs() {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc || !doc.pdfDoc) return null;

  const vp = window.__pdfViewport;
  // Same blank-doc guard as zoomIn() — see comment there.
  if (vp && vp.active && doc.filePath) {
    const pdfCanvas = document.getElementById('pdf-canvas');
    if (!pdfCanvas) return null;
    // CSS pixels, NOT the dpr-scaled backing store: viewport zoom/offset are
    // CSS-based, so fitting against canvas.width/height makes every fit dpr×
    // too large (page sticks out of view on 125%/150% Windows scaling —
    // most visible on tall A1/A0 sheets).
    const dpr = window.devicePixelRatio || 1;
    return {
      mode: 'vector',
      pageW: vp.pageW,
      pageH: vp.pageH,
      canvasW: pdfCanvas.width / dpr,
      canvasH: pdfCanvas.height / dpr,
      pdfCanvas,
    };
  }

  // Legacy mode — read dimensions from PDF.js viewport + container.
  const page = await doc.pdfDoc.getPage(doc.currentPage);
  const extraRot = getPageRotation(doc.currentPage);
  const opts = { scale: 1 };
  if (extraRot) opts.rotation = (page.rotate + extraRot) % 360;
  const pageViewport = page.getViewport(opts);
  const container = document.getElementById('pdf-container');
  if (!container) return null;
  return {
    mode: 'legacy',
    pageW: pageViewport.width,
    pageH: pageViewport.height,
    canvasW: container.clientWidth,
    canvasH: container.clientHeight,
    doc,
  };
}

// Apply a computed zoom value, dispatching to the right renderer for the
// active mode. Centralized so fitWidth/fitPage/setZoom all share the same
// "now actually use this zoom value" code path.
async function _applyZoom(fitInputs, newZoom) {
  if (fitInputs.mode === 'vector') {
    const m = await import('./pdf-viewport.js');
    m.setZoomAtPoint(fitInputs.canvasW / 2, fitInputs.canvasH / 2, newZoom);
    return;
  }
  // Legacy
  const doc = fitInputs.doc;
  if (doc.viewMode === 'continuous') {
    const _old = doc.scale;
    doc.scale = newZoom;
    await _continuousRezoom(_old);
    return;
  }
  doc.scale = newZoom;
  await renderPage(doc.currentPage);
}

export async function fitWidth() {
  const fit = await _getFitInputs();
  if (!fit) return;
  const { computeFitZoom } = await import('./pdf-viewport.js');
  const newZoom = computeFitZoom('width', fit.pageW, fit.pageH, fit.canvasW, fit.canvasH, 0);
  await _applyZoom(fit, newZoom);
}

export async function fitPage() {
  const fit = await _getFitInputs();
  if (!fit) return;
  const { computeFitZoom } = await import('./pdf-viewport.js');
  const newZoom = computeFitZoom('page', fit.pageW, fit.pageH, fit.canvasW, fit.canvasH, 0);
  await _applyZoom(fit, newZoom);
}

export async function actualSize() {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc) return;

  // Vector viewport mode: 100% = 1.0 zoom, anchored at canvas center.
  // This makes 1 PDF point = 1 CSS pixel, the standard "Actual Size"
  // interpretation.
  const vp = window.__pdfViewport;
  // Same blank-doc guard as zoomIn() — see comment there.
  if (vp && vp.active && doc.filePath) {
    const pdfCanvas = document.getElementById('pdf-canvas');
    if (!pdfCanvas) return;
    const m = await import('./pdf-viewport.js');
    // Anchor in CSS pixels (same unit as zoomStepAtCenter) — the backing
    // store is dpr-scaled and would mis-centre on 125%/150% displays.
    const dpr = window.devicePixelRatio || 1;
    m.setZoomAtPoint(pdfCanvas.width / dpr / 2, pdfCanvas.height / dpr / 2, 1.0);
    return;
  }

  if (doc.viewMode === 'continuous' && doc.pdfDoc) {
    const _old = doc.scale;
    doc.scale = 1;
    await _continuousRezoom(_old);
    return;
  }
  doc.scale = 1;
  if (doc.pdfDoc) {
    await renderPage(doc.currentPage);
  }
}

// Rotate the current page by a delta (±90)
// ─── Annotation coordinate transforms for page rotation ─────────────────────

function rotatePoint(px, py, normDelta, oldW, oldH) {
  switch (normDelta) {
    case 90:  return { x: oldH - py, y: px };
    case 270: return { x: py, y: oldW - px };
    case 180: return { x: oldW - px, y: oldH - py };
    default:  return { x: px, y: py };
  }
}

function rotateRect(x, y, w, h, normDelta, oldW, oldH) {
  switch (normDelta) {
    case 90:  return { x: oldH - y - h, y: x, width: h, height: w };
    case 270: return { x: y, y: oldW - x - w, width: h, height: w };
    case 180: return { x: oldW - x - w, y: oldH - y - h, width: w, height: h };
    default:  return { x, y, width: w, height: h };
  }
}

function recalcBoundsFromPoints(ann, pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  ann.x = minX; ann.y = minY;
  ann.width = maxX - minX; ann.height = maxY - minY;
}

function rotateAnnotation(ann, normDelta, oldW, oldH) {
  if (normDelta === 0) return;
  let boundsHandled = false;

  // Path-based (draw/freehand)
  if (ann.path && ann.path.length > 0) {
    ann.path = ann.path.map(p => rotatePoint(p.x, p.y, normDelta, oldW, oldH));
    recalcBoundsFromPoints(ann, ann.path);
    boundsHandled = true;
  }

  // Points-based (polygon, polyline, cloud, measureArea, measurePerimeter)
  if (ann.points && ann.points.length > 0) {
    ann.points = ann.points.map(p => rotatePoint(p.x, p.y, normDelta, oldW, oldH));
    recalcBoundsFromPoints(ann, ann.points);
    boundsHandled = true;
  }

  // Line endpoints (line, arrow, measureDistance)
  if (ann.startX != null && ann.startY != null && ann.endX != null && ann.endY != null) {
    const s = rotatePoint(ann.startX, ann.startY, normDelta, oldW, oldH);
    const e = rotatePoint(ann.endX, ann.endY, normDelta, oldW, oldH);
    ann.startX = s.x; ann.startY = s.y;
    ann.endX = e.x; ann.endY = e.y;
    ann.x = Math.min(s.x, e.x); ann.y = Math.min(s.y, e.y);
    ann.width = Math.abs(e.x - s.x); ann.height = Math.abs(e.y - s.y);
    boundsHandled = true;
  }

  // MeasureDistance leader lines
  if (ann.leaderStartX != null && ann.leaderStartY != null) {
    const ls = rotatePoint(ann.leaderStartX, ann.leaderStartY, normDelta, oldW, oldH);
    ann.leaderStartX = ls.x; ann.leaderStartY = ls.y;
  }
  if (ann.leaderEndX != null && ann.leaderEndY != null) {
    const le = rotatePoint(ann.leaderEndX, ann.leaderEndY, normDelta, oldW, oldH);
    ann.leaderEndX = le.x; ann.leaderEndY = le.y;
  }
  // MeasureDistance text offset is a VECTOR (relative to the line midpoint):
  // rotate it with the linear part of the page rotation only (no translation).
  if (ann.textOffsetX != null || ann.textOffsetY != null) {
    const tox = ann.textOffsetX || 0;
    const toy = ann.textOffsetY || 0;
    switch (normDelta) {
      case 90:  ann.textOffsetX = -toy; ann.textOffsetY = tox; break;
      case 270: ann.textOffsetX = toy;  ann.textOffsetY = -tox; break;
      case 180: ann.textOffsetX = -tox; ann.textOffsetY = -toy; break;
    }
  }

  // Callout arrow/knee/armOrigin points
  if (ann.arrowX != null && ann.arrowY != null) {
    const a = rotatePoint(ann.arrowX, ann.arrowY, normDelta, oldW, oldH);
    ann.arrowX = a.x; ann.arrowY = a.y;
  }
  if (ann.kneeX != null && ann.kneeY != null) {
    const k = rotatePoint(ann.kneeX, ann.kneeY, normDelta, oldW, oldH);
    ann.kneeX = k.x; ann.kneeY = k.y;
  }
  if (ann.armOriginX != null && ann.armOriginY != null) {
    const ao = rotatePoint(ann.armOriginX, ann.armOriginY, normDelta, oldW, oldH);
    ann.armOriginX = ao.x; ann.armOriginY = ao.y;
  }

  // Text markup rects (textHighlight, textStrikethrough, textUnderline)
  if (ann.rects && ann.rects.length > 0) {
    ann.rects = ann.rects.map(r => rotateRect(r.x, r.y, r.width, r.height, normDelta, oldW, oldH));
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const r of ann.rects) {
      if (r.x < minX) minX = r.x;
      if (r.y < minY) minY = r.y;
      if (r.x + r.width > maxX) maxX = r.x + r.width;
      if (r.y + r.height > maxY) maxY = r.y + r.height;
    }
    ann.x = minX; ann.y = minY;
    ann.width = maxX - minX; ann.height = maxY - minY;
    boundsHandled = true;
  }

  // Visual-content annotations: rotate center, keep w/h, add rotation property
  const visualTypes = new Set(['text', 'textbox', 'callout', 'stamp', 'image', 'signature']);
  if (!boundsHandled && visualTypes.has(ann.type) && ann.x != null && ann.y != null && ann.width != null && ann.height != null) {
    const cx = ann.x + ann.width / 2;
    const cy = ann.y + ann.height / 2;
    const rc = rotatePoint(cx, cy, normDelta, oldW, oldH);
    ann.x = rc.x - ann.width / 2;
    ann.y = rc.y - ann.height / 2;
    ann.rotation = ((ann.rotation || 0) + normDelta) % 360;
    boundsHandled = true;
  }

  // Bounding box for rect-only annotations (box, circle, highlight, etc.)
  if (!boundsHandled && ann.x != null && ann.y != null) {
    if (ann.width != null && ann.height != null) {
      const nr = rotateRect(ann.x, ann.y, ann.width, ann.height, normDelta, oldW, oldH);
      ann.x = nr.x; ann.y = nr.y; ann.width = nr.width; ann.height = nr.height;
    } else {
      const p = rotatePoint(ann.x, ann.y, normDelta, oldW, oldH);
      ann.x = p.x; ann.y = p.y;
    }
  }
}

function rotateAnnotationsForPage(pageNum, normDelta, oldW, oldH) {
  const doc = getActiveDocument();
  if (!doc) return;
  const annotations = doc.annotations;
  if (!annotations || annotations.length === 0) return;
  for (const ann of annotations) {
    if (ann.page === pageNum) {
      rotateAnnotation(ann, normDelta, oldW, oldH);
    }
  }
}

export async function rotatePage(delta, targetPage) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return;
  const pageNum = targetPage || doc.currentPage;
  const current = getPageRotation(pageNum);

  // Get old viewport dimensions (at current rotation) for annotation transform
  const page = await doc.pdfDoc.getPage(pageNum);
  const oldViewport = page.getViewport({ scale: 1, rotation: (page.rotate + current) % 360 });
  const normDelta = ((delta % 360) + 360) % 360;

  // Transform annotation coordinates to match new rotation
  rotateAnnotationsForPage(pageNum, normDelta, oldViewport.width, oldViewport.height);

  setPageRotation(pageNum, current + delta);

  // Mark document as modified
  if (doc) doc.modified = true;

  // Re-render
  if (doc?.viewMode === 'continuous') {
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
  import('./mupdf-renderer.js').then(m => m.closeDocument());
  const pdfCanvas = getPdfCanvas();
  const annotationCanvas = getAnnotationCanvas();
  if (!pdfCanvas || !annotationCanvas) return;

  // Deactivate vector viewport so its RAF loop stops redrawing the last
  // viewed document on the now-empty canvas.
  if (window.__pdfViewport) window.__pdfViewport.active = false;

  // Clear single page mode canvases
  const pdfCtx = pdfCanvas.getContext('2d');
  pdfCtx.clearRect(0, 0, pdfCanvas.width, pdfCanvas.height);
  const annotationCtx = annotationCanvas.getContext('2d');
  annotationCtx.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);

  // Clear caches
  _lowResCache.clear();
  _renderedPages.clear();
  _renderedPagesScale = null;

  // Clear continuous mode container
  const continuousContainer = document.getElementById('continuous-container');
  if (continuousContainer) {
    continuousContainer.innerHTML = '';
  }

  // Clear PDF vector snap cache
  clearPdfVectorCache();

  // Clear high-res page bitmap cache
  import('./page-bitmap-cache.js').then(m => m.clearAllBitmaps()).catch(() => {});

  // Clear element detection cache
  clearDetectionCache();

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

// ─── Self-test: call from DevTools console with window.__testRender() ──────
// Tests the full rendering pipeline and reports what engine is used.
if (typeof window !== 'undefined') {
  window.__testRender = async function(filePath) {
    const testPath = filePath || String.raw`C:\3BM\50_projecten\3_3BM_bouwtechniek\3059 Woonhuis Benedenkerkseweg 87 Stolwijk\20_post_IN\01 27-03-2026 beginstukken\begane grond do 3 constructie verwerkt_50.pdf`;
    console.log('=== Render Self-Test ===');
    console.log('Path:', testPath);
    console.log('isTauri():', isTauri());

    // Step 1: Test Rust render command directly
    if (isTauri()) {
      try {
        console.log('Testing invoke("render_pdf_page")...');
        const t0 = performance.now();
        const result = await invoke('render_pdf_page', { path: testPath, pageIndex: 0, scale: 1.5 });
        const elapsed = Math.round(performance.now() - t0);
        if (result && result.length > 8) {
          // Parse 8-byte header: width (u32 LE) + height (u32 LE)
          const hdr = new DataView(result.buffer, result.byteOffset, 8);
          const w = hdr.getUint32(0, true);
          const h = hdr.getUint32(4, true);
          const rgbaLen = result.length - 8;
          console.log(`✅ Rust render: ${w}x${h}, ${rgbaLen} bytes (${rgbaLen === w*h*4 ? 'size OK' : 'SIZE MISMATCH'}), ${elapsed}ms`);

          // Draw to canvas to verify
          const canvas = document.getElementById('pdf-canvas');
          if (canvas && w * h * 4 === rgbaLen) {
            canvas.width = w;
            canvas.height = h;
            canvas.style.width = Math.floor(w / (window.devicePixelRatio || 1)) + 'px';
            canvas.style.height = Math.floor(h / (window.devicePixelRatio || 1)) + 'px';
            const rgba = result.slice(8);
            const imgData = new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), w, h);
            canvas.getContext('2d').putImageData(imgData, 0, 0);
            document.getElementById('placeholder')?.style.setProperty('display', 'none');
            document.getElementById('pdf-container')?.classList.add('visible');
            console.log('✅ Drawn to canvas');
          }
        } else {
          console.log('❌ Rust render returned empty or too small:', result?.length);
        }
      } catch (e) {
        console.log('❌ Rust render error:', e);
      }
    } else {
      console.log('⚠️ Not in Tauri — Rust render unavailable, PDF.js will be used');
    }

    // Step 2: Test via the full renderPage pipeline
    const doc = getActiveDocument();
    if (doc) {
      console.log('Active doc:', doc.filePath, 'page:', doc.currentPage, 'scale:', doc.scale);
      console.log('Calling renderPage()...');
      const t0 = performance.now();
      await renderPage(doc.currentPage || 1);
      console.log(`renderPage() total: ${Math.round(performance.now() - t0)}ms`);
    } else {
      console.log('No active document. Open a PDF first, then run __testRender() again.');
    }
    console.log('=== End Self-Test ===');
  };

  window.__testRustDirect = async function(filePath) {
    const testPath = filePath || String.raw`C:\3BM\50_projecten\3_3BM_bouwtechniek\3059 Woonhuis Benedenkerkseweg 87 Stolwijk\20_post_IN\01 27-03-2026 beginstukken\begane grond do 3 constructie verwerkt_50.pdf`;
    if (!isTauri()) { console.log('Not in Tauri'); return; }
    try {
      console.log('Invoking render_pdf_page directly...');
      const t0 = performance.now();
      const rgba = await invoke('render_pdf_page', { path: testPath, pageIndex: 0, scale: 1.5 });
      const elapsed = Math.round(performance.now() - t0);
      console.log(`Result: ${rgba?.length || 0} bytes in ${elapsed}ms`);
      if (rgba && rgba.length > 8) {
        // Parse 8-byte header: width (u32 LE) + height (u32 LE)
        const hdr = new DataView(rgba.buffer, rgba.byteOffset, 8);
        const w = hdr.getUint32(0, true);
        const h = hdr.getUint32(4, true);
        const pixels = new Uint8ClampedArray(rgba.buffer, rgba.byteOffset + 8, rgba.length - 8);
        console.log(`Dimensions: ${w}x${h}, RGBA: ${pixels.length} bytes`);
        const canvas = document.getElementById('pdf-canvas');
        if (canvas && w * h * 4 === pixels.length) {
          canvas.width = w;
          canvas.height = h;
          canvas.style.width = (w / (window.devicePixelRatio || 1)) + 'px';
          canvas.style.height = (h / (window.devicePixelRatio || 1)) + 'px';
          const imgData = new ImageData(pixels, w, h);
          canvas.getContext('2d').putImageData(imgData, 0, 0);
          document.getElementById('placeholder')?.style.setProperty('display', 'none');
          document.getElementById('pdf-container')?.classList.add('visible');
          console.log(`Drawn to canvas: ${w}x${h}`);
        }
      }
    } catch (e) {
      console.log('❌ Error:', e);
    }
  };
}
