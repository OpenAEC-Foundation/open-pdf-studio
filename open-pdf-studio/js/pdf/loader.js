import { state, getNextUntitledName, getActiveDocument } from '../core/state.js';
import { showLoading, hideLoading } from '../ui/chrome/dialogs.js';
import { updateAllStatus } from '../ui/chrome/status-bar.js';
import { setViewMode, fitPage } from './renderer.js';
import { generateThumbnails, refreshActiveTab } from '../ui/panels/left-panel.js';
import { createTab, updateWindowTitle, markDocumentModified } from '../ui/chrome/tabs.js';
import * as pdfjsLib from 'pdfjs-dist';
import { isTauri, readBinaryFile, openFileDialog, lockFile, invoke } from '../core/platform.js';
import { PDFDocument } from 'pdf-lib';
import { resetAnnotationStorage } from './form-layer.js';
import { addRecentFile, getRecentFiles } from '../mobile/recent-files.js';
import { extractFileName } from '../core/platform.js';
import i18next from '../i18n/config.js';
import { showMessage } from '../bridge.js';

// Sub-module imports
import { extractAnnotationColors } from './loader/color-extraction.js';
import { extractStampImagesHybrid } from './loader/image-extraction.js';
import { convertPdfAnnotation } from './loader/annotation-converter.js';


// Convert one batch of pdf.js annotations and push them to doc.annotations,
// detecting textbox-leader PolyLines (linked via IRT) and attaching them
// to their parent textbox instead of pushing a standalone annotation.
async function _convertAndPushAnnotations(annots, pageNum, viewport, stampImageMap, annotColorMap, doc) {
  const textboxByRect = new Map();
  const pendingLeaders = [];
  for (const annot of annots) {
    const converted = await convertPdfAnnotation(annot, pageNum, viewport, stampImageMap, annotColorMap);
    if (!converted) continue;
    if (converted.__textboxLeader) {
      pendingLeaders.push(converted);
      continue;
    }
    if (converted.type === 'textbox' && converted._pdfRectKey) {
      textboxByRect.set(converted._pdfRectKey, converted);
    }
    doc.annotations.push(converted);
  }
  for (const pl of pendingLeaders) {
    const parent = textboxByRect.get(pl.irtRectKey);
    if (parent) {
      if (!Array.isArray(parent.leaders)) parent.leaders = [];
      parent.leaders.push(pl.leader);
    }
  }
  for (const tb of textboxByRect.values()) delete tb._pdfRectKey;
}

// Cache for original PDF bytes (used by saver to avoid re-reading)
const originalBytesCache = new Map(); // filePath -> Uint8Array

export function getCachedPdfBytes(filePath) {
  return originalBytesCache.get(filePath);
}

export function setCachedPdfBytes(filePath, bytes) {
  originalBytesCache.set(filePath, bytes);
}

/**
 * Reload a document's pdfDoc from new bytes (used by Find & Replace).
 * Updates the pdf.js document object without reloading the entire UI.
 */
export async function reloadDocumentFromBytes(doc, bytes) {
  if (!doc) return;

  doc._sharedPdfLibDoc = null;
  doc._sharedPdfLibDocPromise = null;

  // Replace the pdf.js document with one loaded from the new bytes
  doc.pdfDoc = await pdfjsLib.getDocument({
    data: bytes.slice(), // copy — pdf.js transfers the buffer
    cMapUrl: '/pdfjs/web/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/web/standard_fonts/',
    isEvalSupported: false,
    verbosity: 0,
  }).promise;

  doc.modified = true;
}

export function clearCachedPdfBytes(filePath) {
  if (filePath) {
    originalBytesCache.delete(filePath);
  } else {
    originalBytesCache.clear();
  }
}

// Set worker source (path relative to HTML file, not this module)
// Dev: Vite herschrijft de new URL(...)-vorm naar een /@fs/-URL en die valt
// onder server.fs.allow — een verse webview (zonder cache) krijgt daar 403 op,
// waarna PDF.js' fake-worker-fallback op dezelfde 403 strandt en getDocument
// nooit resolvet (document laadt nooit). Het kale /node_modules/-pad wordt
// altijd geserveerd, dus gebruik dat in dev; prod houdt de asset-URL (de
// worker wordt door rollup als asset geëmit — zie assetFileNames in
// vite.config.js).
pdfjsLib.GlobalWorkerOptions.workerSrc = import.meta.env?.DEV
  ? '/node_modules/pdfjs-dist/build/pdf.worker.mjs'
  : new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href;

/**
 * Wrap doc.pdfDoc.getPage with a recovery layer that re-loads the doc when
 * PDF.js's shared-static PagesMapper rejects a valid page (see callsite for
 * full bug description). The recovery rebinds `doc.pdfDoc` to a freshly
 * loaded WorkerTransport whose PagesMapper static reflects THIS doc's
 * numPages. Re-attaches the wrapper to the new pdfDoc so the next bug hit
 * also recovers automatically.
 */
function _attachPdfDocGetPageRecovery(doc, filePath) {
  if (!doc?.pdfDoc) return;
  const orig = doc.pdfDoc.getPage.bind(doc.pdfDoc);
  doc.pdfDoc.getPage = async function (pageNum) {
    try {
      return await orig(pageNum);
    } catch (e) {
      const msg = e?.message || '';
      if (msg === 'Invalid page request.' && Number.isInteger(pageNum)
          && pageNum > 0 && pageNum <= doc.pdfDoc.numPages) {
        console.warn(`[loader] PDF.js pagesMapper out of sync (numPages=${doc.pdfDoc.numPages}, requested ${pageNum}); reloading doc to reset.`);
        const cached = originalBytesCache.get(filePath);
        if (!cached) throw e;
        const fresh = await pdfjsLib.getDocument({
          data: cached.slice(),
          cMapUrl: '/pdfjs/web/cmaps/',
          cMapPacked: true,
          standardFontDataUrl: '/pdfjs/web/standard_fonts/',
          isEvalSupported: false,
          verbosity: 0,
        }).promise;
        doc.pdfDoc = fresh;
        _attachPdfDocGetPageRecovery(doc, filePath); // protect future calls
        return await doc.pdfDoc.getPage(pageNum);
      }
      throw e;
    }
  };
}

