import { state, getActiveDocument } from '../core/state.js';
import { getCachedPdfBytes, setCachedPdfBytes, cancelAnnotationLoading, markAllAnnotationPagesLoaded } from './loader.js';
import { setViewMode } from './renderer.js';
import { generateThumbnails, clearThumbnailCache } from '../ui/panels/left-panel.js';
import { markDocumentModified } from '../ui/chrome/tabs.js';
import { updateAllStatus } from '../ui/chrome/status-bar.js';
import { hideProperties } from '../ui/panels/properties-panel.js';
import { saveFileDialog, writeBinaryFile, readBinaryFile, isTauri } from '../core/platform.js';
import { showLoading, hideLoading } from '../ui/chrome/dialogs.js';
import { recordPageStructure } from '../core/undo-manager.js';
import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import { resetAnnotationStorage } from './form-layer.js';

// Page clipboard for cut/copy/paste
let pageClipboard = null; // { bytes: Uint8Array, cut: boolean, sourcePageNum: number }

export function getPageClipboard() {
  return pageClipboard;
}

/**
 * Copy a page to the page clipboard.
 * Extracts the page as a standalone single-page PDF.
 */
export async function copyPage(pageNum) {
  if (!state.pdfDoc) return;

  const cacheKey = getCacheKey();
  const currentBytes = getCachedPdfBytes(cacheKey);
  if (!currentBytes) return;

  const srcDoc = await PDFDocument.load(currentBytes, { ignoreEncryption: true });
  const newDoc = await PDFDocument.create();
  const [copiedPage] = await newDoc.copyPages(srcDoc, [pageNum - 1]);
  newDoc.addPage(copiedPage);

  pageClipboard = {
    bytes: new Uint8Array(await newDoc.save()),
    cut: false,
    sourcePageNum: pageNum,
  };
}

/**
 * Cut a page (copy + delete).
 */
export async function cutPage(pageNum) {
  if (!state.pdfDoc) return;
  if (state.pdfDoc.numPages <= 1) return;

  await copyPage(pageNum);
  if (pageClipboard) {
    pageClipboard.cut = true;
    await deletePages([pageNum]);
  }
}

/**
 * Paste the page clipboard after the given page number.
 */
export async function pastePage(afterPageNum) {
  if (!state.pdfDoc || !pageClipboard) return;

  const cacheKey = getCacheKey();
  const currentBytes = getCachedPdfBytes(cacheKey);
  if (!currentBytes) return;

  const doc = getActiveDocument();
  const oldAnnotations = state.annotations.map(a => ({ ...a }));
  const oldRotations = { ...doc.pageRotations };
  const oldPage = state.currentPage;

  showLoading('Pasting page...');
  try {
    const destDoc = await PDFDocument.load(currentBytes, { ignoreEncryption: true });
    const oldNumPages = destDoc.getPageCount();
    const srcDoc = await PDFDocument.load(pageClipboard.bytes, { ignoreEncryption: true });
    const srcPageCount = srcDoc.getPageCount();

    const indices = [];
    for (let i = 0; i < srcPageCount; i++) indices.push(i);
    const copiedPages = await destDoc.copyPages(srcDoc, indices);

    const insertIdx = afterPageNum; // insert after this page (0-based index = afterPageNum)
    for (let i = 0; i < copiedPages.length; i++) {
      destDoc.insertPage(insertIdx + i, copiedPages[i]);
    }

    // Build page mapping
    const pageMapping = {};
    for (let oldP = 1; oldP <= oldNumPages; oldP++) {
      if (oldP <= insertIdx) {
        pageMapping[oldP] = oldP;
      } else {
        pageMapping[oldP] = oldP + srcPageCount;
      }
    }

    const newAnnotations = remapAnnotations(state.annotations, pageMapping);
    const newRotations = remapRotations(doc.pageRotations, pageMapping);
    const newBytes = new Uint8Array(await destDoc.save());
    const targetPage = insertIdx + 1;

    await reloadFromBytes(newBytes, newAnnotations, newRotations, targetPage);
    recordPageStructure(currentBytes, oldAnnotations, oldRotations, oldPage, newBytes, newAnnotations, newRotations, targetPage);
  } finally {
    hideLoading();
  }
}

// Get the cache key for the current document's bytes
function getCacheKey() {
  const doc = getActiveDocument();
  if (!doc) return null;
  if (doc.filePath) return doc.filePath;
  return `__memory__${doc.id}`;
}

