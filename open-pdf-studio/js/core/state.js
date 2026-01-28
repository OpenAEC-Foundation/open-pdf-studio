import { DEFAULT_PREFERENCES } from './constants.js';
import { isTauri, getUsername } from '../tauri-api.js';

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
    redoStack: [],
    selectedAnnotation: null,
    modified: false,
    scrollPosition: { x: 0, y: 0 },
  };
}

// Central mutable state object
// All modules import this and can read/modify state directly
export const state = {
  // Multi-document state
  documents: [],
  activeDocumentIndex: -1,

  // Current tool (global across all documents)
  currentTool: 'select',

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

  // Continuous mode state
  activeContinuousCanvas: null,
  activeContinuousPage: null,

  // Menu state
  activeMenu: null,

  // Text editing state
  isEditingText: false,
  editingAnnotation: null,
  textEditElement: null,

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

  get redoStack() {
    const doc = this.documents[this.activeDocumentIndex];
    return doc ? doc.redoStack : [];
  },
  set redoStack(value) {
    const doc = this.documents[this.activeDocumentIndex];
    if (doc) doc.redoStack = value;
  },

  get selectedAnnotation() {
    const doc = this.documents[this.activeDocumentIndex];
    return doc ? doc.selectedAnnotation : null;
  },
  set selectedAnnotation(value) {
    const doc = this.documents[this.activeDocumentIndex];
    if (doc) doc.selectedAnnotation = value;
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

// Make shiftKeyPressed accessible globally for legacy code
Object.defineProperty(window, 'shiftKeyPressed', {
  get: () => state.shiftKeyPressed,
  set: (value) => { state.shiftKeyPressed = value; }
});
