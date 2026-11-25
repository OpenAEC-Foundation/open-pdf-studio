import { renderPdfJsCanvas } from './pdfjs-canvas-render.js';
import { paginaViewport } from './pagina-viewport.js';
import { meld as meldSplit } from './split-view/split-haken.js';
import { cssPxPerPtAt100, nextScaleStep } from '../core/zoom-display.js';
import { state, getActiveDocument, getPageRotation, setPageRotation } from '../core/state.js';
import { isTauri, isMobile, heeftRustRenderer, invoke } from '../core/platform.js';
import { pdfjsFallbackNodig } from './render-route.js';
import { bepaalOverlayMaat, pasOverlayMaatToe } from './overlay-canvas-size.js';
import { paginaGetekend } from './pagina-getekend.js';
import { hideLoading } from '../ui/chrome/dialogs.js';
// Always-fresh DOM refs (never stale regardless of init timing or bundler behavior)
function getPdfCanvas() { return document.getElementById('pdf-canvas'); }
function getAnnotationCanvas() { return document.getElementById('annotation-canvas'); }
import { redrawAnnotations, renderAnnotationsForPage, updateContinuousSharpOverlay, updateAllContinuousSharpOverlays, tekenTekstBewerkingenOpPagina } from '../annotations/rendering.js';
import { ensureAnnotationsForPage, hidePdfABar } from './loader.js';
import { updateAllStatus } from '../ui/chrome/status-bar.js';
import { hideProperties } from '../ui/panels/properties-panel.js';
import { updateActiveThumbnail, pauseThumbnails, resumeThumbnails } from '../ui/panels/left-panel.js';
import { createSinglePageTextLayer, clearSinglePageTextLayer, createTextLayer, clearTextLayers } from '../text/text-layer.js';
import { createSinglePageLinkLayer, clearSinglePageLinkLayer, createLinkLayer, clearLinkLayers, applyOverlayPointerEvents } from './link-layer.js';
import { pasCanvasLagenToe, pasGereedschapLagenToe } from '../tools/gereedschap-lagen.js';
import { createSinglePageFormLayer, clearSinglePageFormLayer, createFormLayer, clearFormLayers, hideFormFieldsBar } from './form-layer.js';
import { clearPdfVectorCache, prefetchPdfVectorGeometry } from '../tools/pdf-snap-extractor.js';
import { clearDetectionCache } from '../tools/pdf-element-detector.js';
import { onPageRendered, clearHighlights } from '../search/find-bar.js';
import { anchorScrollCorrection, pickAnchorPageIndex } from './continuous-zoom-anchor.js';
import { createRerenderGate } from './continuous-rerender-gate.js';
import { continuousRenderScale } from './continuous-render-scale.js';
import { eenmaalPerElement } from './doorlopend-pagina-events.js';
import { weergaveRotatie, weergaveTransform } from './weergave-ruimte.js';
import { normaliseerRotatie, isKwartslag } from './weergave-rotatie.js';
import { voorvertoningSleutel, voorvertoningRotatie, maakVoorvertoningLus } from './voorvertoning-sleutel.js';
import { rotateTextDir } from '../annotations/corrections/geometry.js';
import { isTextAnchored } from '../annotations/corrections/model.js';
import { stopAlleWielScrollers } from './wiel-scroll.js';
import { scrollGedrag } from '../core/vloeiend-scrollen.js';
import { werkelijkeGrootteZoom, kalibratieVoor } from './schermkalibratie.js';
import { thinLinesKey, thinLinesOn } from './thin-lines.js';
import { isRenderCancelled } from './render-queue.js';
import { voerZoomAllesUit, centreerCorrectie } from './zoom-alles.js';
import { annotatieUitsnede, naScrollen } from './annotatie-uitsnede.js';
import {
  scherpeUitsnedeNodig, zichtbaarDeel, scherpeUitsnede, uitsnedeVolstaat, uitsnedeAanvraag,
  draaiTransform, schaalUitsnede, beeldPastBijAanvraag, uitsnedeSleutel, achtergrondMaat, overlapOppervlak,
} from './doorlopend-scherp.js';
import { effectiveBlendMode, isGemengd } from '../annotations/blend-modes.js';
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
  // De achtergrondbeelden van de scherpe uitsnedes (#1163) tonen dezelfde pixels.
  _vergeetAchtergronden(filePath + '|');
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
  _vergeetAchtergronden();
}

// NOTE: an earlier prototype embedded MuPDF WASM rendering helpers here
// (loadMupdf / isMupdfAvailable / getMupdfDocument / renderPageWithMupdf).
// They were never wired up — pages render through the PDFium worker pool,
// with PDF.js where there is no backend. The unused helpers have been removed.
// `mupdf-renderer.js` is still imported once below for `closeDocument()`
// cleanup (no-op when the runtime never loaded the WASM module).

function setupCanvasHiDPI(canvas, width, height) {
  const dpr = getCanvasDPR();
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = Math.floor(width) + 'px';
  canvas.style.height = Math.floor(height) + 'px';
}

// Bitmap-axis cap voor de doorlopende weergave (zie renderContinuousPage):
// render op de grootste schaal die binnen de cap past en laat CSS rekken.
const CONT_MAX_AXIS_PX = 4096;

// Annotatiecanvas van één doorlopende pagina, met gecapte backing store.
// Ongecapt groeit hij mee met paginamaat × dpr en sterft hij boven de
// browserlimieten (as > 32767 of oppervlak > ~268M pixels — op een groot vel
// al rond 700% zoom): het canvas tekent dan stilletjes niets meer en alle
// annotaties verdwijnen. Zelfde as-cap als de paginabitmap; CSS rekt de rest.
// De werkelijke backing-schaal gaat als overrideDpr naar
// renderAnnotationsForPage zodat de tekening exact op de store past.
// Het annotatiecanvas dekt in de doorlopende weergave alleen de ZICHTBARE
// uitsnede van de pagina (plus een marge), op volle resolutie — zoals het
// enkelpagina-pad. Daarmee is het altijd scherp op elk zoomniveau, blijft de
// backing store klein (viewport-orde) en komen er geen extra lagen bij.
// De uitsnede (clipX/clipY, CSS-px pagina-relatief) reist mee via dataset;
// alle tekenroutes geven hem als renderOffset door en alle
// coordinaatberekeningen meten tegen de paginacontainer
// (.canvas-container-cont), niet tegen dit canvas.
function setupContinuousAnnotationCanvas(canvas, width, height) {
  const dpr = getCanvasDPR();
  const container = document.getElementById('pdf-container');
  const cc = canvas.parentElement;
  const u = (container && cc)
    ? annotatieUitsnede(container.getBoundingClientRect(), cc.getBoundingClientRect(), width, height)
    : { x: 0, y: 0, breedte: width, hoogte: height };
  const clipX = u.x, clipY = u.y, clipW = u.breedte, clipH = u.hoogte;
  canvas.width = Math.max(1, Math.floor(clipW * dpr));
  canvas.height = Math.max(1, Math.floor(clipH * dpr));
  canvas.style.width = clipW + 'px';
  canvas.style.height = clipH + 'px';
  canvas.style.left = clipX + 'px';
  canvas.style.top = clipY + 'px';
  canvas.dataset.backingScale = dpr;
  canvas.dataset.clipX = clipX;
  canvas.dataset.clipY = clipY;
  return dpr;
}

// Herpositioneer + herteken het annotatiecanvas van een zichtbare pagina
// (na zoom-/scroll-settle). Goedkoop: vector-hertekening op viewportformaat.
function reclipContinuousAnnotationCanvas(wrapper, pageNum) {
  const doc = getActiveDocument();
  const cc = wrapper && wrapper.querySelector('.canvas-container-cont');
  const canvas = cc && cc.querySelector('.annotation-canvas');
  if (!doc || !cc || !canvas) return;
  const breedte = parseFloat(cc.style.width) || cc.getBoundingClientRect().width;
  const hoogte = parseFloat(cc.style.height) || cc.getBoundingClientRect().height;
  setupContinuousAnnotationCanvas(canvas, breedte, hoogte);
  renderAnnotationsForPage(
    canvas.getContext('2d'), pageNum, canvas.width, canvas.height,
    parseFloat(canvas.dataset.backingScale) || undefined,
    { x: (parseFloat(canvas.dataset.clipX) || 0) / doc.scale, y: (parseFloat(canvas.dataset.clipY) || 0) / doc.scale },
    { w: breedte / doc.scale, h: hoogte / doc.scale },
    undefined,
    weergaveTransform(pageNum),
  );
}

function reclipAllContinuousAnnotationCanvases() {
  const container = document.getElementById('pdf-container');
  if (!container) return;
  const cr = container.getBoundingClientRect();
  document.querySelectorAll('#continuous-container .page-wrapper').forEach((wrapper) => {
    const pageNum = parseInt(wrapper.dataset.page, 10);
    if (!pageNum) return;
    const r = wrapper.getBoundingClientRect();
    if (r.top < cr.bottom && r.bottom > cr.top) reclipContinuousAnnotationCanvas(wrapper, pageNum);
  });
}