// ─── PDF/A compliance bar ──────────────────────────────────────────────────────

async function checkPdfACompliance(doc) {
  try {
    if (!doc || !doc.pdfDoc) return;
    const meta = await doc.pdfDoc.getMetadata();
    const metadata = meta && meta.metadata;
    if (!metadata) return;
    const part = metadata.get('pdfaid:part');
    const conformance = metadata.get('pdfaid:conformance');
    if (part) {
      doc.pdfaCompliance = { part, conformance: conformance || null };
      // Only show bar if this document is active
      if (state.documents[state.activeDocumentIndex] === doc) {
        showPdfABar(part, conformance, doc);
      }
    }
  } catch (e) {
    // Metadata not available – ignore
  }
}

function showPdfABar(part, conformance, doc) {
  if (!doc) return;
  if (doc.pdfADismissed) return;
  const label = `PDF/A-${part}${conformance ? conformance.toLowerCase() : ''}`;
  const text = `This document complies with the ${label} standard and has been opened read-only to prevent modification.`;
  import('../solid/stores/pdfaBarStore.js').then(m => m.showPdfABar(text));

  // Disable annotation tool buttons
  import('../tools/manager.js').then(m => m.updatePdfAToolState());
}

export function hidePdfABar() {
  import('../solid/stores/pdfaBarStore.js').then(m => m.hidePdfABar());
}

export function dismissPdfAForActiveDoc() {
  const activeDoc = state.documents[state.activeDocumentIndex];
  if (activeDoc) activeDoc.pdfADismissed = true;
  hidePdfABar();
  import('../tools/manager.js').then(m => m.updatePdfAToolState());
}

// Check if the active document is PDF/A and editing has NOT been enabled
export function isPdfAReadOnly() {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc) return false;
  if (!doc.pdfaCompliance) return false;
  return !doc.pdfADismissed;
}

