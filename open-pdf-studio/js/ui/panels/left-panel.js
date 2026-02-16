import { state, getActiveDocument, getPageRotation } from '../../core/state.js';
import { goToPage } from '../../pdf/renderer.js';
import { reorderPages, deletePages, replacePages, copyPage, cutPage, pastePage, getPageClipboard } from '../../pdf/page-manager.js';
import { showInsertPageDialog, showExtractPagesDialog } from '../chrome/dialogs.js';
import { updateAnnotationsList } from './annotations-list.js';
import { updateAttachmentsList } from './attachments.js';
import { updateSignaturesList } from './signatures.js';
import { updateLayersList } from './layers.js';
import { updateFormFieldsList } from './form-fields.js';
import { updateDestinationsList } from './destinations.js';
import { updateTagsList } from './tags.js';
import { updateLinksList } from './links.js';

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
export function switchLeftPanelTab(panelId) {
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

  // Refresh content when switching to data tabs
  refreshTabContent(panelId);
}

// Refresh whichever tab is currently active (call after loading a new document)
export function refreshActiveTab() {
  const activeTab = document.querySelector('.left-panel-tab.active');
  if (!activeTab) return;
  const panelId = activeTab.dataset.panel;
  // Thumbnails are refreshed separately via generateThumbnails()
  if (panelId && panelId !== 'thumbnails' && panelId !== 'bookmarks') {
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
  canvas.replaceWith(img);
}

// Drag-and-drop state for thumbnail reordering
let draggedPageNum = null;

function handleThumbnailDragStart(e) {
  const item = e.target.closest('.thumbnail-item');
  if (!item) return;
  draggedPageNum = parseInt(item.dataset.page);
  item.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(draggedPageNum));
}

function handleThumbnailDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  const item = e.target.closest('.thumbnail-item');
  if (!item || !thumbnailsContainer) return;

  // Clear existing indicators
  thumbnailsContainer.querySelectorAll('.drop-before, .drop-after').forEach(el => {
    el.classList.remove('drop-before', 'drop-after');
  });

  const targetPage = parseInt(item.dataset.page);
  if (targetPage === draggedPageNum) return;

  // Determine drop position (before or after) based on mouse Y position
  const rect = item.getBoundingClientRect();
  const midY = rect.top + rect.height / 2;
  if (e.clientY < midY) {
    item.classList.add('drop-before');
  } else {
    item.classList.add('drop-after');
  }
}

function handleThumbnailDragLeave(e) {
  const item = e.target.closest('.thumbnail-item');
  if (item) {
    item.classList.remove('drop-before', 'drop-after');
  }
}

async function handleThumbnailDrop(e) {
  e.preventDefault();
  if (!thumbnailsContainer) return;

  // Clear all indicators
  thumbnailsContainer.querySelectorAll('.dragging, .drop-before, .drop-after').forEach(el => {
    el.classList.remove('dragging', 'drop-before', 'drop-after');
  });

  const item = e.target.closest('.thumbnail-item');
  if (!item || draggedPageNum === null) return;

  const targetPage = parseInt(item.dataset.page);
  if (targetPage === draggedPageNum) return;

  const numPages = state.pdfDoc?.numPages;
  if (!numPages) return;

  // Determine drop position
  const rect = item.getBoundingClientRect();
  const midY = rect.top + rect.height / 2;
  const dropBefore = e.clientY < midY;

  // Build new page order
  const currentOrder = [];
  for (let i = 1; i <= numPages; i++) currentOrder.push(i);

  // Remove dragged page from its position
  const fromIdx = currentOrder.indexOf(draggedPageNum);
  currentOrder.splice(fromIdx, 1);

  // Find where target page is now (after removal)
  let toIdx = currentOrder.indexOf(targetPage);
  if (!dropBefore) toIdx++;

  // Insert dragged page at new position
  currentOrder.splice(toIdx, 0, draggedPageNum);

  draggedPageNum = null;

  await reorderPages(currentOrder);
}