// Rotatie waarin een pagina op het scherm staat, bovenop zijn eigen /Rotate:
// de paginarotatie van het document plus de weergaverotatie (#200). De
// doorlopende weergave rendert de pagina's in deze stand; opslaan, afdrukken,
// exporteren en miniaturen gebruiken alleen getPageRotation().
function beeldRotatie(pageNum) {
  return normaliseerRotatie((getPageRotation(pageNum) || 0) + weergaveRotatie());
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
export async function renderPage(pageNum, onPageResize = null) {
  // In-flight counter exposed for MCP test harness — `waitForRenderIdle()`
  // polls `window.__pdfRenderInFlight === 0` to know when a synthetic zoom
  // event has fully settled (bitmap painted, tile rendered, state updated).
  if (typeof window !== 'undefined') {
    window.__pdfRenderInFlight = (window.__pdfRenderInFlight || 0) + 1;
  }
  try {
    return await _renderPageImpl(pageNum, onPageResize);
  } finally {
    if (typeof window !== 'undefined') {
      window.__pdfRenderInFlight = Math.max(0, (window.__pdfRenderInFlight || 1) - 1);
    }
    // Gesplitste weergave (#715): paginarotatie, -bewerking of weergavewissel
    // in de live viewer; het andere paneel tekent zich bij.
    meldSplit('weergaveGerenderd');
  }
}

async function _renderPageImpl(pageNum, onPageResize) {
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
  const viewport = paginaViewport(page, viewportOpts);
  // Weergave draaien (#200). De viewport-singleton (PDFium) draait de pagina
  // zelf bij het tekenen; bitmap en lagen blijven in de paginaruimte. Tekent
  // PDF.js de pagina rechtstreeks (webversie, leeg document zonder pad), dan
  // gebeurt het draaien hier: pagina, overlay en lagen in de gedraaide stand.
  const weergaveRot = weergaveRotatie(doc);
  const beeldViewport = weergaveRot
    ? paginaViewport(page, { scale, rotation: (page.rotate + extraRotation + weergaveRot) % 360 })
    : viewport;

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
    // Oorsprong van de pagina-box: CAD-plots hebben vaak een MediaBox rond
    // (0,0) (bv. [-846 -595 846 595]). Zonder deze offset landt tekst-
    // bewerking (painter én klik→record) buiten de pagina.
    offsetXPt: vx0,
    offsetYPt: vy0,
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
  // Alleen het bureaublad heeft PDFium; mobiel tekent met PDF.js (#593).
  const _canUseTauri = heeftRustRenderer();
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
      const userRotation = getPageRotation(pageNum);

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
      const _useRaster = !_skipBitmapRender;
      if (_useRaster) {
        const { initViewport, setPage, wireEvents, viewport: pdfVP } =
          await import('./pdf-viewport.js');
        if (_isStaleDoc(doc)) { resumeThumbnails(); return; }

        // Init viewport on the main PDF canvas if not already running.
        initViewport(pdfCanvas, () => redrawAnnotations(true), tekenTekstBewerkingenOpPagina);
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
        // true = terug naar een eerder getoond document (tabwissel, #539):
        // zoom/verschuiving en de gecachte bitmap staan al klaar.
        const _hersteld = setPage(
          doc.filePath, pageNum,
          _pageWpt, _pageHpt,
          _x0, _y0,
          getPageRotation(pageNum) || 0,
          weergaveRot,
        );

        // Mark as raster so _render() takes the bitmap branch + skips vector
        pdfVP.pageType = 'raster';

        // Kick async bitmap fill — fires viewport.dirty when arrives.
        const _orch = await import('./bitmap-orchestrator.js');
        _orch.ensureBitmapForCurrentView();
        // Tile will be ensured on the first zoom change via the _anchorAt hook
        // (Step 4); for the initial fit we let _render() display whatever
        // getBestAvailableBitmap provides immediately.
        // Een teruggezette stand kan ver ingezoomd zijn: haal dan meteen de
        // scherpe tegel erbij (uit de tegelcache als die het beeld nog dekt),
        // anders blijft de pagina wazig tot de gebruiker zoomt of pant.
        if (_hersteld) _orch.ensureTileForCurrentView(pdfCanvas).catch(() => {});

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
  if (pdfjsFallbackNodig({
    inTauri: isTauri(),
    mobiel: isMobile(),
    hasFilePath: _hasFilePath,
    viewportNamHetOver: _skipBitmapRender,
  })) {
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

      if (_isStaleGen() || _isStaleDoc(doc)) return;
      if (!await tekenPaginaMetPdfJs(page, beeldViewport, pdfCanvas, onPageResize)) return;
      if (_isStaleDoc(doc)) return;
      state.renderEngine = 'Raster (PDF.js)';
      // De pagina staat er. Wat hierna komt (tekst-, link- en formulierlaag,
      // annotaties) kan in de webversie een minuut duren omdat PDF.js daar
      // ook de miniaturen tekent. Het laadscherm en de maat van de
      // overlay-canvassen horen daar niet op te wachten: tot dat moment
      // stonden #annotation-canvas en #text-highlight-canvas op hun
      // 300×150-standaard, en landde alles wat de gebruiker tekende of
      // markeerde naast de pagina (#456). PDF.js tekent hier zelf, dus dit is
      // altijd de paginatak van bepaalOverlayMaat().
      paginaGetekend({
        overlayCanvassen: [annotationCanvas, document.getElementById('text-highlight-canvas')],
        overlayMaat: bepaalOverlayMaat({
          viewportActief: false,
          heeftBestandspad: false,
          paginaCssW: beeldViewport.width,
          paginaCssH: beeldViewport.height,
          dpr: getCanvasDPR(),
        }),
        verbergLaadscherm: hideLoading,
      });
    } catch (e) {
      console.warn('[render] PDF.js-render mislukt:', e);
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
  // Only create on first load or page change, not on every zoom.
  // PAGE-AWARE: a text layer left over from a DIFFERENT page must be rebuilt,
  // otherwise text selection and Edit Text keep operating on the spans of the
  // previously visited page after navigation (raster viewport path sets
  // _skipBitmapRender=true on every render, including page changes).
  // SCOPED op #canvas-container: een globale query vond ook de (verborgen)
  // continuous-lagen van dezelfde pagina, waardoor na een weergavewissel de
  // single-modus nooit een eigen tekstlaag bouwde — tekst (incl. nieuw
  // toegevoegde blokken) was dan niet meer selecteerbaar of bewerkbaar.
  // Welke PDF.js-viewport de tekst-, link- en formulierlaag krijgen: in het
  // viewport-pad de paginaruimte (_render() in pdf-viewport.js draait en zoomt
  // ze), in het PDF.js-pad de gedraaide stand van het getekende canvas.
  const lagenViewport = _skipBitmapRender ? viewport : beeldViewport;
  const _existingTextLayer = document.querySelector('#canvas-container .textLayer');
  // De linklaag bevat rechthoeken die bij ÉÉN rotatiestand horen (PDF.js heeft
  // de draaiing al in de pixels verwerkt). Draait de gebruiker de pagina, dan
  // moet de laag opnieuw worden opgebouwd, anders liggen de klikvlakken scheef.
  const _existingLinkLayer = document.querySelector('#canvas-container .linkLayer');
  const _linkLayerRotationStale = !!_existingLinkLayer
    && Number(_existingLinkLayer.dataset.rotation || 0) !== ((lagenViewport.rotation || 0) % 360);
  // Een laag uit een ander bestand (na opslaan met tekstbewerkingen herlaadt
  // het document uit een nieuw werkbestand) toont oude tekst: opnieuw bouwen.
  const _textLayerStale = !_existingTextLayer
    || parseInt(_existingTextLayer.dataset.page) !== pageNum
    || (_existingTextLayer.dataset.bron ?? '') !== (doc.filePath || '')
    || _linkLayerRotationStale;
  if (!_skipBitmapRender || _textLayerStale) {
    try {
      await createSinglePageTextLayer(page, lagenViewport);
      if (_isStaleDoc(doc)) return;
    } catch (e) {
      console.warn('Failed to create text layer:', e);
    }

    try {
      await createSinglePageLinkLayer(page, lagenViewport);
      if (_isStaleDoc(doc)) return;
    } catch (e) {
      console.warn('Failed to create link layer:', e);
    }

    try {
      await createSinglePageFormLayer(page, lagenViewport);
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
    }
    // Link-/formulierlagen volgen dezelfde regel als bij een
    // gereedschapswissel: klikbaar bij select/hand, uit bij editText en de
    // tekengereedschappen. Eén bron van waarheid — zie link-layer.js.
    applyOverlayPointerEvents(document.getElementById('canvas-container'));

    // De lagen zijn zojuist (her)opgebouwd; de viewport zet ze in zijn
    // volgende frame weer op de pagina (maat + transform). Zonder deze vlag
    // bleef een verse tekstlaag in het rasterpad op de containermaat staan:
    // na een paginawissel lagen tekstselectie en zoekmarkeringen dan naast
    // de pagina tot iets anders toevallig een frame afdwong.
    if (window.__pdfViewport) window.__pdfViewport.dirty = true;
  }

  // Ensure annotations for this page are loaded (on-demand if background hasn't reached it yet)
  // Skip heavy operations during vector zoom (only needed on first load / page change).
  // Uses the same page-aware staleness check as the text-layer block above
  // (evaluated BEFORE that block rebuilt the layer, so page changes pass).
  if (!_skipBitmapRender || _textLayerStale) {
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

  // Overlay-canvassen op de maat van de ruimte waarin redrawAnnotations()
  // tekent: viewportmaat in CSS-px als de viewport de pagina bezit, anders
  // paginamaat × dpr (zelfde beslisregel als _render() in pdf-viewport.js,
  // zie overlay-canvas-size.js). Voorheen altijd de paginamaat; na p2 → p3
  // met gelijke paginamaat kwam er geen _render()-frame meer die dat
  // herstelde en bleef de overlay te klein (NKE2D2 p3/p4: annotaties
  // verkleind en verschoven). Resize en hertekenen in één synchroon blok.
  const vpBezitPagina = !!(window.__pdfViewport && window.__pdfViewport.active);
  const dprOverlay = getCanvasDPR();
  const overlayMaat = bepaalOverlayMaat({
    viewportActief: vpBezitPagina,
    heeftBestandspad: !!doc.filePath,
    // De viewport tekent op #pdf-canvas zelf: backing / dpr = CSS-maat.
    viewportCssW: pdfCanvas.width / dprOverlay,
    viewportCssH: pdfCanvas.height / dprOverlay,
    paginaCssW: beeldViewport.width,
    paginaCssH: beeldViewport.height,
    dpr: dprOverlay,
  });
  if (overlayMaat) {
    pasOverlayMaatToe(annotationCanvas, overlayMaat);
    pasOverlayMaatToe(document.getElementById('text-highlight-canvas'), overlayMaat);
  }
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

// Tekent één pagina met PDF.js op een canvas. Gebruikt door élk pad dat
// PDFium niet kan aanroepen: de webversie (geen Tauri) en lege documenten
// zonder bestandspad. Zie render-route.js voor wanneer dit pad geldt.
async function tekenPaginaMetPdfJs(page, viewport, canvas, onResize = null) {
  return renderPdfJsCanvas({
    page, viewport, canvas, dpr: getCanvasDPR(), onResize,
    renderOptions: async () => {
      const { pdfjsLaagOpties } = await import('./lagen-schakelen.js');
      return pdfjsLaagOpties();
    },
  });
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
  const viewport = paginaViewport(page, viewportOpts);
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

  // Zonder Tauri (webversie) of zonder bestandspad kan PDFium niet; dan tekent
  // PDF.js. Dit is GEEN stille terugval voor een Rust-fout — die blijft hard
  // falen hieronder, zodat een rasterbug zichtbaar blijft.
  if (pdfjsFallbackNodig({ inTauri: isTauri(), mobiel: isMobile(), hasFilePath: !!doc.filePath })) {
    try {
      if (!await tekenPaginaMetPdfJs(page, viewport, pdfCanvas)) return;
      if (_isStaleDoc(doc)) return;
      setupCanvasHiDPI(annotationCanvas, viewport.width, viewport.height);
      redrawAnnotations();
      state.renderEngine = 'Raster (PDF.js)';
    } catch (e) {
      state.renderEngine = 'ERROR';
      console.warn('[render-offscreen] PDF.js-render mislukt:', e);
      return;
    }
  } else {
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
      // Resize wist het overlay-canvas: direct synchron hertekenen zodat
      // afdekbeelden van text-edits/annotaties geen frame verdwijnen (zelfde
      // "no blink"-regel als verderop in renderPage).
      setupCanvasHiDPI(annotationCanvas, viewport.width, viewport.height);
      redrawAnnotations();
      state.renderEngine = 'Raster (PDFium)';
    } catch (e) {
      // Dropped because the user moved to another document (#506): not an error.
      if (isRenderCancelled(e)) return;
      state.renderEngine = 'ERROR';
      console.error('[render-offscreen] HARD ERROR: Rust render threw. NO FALLBACK.', e);
      return;
    }
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
  applyOverlayPointerEvents(container);

  await ensureAnnotationsForPage(pageNum);
  if (_isStaleDoc(doc)) return;
  if (state.preferences.snapToPdfContent) prefetchPdfVectorGeometry(pageNum);
  redrawAnnotations();
  onPageRendered();
  updateAllStatus();
}

// Track which pages have been rendered in continuous mode
const _renderedPages = new Set();
const _contRerenderGate = createRerenderGate();
let _continuousObserver = null;

// ─── Scherpe uitsnede boven de as-cap (#1163) ───────────────────────────────
//
// Een pagina die op apparaatresolutie niet binnen CONT_MAX_AXIS_PX past, was
// een CSS-opgerekte bitmap: wazig, en erger naarmate zoom en vel groter zijn.
// Voor zo'n pagina is het paginacanvas (.pdf-canvas) nu een UITSNEDE: het
// zichtbare deel plus een marge op volle apparaatresolutie, via het
// regio-rendercommando, met left/top/width/height op zijn plek in de
// paginacontainer. De hele pagina op lage resolutie staat als
// background-image op die container, zodat een net in beeld geschoven deel de
// wazige pagina toont tot de nieuwe uitsnede er is. De meetkunde staat in
// doorlopend-scherp.js.
//
// Er komt GEEN element en geen laag bij. De eerdere poging (een tweede,
// scherp canvas over elke pagina) is op 2026-09-01 uitgezet omdat de extra
// lagen de GPU-compositing op zware bladen over een grens duwden en het
// paginacanvas zelf WIT rasterde. Hier is het hetzelfde ene canvas per
// pagina, kleiner dan de 4096-bitmap van voorheen; een achtergrondbeeld hoort
// bij de laag van het element zelf.
//
// Terugval op de gecapte hele-paginarender (het oude gedrag): de webversie,
// Android/iOS, een document zonder bestand op schijf, een backend die de
// vraag niet kent, OPDS_CONT_SHARP=0 in de omgeving van de app (of
// `window.__opdsDoorlopendScherp = false` in de ontwikkelconsole) en elke
// pagina waarvan de regio-render mislukt of leeg terugkomt.

/** Langste as van het achtergrondbeeld: het beeld van de gecapte render. */
const SCHERP_BG_AS_PX = CONT_MAX_AXIS_PX;
/** Langste as van een voorlopige achtergrond (uit wat er al op het scherm stond). */
const SCHERP_BG_VOORLOPIG_AS_PX = 2048;
/**
 * Een voorlopige achtergrond van minstens deze maat blijft: de render van de
 * hele pagina op de cap kost op een zwaar blad seconden waarin de volgende
 * scherpe uitsnede van die pagina moet wachten, voor een beeld dat alleen
 * even te zien is aan de rand tijdens het scrollen.
 */
const SCHERP_BG_GENOEG_AS_PX = 1536;
/**
 * Zo lang na een scherpe uitsnede wacht de render van de achtergrond: wie
 * meteen verder zoomt of scrolt, krijgt eerst zijn volgende uitsnede (op een
 * zwaar blad delen ze één worker en is een begonnen render niet af te breken).
 */
const SCHERP_BG_WACHT_MS = 1200;
/** Zoveel achtergrondbeelden blijven bewaard (JPEG, enkele MB per stuk). */
const SCHERP_BG_BEWAARD = 24;

// pageNum -> { gen, uitsnede, sleutel, bezig, opnieuw, herkanst, bgTimer } van de
// pagina's die nu in de DOM in uitsnede-modus staan. Wordt bij elke herbouw
// geleegd.
const _scherpStaat = new Map();
// sleutel -> { url, mini, voorlopig, as }: achtergrondbeelden, LRU.
const _scherpAchtergronden = new Map();
// sleutel -> { definitief }: lopende achtergrondtaken.
const _scherpBgBezig = new Map();
// Achtergronden waarvan de render mislukte: niet bij elke scroll opnieuw.
const _scherpBgMislukt = new Set();
// `${filePath}|${pageNum}`: pagina's waar de regio-render niet deugt.
const _scherpKapot = new Set();
let _scherpKan = null;
let _scherpOnderweg = 0;
let _scherpDraaiDoek = null;

/** Kan en mag de app scherpe uitsnedes tekenen? Eén keer gevraagd. */
function doorlopendScherpBeschikbaar() {
  if (typeof window !== 'undefined' && window.__opdsDoorlopendScherp === false) return Promise.resolve(false);
  if (!_scherpKan) {
    _scherpKan = heeftRustRenderer()
      ? Promise.resolve().then(() => invoke('doorlopend_scherp_beschikbaar')).then((v) => v === true, () => false)
      : Promise.resolve(false);
  }
  return _scherpKan;
}

// Hoort deze pagina op deze maat (CSS-px) een scherpe uitsnede te krijgen?
function _scherpVoorPagina(doc, pageNum, breedte, hoogte) {
  if (!doc?.filePath || state?.renderEngineOverride === 'rust-skia') return false;
  if (pdfjsFallbackNodig({ inTauri: isTauri(), mobiel: isMobile(), hasFilePath: !!doc.filePath })) return false;
  if (_scherpKapot.has(`${doc.filePath}|${pageNum}`)) return false;
  return scherpeUitsnedeNodig({ breedte, hoogte, dpr: getCanvasDPR(), maxAs: CONT_MAX_AXIS_PX });
}

function _achtergrondSleutel(doc, pageNum, rotatie, dun) {
  return `${doc.filePath}|${pageNum}|${rotatie || 0}|${thinLinesKey(dun)}`;
}

function _zetAchtergrondOp(cc, sleutel, entry) {
  if (!cc || !entry) return;
  if (cc.dataset.scherpBg === sleutel && cc.dataset.scherpBgUrl === entry.url) return;
  cc.style.backgroundImage = `url("${entry.url}")`;
  cc.style.backgroundSize = '100% 100%';
  cc.style.backgroundRepeat = 'no-repeat';
  cc.dataset.scherpBg = sleutel;
  cc.dataset.scherpBgUrl = entry.url;
}

function _haalAchtergrondWeg(cc) {
  if (!cc || !cc.dataset.scherpBg) return;
  cc.style.backgroundImage = '';
  cc.style.backgroundSize = '';
  cc.style.backgroundRepeat = '';
  delete cc.dataset.scherpBg;
  delete cc.dataset.scherpBgUrl;
}

function _vergeetAchtergrond(sleutel) {
  const entry = _scherpAchtergronden.get(sleutel);
  if (!entry) return;
  _scherpAchtergronden.delete(sleutel);
  document.querySelectorAll('#continuous-container .canvas-container-cont').forEach((cc) => {
    if (cc.dataset.scherpBg === sleutel) _haalAchtergrondWeg(cc);
  });
  try { URL.revokeObjectURL(entry.url); } catch {}
}

function _vergeetAchtergronden(prefix = null) {
  for (const sleutel of Array.from(_scherpAchtergronden.keys())) {
    if (prefix === null || sleutel.startsWith(prefix)) _vergeetAchtergrond(sleutel);
  }
  // Een nieuwe kans voor wat eerder mislukte (het bestand is opnieuw geladen
  // of gesloten).
  for (const set of [_scherpBgMislukt, _scherpKapot]) {
    for (const sleutel of Array.from(set)) {
      if (prefix === null || sleutel.startsWith(prefix)) set.delete(sleutel);
    }
  }
}

// Een beeld van de hele pagina (canvas of ImageBitmap) als achtergrondbeeld
// bewaren en op de containers zetten die erom vroegen. Een definitief beeld
// wordt nooit door een voorlopig vervangen.
async function _bewaarAchtergrond(sleutel, bron, bronB, bronH, voorlopig, draai = 0) {
  const bronMaat = achtergrondMaat(bronB, bronH, voorlopig ? SCHERP_BG_VOORLOPIG_AS_PX : SCHERP_BG_AS_PX);
  if (!bronMaat) return;
  // `draai`: de bron is ongedraaid getekend en komt hier in de stand van het
  // scherm (zelfde draaiing als de uitsnede).
  const stand = draaiTransform(draai, bronMaat.breedte, bronMaat.hoogte);
  const maat = { breedte: stand.breedte, hoogte: stand.hoogte };
  const doek = document.createElement('canvas');
  doek.width = maat.breedte;
  doek.height = maat.hoogte;
  const ctx = doek.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, maat.breedte, maat.hoogte);
  ctx.setTransform(...stand.matrix);
  ctx.drawImage(bron, 0, 0, bronMaat.breedte, bronMaat.hoogte);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // Klein beeld om een leeg teruggekomen uitsnede te herkennen.
  const miniMaat = achtergrondMaat(maat.breedte, maat.hoogte, 512);
  const mini = document.createElement('canvas');
  mini.width = miniMaat.breedte;
  mini.height = miniMaat.hoogte;
  mini.getContext('2d', { willReadFrequently: true }).drawImage(doek, 0, 0, miniMaat.breedte, miniMaat.hoogte);
  const blob = await new Promise((klaar) => doek.toBlob(klaar, 'image/jpeg', 0.9));
  doek.width = 1;
  doek.height = 1;
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  // Eerst decoderen: anders valt er tussen het oude en het nieuwe beeld een
  // wit moment.
  try {
    const beeld = new Image();
    beeld.src = url;
    await beeld.decode();
  } catch { /* de browser decodeert het dan bij het tekenen */ }
  const oud = _scherpAchtergronden.get(sleutel);
  if (oud && !oud.voorlopig && voorlopig) {
    URL.revokeObjectURL(url);
    return;
  }
  const entry = { url, mini, voorlopig, as: Math.max(maat.breedte, maat.hoogte) };
  _scherpAchtergronden.delete(sleutel);
  _scherpAchtergronden.set(sleutel, entry);
  document.querySelectorAll('#continuous-container .canvas-container-cont').forEach((cc) => {
    if (cc.dataset.scherpBg === sleutel || cc.dataset.scherpBgWacht === sleutel) {
      delete cc.dataset.scherpBgWacht;
      _zetAchtergrondOp(cc, sleutel, entry);
    }
  });
  if (oud) setTimeout(() => { try { URL.revokeObjectURL(oud.url); } catch {} }, 0);
  while (_scherpAchtergronden.size > SCHERP_BG_BEWAARD) {
    const oudste = _scherpAchtergronden.keys().next().value;
    if (oudste === undefined || oudste === sleutel) break;
    _vergeetAchtergrond(oudste);
  }
}

// Zorg dat de paginacontainer een beeld van de hele pagina als achtergrond
// heeft: wat er al is, anders een voorlopig beeld uit wat op het scherm stond
// en daarna het definitieve (de gecapte hele-paginarender van voorheen).
// `definitief: false` laat die render nog even liggen: van een pagina in
// beeld gaat de scherpe uitsnede voor (op een zwaar blad delen ze één worker).
function _zorgVoorAchtergrond(doc, pageNum, cc, canvas, { rotatie, dun, baseW, baseH, definitief = true }) {
  const sleutel = _achtergrondSleutel(doc, pageNum, rotatie, dun);
  const entry = _scherpAchtergronden.get(sleutel);
  if (entry) {
    // LRU: een gebruikt beeld schuift naar achteren.
    _scherpAchtergronden.delete(sleutel);
    _scherpAchtergronden.set(sleutel, entry);
    _zetAchtergrondOp(cc, sleutel, entry);
    // (Een gedraaide pagina krijgt altijd het hier gedraaide beeld: dat staat
    // gegarandeerd in dezelfde stand als de uitsnede.)
    if (!entry.voorlopig || (!rotatie && entry.as >= SCHERP_BG_GENOEG_AS_PX)) return;
  } else {
    // Een achtergrond van een andere stand (gedraaid, lijnstand) hoort hier niet.
    if (cc.dataset.scherpBg && cc.dataset.scherpBg !== sleutel) _haalAchtergrondWeg(cc);
    cc.dataset.scherpBgWacht = sleutel;
  }
  if (_scherpBgMislukt.has(sleutel)) return;
  const lopend = _scherpBgBezig.get(sleutel);
  if (lopend) {
    // De lopende taak neemt de definitieve render mee.
    if (definitief) lopend.definitief = true;
    return;
  }
  if (entry && !definitief) return;
  const taak = { definitief };
  _scherpBgBezig.set(sleutel, taak);
  (async () => {
    try {
      if (!entry) {
        // Voorlopig: het beeld van de hele pagina dat nog op het canvas staat
        // (net over de cap heen gezoomd), anders de voorvertoning.
        const lowRes = _lowResCache.get(_lowResKey(pageNum, doc));
        if (canvas?.dataset.beeld === 'pagina' && canvas.width > 1 && canvas.height > 1) {
          await _bewaarAchtergrond(sleutel, canvas, canvas.width, canvas.height, true);
        } else if (lowRes?.canvas && voorvertoningRotatie(doc, pageNum) === (rotatie || 0)) {
          await _bewaarAchtergrond(sleutel, lowRes.canvas, lowRes.canvas.width, lowRes.canvas.height, true);
        }
      }
      if (!taak.definitief) return;
      if (!rotatie && (_scherpAchtergronden.get(sleutel)?.as || 0) >= SCHERP_BG_GENOEG_AS_PX) return;
      // Definitief: de gecapte hele-paginarender, ONGEDRAAID gevraagd en hier
      // gedraaid, net als de uitsnede (zo staan ze altijd in dezelfde stand).
      // Staat hij nog in de JS-cache (dezelfde sleutel als het hele-paginapad
      // boven de cap), dan kost het geen render.
      const schaal = SCHERP_BG_AS_PX / Math.max(baseW, baseH);
      const cached = _bitmapJSCacheGet(`${doc.filePath}|${pageNum}|${Math.round(schaal * 10000)}|0|${thinLinesKey(dun)}`);
      if (cached?.bitmap) {
        try {
          await _bewaarAchtergrond(sleutel, cached.bitmap, cached.w, cached.h, false, rotatie);
          return;
        } catch { /* intussen uit de cache gezet en gesloten: zelf renderen */ }
      }
      const { renderPdfPage } = await import('./engine-router.js');
      const { RENDER_PRIORITY } = await import('./render-queue.js');
      const ruw = await renderPdfPage({
        path: doc.filePath, pageIndex: pageNum - 1, scale: schaal, rotation: 0, thinLines: dun,
      }, { priority: RENDER_PRIORITY.PREFETCH });
      const bytes = ruw instanceof Uint8Array ? ruw : new Uint8Array(ruw);
      if (!bytes || bytes.length <= 8) return;
      const kop = new DataView(bytes.buffer, bytes.byteOffset, 8);
      const b = kop.getUint32(0, true);
      const h = kop.getUint32(4, true);
      if (!b || !h || b * h * 4 !== bytes.length - 8) return;
      const beeld = await createImageBitmap(new ImageData(new Uint8ClampedArray(bytes.buffer, bytes.byteOffset + 8, b * h * 4), b, h));
      try {
        await _bewaarAchtergrond(sleutel, beeld, b, h, false, rotatie);
      } finally {
        try { beeld.close(); } catch {}
      }
    } catch (e) {
      if (!isRenderCancelled(e)) {
        _scherpBgMislukt.add(sleutel);
        console.warn(`[doorlopend-scherp] achtergrond p${pageNum} mislukt:`, e);
      }
    } finally {
      _scherpBgBezig.delete(sleutel);
    }
  })();
}

// Aandeel niet-witte monsters in RGBA-data (hooguit ~4096 monsters).
function _inktAandeel(data) {
  const pixels = data.length / 4;
  if (!(pixels > 0)) return 0;
  const stap = Math.max(1, Math.floor(pixels / 4096)) * 4;
  let inkt = 0;
  let monsters = 0;
  for (let i = 0; i < data.length; i += stap) {
    monsters++;
    if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) inkt++;
  }
  return monsters ? inkt / monsters : 0;
}

// Is de teruggekomen uitsnede (vrijwel) leeg terwijl de achtergrond op die
// plek wel beeld heeft? Dan zou ze goede inhoud met wit bedekken.
function _uitsnedeTeLeeg(rgba, uitsnede, breedte, hoogte, mini) {
  if (_inktAandeel(rgba) > 0.0005) return false;
  if (!mini) return false;
  try {
    const fx = mini.width / breedte;
    const fy = mini.height / hoogte;
    const x = Math.max(0, Math.floor(uitsnede.x * fx));
    const y = Math.max(0, Math.floor(uitsnede.y * fy));
    const b = Math.max(1, Math.min(mini.width - x, Math.ceil(uitsnede.breedte * fx)));
    const h = Math.max(1, Math.min(mini.height - y, Math.ceil(uitsnede.hoogte * fy)));
    return _inktAandeel(mini.getContext('2d', { willReadFrequently: true }).getImageData(x, y, b, h).data) > 0.01;
  } catch {
    return false;
  }
}

// Het canvas van een pagina in uitsnede-modus zonder beeld: geen bitmap in
// het geheugen en niets op het scherm; de achtergrond toont de pagina.
function _maakUitsnedeLeeg(canvas) {
  if (!canvas) return;
  if (canvas.width !== 1) canvas.width = 1;
  if (canvas.height !== 1) canvas.height = 1;
  canvas.style.position = 'absolute';
  canvas.style.left = '0px';
  canvas.style.top = '0px';
  canvas.style.width = '0px';
  canvas.style.height = '0px';
  canvas.style.boxShadow = 'none';
  canvas.dataset.beeld = 'uitsnede';
}

// Terug naar een canvas dat de hele pagina dekt (onder de cap, of als de
// uitsnede niet kan): plaatsing en achtergrond weg. De aanroeper zet daarna
// bitmap en CSS-maat.
function _verlaatUitsnedeModus(canvas, cc, pageNum) {
  _scherpStaat.delete(pageNum);
  if (cc) {
    delete cc.dataset.scherpBgWacht;
    _haalAchtergrondWeg(cc);
  }
  if (!canvas || canvas.dataset.beeld !== 'uitsnede') return;
  canvas.style.position = '';
  canvas.style.left = '';
  canvas.style.top = '';
  canvas.style.boxShadow = '';
  delete canvas.dataset.beeld;
}

function _vergeetScherpeUitsnedes() {
  _scherpStaat.clear();
}

/**
 * Zet of ververs de scherpe uitsnede van één pagina in uitsnede-modus: het
 * deel in beeld plus een marge, op apparaatresolutie. Een uitsnede die het
 * zichtbare deel nog dekt blijft staan; een pagina buiten beeld geeft haar
 * bitmap terug. Verouderde antwoorden (andere zoom, ander document, herbouwde
 * weergave, pagina uit beeld) worden weggegooid.
 *
 * Per pagina loopt er hooguit één aanvraag: de render is niet af te breken
 * en op een zwaar blad werkt één worker ze na elkaar af, dus elke aanvraag
 * die door verder scrollen al achterhaald is zou de volgende alleen maar
 * ophouden. Wie tijdens een lopende aanvraag iets anders nodig heeft, krijgt
 * dat direct daarna, voor de stand van dat moment.
 */
async function werkScherpeUitsnedeBij(pageWrapper, pageNum) {
  const doc = getActiveDocument();
  const cc = pageWrapper?.querySelector('.canvas-container-cont');
  const canvas = cc?.querySelector('.pdf-canvas');
  const container = document.getElementById('pdf-container');
  if (!doc || doc.viewMode !== 'continuous' || !doc.filePath || !cc || !canvas || !container) return;
  if (!canvas.isConnected) return;
  const baseW = parseFloat(pageWrapper.dataset.baseW);
  const baseH = parseFloat(pageWrapper.dataset.baseH);
  const schaal = doc.scale;
  const breedte = baseW * schaal;
  const hoogte = baseH * schaal;
  if (!(breedte > 0) || !(hoogte > 0)) return;
  // Niet (meer) boven de cap, of de uitsnede kan hier niet: de gewone
  // hele-paginarender neemt het over zodra de pagina hertekend wordt.
  if (!_scherpVoorPagina(doc, pageNum, breedte, hoogte)) return;
  let staat = _scherpStaat.get(pageNum);
  if (!staat) {
    staat = { gen: 0, uitsnede: null, sleutel: '', bezig: false, opnieuw: false, herkanst: false, bgTimer: null };
    _scherpStaat.set(pageNum, staat);
  }
  const rotatie = beeldRotatie(pageNum);
  const dun = thinLinesOn();
  const dpr = getCanvasDPR();
  const zichtbaarNu = () => zichtbaarDeel(container.getBoundingClientRect(), cc.getBoundingClientRect(), breedte, hoogte);
  const zichtbaar = zichtbaarNu();
  if (!zichtbaar) {
    // Buiten beeld (ook: net buiten beeld klaargezet): geen bitmap; de
    // achtergrond toont de pagina zodra ze in beeld schuift.
    staat.gen++;
    staat.uitsnede = null;
    staat.sleutel = '';
    staat.opnieuw = false;
    if (canvas.dataset.beeld === 'uitsnede') _maakUitsnedeLeeg(canvas);
    // Alleen wat er al is (voorvertoning): renderen doet de pagina in beeld.
    _zorgVoorAchtergrond(doc, pageNum, cc, canvas, { rotatie, dun, baseW, baseH, definitief: false });
    return;
  }
  const sleutel = uitsnedeSleutel({ schaal, dpr, rotatie, dunneLijnen: dun });
  if (staat.sleutel === sleutel && uitsnedeVolstaat(staat.uitsnede, zichtbaar)) {
    if (!staat.bgTimer) _zorgVoorAchtergrond(doc, pageNum, cc, canvas, { rotatie, dun, baseW, baseH });
    return;
  }
  // Eerst wat er al is als achtergrond; de render daarvan volgt na de uitsnede.
  _zorgVoorAchtergrond(doc, pageNum, cc, canvas, { rotatie, dun, baseW, baseH, definitief: false });
  if (staat.bezig) {
    staat.opnieuw = true;
    return;
  }
  const uitsnede = scherpeUitsnede(zichtbaar, breedte, hoogte, { dpr, maxAs: CONT_MAX_AXIS_PX });
  if (!uitsnede) return;
  const gen = staat.gen;
  staat.bezig = true;
  staat.opnieuw = false;
  if (staat.bgTimer) {
    clearTimeout(staat.bgTimer);
    staat.bgTimer = null;
  }
  const actueel = () => _scherpStaat.get(pageNum) === staat && staat.gen === gen
    && doc.scale === schaal && !_isStaleDoc(doc) && canvas.isConnected;
  const terugval = (reden) => {
    console.warn(`[doorlopend-scherp] p${pageNum}: ${reden}; terug naar de hele-paginarender`);
    _scherpKapot.add(`${doc.filePath}|${pageNum}`);
    if (!actueel()) return;
    _renderedPages.delete(pageNum);
    renderContinuousPage(pageNum);
  };
  _scherpOnderweg++;
  if (typeof window !== 'undefined') window.__opdsScherpOnderweg = _scherpOnderweg;
  try {
    const { invokeTileRegion } = await import('./progressive-render.js');
    const ruw = await invokeTileRegion({
      path: doc.filePath,
      pageIndex: pageNum - 1,
      // De tekenmachine tekent uitsnedes alleen ongedraaid; de draaiing van
      // pagina en weergave gebeurt hieronder op het canvas.
      rotation: 0,
      thinLines: dun,
      ...uitsnedeAanvraag(uitsnede, { schaal, rotatie, breedte, hoogte }),
    });
    if (!actueel()) return;
    // Intussen verder gescrold? Een uitsnede die minder van het zichtbare
    // deel dekt dan wat er al scherp staat, komt niet op het scherm.
    const nu = zichtbaarNu();
    if (!nu || overlapOppervlak(uitsnede, nu) === 0) {
      staat.opnieuw = true;
      return;
    }
    if (staat.sleutel === sleutel && staat.uitsnede
      && overlapOppervlak(staat.uitsnede, nu) > overlapOppervlak(uitsnede, nu)) return;
    const bytes = ruw instanceof Uint8Array ? ruw : new Uint8Array(ruw);
    if (!bytes || bytes.length <= 8) { terugval('leeg antwoord'); return; }
    const kop = new DataView(bytes.buffer, bytes.byteOffset, 8);
    const rb = kop.getUint32(0, true);
    const rh = kop.getUint32(4, true);
    if (!rb || !rh || rb * rh * 4 !== bytes.length - 8) { terugval(`ongeldig beeld ${rb}x${rh}`); return; }
    const plek = draaiTransform(rotatie, rb, rh);
    if (!beeldPastBijAanvraag(plek.breedte, plek.hoogte, uitsnede.bitmapB, uitsnede.bitmapH)) {
      terugval(`beeld ${plek.breedte}x${plek.hoogte} past niet bij de aanvraag ${uitsnede.bitmapB}x${uitsnede.bitmapH}`);
      return;
    }
    const rgba = new Uint8ClampedArray(bytes.buffer, bytes.byteOffset + 8, rb * rh * 4);
    const bg = _scherpAchtergronden.get(_achtergrondSleutel(doc, pageNum, rotatie, dun));
    if (_uitsnedeTeLeeg(rgba, uitsnede, breedte, hoogte, bg?.mini)) {
      // Eén herkansing (de regio-render kwam vlak na openen of een
      // moduswissel wel eens leeg terug); blijft het leeg, dan de oude weg.
      if (staat.herkanst) { terugval('uitsnede blijft leeg waar de pagina beeld heeft'); return; }
      staat.herkanst = true;
      setTimeout(() => {
        if (_scherpStaat.get(pageNum) === staat && canvas.isConnected) werkScherpeUitsnedeBij(pageWrapper, pageNum);
      }, 1200);
      return;
    }
    staat.herkanst = false;
    // Bitmap en plaatsing in één synchroon blok: geen frame met de nieuwe
    // maat en het oude beeld.
    if (canvas.width !== plek.breedte) canvas.width = plek.breedte;
    if (canvas.height !== plek.hoogte) canvas.height = plek.hoogte;
    const ctx = canvas.getContext('2d');
    const beeld = new ImageData(rgba, rb, rh);
    if (!rotatie) {
      ctx.putImageData(beeld, 0, 0);
    } else {
      if (!_scherpDraaiDoek) _scherpDraaiDoek = document.createElement('canvas');
      const klad = _scherpDraaiDoek;
      klad.width = rb;
      klad.height = rh;
      klad.getContext('2d').putImageData(beeld, 0, 0);
      ctx.setTransform(...plek.matrix);
      ctx.drawImage(klad, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      klad.width = 1;
      klad.height = 1;
    }
    canvas.style.position = 'absolute';
    canvas.style.left = `${uitsnede.x}px`;
    canvas.style.top = `${uitsnede.y}px`;
    canvas.style.width = `${plek.breedte / uitsnede.pxPerCss}px`;
    canvas.style.height = `${plek.hoogte / uitsnede.pxPerCss}px`;
    canvas.style.boxShadow = 'none';
    canvas.dataset.beeld = 'uitsnede';
    staat.uitsnede = { ...uitsnede, breedte: plek.breedte / uitsnede.pxPerCss, hoogte: plek.hoogte / uitsnede.pxPerCss };
    staat.sleutel = sleutel;
    // Een annotatie met mengmodus mengt met het paginabeeld eronder: nu dat
    // er scherp staat (en op een andere plek), opnieuw mengen.
    if (doc.annotations?.some((a) => a.page === pageNum && isGemengd(effectiveBlendMode(a)))) {
      reclipContinuousAnnotationCanvas(pageWrapper, pageNum);
    }
  } catch (e) {
    if (!isRenderCancelled(e)) terugval(`regio-render mislukt (${String(e?.message ?? e).slice(0, 120)})`);
  } finally {
    staat.bezig = false;
    _scherpOnderweg--;
    if (typeof window !== 'undefined') window.__opdsScherpOnderweg = _scherpOnderweg;
    if (_scherpStaat.get(pageNum) === staat && canvas.isConnected) {
      if (staat.opnieuw) {
        // Tijdens de render is er iets anders gevraagd: nu voor de stand van nu.
        staat.opnieuw = false;
        werkScherpeUitsnedeBij(pageWrapper, pageNum);
      } else if (staat.sleutel) {
        // De uitsnede staat er: straks de achtergrond van de hele pagina.
        if (staat.bgTimer) clearTimeout(staat.bgTimer);
        staat.bgTimer = setTimeout(() => {
          staat.bgTimer = null;
          if (_scherpStaat.get(pageNum) !== staat || staat.bezig || !canvas.isConnected || _isStaleDoc(doc)) return;
          _zorgVoorAchtergrond(doc, pageNum, cc, canvas, { rotatie, dun, baseW, baseH });
        }, SCHERP_BG_WACHT_MS);
      }
    }
  }
}

// Alle pagina's in uitsnede-modus bijwerken (na scrollen, een andere
// venstermaat of een andere schermschaal): in beeld verversen, uit beeld de
// bitmap teruggeven.
function werkScherpeUitsnedesBij() {
  if (!_scherpStaat.size) return;
  for (const pageNum of Array.from(_scherpStaat.keys())) {
    const wrapper = document.querySelector(`#continuous-container .page-wrapper[data-page="${pageNum}"]`);
    if (!wrapper) { _scherpStaat.delete(pageNum); continue; }
    werkScherpeUitsnedeBij(wrapper, pageNum);
  }
}

/**
 * Het paginabeeld van een pagina in de doorlopende weergave voor wie het wil
 * natekenen (de MCP-schermopname): het vak van de hele pagina, en bij een
 * pagina in uitsnede-modus de achtergrond en de plek van de uitsnede. Null
 * als de pagina er niet is of nog niets toont.
 * @returns {Promise<{vak: DOMRect, canvas: HTMLCanvasElement, uitsnede: boolean,
 *   achtergrond: ImageBitmap|HTMLImageElement|null} | null>}
 */
export async function doorlopendPaginaBeeld(pageNum) {
  const cc = document.querySelector(`#continuous-container .page-wrapper[data-page="${pageNum}"] .canvas-container-cont`);
  const canvas = cc?.querySelector('canvas.pdf-canvas');
  if (!cc || !canvas) return null;
  if (canvas.dataset.beeld !== 'uitsnede') {
    return { vak: canvas.getBoundingClientRect(), canvas, uitsnede: false, achtergrond: null };
  }
  let achtergrond = null;
  const url = cc.dataset.scherpBgUrl;
  if (url) {
    try {
      const beeld = new Image();
      beeld.src = url;
      await beeld.decode();
      achtergrond = beeld;
    } catch { /* zonder achtergrond: alleen de uitsnede */ }
  }
  if (!achtergrond && !(canvas.width > 1 && canvas.height > 1)) return null;
  return { vak: cc.getBoundingClientRect(), canvas, uitsnede: true, achtergrond };
}

// Per-pagina render-generatie voor de doorlopende weergave: de Rust-invoke
// is niet te annuleren, dus een verouderde render kan ná de verse landen en
// de bitmap-attrs terugzetten (bv. een fit-schaal-render die de verse
// 4096-render overschrijft bij snel doorzoomen). Alleen de nieuwste
// generatie mag de bitmap schrijven — zelfde principe als
// _foregroundRenderGen in het enkelpagina-pad, maar dan per pagina.
const _contPageRenderGen = new Map();

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
// De sleutel hoort bij het document dat gerenderd wordt (#506): de
// achtergrondlus van een vorig document mag zijn pagina's niet onder de
// sleutel van het nu actieve document leggen.
function _lowResKey(pageNum, doc = getActiveDocument()) {
  return voorvertoningSleutel(doc, pageNum);
}

// Eén achtergrondlus tegelijk, en alleen voor het document dat voor staat.
const _startLowResLus = maakVoorvertoningLus(getActiveDocument);

// Render a quick low-res preview of a page (fast, <50ms per page)
async function renderLowResPreview(doc, pageNum, nogActueel = () => true) {
  const pdfDoc = doc.pdfDoc;
  const cacheKey = _lowResKey(pageNum, doc);
  if (_lowResCache.has(cacheKey)) return _lowResCache.get(cacheKey).canvas;

  const page = await pdfDoc.getPage(pageNum);
  // Intussen een ander document of een nieuwere lus: niet meer renderen,
  // de PDF.js-worker is nodig voor wat nu in beeld staat.
  if (!nogActueel()) return null;
  const extraRotation = voorvertoningRotatie(doc, pageNum);
  const vpOpts = { scale: LOW_RES_SCALE };
  if (extraRotation) vpOpts.rotation = (page.rotate + extraRotation) % 360;
  const viewport = paginaViewport(page, vpOpts);

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');

  try {
    const { pdfjsLaagOpties } = await import('./lagen-schakelen.js');
    await page.render({
      canvasContext: ctx,
      viewport,
      annotationMode: 0,
      ...pdfjsLaagOpties(doc),
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

/** Voorvertoningen van één bestand weg (tabblad gesloten, andere blijven open). */
export function clearLowResCacheForFile(filePath) {
  const prefix = `${filePath}|`;
  for (const k of Array.from(_lowResCache.keys())) {
    if (k.startsWith(prefix)) _lowResCache.delete(k);
  }
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
  const scherpKan = await doorlopendScherpBeschikbaar();
  if (_isStaleDoc(doc)) return;
  // Paginarotatie plus weergaverotatie (#200): de pagina, zijn tekst-, link-
  // en formulierlaag en de container staan in de gedraaide stand; alleen de
  // annotaties blijven in de paginaruimte (weergaveTransform hieronder).
  const extraRotation = beeldRotatie(pageNum);
  const vpOpts = { scale: doc.scale };
  if (extraRotation) {
    vpOpts.rotation = (page.rotate + extraRotation) % 360;
  }
  const viewport = paginaViewport(page, vpOpts);
  const myRenderGen = (_contPageRenderGen.get(pageNum) || 0) + 1;
  _contPageRenderGen.set(pageNum, myRenderGen);
  // Boven de as-cap: een scherpe uitsnede in plaats van een opgerekte
  // hele-paginabitmap (#1163), waar de regio-render er is.
  const scherp = scherpKan && _scherpVoorPagina(doc, pageNum, viewport.width, viewport.height);

  // Canvas-CSS-maat op het SCHRIJFMOMENT bepalen, niet uit de hierboven
  // vastgelegde viewport: doc.scale kan tijdens de async Rust-render
  // gewijzigd zijn (snel wheelzoomen), en viewport.width zou dan de door
  // _applyContinuousZoomInstant gezette maat terugdraaien naar de oude
  // schaal. baseW × doc.scale klopt altijd; de bitmap is hooguit even
  // gestretcht tot de debounced re-render hem vervangt. Bij ongewijzigde
  // schaal identiek aan viewport.width/height.
  const cssSize = () => ({
    w: Math.floor(parseFloat(pageWrapper.dataset.baseW) * doc.scale) || Math.floor(viewport.width),
    h: Math.floor(parseFloat(pageWrapper.dataset.baseH) * doc.scale) || Math.floor(viewport.height),
  });

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

    if (scherp) {
      // Geen canvas ter grootte van de pagina (boven de cap past dat niet
      // eens); de voorvertoning komt als achtergrond van de container.
      _maakUitsnedeLeeg(pdfCanvasEl);
    } else {
      // Show low-res preview immediately while full render runs in background
      setupCanvasHiDPI(pdfCanvasEl, viewport.width, viewport.height);
      const lowRes = _lowResCache.get(_lowResKey(pageNum));
      if (lowRes) {
        const previewCtx = pdfCanvasEl.getContext('2d');
        previewCtx.drawImage(lowRes.canvas, 0, 0, pdfCanvasEl.width, pdfCanvasEl.height);
      }
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
  // Muis-events koppelen zodra de pagina haar canvassen heeft, niet pas aan
  // het einde van een geslaagde render (#1174). Een eerste render die door een
  // nieuwere werd ingehaald (fitPage vlak na het openen van een nieuw
  // document), mislukte of werd afgebroken, keerde vóór dat einde terug; de
  // volgende vond de canvassen al en sloeg het koppelen over. De pagina nam
  // dan geen enkel gereedschap meer aan.
  setupContinuousPageEvents(annotationCanvasEl, pageNum);

  // Update canvas dimensions for new scale. A REUSED pdf-canvas keeps its old
  // bitmap as a CSS-stretched placeholder until the new render lands: resizing
  // a canvas wipes it, and that wipe was exactly the white flash that made
  // zooming in continuous mode unusable.
  //
  // Het annotation-canvas WORDT hier geresized (en dus gewist) — daarom moet
  // het in HETZELFDE synchrone blok direct hertekend worden (zelfde regel als
  // het single-page-pad: "resize and redraw in one synchronous block — no
  // blink"). Zonder die directe hertekening stonden afdek-/vervangbeelden van
  // text-edits en alle annotaties frames-lang niet op het scherm terwijl de
  // paginarender async liep — de oude tekst onder een text-edit flitste dan
  // zichtbaar door bij zoomen/scrollen in doorlopende weergave.
  const annBackingScale = setupContinuousAnnotationCanvas(annotationCanvasEl, viewport.width, viewport.height);
  const annClipOffset = () => ({
    x: (parseFloat(annotationCanvasEl.dataset.clipX) || 0) / doc.scale,
    y: (parseFloat(annotationCanvasEl.dataset.clipY) || 0) / doc.scale,
  });
  renderAnnotationsForPage(
    annotationCanvasEl.getContext('2d'), pageNum,
    annotationCanvasEl.width, annotationCanvasEl.height, annBackingScale,
    annClipOffset(),
    { w: viewport.width / doc.scale, h: viewport.height / doc.scale },
    undefined,
    weergaveTransform(pageNum),
  );
  if (isNewPage) {
    if (!scherp) setupCanvasHiDPI(pdfCanvasEl, viewport.width, viewport.height);
  } else if (pdfCanvasEl.dataset.beeld !== 'uitsnede') {
    // (Een uitsnede houdt haar plek en maat, meegeschaald door het
    // zoomgebaar, tot het nieuwe beeld er is.)
    const { w: cssW0, h: cssH0 } = cssSize();
    pdfCanvasEl.style.width = cssW0 + 'px';
    pdfCanvasEl.style.height = cssH0 + 'px';
  }
  // Cursor is handled centrally by js/ui/cursor.js — no need to set it here.

  // Only editText forces pe:none statically; select uses dynamic fallthrough.
  // See comment near renderer block ~line 455. Een nieuw canvas heeft in de
  // CSS geen z-index en zou anders onder de tekstlaag liggen (#1013).
  pasCanvasLagenToe(canvasContainer, state.currentTool);

  // RUST-ONLY: continuous-mode page render. Used to dual-fallback to
  // PDF.js — removed per project policy. Rust failure surfaced via console
  // + state.renderEngine = 'ERROR' (the page stays blank rather than
  // showing a slow-rendered PDF.js fallback that hides the actual Rust bug).
  const pdfCtxEl = pdfCanvasEl.getContext('2d');

  // Webversie/documenten zonder pad: PDF.js tekent. Zie render-route.js.
  const _pdfjsPad = pdfjsFallbackNodig({ inTauri: isTauri(), mobiel: isMobile(), hasFilePath: !!doc.filePath });

  // ─── PERF FIX #2 + #3 (BARN measurement scaffold) ───────────────────
  //  (#1 — de DPR-factor laten vallen — is teruggedraaid, issue #549: de
  //      enkele-paginaweergave rendert op zoom × dpr, en zonder die factor
  //      rekte de browser de bitmap op 125%/150% Windows-schaal op en was
  //      doorlopend zichtbaar wazig. Zie continuous-render-scale.js.)
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
  // Render in apparaat-pixels (zoom × dpr); de cap geldt voor die bitmap.
  const _contScale = doc.scale;
  const renderScale = continuousRenderScale({
    scale: _contScale,
    dpr: getCanvasDPR(),
    viewWidth: viewport.width,
    viewHeight: viewport.height,
    maxAxisPx: CONT_MAX_AXIS_PX,
  });
  // Device-pixel resolution shown 1:1 (#523): canvas CSS size = bitmap size /
  // dpr, so the browser does not resample the bitmap by a fraction of a pixel
  // (that blurs thin rules and text). A capped bitmap, or one that no longer
  // belongs to the current scale (zoom changed while it rendered), keeps the
  // logical size from cssSize() above.
  const _contDpr = getCanvasDPR();
  const _contCapped = renderScale < _contScale * _contDpr * (1 - 1e-9);
  const cssFromBitmap = (bw, bh) => {
    const logical = cssSize();
    if (_contCapped) return logical;
    const w = bw / _contDpr;
    const h = bh / _contDpr;
    return Math.abs(w - logical.w) <= 2 && Math.abs(h - logical.h) <= 2 ? { w, h } : logical;
  };

  const label = `[render p${pageNum} scale ${renderScale.toFixed(2)}]`;
  console.time(label);
  // Lijnstand (Thin Lines, #595) hoort bij het beeld: sleutel én render
  // gebruiken dezelfde, vastgelegd bij de start van deze render.
  const _thin = thinLinesOn();
  const _jsCacheKey = `${doc.filePath}|${pageNum}|${Math.round(renderScale * 10000)}|${extraRotation || 0}|${thinLinesKey(_thin)}`;
  console.time(label + ' cache-lookup');
  const _cached = _bitmapJSCacheGet(_jsCacheKey);
  console.timeEnd(label + ' cache-lookup');
  if (scherp) {
    // Geen hele-paginarender: de uitsnede in beeld, met de hele pagina op
    // lage resolutie als achtergrond. Loopt naast de lagen hieronder.
    werkScherpeUitsnedeBij(pageWrapper, pageNum);
    state.renderEngine = 'Raster (PDFium)';
    console.timeEnd(label);
  } else if (_pdfjsPad) {
    try {
      _verlaatUitsnedeModus(pdfCanvasEl, canvasContainer, pageNum);
      if (!await tekenPaginaMetPdfJs(page, viewport, pdfCanvasEl)) { console.timeEnd(label); return; }
      pdfCanvasEl.dataset.beeld = 'pagina';
      state.renderEngine = 'Raster (PDF.js)';
    } catch (e) {
      console.warn(`[render-continuous] PDF.js-render van pagina ${pageNum} mislukt:`, e);
    }
    console.timeEnd(label);
  } else if (_cached) {
    console.time(label + ' canvas-draw-cached');
    _verlaatUitsnedeModus(pdfCanvasEl, canvasContainer, pageNum);
    pdfCanvasEl.dataset.beeld = 'pagina';
    pdfCanvasEl.width = _cached.w;
    pdfCanvasEl.height = _cached.h;
    // CSS size = bitmap / dpr (1:1), or the logical page size when the axis
    // cap reduced renderScale (CSS upscales the capped bitmap).
    const { w: cssW1, h: cssH1 } = cssFromBitmap(_cached.w, _cached.h);
    pdfCanvasEl.style.width = cssW1 + 'px';
    pdfCanvasEl.style.height = cssH1 + 'px';
    pdfCtxEl.drawImage(_cached.bitmap, 0, 0);
    console.timeEnd(label + ' canvas-draw-cached');
    state.renderEngine = 'Raster (PDFium · cached)';
    console.timeEnd(label);
  } else {
    try {
      // Schaal alweer veranderd vóór de dure render start? Dan zou dit een
      // verouderde render worden die de wachtrij verstopt terwijl de pagina
      // wit blijft. Meteen opnieuw plannen op de actuele schaal.
      if (doc.scale !== vpOpts.scale) {
        console.timeEnd(label);
        _renderedPages.delete(pageNum);
        setTimeout(() => { renderContinuousPage(pageNum); }, 30);
        return;
      }
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
        thinLines: _thin,
      });
      console.timeEnd(label + ' invoke-render');
      if (_isStaleDoc(doc)) { console.timeEnd(label); return; }
      if (_contPageRenderGen.get(pageNum) !== myRenderGen) { console.timeEnd(label); return; }
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
      _verlaatUitsnedeModus(pdfCanvasEl, canvasContainer, pageNum);
      pdfCanvasEl.dataset.beeld = 'pagina';
      pdfCanvasEl.width = rustW;
      pdfCanvasEl.height = rustH;
      // CSS size: see the cached branch above.
      const { w: cssW2, h: cssH2 } = cssFromBitmap(rustW, rustH);
      pdfCanvasEl.style.width = cssW2 + 'px';
      pdfCanvasEl.style.height = cssH2 + 'px';
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
      if (isRenderCancelled(e)) {
        // Dropped because the user moved to another document (#506); showing
        // that document again rebuilds the continuous view.
        try { console.timeEnd(label); } catch {}
        return;
      }
      state.renderEngine = 'ERROR';
      console.error(`[render-continuous] HARD ERROR: page ${pageNum} Rust threw. NO FALLBACK.`, e);
      try { console.timeEnd(label); } catch {}
      return;
    }
  }

  // Schaal tijdens de async render gewijzigd? De bitmap is getekend (beter
  // gestretcht dan oud beeld), maar de tekst-/link-/formlagen zouden op de
  // verouderde viewport gepositioneerd worden. Overslaan: de aankomende
  // debounced re-render (reRenderVisibleContinuousPages cleart _renderedPages)
  // herbouwt deze pagina op de juiste schaal.
  if (doc.scale !== vpOpts.scale) {
    // De laatste debounced re-render kan al gedraaid zijn terwijl deze render
    // nog liep — zonder herplanning blijft de pagina dan permanent op de
    // (gestretchte) oude bitmap staan. Zelf een verse render inplannen.
    _renderedPages.delete(pageNum);
    setTimeout(() => { renderContinuousPage(pageNum); }, 50);
    return;
  }

  // Oude lagen van deze pagina eerst opruimen: createTextLayer/createLinkLayer
  // voegen alleen toe, en zonder deze sweep stapelde elke zoom-herbouw een
  // complete extra tekst-/link-/formlaag op de wrapper (duplicaat-spans,
  // verouderde klikdoelen).
  canvasContainer.querySelectorAll('.textLayer, .linkLayer, .formLayer')
    .forEach(l => l.remove());

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
  applyOverlayPointerEvents(canvasContainer);
  // Tekstlaag en annotatiecanvas van deze pagina in de stapeling van het
  // actieve gereedschap (#1013). setTool() zet die alleen voor de pagina's die
  // er dan al zijn; een later gebouwde pagina hield anders de tekstlaag
  // bovenop en de hand kon er niet pannen.
  pasGereedschapLagenToe(canvasContainer, state.currentTool);

  // Render annotations
  const annotationCtxEl = annotationCanvasEl.getContext('2d');
  renderAnnotationsForPage(
    annotationCtxEl, pageNum,
    annotationCanvasEl.width, annotationCanvasEl.height, annBackingScale,
    annClipOffset(),
    { w: viewport.width / doc.scale, h: viewport.height / doc.scale },
    undefined,
    weergaveTransform(pageNum),
  );

  // Re-apply search highlights after re-render
  onPageRendered();

  // Scherpe annotatie-overlay bij hoge zoom (staat uit, zie rendering.js).
  updateContinuousSharpOverlay(pageWrapper, pageNum);
}

// Re-render only visible pages at new scale (keeps existing DOM structure)
export async function reRenderVisibleContinuousPages() {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc || !doc.pdfDoc) return;
  const token = _contRerenderGate.begin(doc.scale);
  const scale = token.scale;

  const continuousContainer = document.getElementById('continuous-container');
  if (!continuousContainer) return;

  // Fase 1 (async): viewports verzamelen, nog GEEN DOM-schrijf. Zoomt de
  // gebruiker tijdens een getPage-await door (of start een nieuwere run),
  // dan zou de oude lus wrappermaten op de verouderde schaal terugschrijven
  // — inclusief pagina's bóven het zoomanker, waardoor de scrollpositie
  // meesleept (verspringen bij snel zoomen). Daarom ná elke await de poort
  // checken en zo nodig afbreken: de nieuwe debounce-aanroep neemt het over.
  const jobs = [];
  for (const wrapper of continuousContainer.querySelectorAll('.page-wrapper')) {
    const pageNum = parseInt(wrapper.dataset.page, 10);
    if (!pageNum) continue;

    const page = await doc.pdfDoc.getPage(pageNum);
    if (!_contRerenderGate.isCurrent(token, doc.scale) || _isStaleDoc(doc)) return;
    const extraRotation = beeldRotatie(pageNum);
    const vpOpts = { scale };
    if (extraRotation) vpOpts.rotation = (page.rotate + extraRotation) % 360;
    jobs.push({ wrapper, viewport: paginaViewport(page, vpOpts) });
  }

  // Fase 2 (synchroon, atomair): pas hier invalideren en alle maten in één
  // keer schrijven — dit blok kan niet meer door een wheel-event doorsneden
  // worden.
  _renderedPages.clear();
  for (const { wrapper, viewport } of jobs) {
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

  // Annotatie-uitsnedes op de nieuwe schaal zetten (zichtbare pagina's).
  reclipAllContinuousAnnotationCanvases();
}

// ─── Continuous mode: zoom + scroll/page sync ───────────────────────────────

// Instant zoom: resize every page's container + its rendered canvases straight
// to the new scale and re-anchor the scroll in the SAME synchronous frame, so
// the page tracks the wheel/button immediately. The crisp Rust re-render is
// debounced (see continuousZoomBy) and swaps in once the gesture settles. The
// old approach awaited a full re-render BEFORE moving the scroll, which made
// the page lurch and lag a notch behind the wheel (schokkerig + vertraging).
function _applyContinuousZoomInstant(oldScale, anchorY = null, anchorX = null) {
  const doc = getActiveDocument();
  const container = document.getElementById('pdf-container');
  const cont = document.getElementById('continuous-container');
  if (!doc || !container || !cont || !oldScale) return;
  const newScale = doc.scale;
  const factor = newScale / oldScale;
  // Anker in client-coördinaten; zonder cursor (zoom-knoppen, setZoom) het
  // midden van de zichtbare container.
  const contRect = container.getBoundingClientRect();
  const ax = contRect.left + (anchorX != null ? anchorX : container.clientWidth / 2);
  const ay = contRect.top + (anchorY != null ? anchorY : container.clientHeight / 2);
  // Referentie-element: de pagina onder het anker (of de dichtstbijzijnde).
  // De oude formule `(scrollTop + anker) * factor` nam aan dat de hele
  // scroll-inhoud met `factor` meeschaalt, maar gaps/padding staan in vaste
  // px — en horizontaal werd er helemaal niet geankerd, waardoor het punt
  // onder de cursor bij elke zoomstap opzij dreef (issue: zoom centreert
  // niet rond de muis). De rect van de pagina vóór/ná de resize geeft een
  // exacte correctie voor beide assen.
  const pageEls = [...cont.querySelectorAll('.page-wrapper .canvas-container-cont')];
  // left/right meegeven: in boek-/dubbelepaginaweergave delen twee pagina's
  // dezelfde verticale grenzen en moet de horizontale positie beslissen.
  const refIdx = pickAnchorPageIndex(pageEls.map(el => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
  }), ay, ax);
  const refEl = refIdx >= 0 ? pageEls[refIdx] : null;
  const rectBefore = refEl ? refEl.getBoundingClientRect() : null;
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
      if (cv.classList.contains('annotation-canvas')) {
        // Viewport-gebonden uitsnede: maat en positie schalen mee met het
        // gebaar; de settle-hertekening zet hem daarna exact.
        cv.style.width = ((parseFloat(cv.style.width) || 0) * factor) + 'px';
        cv.style.height = ((parseFloat(cv.style.height) || 0) * factor) + 'px';
        cv.style.left = ((parseFloat(cv.style.left) || 0) * factor) + 'px';
        cv.style.top = ((parseFloat(cv.style.top) || 0) * factor) + 'px';
        cv.dataset.clipX = (parseFloat(cv.dataset.clipX) || 0) * factor;
        cv.dataset.clipY = (parseFloat(cv.dataset.clipY) || 0) * factor;
        return;
      }
      if (cv.dataset.beeld === 'uitsnede') {
        // Paginacanvas als uitsnede (#1163): plek en maat schalen mee; de
        // bitmap blijft tijdelijk opgerekt tot de nieuwe uitsnede er is.
        const pageNum = parseInt(wrapper.dataset.page, 10);
        const staat = _scherpStaat.get(pageNum);
        if (staat?.uitsnede) staat.uitsnede = schaalUitsnede(staat.uitsnede, factor);
        cv.style.width = `${(parseFloat(cv.style.width) || 0) * factor}px`;
        cv.style.height = `${(parseFloat(cv.style.height) || 0) * factor}px`;
        cv.style.left = `${(parseFloat(cv.style.left) || 0) * factor}px`;
        cv.style.top = `${(parseFloat(cv.style.top) || 0) * factor}px`;
        return;
      }
      if (cv.classList.contains('annotation-canvas-sharp')) {
        // De viewport-uitsnede schaalt mee met de pagina (maat én positie);
        // de settle-hertekening vervangt hem daarna door een exacte uitsnede.
        cv.style.width = `${(parseFloat(cv.style.width) || 0) * factor}px`;
        cv.style.height = `${(parseFloat(cv.style.height) || 0) * factor}px`;
        cv.style.left = `${(parseFloat(cv.style.left) || 0) * factor}px`;
        cv.style.top = `${(parseFloat(cv.style.top) || 0) * factor}px`;
        return;
      }
      cv.style.width = `${w}px`;
      cv.style.height = `${h}px`;
    });
  });
  // Scroll-correctie ná de synchrone resize (getBoundingClientRect forceert
  // de reflow): zet het content-punt terug onder het anker. De browser
  // clampt zelf op de scrollranden; als de inhoud smaller is dan de viewport
  // is er geen scrollruimte en centreert de layout — dat is inherent.
  if (refEl && rectBefore) {
    const { dx, dy } = anchorScrollCorrection({ x: ax, y: ay }, rectBefore, refEl.getBoundingClientRect());
    container.scrollLeft += dx;
    container.scrollTop += dy;
  }
}

let _contRerenderTimer = null;

// Core continuous zoom: multiply scale by `factor`, apply the instant visual
// zoom, then debounce the crisp re-render. Anchored at anchorY/anchorX (px
// within #pdf-container) so content under the cursor stays put; without
// anchor it zooms around the viewport center.
export function continuousZoomBy(factor, anchorY = null, anchorX = null) {
  const doc = getActiveDocument();
  if (!doc || doc.viewMode !== 'continuous' || !factor) return;
  const old = doc.scale;
  let next = Math.min(24, Math.max(0.05, old * factor));
  next = Math.round(next * 1000) / 1000;
  if (next === old) return;
  doc.scale = next;
  _applyContinuousZoomInstant(old, anchorY, anchorX);
  updateAllStatus(); // zoom % tracks the gesture immediately
  if (_contRerenderTimer) clearTimeout(_contRerenderTimer);
  _contRerenderTimer = setTimeout(() => {
    _contRerenderTimer = null;
    if (getActiveDocument()?.viewMode !== 'continuous') return;
    reRenderVisibleContinuousPages();
  }, 130);
}

// Absolute variant voor setZoom/fit/actualSize in de doorlopende weergave:
// doc.scale is al op de nieuwe waarde gezet door de aanroeper; pas de
// instant-zoom toe vanaf oldScale en plan dezelfde debounced crisp re-render
// als continuousZoomBy. (Was een dangling verwijzing: de drie aanroepers
// gooiden een ReferenceError zodat absolute zoom/ware grootte in de
// doorlopende weergave helemaal niets deed.)
async function _continuousRezoom(oldScale) {
  _applyContinuousZoomInstant(oldScale);
  updateAllStatus();
  if (_contRerenderTimer) clearTimeout(_contRerenderTimer);
  _contRerenderTimer = setTimeout(() => {
    _contRerenderTimer = null;
    if (getActiveDocument()?.viewMode !== 'continuous') return;
    reRenderVisibleContinuousPages();
  }, 130);
}

// One discrete zoom step (zoom buttons / keyboard) anchored at anchorY.
export function continuousZoomStep(direction, anchorY = null) {
  const doc = getActiveDocument();
  if (!doc) return;
  continuousZoomBy(nextScaleStep(doc.scale, direction) / doc.scale, anchorY);
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
    // Facing toont één spread zonder scroll-navigatie; scroll mag currentPage
    // (het spread-anker) niet naar de rechterpagina verschuiven, anders breekt
    // vorige/volgende. De annotatie-uitsnedes moeten wél mee, ook in facing:
    // anders valt een klik buiten de oude uitsnede op de tekstlaag (#506).
    if (!naScrollen(getActiveDocument()).uitsnedesBijwerken) return;
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      const acties = naScrollen(getActiveDocument());
      if (acties.paginaVolgen) _syncCurrentPageFromScroll(container);
      // Annotatie-uitsnedes op de nieuwe scrollpositie zetten.
      if (acties.uitsnedesBijwerken) reclipAllContinuousAnnotationCanvases();
      // De scherpe pagina-uitsnedes ook; niet midden in een zoomgebaar (de
      // scrollcorrectie daarvan komt hier ook langs): dat doet de
      // hertekening na het gebaar.
      if (acties.uitsnedesBijwerken && !_contRerenderTimer) werkScherpeUitsnedesBij();
    }, 120);
  }, { passive: true });
  // Een groter venster laat meer van de pagina zien dan de uitsnedes dekken.
  if (typeof ResizeObserver === 'function') {
    let wacht = null;
    new ResizeObserver(() => {
      if (wacht) clearTimeout(wacht);
      wacht = setTimeout(() => {
        wacht = null;
        if (!naScrollen(getActiveDocument()).uitsnedesBijwerken) return;
        reclipAllContinuousAnnotationCanvases();
        werkScherpeUitsnedesBij();
      }, 150);
    }).observe(container);
  }
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

