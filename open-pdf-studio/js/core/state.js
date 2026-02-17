import { DEFAULT_PREFERENCES } from './constants.js';
import { isTauri, getUsername } from './platform.js';

// Get system username for default author
async function getSystemUsername() {
  if (isTauri()) {
    try {
      return await getUsername();
    } catch (e) {
      return 'User';
    }
  }
  return 'User';
}

// Initialize default author asynchronously
let defaultAuthorValue = 'User';
getSystemUsername().then(username => {
  defaultAuthorValue = username;
  state.defaultAuthor = username;
});

/**
 * Creates a new document state object
 * @param {string} filePath - Path to the PDF file
 * @returns {Object} Document state object
 */
export function createDocument(filePath = null) {
  return {
    id: Date.now() + Math.random().toString(36).substr(2, 9),
    filePath: filePath,
    fileName: filePath ? filePath.split(/[\\/]/).pop() : 'Untitled',
    pdfDoc: null,
    currentPage: 1,
    scale: 1.5,
    viewMode: 'single',
    annotations: [],
    textEdits: [],
    watermarks: [],
    bookmarks: [],
    undoStack: [],
    redoStack: [],
    selectedAnnotation: null,
    selectedAnnotations: [],
    modified: false,
    scrollPosition: { x: 0, y: 0 },
    pageRotations: {},
    pdfaCompliance: null,
  };
}

// Untitled document counter for generating unique names
let untitledCounter = 0;

/**
 * Get the next untitled document name
 * @returns {string} Name like "Untitled.pdf", "Untitled 2.pdf", etc.
 */
export function getNextUntitledName() {
  untitledCounter++;
  if (untitledCounter === 1) return 'Untitled.pdf';
  return `Untitled ${untitledCounter}.pdf`;
}

