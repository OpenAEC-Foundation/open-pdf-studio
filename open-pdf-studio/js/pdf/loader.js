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

// PDF/A compliance bar – per-document dismiss tracking
const dismissedPdfADocuments = new Set();

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

// ─── PDF/A compliance bar ──────────────────────────────────────────────────────

async function checkPdfACompliance() {
  try {
    const meta = await state.pdfDoc.getMetadata();
    const metadata = meta && meta.metadata;
    if (!metadata) return;
    const part = metadata.get('pdfaid:part');
    const conformance = metadata.get('pdfaid:conformance');
    if (part) {
      const doc = state.documents[state.activeDocumentIndex];
      if (doc) {
        doc.pdfaCompliance = { part, conformance: conformance || null };
      }
      showPdfABar(part, conformance);
    }
  } catch (e) {
    // Metadata not available – ignore
  }
}

function showPdfABar(part, conformance) {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc) return;
  if (dismissedPdfADocuments.has(doc.id)) return;
  const bar = document.getElementById('pdfa-bar');
  if (!bar) return;
  const label = `PDF/A-${part}${conformance ? conformance.toLowerCase() : ''}`;
  const textEl = document.getElementById('pdfa-bar-text');
  if (textEl) {
    textEl.textContent = `This document complies with the ${label} standard and has been opened read-only to prevent modification.`;
  }
  bar.style.display = 'flex';

  // Disable annotation tool buttons
  import('../tools/manager.js').then(m => m.updatePdfAToolState());

  const enableBtn = document.getElementById('pdfa-bar-enable');
  if (enableBtn && !enableBtn._hasListener) {
    enableBtn._hasListener = true;
    enableBtn.addEventListener('click', () => {
      bar.style.display = 'none';
      const activeDoc = state.documents[state.activeDocumentIndex];
      if (activeDoc) dismissedPdfADocuments.add(activeDoc.id);
      // Re-enable annotation tool buttons
      import('../tools/manager.js').then(m => m.updatePdfAToolState());
    });
  }

  const closeBtn = document.getElementById('pdfa-bar-close');
  if (closeBtn && !closeBtn._hasListener) {
    closeBtn._hasListener = true;
    closeBtn.addEventListener('click', () => {
      bar.style.display = 'none';
      const activeDoc = state.documents[state.activeDocumentIndex];
      if (activeDoc) dismissedPdfADocuments.add(activeDoc.id);
      // Re-enable annotation tool buttons
      import('../tools/manager.js').then(m => m.updatePdfAToolState());
    });
  }
}

export function hidePdfABar() {
  const bar = document.getElementById('pdfa-bar');
  if (bar) bar.style.display = 'none';
}

// Check if the active document is PDF/A and editing has NOT been enabled
export function isPdfAReadOnly() {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc) return false;
  if (!doc.pdfaCompliance) return false;
  return !dismissedPdfADocuments.has(doc.id);
}

