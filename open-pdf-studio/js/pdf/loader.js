import { state, getNextUntitledName } from '../core/state.js';
import { placeholder, pdfContainer, fileInfo } from '../ui/dom-elements.js';
import { showLoading, hideLoading } from '../ui/chrome/dialogs.js';
import { updateAllStatus } from '../ui/chrome/status-bar.js';
import { setViewMode } from './renderer.js';
import { generateThumbnails, refreshActiveTab } from '../ui/panels/left-panel.js';
import { createTab, updateWindowTitle, markDocumentModified } from '../ui/chrome/tabs.js';
import * as pdfjsLib from 'pdfjs-dist';
import { isTauri, readBinaryFile, openFileDialog, lockFile } from '../core/platform.js';
import { PDFDocument } from 'pdf-lib';
import { resetAnnotationStorage } from './form-layer.js';

// Sub-module imports
import { extractAnnotationColors } from './loader/color-extraction.js';
import { extractStampImagesViaPdfJs } from './loader/image-extraction.js';
import { convertPdfAnnotation } from './loader/annotation-converter.js';

// Cache for original PDF bytes (used by saver to avoid re-reading)
const originalBytesCache = new Map(); // filePath -> Uint8Array

// Cancellation token for background annotation loading
let annotationLoadId = 0;

// Track which pages have had annotations loaded, and shared pdf-lib document
const loadedAnnotationPages = new Set();
let sharedPdfLibDoc = null; // lazy-loaded, shared between on-demand and background
let sharedPdfLibDocPromise = null; // to avoid loading twice concurrently

export function getCachedPdfBytes(filePath) {
  return originalBytesCache.get(filePath);
}

export function setCachedPdfBytes(filePath, bytes) {
  originalBytesCache.set(filePath, bytes);
}

export function clearCachedPdfBytes(filePath) {
  if (filePath) {
    originalBytesCache.delete(filePath);
  } else {
    originalBytesCache.clear();
  }
}

// Set worker source (path relative to HTML file, not this module)
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href;

