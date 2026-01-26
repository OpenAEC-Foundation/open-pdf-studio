import { state } from '../core/state.js';
import { showTextSelectionContextMenu } from '../ui/context-menus.js';

/**
 * Text Selection Module
 * Handles text selection state and operations
 */

/**
 * Initializes text selection event listeners
 */
export function initTextSelection() {
  // Listen for selection changes
  document.addEventListener('selectionchange', handleSelectionChange);

  // Listen for right-click on text layers
  document.addEventListener('contextmenu', handleTextContextMenu);

  // Clear selection when clicking outside text layer
  document.addEventListener('mousedown', handleMouseDown);
}

/**
 * Handles selection change events
 */
function handleSelectionChange() {
  const selection = window.getSelection();

  if (!selection || selection.isCollapsed) {
    // No selection or selection collapsed
    state.textSelection.hasSelection = false;
    state.textSelection.selectedText = '';
    state.textSelection.pageNum = null;
    return;
  }

  // Check if selection is within a text layer
  const anchorNode = selection.anchorNode;
  const focusNode = selection.focusNode;

  if (!anchorNode || !focusNode) return;

  const textLayer = findParentTextLayer(anchorNode);
  if (!textLayer) {
    state.textSelection.hasSelection = false;
    state.textSelection.selectedText = '';
    state.textSelection.pageNum = null;
    return;
  }

  // Update selection state
  state.textSelection.hasSelection = true;
  state.textSelection.selectedText = selection.toString();
  state.textSelection.pageNum = parseInt(textLayer.dataset.page) || state.currentPage;
}

/**
 * Handles right-click context menu for text selection
 */
function handleTextContextMenu(e) {
  // Check if right-click is on a text layer with selection
  const textLayer = findParentTextLayer(e.target);
  if (!textLayer) return;

  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.toString().trim()) return;

  // Check if the click is within the selection
  if (isClickInSelection(e, selection)) {
    e.preventDefault();
    e.stopPropagation();
    showTextSelectionContextMenu(e);
  }
}

/**
 * Handles mousedown to track selection context
 */
function handleMouseDown(e) {
  // Don't clear selection if clicking on context menu
  if (e.target.closest('.context-menu')) return;

  // Don't clear selection if clicking within text layer
  const textLayer = findParentTextLayer(e.target);
  if (textLayer) return;

  // Check if we're clicking on an annotation canvas in select tool mode
  if (state.currentTool === 'select') {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      // Clear selection when clicking outside text layer
      selection.removeAllRanges();
    }
  }
}

/**
 * Finds the parent text layer element
 * @param {Node} node - DOM node to search from
 * @returns {HTMLElement|null} The text layer element or null
 */
function findParentTextLayer(node) {
  if (!node) return null;

  // Handle text nodes
  if (node.nodeType === Node.TEXT_NODE) {
    node = node.parentElement;
  }

  // Traverse up to find text layer
  while (node && node !== document.body) {
    if (node.classList && node.classList.contains('textLayer')) {
      return node;
    }
    node = node.parentElement;
  }

  return null;
}

/**
 * Checks if a click event is within the current selection
 * @param {MouseEvent} e - The mouse event
 * @param {Selection} selection - The current selection
 * @returns {boolean} True if click is in selection
 */
function isClickInSelection(e, selection) {
  if (!selection || selection.rangeCount === 0) return false;

  const range = selection.getRangeAt(0);
  const rects = range.getClientRects();

  for (const rect of rects) {
    if (
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Gets the currently selected text
 * @returns {string} The selected text
 */
export function getSelectedText() {
  return state.textSelection.selectedText || '';
}

/**
 * Gets the DOM rectangles for the current selection
 * @returns {DOMRect[]} Array of DOMRect objects
 */
export function getSelectionRects() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return [];

  const range = selection.getRangeAt(0);
  return Array.from(range.getClientRects());
}

/**
 * Gets selection rectangles converted to PDF coordinates
 * @returns {Array<{x: number, y: number, width: number, height: number, page: number}>}
 */
export function getSelectionRectsForAnnotation() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return [];

  const range = selection.getRangeAt(0);
  const rects = range.getClientRects();
  const result = [];

  // Find the text layer to get page info and coordinate conversion
  const textLayer = findParentTextLayer(selection.anchorNode);
  if (!textLayer) return [];

  const pageNum = parseInt(textLayer.dataset.page) || state.currentPage;
  const textLayerRect = textLayer.getBoundingClientRect();

  for (const rect of rects) {
    // Convert DOM coordinates to PDF coordinates (relative to text layer, unscaled)
    const x = (rect.left - textLayerRect.left) / state.scale;
    const y = (rect.top - textLayerRect.top) / state.scale;
    const width = rect.width / state.scale;
    const height = rect.height / state.scale;

    result.push({ x, y, width, height, page: pageNum });
  }

  return result;
}

/**
 * Clears the current text selection
 */
export function clearTextSelection() {
  const selection = window.getSelection();
  if (selection) {
    selection.removeAllRanges();
  }

  state.textSelection.hasSelection = false;
  state.textSelection.selectedText = '';
  state.textSelection.pageNum = null;
}

/**
 * Converts selection rects to quadPoints format for text markup annotations
 * quadPoints is an array of [x1,y1,x2,y2,x3,y3,x4,y4] representing quad corners
 * @returns {Array<number[]>} Array of quad point arrays
 */
export function getSelectionQuadPoints() {
  const rects = getSelectionRectsForAnnotation();
  return rects.map(rect => {
    // QuadPoints: top-left, top-right, bottom-left, bottom-right
    return [
      rect.x, rect.y,                           // top-left
      rect.x + rect.width, rect.y,              // top-right
      rect.x, rect.y + rect.height,             // bottom-left
      rect.x + rect.width, rect.y + rect.height // bottom-right
    ];
  });
}