// Load PDF from file path. Optional preloadedData (Uint8Array) bypasses FS plugin read.
export async function loadPDF(filePath, preloadedData = null) {
  try {
    showLoading('Loading PDF...');

    let typedArray;

    if (isTauri()) {
      if (preloadedData) {
        // Use pre-loaded bytes (e.g. from virtual printer capture via Rust read_file)
        typedArray = preloadedData instanceof Uint8Array ? preloadedData : new Uint8Array(preloadedData);
      } else {
        // Lock the file to prevent other apps from writing while we have it open
        await lockFile(filePath);

        // Read file using Tauri fs plugin
        const data = await readBinaryFile(filePath);
        typedArray = new Uint8Array(data);
      }

      // Cache a copy of original bytes for saver (pdf.js transfers the buffer
      // to a web worker, which detaches the original Uint8Array making it length 0)
      originalBytesCache.set(filePath, typedArray.slice());
    } else {
      // Fallback for browser environment (e.g., via fetch for local dev)
      throw new Error('File system access not available');
    }

    // Load PDF using pdf.js (this transfers the buffer to a worker)
    state.pdfDoc = await pdfjsLib.getDocument({
      data: typedArray,
      cMapUrl: '/pdfjs/web/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/pdfjs/web/standard_fonts/',
      isEvalSupported: false,
    }).promise;
    state.currentPdfPath = filePath;

    // Reset form field annotation storage for the new document
    resetAnnotationStorage();

    // Hide PDF/A bar from previous document
    hidePdfABar();

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
    await setViewMode(state.viewMode);
    hideLoading();

    // Check for PDF/A compliance and show info bar if applicable
    checkPdfACompliance();

    // Generate thumbnails for left panel
    generateThumbnails();

    // Load bookmarks from PDF outline
    {
      const { loadBookmarksFromPdf } = await import('../ui/panels/bookmarks.js');
      const doc = state.documents[state.activeDocumentIndex];
      if (doc) {
        doc.bookmarks = await loadBookmarksFromPdf(state.pdfDoc);
      }
    }

    // Notify that a PDF has been loaded (listeners can reset tool, update UI, etc.)
    document.dispatchEvent(new CustomEvent('pdf-loaded'));

    // Refresh active left panel tab (e.g. attachments, layers, etc.)
    refreshActiveTab();

    // Update status bar
    updateAllStatus();

    // Update window title
    updateWindowTitle();

    // Load existing annotations in background (after first paint)
    await loadExistingAnnotations();

    // Redraw annotations on the current page now that they're loaded (including color updates)
    // (only if the document is still active)
    if (state.pdfDoc && state.currentPdfPath === filePath) {
      const { redrawAnnotations } = await import('../annotations/rendering.js');
      redrawAnnotations();
    }

  } catch (error) {
    // Suppress errors from document being closed during background loading
    if (!state.pdfDoc || state.currentPdfPath !== filePath) {
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

  t0 = performance.now();
  const annotations = await page.getAnnotations();

  if (annotations.length === 0) return;

  const stampAnnots = annotations.filter(a => a.subtype === 'Stamp');
  const needsExtraData = annotations.some(a => ['FreeText', 'Square', 'Circle', 'Line', 'PolyLine', 'Polygon', 'Ink', 'Text', 'Highlight', 'Underline', 'StrikeOut', 'Squiggly'].includes(a.subtype));

  let stampImageMap = null;
  let annotColorMap = null;

  if (stampAnnots.length > 0) {
    t0 = performance.now();
    stampImageMap = await extractStampImagesViaPdfJs(page, viewport, stampAnnots);
  }

  if (needsExtraData) {
    if (waitForColors) {
      // Background loader path: always wait for pdf-lib
      const pdfLibDoc = await getSharedPdfLibDoc();
      if (pdfLibDoc) {
        t0 = performance.now();
        annotColorMap = await extractAnnotationColors(pageNum, pdfLibDoc);
      }
    } else if (sharedPdfLibDoc) {
      // On-demand path: pdf-lib already ready, use it
      t0 = performance.now();
      annotColorMap = await extractAnnotationColors(pageNum, sharedPdfLibDoc);
    } else {
      // On-demand path: pdf-lib not ready, skip colors for now
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
}

// Ensure annotations are loaded for a given page (on-demand, called from renderer)
export async function ensureAnnotationsForPage(pageNum) {
  if (loadedAnnotationPages.has(pageNum)) {
    return;
  }
  loadedAnnotationPages.add(pageNum);
  await loadAnnotationsForSinglePage(pageNum, false);
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

  for (let batchStart = 1; batchStart <= numPages; batchStart += BATCH_SIZE) {
    if (loadId !== annotationLoadId) {
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

  // Fix up pages that were loaded on-demand without color data
  if (pagesNeedingColorUpdate.size > 0 && loadId === annotationLoadId) {
    const pdfLibDoc = await getSharedPdfLibDoc();
    if (pdfLibDoc && loadId === annotationLoadId) {
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
    }
  }
}