// Load PDF from file path into a specific document by index.
// Optional preloadedData (Uint8Array) bypasses FS plugin read.
export async function loadPDF(filePath, docIndex, preloadedData = null) {
  const doc = state.documents[docIndex];
  if (!doc) return;

  // Guard against loading into a document that's already loading
  if (doc._isLoading) return;
  doc._isLoading = true;

  // Helper: check if this document is the currently active one
  const isActive = () => state.documents[state.activeDocumentIndex] === doc;
  // Helper: check if document was closed during async operations
  const isClosed = () => !state.documents.includes(doc);

  try {
    const _t0 = performance.now();
    console.log('[PERF] ===== loadPDF START =====', filePath);
    if (isActive()) showLoading('Loading PDF...');

    // Ensure Tauri FS scope access for this file path (needed for Rust backend)
    if (filePath && window.__TAURI__) {
      try { await window.__TAURI__.core.invoke('allow_fs_scope', { path: filePath }); } catch {}
    }

    // ─── COLD-OPEN PARALLEL PRE-RENDER ───────────────────────────────────────
    // PDF.js getDocument burns 500-1000 ms on construction PDFs (24 MB NKD1a:
    // ~590 ms) just parsing xref/catalog/page-tree, blocking the first-page
    // render. But Rust render_pdf_page doesn't need PDF.js — it reads the
    // file itself (std::fs) and renders via PDFium. By firing it in parallel
    // with the JS file-read + getDocument, we can paint a bitmap PREVIEW of
    // page 1 hundreds of ms before the proper render runs. The proper
    // vector/raster path paints over it once PDF.js is ready; for vector
    // pages the bitmap is harmlessly overdrawn by sharper vector commands.
    //
    // Race / correctness:
    //   - !isActive() (user switched tab during async) → skip paint
    //   - doc.pdfDoc already set (proper render won the race) → skip paint
    //   - Pre-render fails (parse error, etc.) → silent, normal flow continues
    //   - scale=1.0 means w pixels = w points; viewport stretches to user zoom
    //   - originX/originY assumed 0; if MediaBox origin is non-zero (rare),
    //     preview is briefly mis-positioned by a few pt — corrected once
    //     proper render fires
    let _preT0 = performance.now();
    // Zware pagina's (grote content-stream) slaan de pre-render over: een
    // whole-page render kost daar SECONDEN en zou — gepind op één worker —
    // vóór de progressieve tegels in de rij staan. Het progressieve pad
    // levert de eerste content daar zelf. (isHeavyPage cachet per bestand;
    // de check zelf kost ~100 ms eenmalig.)
    let _skipPre = false;
    if (filePath && isTauri()) {
      try {
        const prog = await import('./progressive-render.js');
        _skipPre = !!(state.preferences && state.preferences.progressiveRender)
          && await prog.isHeavyPage(filePath, 1);
        if (_skipPre) console.log('[prog-guard] zware pagina → cold-open pre-render overgeslagen');
      } catch {}
    }
    // The pre-render is an optimisation, not a requirement: when the PDFium
    // worker pool hasn't finished spawning (cold start via file association),
    // it would fall back to an in-process parse in the main process while
    // PDF.js parses the same bytes — on large documents that doubles peak
    // memory during boot and can take the whole load down. Skip it then.
    let _poolReady = false;
    if (filePath && isTauri() && !_skipPre) {
      try { _poolReady = await invoke('worker_pool_ready'); } catch { _poolReady = false; }
      if (!_poolReady) console.log('[prog-guard] worker pool not ready → cold-open pre-render skipped');
    }
    if (filePath && isTauri() && !_skipPre && _poolReady) {
      const { renderPdfPage: _renderPdfPage } = await import('./engine-router.js');
      _renderPdfPage({
        path: filePath,
        pageIndex: 0,
        scale: 1.0,
        rotation: 0,
      }).then(async (rgbaData) => {
        if (!rgbaData || isClosed() || doc.pdfDoc || !isActive()) return;
        try {
          const bytes = rgbaData instanceof Uint8Array ? rgbaData : new Uint8Array(rgbaData);
          if (bytes.length <= 8) return;
          const view = new DataView(bytes.buffer, bytes.byteOffset, 8);
          const w = view.getUint32(0, true);
          const h = view.getUint32(4, true);
          const rgba = new Uint8ClampedArray(bytes.buffer, bytes.byteOffset + 8, bytes.length - 8);
          const imageData = new ImageData(rgba, w, h);
          const bitmap = await createImageBitmap(imageData);
          if (isClosed() || doc.pdfDoc || !isActive()) { bitmap.close(); return; }
          const vp = await import('./pdf-viewport.js');
          vp.setPage(filePath, 1, w, h, 0, 0, 0);
          window.__pdfViewport.currentBitmap = bitmap;
          window.__pdfViewport.pageType = 'raster';
          window.__pdfViewport.dirty = true;
          console.log(`[PERF] cold-open preview painted: ${(performance.now() - _preT0).toFixed(0)}ms (${w}x${h})`);
        } catch (e) {
          console.warn('[PERF] cold-open preview paint failed:', e?.message ?? e);
        }
      }).catch((e) => {
        console.warn('[PERF] cold-open pre-render failed:', e?.message ?? e);
      });
    }

    let typedArray;

    if (preloadedData) {
      // Use pre-loaded bytes (e.g. from virtual printer capture, or browser file input)
      typedArray = preloadedData instanceof Uint8Array ? preloadedData : new Uint8Array(preloadedData);
      originalBytesCache.set(filePath, typedArray.slice());
    } else {
      if (isTauri()) {
        // Lock the file to prevent other apps from writing while we have it open
        // (skip on Android — content:// URIs don't support filesystem locking)
        const { isMobile } = await import('../core/platform.js');
        if (isClosed()) return;
        if (!isMobile()) {
          await lockFile(filePath);
          if (isClosed()) return;
        }
      }

      // Read file using Tauri fs plugin or web file cache
      const data = await readBinaryFile(filePath);
      if (isClosed()) return;
      if (!data) throw new Error('File system access not available');
      typedArray = new Uint8Array(data);

      // Cache a copy of original bytes for saver (pdf.js transfers the buffer
      // to a web worker, which detaches the original Uint8Array making it length 0)
      originalBytesCache.set(filePath, typedArray.slice());
    }
    console.log(`[PERF] File read done: ${(performance.now() - _t0).toFixed(0)}ms, size: ${typedArray.length} bytes`);

    // Load PDF using pdf.js (this transfers the buffer to a worker)
    doc.pdfDoc = await pdfjsLib.getDocument({
      data: typedArray,
      cMapUrl: '/pdfjs/web/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/pdfjs/web/standard_fonts/',
      isEvalSupported: false,
      verbosity: 0,
    }).promise;
    if (isClosed()) return;
    console.log(`[PERF] PDF.js getDocument done: ${(performance.now() - _t0).toFixed(0)}ms, pages: ${doc.pdfDoc.numPages}`);

    // ─── PDF.js v5.4 multi-doc pagesMapper RECOVERY PATCH ─────────────────
    // PDF.js 5.4 introduced a regression: PagesMapper.#pagesNumber is a
    // STATIC class field shared across all WorkerTransport instances. The
    // GetDoc message handler does
    //   this.#pagesMapper.pagesNumber = pdfInfo.numPages;
    // which OVERWRITES the static every time a new doc loads. After
    // opening a 5-page doc and then switching back to a 7-page doc,
    // pdfDoc.numPages still says 7 but pagesMapper says 5 — getPage(6)
    // and getPage(7) reject with "Invalid page request."
    //
    // We can't access the private static directly. Recovery: when getPage
    // fails for a page within doc.numPages, re-load the doc via
    // pdfjsLib.getDocument which re-runs the GetDoc handler and resets
    // pagesMapper to the correct count. ~500 ms cost on recovery only.
    _attachPdfDocGetPageRecovery(doc, filePath);

    // ─── BACKGROUND ANALYZE PRE-WARM ─────────────────────────────────────
    // analyze_page_type is what makes per-page navigation feel slow on
    // construction PDFs — the lopdf operator decoder takes 500-2800 ms per
    // huge content-stream page (NKD1a p2: ~2787 ms). Even with the new
    // size-shortcut in analyze_page_type, the FIRST call to each page still
    // pays the dict + size check. Fire one batch invoke for all pages in
    // parallel (rayon on the Rust side, populates PageTypeCache) so by the
    // time the user navigates anywhere, the result is a cached HashMap
    // lookup. Total batch cost on NKD1a: ~50 ms total instead of ~600 ms
    // × 7 pages sequentially as the user scrolls.
    if (filePath && isTauri() && doc.pdfDoc.numPages > 1) {
      const _abT0 = performance.now();
      const allPages = Array.from({ length: doc.pdfDoc.numPages }, (_, i) => i);
      window.__TAURI__.core.invoke('analyze_page_type_batch', {
        path: filePath,
        pageIndices: allPages,
      }).then(async (results) => {
        // Populate the JS-side cache so renderer.js skips the analyze IPC
        // entirely on subsequent navigations — critical because during
        // cold-open the IPC queue is saturated by thumbnail invokes and
        // a single analyze invoke can wait 1+ second despite the Rust
        // cache being warm.
        try {
          const ptcMod = await import('./page-type-cache.js');
          ptcMod.cacheBatchResults(filePath, results);
        } catch (e) {
          console.warn('[PERF] page-type-cache populate failed:', e?.message ?? e);
        }
        console.log(`[PERF] analyze_page_type_batch ${doc.pdfDoc.numPages} pages: ${(performance.now() - _abT0).toFixed(0)}ms ` +
          `(vector=${results.filter(r => r === 'vector').length}, tile=${results.filter(r => r === 'tile').length})`);
      }).catch((e) => {
        console.warn('[PERF] analyze_page_type_batch failed:', e?.message ?? e);
      });
    }

    doc.filePath = filePath;
    doc.fileName = filePath ? filePath.split(/[\\/]/).pop() : 'Untitled';

    // Reset annotation state (per-document)
    doc.annotations = [];
    doc._loadedAnnotationPages.clear();
    doc._pagesNeedingColorUpdate.clear();
    doc._sharedPdfLibDoc = null;
    doc._sharedPdfLibDocPromise = null;
    doc.undoStack = [];
    doc.redoStack = [];
    doc.selectedAnnotation = null;
    doc.selectedAnnotations = [];
    doc.currentPage = 1;

    // Eagerly start pdf-lib loading in background (don't await - runs in parallel with first paint)
    getSharedPdfLibDoc(doc);

    // UI operations — only if this is the active document
    if (isActive()) {
      // Reset form field annotation storage for the new document
      resetAnnotationStorage();

      // Hide PDF/A bar from previous document
      hidePdfABar();

      // Show PDF container, hide placeholder
      const placeholder = document.getElementById('placeholder');
      const pdfContainer = document.getElementById('pdf-container');
      if (placeholder) placeholder.style.display = 'none';
      if (pdfContainer) pdfContainer.classList.add('visible');

      // Render first page immediately (before annotation loading)
      console.log(`[PERF] setViewMode START: ${(performance.now() - _t0).toFixed(0)}ms`);
      await setViewMode(doc.viewMode);
      if (isClosed()) return;
      console.log(`[PERF] setViewMode DONE: ${(performance.now() - _t0).toFixed(0)}ms`);
      hideLoading();

      // Check for PDF/A compliance and show info bar if applicable
      checkPdfACompliance(doc);

      // Generate thumbnails for left panel
      console.log(`[PERF] generateThumbnails START: ${(performance.now() - _t0).toFixed(0)}ms`);
      generateThumbnails();
    } else {
      // Not active — still check PDF/A but don't show bar
      checkPdfACompliance(doc);
    }

    // Load bookmarks from PDF outline (data-only, always run)
    console.log(`[PERF] bookmarks START: ${(performance.now() - _t0).toFixed(0)}ms`);
    {
      const { loadBookmarksFromPdf } = await import('../ui/panels/bookmarks.js');
      if (isClosed()) return;
      doc.bookmarks = await loadBookmarksFromPdf(doc.pdfDoc);
      if (isClosed()) return;
    }
    console.log(`[PERF] bookmarks DONE: ${(performance.now() - _t0).toFixed(0)}ms`);

    // Load named line-style presets from the PDF catalog (data-only,
    // non-blocking — waits on the shared pdf-lib doc that is already
    // loading eagerly in the background).
    {
      if (!Array.isArray(doc.stylePresets)) doc.stylePresets = [];
      getSharedPdfLibDoc(doc).then(async (pdfLibDoc) => {
        if (isClosed() || !pdfLibDoc) return;
        const { readStylePresetsFromCatalog } = await import('./saver/style-presets.js');
        if (isClosed()) return;
        const presets = readStylePresetsFromCatalog(pdfLibDoc);
        if (isClosed()) return;
        if (presets.length > 0) doc.stylePresets = presets;
      }).catch(() => { /* presets zijn optioneel — negeer leesfouten */ });
    }

    // Load persisted measure scale for this document (data-only)
    {
      const { loadDocumentScale } = await import('../annotations/measurement.js');
      if (isClosed()) return;
      loadDocumentScale(doc);
    }

    // Auto-detect scale from title block text if no scale is already set (fire-and-forget)
    if (!doc.measureScale) {
      import('../annotations/scale-bar.js').then(async ({ detectScaleFromPdf }) => {
        if (isClosed() || doc.measureScale) return;
        try {
          const result = await detectScaleFromPdf(1);
          if (isClosed() || doc.measureScale) return;
          if (result && result.ratio > 0) {
            const pixelsPerUnit = 72 / (25.4 * result.ratio);
            doc.measureScale = {
              pixelsPerUnit,
              unit: 'mm',
              method: 'auto-detect',
              scaleRatio: `1:${result.ratio}`,
            };
            const { saveDocumentScale } = await import('../annotations/measurement.js');
            saveDocumentScale();
            console.log(`Auto-detected scale: 1:${result.ratio} from "${result.scaleText}"`);
          }
        } catch (e) {
          // Non-critical — ignore auto-detect failures
        }
      });
    }

    // UI updates — only if active
    if (isActive()) {
      // Notify that a PDF has been loaded (listeners can reset tool, update UI, etc.)
      document.dispatchEvent(new CustomEvent('pdf-loaded'));

      // Refresh active left panel tab (e.g. attachments, layers, etc.)
      refreshActiveTab();

      // Update status bar
      updateAllStatus();

      // Update window title
      updateWindowTitle();
    }

    // Track in recent files (skip in-memory keys and untitled temp-backed
    // docs — their temp path is deleted on close and would clutter the list)
    if (filePath && !filePath.startsWith('__memory__') && !doc.isUntitled) {
      addRecentFile(filePath, extractFileName(filePath));
    }

    // Persist the session NOW (debounced) so a dev-reload or crash right
    // after opening doesn't lose the open-documents list.
    window.__OPDS_SESSION_SAVE__?.();

    // Load existing annotations in background (non-blocking).
    // Page 1 annotations are already loaded by ensureAnnotationsForPage() during
    // the first render. The rest load lazily page-by-page as the user navigates,
    // plus this background task pre-loads remaining pages without blocking the UI.
    loadExistingAnnotations(doc).then(async () => {
      console.log(`[PERF-BG] loadExistingAnnotations .then() callback START`);
      if (isClosed()) return;
      // Sync doc.measureScale from any loaded scaleBar annotations
      const loadedScaleBar = doc.annotations.find(a => a.type === 'scaleBar');
      if (loadedScaleBar) {
        const { syncDocScale } = await import('../annotations/scale-bar.js');
        syncDocScale(loadedScaleBar);
      }
      // Redraw annotations on the current page now that background loading is done
      if (isActive() && doc.pdfDoc) {
        console.log(`[PERF-BG] redrawAnnotations after bg load START`);
        const { redrawAnnotations } = await import('../annotations/rendering.js');
        redrawAnnotations();
        console.log(`[PERF-BG] redrawAnnotations after bg load DONE`);
      }
    }).catch((e) => { console.error('[PERF-BG] loadExistingAnnotations error:', e); });

    // Background prefetch for ALL pages, dispatched by per-page classification:
    //   - VECTOR pages → extract_draw_commands so thumbnails + main view hit
    //     the JS-replay cache instead of falling back to the Rust thumbnail
    //     path (which skips text operators and produces blank/colored
    //     placeholder thumbnails on text-heavy pages).
    //   - TILE pages → render_pdf_page at scale 1.0 so the Rust pixmap cache
    //     is warm. Without this, the FIRST time the user navigates to a
    //     tile-classified page (NKD1a pages 2-7, huge construction drawings)
    //     they wait 600-2500 ms for PDFium to walk all vector commands and
    //     produce the bitmap. With warm pixmap cache the navigation is
    //     ~150 ms total.
    //
    // Both go through the analyze cache (already populated by
    // analyze_page_type_batch earlier in loadPDF), so the per-page analyze
    // invoke is microseconds. Concurrency=2 keeps interactive renders
    // responsive.
    if (filePath && isTauri()) {
      (async () => {
        try {
          const vr = await import('./vector-renderer.js');
          const pbc = await import('./page-bitmap-cache.js');
          const numPages = doc.pdfDoc?.numPages || 0;
          if (numPages <= 0) return;

          let nextPage = 1;
          const CONCURRENCY = 2;
          let warmedVector = 0;
          let warmedTile = 0;

          const worker = async () => {
            while (true) {
              if (isClosed()) return;
              const p = nextPage++;
              if (p > numPages) return;

              try {
                const pageType = await invoke('analyze_page_type', {
                  path: filePath, pageIndex: p - 1,
                });
                if (isClosed()) return;

                if (pageType === 'vector') {
                  if (vr.hasCachedCommands(filePath, p, 0)) continue;
                  const cmdData = await invoke('extract_draw_commands', {
                    path: filePath, pageIndex: p - 1, rotation: 0,
                  });
                  if (isClosed()) return;
                  const cmdBytes = cmdData instanceof Uint8Array
                    ? cmdData : new Uint8Array(cmdData);
                  vr.cacheCommands(filePath, p, cmdBytes, 0);
                  await vr.prepareImages(filePath, p, 0);
                  warmedVector++;
                } else {
                  // TILE page — DELIBERATELY no prefetch.
                  //
                  // We tried prefetching tile-page bitmaps at scale=0.125 in
                  // v1.55/v1.56 (~1.5 s per huge construction-PDF page). It
                  // gave a blurry fallback bitmap that the orchestrator's
                  // getBestAvailableBitmap surfaced on first navigation, but:
                  //   - PDFium serializes via global mutex, so the prefetch
                  //     blocked the thumbnail-processor's render_thumbnail
                  //     calls for 6+ pages × ~1.5 s = 9-20 s. User reported
                  //     thumbnails "weer trager".
                  //   - The orchestrator's exact-bucket render still ran
                  //     after the fallback paint (~2.7 s for NKD1a fit-zoom),
                  //     so the user still waited for the crisp upgrade.
                  //   - Net win was only the brief "blurry instead of blank"
                  //     first paint — not worth the thumbnail regression.
                  //
                  // Better: let thumbnails own PDFium during cold-open. The
                  // first nav to a tile page pays the ~2.7 s cold-render
                  // cost ONCE; subsequent navigations hit the Rust pixmap
                  // cache and are ~150 ms. Multi-process PDFium (v1.58+)
                  // is the real fix for cold-render latency on huge pages.
                  warmedTile++; // counted as "decided not to warm" for diagnostics
                }
              } catch (e) {
                // One bad page shouldn't kill prefetch — just log and move on
                console.warn(`[PERF-BG] prefetch failed page ${p}:`, e?.message ?? e);
              }

              // Yield between pages so we don't starve interactive renders
              await new Promise(r => setTimeout(r, 0));
            }
          };

          const workers = [];
          for (let i = 0; i < CONCURRENCY; i++) workers.push(worker());
          await Promise.all(workers);
          console.log(`[PERF-BG] prefetch complete (${numPages} pages, vector=${warmedVector}, tile=${warmedTile})`);
        } catch (e) {
          console.warn('[PERF-BG] prefetch error:', e);
        }
      })();
    }

  } catch (error) {
    // Suppress errors from document being closed during background loading
    if (isClosed()) return;
    console.error('Error loading PDF:', error);
    if (isActive()) {
      showMessage(i18next.t('failedToLoadPdf', { error: error.message }));
    }
  } finally {
    doc._isLoading = false;
    if (isActive()) hideLoading();
  }
}