// Reload PDF.js from new bytes, preserving annotations and rotations
async function reloadFromBytes(newBytes, annotations, rotations, targetPage) {
  const doc = getActiveDocument();
  if (!doc) return;

  const cacheKey = getCacheKey();
  if (!cacheKey) return;

  // Cancel any in-progress annotation loading
  cancelAnnotationLoading();

  // Destroy old pdf.js document to free memory
  if (state.pdfDoc) {
    state.pdfDoc.destroy();
  }

  // Update cache with new bytes
  setCachedPdfBytes(cacheKey, newBytes.slice());

  // Reset form field annotation storage
  resetAnnotationStorage();

  // Load new bytes into pdf.js (slice to prevent buffer detachment of the original)
  state.pdfDoc = await pdfjsLib.getDocument({
    data: newBytes.slice(),
    cMapUrl: '/pdfjs/web/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/web/standard_fonts/',
    isEvalSupported: false,
  }).promise;

  // Restore annotations and rotations
  state.annotations = annotations;
  doc.pageRotations = rotations;

  // Clamp current page
  const numPages = state.pdfDoc.numPages;
  state.currentPage = Math.max(1, Math.min(targetPage, numPages));

  // Mark all pages as loaded so background loader won't overwrite
  markAllAnnotationPagesLoaded(numPages);

  // Clear selection
  state.selectedAnnotation = null;
  state.selectedAnnotations = [];
  hideProperties();

  // Re-render
  await setViewMode(state.viewMode);
  clearThumbnailCache(doc.id);
  generateThumbnails();
  updateAllStatus();
  markDocumentModified();
}

// Build remapped annotations array based on page mapping
function remapAnnotations(annotations, pageMapping) {
  const remapped = [];
  for (const ann of annotations) {
    const newPage = pageMapping[ann.page];
    if (newPage !== undefined && newPage !== null) {
      remapped.push({ ...ann, page: newPage });
    }
  }
  return remapped;
}

// Build remapped rotations object based on page mapping
function remapRotations(rotations, pageMapping) {
  const remapped = {};
  for (const [pageStr, rotation] of Object.entries(rotations)) {
    const oldPage = parseInt(pageStr, 10);
    const newPage = pageMapping[oldPage];
    if (newPage !== undefined && newPage !== null && rotation !== 0) {
      remapped[newPage] = rotation;
    }
  }
  return remapped;
}

/**
 * Insert blank pages into the current document.
 * @param {'before'|'after'|'start'|'end'} position - Where to insert
 * @param {number} refPage - Reference page number (used for before/after)
 * @param {number} count - Number of pages to insert
 * @param {number} widthPt - Page width in points
 * @param {number} heightPt - Page height in points
 */
export async function insertBlankPages(position, refPage, count, widthPt, heightPt) {
  if (!state.pdfDoc) return;

  const cacheKey = getCacheKey();
  const currentBytes = getCachedPdfBytes(cacheKey);
  if (!currentBytes) return;

  const doc = getActiveDocument();
  const oldAnnotations = state.annotations.map(a => ({ ...a }));
  const oldRotations = { ...doc.pageRotations };
  const oldPage = state.currentPage;

  showLoading('Inserting pages...');
  try {
    const pdfDoc = await PDFDocument.load(currentBytes, { ignoreEncryption: true });
    const oldNumPages = pdfDoc.getPageCount();

    // Determine insertion index (0-based)
    let insertIdx;
    switch (position) {
      case 'start': insertIdx = 0; break;
      case 'end': insertIdx = oldNumPages; break;
      case 'before': insertIdx = refPage - 1; break;
      case 'after': insertIdx = refPage; break;
      default: insertIdx = oldNumPages;
    }

    // Insert blank pages
    for (let i = 0; i < count; i++) {
      pdfDoc.insertPage(insertIdx + i, [widthPt, heightPt]);
    }

    // Build page mapping (old page num -> new page num)
    const pageMapping = {};
    for (let oldP = 1; oldP <= oldNumPages; oldP++) {
      if (oldP <= insertIdx) {
        pageMapping[oldP] = oldP;
      } else {
        pageMapping[oldP] = oldP + count;
      }
    }

    const newAnnotations = remapAnnotations(state.annotations, pageMapping);
    const newRotations = remapRotations(doc.pageRotations, pageMapping);

    const newBytes = new Uint8Array(await pdfDoc.save());

    // Determine which page to navigate to
    let targetPage = insertIdx + 1; // First inserted page

    await reloadFromBytes(newBytes, newAnnotations, newRotations, targetPage);

    // Record undo
    recordPageStructure(currentBytes, oldAnnotations, oldRotations, oldPage, newBytes, newAnnotations, newRotations, targetPage);
  } finally {
    hideLoading();
  }
}

