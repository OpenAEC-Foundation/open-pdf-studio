import { state, getActiveDocument, getPageRotation } from '../core/state.js';
import { goToPage } from '../pdf/renderer.js';

// DOM elements
const leftPanel = document.getElementById('left-panel');
const leftPanelToggle = document.getElementById('left-panel-toggle');
const leftPanelTabs = document.querySelectorAll('.left-panel-tab');
const thumbnailsContainer = document.getElementById('thumbnails-container');

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

// Initialize left panel
export function initLeftPanel() {
  // Tab switching
  leftPanelTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const panelId = tab.dataset.panel;
      switchLeftPanelTab(panelId);
    });
  });

  // Panel collapse/expand toggle
  if (leftPanelToggle) {
    leftPanelToggle.addEventListener('click', toggleLeftPanel);
  }

  // Listen for scroll to prioritize visible thumbnails
  if (thumbnailsContainer) {
    thumbnailsContainer.addEventListener('scroll', handleThumbnailScroll);
  }
}

// Handle scroll in thumbnails container - debounced
function handleThumbnailScroll() {
  // Clear existing timer
  if (scrollDebounceTimer) {
    clearTimeout(scrollDebounceTimer);
  }

  // Set new timer - update priorities after scroll stops
  scrollDebounceTimer = setTimeout(() => {
    updateVisiblePriorities();
  }, 100);
}

// Find visible thumbnails and add them to priority queue
function updateVisiblePriorities() {
  if (!thumbnailsContainer) return;

  const activeDoc = getActiveDocument();
  if (!activeDoc) return;

  const docCache = thumbnailCache.get(activeDoc.id);
  if (!docCache) return;

  const docState = documentState.get(activeDoc.id);

  const containerRect = thumbnailsContainer.getBoundingClientRect();
  const thumbnails = thumbnailsContainer.querySelectorAll('.thumbnail-item');

  // Clear old priorities
  priorityPages.clear();

  let firstVisiblePage = null;

  // Find visible thumbnails that aren't loaded yet
  thumbnails.forEach(thumb => {
    const thumbRect = thumb.getBoundingClientRect();

    // Check if thumbnail is visible in container
    const isVisible = (
      thumbRect.top < containerRect.bottom &&
      thumbRect.bottom > containerRect.top
    );

    if (isVisible) {
      const pageNum = parseInt(thumb.dataset.page);

      // Track first visible page
      if (firstVisiblePage === null) {
        firstVisiblePage = pageNum;
      }

      // Only add to priority if not already cached
      if (!docCache.has(pageNum)) {
        priorityPages.add(pageNum);
      }
    }
  });

  // Update the sequential loading start point to continue from visible area
  if (firstVisiblePage !== null && docState) {
    lastVisiblePage = firstVisiblePage;
    // Reset nextPage to start from visible area
    docState.nextPage = firstVisiblePage;
    docState.startPage = firstVisiblePage;
    docState.wrapped = false;
  }

  // If we found priority pages, restart processor to handle them
  if (priorityPages.size > 0) {
    startProcessor();
  }
}

// Switch between tabs
function switchLeftPanelTab(panelId) {
  // Update tab active state
  leftPanelTabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.panel === panelId);
  });

  // Update panel content visibility
  document.querySelectorAll('.left-panel-content').forEach(content => {
    content.classList.remove('active');
  });

  const targetPanel = document.getElementById(`${panelId}-panel`);
  if (targetPanel) {
    targetPanel.classList.add('active');
  }

  // If collapsed, expand when clicking a tab
  if (leftPanel && leftPanel.classList.contains('collapsed')) {
    leftPanel.classList.remove('collapsed');
  }
}

// Toggle panel collapse/expand
export function toggleLeftPanel() {
  if (leftPanel) {
    leftPanel.classList.toggle('collapsed');
  }
}

// Track if processor is running
let processorRunning = false;