// Open file dialog and load PDF
export async function openPDFFile() {
  try {
    // Suggest the directory of the most-recently opened file as the
    // dialog's starting folder. The Windows Shell caches recently-visited
    // folders, so this is materially faster than letting the OS fall back
    // to its built-in default (Documents or the install dir on cold start).
    let defaultPath;
    try {
      const recents = getRecentFiles();
      if (recents.length > 0) {
        recents.sort((a, b) => b.timestamp - a.timestamp);
        const last = recents[0].path;
        // Strip the filename so the dialog opens IN that folder.
        const i = Math.max(last.lastIndexOf('\\'), last.lastIndexOf('/'));
        if (i > 0) defaultPath = last.slice(0, i);
      }
    } catch { /* recents is best-effort */ }

    const result = await openFileDialog(undefined, { defaultPath });
    if (result) {
      // Create a new tab for the file (will switch to existing tab if already open)
      const { index } = createTab(result);
      await loadPDF(result, index);
    }
  } catch (error) {
    console.error('Error opening file dialog:', error);
  }
}

// Create a new UNTITLED document from a template PDF (drawing frame/kader):
// the template bytes are COPIED to a temp file and opened through the exact
// same loadPDF flow as createBlankPDF — the original frame file is never
// touched and Save routes to Save-As.
export async function createDocFromTemplate(templatePath) {
  try {
    showLoading('Creating document...');
    if (!(isTauri() && window.__TAURI__?.path && window.__TAURI__?.fs)) {
      throw new Error('templates require the desktop app');
    }
    try { await invoke('allow_fs_scope', { path: templatePath }); } catch {}
    const bytes = await window.__TAURI__.fs.readFile(templatePath);
    const typedArray = new Uint8Array(bytes);

    const displayName = getNextUntitledName();
    const tempDir = await window.__TAURI__.path.tempDir();
    const sep = (tempDir.endsWith('\\') || tempDir.endsWith('/')) ? '' : '/';
    const tempPath = `${tempDir}${sep}opds-untitled-${Date.now()}.pdf`;
    try { await invoke('allow_fs_scope', { path: tempPath }); } catch {}
    await window.__TAURI__.fs.writeFile(tempPath, typedArray);

    const { index } = createTab(tempPath);
    const doc = state.documents[index];
    if (doc) doc.isUntitled = true;
    await loadPDF(tempPath, index, typedArray);
    if (doc) doc.fileName = displayName;
    markDocumentModified();
    try { await fitPage(); } catch (e) { console.warn('[template-pdf] fitPage failed:', e); }
    updateWindowTitle();
  } catch (e) {
    console.error('[template-pdf] failed:', e);
    alert('Kon document niet aanmaken van kader: ' + (e?.message ?? e));
  } finally {
    hideLoading();
  }
}