function handleThumbnailDragEnd() {
  draggedPageNum = null;
  if (thumbnailsContainer) {
    thumbnailsContainer.querySelectorAll('.dragging, .drop-before, .drop-after').forEach(el => {
      el.classList.remove('dragging', 'drop-before', 'drop-after');
    });
  }
}

// Thumbnail context menu
let thumbnailContextMenu = null;
let contextMenuTargetPage = null;

function getThumbnailContextMenu() {
  if (!thumbnailContextMenu) {
    thumbnailContextMenu = document.createElement('div');
    thumbnailContextMenu.className = 'context-menu';
    document.body.appendChild(thumbnailContextMenu);

    document.addEventListener('click', (e) => {
      if (thumbnailContextMenu && !thumbnailContextMenu.contains(e.target)) {
        hideThumbnailContextMenu();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        hideThumbnailContextMenu();
      }
    });
  }
  return thumbnailContextMenu;
}

function hideThumbnailContextMenu() {
  if (thumbnailContextMenu) {
    thumbnailContextMenu.style.display = 'none';
  }
}

// SVG icons for thumbnail context menu (16x16 viewBox, fill="currentColor")
const PAGE_MENU_ICONS = {
  cut: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5a2.5 2.5 0 1 1 3.164 2.414L8.5 7.25l1.336-2.336a2.5 2.5 0 1 1 1.414 0L9.914 7.25 13 12.5V14H3v-1.5L6.086 7.25 4.75 4.914A2.5 2.5 0 0 1 4 2.5zm2.5 1a1 1 0 1 0-2 0 1 1 0 0 0 2 0zm5 0a1 1 0 1 0-2 0 1 1 0 0 0 2 0z"/></svg>',
  copy: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V2zm2-1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H6z"/><path d="M2 5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1h1v1a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1v1H2z"/></svg>',
  paste: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M10 1.5a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-1zm-5 0A1.5 1.5 0 0 1 6.5 0h3A1.5 1.5 0 0 1 11 1.5v1A1.5 1.5 0 0 1 9.5 4h-3A1.5 1.5 0 0 1 5 2.5v-1zm-2 0h1v1A2.5 2.5 0 0 0 6.5 5h3A2.5 2.5 0 0 0 12 2.5v-1h1a2 2 0 0 1 2 2V14a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V3.5a2 2 0 0 1 2-2z"/></svg>',
  insert: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 0h5.5L14 4.5V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2zm5.5 1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5H9.5V1z"/><path d="M8 6.5a.5.5 0 0 1 .5.5v1.5H10a.5.5 0 0 1 0 1H8.5V11a.5.5 0 0 1-1 0V9.5H6a.5.5 0 0 1 0-1h1.5V7a.5.5 0 0 1 .5-.5z"/></svg>',
  extract: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 0h5.5L14 4.5V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2zm5.5 1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5H9.5V1z"/><path d="M8 12a.5.5 0 0 0 .5-.5V8.207l1.146 1.147a.5.5 0 0 0 .708-.708l-2-2a.5.5 0 0 0-.708 0l-2 2a.5.5 0 1 0 .708.708L7.5 8.207V11.5a.5.5 0 0 0 .5.5z"/></svg>',
  replace: '<svg viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M1 11.5a.5.5 0 0 0 .5.5h11.793l-3.147 3.146a.5.5 0 0 0 .708.708l4-4a.5.5 0 0 0 0-.708l-4-4a.5.5 0 0 0-.708.708L13.293 11H1.5a.5.5 0 0 0-.5.5zm14-7a.5.5 0 0 1-.5.5H2.707l3.147 3.146a.5.5 0 1 1-.708.708l-4-4a.5.5 0 0 1 0-.708l4-4a.5.5 0 1 1 .708.708L2.707 4H14.5a.5.5 0 0 1 .5.5z"/></svg>',
  delete: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1z"/></svg>',
  properties: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/><path d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533L8.93 6.588zM9 4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/></svg>',
};