// Generate thumbnails for all pages (displays cached ones and starts generation)
export async function generateThumbnails() {
  const activeDoc = getActiveDocument();
  if (!activeDoc || !activeDoc.pdfDoc || !thumbnailsContainer) {
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

  // Clear existing thumbnail elements
  thumbnailsContainer.innerHTML = '';

  // Create all placeholder containers immediately (fixes scroll size)
  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const placeholder = createThumbnailPlaceholder(pageNum, placeholderWidth, placeholderHeight);
    thumbnailsContainer.appendChild(placeholder);

    // If we have cached thumbnail, display it immediately
    if (docCache.has(pageNum)) {
      displayCachedThumbnail(placeholder, docCache.get(pageNum));
    }
  }

  // Mark current page as active
  updateActiveThumbnail();

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
    // Get active document
    const activeDoc = getActiveDocument();
    const activeDocId = activeDoc?.id;

    // First, try to process priority (visible) pages for active document
    if (activeDocId && priorityPages.size > 0) {
      const processed = await processPriorityThumbnail(activeDocId);
      if (processed) {
        setTimeout(processNextThumbnail, 0);
        return;
      }
    }

    // Then, process remaining pages for active document
    if (activeDocId && documentState.has(activeDocId)) {
      const processed = await processDocumentThumbnail(activeDocId);
      if (processed) {
        setTimeout(processNextThumbnail, 0);
        return;
      }
    }

    // Active document is done, process other documents
    for (const [docId, docState] of documentState) {
      if (docId === activeDocId) continue;

      const processed = await processDocumentThumbnail(docId);
      if (processed) {
        setTimeout(processNextThumbnail, 0);
        return;
      }
    }

    // All documents processed
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

  // Get first priority page
  const pageNum = priorityPages.values().next().value;
  priorityPages.delete(pageNum);

  // Skip if already cached
  if (docCache.has(pageNum)) {
    return priorityPages.size > 0; // Continue if more priority pages
  }

  // Render this page
  try {
    const imageData = await renderThumbnailToDataURL(pdfDoc, pageNum);
    if (imageData) {
      docCache.set(pageNum, imageData);

      // Update the display
      const currentActiveDoc = getActiveDocument();
      if (currentActiveDoc && currentActiveDoc.id === docId) {
        const placeholder = thumbnailsContainer.querySelector(`[data-page="${pageNum}"]`);
        if (placeholder) {
          displayCachedThumbnail(placeholder, imageData);
        }
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

  // Try to find next unrendered page, starting from current position
  // and wrapping around to beginning if needed
  let attempts = 0;
  const maxAttempts = numPages;

  while (attempts < maxAttempts) {
    // Check if we've completed a full cycle BEFORE processing
    if (docState.wrapped && docState.nextPage === startPage) {
      // All pages processed
      return false;
    }

    const pageNum = docState.nextPage;
    attempts++;

    // Move to next page (with wrap-around)
    docState.nextPage++;
    if (docState.nextPage > numPages) {
      docState.nextPage = 1;
      docState.wrapped = true;
    }

    // Skip if already cached
    if (docCache.has(pageNum)) continue;

    // Render this page
    try {
      const imageData = await renderThumbnailToDataURL(pdfDoc, pageNum);
      if (imageData) {
        docCache.set(pageNum, imageData);

        // If this document is currently active, update the display
        const currentActiveDoc = getActiveDocument();
        if (currentActiveDoc && currentActiveDoc.id === docId) {
          const placeholder = thumbnailsContainer.querySelector(`[data-page="${pageNum}"]`);
          if (placeholder) {
            displayCachedThumbnail(placeholder, imageData);
          }
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

// Display a cached thumbnail in a placeholder element
function displayCachedThumbnail(placeholder, imageData) {
  let canvas = placeholder.querySelector('.thumbnail-canvas');
  if (!canvas) return;

  const img = document.createElement('img');
  img.className = 'thumbnail-canvas';
  img.src = imageData.dataURL;
  img.style.width = `${imageData.width}px`;
  img.style.height = `${imageData.height}px`;
  canvas.replaceWith(img);
}

// Create a thumbnail placeholder with estimated size
function createThumbnailPlaceholder(pageNum, width = 150, height = null) {
  const thumbnailItem = document.createElement('div');
  thumbnailItem.className = 'thumbnail-item';
  thumbnailItem.dataset.page = pageNum;

  const estimatedWidth = width;
  const estimatedHeight = height || Math.round(width * 1.414);

  const placeholder = document.createElement('div');
  placeholder.className = 'thumbnail-canvas thumbnail-loading';
  placeholder.style.width = `${estimatedWidth}px`;
  placeholder.style.height = `${estimatedHeight}px`;

  const spinner = document.createElement('div');
  spinner.className = 'thumbnail-spinner';
  placeholder.appendChild(spinner);

  const label = document.createElement('div');
  label.className = 'thumbnail-label';
  label.textContent = pageNum;

  thumbnailItem.appendChild(placeholder);
  thumbnailItem.appendChild(label);

  thumbnailItem.addEventListener('click', () => {
    goToPageFromThumbnail(pageNum);
  });

  return thumbnailItem;
}

// Invalidate and re-render a single page's thumbnail (e.g. after rotation)
export function invalidateThumbnail(pageNum) {
  const activeDoc = getActiveDocument();
  if (!activeDoc) return;
  const docCache = thumbnailCache.get(activeDoc.id);
  if (docCache) {
    docCache.delete(pageNum);
  }
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

// Navigate to a page when thumbnail is clicked
function goToPageFromThumbnail(pageNum) {
  goToPage(pageNum);
}

// Update which thumbnail is marked as active
export function updateActiveThumbnail() {
  if (!thumbnailsContainer) return;

  const thumbnails = thumbnailsContainer.querySelectorAll('.thumbnail-item');
  thumbnails.forEach(thumb => {
    const pageNum = parseInt(thumb.dataset.page);
    thumb.classList.toggle('active', pageNum === state.currentPage);
  });

  const activeThumbnail = thumbnailsContainer.querySelector('.thumbnail-item.active');
  if (activeThumbnail) {
    activeThumbnail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// Clear thumbnails (when PDF is closed)
export function clearThumbnails() {
  if (thumbnailsContainer) {
    thumbnailsContainer.innerHTML = '';
  }
  priorityPages.clear();
}