// Create a new blank PDF document.
//
// Desktop: the blank document is written to a temp .pdf file and opened via
// the EXACT same loadPDF() flow as any user-opened file — so render, zoom,
// pan and drawing behave identically to a normal PDF (Rust vector/raster
// pipeline, viewport fit, the lot). Only two things mark it as "new":
//   * the tab shows an Untitled display name instead of the temp filename;
//   * `isUntitled` routes Save → Save-As and deletes the temp file once the
//     user picks a real location (or closes the tab).
export async function createBlankPDF(widthPt, heightPt, numPages) {
  try {
    showLoading('Creating document...');

    // Build the blank PDF bytes
    const pdfDocLib = await PDFDocument.create();
    for (let i = 0; i < numPages; i++) {
      pdfDocLib.addPage([widthPt, heightPt]);
    }
    const pdfBytes = await pdfDocLib.save();
    const typedArray = new Uint8Array(pdfBytes);

    const displayName = getNextUntitledName();

    // ─── Desktop: temp file + the normal open flow ───────────────────────
    if (isTauri() && window.__TAURI__?.path && window.__TAURI__?.fs) {
      const tempDir = await window.__TAURI__.path.tempDir();
      const sep = (tempDir.endsWith('/') || tempDir.endsWith('\\')) ? '' : '/';
      const tempPath = `${tempDir}${sep}opds-untitled-${Date.now()}.pdf`;
      // The fs plugin's scope doesn't cover arbitrary paths — grant access to
      // the temp file first (same mechanism loadPDF uses for opened files).
      try { await invoke('allow_fs_scope', { path: tempPath }); } catch {}
      await window.__TAURI__.fs.writeFile(tempPath, typedArray);

      const { index } = createTab(tempPath);
      // Flag BEFORE loadPDF so its recent-files tracking skips the temp path.
      const doc = state.documents[index];
      if (doc) doc.isUntitled = true;
      // Pass the bytes as preloadedData: skips the redundant disk read and
      // the file lock (we own the temp file), otherwise identical to a
      // normal open.
      await loadPDF(tempPath, index, typedArray);
      if (doc) doc.fileName = displayName;
      // Mark as modified so Ctrl+S triggers Save As right away
      markDocumentModified();
      try { await fitPage(); } catch (e) { console.warn('[blank-pdf] fitPage failed:', e); }
      updateWindowTitle();
      return;
    }

    // ─── Browser fallback: in-memory document (no filesystem available) ──
    const { index } = createTab(null);
    const doc = state.documents[index];
    doc.fileName = displayName;

    // Pre-populate pageDims so plugins reading dimensions at click time
    // don't depend on the first renderPage having completed.
    doc.pageDims = {};
    for (let i = 1; i <= numPages; i++) {
      doc.pageDims[i] = { widthPt, heightPt };
    }

    // Cache bytes under a memory key for saving later
    const memoryKey = `__memory__${doc.id}`;
    originalBytesCache.set(memoryKey, typedArray.slice());

    // Load into pdf.js for viewing
    doc.pdfDoc = await pdfjsLib.getDocument({
      data: typedArray,
      cMapUrl: '/pdfjs/web/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/pdfjs/web/standard_fonts/',
      isEvalSupported: false,
      verbosity: 0,
    }).promise;

    // Reset annotation storage and state
    resetAnnotationStorage();
    doc.annotations = [];
    doc.undoStack = [];
    doc.redoStack = [];
    doc.selectedAnnotation = null;
    doc.selectedAnnotations = [];
    doc.currentPage = 1;

    // Show PDF container, hide placeholder
    const placeholder = document.getElementById('placeholder');
    const pdfContainer = document.getElementById('pdf-container');
    if (placeholder) placeholder.style.display = 'none';
    if (pdfContainer) pdfContainer.classList.add('visible');

    // Mark as modified so Ctrl+S will trigger Save As
    markDocumentModified();

    // Manual fit: the in-memory path bypasses the viewport, so fitPage() is
    // a no-op — compute a fit-zoom from the container directly.
    if (pdfContainer) {
      const r = pdfContainer.getBoundingClientRect();
      const padding = 20; // small breathing room around the page
      const availW = Math.max(100, r.width - padding * 2);
      const availH = Math.max(100, r.height - padding * 2);
      const fitScale = Math.min(availW / widthPt, availH / heightPt);
      doc.scale = Math.max(0.05, Math.min(1.5, fitScale));
    }

    await setViewMode(doc.viewMode);
    generateThumbnails();
    refreshActiveTab();
    updateAllStatus();
    updateWindowTitle();

  } catch (error) {
    console.error('Error creating blank PDF:', error);
    showMessage(i18next.t('failedToCreateDocument', { error: error.message }));
  } finally {
    hideLoading();
  }
}