/**
 * Delete pages from the current document.
 * @param {number[]} pageNumbers - Page numbers to delete (1-based)
 */
export async function deletePages(pageNumbers) {
  if (!state.pdfDoc) return;

  const numPages = state.pdfDoc.numPages;

  // Guard: can't delete all pages
  if (pageNumbers.length >= numPages) {
    alert('Cannot delete all pages. At least one page must remain.');
    return;
  }

  const cacheKey = getCacheKey();
  const currentBytes = getCachedPdfBytes(cacheKey);
  if (!currentBytes) return;

  const doc = getActiveDocument();
  const oldAnnotations = state.annotations.map(a => ({ ...a }));
  const oldRotations = { ...doc.pageRotations };
  const oldPage = state.currentPage;

  showLoading('Deleting pages...');
  try {
    const pdfDoc = await PDFDocument.load(currentBytes, { ignoreEncryption: true });

    // Sort descending so indices don't shift during removal
    const sorted = [...pageNumbers].sort((a, b) => b - a);
    const deleteSet = new Set(pageNumbers);

    for (const pageNum of sorted) {
      pdfDoc.removePage(pageNum - 1);
    }

    // Build page mapping: old page -> new page (deleted pages map to null)
    const pageMapping = {};
    let newIdx = 1;
    for (let oldP = 1; oldP <= numPages; oldP++) {
      if (deleteSet.has(oldP)) {
        pageMapping[oldP] = null;
      } else {
        pageMapping[oldP] = newIdx++;
      }
    }

    const newAnnotations = remapAnnotations(state.annotations, pageMapping);
    const newRotations = remapRotations(doc.pageRotations, pageMapping);

    const newBytes = new Uint8Array(await pdfDoc.save());
    const newNumPages = pdfDoc.getPageCount();

    // Clamp current page
    let targetPage = Math.min(state.currentPage, newNumPages);

    await reloadFromBytes(newBytes, newAnnotations, newRotations, targetPage);

    // Record undo
    recordPageStructure(currentBytes, oldAnnotations, oldRotations, oldPage, newBytes, newAnnotations, newRotations, targetPage);
  } finally {
    hideLoading();
  }
}

/**
 * Extract pages to a new PDF file.
 * @param {number[]} pageNumbers - Page numbers to extract (1-based)
 * @param {boolean} deleteFromOriginal - Whether to delete extracted pages from the source
 */
export async function extractPages(pageNumbers, deleteFromOriginal) {
  if (!state.pdfDoc) return;

  if (pageNumbers.length === 0) {
    alert('No pages selected for extraction.');
    return;
  }

  const cacheKey = getCacheKey();
  const currentBytes = getCachedPdfBytes(cacheKey);
  if (!currentBytes) return;

  // Ask user where to save
  const doc = getActiveDocument();
  const baseName = (doc.fileName || 'document').replace(/\.pdf$/i, '');
  const defaultPath = `${baseName}_extracted.pdf`;

  const savePath = await saveFileDialog(defaultPath, [{ name: 'PDF Files', extensions: ['pdf'] }]);
  if (!savePath) return;

  showLoading('Extracting pages...');
  try {
    // Create new document with extracted pages
    const srcDoc = await PDFDocument.load(currentBytes, { ignoreEncryption: true });
    const extractDoc = await PDFDocument.create();

    const indices = pageNumbers.map(p => p - 1);
    const copiedPages = await extractDoc.copyPages(srcDoc, indices);
    for (const page of copiedPages) {
      extractDoc.addPage(page);
    }

    const extractBytes = new Uint8Array(await extractDoc.save());
    await writeBinaryFile(savePath, extractBytes);

    // Optionally delete from original
    if (deleteFromOriginal) {
      const numPages = state.pdfDoc.numPages;
      if (pageNumbers.length >= numPages) {
        alert('Cannot delete all pages from the source document.');
      } else {
        await deletePages(pageNumbers);
      }
    }
  } finally {
    hideLoading();
  }
}