// Issue #336: in de doorlopende weergave moet #canvas-wrapper met de
// BREEDSTE pagina kunnen meegroeien (width: max-content via de klasse
// .continuous-mode in layout.css), anders centreert flexbox een bredere
// pagina met onbereikbare overloop links. In de enkelpagina-weergave
// behoudt de wrapper zijn vaste 100%-breedte.
function _setContinuousLayoutActive(on) {
  document.getElementById('canvas-wrapper')?.classList.toggle('continuous-mode', !!on);
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
  _setContinuousLayoutActive(continuousContainer.style.display !== 'none');

  // Cleanup previous observer
  if (_continuousObserver) {
    _continuousObserver.disconnect();
    _continuousObserver = null;
  }
  _renderedPages.clear();
  // De pagina's worden opnieuw opgebouwd: lopende uitsnede-aanvragen horen
  // bij canvassen die verdwijnen.
  _vergeetScherpeUitsnedes();

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
      offsetXPt: pageX0,
      offsetYPt: pageY0,
      rotation: page.rotate || 0,
    };
    // Paginarotatie plus weergaverotatie (#200): de wrapper krijgt de maat
    // van de pagina zoals hij op het scherm ligt.
    const extraRotation = beeldRotatie(pageNum);
    const vpOpts = { scale };
    if (extraRotation) {
      vpOpts.rotation = (page.rotate + extraRotation) % 360;
    }
    const viewport = paginaViewport(page, vpOpts);

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
  // De lus stopt zodra een ander document voor staat of de weergave opnieuw
  // is opgebouwd (dan neemt een nieuwe lus het over), zie #506.
  if (pdfDoc.numPages > 1 && !doc.facingSpread) {
    const nogActueel = _startLowResLus(pdfDoc);
    (async () => {
      for (let p = 1; p <= Math.min(pdfDoc.numPages, 200); p++) {
        if (!nogActueel()) return;
        if (_lowResCache.has(_lowResKey(p, doc))) continue;
        try {
          await renderLowResPreview(doc, p, nogActueel);
        } catch {}
        // Yield to main thread every 5 pages
        if (p % 5 === 0) await new Promise(r => setTimeout(r, 0));
      }
    })();
  }
  meldSplit('weergaveGerenderd');
}