// Cancel any in-progress annotation loading for a document
// If no doc provided, cancels for the active document (backward compat)
export function cancelAnnotationLoading(doc) {
  if (!doc) {
    doc = getActiveDocument();
  }
  if (!doc) return;
  doc._annotationLoadId++;
  doc._loadedAnnotationPages.clear();
  doc._pagesNeedingColorUpdate.clear();
  doc._sharedPdfLibDoc = null;
  doc._sharedPdfLibDocPromise = null;
}

// Mark all annotation pages as loaded (prevents background loader from overwriting after page ops)
export function markAllAnnotationPagesLoaded(numPages, doc) {
  if (!doc) {
    doc = getActiveDocument();
  }
  if (!doc) return;
  for (let i = 1; i <= numPages; i++) {
    doc._loadedAnnotationPages.add(i);
  }
}

// Get or lazily load the shared pdf-lib document for color extraction
async function getSharedPdfLibDoc(doc) {
  if (!doc) {
    doc = getActiveDocument();
  }
  if (!doc) return null;
  if (doc._sharedPdfLibDoc) return doc._sharedPdfLibDoc;
  if (doc._sharedPdfLibDocPromise) return doc._sharedPdfLibDocPromise;
  const pdfBytes = originalBytesCache.get(doc.filePath);
  if (!pdfBytes) return null;
  const _pll0 = performance.now();
  console.log(`[PERF] PDFDocument.load START (${(pdfBytes.length / 1024 / 1024).toFixed(1)} MB)`);
  doc._sharedPdfLibDocPromise = PDFDocument.load(pdfBytes, { ignoreEncryption: true }).then(pdfLibDoc => {
    console.log(`[PERF] PDFDocument.load DONE: ${(performance.now() - _pll0).toFixed(0)}ms`);
    doc._sharedPdfLibDoc = pdfLibDoc;
    doc._sharedPdfLibDocPromise = null;
    return pdfLibDoc;
  });
  return doc._sharedPdfLibDocPromise;
}

