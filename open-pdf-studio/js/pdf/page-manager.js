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
import { clearPdfVectorCache } from '../tools/pdf-snap-extractor.js';
import { clearTextCache } from '../search/find-controller.js';
import i18next from '../i18n/config.js';
import { showMessage } from '../bridge.js';

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
  if (!getActiveDocument()?.pdfDoc) return;

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
 * Copy multiple pages to the page clipboard.
 */
export async function copyPages(pageNumbers) {
  if (!getActiveDocument()?.pdfDoc || !pageNumbers || pageNumbers.length === 0) return;

  const cacheKey = getCacheKey();
  const currentBytes = getCachedPdfBytes(cacheKey);
  if (!currentBytes) return;

  const srcDoc = await PDFDocument.load(currentBytes, { ignoreEncryption: true });
  const newDoc = await PDFDocument.create();
  const indices = pageNumbers.map(p => p - 1);
  const copiedPages = await newDoc.copyPages(srcDoc, indices);
  for (const page of copiedPages) newDoc.addPage(page);

  pageClipboard = {
    bytes: new Uint8Array(await newDoc.save()),
    cut: false,
    sourcePageNum: pageNumbers[0],
  };
}

/**
 * Cut a page (copy + delete).
 */
export async function cutPage(pageNum) {
  const activeDoc = getActiveDocument();
  if (!activeDoc?.pdfDoc) return;
  if (activeDoc.pdfDoc.numPages <= 1) return;

  await copyPage(pageNum);
  if (pageClipboard) {
    pageClipboard.cut = true;
    await deletePages([pageNum]);
  }
}

/**
 * Cut multiple pages (copy + delete).
 */
export async function cutPages(pageNumbers) {
  const activeDoc = getActiveDocument();
  if (!activeDoc?.pdfDoc || !pageNumbers || pageNumbers.length === 0) return;
  if (activeDoc.pdfDoc.numPages <= pageNumbers.length) return;

  await copyPages(pageNumbers);
  if (pageClipboard) {
    pageClipboard.cut = true;
    await deletePages(pageNumbers);
  }
}

/**
 * Paste the page clipboard after the given page number.
 */