// Load PDF from file path. Optional preloadedData (Uint8Array) bypasses FS plugin read.
export async function loadPDF(filePath, preloadedData = null) {
  try {
    console.time('[PERF] loadPDF first paint');
    console.time('[PERF] loadPDF total');
    showLoading('Loading PDF...');

    let typedArray;

    if (isTauri()) {
      if (preloadedData) {
        // Use pre-loaded bytes (e.g. from virtual printer capture via Rust read_file)
        typedArray = preloadedData instanceof Uint8Array ? preloadedData : new Uint8Array(preloadedData);
      } else {
        // Lock the file to prevent other apps from writing while we have it open
        console.time('[PERF] lockFile');
        await lockFile(filePath);
        console.timeEnd('[PERF] lockFile');

        // Read file using Tauri fs plugin
        console.time('[PERF] readBinaryFile');
        const data = await readBinaryFile(filePath);
        typedArray = new Uint8Array(data);
        console.timeEnd('[PERF] readBinaryFile');
      }

      // Cache a copy of original bytes for saver (pdf.js transfers the buffer
      // to a web worker, which detaches the original Uint8Array making it length 0)
      console.time('[PERF] cacheBytes');
      originalBytesCache.set(filePath, typedArray.slice());
      console.timeEnd('[PERF] cacheBytes');
    } else {
      // Fallback for browser environment (e.g., via fetch for local dev)
      throw new Error('File system access not available');
    }

    // Load PDF using pdf.js (this transfers the buffer to a worker)
    console.time('[PERF] pdfjsGetDocument');
    state.pdfDoc = await pdfjsLib.getDocument({
      data: typedArray,
      cMapUrl: '/pdfjs/web/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/pdfjs/web/standard_fonts/',
      isEvalSupported: false,
    }).promise;
    console.timeEnd('[PERF] pdfjsGetDocument');
    state.currentPdfPath = filePath;

    // Reset form field annotation storage for the new document
    resetAnnotationStorage();

    // Reset annotation state
    state.annotations = [];
    loadedAnnotationPages.clear();
    pagesNeedingColorUpdate.clear();
    sharedPdfLibDoc = null;
    sharedPdfLibDocPromise = null;
    const doc = state.documents[state.activeDocumentIndex];
    if (doc) { doc.undoStack = []; doc.redoStack = []; }
    state.selectedAnnotation = null;
    state.currentPage = 1;

    // Eagerly start pdf-lib loading in background (don't await - runs in parallel with first paint)
    console.time('[PERF] PDFDocument.load (eager start)');
    getSharedPdfLibDoc();

    // Show PDF container, hide placeholder
    placeholder.style.display = 'none';
    pdfContainer.classList.add('visible');

    // Show PDF controls in status bar
    const pdfControls = document.getElementById('pdf-controls');
    if (pdfControls) pdfControls.style.display = 'flex';

    // Update file info
    const fileName = filePath.split(/[\\/]/).pop();
    fileInfo.textContent = fileName;

    // Render first page immediately (before annotation loading)
    console.time('[PERF] setViewMode (render)');
    await setViewMode(state.viewMode);
    console.timeEnd('[PERF] setViewMode (render)');

    console.timeEnd('[PERF] loadPDF first paint');
    hideLoading();

    // Generate thumbnails for left panel
    console.time('[PERF] generateThumbnails');
    generateThumbnails();
    console.timeEnd('[PERF] generateThumbnails');

    // Refresh active left panel tab (e.g. attachments, layers, etc.)
    refreshActiveTab();

    // Update status bar
    updateAllStatus();

    // Update window title
    updateWindowTitle();

    // Load existing annotations in background (after first paint)
    console.time('[PERF] loadExistingAnnotations');
    await loadExistingAnnotations();
    console.timeEnd('[PERF] loadExistingAnnotations');

    // Redraw annotations on the current page now that they're loaded (including color updates)
    // (only if the document is still active)
    if (state.pdfDoc && state.currentPdfPath === filePath) {
      const { redrawAnnotations } = await import('../annotations/rendering.js');
      redrawAnnotations();
      console.log('[PERF] Final redraw after background + color update complete');
    }

    console.timeEnd('[PERF] loadPDF total');

  } catch (error) {
    // Suppress errors from document being closed during background loading
    if (!state.pdfDoc || state.currentPdfPath !== filePath) {
      console.log('[PERF] loadPDF: document closed during loading, suppressing error');
      return;
    }
    console.error('Error loading PDF:', error);
    alert('Failed to load PDF: ' + error.message);
  } finally {
    hideLoading();
  }
}

// Open file dialog and load PDF
export async function openPDFFile() {
  if (!isTauri()) {
    console.warn('File dialogs require Tauri environment');
    return;
  }

  try {
    const result = await openFileDialog();
    if (result) {
      // Create a new tab for the file (will switch to existing tab if already open)
      createTab(result);
      await loadPDF(result);
    }
  } catch (error) {
    console.error('Error opening file dialog:', error);
  }
}