// Load annotations for a single page on-demand (called when user navigates to a page)
// If waitForColors=false, skips color extraction when pdf-lib isn't ready yet
async function loadAnnotationsForSinglePage(doc, pageNum, waitForColors = false) {
  if (!doc || !doc.pdfDoc) return;
  const _sp0 = performance.now();

  const page = await doc.pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1 });
  console.log(`[PERF] page ${pageNum}: getPage: ${(performance.now() - _sp0).toFixed(0)}ms`);

  const annotations = await page.getAnnotations();
  console.log(`[PERF] page ${pageNum}: getAnnotations (${annotations.length} annots): ${(performance.now() - _sp0).toFixed(0)}ms`);

  if (annotations.length === 0) return;

  const stampAnnots = annotations.filter(a => a.subtype === 'Stamp');
  const hasSquareAnnotations = annotations.some(a => a.subtype === 'Square');
  const needsExtraData = annotations.some(a => ['FreeText', 'Square', 'Circle', 'Line', 'PolyLine', 'Polygon', 'Ink', 'Text', 'Highlight', 'Underline', 'StrikeOut', 'Squiggly', 'Stamp'].includes(a.subtype));

  let stampImageMap = null;
  let annotColorMap = null;

  // Resolve pdf-lib doc early so both stamp images and colors can use it
  let pdfLibDoc = doc._sharedPdfLibDoc || null;
  if (!pdfLibDoc && (waitForColors || hasSquareAnnotations)) {
    const _pl0 = performance.now();
    pdfLibDoc = await getSharedPdfLibDoc(doc);
    console.log(`[PERF] page ${pageNum}: getSharedPdfLibDoc: ${(performance.now() - _pl0).toFixed(0)}ms`);
  }

  if (stampAnnots.length > 0 || hasSquareAnnotations) {
    const _st0 = performance.now();
    try {
      const pdfPage = await doc.pdfDoc.getPage(pageNum);
      const extractViewport = pdfPage.getViewport({ scale: 1 });
      stampImageMap = await extractStampImagesHybrid(
        pdfPage, extractViewport, stampAnnots, pageNum, pdfLibDoc,
      );
    } catch (e) {
      console.warn('[loader] hybrid stamp extraction failed:', e);
    }
    console.log(`[PERF] page ${pageNum}: stampExtraction (${stampAnnots.length} stamps): ${(performance.now() - _st0).toFixed(0)}ms`);
  }

  if (needsExtraData) {
    if (pdfLibDoc) {
      const _ce0 = performance.now();
      annotColorMap = await extractAnnotationColors(pageNum, pdfLibDoc);
      console.log(`[PERF] page ${pageNum}: colorExtraction: ${(performance.now() - _ce0).toFixed(0)}ms`);
    } else {
      // On-demand path: pdf-lib not ready, skip colors for now
      doc._pagesNeedingColorUpdate.add(pageNum);
    }
  }

  const _cv0 = performance.now();
  await _convertAndPushAnnotations(annotations, pageNum, viewport, stampImageMap, annotColorMap, doc);
  console.log(`[PERF] page ${pageNum}: convertAnnotations (${annotations.length}): ${(performance.now() - _cv0).toFixed(0)}ms`);
  console.log(`[PERF] page ${pageNum}: TOTAL: ${(performance.now() - _sp0).toFixed(0)}ms`);
}

// Ensure annotations are loaded for a given page (on-demand, called from renderer)
export async function ensureAnnotationsForPage(pageNum, doc) {
  if (!doc) {
    doc = getActiveDocument();
  }
  if (!doc) return;
  if (doc._loadedAnnotationPages.has(pageNum)) {
    return;
  }
  doc._loadedAnnotationPages.add(pageNum);
  const _ea0 = performance.now();
  console.log(`[PERF] ensureAnnotationsForPage(${pageNum}) START`);
  await loadAnnotationsForSinglePage(doc, pageNum, false);
  console.log(`[PERF] ensureAnnotationsForPage(${pageNum}) DONE: ${(performance.now() - _ea0).toFixed(0)}ms`);
}

