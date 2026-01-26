import { state, getActiveDocument } from '../core/state.js';
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
const documentState = new Map(); // { pdfDoc, numPages, nextPage, isPaused }

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

  console.log(`[Thumbnails] generateThumbnails for doc ${docId}, ${numPages} pages`);

  // Initialize or update document state
  if (!documentState.has(docId)) {
    documentState.set(docId, {
      pdfDoc,
      numPages,
      nextPage: 1
    });
    console.log(`[Thumbnails] Created new state for doc ${docId}`);
  } else {
    console.log(`[Thumbnails] Doc ${docId} already has state, nextPage: ${documentState.get(docId).nextPage}`);
  }

  // Initialize cache for this document if needed
  if (!thumbnailCache.has(docId)) {
    thumbnailCache.set(docId, new Map());
  }
  const docCache = thumbnailCache.get(docId);
  console.log(`[Thumbnails] Doc ${docId} has ${docCache.size} cached thumbnails`);

  // Clear existing thumbnail elements
  thumbnailsContainer.innerHTML = '';

  // Create all placeholder containers
  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const placeholder = createThumbnailPlaceholder(pageNum);
    thumbnailsContainer.appendChild(placeholder);

    // If we have cached thumbnail, display it immediately
    if (docCache.has(pageNum)) {
      displayCachedThumbnail(placeholder, docCache.get(pageNum));
    }
  }

  // Mark current page as active
  updateActiveThumbnail();

  // Start the processor if not running
  startProcessor();
}

// Start the thumbnail processor
function startProcessor() {
  if (processorRunning) {
    console.log('[Thumbnails] Processor already running');
    return;
  }
  processorRunning = true;
  console.log('[Thumbnails] Starting processor');
  processNextThumbnail();
}

// Process the next thumbnail (prioritizes active document)
async function processNextThumbnail() {
  try {
    // Get active document
    const activeDoc = getActiveDocument();
    const activeDocId = activeDoc?.id;

    // First, try to process active document
    if (activeDocId && documentState.has(activeDocId)) {
      const processed = await processDocumentThumbnail(activeDocId);
      if (processed) {
        // Continue processing - use setTimeout to yield
        setTimeout(processNextThumbnail, 0);
        return;
      }
    }

    // Active document is done, process other documents
    for (const [docId, docState] of documentState) {
      if (docId === activeDocId) continue; // Skip active (already done)

      const processed = await processDocumentThumbnail(docId);
      if (processed) {
        // Continue processing - use setTimeout to yield
        setTimeout(processNextThumbnail, 0);
        return;
      }
    }

    // All documents processed
    console.log('[Thumbnails] All documents processed, stopping processor');
    processorRunning = false;
  } catch (err) {
    console.error('[Thumbnails] Processor error:', err);
    processorRunning = false;
    // Try to restart after error
    setTimeout(startProcessor, 100);
  }
}

// Process one thumbnail for a specific document
async function processDocumentThumbnail(docId) {
  const state = documentState.get(docId);
  const docCache = thumbnailCache.get(docId);

  if (!state || !docCache) {
    console.log(`[Thumbnails] No state or cache for doc ${docId}`);
    return false;
  }

  const { pdfDoc, numPages } = state;

  // Find next page that needs rendering
  while (state.nextPage <= numPages) {
    const pageNum = state.nextPage;
    state.nextPage++;

    // Skip if already cached
    if (docCache.has(pageNum)) continue;

    // Render this page
    console.log(`[Thumbnails] Rendering page ${pageNum} of doc ${docId.slice(-6)}`);
    try {
      const imageData = await renderThumbnailToDataURL(pdfDoc, pageNum);
      console.log(`[Thumbnails] Rendered page ${pageNum} of doc ${docId.slice(-6)}: ${imageData ? 'success' : 'null'}`);
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
      return true; // Processed one thumbnail
    } catch (err) {
      console.warn(`[Thumbnails] Error rendering page ${pageNum} of doc ${docId}:`, err);
      return true; // Still counts as processed (attempted)
    }
  }

  console.log(`[Thumbnails] Doc ${docId} complete (${numPages} pages)`);
  return false; // No more pages to process for this document
}

// Render a single page thumbnail to a data URL with timeout
async function renderThumbnailToDataURL(pdfDoc, pageNum) {
  if (!pdfDoc || pageNum > pdfDoc.numPages) return null;

  // Timeout promise
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Render timeout')), 10000);
  });

  try {
    const renderPromise = (async () => {
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: THUMBNAIL_SCALE });

      // Create offscreen canvas
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');

      // Render page
      await page.render({
        canvasContext: ctx,
        viewport: viewport
      }).promise;

      // Return as data URL for caching
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

  // Replace canvas with image for cached thumbnails (more memory efficient)
  const img = document.createElement('img');
  img.className = 'thumbnail-canvas';
  img.src = imageData.dataURL;
  img.style.width = '';
  img.style.height = '';
  canvas.replaceWith(img);
}

// Create a thumbnail placeholder with estimated size
function createThumbnailPlaceholder(pageNum) {
  const thumbnailItem = document.createElement('div');
  thumbnailItem.className = 'thumbnail-item';
  thumbnailItem.dataset.page = pageNum;

  // Create placeholder canvas with estimated size (will be replaced when rendered)
  const canvas = document.createElement('canvas');
  canvas.className = 'thumbnail-canvas';
  // Estimate dimensions based on typical A4 ratio (1:1.414)
  const estimatedWidth = 150;
  const estimatedHeight = Math.round(estimatedWidth * 1.414);
  canvas.width = estimatedWidth;
  canvas.height = estimatedHeight;
  canvas.style.width = `${estimatedWidth}px`;
  canvas.style.height = `${estimatedHeight}px`;
  canvas.style.background = '#f0f0f0';

  // Create label
  const label = document.createElement('div');
  label.className = 'thumbnail-label';
  label.textContent = pageNum;

  thumbnailItem.appendChild(canvas);
  thumbnailItem.appendChild(label);

  // Click handler to navigate to page
  thumbnailItem.addEventListener('click', () => {
    goToPageFromThumbnail(pageNum);
  });

  return thumbnailItem;
}

// Clear thumbnail cache for a specific document (call when document is closed)
export function clearThumbnailCache(docId) {
  if (docId) {
    thumbnailCache.delete(docId);
    documentState.delete(docId);
  }
}

// Navigate to a page when thumbnail is clicked
function goToPageFromThumbnail(pageNum) {
  goToPage(pageNum);
  // Note: goToPage already calls updateActiveThumbnail
}

// Update which thumbnail is marked as active
export function updateActiveThumbnail() {
  if (!thumbnailsContainer) return;

  const thumbnails = thumbnailsContainer.querySelectorAll('.thumbnail-item');
  thumbnails.forEach(thumb => {
    const pageNum = parseInt(thumb.dataset.page);
    thumb.classList.toggle('active', pageNum === state.currentPage);
  });

  // Scroll active thumbnail into view
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
}