/**
 * Reorder pages in the current document.
 * @param {number[]} newPageOrder - Array where newPageOrder[i] = old page number that becomes page i+1
 *   e.g. [3,1,2,4] means old page 3 becomes new page 1, old page 1 becomes new page 2, etc.
 */
export async function reorderPages(newPageOrder) {
  if (!state.pdfDoc) return;

  const numPages = state.pdfDoc.numPages;
  if (newPageOrder.length !== numPages) return;

  // Check if order actually changed
  const unchanged = newPageOrder.every((p, i) => p === i + 1);
  if (unchanged) return;

  const cacheKey = getCacheKey();
  const currentBytes = getCachedPdfBytes(cacheKey);
  if (!currentBytes) return;

  const doc = getActiveDocument();
  const oldAnnotations = state.annotations.map(a => ({ ...a }));
  const oldRotations = { ...doc.pageRotations };
  const oldPage = state.currentPage;

  showLoading('Reordering pages...');
  try {
    const srcDoc = await PDFDocument.load(currentBytes, { ignoreEncryption: true });
    const newDoc = await PDFDocument.create();

    // Copy pages in new order
    const indices = newPageOrder.map(p => p - 1);
    const copiedPages = await newDoc.copyPages(srcDoc, indices);
    for (const page of copiedPages) {
      newDoc.addPage(page);
    }

    // Build page mapping: old page -> new page
    const pageMapping = {};
    for (let newP = 0; newP < newPageOrder.length; newP++) {
      const oldP = newPageOrder[newP];
      pageMapping[oldP] = newP + 1;
    }

    const newAnnotations = remapAnnotations(state.annotations, pageMapping);
    const newRotations = remapRotations(doc.pageRotations, pageMapping);

    const newBytes = new Uint8Array(await newDoc.save());

    // Navigate to the page that the current page moved to
    const targetPage = pageMapping[state.currentPage] || 1;

    await reloadFromBytes(newBytes, newAnnotations, newRotations, targetPage);

    // Record undo
    recordPageStructure(currentBytes, oldAnnotations, oldRotations, oldPage, newBytes, newAnnotations, newRotations, targetPage);
  } finally {
    hideLoading();
  }
}

/**
 * Restore page state (used by undo/redo).
 * @param {Uint8Array} bytes - PDF bytes to restore
 * @param {Array} annotations - Annotations array to restore
 * @param {Object} rotations - Page rotations to restore
 * @param {number} currentPage - Page to navigate to
 */
export async function restorePageState(bytes, annotations, rotations, currentPage) {
  showLoading('Restoring...');
  try {
    await reloadFromBytes(bytes, annotations, rotations, currentPage);
  } finally {
    hideLoading();
  }
}

/**
 * Replace a page in the current document with pages from another PDF file.
 * @param {number} pageNumber - The page number to replace (1-based)
 */
export async function replacePages(pageNumber) {
  if (!state.pdfDoc) return;
  if (!isTauri()) return;

  const numPages = state.pdfDoc.numPages;
  if (pageNumber < 1 || pageNumber > numPages) return;

  // Open file dialog to pick replacement PDF
  let filePath;
  try {
    filePath = await window.__TAURI__.dialog.open({
      multiple: false,
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    });
  } catch (e) {
    return;
  }
  if (!filePath) return;

  const cacheKey = getCacheKey();
  const currentBytes = getCachedPdfBytes(cacheKey);
  if (!currentBytes) return;

  const doc = getActiveDocument();
  const oldAnnotations = state.annotations.map(a => ({ ...a }));
  const oldRotations = { ...doc.pageRotations };
  const oldPage = state.currentPage;

  showLoading('Replacing page...');
  try {
    // Read replacement file
    const fileData = await readBinaryFile(filePath);
    const srcBytes = new Uint8Array(fileData);
    const srcDoc = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
    const srcPageCount = srcDoc.getPageCount();

    if (srcPageCount === 0) {
      alert('The selected PDF has no pages.');
      return;
    }

    const destDoc = await PDFDocument.load(currentBytes, { ignoreEncryption: true });
    const oldNumPages = destDoc.getPageCount();

    // Copy all pages from source
    const indices = [];
    for (let i = 0; i < srcPageCount; i++) indices.push(i);
    const copiedPages = await destDoc.copyPages(srcDoc, indices);

    // Remove the target page
    destDoc.removePage(pageNumber - 1);

    // Insert replacement pages at the same position
    for (let i = 0; i < copiedPages.length; i++) {
      destDoc.insertPage(pageNumber - 1 + i, copiedPages[i]);
    }

    // Build page mapping
    // Pages before the replaced page: unchanged
    // The replaced page: mapped to null (deleted)
    // Pages after: shifted by (srcPageCount - 1)
    const pageMapping = {};
    for (let oldP = 1; oldP <= oldNumPages; oldP++) {
      if (oldP < pageNumber) {
        pageMapping[oldP] = oldP;
      } else if (oldP === pageNumber) {
        pageMapping[oldP] = null; // replaced page loses its annotations
      } else {
        pageMapping[oldP] = oldP + srcPageCount - 1;
      }
    }

    const newAnnotations = remapAnnotations(state.annotations, pageMapping);
    const newRotations = remapRotations(doc.pageRotations, pageMapping);

    const newBytes = new Uint8Array(await destDoc.save());
    const targetPage = pageNumber; // Navigate to where replacement starts

    await reloadFromBytes(newBytes, newAnnotations, newRotations, targetPage);

    // Record undo
    recordPageStructure(currentBytes, oldAnnotations, oldRotations, oldPage, newBytes, newAnnotations, newRotations, targetPage);
  } catch (err) {
    console.error('Failed to replace page:', err);
    alert(`Failed to replace page: ${err.message}`);
  } finally {
    hideLoading();
  }
}