// Load existing annotations from PDF
export async function loadExistingAnnotations(doc) {
  if (!doc) {
    doc = getActiveDocument();
  }
  if (!doc || !doc.pdfDoc) return;

  const loadId = ++doc._annotationLoadId;
  const pdfDoc = doc.pdfDoc;
  const numPages = pdfDoc.numPages;
  const BATCH_SIZE = 10;
  const _bg0 = performance.now();
  console.log(`[PERF-BG] loadExistingAnnotations START (${numPages} pages)`);

  for (let batchStart = 1; batchStart <= numPages; batchStart += BATCH_SIZE) {
    if (loadId !== doc._annotationLoadId) return;
    if (!state.documents.includes(doc)) return;

    // Yield to the browser between batches so the UI stays responsive
    if (batchStart > 1) {
      await new Promise(r => setTimeout(r, 0));
      if (loadId !== doc._annotationLoadId || !state.documents.includes(doc)) return;
    }

    const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, numPages);

    // Collect page numbers not yet loaded on-demand
    const pagesToLoad = [];
    for (let p = batchStart; p <= batchEnd; p++) {
      if (doc._loadedAnnotationPages.has(p)) {
        // already loaded
      } else {
        pagesToLoad.push(p);
        doc._loadedAnnotationPages.add(p);
      }
    }

    if (pagesToLoad.length === 0) continue;
    console.log(`[PERF-BG] batch ${batchStart}-${batchEnd} (${pagesToLoad.length} pages to load): ${(performance.now() - _bg0).toFixed(0)}ms`);

    // Fetch all pages in this batch in parallel
    const pages = await Promise.all(pagesToLoad.map(p => pdfDoc.getPage(p)));
    if (loadId !== doc._annotationLoadId || !state.documents.includes(doc)) return;

    // Fetch all annotations in this batch in parallel
    const annotResults = await Promise.all(pages.map(page => page.getAnnotations()));
    if (loadId !== doc._annotationLoadId || !state.documents.includes(doc)) return;

    // Resolve pdf-lib doc once per batch (cached after first call)
    const pdfLibDoc = await getSharedPdfLibDoc(doc);
    if (loadId !== doc._annotationLoadId || !state.documents.includes(doc)) return;

    // Process each page's annotations — yield after every page to keep UI responsive
    for (let i = 0; i < pages.length; i++) {
      if (loadId !== doc._annotationLoadId || !state.documents.includes(doc)) return;

      // Yield to the browser so UI stays responsive during background loading
      await new Promise(r => setTimeout(r, 0));
      if (loadId !== doc._annotationLoadId || !state.documents.includes(doc)) return;

      const pageNum = pagesToLoad[i];
      const page = pages[i];
      const viewport = page.getViewport({ scale: 1 });
      const annotations = annotResults[i];

      if (annotations.length === 0) continue;

      const stampAnnots = annotations.filter(a => a.subtype === 'Stamp');
      const hasSquareAnnotations = annotations.some(a => a.subtype === 'Square');
      const needsExtraData = annotations.some(a => ['FreeText', 'Square', 'Circle', 'Line', 'PolyLine', 'Polygon', 'Ink', 'Text', 'Highlight', 'Underline', 'StrikeOut', 'Squiggly', 'Stamp'].includes(a.subtype));

      let stampImageMap = null;
      let annotColorMap = null;

      if (stampAnnots.length > 0 || hasSquareAnnotations) {
        try {
          stampImageMap = await extractStampImagesHybrid(
            pages[i], viewport, stampAnnots, pageNum, pdfLibDoc,
          );
        } catch (e) {
          console.warn('[loader] hybrid stamp extraction failed:', e);
        }
        if (loadId !== doc._annotationLoadId || !state.documents.includes(doc)) return;
      }

      if (needsExtraData && pdfLibDoc) {
        annotColorMap = await extractAnnotationColors(pageNum, pdfLibDoc);
        if (loadId !== doc._annotationLoadId || !state.documents.includes(doc)) return;
      }

      await _convertAndPushAnnotations(annotations, pageNum, viewport, stampImageMap, annotColorMap, doc);
    }
  }

  // Fix up pages that were loaded on-demand without color data
  if (doc._pagesNeedingColorUpdate.size > 0 && loadId === doc._annotationLoadId && state.documents.includes(doc)) {
    const pdfLibDoc = await getSharedPdfLibDoc(doc);
    if (pdfLibDoc && loadId === doc._annotationLoadId && state.documents.includes(doc)) {
      for (const pageNum of doc._pagesNeedingColorUpdate) {
        if (loadId !== doc._annotationLoadId || !state.documents.includes(doc)) break;

        // Yield to keep UI responsive
        await new Promise(r => setTimeout(r, 0));
        if (loadId !== doc._annotationLoadId || !state.documents.includes(doc)) break;

        // Remove old annotations for this page
        doc.annotations = doc.annotations.filter(a => a.page !== pageNum);

        // Reload with full color data
        const page = await pdfDoc.getPage(pageNum);
        if (loadId !== doc._annotationLoadId || !state.documents.includes(doc)) break;
        const viewport = page.getViewport({ scale: 1 });
        const annotations = await page.getAnnotations();
        if (loadId !== doc._annotationLoadId || !state.documents.includes(doc)) break;

        if (annotations.length === 0) continue;

        const stampAnnots = annotations.filter(a => a.subtype === 'Stamp');
        const hasSquareAnnotations = annotations.some(a => a.subtype === 'Square');
        const needsExtraData = annotations.some(a => ['FreeText', 'Square', 'Circle', 'Line', 'PolyLine', 'Polygon', 'Ink', 'Text', 'Highlight', 'Underline', 'StrikeOut', 'Squiggly', 'Stamp'].includes(a.subtype));

        let stampImageMap = null;
        let annotColorMap = null;

        if (stampAnnots.length > 0 || hasSquareAnnotations) {
          try {
            stampImageMap = await extractStampImagesHybrid(
              page, viewport, stampAnnots, pageNum, pdfLibDoc,
            );
          } catch (e) {
            console.warn('[loader] hybrid stamp extraction failed:', e);
          }
        }
        if (needsExtraData) {
          annotColorMap = await extractAnnotationColors(pageNum, pdfLibDoc);
        }

        await _convertAndPushAnnotations(annotations, pageNum, viewport, stampImageMap, annotColorMap, doc);
      }
      doc._pagesNeedingColorUpdate.clear();
    }
  }
  console.log(`[PERF-BG] loadExistingAnnotations DONE (${doc.annotations.length} total annotations): ${(performance.now() - _bg0).toFixed(0)}ms`);
}
