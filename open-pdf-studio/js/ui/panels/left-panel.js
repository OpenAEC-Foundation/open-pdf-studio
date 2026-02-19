import { state, getActiveDocument, getPageRotation } from '../../core/state.js';
import { updateAnnotationsList } from './annotations-list.js';
import { updateAttachmentsList } from './attachments.js';
import { updateSignaturesList } from './signatures.js';
import { updateLayersList } from './layers.js';
import { updateFormFieldsList } from './form-fields.js';
import { updateDestinationsList } from './destinations.js';
import { updateTagsList } from './tags.js';
import { updateLinksList } from './links.js';
import { updateBookmarksList } from './bookmarks.js';
import { switchToLeftPanelTab, toggleLeftPanelCollapsed, activeTab, setActiveTab, setCollapsed } from '../../solid/stores/leftPanelStore.js';
import {
  setPageCount, setActivePage, setPlaceholderSize,
  setThumbnailImage, clearAllThumbnails, removeThumbnailImage
} from '../../solid/stores/panels/thumbnailStore.js';

// Thumbnail scale (relative to actual page size)
const THUMBNAIL_SCALE = 0.2;

// Cache for thumbnail data per document: Map<docId, Map<pageNum, imageDataURL>>
const thumbnailCache = new Map();

// Store pdfDoc references and state for each document
const documentState = new Map(); // { pdfDoc, numPages, nextPage, startPage }

// Priority queue for visible thumbnails (pages that should load first)
let priorityPages = new Set();

// Track the last scroll position to continue loading from there
let lastVisiblePage = 1;

// Scroll debounce timer
let scrollDebounceTimer = null;

// Track if scroll listener is attached
let scrollListenerAttached = false;

// Initialize left panel
export function initLeftPanel() {
  attachScrollListener();
}

// Attach scroll listener to the thumbnails container (may need to retry if Solid hasn't rendered yet)
function attachScrollListener() {
  if (scrollListenerAttached) return;
  const tc = document.getElementById('thumbnails-container');
  if (tc) {
    tc.addEventListener('scroll', handleThumbnailScroll);
    scrollListenerAttached = true;
  } else {
    setTimeout(attachScrollListener, 100);
  }
}

// Handle scroll in thumbnails container - debounced
function handleThumbnailScroll() {
  if (scrollDebounceTimer) {
    clearTimeout(scrollDebounceTimer);
  }

  scrollDebounceTimer = setTimeout(() => {
    updateVisiblePriorities();
  }, 100);
}

// Find visible thumbnails and add them to priority queue
function updateVisiblePriorities() {
  const thumbnailsContainer = document.getElementById('thumbnails-container');
  if (!thumbnailsContainer) return;

  const activeDoc = getActiveDocument();
  if (!activeDoc) return;

  const docCache = thumbnailCache.get(activeDoc.id);
  if (!docCache) return;

  const docState = documentState.get(activeDoc.id);

  const containerRect = thumbnailsContainer.getBoundingClientRect();
  const thumbnails = thumbnailsContainer.querySelectorAll('.thumbnail-item');

  priorityPages.clear();

  let firstVisiblePage = null;

  thumbnails.forEach(thumb => {
    const thumbRect = thumb.getBoundingClientRect();

    const isVisible = (
      thumbRect.top < containerRect.bottom &&
      thumbRect.bottom > containerRect.top
    );

    if (isVisible) {
      const pageNum = parseInt(thumb.dataset.page);

      if (firstVisiblePage === null) {
        firstVisiblePage = pageNum;
      }

      if (!docCache.has(pageNum)) {
        priorityPages.add(pageNum);
      }
    }
  });

  if (firstVisiblePage !== null && docState) {
    lastVisiblePage = firstVisiblePage;
    docState.nextPage = firstVisiblePage;
    docState.startPage = firstVisiblePage;
    docState.wrapped = false;
  }

  if (priorityPages.size > 0) {
    startProcessor();
  }
}

// Switch between tabs
export function switchLeftPanelTab(panelId) {
  switchToLeftPanelTab(panelId);
  refreshTabContent(panelId);
}

// Refresh whichever tab is currently active (call after loading a new document)
export function refreshActiveTab() {
  const panelId = activeTab();
  if (panelId && panelId !== 'thumbnails') {
    refreshTabContent(panelId);
  }
}

function refreshTabContent(panelId) {
  if (panelId === 'annotations') {
    updateAnnotationsList();
  } else if (panelId === 'attachments') {
    updateAttachmentsList();
  } else if (panelId === 'signatures') {
    updateSignaturesList();
  } else if (panelId === 'layers') {
    updateLayersList();
  } else if (panelId === 'form-fields') {
    updateFormFieldsList();
  } else if (panelId === 'destinations') {
    updateDestinationsList();
  } else if (panelId === 'tags') {
    updateTagsList();
  } else if (panelId === 'links') {
    updateLinksList();
  } else if (panelId === 'bookmarks') {
    updateBookmarksList();
  }
}