// Create a new blank PDF document
export async function createBlankPDF(widthPt, heightPt, numPages) {
  try {
    showLoading('Creating document...');

    // Create blank PDF using pdf-lib
    const pdfDocLib = await PDFDocument.create();
    for (let i = 0; i < numPages; i++) {
      pdfDocLib.addPage([widthPt, heightPt]);
    }
    const pdfBytes = await pdfDocLib.save();
    const typedArray = new Uint8Array(pdfBytes);

    // Generate untitled name and create tab
    const fileName = getNextUntitledName();
    const doc = createTab(null);
    doc.fileName = fileName;

    // Cache bytes under a memory key for saving later
    const memoryKey = `__memory__${doc.id}`;
    originalBytesCache.set(memoryKey, typedArray.slice());

    // Load into pdf.js for viewing
    state.pdfDoc = await pdfjsLib.getDocument({
      data: typedArray,
      cMapUrl: '/pdfjs/web/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/pdfjs/web/standard_fonts/',
      isEvalSupported: false,
    }).promise;

    // Reset annotation storage and state
    resetAnnotationStorage();
    state.annotations = [];
    if (doc) { doc.undoStack = []; doc.redoStack = []; }
    state.selectedAnnotation = null;
    state.currentPage = 1;

    // Show PDF container, hide placeholder
    placeholder.style.display = 'none';
    pdfContainer.classList.add('visible');

    const pdfControls = document.getElementById('pdf-controls');
    if (pdfControls) pdfControls.style.display = 'flex';

    fileInfo.textContent = fileName;

    // Mark as modified so Ctrl+S will trigger Save As
    markDocumentModified();

    // Render
    await setViewMode(state.viewMode);
    generateThumbnails();
    refreshActiveTab();
    updateAllStatus();
    updateWindowTitle();

  } catch (error) {
    console.error('Error creating blank PDF:', error);
    alert('Failed to create document: ' + error.message);
  } finally {
    hideLoading();
  }
}

// Cancel any in-progress annotation loading (called when document is closed/switched)
export function cancelAnnotationLoading() {
  annotationLoadId++;
  loadedAnnotationPages.clear();
  pagesNeedingColorUpdate.clear();
  sharedPdfLibDoc = null;
  sharedPdfLibDocPromise = null;
}

// Mark all annotation pages as loaded (prevents background loader from overwriting after page ops)
export function markAllAnnotationPagesLoaded(numPages) {
  for (let i = 1; i <= numPages; i++) {
    loadedAnnotationPages.add(i);
  }
}

// Get or lazily load the shared pdf-lib document for color extraction
async function getSharedPdfLibDoc() {
  if (sharedPdfLibDoc) return sharedPdfLibDoc;
  if (sharedPdfLibDocPromise) return sharedPdfLibDocPromise;
  const pdfBytes = originalBytesCache.get(state.currentPdfPath);
  if (!pdfBytes) return null;
  sharedPdfLibDocPromise = PDFDocument.load(pdfBytes, { ignoreEncryption: true }).then(doc => {
    sharedPdfLibDoc = doc;
    sharedPdfLibDocPromise = null;
    console.timeEnd('[PERF] PDFDocument.load (eager start)');
    return doc;
  });
  return sharedPdfLibDocPromise;
}

// Track pages that were loaded on-demand without color data (need color update later)
const pagesNeedingColorUpdate = new Set();

// Load annotations for a single page on-demand (called when user navigates to a page)
// If waitForColors=false, skips color extraction when pdf-lib isn't ready yet
async function loadAnnotationsForSinglePage(pageNum, waitForColors = false) {
  if (!state.pdfDoc) return;

  let t0 = performance.now();
  const page = await state.pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1 });
  console.log(`[PERF] on-demand page ${pageNum}: getPage ${(performance.now() - t0).toFixed(1)} ms`);

  t0 = performance.now();
  const annotations = await page.getAnnotations();
  console.log(`[PERF] on-demand page ${pageNum}: getAnnotations ${(performance.now() - t0).toFixed(1)} ms, found ${annotations.length}`);

  if (annotations.length === 0) return;

  const stampAnnots = annotations.filter(a => a.subtype === 'Stamp');
  const needsExtraData = annotations.some(a => ['FreeText', 'Square', 'Circle', 'Line', 'PolyLine', 'Polygon', 'Ink', 'Text', 'Highlight', 'Underline', 'StrikeOut', 'Squiggly'].includes(a.subtype));

  let stampImageMap = null;
  let annotColorMap = null;

  if (stampAnnots.length > 0) {
    t0 = performance.now();
    stampImageMap = await extractStampImagesViaPdfJs(page, viewport, stampAnnots);
    console.log(`[PERF] on-demand page ${pageNum}: stampExtract ${(performance.now() - t0).toFixed(1)} ms`);
  }

  if (needsExtraData) {
    if (waitForColors) {
      // Background loader path: always wait for pdf-lib
      const pdfLibDoc = await getSharedPdfLibDoc();
      if (pdfLibDoc) {
        t0 = performance.now();
        annotColorMap = await extractAnnotationColors(pageNum, pdfLibDoc);
        console.log(`[PERF] on-demand page ${pageNum}: colorExtract ${(performance.now() - t0).toFixed(1)} ms`);
      }
    } else if (sharedPdfLibDoc) {
      // On-demand path: pdf-lib already ready, use it
      t0 = performance.now();
      annotColorMap = await extractAnnotationColors(pageNum, sharedPdfLibDoc);
      console.log(`[PERF] on-demand page ${pageNum}: colorExtract (instant) ${(performance.now() - t0).toFixed(1)} ms`);
    } else {
      // On-demand path: pdf-lib not ready, skip colors for now
      console.log(`[PERF] on-demand page ${pageNum}: skipping colors (pdf-lib not ready)`);
      pagesNeedingColorUpdate.add(pageNum);
    }
  }

  t0 = performance.now();
  for (const annot of annotations) {
    const converted = await convertPdfAnnotation(annot, pageNum, viewport, stampImageMap, annotColorMap);
    if (converted) {
      state.annotations.push(converted);
    }
  }
  console.log(`[PERF] on-demand page ${pageNum}: convert ${(performance.now() - t0).toFixed(1)} ms`);
}