export async function pastePage(afterPageNum) {
  if (!getActiveDocument()?.pdfDoc || !pageClipboard) return;

  const cacheKey = getCacheKey();
  const currentBytes = getCachedPdfBytes(cacheKey);
  if (!currentBytes) return;

  const doc = getActiveDocument();
  const oldAnnotations = doc.annotations.map(a => ({ ...a }));
  const oldRotations = { ...doc.pageRotations };
  const oldPage = doc.currentPage;

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

    const newAnnotations = remapAnnotations(doc.annotations, pageMapping);
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
export function getCacheKey() {
  const doc = getActiveDocument();
  if (!doc) return null;
  if (doc.filePath) return doc.filePath;
  return `__memory__${doc.id}`;
}

// Reload PDF.js from new bytes, preserving annotations and rotations
export async function reloadFromBytes(newBytes, annotations, rotations, targetPage) {
  const doc = getActiveDocument();
  if (!doc) return;

  const oldPath = doc.filePath || getCacheKey();
  if (!oldPath) return;

  // Cancel any in-progress annotation loading
  cancelAnnotationLoading();

  // Destroy old pdf.js document to free memory
  if (doc.pdfDoc) {
    doc.pdfDoc.destroy();
  }

  // ── Issue #247 fix ──────────────────────────────────────────────────────
  // The PDFium main-view renderer reads each page bitmap from the file on
  // DISK, keyed by path (the Rust DocHandle / PdfBytes / PdfiumDoc / pixmap
  // caches are all path-keyed). After a structural edit (merge / insert /
  // delete) only the in-memory bytes change — the on-disk file does not — so
  // the main view kept rendering the pre-edit document while the thumbnails
  // (drawn from pdf.js) updated. Fix: persist the edited bytes to a FRESH temp
  // working file and point the document at it. A brand-new path has no cache
  // entries anywhere, so the main view rebuilds from the edited content, and
  // the user's original file is never touched (saved docs route Save → Save-As).
  let renderPath = oldPath;
  if (isTauri() && window.__TAURI__?.path && window.__TAURI__?.fs) {
    const invoke = window.__TAURI__?.core?.invoke;
    try {
      const tempDir = await window.__TAURI__.path.tempDir();
      const sep = (tempDir.endsWith('/') || tempDir.endsWith('\\')) ? '' : '/';
      renderPath = `${tempDir}${sep}opds-edit-${Date.now()}.pdf`;
      try { await invoke?.('allow_fs_scope', { path: renderPath }); } catch {}
      await writeBinaryFile(renderPath, newBytes.slice());

      const prevPath = oldPath;
      const wasUntitled = !!doc.isUntitled;
      const prevWasOurTemp = !!doc._renderTemp; // a temp working copy WE created earlier
      // Remember the real file Ctrl+S must write to: the original opened path.
      // An untitled doc has none → it stays untitled (Ctrl+S → Save-As).
      const saveTarget = doc.saveTargetPath || (wasUntitled ? null : oldPath);
      doc.filePath = renderPath;
      doc._renderTemp = true;
      doc.saveTargetPath = saveTarget;
      doc.isUntitled = !saveTarget; // saved docs keep Ctrl+S → original; untitled → Save-As

      // Delete the previous working/temp file (never a real saved original).
      if ((prevWasOurTemp || wasUntitled) && prevPath && prevPath !== renderPath) {
        try { await window.__TAURI__.fs.remove(prevPath); } catch {}
      }
    } catch (e) {
      console.warn('[reloadFromBytes] temp working-file write failed; main view may stay stale', e);
      renderPath = oldPath;
    }
  }

  // Update cache with new bytes (keyed by the path we now render from)
  setCachedPdfBytes(renderPath, newBytes.slice());

  // Reset form field annotation storage
  resetAnnotationStorage();

  // Caches derived from the old bytes that are NOT keyed by file path: the
  // snap-to-content geometry (keyed by page number) and the search text (keyed
  // by document id). Neither notices that the bytes were replaced, so after a
  // shift/straighten/delete the snap points and search highlights would sit at
  // the old positions, or belong to another page. Cleared before the re-render
  // below, which prefetches the snap geometry again.
  clearPdfVectorCache();
  clearTextCache(doc.id);

  // Load new bytes into pdf.js (slice to prevent buffer detachment of the original)
  doc.pdfDoc = await pdfjsLib.getDocument({
    data: newBytes.slice(),
    cMapUrl: '/pdfjs/web/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/web/standard_fonts/',
    isEvalSupported: false,
    verbosity: 0,
  }).promise;

  // Restore annotations and rotations
  doc.annotations = annotations;
  doc.pageRotations = rotations;

  // Clamp current page
  const numPages = doc.pdfDoc.numPages;
  doc.currentPage = Math.max(1, Math.min(targetPage, numPages));

  // Mark all pages as loaded so background loader won't overwrite
  markAllAnnotationPagesLoaded(numPages);

  // Clear selection
  if (doc) {
    doc.selectedAnnotation = null;
    doc.selectedAnnotations = [];
  }
  hideProperties();

  // Re-render (preserve the book-spread / facing layout variants of continuous)
  await setViewMode(
    doc?.facingSpread && doc?.viewMode === 'continuous' ? 'facing'
    : doc?.bookSpread && doc?.viewMode === 'continuous' ? 'book'
    : (doc?.viewMode || 'single')
  );
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
  if (!getActiveDocument()?.pdfDoc) return;

  const cacheKey = getCacheKey();
  const currentBytes = getCachedPdfBytes(cacheKey);
  if (!currentBytes) return;

  const doc = getActiveDocument();
  const oldAnnotations = doc.annotations.map(a => ({ ...a }));
  const oldRotations = { ...doc.pageRotations };
  const oldPage = doc.currentPage;

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

    const newAnnotations = remapAnnotations(doc.annotations, pageMapping);
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
 * Insert pages from another PDF file at a specific position relative to a
 * reference page. Mirrors replacePages()/mergeFiles(): opens a file picker,
 * loads the chosen PDF with pdf-lib, copies all its pages into the current
 * document and remaps annotations/rotations, all undo-able via the shared
 * page-structure convention.
 * @param {number} refPage - Reference page number (1-based)
 * @param {'before'|'after'} position - Insert before or after the reference page
 */
export async function insertPagesFromFile(refPage, position) {
  const activeDoc = getActiveDocument();
  if (!activeDoc?.pdfDoc) return;
  if (!isTauri()) return;

  const numPages = activeDoc.pdfDoc.numPages;
  if (refPage < 1 || refPage > numPages) return;

  // Open file dialog to pick the source PDF
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
  const oldAnnotations = doc.annotations.map(a => ({ ...a }));
  const oldRotations = { ...doc.pageRotations };
  const oldPage = doc.currentPage;

  showLoading('Inserting pages...');
  try {
    // Ensure the picked source file is inside the fs allowlist scope.
    try { await window.__TAURI__?.core?.invoke?.('allow_fs_scope', { path: filePath }); } catch {}
    const fileData = await readBinaryFile(filePath);
    const srcBytes = new Uint8Array(fileData);
    const srcDoc = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
    const srcPageCount = srcDoc.getPageCount();

    if (srcPageCount === 0) {
      showMessage(i18next.t('selectedPdfNoPages'));
      return;
    }

    const destDoc = await PDFDocument.load(currentBytes, { ignoreEncryption: true });
    const oldNumPages = destDoc.getPageCount();

    // 0-based insertion index
    const insertIdx = position === 'before' ? refPage - 1 : refPage;

    const indices = [];
    for (let i = 0; i < srcPageCount; i++) indices.push(i);
    const copiedPages = await destDoc.copyPages(srcDoc, indices);
    for (let i = 0; i < copiedPages.length; i++) {
      destDoc.insertPage(insertIdx + i, copiedPages[i]);
    }

    // Build page mapping for existing annotations/rotations
    const pageMapping = {};
    for (let oldP = 1; oldP <= oldNumPages; oldP++) {
      if (oldP <= insertIdx) {
        pageMapping[oldP] = oldP;
      } else {
        pageMapping[oldP] = oldP + srcPageCount;
      }
    }

    const newAnnotations = remapAnnotations(doc.annotations, pageMapping);
    const newRotations = remapRotations(doc.pageRotations, pageMapping);

    const newBytes = new Uint8Array(await destDoc.save());
    const targetPage = insertIdx + 1; // Navigate to first inserted page

    await reloadFromBytes(newBytes, newAnnotations, newRotations, targetPage);

    // Record undo
    recordPageStructure(currentBytes, oldAnnotations, oldRotations, oldPage, newBytes, newAnnotations, newRotations, targetPage);
  } catch (err) {
    console.error('Failed to insert pages from file:', err);
    showMessage(i18next.t('failedToInsertPagesFromFile', { error: err.message }));
  } finally {
    hideLoading();
  }
}

/**
 * Delete pages from the current document.
 * @param {number[]} pageNumbers - Page numbers to delete (1-based)
 */
export async function deletePages(pageNumbers) {
  const activeDoc = getActiveDocument();
  if (!activeDoc?.pdfDoc) return;

  const numPages = activeDoc.pdfDoc.numPages;

  // Guard: can't delete all pages
  if (pageNumbers.length >= numPages) {
    showMessage(i18next.t('cannotDeleteAllPages'));
    return;
  }

  const cacheKey = getCacheKey();
  const currentBytes = getCachedPdfBytes(cacheKey);
  if (!currentBytes) return;

  const doc = getActiveDocument();
  const oldAnnotations = doc.annotations.map(a => ({ ...a }));
  const oldRotations = { ...doc.pageRotations };
  const oldPage = doc.currentPage;

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

    const newAnnotations = remapAnnotations(doc.annotations, pageMapping);
    const newRotations = remapRotations(doc.pageRotations, pageMapping);

    const newBytes = new Uint8Array(await pdfDoc.save());
    const newNumPages = pdfDoc.getPageCount();

    // Clamp current page
    let targetPage = Math.min(doc.currentPage, newNumPages);

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
  const activeDoc = getActiveDocument();
  if (!activeDoc?.pdfDoc) return;

  if (pageNumbers.length === 0) {
    showMessage(i18next.t('noPagesSelected'));
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
      const numPages = activeDoc.pdfDoc.numPages;
      if (pageNumbers.length >= numPages) {
        showMessage(i18next.t('cannotDeleteAllPagesSource'));
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
  const activeDoc = getActiveDocument();
  if (!activeDoc?.pdfDoc) return;

  const numPages = activeDoc.pdfDoc.numPages;
  if (newPageOrder.length !== numPages) return;

  // Check if order actually changed
  const unchanged = newPageOrder.every((p, i) => p === i + 1);
  if (unchanged) return;

  const cacheKey = getCacheKey();
  const currentBytes = getCachedPdfBytes(cacheKey);
  if (!currentBytes) return;

  const doc = getActiveDocument();
  const oldAnnotations = doc.annotations.map(a => ({ ...a }));
  const oldRotations = { ...doc.pageRotations };
  const oldPage = doc.currentPage;

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

    const newAnnotations = remapAnnotations(doc.annotations, pageMapping);
    const newRotations = remapRotations(doc.pageRotations, pageMapping);

    const newBytes = new Uint8Array(await newDoc.save());

    // Navigate to the page that the current page moved to
    const targetPage = pageMapping[doc.currentPage] || 1;

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
  const activeDoc = getActiveDocument();
  if (!activeDoc?.pdfDoc) return;
  if (!isTauri()) return;

  const numPages = activeDoc.pdfDoc.numPages;
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
  const oldAnnotations = doc.annotations.map(a => ({ ...a }));
  const oldRotations = { ...doc.pageRotations };
  const oldPage = doc.currentPage;

  showLoading('Replacing page...');
  try {
    // Read replacement file
    const fileData = await readBinaryFile(filePath);
    const srcBytes = new Uint8Array(fileData);
    const srcDoc = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
    const srcPageCount = srcDoc.getPageCount();

    if (srcPageCount === 0) {
      showMessage(i18next.t('selectedPdfNoPages'));
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

    const newAnnotations = remapAnnotations(doc.annotations, pageMapping);
    const newRotations = remapRotations(doc.pageRotations, pageMapping);

    const newBytes = new Uint8Array(await destDoc.save());
    const targetPage = pageNumber; // Navigate to where replacement starts

    await reloadFromBytes(newBytes, newAnnotations, newRotations, targetPage);

    // Record undo
    recordPageStructure(currentBytes, oldAnnotations, oldRotations, oldPage, newBytes, newAnnotations, newRotations, targetPage);
  } catch (err) {
    console.error('Failed to replace page:', err);
    showMessage(i18next.t('failedToReplacePage', { error: err.message }));
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
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return;

  const cacheKey = getCacheKey();
  let currentBytes = getCachedPdfBytes(cacheKey);
  if (!currentBytes && doc.filePath) {
    // Bytes may not be in the JS cache yet (e.g. a just-opened doc) — read
    // them from disk like savePDF does, so merge never silently no-ops.
    try { currentBytes = new Uint8Array(await readBinaryFile(doc.filePath)); } catch {}
  }
  if (!currentBytes) return;
  const oldAnnotations = doc.annotations.map(a => ({ ...a }));
  const oldRotations = { ...doc.pageRotations };
  const oldPage = doc.currentPage;

  showLoading('Merging PDFs...');
  try {
    const destDoc = await PDFDocument.load(currentBytes, { ignoreEncryption: true });
    const oldNumPages = destDoc.getPageCount();

    // Determine insertion index (0-based)
    let insertIdx;
    switch (position) {
      case 'start': insertIdx = 0; break;
      case 'after': insertIdx = doc.currentPage; break;
      case 'end':
      default: insertIdx = oldNumPages; break;
    }

    // Read and merge each file
    let totalInserted = 0;
    for (const filePath of filePaths) {
      try {
        // Ensure the picked source file is inside the fs allowlist scope.
        try { await window.__TAURI__?.core?.invoke?.('allow_fs_scope', { path: filePath }); } catch {}
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
        const fileName = filePath.split(/[\\/]/).pop();
        const detail = err?.message || String(err);
        showMessage(`${i18next.t('failedToMergeFile', { file: fileName, error: detail })}\n(${detail})`);
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

    const newAnnotations = remapAnnotations(doc.annotations, pageMapping);
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