// Toggle panel collapse/expand
export function toggleLeftPanel() {
  toggleLeftPanelCollapsed();
}

// Track if processor is running
let processorRunning = false;

// Generate thumbnails for all pages (sets store signals and starts generation)
export async function generateThumbnails() {
  const activeDoc = getActiveDocument();
  if (!activeDoc || !activeDoc.pdfDoc) {
    return;
  }

  const pdfDoc = activeDoc.pdfDoc;
  const docId = activeDoc.id;
  const numPages = pdfDoc.numPages;

  // Get first page dimensions for placeholder sizing
  let placeholderWidth = 150;
  let placeholderHeight = Math.round(150 * 1.414);
  try {
    const firstPage = await pdfDoc.getPage(1);
    const extraRot = getPageRotation(1);
    const thOpts = { scale: THUMBNAIL_SCALE };
    if (extraRot) thOpts.rotation = (firstPage.rotate + extraRot) % 360;
    const viewport = firstPage.getViewport(thOpts);
    placeholderWidth = Math.round(viewport.width);
    placeholderHeight = Math.round(viewport.height);
  } catch (err) {
    console.warn('[Thumbnails] Could not get first page dimensions:', err);
  }

  // Initialize or update document state
  if (!documentState.has(docId)) {
    documentState.set(docId, {
      pdfDoc,
      numPages,
      nextPage: 1,
      startPage: 1,
      wrapped: false
    });
  }

  // Initialize cache for this document if needed
  if (!thumbnailCache.has(docId)) {
    thumbnailCache.set(docId, new Map());
  }
  const docCache = thumbnailCache.get(docId);

  // Update Solid store signals - this triggers reactive rendering of ThumbnailItem components
  setPlaceholderSize({ width: placeholderWidth, height: placeholderHeight });
  setPageCount(numPages);

  // Populate store with any already-cached thumbnail data
  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    if (docCache.has(pageNum)) {
      setThumbnailImage(pageNum, docCache.get(pageNum));
    }
  }

  // Mark current page as active
  updateActiveThumbnail();

  // Ensure scroll listener is attached (Solid may have re-rendered the container)
  scrollListenerAttached = false;
  attachScrollListener();

  // Update priorities based on initially visible thumbnails
  setTimeout(updateVisiblePriorities, 50);

  // Start the processor if not running
  startProcessor();
}

// Start the thumbnail processor
function startProcessor() {
  if (processorRunning) return;
  processorRunning = true;
  processNextThumbnail();
}

// Process the next thumbnail (prioritizes visible pages, then active document)
async function processNextThumbnail() {
  try {
    const activeDoc = getActiveDocument();
    const activeDocId = activeDoc?.id;

    if (activeDocId && priorityPages.size > 0) {
      const processed = await processPriorityThumbnail(activeDocId);
      if (processed) {
        setTimeout(processNextThumbnail, 0);
        return;
      }
    }

    if (activeDocId && documentState.has(activeDocId)) {
      const processed = await processDocumentThumbnail(activeDocId);
      if (processed) {
        setTimeout(processNextThumbnail, 0);
        return;
      }
    }

    for (const [docId, docState] of documentState) {
      if (docId === activeDocId) continue;

      const processed = await processDocumentThumbnail(docId);
      if (processed) {
        setTimeout(processNextThumbnail, 0);
        return;
      }
    }

    processorRunning = false;
  } catch (err) {
    console.error('[Thumbnails] Processor error:', err);
    processorRunning = false;
    setTimeout(startProcessor, 100);
  }
}

// Process a priority (visible) thumbnail first
async function processPriorityThumbnail(docId) {
  const docState = documentState.get(docId);
  const docCache = thumbnailCache.get(docId);

  if (!docState || !docCache || priorityPages.size === 0) {
    return false;
  }

  const { pdfDoc } = docState;

  const pageNum = priorityPages.values().next().value;
  priorityPages.delete(pageNum);

  if (docCache.has(pageNum)) {
    return priorityPages.size > 0;
  }

  try {
    const imageData = await renderThumbnailToDataURL(pdfDoc, pageNum);
    if (imageData) {
      docCache.set(pageNum, imageData);

      // Update the Solid store so the ThumbnailItem component reacts
      const currentActiveDoc = getActiveDocument();
      if (currentActiveDoc && currentActiveDoc.id === docId) {
        setThumbnailImage(pageNum, imageData);
      }
    }
    return true;
  } catch (err) {
    console.warn(`[Thumbnails] Error rendering priority page ${pageNum}:`, err);
    return true;
  }
}

