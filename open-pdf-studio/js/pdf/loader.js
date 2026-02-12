import { state } from '../core/state.js';
import { placeholder, pdfContainer, fileInfo } from '../ui/dom-elements.js';
import { showLoading, hideLoading } from '../ui/chrome/dialogs.js';
import { updateAllStatus } from '../ui/chrome/status-bar.js';
import { setViewMode } from './renderer.js';
import { generateThumbnails, refreshActiveTab } from '../ui/panels/left-panel.js';
import { createTab, updateWindowTitle } from '../ui/chrome/tabs.js';
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

// Load PDF from file path
export async function loadPDF(filePath) {
  try {
    showLoading('Loading PDF...');

    let typedArray;

    if (isTauri()) {
      // Lock the file to prevent other apps from writing while we have it open
      await lockFile(filePath);

      // Read file using Tauri fs plugin
      const data = await readBinaryFile(filePath);
      typedArray = new Uint8Array(data);

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

    // Reset annotation state
    state.annotations = [];
    const doc = state.documents[state.activeDocumentIndex];
    if (doc) { doc.undoStack = []; doc.redoStack = []; }
    state.selectedAnnotation = null;
    state.currentPage = 1;

    // Load existing annotations from PDF
    await loadExistingAnnotations();

    // Show PDF container, hide placeholder
    placeholder.style.display = 'none';
    pdfContainer.classList.add('visible');

    // Show PDF controls in status bar
    const pdfControls = document.getElementById('pdf-controls');
    if (pdfControls) pdfControls.style.display = 'flex';

    // Update file info
    const fileName = filePath.split(/[\\/]/).pop();
    fileInfo.textContent = fileName;

    // Render first page
    await setViewMode(state.viewMode);

    // Generate thumbnails for left panel
    generateThumbnails();

    // Refresh active left panel tab (e.g. attachments, layers, etc.)
    refreshActiveTab();

    // Update status bar
    updateAllStatus();

    // Update window title
    updateWindowTitle();

  } catch (error) {
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

// Load existing annotations from PDF
export async function loadExistingAnnotations() {
  if (!state.pdfDoc) return;

  for (let pageNum = 1; pageNum <= state.pdfDoc.numPages; pageNum++) {
    const page = await state.pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 }); // Use scale 1 for coordinate conversion
    const annotations = await page.getAnnotations();

    // Extract extra annotation data from PDF structure using pdf-lib
    const stampAnnots = annotations.filter(a => a.subtype === 'Stamp');
    const needsExtraData = annotations.some(a => ['FreeText', 'Square', 'Circle', 'Line', 'PolyLine', 'Polygon', 'Ink', 'Text', 'Highlight', 'Underline', 'StrikeOut', 'Squiggly'].includes(a.subtype));
    let stampImageMap = null;
    let annotColorMap = null;

    // Primary: use PDF.js page render + crop (handles all stamp types correctly,
    // including complex vector Form XObjects with text/shapes/gradients)
    if (stampAnnots.length > 0) {
      stampImageMap = await extractStampImagesViaPdfJs(page, viewport, stampAnnots);
    }

    if (needsExtraData) {
      const pdfBytes = originalBytesCache.get(state.currentPdfPath);
      if (pdfBytes) {
        const pdfLibDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        annotColorMap = await extractAnnotationColors(pageNum, pdfLibDoc);
      }
    }

    for (const annot of annotations) {
      const converted = await convertPdfAnnotation(annot, pageNum, viewport, stampImageMap, annotColorMap);
      if (converted) {
        state.annotations.push(converted);
      }
    }
  }
}