// Setup pointer events for continuous mode pages
const _paginaEventsGekoppeld = new WeakSet();
function setupContinuousPageEvents(canvas, pageNum) {
  // Store pageNum in dataset for the dispatcher's resolvePointerCoords
  canvas.dataset.page = pageNum;
  const cc0 = canvas.closest('.canvas-container-cont') || canvas;
  // Eén keer per paginacontainer: elke render roept dit aan.
  if (!eenmaalPerElement(_paginaEventsGekoppeld, cc0)) return;
  // Bind op de paginacontainer, niet op het annotatiecanvas: dat canvas is
  // een viewport-uitsnede en dekt de pagina niet volledig — buiten de
  // uitsnede zou een klik anders in een dode zone vallen. Het filter
  // repliceert het oude bereik: lagen die bewust bóven het canvas staan
  // (tekst/formulier/link) houden hun eigen gedrag, en pointer-events:none
  // op het canvas (tekst-toegang van het select-/editText-gereedschap)
  // schakelt de afhandeling uit zoals voorheen.
  const cc = canvas.closest('.canvas-container-cont') || canvas;
  cc.dataset.page = pageNum;
  const magAfhandelen = (e) => {
    if ((canvas.style.pointerEvents || '') === 'none') return false;
    const t = e.target;
    if (t === cc || t === canvas) return true;
    return !!(t.classList && (t.classList.contains('pdf-canvas') || t.classList.contains('annotation-canvas')));
  };
  // Import event handlers dynamically to avoid circular dependencies
  import('../tools/tool-dispatcher.js').then(({ handlePointerDown, handlePointerMove, handlePointerUp, handlePointerCancel, handleDblClick }) => {
    const wrap = (fn) => (e) => { if (magAfhandelen(e)) fn(e); };
    cc.addEventListener('pointerdown', wrap(handlePointerDown));
    cc.addEventListener('pointermove', wrap(handlePointerMove));
    cc.addEventListener('pointerup', wrap(handlePointerUp));
    // Vinger of pen afgebroken (#671): het gebaar netjes afronden.
    cc.addEventListener('pointercancel', wrap(handlePointerCancel));
    cc.addEventListener('dblclick', wrap(handleDblClick));
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

/**
 * Show the page area that belongs to a document's view mode: the single-page
 * canvas or the continuous container. Each document keeps its own view mode
 * while the two areas are shared, so this runs on every view mode change AND
 * on every tab switch. Without it a switch from a continuous document to a
 * single-page one left the previous document's pages on screen.
 */
export function zetWeergaveLayout(doc) {
  const singleContainer = document.getElementById('canvas-container');
  const continuousContainer = document.getElementById('continuous-container');
  const pdfContainer = document.getElementById('pdf-container');
  if (!doc || !singleContainer || !continuousContainer) return;
  if (doc.viewMode === 'single') {
    singleContainer.style.display = 'inline-block';
    continuousContainer.style.display = 'none';
    _setContinuousLayoutActive(false);
  } else {
    singleContainer.style.display = 'none';
    continuousContainer.style.display = (doc.bookSpread || doc.facingSpread) ? 'grid' : 'flex';
    _setContinuousLayoutActive(true);
    // CRUCIAAL: single-/rasterweergave zet #pdf-container inline op
    // `overflow:hidden` (het viewport-singleton bezit dan de pan/zoom).
    // Doorlopende/boekweergave scrollt juist NATIEF via deze container.
    // Zonder deze reset blijft de inline `hidden` staan na één single-render
    // en kan de gebruiker niet meer scrollen. Terug naar '' laat de CSS-regel
    // (.main-view #pdf-container.visible { overflow:auto }) het overnemen.
    if (pdfContainer) pdfContainer.style.overflow = '';
  }
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
  const continuousContainer = document.getElementById('continuous-container');
  zetWeergaveLayout(doc);

  if (doc.viewMode === 'single') {
    await renderPage(doc.currentPage);
  } else {
    await renderContinuous();
    // Stay on the page the user was reading — the rebuild starts at page 1.
    const wrapper = continuousContainer.querySelector(`.page-wrapper[data-page="${doc.currentPage}"]`);
    if (wrapper) wrapper.scrollIntoView({ block: 'start' });
  }
}

// Go to specific page.
// `options.skipScroll` laat het scrollen aan de aanroeper over. Een hyperlink
// met een /XYZ- of /FitH-bestemming wil naar een positie MIDDEN op de pagina;
// de standaard scrollIntoView({behavior:'smooth'}) hieronder loopt door nadat
// deze functie is teruggekeerd en zou die positie weer overschrijven.
export async function goToPage(pageNum, options = {}) {
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
    // Render at the document's zoom and pan. A sidebar-sized thumbnail over
    // the fixed viewport canvas would flash a fit-to-window page here (#854).
    await renderPage(pageNum);
    const pdfContainer = document.getElementById('pdf-container');
    if (pdfContainer && !options.skipScroll) {
      pdfContainer.scrollTop = 0;
    }
  } else {
    // Scroll to page in continuous mode
    const pageWrapper = document.querySelector(`.page-wrapper[data-page="${pageNum}"]`);
    if (pageWrapper && !options.skipScroll) {
      // Een lopende wieluitloop zou deze vloeiende sprong afbreken (#522).
      stopAlleWielScrollers();
      pageWrapper.scrollIntoView({ behavior: scrollGedrag(), block: 'start' });
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
// PDF.js single-page views (web and unsaved documents) scroll the page-sized
// canvas instead of using the native viewport's pan offsets. Preserve the
// point in that canvas through its actual CSS resize, including fixed chrome
// and page rotation. Scroll limits still apply when a page fits an axis.
function singlePageZoomAnchor(doc, point) {
  const container = document.getElementById('pdf-container');
  const canvas = getPdfCanvas();
  if (!container || !canvas) return null;
  const rectBefore = canvas.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const anchor = point ?? {
    x: containerRect.left + container.clientLeft + container.clientWidth / 2,
    y: containerRect.top + container.clientTop + container.clientHeight / 2,
  };
  const pageNum = doc.currentPage;
  const scale = doc.scale;
  return () => {
    if (getActiveDocument() !== doc || doc.currentPage !== pageNum || doc.scale !== scale) return;
    const { dx, dy } = anchorScrollCorrection(anchor, rectBefore, canvas.getBoundingClientRect());
    container.scrollLeft += dx;
    container.scrollTop += dy;
  };
}

export async function zoomIn(point = null) {
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
  await renderPage(doc.currentPage, singlePageZoomAnchor(doc, point));
}

export async function zoomOut(point = null) {
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
    await renderPage(doc.currentPage, singlePageZoomAnchor(doc, point));
  }
}

// Zoom de PDF.js-weergave van één pagina naar een vaste schaal, met het punt
// `point` (client-coördinaten) als vast punt. Voor de zoomrechthoek van het
// hand-gereedschap (#1161); de vector-viewport en de doorlopende weergave
// hebben hun eigen route.
export async function zoomEnkelePaginaNaar(nieuweSchaal, point = null) {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc || !(nieuweSchaal > 0)) return;
  const schaal = Math.min(24, Math.max(0.05, nieuweSchaal));
  if (schaal === doc.scale) return;
  doc.scale = schaal;
  await renderPage(doc.currentPage, singlePageZoomAnchor(doc, point));
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
  // Zoals de pagina op het scherm ligt: met de weergaverotatie (#200).
  const extraRot = beeldRotatie(doc.currentPage);
  const opts = { scale: 1 };
  if (extraRot) opts.rotation = (page.rotate + extraRot) % 360;
  const pageViewport = paginaViewport(page, opts);
  const container = document.getElementById('pdf-container');
  if (!container) return null;
  // Verborgen viewer: niets om in te passen, zoom laten staan (#675).
  if (!(container.clientWidth > 0 && container.clientHeight > 0)) return null;
  const fit = {
    mode: 'legacy',
    pageW: pageViewport.width,
    pageH: pageViewport.height,
    canvasW: container.clientWidth,
    canvasH: container.clientHeight,
    doc,
  };
  // Doorlopende weergave (issue #336): alle pagina's delen één schaal, dus
  // fit-breedte moet op de BREEDSTE pagina van het document passen — niet op
  // de huidige. Anders bepaalt een smallere (bv. eerste) pagina de zoom en
  // valt een bredere pagina deels buiten beeld.
  if (doc.viewMode === 'continuous') {
    fit.maxPageW = await _maxContinuousPageWidthPt(doc);
  }
  return fit;
}

// Breedste effectieve paginabreedte (PDF-punten, ná intrinsieke rotatie +
// eventuele gebruikersrotatie) over alle pagina's. Gebruikt per pagina de door
// renderContinuous() gevulde doc.pageDims-cache en valt voor ontbrekende
// pagina's terug op getPage().
async function _maxContinuousPageWidthPt(doc) {
  let maxW = 0;
  for (let p = 1; p <= doc.pdfDoc.numPages; p++) {
    const dims = doc.pageDims?.[p];
    let wPt, hPt, baseRot;
    if (dims) {
      wPt = dims.widthPt;
      hPt = dims.heightPt;
      baseRot = dims.rotation || 0;
    } else {
      const page = await doc.pdfDoc.getPage(p);
      const [x0, y0, x1, y1] = page.view;
      wPt = x1 - x0;
      hPt = y1 - y0;
      baseRot = page.rotate || 0;
    }
    // Zoals de pagina op het scherm ligt: met de weergaverotatie (#200).
    const totalRot = normaliseerRotatie(baseRot + beeldRotatie(p));
    maxW = Math.max(maxW, isKwartslag(totalRot) ? hPt : wPt);
  }
  return maxW;
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
  const m = await import('./pdf-viewport.js');
  if (fit.mode === 'vector') {
    // Zelfde centreringscontract als fitPage(): de oude route zette alleen de
    // zoom en behield de pan-offset, waardoor de pagina na navigatie tussen
    // afwijkende formaten deels buiten beeld bleef staan.
    m.fitToViewport('width');
    return;
  }
  // Doorlopende weergave: fit op de breedste pagina (zie _getFitInputs,
  // issue #336) zodat elke pagina volledig binnen de breedte past; smallere
  // pagina's worden door de flex-layout gecentreerd.
  const fitW = fit.maxPageW || fit.pageW;
  const newZoom = m.computeFitZoom('width', fitW, fit.pageH, fit.canvasW, fit.canvasH, 0);
  await _applyZoom(fit, newZoom);
}

export async function fitPage() {
  const fit = await _getFitInputs();
  if (!fit) return;
  const m = await import('./pdf-viewport.js');
  if (fit.mode === 'vector') {
    // Canonieke fit + centrering. De vorige route (setZoomAtPoint verankerd op
    // het canvas-midden) zette wel de juiste zoom maar behield de bestaande
    // pan-offset. Na paginanavigatie binnen een document met afwijkende
    // paginaformaten (A4 -> A0) stond de pagina daardoor deels of geheel
    // buiten beeld — terwijl clampAndCenter() bewust een no-op is met als
    // contract: "de gebruiker her-centreert met Fit Page". fitToViewport()
    // centreert expliciet en gebruikt bovendien de post-rotatie-afmetingen.
    m.fitToViewport();
    return;
  }
  const newZoom = m.computeFitZoom('page', fit.pageW, fit.pageH, fit.canvasW, fit.canvasH, 0);
  await _applyZoom(fit, newZoom);
}

// "Zoom alles" (issue #767, dubbelklik met de middelste muisknop): enkele
// pagina = fitPage(); doorlopend = de pagina in het midden van het venster
// passend maken en gecentreerd houden. Volgorde in zoom-alles.js.
export async function zoomAlles() {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return;
  const container = document.getElementById('pdf-container');
  const wrapperVan = (p) => document.querySelector(`#continuous-container .page-wrapper[data-page="${p}"]`);
  await voerZoomAllesUit({
    weergaveModus: () => doc.viewMode,
    boekweergave: () => !!doc.facingSpread,
    referentiePagina: () => {
      const els = container ? [...document.querySelectorAll('#continuous-container .page-wrapper')] : [];
      if (!els.length) return doc.currentPage || null;
      const box = container.getBoundingClientRect();
      const idx = pickAnchorPageIndex(els.map((el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      }), box.top + box.height / 2, box.left + box.width / 2);
      const p = idx >= 0 ? parseInt(els[idx].dataset.page, 10) : NaN;
      return Number.isFinite(p) ? p : (doc.currentPage || null);
    },
    zetHuidigePagina: (p) => {
      if (doc.currentPage === p) return;
      doc.currentPage = p;
      updateActiveThumbnail();
      updateAllStatus();
    },
    passendOpPagina: () => fitPage(),
    centreerPagina: (p) => {
      const el = wrapperVan(p);
      const pagina = el?.querySelector('.canvas-container-cont') || el;
      if (!container || !pagina) return;
      stopAlleWielScrollers();
      const { dx, dy } = centreerCorrectie(pagina.getBoundingClientRect(), container.getBoundingClientRect());
      container.scrollLeft += dx;
      container.scrollTop += dy;
    },
  });
}

export async function actualSize() {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc) return;

  // Werkelijke grootte = 100%. Is dit scherm gekalibreerd (issue #520,
  // Voorkeuren > Paginaweergave), dan pxPerInch / 72, zodat een A4 met een
  // liniaal gemeten 210 mm breed is. Zonder kalibratie bepaalt de voorkeur
  // 'Schermresolutie voor 100% zoom' het (#523): zoomDpi / 72 CSS-pixels per
  // PDF-punt. Dezelfde regel als het percentage in de statusbalk
  // (zoom-display.js). Alleen de weergavezoom: de bitmap volgt zoals altijd
  // zoom * devicePixelRatio, dus de schermschaal telt niet dubbel.
  const kalibratie = kalibratieVoor(state.preferences?.screenCalibration, window.devicePixelRatio || 1);
  const zoom = kalibratie != null
    ? werkelijkeGrootteZoom(kalibratie)
    : cssPxPerPtAt100(state.preferences?.zoomDpi);

  // Vector viewport mode: anchored at canvas center.
  const vp = window.__pdfViewport;
  // Same blank-doc guard as zoomIn() — see comment there.
  if (vp && vp.active && doc.filePath) {
    const pdfCanvas = document.getElementById('pdf-canvas');
    if (!pdfCanvas) return;
    const m = await import('./pdf-viewport.js');
    // Anchor in CSS pixels (same unit as zoomStepAtCenter) — the backing
    // store is dpr-scaled and would mis-centre on 125%/150% displays.
    const dpr = window.devicePixelRatio || 1;
    m.setZoomAtPoint(pdfCanvas.width / dpr / 2, pdfCanvas.height / dpr / 2, zoom);
    return;
  }

  if (doc.viewMode === 'continuous' && doc.pdfDoc) {
    const _old = doc.scale;
    doc.scale = zoom;
    await _continuousRezoom(_old);
    return;
  }
  doc.scale = zoom;
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

export function rotateAnnotation(ann, normDelta, oldW, oldH) {
  if (normDelta === 0) return;
  let boundsHandled = false;

  // Leesrichting van tekstgebonden annotaties (markeringen, invoegteken,
  // #508) draait mee: verticale tekst krijgt zo een doorhaling langs de tekst
  // en de juiste quadvolgorde bij het opslaan.
  if (isTextAnchored(ann)) ann.textDir = rotateTextDir(ann.textDir, normDelta);

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

  // Gedraaide quads van een markering op schuine tekst (#927).
  if (Array.isArray(ann.quads)) {
    ann.quads = ann.quads.map(q => (Array.isArray(q) ? q.map(p => rotatePoint(p.x, p.y, normDelta, oldW, oldH)) : q));
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

// `tekenen: false` laat het opnieuw tekenen aan de aanroeper: pagina-draaien.js
// draait meerdere pagina's en tekent daarna één keer (#464).
export async function rotatePage(delta, targetPage, { tekenen = true } = {}) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return;
  const pageNum = targetPage || doc.currentPage;
  const current = getPageRotation(pageNum);

  // Get old viewport dimensions (at current rotation) for annotation transform
  const page = await doc.pdfDoc.getPage(pageNum);
  const oldViewport = paginaViewport(page, { scale: 1, rotation: (page.rotate + current) % 360 });
  const normDelta = ((delta % 360) + 360) % 360;

  // Transform annotation coordinates to match new rotation
  rotateAnnotationsForPage(pageNum, normDelta, oldViewport.width, oldViewport.height);
  // The measure scales the PDF itself carries (/VP) live in the same display
  // space as the annotations: turn them along, or a dimension line would fall
  // outside every viewport (or into the neighbour's) until save + reopen (#400).
  if (doc.pdfViewports?.[pageNum]) {
    const { draaiViewports } = await import('./pdf-viewports.js');
    doc.pdfViewports[pageNum] = draaiViewports(doc.pdfViewports[pageNum], normDelta, oldViewport.width, oldViewport.height);
  }

  setPageRotation(pageNum, current + delta);

  // Mark document as modified
  if (doc) doc.modified = true;

  // Re-render
  if (tekenen) {
    if (doc?.viewMode === 'continuous') {
      await renderContinuous();
    } else {
      await renderPage(pageNum);
    }
  }

  // Update thumbnails
  const { invalidateThumbnail } = await import('../ui/panels/left-panel.js');
  invalidateThumbnail(pageNum);
}

// Doorlopende weergave opnieuw opbouwen in de stand van nu (na weergave
// draaien, #200) en op de pagina blijven die de gebruiker las: de opbouw
// begint anders weer bij pagina 1.
export async function tekenDoorlopendOpnieuw() {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc || doc.viewMode !== 'continuous') return;
  const pagina = doc.currentPage;
  await renderContinuous();
  if (doc.facingSpread) return;
  const wrapper = document.querySelector(`#continuous-container .page-wrapper[data-page="${pagina}"]`);
  if (wrapper) wrapper.scrollIntoView({ block: 'start' });
}

// Het beeld opnieuw opbouwen in de draaistand van nu: na het draaien van
// pagina's, en na ongedaan maken of opnieuw doen daarvan. Tekent de pagina die
// de gebruiker bekijkt, niet de laatst gedraaide.
export async function tekenNaPaginaRotatie() {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return;
  if (doc.viewMode === 'continuous') {
    await renderContinuous();
  } else {
    await renderPage(doc.currentPage);
  }
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
  // De caches hieronder sluiten ook de getoonde bitmap.
  import('./pdf-viewport.js').then(m => m.laatBitmapsLos()).catch(() => {});

  // Clear single page mode canvases
  const pdfCtx = pdfCanvas.getContext('2d');
  pdfCtx.clearRect(0, 0, pdfCanvas.width, pdfCanvas.height);
  const annotationCtx = annotationCanvas.getContext('2d');
  annotationCtx.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);

  // Clear caches
  _lowResCache.clear();
  _renderedPages.clear();
  _contPageRenderGen.clear();
  _vergeetScherpeUitsnedes();
  _vergeetAchtergronden();

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