function createContextMenuItem(label, icon, action, disabled = false) {
  const item = document.createElement('div');
  item.className = 'context-menu-item' + (disabled ? ' disabled' : '');

  const iconEl = document.createElement('span');
  iconEl.className = 'context-menu-icon';
  iconEl.innerHTML = icon;
  item.appendChild(iconEl);

  const labelEl = document.createElement('span');
  labelEl.className = 'context-menu-label';
  labelEl.textContent = label;
  item.appendChild(labelEl);

  if (!disabled) {
    item.addEventListener('click', async () => {
      hideThumbnailContextMenu();
      await action();
    });
  }

  return item;
}

function addSeparator(menu) {
  const sep = document.createElement('div');
  sep.className = 'context-menu-separator';
  menu.appendChild(sep);
}

function showThumbnailContextMenu(e, pageNum) {
  e.preventDefault();
  e.stopPropagation();

  if (!state.pdfDoc) return;

  contextMenuTargetPage = pageNum;
  const menu = getThumbnailContextMenu();
  menu.innerHTML = '';
  const isLastPage = state.pdfDoc.numPages <= 1;
  const clipboard = getPageClipboard();

  // Cut / Copy / Paste
  menu.appendChild(createContextMenuItem('Cut', PAGE_MENU_ICONS.cut, async () => {
    await cutPage(pageNum);
  }, isLastPage));

  menu.appendChild(createContextMenuItem('Copy', PAGE_MENU_ICONS.copy, async () => {
    await copyPage(pageNum);
  }));

  menu.appendChild(createContextMenuItem('Paste', PAGE_MENU_ICONS.paste, async () => {
    await pastePage(pageNum);
  }, !clipboard));

  addSeparator(menu);

  // Page operations
  menu.appendChild(createContextMenuItem('Insert Pages...', PAGE_MENU_ICONS.insert, () => {
    showInsertPageDialog();
  }));

  menu.appendChild(createContextMenuItem('Extract Pages...', PAGE_MENU_ICONS.extract, () => {
    showExtractPagesDialog();
  }));

  menu.appendChild(createContextMenuItem('Replace Pages...', PAGE_MENU_ICONS.replace, () => {
    replacePages(contextMenuTargetPage);
  }));

  menu.appendChild(createContextMenuItem('Delete Pages', PAGE_MENU_ICONS.delete, async () => {
    if (isLastPage) return;
    const confirmed = await window.__TAURI__?.dialog?.ask(`Delete page ${pageNum}?`, { title: 'Delete Page', kind: 'warning' });
    if (confirmed) {
      await deletePages([pageNum]);
    }
  }, isLastPage));

  addSeparator(menu);

  // Properties
  menu.appendChild(createContextMenuItem('Properties', PAGE_MENU_ICONS.properties, async () => {
    await showPageProperties(pageNum);
  }));

  // Position menu at cursor
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;
  menu.style.display = 'block';

  // Ensure menu stays within viewport
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    menu.style.left = `${window.innerWidth - rect.width - 10}px`;
  }
  if (rect.bottom > window.innerHeight) {
    menu.style.top = `${window.innerHeight - rect.height - 10}px`;
  }
}

// Show page properties dialog
async function showPageProperties(pageNum) {
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

// Create a thumbnail placeholder with estimated size
function createThumbnailPlaceholder(pageNum, width = 150, height = null) {
  const thumbnailItem = document.createElement('div');
  thumbnailItem.className = 'thumbnail-item';
  thumbnailItem.dataset.page = pageNum;
  thumbnailItem.draggable = true;

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

  // Right-click context menu
  thumbnailItem.addEventListener('contextmenu', (e) => {
    showThumbnailContextMenu(e, pageNum);
  });

  // Drag-and-drop event handlers
  thumbnailItem.addEventListener('dragstart', handleThumbnailDragStart);
  thumbnailItem.addEventListener('dragover', handleThumbnailDragOver);
  thumbnailItem.addEventListener('dragleave', handleThumbnailDragLeave);
  thumbnailItem.addEventListener('drop', handleThumbnailDrop);
  thumbnailItem.addEventListener('dragend', handleThumbnailDragEnd);

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
