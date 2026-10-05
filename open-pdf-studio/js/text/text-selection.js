import { state, getActiveDocument } from '../core/state.js';
import { showTextSelectionContextMenu } from '../ui/chrome/context-menus.js';
import { applyBandRestriction, clearBandRestriction } from './selection-guard.js';
import { weergaveRectNaarPagina } from '../pdf/weergave-ruimte.js';
import { selectionTextDir } from './leesrichting.js';

/**
 * Text Selection Module
 * Handles text selection state and operations
 */

// Spans die tijdens een actieve sleep tijdelijk op user-select:none staan
// (kolom-begrenzing tegen spurious selecties bij tabellen/meerkoloms).
let _guardRestricted = [];
// De .endOfContent-div van de tekstlaag waarin de huidige sleep begon.
let _activeEndOfContent = null;

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

  // Einde van een sleep: hef de kolom-begrenzing en endOfContent weer op.
  // Document-breed zodat het ook vuurt als de muis buiten de tekstlaag loslaat.
  document.addEventListener('mouseup', handleMouseUp);
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
  state.textSelection.pageNum = parseInt(textLayer.dataset.page) || (getActiveDocument()?.currentPage || 1);
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
  if (textLayer) {
    // Alleen de linkermuisknop start een tekstselectie-sleep.
    if (e.button === 0) beginSelectionDrag(textLayer, e);
    return;
  }

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
 * Handles mouseup: end a selection drag and lift the temporary column guard.
 */
function handleMouseUp() {
  endSelectionDrag();
}

/**
 * Start van een tekstselectie-sleep binnen een tekstlaag.
 * 1) Begrenst — indien de startregel een tabelrij is — de selectie tot de
 *    kolom van het startpunt (voorkomt spurious selecties in andere kolommen).
 * 2) Activeert de endOfContent-div op de start-Y zodat een omgekeerde sleep
 *    (onder -> boven) de selectie niet naar verre tekst laat uitschieten.
 * @param {HTMLElement} textLayer
 * @param {MouseEvent} e
 */
function beginSelectionDrag(textLayer, e) {
  // Ruim een eventuele vorige (niet netjes afgesloten) sleep op.
  endSelectionDrag();

  try {
    _guardRestricted = applyBandRestriction(textLayer, e.clientX, e.clientY);
  } catch {
    _guardRestricted = [];
  }

  // endOfContent-truc (zoals PDF.js viewer): plaats het niet-selecteerbare
  // "einde" op de start-Y en activeer het, zodat de selectie-ankering bij een
  // omgekeerde sleep niet buiten de begonnen tekst springt.
  const end = textLayer.querySelector('.endOfContent');
  if (end) {
    const r = hoogteFractieInLaag(textLayer, e.clientX, e.clientY);
    end.style.top = `${(r * 100).toFixed(2)}%`;
    end.classList.add('active');
    _activeEndOfContent = end;
  }
}

/**
 * Hoe ver (0..1) ligt een schermpunt van de bovenkant van de tekstlaag, in de
 * EIGEN stand van de laag? De laag ligt in het ongedraaide paginakader en
 * wordt met een CSS-transform gedraaid en geschaald (paginarotatie en de
 * weergaverotatie, #200); op het scherm is "boven" dan niet altijd boven.
 * Terugrekenen via de inverse van die transform; zonder transform is dit
 * gewoon (clientY − top) / hoogte.
 */
function hoogteFractieInLaag(textLayer, clientX, clientY) {
  const klem = (v) => Math.max(0, Math.min(1, v));
  const hoogte = textLayer.offsetHeight;
  const ouder = textLayer.offsetParent || textLayer.parentElement;
  const transform = getComputedStyle(textLayer).transform;
  if (hoogte > 0 && ouder && transform && transform !== 'none' && typeof DOMMatrixReadOnly === 'function') {
    try {
      const pr = ouder.getBoundingClientRect();
      const lokaal = new DOMMatrixReadOnly(transform).inverse().transformPoint(
        new DOMPoint(clientX - pr.left - textLayer.offsetLeft, clientY - pr.top - textLayer.offsetTop));
      if (Number.isFinite(lokaal.y)) return klem(lokaal.y / hoogte);
    } catch { /* terugval hieronder */ }
  }
  const rect = textLayer.getBoundingClientRect();
  return rect.height > 0 ? klem((clientY - rect.top) / rect.height) : 0;
}

/**
 * Einde van een tekstselectie-sleep: herstel user-select en endOfContent.
 */
function endSelectionDrag() {
  if (_guardRestricted.length) {
    clearBandRestriction(_guardRestricted);
    _guardRestricted = [];
  }
  if (_activeEndOfContent) {
    _activeEndOfContent.classList.remove('active');
    _activeEndOfContent.style.top = '';
    _activeEndOfContent = null;
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

  const pageNum = parseInt(textLayer.dataset.page) || (getActiveDocument()?.currentPage || 1);
  const textLayerRect = textLayer.getBoundingClientRect();

  const doc = getActiveDocument();
  const scale = doc?.scale || 1.5;
  for (const rect of rects) {
    // Convert DOM coordinates to PDF coordinates (relative to text layer, unscaled).
    // De tekstlaag omsluit de pagina zoals hij op het scherm staat; is de
    // weergave gedraaid (#200), dan de rechthoek terugdraaien naar de pagina.
    const inWeergave = {
      x: (rect.left - textLayerRect.left) / scale,
      y: (rect.top - textLayerRect.top) / scale,
      width: rect.width / scale,
      height: rect.height / scale,
    };
    const { x, y, width, height } = weergaveRectNaarPagina(pageNum, inWeergave, doc);

    result.push({ x, y, width, height, page: pageNum });
  }

  return result;
}

/**
 * Leesrichting (0/90/180/270) van de geselecteerde tekst in de paginaruimte,
 * of null als die onbekend is (#527). De rotatie is de eigen /Rotate plus de
 * paginarotatie in de app, zoals paginaMaat (weergave-ruimte.js) die telt; de
 * weergaverotatie (#200) hoort er niet bij, want annotaties staan in de
 * paginaruimte.
 * @returns {number|null}
 */
export function getSelectionTextDir() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const textLayer = findParentTextLayer(selection.anchorNode);
  if (!textLayer) return null;
  const doc = getActiveDocument();
  const pageNum = parseInt(textLayer.dataset.page) || (doc?.currentPage || 1);
  const pageRot = (Number(doc?.pageDims?.[pageNum]?.rotation) || 0) + (Number(doc?.pageRotations?.[pageNum]) || 0);
  return selectionTextDir(selection, pageRot);
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