// Central mutable state object
// All modules import this and can read/modify state directly
export const state = {
  // Multi-document state
  documents: [],
  activeDocumentIndex: -1,

  // Current tool (global across all documents)
  currentTool: 'hand',

  // Drawing/interaction state (temporary, not per-document)
  isDrawing: false,
  startX: 0,
  startY: 0,
  currentPath: [],
  polylinePoints: [],
  isDrawingPolyline: false,

  // Dragging/Resizing state
  isDragging: false,
  isResizing: false,
  activeHandle: null,
  dragStartX: 0,
  dragStartY: 0,
  originalAnnotation: null,

  // Hand tool panning state
  isPanning: false,
  isMiddleButtonPanning: false,
  panStartX: 0,
  panStartY: 0,
  panScrollStartX: 0,
  panScrollStartY: 0,

  // Image cache (global, shared across documents)
  imageCache: new Map(),

  // Clipboard for copy/paste operations
  clipboardAnnotation: null,
  clipboardAnnotations: [],

  // Rubber band selection state
  isRubberBanding: false,
  rubberBandStartX: 0,
  rubberBandStartY: 0,

  // Multi-selection drag state
  originalAnnotations: [],

  // Continuous mode state
  activeContinuousCanvas: null,
  activeContinuousPage: null,

  // Modal dialog state (blocks all tool interaction)
  modalDialogOpen: false,

  // Backstage state
  backstageOpen: false,

  // Text editing state (annotation inline editing)
  isEditingText: false,
  editingAnnotation: null,
  textEditElement: null,

  // PDF text editing state (edit existing PDF text)
  isEditingPdfText: false,
  pdfTextEditState: null,

  // Preferences
  preferences: { ...DEFAULT_PREFERENCES },

  // Default author - uses system username
  defaultAuthor: defaultAuthorValue,

  // Shift key state (for angle snapping during rotation)
  shiftKeyPressed: false,

  // Text selection state
  textSelection: {
    hasSelection: false,
    selectedText: '',
    pageNum: null
  },

  // Search/Find state
  search: {
    isOpen: false,
    query: '',
    results: [],          // All matches: { pageNum, items, rects }
    currentIndex: -1,     // Current match index (-1 = none)
    totalMatches: 0,
    matchCase: false,
    wholeWord: false,
    highlightAll: true,
    isSearching: false
  },

  // ============================================
  // BACKWARD COMPATIBILITY GETTERS/SETTERS
  // These provide access to active document properties
  // ============================================

  get pdfDoc() {
    const doc = this.documents[this.activeDocumentIndex];
    return doc ? doc.pdfDoc : null;
  },
  set pdfDoc(value) {
    const doc = this.documents[this.activeDocumentIndex];
    if (doc) doc.pdfDoc = value;
  },

  get currentPage() {
    const doc = this.documents[this.activeDocumentIndex];
    return doc ? doc.currentPage : 1;
  },
  set currentPage(value) {
    const doc = this.documents[this.activeDocumentIndex];
    if (doc) doc.currentPage = value;
  },

  get scale() {
    const doc = this.documents[this.activeDocumentIndex];
    return doc ? doc.scale : 1.5;
  },
  set scale(value) {
    const doc = this.documents[this.activeDocumentIndex];
    if (doc) doc.scale = value;
  },

  get viewMode() {
    const doc = this.documents[this.activeDocumentIndex];
    return doc ? doc.viewMode : 'single';
  },
  set viewMode(value) {
    const doc = this.documents[this.activeDocumentIndex];
    if (doc) doc.viewMode = value;
  },

  get currentPdfPath() {
    const doc = this.documents[this.activeDocumentIndex];
    return doc ? doc.filePath : null;
  },
  set currentPdfPath(value) {
    const doc = this.documents[this.activeDocumentIndex];
    if (doc) {
      doc.filePath = value;
      doc.fileName = value ? value.split(/[\\/]/).pop() : 'Untitled';
    }
  },

  get annotations() {
    const doc = this.documents[this.activeDocumentIndex];
    return doc ? doc.annotations : [];
  },
  set annotations(value) {
    const doc = this.documents[this.activeDocumentIndex];
    if (doc) doc.annotations = value;
  },

  get textEdits() {
    const doc = this.documents[this.activeDocumentIndex];
    return doc ? doc.textEdits : [];
  },
  set textEdits(value) {
    const doc = this.documents[this.activeDocumentIndex];
    if (doc) doc.textEdits = value;
  },

  get watermarks() {
    const doc = this.documents[this.activeDocumentIndex];
    return doc ? doc.watermarks : [];
  },
  set watermarks(value) {
    const doc = this.documents[this.activeDocumentIndex];
    if (doc) doc.watermarks = value;
  },

  get bookmarks() {
    const doc = this.documents[this.activeDocumentIndex];
    return doc ? doc.bookmarks : [];
  },
  set bookmarks(value) {
    const doc = this.documents[this.activeDocumentIndex];
    if (doc) doc.bookmarks = value;
  },

  get redoStack() {
    const doc = this.documents[this.activeDocumentIndex];
    return doc ? doc.redoStack : [];
  },
  set redoStack(value) {
    const doc = this.documents[this.activeDocumentIndex];
    if (doc) doc.redoStack = value;
  },

  get pageRotations() {
    const doc = this.documents[this.activeDocumentIndex];
    return doc ? doc.pageRotations : {};
  },
  set pageRotations(value) {
    const doc = this.documents[this.activeDocumentIndex];
    if (doc) doc.pageRotations = value;
  },

  get selectedAnnotation() {
    const doc = this.documents[this.activeDocumentIndex];
    return doc ? doc.selectedAnnotation : null;
  },
  set selectedAnnotation(value) {
    const doc = this.documents[this.activeDocumentIndex];
    if (doc) {
      doc.selectedAnnotation = value;
      // Sync: when setting single selection, update multi-selection array
      if (value) {
        doc.selectedAnnotations = [value];
      } else {
        doc.selectedAnnotations = [];
      }
    }
  },

  get selectedAnnotations() {
    const doc = this.documents[this.activeDocumentIndex];
    return doc ? doc.selectedAnnotations : [];
  },
  set selectedAnnotations(value) {
    const doc = this.documents[this.activeDocumentIndex];
    if (doc) {
      doc.selectedAnnotations = value;
      // Sync: keep selectedAnnotation pointing to first item or null
      doc.selectedAnnotation = value.length > 0 ? value[0] : null;
    }
  }
};

/**
 * Get the active document
 * @returns {Object|null} Active document or null
 */
export function getActiveDocument() {
  return state.documents[state.activeDocumentIndex] || null;
}

/**
 * Check if any document is open
 * @returns {boolean}
 */
export function hasOpenDocuments() {
  return state.documents.length > 0;
}

/**
 * Find document index by file path
 * @param {string} filePath
 * @returns {number} Index or -1 if not found
 */
export function findDocumentByPath(filePath) {
  return state.documents.findIndex(doc => doc.filePath === filePath);
}

/**
 * Get the rotation for a specific page (in degrees, multiple of 90)
 */
export function getPageRotation(pageNum) {
  const doc = state.documents[state.activeDocumentIndex];
  return doc ? (doc.pageRotations[pageNum] || 0) : 0;
}