// Ensure annotations are loaded for a given page (on-demand, called from renderer)
export async function ensureAnnotationsForPage(pageNum) {
  if (loadedAnnotationPages.has(pageNum)) {
    console.log(`[PERF] ensureAnnotationsForPage(${pageNum}): already loaded`);
    return;
  }
  console.log(`[PERF] ensureAnnotationsForPage(${pageNum}): loading on-demand...`);
  console.time(`[PERF] ensureAnnotationsForPage(${pageNum}) total`);
  loadedAnnotationPages.add(pageNum);
  await loadAnnotationsForSinglePage(pageNum, false);
  console.timeEnd(`[PERF] ensureAnnotationsForPage(${pageNum}) total`);
}

// Load existing annotations from PDF
export async function loadExistingAnnotations() {
  if (!state.pdfDoc) return;

  const loadId = ++annotationLoadId;
  const pdfDoc = state.pdfDoc;
  const numPages = pdfDoc.numPages;
  const BATCH_SIZE = 50;
  let totalGetPage = 0, totalGetAnnotations = 0, totalStampExtract = 0, totalColorExtract = 0, totalConvert = 0;
  let pagesWithAnnotations = 0, totalAnnotations = 0, pagesSkipped = 0;

  console.log(`[PERF] loadExistingAnnotations: processing ${numPages} pages (batch size ${BATCH_SIZE})`);

  for (let batchStart = 1; batchStart <= numPages; batchStart += BATCH_SIZE) {
    if (loadId !== annotationLoadId) {
      console.log(`[PERF] loadExistingAnnotations: cancelled at page ${batchStart}/${numPages}`);
      return;
    }

    const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, numPages);

    // Collect page numbers not yet loaded on-demand
    const pagesToLoad = [];
    for (let p = batchStart; p <= batchEnd; p++) {
      if (loadedAnnotationPages.has(p)) {
        pagesSkipped++;
      } else {
        pagesToLoad.push(p);
        loadedAnnotationPages.add(p);
      }
    }

    if (pagesToLoad.length === 0) continue;

    // Fetch all pages in this batch in parallel
    let t0 = performance.now();
    const pages = await Promise.all(pagesToLoad.map(p => pdfDoc.getPage(p)));
    totalGetPage += performance.now() - t0;

    // Fetch all annotations in this batch in parallel
    t0 = performance.now();
    const annotResults = await Promise.all(pages.map(page => page.getAnnotations()));
    totalGetAnnotations += performance.now() - t0;

    // Process each page's annotations
    for (let i = 0; i < pages.length; i++) {
      const pageNum = pagesToLoad[i];
      const page = pages[i];
      const viewport = page.getViewport({ scale: 1 });
      const annotations = annotResults[i];

      if (annotations.length === 0) continue;

      pagesWithAnnotations++;
      totalAnnotations += annotations.length;

      const stampAnnots = annotations.filter(a => a.subtype === 'Stamp');
      const needsExtraData = annotations.some(a => ['FreeText', 'Square', 'Circle', 'Line', 'PolyLine', 'Polygon', 'Ink', 'Text', 'Highlight', 'Underline', 'StrikeOut', 'Squiggly'].includes(a.subtype));

      let stampImageMap = null;
      let annotColorMap = null;

      if (stampAnnots.length > 0) {
        t0 = performance.now();
        stampImageMap = await extractStampImagesViaPdfJs(page, viewport, stampAnnots);
        totalStampExtract += performance.now() - t0;
      }

      if (needsExtraData) {
        const pdfLibDoc = await getSharedPdfLibDoc();
        if (pdfLibDoc) {
          t0 = performance.now();
          annotColorMap = await extractAnnotationColors(pageNum, pdfLibDoc);
          totalColorExtract += performance.now() - t0;
        }
      }

      t0 = performance.now();
      for (const annot of annotations) {
        const converted = await convertPdfAnnotation(annot, pageNum, viewport, stampImageMap, annotColorMap);
        if (converted) {
          state.annotations.push(converted);
        }
      }
      totalConvert += performance.now() - t0;
    }
  }

  console.log(`[PERF] loadExistingAnnotations summary:`);
  console.log(`  Pages: ${numPages}, Pages with annotations: ${pagesWithAnnotations}, Total annotations: ${totalAnnotations}, Skipped (on-demand): ${pagesSkipped}`);
  console.log(`  getPage():          ${totalGetPage.toFixed(1)} ms`);
  console.log(`  getAnnotations():   ${totalGetAnnotations.toFixed(1)} ms`);
  console.log(`  stampExtract:       ${totalStampExtract.toFixed(1)} ms`);
  console.log(`  colorExtract:       ${totalColorExtract.toFixed(1)} ms`);
  console.log(`  convertAnnotation:  ${totalConvert.toFixed(1)} ms`);

  // Fix up pages that were loaded on-demand without color data
  if (pagesNeedingColorUpdate.size > 0 && loadId === annotationLoadId) {
    const pdfLibDoc = await getSharedPdfLibDoc();
    if (pdfLibDoc && loadId === annotationLoadId) {
      console.log(`[PERF] Updating ${pagesNeedingColorUpdate.size} pages with color data...`);
      for (const pageNum of pagesNeedingColorUpdate) {
        if (loadId !== annotationLoadId) break;

        // Remove old annotations for this page
        state.annotations = state.annotations.filter(a => a.page !== pageNum);

        // Reload with full color data
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1 });
        const annotations = await page.getAnnotations();

        if (annotations.length === 0) continue;

        const stampAnnots = annotations.filter(a => a.subtype === 'Stamp');
        const needsExtraData = annotations.some(a => ['FreeText', 'Square', 'Circle', 'Line', 'PolyLine', 'Polygon', 'Ink', 'Text', 'Highlight', 'Underline', 'StrikeOut', 'Squiggly'].includes(a.subtype));

        let stampImageMap = null;
        let annotColorMap = null;

        if (stampAnnots.length > 0) {
          stampImageMap = await extractStampImagesViaPdfJs(page, viewport, stampAnnots);
        }
        if (needsExtraData) {
          annotColorMap = await extractAnnotationColors(pageNum, pdfLibDoc);
        }

        for (const annot of annotations) {
          const converted = await convertPdfAnnotation(annot, pageNum, viewport, stampImageMap, annotColorMap);
          if (converted) {
            state.annotations.push(converted);
          }
        }
      }
      pagesNeedingColorUpdate.clear();
      console.log('[PERF] Color update complete');
    }
  }
}