// Process one thumbnail for a specific document (sequential with wrap-around)
async function processDocumentThumbnail(docId) {
  const docState = documentState.get(docId);
  const docCache = thumbnailCache.get(docId);

  if (!docState || !docCache) {
    return false;
  }

  const { pdfDoc, numPages } = docState;
  const startPage = docState.startPage || 1;

  let attempts = 0;
  const maxAttempts = numPages;

  while (attempts < maxAttempts) {
    if (docState.wrapped && docState.nextPage === startPage) {
      return false;
    }

    const pageNum = docState.nextPage;
    attempts++;

    docState.nextPage++;
    if (docState.nextPage > numPages) {
      docState.nextPage = 1;
      docState.wrapped = true;
    }

    if (docCache.has(pageNum)) continue;

    try {
      const imageData = await renderThumbnailToDataURL(pdfDoc, pageNum);
      if (imageData) {
        docCache.set(pageNum, imageData);

        // Update the Solid store so the ThumbnailItem component reacts
        const currentActiveDoc = getActiveDocument();
        if (currentActiveDoc && currentActiveDoc.id === docId) {
          setThumbnailImage(pageNum, imageData);
        }
      }
      return true;
    } catch (err) {
      console.warn(`[Thumbnails] Error rendering page ${pageNum} of doc ${docId}:`, err);
      return true;
    }
  }

  return false;
}

// Render a single page thumbnail to a data URL with timeout
async function renderThumbnailToDataURL(pdfDoc, pageNum) {
  if (!pdfDoc || pageNum > pdfDoc.numPages) return null;

  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Render timeout')), 10000);
  });

  try {
    const renderPromise = (async () => {
      const page = await pdfDoc.getPage(pageNum);
      const extraRot = getPageRotation(pageNum);
      const trOpts = { scale: THUMBNAIL_SCALE };
      if (extraRot) trOpts.rotation = (page.rotate + extraRot) % 360;
      const viewport = page.getViewport(trOpts);

      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');

      await page.render({
        canvasContext: ctx,
        viewport: viewport
      }).promise;

      return {
        dataURL: canvas.toDataURL('image/jpeg', 0.7),
        width: viewport.width,
        height: viewport.height
      };
    })();

    return await Promise.race([renderPromise, timeoutPromise]);
  } catch (err) {
    console.warn(`[Thumbnails] Render failed for page ${pageNum}:`, err.message);
    return null;
  }
}

// Show page properties dialog
export async function showPageProperties(pageNum) {
  if (!state.pdfDoc) return;
  try {
    const page = await state.pdfDoc.getPage(pageNum);
    const rotation = getPageRotation(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    const widthPt = viewport.width;
    const heightPt = viewport.height;
    const widthMm = (widthPt / 72 * 25.4).toFixed(1);
    const heightMm = (heightPt / 72 * 25.4).toFixed(1);
    const widthIn = (widthPt / 72).toFixed(2);
    const heightIn = (heightPt / 72).toFixed(2);
    const totalRotation = (page.rotate + (rotation || 0)) % 360;

    const msg = `Page ${pageNum}\n\n` +
      `Size: ${widthPt.toFixed(0)} x ${heightPt.toFixed(0)} pt\n` +
      `Size: ${widthMm} x ${heightMm} mm\n` +
      `Size: ${widthIn} x ${heightIn} in\n` +
      `Rotation: ${totalRotation}\u00B0`;

    if (window.__TAURI__?.dialog?.message) {
      await window.__TAURI__.dialog.message(msg, { title: 'Page Properties', kind: 'info' });
    } else {
      alert(msg);
    }
  } catch (err) {
    console.error('Error showing page properties:', err);
  }
}

// Invalidate and re-render a single page's thumbnail (e.g. after rotation)
export function invalidateThumbnail(pageNum) {
  const activeDoc = getActiveDocument();
  if (!activeDoc) return;
  const docCache = thumbnailCache.get(activeDoc.id);
  if (docCache) {
    docCache.delete(pageNum);
  }
  // Remove from Solid store so component shows loading spinner
  removeThumbnailImage(pageNum);
  // Re-add to priority queue and restart processor
  priorityPages.add(pageNum);
  startProcessor();
}

// Clear thumbnail cache for a specific document
export function clearThumbnailCache(docId) {
  if (docId) {
    thumbnailCache.delete(docId);
    documentState.delete(docId);
  }
}

// Update which thumbnail is marked as active
export function updateActiveThumbnail() {
  setActivePage(state.currentPage);

  // Scroll active thumbnail into view
  setTimeout(() => {
    const activeThumbnail = document.querySelector('.thumbnail-item.active');
    if (activeThumbnail) {
      activeThumbnail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, 0);
}

// Clear thumbnails (when PDF is closed)
export function clearThumbnails() {
  clearAllThumbnails();
  priorityPages.clear();
}