/**
 * Merge external PDF files into the current document.
 * @param {string[]} filePaths - Paths of PDF files to merge in
 * @param {'end'|'start'|'after'} position - Where to insert the merged pages
 */
export async function mergeFiles(filePaths, position) {
  if (!filePaths || filePaths.length === 0) return;
  if (!isTauri()) return;

  // Must have a document open
  if (!state.pdfDoc) return;

  const cacheKey = getCacheKey();
  const currentBytes = getCachedPdfBytes(cacheKey);
  if (!currentBytes) return;

  const doc = getActiveDocument();
  const oldAnnotations = state.annotations.map(a => ({ ...a }));
  const oldRotations = { ...doc.pageRotations };
  const oldPage = state.currentPage;

  showLoading('Merging PDFs...');
  try {
    const destDoc = await PDFDocument.load(currentBytes, { ignoreEncryption: true });
    const oldNumPages = destDoc.getPageCount();

    // Determine insertion index (0-based)
    let insertIdx;
    switch (position) {
      case 'start': insertIdx = 0; break;
      case 'after': insertIdx = state.currentPage; break;
      case 'end':
      default: insertIdx = oldNumPages; break;
    }

    // Read and merge each file
    let totalInserted = 0;
    for (const filePath of filePaths) {
      try {
        const fileData = await readBinaryFile(filePath);
        const srcBytes = new Uint8Array(fileData);
        const srcDoc = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
        const srcPageCount = srcDoc.getPageCount();

        if (srcPageCount === 0) continue;

        const indices = [];
        for (let i = 0; i < srcPageCount; i++) indices.push(i);
        const copiedPages = await destDoc.copyPages(srcDoc, indices);

        for (let i = 0; i < copiedPages.length; i++) {
          destDoc.insertPage(insertIdx + totalInserted + i, copiedPages[i]);
        }

        totalInserted += srcPageCount;
      } catch (err) {
        console.error(`Failed to merge file: ${filePath}`, err);
        alert(`Failed to merge: ${filePath.split(/[\\/]/).pop()}\n${err.message}`);
      }
    }

    if (totalInserted === 0) {
      return;
    }

    // Build page mapping for existing annotations/rotations
    const pageMapping = {};
    for (let oldP = 1; oldP <= oldNumPages; oldP++) {
      if (oldP <= insertIdx) {
        pageMapping[oldP] = oldP;
      } else {
        pageMapping[oldP] = oldP + totalInserted;
      }
    }

    const newAnnotations = remapAnnotations(state.annotations, pageMapping);
    const newRotations = remapRotations(doc.pageRotations, pageMapping);

    const newBytes = new Uint8Array(await destDoc.save());

    // Navigate to first merged page
    const targetPage = insertIdx + 1;

    await reloadFromBytes(newBytes, newAnnotations, newRotations, targetPage);

    // Record undo
    recordPageStructure(currentBytes, oldAnnotations, oldRotations, oldPage, newBytes, newAnnotations, newRotations, targetPage);
  } finally {
    hideLoading();
  }
}
