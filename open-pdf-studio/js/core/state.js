import { DEFAULT_PREFERENCES } from './constants.js';

// Get system username for default author
function getSystemUsername() {
  try {
    const os = window.require('os');
    return os.userInfo().username || 'User';
  } catch (e) {
    // Fallback if not in Electron or os module unavailable
    return 'User';
  }
}

// Central mutable state object
// All modules import this and can read/modify state directly
export const state = {
  // PDF state
  pdfDoc: null,
  currentPage: 1,
  scale: 1.5,
  currentTool: 'select',
  viewMode: 'single', // 'single' or 'continuous'
  currentPdfPath: null, // Current PDF file path for saving

  // Annotation state
  annotations: [],
  isDrawing: false,
  startX: 0,
  startY: 0,
  currentPath: [],
  polylinePoints: [], // Points for polyline tool
  isDrawingPolyline: false, // Whether we're in polyline drawing mode
  selectedAnnotation: null,

  // Dragging/Resizing state
  isDragging: false,
  isResizing: false,
  activeHandle: null, // Which handle is being dragged
  dragStartX: 0,
  dragStartY: 0,
  originalAnnotation: null, // Store original state for drag operations

  // Image cache for loaded images
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
  defaultAuthor: getSystemUsername(),

  // Shift key state (for angle snapping during rotation)
  shiftKeyPressed: false
};

// Make shiftKeyPressed accessible globally for legacy code
Object.defineProperty(window, 'shiftKeyPressed', {
  get: () => state.shiftKeyPressed,
  set: (value) => { state.shiftKeyPressed = value; }
});