/**
 * Set the rotation for a specific page (in degrees, multiple of 90)
 */
export function setPageRotation(pageNum, degrees) {
  const doc = state.documents[state.activeDocumentIndex];
  if (doc) {
    doc.pageRotations[pageNum] = ((degrees % 360) + 360) % 360;
  }
}

/**
 * Clear all selections
 */
export function clearSelection() {
  const doc = state.documents[state.activeDocumentIndex];
  if (doc) {
    doc.selectedAnnotation = null;
    doc.selectedAnnotations = [];
  }
}

/**
 * Add annotation to selection (for Ctrl+click)
 */
export function addToSelection(annotation) {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc) return;
  if (!doc.selectedAnnotations.includes(annotation)) {
    doc.selectedAnnotations.push(annotation);
  }
  doc.selectedAnnotation = annotation;
}

/**
 * Remove annotation from selection (for Ctrl+click toggle)
 */
export function removeFromSelection(annotation) {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc) return;
  doc.selectedAnnotations = doc.selectedAnnotations.filter(a => a !== annotation);
  doc.selectedAnnotation = doc.selectedAnnotations.length > 0
    ? doc.selectedAnnotations[doc.selectedAnnotations.length - 1]
    : null;
}

/**
 * Check if annotation is in current selection
 */
export function isSelected(annotation) {
  const doc = state.documents[state.activeDocumentIndex];
  return doc ? doc.selectedAnnotations.includes(annotation) : false;
}

/**
 * Select all annotations on current page
 */
export function selectAllOnPage() {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc) return;
  const pageAnnotations = doc.annotations.filter(a => a.page === doc.currentPage);
  doc.selectedAnnotations = pageAnnotations;
  doc.selectedAnnotation = pageAnnotations.length > 0 ? pageAnnotations[0] : null;
}

/**
 * Get the bounding box of all selected annotations
 */
export function getSelectionBounds() {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc || doc.selectedAnnotations.length === 0) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const ann of doc.selectedAnnotations) {
    const bounds = getAnnotationBounds(ann);
    if (!bounds) continue;
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  }

  if (minX === Infinity) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Get bounding box for a single annotation
 */
export function getAnnotationBounds(ann) {
  switch (ann.type) {
    case 'draw':
      if (!ann.path || ann.path.length === 0) return null;
      const drawMinX = Math.min(...ann.path.map(p => p.x));
      const drawMinY = Math.min(...ann.path.map(p => p.y));
      const drawMaxX = Math.max(...ann.path.map(p => p.x));
      const drawMaxY = Math.max(...ann.path.map(p => p.y));
      return { x: drawMinX, y: drawMinY, width: drawMaxX - drawMinX, height: drawMaxY - drawMinY };
    case 'line':
    case 'arrow':
      const lx = Math.min(ann.startX, ann.endX);
      const ly = Math.min(ann.startY, ann.endY);
      return { x: lx, y: ly, width: Math.abs(ann.endX - ann.startX), height: Math.abs(ann.endY - ann.startY) };
    case 'polyline':
      if (!ann.points || ann.points.length === 0) return null;
      const plMinX = Math.min(...ann.points.map(p => p.x));
      const plMinY = Math.min(...ann.points.map(p => p.y));
      const plMaxX = Math.max(...ann.points.map(p => p.x));
      const plMaxY = Math.max(...ann.points.map(p => p.y));
      return { x: plMinX, y: plMinY, width: plMaxX - plMinX, height: plMaxY - plMinY };
    case 'text':
      return { x: ann.x, y: ann.y - (ann.fontSize || 16), width: 100, height: ann.fontSize || 16 };
    case 'comment':
      return { x: ann.x, y: ann.y, width: ann.width || 24, height: ann.height || 24 };
    case 'image':
    case 'stamp':
    case 'signature':
    case 'redaction':
      return { x: ann.x, y: ann.y, width: ann.width, height: ann.height };
    case 'textHighlight':
    case 'textStrikethrough':
    case 'textUnderline':
      return { x: ann.x, y: ann.y, width: ann.width, height: ann.height };
    default:
      if (ann.x !== undefined && ann.width !== undefined) {
        return { x: ann.x, y: ann.y, width: ann.width || 150, height: ann.height || 50 };
      }
      return null;
  }
}

// Make shiftKeyPressed accessible globally for legacy code
Object.defineProperty(window, 'shiftKeyPressed', {
  get: () => state.shiftKeyPressed,
  set: (value) => { state.shiftKeyPressed = value; }
});
