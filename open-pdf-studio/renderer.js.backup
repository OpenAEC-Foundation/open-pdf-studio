import * as pdfjsLib from './pdfjs/build/pdf.mjs';

const fs = window.require('fs');
const path = window.require('path');
const { PDFDocument, rgb, StandardFonts } = window.require('pdf-lib');
const { ipcRenderer } = window.require('electron');

// Window control buttons
document.getElementById('btn-minimize')?.addEventListener('click', () => ipcRenderer.send('window-minimize'));
document.getElementById('btn-maximize')?.addEventListener('click', () => ipcRenderer.send('window-maximize'));
document.getElementById('btn-close')?.addEventListener('click', () => ipcRenderer.send('window-close'));

// About dialog
const aboutDialog = document.getElementById('about-dialog');
const { shell } = window.require('electron');

function showAboutDialog() {
  aboutDialog?.classList.add('visible');
}

function hideAboutDialog() {
  aboutDialog?.classList.remove('visible');
}

document.getElementById('about-close-btn')?.addEventListener('click', hideAboutDialog);
aboutDialog?.addEventListener('click', (e) => {
  if (e.target === aboutDialog) hideAboutDialog();
});

document.getElementById('about-website-link')?.addEventListener('click', (e) => {
  e.preventDefault();
  shell.openExternal('https://impertio.nl');
});

document.getElementById('about-email-link')?.addEventListener('click', (e) => {
  e.preventDefault();
  shell.openExternal('mailto:maarten@impertio.nl');
});

// Set worker path
pdfjsLib.GlobalWorkerOptions.workerSrc = './pdfjs/build/pdf.worker.mjs';

// Loading overlay functions
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = loadingOverlay?.querySelector('.loading-text');

function showLoading(message = 'Loading...') {
  if (loadingOverlay) {
    if (loadingText) loadingText.textContent = message;
    loadingOverlay.style.display = 'flex';
  }
}

function hideLoading() {
  if (loadingOverlay) {
    loadingOverlay.style.display = 'none';
  }
}

// DOM elements
const placeholder = document.getElementById('placeholder');
const fileInfo = document.getElementById('file-info');
const pdfContainer = document.getElementById('pdf-container');
const pdfCanvas = document.getElementById('pdf-canvas');
const annotationCanvas = document.getElementById('annotation-canvas');
const pageInfo = document.getElementById('page-info');
const prevPageBtn = document.getElementById('prev-page');
const nextPageBtn = document.getElementById('next-page');
const zoomInBtn = document.getElementById('zoom-in');
const zoomOutBtn = document.getElementById('zoom-out');
const zoomLevel = document.getElementById('zoom-level');

// Ribbon elements
const ribbonTabs = document.querySelectorAll('.ribbon-tab');
const ribbonContents = document.querySelectorAll('.ribbon-content');

// Tool buttons
const toolSelect = document.getElementById('tool-select');
const toolHighlight = document.getElementById('tool-highlight');
const toolDraw = document.getElementById('tool-draw');
const toolLine = document.getElementById('tool-line');
const toolCircle = document.getElementById('tool-circle');
const toolBox = document.getElementById('tool-box');
const toolComment = document.getElementById('tool-comment');
const toolText = document.getElementById('tool-text');
const toolPolygon = document.getElementById('tool-polygon');
const toolCloud = document.getElementById('tool-cloud');
const toolPolyline = document.getElementById('tool-polyline');
const toolTextbox = document.getElementById('tool-textbox');
const toolCallout = document.getElementById('tool-callout');
const toolClear = document.getElementById('tool-clear');
const toolUndo = document.getElementById('tool-undo');
const colorPicker = document.getElementById('color-picker');
const lineWidth = document.getElementById('line-width');

// Properties panel elements
const propertiesPanel = document.getElementById('properties-panel');
const propType = document.getElementById('prop-type');
const propColor = document.getElementById('prop-color');
const propLineWidth = document.getElementById('prop-line-width');
const propBorderStyle = document.getElementById('prop-border-style');
const propBorderStyleGroup = document.getElementById('prop-border-style-group');
const propText = document.getElementById('prop-text');
const propFontSize = document.getElementById('prop-font-size');
const propTextGroup = document.getElementById('prop-text-group');
const propFontSizeGroup = document.getElementById('prop-font-size-group');
const propLineWidthGroup = document.getElementById('prop-line-width-group');
const propDelete = document.getElementById('prop-delete');
const propClose = document.getElementById('prop-close');

// New properties panel elements (PDF-XChange style)
const propAuthor = document.getElementById('prop-author');
const propSubject = document.getElementById('prop-subject');
const propCreated = document.getElementById('prop-created');
const propModified = document.getElementById('prop-modified');
const propOpacity = document.getElementById('prop-opacity');
const propOpacityValue = document.getElementById('prop-opacity-value');
const propLocked = document.getElementById('prop-locked');
const propPrintable = document.getElementById('prop-printable');
const propIcon = document.getElementById('prop-icon');
const propIconGroup = document.getElementById('prop-icon-group');
const propStrokeColor = document.getElementById('prop-stroke-color');
const propStrokeColorGroup = document.getElementById('prop-stroke-color-group');
const propFillColor = document.getElementById('prop-fill-color');
const propFillColorGroup = document.getElementById('prop-fill-color-group');

// Text formatting elements (for textbox/callout)
const propTextFormatSection = document.getElementById('prop-text-format-section');
const propParagraphSection = document.getElementById('prop-paragraph-section');
const propTextColor = document.getElementById('prop-text-color');
const propFontFamily = document.getElementById('prop-font-family');
const propTextFontSize = document.getElementById('prop-text-font-size');
const propTextBold = document.getElementById('prop-text-bold');
const propTextItalic = document.getElementById('prop-text-italic');
const propTextUnderline = document.getElementById('prop-text-underline');
const propTextStrikethrough = document.getElementById('prop-text-strikethrough');
const propAlignLeft = document.getElementById('prop-align-left');
const propAlignCenter = document.getElementById('prop-align-center');
const propAlignRight = document.getElementById('prop-align-right');
const propLineSpacing = document.getElementById('prop-line-spacing');

// Property panel sections (for text editing mode)
const propGeneralSection = document.getElementById('prop-general-section');
const propAppearanceSection = document.getElementById('prop-appearance-section');
const propContentSection = document.getElementById('prop-content-section');
const propImageSection = document.getElementById('prop-image-section');
const propActionsSection = document.getElementById('prop-actions-section');

// Status bar elements
const statusTool = document.getElementById('status-tool');
const statusPage = document.getElementById('status-page');
const statusZoom = document.getElementById('status-zoom');
const statusAnnotations = document.getElementById('status-annotations');
const statusMessage = document.getElementById('status-message');

// Annotations list panel elements
const annotationsListPanel = document.getElementById('annotations-list-panel');
const annotationsListContent = document.getElementById('annotations-list-content');
const annotationsListFilter = document.getElementById('annotations-list-filter');
const annotationsListCount = document.getElementById('annotations-list-count');

// Application Preferences
const DEFAULT_PREFERENCES = {
  // General
  authorName: 'User',

  // Snapping
  angleSnapDegrees: 30,
  enableAngleSnap: true,

  // Grid snapping (for future use)
  gridSize: 10,
  enableGridSnap: false,

  // Appearance
  defaultAnnotationColor: '#ffff00',
  defaultLineWidth: 3,
  defaultFontSize: 16,
  highlightOpacity: 30, // percentage

  // TextBox defaults
  textboxFillColor: '#ffffd0',
  textboxFillNone: false,
  textboxStrokeColor: '#000000',
  textboxBorderWidth: 1,
  textboxBorderStyle: 'solid', // solid, dashed, dotted
  textboxOpacity: 100, // percentage
  textboxFontSize: 14,

  // Callout defaults
  calloutFillColor: '#ffffd0',
  calloutFillNone: false,
  calloutStrokeColor: '#000000',
  calloutBorderWidth: 1,
  calloutBorderStyle: 'solid', // solid, dashed, dotted
  calloutOpacity: 100, // percentage
  calloutFontSize: 14,

  // Rectangle defaults
  rectFillColor: '#ffff00',
  rectFillNone: true, // Default to no fill
  rectStrokeColor: '#000000',
  rectBorderWidth: 2,
  rectBorderStyle: 'solid',
  rectOpacity: 100,

  // Circle/Ellipse defaults
  circleFillColor: '#ffff00',
  circleFillNone: true, // Default to no fill
  circleStrokeColor: '#000000',
  circleBorderWidth: 2,
  circleBorderStyle: 'solid',
  circleOpacity: 100,

  // Behavior
  autoSelectAfterCreate: true,
  confirmBeforeDelete: true,

  // Display
  showHandles: true,
  handleSize: 8
};

let preferences = { ...DEFAULT_PREFERENCES };

// Load preferences from localStorage
function loadPreferences() {
  try {
    const saved = localStorage.getItem('pdfEditorPreferences');
    if (saved) {
      const parsed = JSON.parse(saved);
      // Merge with defaults to ensure all keys exist
      preferences = { ...DEFAULT_PREFERENCES, ...parsed };
    }
  } catch (e) {
    console.error('Failed to load preferences:', e);
    preferences = { ...DEFAULT_PREFERENCES };
  }
  applyPreferences();
}

// Save preferences to localStorage
function savePreferences() {
  try {
    localStorage.setItem('pdfEditorPreferences', JSON.stringify(preferences));
    applyPreferences();
  } catch (e) {
    console.error('Failed to save preferences:', e);
  }
}

// Apply preferences to the application
function applyPreferences() {
  // Update default author
  defaultAuthor = preferences.authorName;

  // Update color picker default
  if (colorPicker) {
    colorPicker.value = preferences.defaultAnnotationColor;
  }

  // Update line width default
  if (lineWidth) {
    lineWidth.value = preferences.defaultLineWidth;
  }

  // Update handle size
  if (typeof HANDLE_SIZE !== 'undefined') {
    // HANDLE_SIZE is const, so we use preferences.handleSize directly
  }
}

// Show preferences dialog
function showPreferencesDialog() {
  const overlay = document.getElementById('preferences-dialog');
  if (!overlay) return;

  const dialog = overlay.querySelector('.preferences-dialog');
  if (dialog) {
    // Reset position to center
    dialog.style.left = '50%';
    dialog.style.top = '50%';
    dialog.style.transform = 'translate(-50%, -50%)';
  }

  // Reset to first tab
  document.querySelectorAll('.pref-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.pref-tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector('.pref-tab[data-pref-tab="general"]')?.classList.add('active');
  document.getElementById('pref-tab-general')?.classList.add('active');

  // Populate form with current values
  document.getElementById('pref-author-name').value = preferences.authorName;
  document.getElementById('pref-angle-snap').value = preferences.angleSnapDegrees;
  document.getElementById('pref-enable-angle-snap').checked = preferences.enableAngleSnap;
  document.getElementById('pref-grid-size').value = preferences.gridSize;
  document.getElementById('pref-enable-grid-snap').checked = preferences.enableGridSnap;
  document.getElementById('pref-default-color').value = preferences.defaultAnnotationColor;
  document.getElementById('pref-default-line-width').value = preferences.defaultLineWidth;
  document.getElementById('pref-default-font-size').value = preferences.defaultFontSize;
  document.getElementById('pref-highlight-opacity').value = preferences.highlightOpacity;
  document.getElementById('pref-auto-select').checked = preferences.autoSelectAfterCreate;
  document.getElementById('pref-confirm-delete').checked = preferences.confirmBeforeDelete;

  // TextBox defaults
  const textboxFillNone = document.getElementById('pref-textbox-fill-none');
  const textboxFillColor = document.getElementById('pref-textbox-fill-color');
  if (textboxFillNone) textboxFillNone.checked = preferences.textboxFillNone;
  if (textboxFillColor) {
    textboxFillColor.value = preferences.textboxFillColor;
    textboxFillColor.disabled = preferences.textboxFillNone;
  }
  document.getElementById('pref-textbox-stroke-color').value = preferences.textboxStrokeColor;
  document.getElementById('pref-textbox-border-width').value = preferences.textboxBorderWidth;
  document.getElementById('pref-textbox-border-style').value = preferences.textboxBorderStyle;
  document.getElementById('pref-textbox-opacity').value = preferences.textboxOpacity;
  document.getElementById('pref-textbox-font-size').value = preferences.textboxFontSize;

  // Callout defaults
  const calloutFillNone = document.getElementById('pref-callout-fill-none');
  const calloutFillColor = document.getElementById('pref-callout-fill-color');
  if (calloutFillNone) calloutFillNone.checked = preferences.calloutFillNone;
  if (calloutFillColor) {
    calloutFillColor.value = preferences.calloutFillColor;
    calloutFillColor.disabled = preferences.calloutFillNone;
  }
  document.getElementById('pref-callout-stroke-color').value = preferences.calloutStrokeColor;
  document.getElementById('pref-callout-border-width').value = preferences.calloutBorderWidth;
  document.getElementById('pref-callout-border-style').value = preferences.calloutBorderStyle;
  document.getElementById('pref-callout-opacity').value = preferences.calloutOpacity;
  document.getElementById('pref-callout-font-size').value = preferences.calloutFontSize;

  // Rectangle defaults
  const rectFillNone = document.getElementById('pref-rect-fill-none');
  const rectFillColor = document.getElementById('pref-rect-fill-color');
  if (rectFillNone) rectFillNone.checked = preferences.rectFillNone;
  if (rectFillColor) {
    rectFillColor.value = preferences.rectFillColor;
    rectFillColor.disabled = preferences.rectFillNone;
  }
  document.getElementById('pref-rect-stroke-color').value = preferences.rectStrokeColor;
  document.getElementById('pref-rect-border-width').value = preferences.rectBorderWidth;
  document.getElementById('pref-rect-border-style').value = preferences.rectBorderStyle;
  document.getElementById('pref-rect-opacity').value = preferences.rectOpacity;

  // Circle/Ellipse defaults
  const circleFillNone = document.getElementById('pref-circle-fill-none');
  const circleFillColor = document.getElementById('pref-circle-fill-color');
  if (circleFillNone) circleFillNone.checked = preferences.circleFillNone;
  if (circleFillColor) {
    circleFillColor.value = preferences.circleFillColor;
    circleFillColor.disabled = preferences.circleFillNone;
  }
  document.getElementById('pref-circle-stroke-color').value = preferences.circleStrokeColor;
  document.getElementById('pref-circle-border-width').value = preferences.circleBorderWidth;
  document.getElementById('pref-circle-border-style').value = preferences.circleBorderStyle;
  document.getElementById('pref-circle-opacity').value = preferences.circleOpacity;

  overlay.classList.add('visible');
}

// Hide preferences dialog
function hidePreferencesDialog() {
  const dialog = document.getElementById('preferences-dialog');
  if (dialog) {
    dialog.classList.remove('visible');
  }
}

// Save preferences from dialog
function savePreferencesFromDialog() {
  preferences.authorName = document.getElementById('pref-author-name').value || 'User';
  preferences.angleSnapDegrees = parseInt(document.getElementById('pref-angle-snap').value) || 30;
  preferences.enableAngleSnap = document.getElementById('pref-enable-angle-snap').checked;
  preferences.gridSize = parseInt(document.getElementById('pref-grid-size').value) || 10;
  preferences.enableGridSnap = document.getElementById('pref-enable-grid-snap').checked;
  preferences.defaultAnnotationColor = document.getElementById('pref-default-color').value;
  preferences.defaultLineWidth = parseInt(document.getElementById('pref-default-line-width').value) || 3;
  preferences.defaultFontSize = parseInt(document.getElementById('pref-default-font-size').value) || 16;
  preferences.highlightOpacity = parseInt(document.getElementById('pref-highlight-opacity').value) || 30;
  preferences.autoSelectAfterCreate = document.getElementById('pref-auto-select').checked;
  preferences.confirmBeforeDelete = document.getElementById('pref-confirm-delete').checked;

  // TextBox defaults
  preferences.textboxFillNone = document.getElementById('pref-textbox-fill-none')?.checked || false;
  preferences.textboxFillColor = document.getElementById('pref-textbox-fill-color').value;
  preferences.textboxStrokeColor = document.getElementById('pref-textbox-stroke-color').value;
  preferences.textboxBorderWidth = parseInt(document.getElementById('pref-textbox-border-width').value) || 1;
  preferences.textboxBorderStyle = document.getElementById('pref-textbox-border-style').value;
  preferences.textboxOpacity = parseInt(document.getElementById('pref-textbox-opacity').value) || 100;
  preferences.textboxFontSize = parseInt(document.getElementById('pref-textbox-font-size').value) || 14;

  // Callout defaults
  preferences.calloutFillNone = document.getElementById('pref-callout-fill-none')?.checked || false;
  preferences.calloutFillColor = document.getElementById('pref-callout-fill-color').value;
  preferences.calloutStrokeColor = document.getElementById('pref-callout-stroke-color').value;
  preferences.calloutBorderWidth = parseInt(document.getElementById('pref-callout-border-width').value) || 1;
  preferences.calloutBorderStyle = document.getElementById('pref-callout-border-style').value;
  preferences.calloutOpacity = parseInt(document.getElementById('pref-callout-opacity').value) || 100;
  preferences.calloutFontSize = parseInt(document.getElementById('pref-callout-font-size').value) || 14;

  // Rectangle defaults
  preferences.rectFillNone = document.getElementById('pref-rect-fill-none')?.checked || false;
  preferences.rectFillColor = document.getElementById('pref-rect-fill-color').value;
  preferences.rectStrokeColor = document.getElementById('pref-rect-stroke-color').value;
  preferences.rectBorderWidth = parseInt(document.getElementById('pref-rect-border-width').value) || 2;
  preferences.rectBorderStyle = document.getElementById('pref-rect-border-style').value;
  preferences.rectOpacity = parseInt(document.getElementById('pref-rect-opacity').value) || 100;

  // Circle/Ellipse defaults
  preferences.circleFillNone = document.getElementById('pref-circle-fill-none')?.checked || false;
  preferences.circleFillColor = document.getElementById('pref-circle-fill-color').value;
  preferences.circleStrokeColor = document.getElementById('pref-circle-stroke-color').value;
  preferences.circleBorderWidth = parseInt(document.getElementById('pref-circle-border-width').value) || 2;
  preferences.circleBorderStyle = document.getElementById('pref-circle-border-style').value;
  preferences.circleOpacity = parseInt(document.getElementById('pref-circle-opacity').value) || 100;

  savePreferences();
  hidePreferencesDialog();
}

// Reset preferences to defaults
function resetPreferencesToDefaults() {
  if (confirm('Reset all preferences to default values?')) {
    preferences = { ...DEFAULT_PREFERENCES };
    savePreferences();
    showPreferencesDialog(); // Refresh the dialog
  }
}

// Legacy support
let defaultAuthor = DEFAULT_PREFERENCES.authorName;

// Helper function to create annotation with default properties
// All annotations share these common properties (General section):
// - id, type, page: core identification
// - author, subject: metadata
// - createdAt, modifiedAt: timestamps
// - locked, printable, readOnly, marked: status flags
// - opacity: appearance (common to all)
// Type-specific properties are added by each tool when creating the annotation
function createAnnotation(baseProps) {
  const now = new Date().toISOString();

  // Default values - these will be overridden by baseProps if provided
  const defaults = {
    // Metadata
    author: defaultAuthor,
    subject: '',
    // Timestamps
    createdAt: now,
    modifiedAt: now,
    // Appearance (common)
    opacity: baseProps.type === 'highlight' ? 0.3 : 1.0,
    // Status flags (General section)
    locked: false,
    printable: true,
    readOnly: false,
    marked: false,
    // Type-specific defaults
    icon: baseProps.type === 'comment' ? 'comment' : undefined
  };

  // Merge defaults with baseProps - baseProps takes precedence
  return {
    ...defaults,
    ...baseProps
  };
}

// PDF state
let pdfDoc = null;
let currentPage = 1;
let scale = 1.5;
let currentTool = 'select';
let viewMode = 'single'; // 'single' or 'continuous'
let currentPdfPath = null; // Current PDF file path for saving

// Annotation state
let annotations = [];
let isDrawing = false;
let startX = 0;
let startY = 0;
let currentPath = [];
let polylinePoints = []; // Points for polyline tool
let isDrawingPolyline = false; // Whether we're in polyline drawing mode
let selectedAnnotation = null;

// Dragging/Resizing state
let isDragging = false;
let isResizing = false;
let activeHandle = null; // Which handle is being dragged
let dragStartX = 0;
let dragStartY = 0;
let originalAnnotation = null; // Store original state for drag operations

// Image cache for loaded images
const imageCache = new Map();

// Clipboard for copy/paste operations
let clipboardAnnotation = null;

// Handle types
const HANDLE_SIZE = 8;
const HANDLE_TYPES = {
  MOVE: 'move',
  TOP_LEFT: 'tl',
  TOP_RIGHT: 'tr',
  BOTTOM_LEFT: 'bl',
  BOTTOM_RIGHT: 'br',
  TOP: 't',
  BOTTOM: 'b',
  LEFT: 'l',
  RIGHT: 'r',
  LINE_START: 'line_start',
  LINE_END: 'line_end',
  RADIUS: 'radius',
  ROTATE: 'rotate',
  CALLOUT_ARROW: 'callout_arrow',
  CALLOUT_KNEE: 'callout_knee'
};

// Get handles for an annotation based on its type
function getAnnotationHandles(annotation) {
  const handles = [];
  const hs = HANDLE_SIZE;

  switch (annotation.type) {
    case 'box':
    case 'highlight':
    case 'polygon':
    case 'cloud':
    case 'textbox':
      // Corner handles
      handles.push({ type: HANDLE_TYPES.TOP_LEFT, x: annotation.x - hs/2, y: annotation.y - hs/2 });
      handles.push({ type: HANDLE_TYPES.TOP_RIGHT, x: annotation.x + annotation.width - hs/2, y: annotation.y - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM_LEFT, x: annotation.x - hs/2, y: annotation.y + annotation.height - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM_RIGHT, x: annotation.x + annotation.width - hs/2, y: annotation.y + annotation.height - hs/2 });
      // Edge handles
      handles.push({ type: HANDLE_TYPES.TOP, x: annotation.x + annotation.width/2 - hs/2, y: annotation.y - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM, x: annotation.x + annotation.width/2 - hs/2, y: annotation.y + annotation.height - hs/2 });
      handles.push({ type: HANDLE_TYPES.LEFT, x: annotation.x - hs/2, y: annotation.y + annotation.height/2 - hs/2 });
      handles.push({ type: HANDLE_TYPES.RIGHT, x: annotation.x + annotation.width - hs/2, y: annotation.y + annotation.height/2 - hs/2 });
      break;

    case 'callout':
      // Corner handles for the text box
      const coW = annotation.width || 150;
      const coH = annotation.height || 50;
      handles.push({ type: HANDLE_TYPES.TOP_LEFT, x: annotation.x - hs/2, y: annotation.y - hs/2 });
      handles.push({ type: HANDLE_TYPES.TOP_RIGHT, x: annotation.x + coW - hs/2, y: annotation.y - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM_LEFT, x: annotation.x - hs/2, y: annotation.y + coH - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM_RIGHT, x: annotation.x + coW - hs/2, y: annotation.y + coH - hs/2 });
      // Callout arrow handle
      const arrowX = annotation.arrowX !== undefined ? annotation.arrowX : annotation.x - 60;
      const arrowY = annotation.arrowY !== undefined ? annotation.arrowY : annotation.y + coH;
      handles.push({ type: HANDLE_TYPES.CALLOUT_ARROW, x: arrowX - hs/2, y: arrowY - hs/2 });
      // Knee point handle
      const kneeX = annotation.kneeX !== undefined ? annotation.kneeX : annotation.x - 30;
      const kneeY = annotation.kneeY !== undefined ? annotation.kneeY : annotation.y + coH / 2;
      handles.push({ type: HANDLE_TYPES.CALLOUT_KNEE, x: kneeX - hs/2, y: kneeY - hs/2 });
      break;

    case 'circle':
      // Ellipse uses same handles as box (corner and edge handles)
      const circW = annotation.width || annotation.radius * 2;
      const circH = annotation.height || annotation.radius * 2;
      const circX = annotation.x !== undefined ? annotation.x : annotation.centerX - annotation.radius;
      const circY = annotation.y !== undefined ? annotation.y : annotation.centerY - annotation.radius;
      // Corner handles
      handles.push({ type: HANDLE_TYPES.TOP_LEFT, x: circX - hs/2, y: circY - hs/2 });
      handles.push({ type: HANDLE_TYPES.TOP_RIGHT, x: circX + circW - hs/2, y: circY - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM_LEFT, x: circX - hs/2, y: circY + circH - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM_RIGHT, x: circX + circW - hs/2, y: circY + circH - hs/2 });
      // Edge handles
      handles.push({ type: HANDLE_TYPES.TOP, x: circX + circW/2 - hs/2, y: circY - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM, x: circX + circW/2 - hs/2, y: circY + circH - hs/2 });
      handles.push({ type: HANDLE_TYPES.LEFT, x: circX - hs/2, y: circY + circH/2 - hs/2 });
      handles.push({ type: HANDLE_TYPES.RIGHT, x: circX + circW - hs/2, y: circY + circH/2 - hs/2 });
      break;

    case 'line':
      // Endpoint handles
      handles.push({ type: HANDLE_TYPES.LINE_START, x: annotation.startX - hs/2, y: annotation.startY - hs/2 });
      handles.push({ type: HANDLE_TYPES.LINE_END, x: annotation.endX - hs/2, y: annotation.endY - hs/2 });
      break;

    case 'comment':
      // Comment box handles with resize and rotation support
      const cw = annotation.width || 24;
      const ch = annotation.height || 24;
      handles.push({ type: HANDLE_TYPES.TOP_LEFT, x: annotation.x - hs/2, y: annotation.y - hs/2 });
      handles.push({ type: HANDLE_TYPES.TOP_RIGHT, x: annotation.x + cw - hs/2, y: annotation.y - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM_LEFT, x: annotation.x - hs/2, y: annotation.y + ch - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM_RIGHT, x: annotation.x + cw - hs/2, y: annotation.y + ch - hs/2 });
      // Edge handles
      handles.push({ type: HANDLE_TYPES.TOP, x: annotation.x + cw/2 - hs/2, y: annotation.y - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM, x: annotation.x + cw/2 - hs/2, y: annotation.y + ch - hs/2 });
      handles.push({ type: HANDLE_TYPES.LEFT, x: annotation.x - hs/2, y: annotation.y + ch/2 - hs/2 });
      handles.push({ type: HANDLE_TYPES.RIGHT, x: annotation.x + cw - hs/2, y: annotation.y + ch/2 - hs/2 });
      // Rotation handle
      handles.push({ type: HANDLE_TYPES.ROTATE, x: annotation.x + cw/2 - hs/2, y: annotation.y - 30 - hs/2 });
      break;

    case 'text':
      // Calculate text bounds
      annotationCtx.font = `${annotation.fontSize || 16}px Arial`;
      const textWidth = annotationCtx.measureText(annotation.text).width;
      const textHeight = annotation.fontSize || 16;
      handles.push({ type: HANDLE_TYPES.TOP_LEFT, x: annotation.x - hs/2, y: annotation.y - textHeight - hs/2 });
      handles.push({ type: HANDLE_TYPES.TOP_RIGHT, x: annotation.x + textWidth - hs/2, y: annotation.y - textHeight - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM_LEFT, x: annotation.x - hs/2, y: annotation.y - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM_RIGHT, x: annotation.x + textWidth - hs/2, y: annotation.y - hs/2 });
      break;

    case 'draw':
      // For freehand, show bounding box handles
      if (annotation.path && annotation.path.length > 0) {
        const minX = Math.min(...annotation.path.map(p => p.x));
        const minY = Math.min(...annotation.path.map(p => p.y));
        const maxX = Math.max(...annotation.path.map(p => p.x));
        const maxY = Math.max(...annotation.path.map(p => p.y));
        handles.push({ type: HANDLE_TYPES.TOP_LEFT, x: minX - hs/2, y: minY - hs/2 });
        handles.push({ type: HANDLE_TYPES.TOP_RIGHT, x: maxX - hs/2, y: minY - hs/2 });
        handles.push({ type: HANDLE_TYPES.BOTTOM_LEFT, x: minX - hs/2, y: maxY - hs/2 });
        handles.push({ type: HANDLE_TYPES.BOTTOM_RIGHT, x: maxX - hs/2, y: maxY - hs/2 });
      }
      break;

    case 'polyline':
      // For polyline, show bounding box handles
      if (annotation.points && annotation.points.length > 0) {
        const plMinX = Math.min(...annotation.points.map(p => p.x));
        const plMinY = Math.min(...annotation.points.map(p => p.y));
        const plMaxX = Math.max(...annotation.points.map(p => p.x));
        const plMaxY = Math.max(...annotation.points.map(p => p.y));
        handles.push({ type: HANDLE_TYPES.TOP_LEFT, x: plMinX - hs/2, y: plMinY - hs/2 });
        handles.push({ type: HANDLE_TYPES.TOP_RIGHT, x: plMaxX - hs/2, y: plMinY - hs/2 });
        handles.push({ type: HANDLE_TYPES.BOTTOM_LEFT, x: plMinX - hs/2, y: plMaxY - hs/2 });
        handles.push({ type: HANDLE_TYPES.BOTTOM_RIGHT, x: plMaxX - hs/2, y: plMaxY - hs/2 });
      }
      break;

    case 'image':
      // Corner handles for resize
      handles.push({ type: HANDLE_TYPES.TOP_LEFT, x: annotation.x - hs/2, y: annotation.y - hs/2 });
      handles.push({ type: HANDLE_TYPES.TOP_RIGHT, x: annotation.x + annotation.width - hs/2, y: annotation.y - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM_LEFT, x: annotation.x - hs/2, y: annotation.y + annotation.height - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM_RIGHT, x: annotation.x + annotation.width - hs/2, y: annotation.y + annotation.height - hs/2 });
      // Edge handles
      handles.push({ type: HANDLE_TYPES.TOP, x: annotation.x + annotation.width/2 - hs/2, y: annotation.y - hs/2 });
      handles.push({ type: HANDLE_TYPES.BOTTOM, x: annotation.x + annotation.width/2 - hs/2, y: annotation.y + annotation.height - hs/2 });
      handles.push({ type: HANDLE_TYPES.LEFT, x: annotation.x - hs/2, y: annotation.y + annotation.height/2 - hs/2 });
      handles.push({ type: HANDLE_TYPES.RIGHT, x: annotation.x + annotation.width - hs/2, y: annotation.y + annotation.height/2 - hs/2 });
      // Rotation handle (above the image)
      handles.push({ type: HANDLE_TYPES.ROTATE, x: annotation.x + annotation.width/2 - hs/2, y: annotation.y - 30 - hs/2 });
      break;
  }

  return handles;
}

// Find which handle is at the given coordinates
function findHandleAt(x, y, annotation) {
  if (!annotation) return null;
  const handles = getAnnotationHandles(annotation);
  const hs = HANDLE_SIZE;

  for (const handle of handles) {
    if (x >= handle.x && x <= handle.x + hs &&
        y >= handle.y && y <= handle.y + hs) {
      return handle.type;
    }
  }
  return null;
}

// Check if point is inside annotation (for moving)
function isPointInsideAnnotation(x, y, annotation) {
  switch (annotation.type) {
    case 'box':
    case 'highlight':
    case 'polygon':
    case 'cloud':
    case 'textbox':
    case 'callout':
      const w = annotation.width || 150;
      const h = annotation.height || 50;
      return x >= annotation.x && x <= annotation.x + w &&
             y >= annotation.y && y <= annotation.y + h;

    case 'circle':
      // Check if point is inside ellipse using bounding box model
      const ellW = annotation.width || annotation.radius * 2;
      const ellH = annotation.height || annotation.radius * 2;
      const ellCX = annotation.x + ellW / 2;
      const ellCY = annotation.y + ellH / 2;
      const ellRX = ellW / 2;
      const ellRY = ellH / 2;
      // Normalized distance from center (1 means on the ellipse boundary)
      const normDist = Math.pow((x - ellCX) / ellRX, 2) + Math.pow((y - ellCY) / ellRY, 2);
      return normDist <= 1;

    case 'line':
      const lineDist = distanceToLine(x, y, annotation.startX, annotation.startY, annotation.endX, annotation.endY);
      return lineDist < 15;

    case 'comment':
      const commentW = annotation.width || 24;
      const commentH = annotation.height || 24;
      return x >= annotation.x && x <= annotation.x + commentW &&
             y >= annotation.y && y <= annotation.y + commentH;

    case 'text':
      annotationCtx.font = `${annotation.fontSize || 16}px Arial`;
      const textWidth = annotationCtx.measureText(annotation.text).width;
      const textHeight = annotation.fontSize || 16;
      return x >= annotation.x && x <= annotation.x + textWidth &&
             y >= annotation.y - textHeight && y <= annotation.y;

    case 'draw':
      if (annotation.path && annotation.path.length > 0) {
        const minX = Math.min(...annotation.path.map(p => p.x));
        const minY = Math.min(...annotation.path.map(p => p.y));
        const maxX = Math.max(...annotation.path.map(p => p.x));
        const maxY = Math.max(...annotation.path.map(p => p.y));
        return x >= minX && x <= maxX && y >= minY && y <= maxY;
      }
      return false;

    case 'polyline':
      if (annotation.points && annotation.points.length > 0) {
        const plMinX = Math.min(...annotation.points.map(p => p.x));
        const plMinY = Math.min(...annotation.points.map(p => p.y));
        const plMaxX = Math.max(...annotation.points.map(p => p.x));
        const plMaxY = Math.max(...annotation.points.map(p => p.y));
        return x >= plMinX && x <= plMaxX && y >= plMinY && y <= plMaxY;
      }
      return false;

    case 'image':
      return x >= annotation.x && x <= annotation.x + annotation.width &&
             y >= annotation.y && y <= annotation.y + annotation.height;

    default:
      return false;
  }
}

// Get cursor style for handle type
function getCursorForHandle(handleType) {
  switch (handleType) {
    case HANDLE_TYPES.TOP_LEFT:
    case HANDLE_TYPES.BOTTOM_RIGHT:
      return 'nwse-resize';
    case HANDLE_TYPES.TOP_RIGHT:
    case HANDLE_TYPES.BOTTOM_LEFT:
      return 'nesw-resize';
    case HANDLE_TYPES.TOP:
    case HANDLE_TYPES.BOTTOM:
      return 'ns-resize';
    case HANDLE_TYPES.LEFT:
    case HANDLE_TYPES.RIGHT:
      return 'ew-resize';
    case HANDLE_TYPES.LINE_START:
    case HANDLE_TYPES.LINE_END:
      return 'crosshair';
    case HANDLE_TYPES.MOVE:
      return 'move';
    case HANDLE_TYPES.ROTATE:
      return 'grab';
    case HANDLE_TYPES.CALLOUT_ARROW:
      return 'crosshair';
    case HANDLE_TYPES.CALLOUT_KNEE:
      return 'move';
    default:
      return 'default';
  }
}

// Draw polygon shape
function drawPolygonShape(ctx, x, y, width, height, sides = 6) {
  const cx = x + width / 2;
  const cy = y + height / 2;
  const rx = width / 2;
  const ry = height / 2;

  ctx.beginPath();
  for (let i = 0; i <= sides; i++) {
    const angle = (i * 2 * Math.PI / sides) - Math.PI / 2;
    const px = cx + rx * Math.cos(angle);
    const py = cy + ry * Math.sin(angle);
    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.closePath();
  ctx.stroke();
}

// Draw cloud shape (bumpy rectangle)
function drawCloudShape(ctx, x, y, width, height) {
  const bumpRadius = Math.min(width, height) / 8;
  const numBumpsH = Math.max(3, Math.floor(width / (bumpRadius * 1.5)));
  const numBumpsV = Math.max(2, Math.floor(height / (bumpRadius * 1.5)));

  ctx.beginPath();

  // Top edge (left to right)
  const topSpacing = width / numBumpsH;
  for (let i = 0; i < numBumpsH; i++) {
    const bx = x + topSpacing * (i + 0.5);
    ctx.arc(bx, y, bumpRadius, Math.PI, 0, false);
  }

  // Right edge (top to bottom)
  const rightSpacing = height / numBumpsV;
  for (let i = 0; i < numBumpsV; i++) {
    const by = y + rightSpacing * (i + 0.5);
    ctx.arc(x + width, by, bumpRadius, -Math.PI / 2, Math.PI / 2, false);
  }

  // Bottom edge (right to left)
  for (let i = numBumpsH - 1; i >= 0; i--) {
    const bx = x + topSpacing * (i + 0.5);
    ctx.arc(bx, y + height, bumpRadius, 0, Math.PI, false);
  }

  // Left edge (bottom to top)
  for (let i = numBumpsV - 1; i >= 0; i--) {
    const by = y + rightSpacing * (i + 0.5);
    ctx.arc(x, by, bumpRadius, Math.PI / 2, -Math.PI / 2, false);
  }

  ctx.closePath();
  ctx.stroke();
}

// Deep clone annotation for undo/restore
function cloneAnnotation(annotation) {
  return JSON.parse(JSON.stringify(annotation));
}

// Copy annotation to internal clipboard
function copyAnnotation(annotation) {
  clipboardAnnotation = cloneAnnotation(annotation);
  updateStatusMessage('Annotation copied');
}

// Generate unique ID for images
function generateImageId() {
  return 'img_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Paste from clipboard (handles both images and annotations)
async function pasteFromClipboard() {
  if (!pdfDoc) return;

  try {
    // Try to read from system clipboard
    const clipboardItems = await navigator.clipboard.read();

    for (const item of clipboardItems) {
      // Check for image types
      const imageTypes = item.types.filter(type => type.startsWith('image/'));

      if (imageTypes.length > 0) {
        const imageType = imageTypes[0];
        const blob = await item.getType(imageType);
        await pasteImageFromBlob(blob);
        return;
      }
    }
  } catch (err) {
    // Clipboard API failed, check internal clipboard
    console.log('Clipboard API not available or denied, using internal clipboard');
  }

  // Fallback to internal clipboard for annotations
  if (clipboardAnnotation) {
    pasteAnnotation();
  }
}

// Paste image from blob
async function pasteImageFromBlob(blob) {
  const imageId = generateImageId();
  const url = URL.createObjectURL(blob);

  // Create image element and wait for it to load
  const img = new Image();
  img.src = url;

  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
  });

  // Store in cache
  imageCache.set(imageId, img);

  // Calculate position (center of visible area)
  const rect = annotationCanvas.getBoundingClientRect();
  const scrollX = pdfContainer.scrollLeft;
  const scrollY = pdfContainer.scrollTop;

  // Default size (max 400px, maintain aspect ratio)
  let width = img.naturalWidth;
  let height = img.naturalHeight;
  const maxSize = 400;

  if (width > maxSize || height > maxSize) {
    const ratio = Math.min(maxSize / width, maxSize / height);
    width *= ratio;
    height *= ratio;
  }

  const x = scrollX + (rect.width / 2) - (width / 2);
  const y = scrollY + (rect.height / 2) - (height / 2);

  // Create image annotation
  const annotation = {
    type: 'image',
    page: currentPage,
    x: Math.max(10, x),
    y: Math.max(10, y),
    width: width,
    height: height,
    rotation: 0,
    imageId: imageId,
    imageData: url, // Keep URL for potential serialization
    originalWidth: img.naturalWidth,
    originalHeight: img.naturalHeight,
    opacity: 1,
    locked: false,
    printable: true,
    author: defaultAuthor,
    subject: '',
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString()
  };

  annotations.push(annotation);
  selectedAnnotation = annotation;
  showProperties(annotation);

  if (viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }

  updateStatusMessage('Image pasted');
}

// Paste annotation from internal clipboard
function pasteAnnotation() {
  if (!clipboardAnnotation || !pdfDoc) return;

  const newAnnotation = cloneAnnotation(clipboardAnnotation);

  // Offset position slightly so it's visible
  if (newAnnotation.x !== undefined) newAnnotation.x += 20;
  if (newAnnotation.y !== undefined) newAnnotation.y += 20;
  if (newAnnotation.startX !== undefined) newAnnotation.startX += 20;
  if (newAnnotation.startY !== undefined) newAnnotation.startY += 20;
  if (newAnnotation.endX !== undefined) newAnnotation.endX += 20;
  if (newAnnotation.endY !== undefined) newAnnotation.endY += 20;
  if (newAnnotation.centerX !== undefined) newAnnotation.centerX += 20;
  if (newAnnotation.centerY !== undefined) newAnnotation.centerY += 20;
  if (newAnnotation.path) {
    newAnnotation.path = newAnnotation.path.map(p => ({ x: p.x + 20, y: p.y + 20 }));
  }

  // Update page and timestamps
  newAnnotation.page = currentPage;
  newAnnotation.createdAt = new Date().toISOString();
  newAnnotation.modifiedAt = new Date().toISOString();

  // For images, need to copy the cached image
  if (newAnnotation.type === 'image') {
    const newImageId = generateImageId();
    const originalImg = imageCache.get(clipboardAnnotation.imageId);
    if (originalImg) {
      imageCache.set(newImageId, originalImg);
    }
    newAnnotation.imageId = newImageId;
  }

  annotations.push(newAnnotation);
  selectedAnnotation = newAnnotation;
  showProperties(newAnnotation);

  if (viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }

  updateStatusMessage('Annotation pasted');
}

// Snap angle to nearest multiple of snapDegrees
function snapAngle(angle, snapDegrees) {
  const snapped = Math.round(angle / snapDegrees) * snapDegrees;
  return snapped;
}

// Apply resize based on handle being dragged
function applyResize(annotation, handleType, deltaX, deltaY, originalAnn, shiftKey = false) {
  if (annotation.locked) return;

  switch (annotation.type) {
    case 'box':
    case 'circle':
    case 'highlight':
    case 'polygon':
    case 'cloud':
    case 'textbox':
      switch (handleType) {
        case HANDLE_TYPES.TOP_LEFT:
          annotation.x = originalAnn.x + deltaX;
          annotation.y = originalAnn.y + deltaY;
          annotation.width = originalAnn.width - deltaX;
          annotation.height = originalAnn.height - deltaY;
          break;
        case HANDLE_TYPES.TOP_RIGHT:
          annotation.y = originalAnn.y + deltaY;
          annotation.width = originalAnn.width + deltaX;
          annotation.height = originalAnn.height - deltaY;
          break;
        case HANDLE_TYPES.BOTTOM_LEFT:
          annotation.x = originalAnn.x + deltaX;
          annotation.width = originalAnn.width - deltaX;
          annotation.height = originalAnn.height + deltaY;
          break;
        case HANDLE_TYPES.BOTTOM_RIGHT:
          annotation.width = originalAnn.width + deltaX;
          annotation.height = originalAnn.height + deltaY;
          break;
        case HANDLE_TYPES.TOP:
          annotation.y = originalAnn.y + deltaY;
          annotation.height = originalAnn.height - deltaY;
          break;
        case HANDLE_TYPES.BOTTOM:
          annotation.height = originalAnn.height + deltaY;
          break;
        case HANDLE_TYPES.LEFT:
          annotation.x = originalAnn.x + deltaX;
          annotation.width = originalAnn.width - deltaX;
          break;
        case HANDLE_TYPES.RIGHT:
          annotation.width = originalAnn.width + deltaX;
          break;
      }
      // Ensure minimum size
      if (annotation.width < 10) annotation.width = 10;
      if (annotation.height < 10) annotation.height = 10;
      break;

    case 'callout':
      // Initialize width/height if not set
      if (!originalAnn.width) originalAnn.width = 150;
      if (!originalAnn.height) originalAnn.height = 50;

      switch (handleType) {
        case HANDLE_TYPES.TOP_LEFT:
          annotation.x = originalAnn.x + deltaX;
          annotation.y = originalAnn.y + deltaY;
          annotation.width = originalAnn.width - deltaX;
          annotation.height = originalAnn.height - deltaY;
          break;
        case HANDLE_TYPES.TOP_RIGHT:
          annotation.y = originalAnn.y + deltaY;
          annotation.width = originalAnn.width + deltaX;
          annotation.height = originalAnn.height - deltaY;
          break;
        case HANDLE_TYPES.BOTTOM_LEFT:
          annotation.x = originalAnn.x + deltaX;
          annotation.width = originalAnn.width - deltaX;
          annotation.height = originalAnn.height + deltaY;
          break;
        case HANDLE_TYPES.BOTTOM_RIGHT:
          annotation.width = originalAnn.width + deltaX;
          annotation.height = originalAnn.height + deltaY;
          break;
        case HANDLE_TYPES.CALLOUT_ARROW:
          // Move arrow tip
          annotation.arrowX = (originalAnn.arrowX || originalAnn.x - 60) + deltaX;
          annotation.arrowY = (originalAnn.arrowY || originalAnn.y + originalAnn.height) + deltaY;
          break;
        case HANDLE_TYPES.CALLOUT_KNEE:
          // Move knee point
          annotation.kneeX = (originalAnn.kneeX || originalAnn.x - 30) + deltaX;
          annotation.kneeY = (originalAnn.kneeY || originalAnn.y + originalAnn.height / 2) + deltaY;
          break;
      }
      // Ensure minimum size
      if (annotation.width < 50) annotation.width = 50;
      if (annotation.height < 30) annotation.height = 30;
      break;

    case 'line':
      if (handleType === HANDLE_TYPES.LINE_START) {
        let newStartX = originalAnn.startX + deltaX;
        let newStartY = originalAnn.startY + deltaY;

        // Snap to angle increments when Shift is held (and angle snapping is enabled)
        if (shiftKey && preferences.enableAngleSnap) {
          const fixedX = originalAnn.endX;
          const fixedY = originalAnn.endY;
          const dx = newStartX - fixedX;
          const dy = newStartY - fixedY;
          const length = Math.sqrt(dx * dx + dy * dy);
          const currentAngle = Math.atan2(dy, dx) * (180 / Math.PI);
          const snappedAngle = snapAngle(currentAngle, preferences.angleSnapDegrees) * (Math.PI / 180);
          newStartX = fixedX + length * Math.cos(snappedAngle);
          newStartY = fixedY + length * Math.sin(snappedAngle);
        }

        annotation.startX = newStartX;
        annotation.startY = newStartY;
      } else if (handleType === HANDLE_TYPES.LINE_END) {
        let newEndX = originalAnn.endX + deltaX;
        let newEndY = originalAnn.endY + deltaY;

        // Snap to angle increments when Shift is held (and angle snapping is enabled)
        if (shiftKey && preferences.enableAngleSnap) {
          const fixedX = originalAnn.startX;
          const fixedY = originalAnn.startY;
          const dx = newEndX - fixedX;
          const dy = newEndY - fixedY;
          const length = Math.sqrt(dx * dx + dy * dy);
          const currentAngle = Math.atan2(dy, dx) * (180 / Math.PI);
          const snappedAngle = snapAngle(currentAngle, preferences.angleSnapDegrees) * (Math.PI / 180);
          newEndX = fixedX + length * Math.cos(snappedAngle);
          newEndY = fixedY + length * Math.sin(snappedAngle);
        }

        annotation.endX = newEndX;
        annotation.endY = newEndY;
      }
      break;

    case 'draw':
      // Scale the path based on bounding box resize
      if (originalAnn.path && originalAnn.path.length > 0) {
        const minX = Math.min(...originalAnn.path.map(p => p.x));
        const minY = Math.min(...originalAnn.path.map(p => p.y));
        const maxX = Math.max(...originalAnn.path.map(p => p.x));
        const maxY = Math.max(...originalAnn.path.map(p => p.y));
        const origWidth = maxX - minX || 1;
        const origHeight = maxY - minY || 1;

        let newMinX = minX, newMinY = minY, newMaxX = maxX, newMaxY = maxY;

        switch (handleType) {
          case HANDLE_TYPES.TOP_LEFT:
            newMinX = minX + deltaX;
            newMinY = minY + deltaY;
            break;
          case HANDLE_TYPES.TOP_RIGHT:
            newMaxX = maxX + deltaX;
            newMinY = minY + deltaY;
            break;
          case HANDLE_TYPES.BOTTOM_LEFT:
            newMinX = minX + deltaX;
            newMaxY = maxY + deltaY;
            break;
          case HANDLE_TYPES.BOTTOM_RIGHT:
            newMaxX = maxX + deltaX;
            newMaxY = maxY + deltaY;
            break;
        }

        const newWidth = newMaxX - newMinX || 1;
        const newHeight = newMaxY - newMinY || 1;
        const scaleX = newWidth / origWidth;
        const scaleY = newHeight / origHeight;

        annotation.path = originalAnn.path.map(p => ({
          x: newMinX + (p.x - minX) * scaleX,
          y: newMinY + (p.y - minY) * scaleY
        }));
      }
      break;

    case 'polyline':
      // Scale the points based on bounding box resize
      if (originalAnn.points && originalAnn.points.length > 0) {
        const plMinX = Math.min(...originalAnn.points.map(p => p.x));
        const plMinY = Math.min(...originalAnn.points.map(p => p.y));
        const plMaxX = Math.max(...originalAnn.points.map(p => p.x));
        const plMaxY = Math.max(...originalAnn.points.map(p => p.y));
        const plOrigWidth = plMaxX - plMinX || 1;
        const plOrigHeight = plMaxY - plMinY || 1;

        let plNewMinX = plMinX, plNewMinY = plMinY, plNewMaxX = plMaxX, plNewMaxY = plMaxY;

        switch (handleType) {
          case HANDLE_TYPES.TOP_LEFT:
            plNewMinX = plMinX + deltaX;
            plNewMinY = plMinY + deltaY;
            break;
          case HANDLE_TYPES.TOP_RIGHT:
            plNewMaxX = plMaxX + deltaX;
            plNewMinY = plMinY + deltaY;
            break;
          case HANDLE_TYPES.BOTTOM_LEFT:
            plNewMinX = plMinX + deltaX;
            plNewMaxY = plMaxY + deltaY;
            break;
          case HANDLE_TYPES.BOTTOM_RIGHT:
            plNewMaxX = plMaxX + deltaX;
            plNewMaxY = plMaxY + deltaY;
            break;
        }

        const plNewWidth = plNewMaxX - plNewMinX || 1;
        const plNewHeight = plNewMaxY - plNewMinY || 1;
        const plScaleX = plNewWidth / plOrigWidth;
        const plScaleY = plNewHeight / plOrigHeight;

        annotation.points = originalAnn.points.map(p => ({
          x: plNewMinX + (p.x - plMinX) * plScaleX,
          y: plNewMinY + (p.y - plMinY) * plScaleY
        }));
      }
      break;

    case 'image':
      // Maintain aspect ratio when shift is held
      const aspectRatio = originalAnn.originalWidth / originalAnn.originalHeight;

      switch (handleType) {
        case HANDLE_TYPES.TOP_LEFT:
          if (shiftKey) {
            // Maintain aspect ratio
            const newWidth = originalAnn.width - deltaX;
            const newHeight = newWidth / aspectRatio;
            annotation.x = originalAnn.x + originalAnn.width - newWidth;
            annotation.y = originalAnn.y + originalAnn.height - newHeight;
            annotation.width = newWidth;
            annotation.height = newHeight;
          } else {
            annotation.x = originalAnn.x + deltaX;
            annotation.y = originalAnn.y + deltaY;
            annotation.width = originalAnn.width - deltaX;
            annotation.height = originalAnn.height - deltaY;
          }
          break;
        case HANDLE_TYPES.TOP_RIGHT:
          if (shiftKey) {
            const newWidth = originalAnn.width + deltaX;
            const newHeight = newWidth / aspectRatio;
            annotation.y = originalAnn.y + originalAnn.height - newHeight;
            annotation.width = newWidth;
            annotation.height = newHeight;
          } else {
            annotation.y = originalAnn.y + deltaY;
            annotation.width = originalAnn.width + deltaX;
            annotation.height = originalAnn.height - deltaY;
          }
          break;
        case HANDLE_TYPES.BOTTOM_LEFT:
          if (shiftKey) {
            const newWidth = originalAnn.width - deltaX;
            const newHeight = newWidth / aspectRatio;
            annotation.x = originalAnn.x + originalAnn.width - newWidth;
            annotation.width = newWidth;
            annotation.height = newHeight;
          } else {
            annotation.x = originalAnn.x + deltaX;
            annotation.width = originalAnn.width - deltaX;
            annotation.height = originalAnn.height + deltaY;
          }
          break;
        case HANDLE_TYPES.BOTTOM_RIGHT:
          if (shiftKey) {
            const newWidth = originalAnn.width + deltaX;
            const newHeight = newWidth / aspectRatio;
            annotation.width = newWidth;
            annotation.height = newHeight;
          } else {
            annotation.width = originalAnn.width + deltaX;
            annotation.height = originalAnn.height + deltaY;
          }
          break;
        case HANDLE_TYPES.TOP:
          annotation.y = originalAnn.y + deltaY;
          annotation.height = originalAnn.height - deltaY;
          break;
        case HANDLE_TYPES.BOTTOM:
          annotation.height = originalAnn.height + deltaY;
          break;
        case HANDLE_TYPES.LEFT:
          annotation.x = originalAnn.x + deltaX;
          annotation.width = originalAnn.width - deltaX;
          break;
        case HANDLE_TYPES.RIGHT:
          annotation.width = originalAnn.width + deltaX;
          break;
      }
      // Ensure minimum size
      if (annotation.width < 20) annotation.width = 20;
      if (annotation.height < 20) annotation.height = 20;
      break;

    case 'comment':
      // Initialize width/height if not set
      if (!originalAnn.width) originalAnn.width = 24;
      if (!originalAnn.height) originalAnn.height = 24;

      switch (handleType) {
        case HANDLE_TYPES.TOP_LEFT:
          annotation.x = originalAnn.x + deltaX;
          annotation.y = originalAnn.y + deltaY;
          annotation.width = originalAnn.width - deltaX;
          annotation.height = originalAnn.height - deltaY;
          break;
        case HANDLE_TYPES.TOP_RIGHT:
          annotation.y = originalAnn.y + deltaY;
          annotation.width = originalAnn.width + deltaX;
          annotation.height = originalAnn.height - deltaY;
          break;
        case HANDLE_TYPES.BOTTOM_LEFT:
          annotation.x = originalAnn.x + deltaX;
          annotation.width = originalAnn.width - deltaX;
          annotation.height = originalAnn.height + deltaY;
          break;
        case HANDLE_TYPES.BOTTOM_RIGHT:
          annotation.width = originalAnn.width + deltaX;
          annotation.height = originalAnn.height + deltaY;
          break;
        case HANDLE_TYPES.TOP:
          annotation.y = originalAnn.y + deltaY;
          annotation.height = originalAnn.height - deltaY;
          break;
        case HANDLE_TYPES.BOTTOM:
          annotation.height = originalAnn.height + deltaY;
          break;
        case HANDLE_TYPES.LEFT:
          annotation.x = originalAnn.x + deltaX;
          annotation.width = originalAnn.width - deltaX;
          break;
        case HANDLE_TYPES.RIGHT:
          annotation.width = originalAnn.width + deltaX;
          break;
      }
      // Ensure minimum size
      if (annotation.width < 20) annotation.width = 20;
      if (annotation.height < 20) annotation.height = 20;
      break;
  }

  annotation.modifiedAt = new Date().toISOString();
}

// Apply move to annotation
function applyMove(annotation, deltaX, deltaY) {
  if (annotation.locked) return;

  switch (annotation.type) {
    case 'box':
    case 'highlight':
    case 'polygon':
    case 'cloud':
    case 'textbox':
      annotation.x += deltaX;
      annotation.y += deltaY;
      break;

    case 'callout':
      // Move the text box
      annotation.x += deltaX;
      annotation.y += deltaY;
      // Also move the callout arm points
      if (annotation.arrowX !== undefined) annotation.arrowX += deltaX;
      if (annotation.arrowY !== undefined) annotation.arrowY += deltaY;
      if (annotation.kneeX !== undefined) annotation.kneeX += deltaX;
      if (annotation.kneeY !== undefined) annotation.kneeY += deltaY;
      if (annotation.armOriginX !== undefined) annotation.armOriginX += deltaX;
      if (annotation.armOriginY !== undefined) annotation.armOriginY += deltaY;
      break;

    case 'circle':
      // Support both old (centerX/centerY) and new (x/y) model
      if (annotation.x !== undefined) {
        annotation.x += deltaX;
        annotation.y += deltaY;
      } else {
        annotation.centerX += deltaX;
        annotation.centerY += deltaY;
      }
      break;

    case 'line':
      annotation.startX += deltaX;
      annotation.startY += deltaY;
      annotation.endX += deltaX;
      annotation.endY += deltaY;
      break;

    case 'comment':
    case 'text':
      annotation.x += deltaX;
      annotation.y += deltaY;
      break;

    case 'draw':
      if (annotation.path) {
        annotation.path = annotation.path.map(p => ({
          x: p.x + deltaX,
          y: p.y + deltaY
        }));
      }
      break;

    case 'polyline':
      if (annotation.points) {
        annotation.points = annotation.points.map(p => ({
          x: p.x + deltaX,
          y: p.y + deltaY
        }));
      }
      break;

    case 'image':
      annotation.x += deltaX;
      annotation.y += deltaY;
      break;
  }

  annotation.modifiedAt = new Date().toISOString();
}

// Apply rotation to annotation
function applyRotation(annotation, mouseX, mouseY, originalAnn) {
  if (annotation.locked) return;
  if (annotation.type !== 'image' && annotation.type !== 'comment') return;

  // Calculate center of annotation
  const width = originalAnn.width || 24;
  const height = originalAnn.height || 24;
  const centerX = originalAnn.x + width / 2;
  const centerY = originalAnn.y + height / 2;

  // Calculate angle from center to mouse position
  const angle = Math.atan2(mouseY - centerY, mouseX - centerX) * (180 / Math.PI);

  // Adjust angle (rotation handle is at top, so add 90 degrees)
  annotation.rotation = angle + 90;

  // Snap to 15 degree increments when shift is held
  if (window.shiftKeyPressed && preferences.enableAngleSnap) {
    annotation.rotation = snapAngle(annotation.rotation, preferences.angleSnapDegrees);
  }

  annotation.modifiedAt = new Date().toISOString();
}

// Canvas contexts
const pdfCtx = pdfCanvas.getContext('2d');
const annotationCtx = annotationCanvas.getContext('2d');

// Load and render PDF
// Load existing annotations from PDF
async function loadExistingAnnotations() {
  if (!pdfDoc) return;

  // Clear existing annotations
  annotations = [];

  // Helper to convert PDF color to hex
  // PDF.js can return colors as:
  // - Array [r, g, b] with values 0-1
  // - Uint8ClampedArray with values 0-255
  // - null/undefined
  const colorToHex = (colorArr, defaultColor = '#000000') => {
    if (!colorArr || !colorArr.length) return defaultColor;

    // Check if values are in 0-1 range or 0-255 range
    const isNormalized = colorArr[0] <= 1 && colorArr[1] <= 1 && colorArr[2] <= 1;

    let r, g, b;
    if (isNormalized) {
      r = Math.round(colorArr[0] * 255);
      g = Math.round(colorArr[1] * 255);
      b = Math.round(colorArr[2] * 255);
    } else {
      r = Math.round(colorArr[0]);
      g = Math.round(colorArr[1]);
      b = Math.round(colorArr[2]);
    }

    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  };

  // Process each page
  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const pageAnnotations = await page.getAnnotations();
    const viewport = page.getViewport({ scale: 1 }); // Get unscaled viewport for coordinate conversion
    const pageHeight = viewport.height;

    for (const ann of pageAnnotations) {
      // Debug: log the raw annotation data from pdf.js
      console.log('PDF.js annotation:', ann.subtype, JSON.stringify({
        rect: ann.rect,
        color: ann.color ? Array.from(ann.color) : null,
        interiorColor: ann.interiorColor ? Array.from(ann.interiorColor) : null,
        borderStyle: ann.borderStyle,
        opacity: ann.opacity,
        annotationType: ann.annotationType,
        lineCoordinates: ann.lineCoordinates,
        inkLists: ann.inkLists,
        vertices: ann.vertices
      }, null, 2));

      // Skip unsupported annotation types (like Link, Widget, etc.)
      if (!ann.subtype) continue;

      // Skip Link and Widget annotations as they're not markup annotations
      if (ann.subtype === 'Link' || ann.subtype === 'Widget') continue;

      // Convert PDF Y (from bottom) to canvas Y (from top)
      const convertY = (y) => pageHeight - y;

      // Get rect coordinates
      const rect = ann.rect || [0, 0, 0, 0];
      const x = rect[0];
      const y = convertY(rect[3]); // rect[3] is top in PDF coords
      const width = rect[2] - rect[0];
      const height = rect[3] - rect[1];

      // Get colors - pdf.js may use different property names
      // Try multiple possible property names for stroke color
      const rawStrokeColor = ann.color || ann.borderColor || ann.strokeColor;
      const strokeColor = colorToHex(rawStrokeColor, '#ff0000'); // Default to red if no color

      // Try multiple possible property names for fill/interior color
      const rawFillColor = ann.interiorColor || ann.backgroundColor || ann.fillColor;
      const fillColor = rawFillColor ? colorToHex(rawFillColor, 'none') : 'none';

      // Get border width - try multiple sources
      const borderWidth = ann.borderStyle?.width || ann.borderWidth || ann.width || 2;

      // Get opacity
      const opacity = ann.opacity !== undefined ? ann.opacity : 1;

      // Get contents/text
      const contents = ann.contentsObj?.str || ann.contents || '';

      // Create base annotation object
      let appAnnotation = null;

      switch (ann.subtype) {
        case 'Highlight':
        case 'Underline':
        case 'StrikeOut':
          // Highlight-type annotations
          if (ann.quadPoints && ann.quadPoints.length >= 8) {
            // Convert quadPoints to rects
            const rects = [];
            for (let i = 0; i < ann.quadPoints.length; i += 8) {
              const qp = ann.quadPoints.slice(i, i + 8);
              // QuadPoints: [x1,y1, x2,y2, x3,y3, x4,y4] - corners
              const qx = Math.min(qp[0], qp[2], qp[4], qp[6]);
              const qy = Math.min(qp[1], qp[3], qp[5], qp[7]);
              const qw = Math.max(qp[0], qp[2], qp[4], qp[6]) - qx;
              const qh = Math.max(qp[1], qp[3], qp[5], qp[7]) - qy;
              rects.push({
                x: qx,
                y: convertY(qy + qh),
                width: qw,
                height: qh
              });
            }
            appAnnotation = createAnnotation({
              type: 'highlight',
              page: pageNum,
              x: x,
              y: y,
              width: width,
              height: height,
              rects: rects,
              color: strokeColor,
              opacity: ann.opacity || 0.5
            });
          } else {
            appAnnotation = createAnnotation({
              type: 'highlight',
              page: pageNum,
              x: x,
              y: y,
              width: width,
              height: height,
              color: strokeColor,
              opacity: ann.opacity || 0.5
            });
          }
          break;

        case 'Square':
          appAnnotation = createAnnotation({
            type: 'box',
            page: pageNum,
            x: x,
            y: y,
            width: width,
            height: height,
            color: strokeColor,  // For compatibility
            strokeColor: strokeColor,
            fillColor: fillColor,
            lineWidth: borderWidth,
            borderWidth: borderWidth,  // For compatibility
            opacity: opacity
          });
          console.log('Loaded Square annotation:', { x, y, width, height, strokeColor, fillColor, borderWidth, opacity });
          break;

        case 'Circle':
          appAnnotation = createAnnotation({
            type: 'circle',
            page: pageNum,
            x: x,
            y: y,
            width: width,
            height: height,
            color: strokeColor,  // For compatibility
            strokeColor: strokeColor,
            fillColor: fillColor,
            lineWidth: borderWidth,
            borderWidth: borderWidth,  // For compatibility
            opacity: opacity
          });
          console.log('Loaded Circle annotation:', { x, y, width, height, strokeColor, fillColor, borderWidth, opacity });
          break;

        case 'Line':
          // Line annotations have lineCoordinates [x1, y1, x2, y2]
          const lineCoords = ann.lineCoordinates || [rect[0], rect[1], rect[2], rect[3]];
          appAnnotation = createAnnotation({
            type: 'line',
            page: pageNum,
            startX: lineCoords[0],
            startY: convertY(lineCoords[1]),
            endX: lineCoords[2],
            endY: convertY(lineCoords[3]),
            strokeColor: strokeColor,
            lineWidth: borderWidth,
            opacity: opacity
          });
          break;

        case 'Ink':
          // Ink annotations have inkLists (array of arrays of points)
          if (ann.inkLists && ann.inkLists.length > 0) {
            const points = [];
            for (const inkList of ann.inkLists) {
              for (let i = 0; i < inkList.length; i += 2) {
                points.push({
                  x: inkList[i],
                  y: convertY(inkList[i + 1])
                });
              }
            }
            appAnnotation = createAnnotation({
              type: 'draw',
              page: pageNum,
              points: points,
              path: points, // For rendering
              strokeColor: strokeColor,
              lineWidth: borderWidth,
              opacity: opacity
            });
          }
          break;

        case 'PolyLine':
          // PolyLine annotations have vertices
          if (ann.vertices && ann.vertices.length >= 4) {
            const points = [];
            for (let i = 0; i < ann.vertices.length; i += 2) {
              points.push({
                x: ann.vertices[i],
                y: convertY(ann.vertices[i + 1])
              });
            }
            appAnnotation = createAnnotation({
              type: 'polyline',
              page: pageNum,
              points: points,
              strokeColor: strokeColor,
              lineWidth: borderWidth,
              opacity: opacity
            });
          }
          break;

        case 'Polygon':
          // Polygon annotations have vertices
          if (ann.vertices && ann.vertices.length >= 6) {
            const points = [];
            for (let i = 0; i < ann.vertices.length; i += 2) {
              points.push({
                x: ann.vertices[i],
                y: convertY(ann.vertices[i + 1])
              });
            }
            appAnnotation = createAnnotation({
              type: 'polygon',
              page: pageNum,
              points: points,
              strokeColor: strokeColor,
              fillColor: fillColor,
              lineWidth: borderWidth,
              opacity: opacity
            });
          }
          break;

        case 'FreeText':
          appAnnotation = createAnnotation({
            type: 'textbox',
            page: pageNum,
            x: x,
            y: y,
            width: width,
            height: height,
            text: contents,
            strokeColor: strokeColor,
            fillColor: fillColor,
            textColor: strokeColor,
            fontSize: ann.fontSize || 12,
            opacity: opacity
          });
          break;

        case 'Text':
          // Sticky note / comment annotation
          appAnnotation = createAnnotation({
            type: 'comment',
            page: pageNum,
            x: x,
            y: y,
            text: contents,
            comment: contents,
            color: strokeColor || '#FFFF00',
            opacity: opacity
          });
          break;

        // Skip other annotation types (Link, Widget, etc.)
        default:
          console.log('Skipping unsupported annotation type:', ann.subtype);
          continue;
      }

      if (appAnnotation) {
        // Preserve original annotation data for reference
        appAnnotation.pdfAnnotationId = ann.id;
        appAnnotation.author = ann.titleObj?.str || ann.title || 'Unknown';
        appAnnotation.subject = ann.subjectObj?.str || ann.subject || '';
        appAnnotation.createdDate = ann.creationDate || new Date().toISOString();
        appAnnotation.modifiedDate = ann.modificationDate || new Date().toISOString();

        annotations.push(appAnnotation);
        console.log('Loaded annotation:', appAnnotation.type, 'on page', pageNum);
      }
    }
  }

  console.log('Total annotations loaded:', annotations.length);
}

async function loadPDF(filePath) {
  showLoading('Opening PDF...');
  try {
    console.log('Loading PDF from:', filePath);
    currentPdfPath = filePath; // Store path for saving
    const data = new Uint8Array(fs.readFileSync(filePath));
    console.log('PDF data loaded, size:', data.length);

    pdfDoc = await pdfjsLib.getDocument({ data }).promise;
    console.log('PDF document loaded, pages:', pdfDoc.numPages);

    // Load existing annotations from PDF
    await loadExistingAnnotations();

    // Show UI elements
    placeholder.style.display = 'none';
    pdfContainer.classList.add('visible');

    // Display file name
    const fileName = path.basename(filePath);
    fileInfo.textContent = `${fileName}`;

    // Render first page
    await renderPage(currentPage);

    // Show annotations list panel if there are annotations
    if (annotations.length > 0) {
      showAnnotationsListPanel();
    }
  } catch (error) {
    console.error('Error loading PDF:', error);
    alert('Failed to load PDF file: ' + error.message);
  } finally {
    hideLoading();
  }
}

// Save PDF with annotations as proper PDF annotation objects (editable in other software)
async function savePDF(saveAsPath = null) {
  if (!currentPdfPath && !saveAsPath) {
    alert('No PDF loaded');
    return;
  }

  showLoading('Saving PDF...');
  try {
    // Load the original PDF
    const existingPdfBytes = fs.readFileSync(currentPdfPath);
    const pdfDocLib = await PDFDocument.load(existingPdfBytes);
    const pages = pdfDocLib.getPages();
    const context = pdfDocLib.context;

    // Helper to convert hex color to array [r, g, b] (0-1 range)
    const hexToColorArray = (hex) => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result ? [
        parseInt(result[1], 16) / 255,
        parseInt(result[2], 16) / 255,
        parseInt(result[3], 16) / 255
      ] : [0, 0, 0];
    };

    // Helper to create a PDFName
    const PDFName = window.require('pdf-lib').PDFName;
    const PDFArray = window.require('pdf-lib').PDFArray;
    const PDFNumber = window.require('pdf-lib').PDFNumber;
    const PDFString = window.require('pdf-lib').PDFString;
    const PDFDict = window.require('pdf-lib').PDFDict;

    // Process annotations for each page
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      const page = pages[pageIndex];
      const pageNum = pageIndex + 1;

      // Get annotations for this page
      const pageAnnotations = annotations.filter(a => a.page === pageNum);
      if (pageAnnotations.length === 0) continue;

      // IMPORTANT: Use pdf.js viewport to get page dimensions (same as when annotations were created)
      // This ensures coordinate systems match, especially for pages with different sizes or rotations
      const pdfJsPage = await pdfDoc.getPage(pageNum);
      const viewport = pdfJsPage.getViewport({ scale: 1 });
      const pageHeight = viewport.height;

      // Annotation coordinates are already in PDF points (they were divided by scale when stored)
      // No additional scaling needed - use coordinates directly

      // Convert Y coordinate (canvas Y is from top, PDF Y is from bottom)
      const convertY = (y) => pageHeight - y;

      // Get existing annotations array or create new one
      const pageDict = page.node;
      let annotsArray = pageDict.lookup(PDFName.of('Annots'));
      if (!annotsArray) {
        annotsArray = context.obj([]);
        pageDict.set(PDFName.of('Annots'), annotsArray);
      }

      for (const ann of pageAnnotations) {
        const colorArr = hexToColorArray(ann.color || ann.strokeColor || '#000000');
        const opacity = ann.opacity !== undefined ? ann.opacity : 1;
        const borderWidth = ann.lineWidth || ann.borderWidth || 2;

        let annotDict = null;

        switch (ann.type) {
          case 'highlight': {
            // Highlight annotation
            let x1, y1, x2, y2;
            let quadPoints = [];

            if (ann.rects && ann.rects.length > 0) {
              // Multiple rects
              x1 = Infinity; y1 = Infinity; x2 = -Infinity; y2 = -Infinity;
              for (const rect of ann.rects) {
                const rx1 = rect.x;
                const ry1 = convertY(rect.y + rect.height);
                const rx2 = rect.x + rect.width;
                const ry2 = convertY(rect.y);
                x1 = Math.min(x1, rx1); y1 = Math.min(y1, ry1);
                x2 = Math.max(x2, rx2); y2 = Math.max(y2, ry2);
                // QuadPoints: x1,y2, x2,y2, x1,y1, x2,y1 (counter-clockwise from bottom-left)
                quadPoints.push(rx1, ry2, rx2, ry2, rx1, ry1, rx2, ry1);
              }
            } else {
              x1 = ann.x;
              y1 = convertY(ann.y + ann.height);
              x2 = ann.x + ann.width;
              y2 = convertY(ann.y);
              quadPoints = [x1, y2, x2, y2, x1, y1, x2, y1];
            }

            const highlightColor = hexToColorArray(ann.color || '#FFFF00');
            annotDict = context.obj({
              Type: 'Annot',
              Subtype: 'Highlight',
              Rect: [x1, y1, x2, y2],
              QuadPoints: quadPoints,
              C: highlightColor,
              CA: ann.opacity || 0.5,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of(ann.subject || ''),
              M: PDFString.of(new Date().toISOString()),
              F: 4 // Print flag
            });
            break;
          }

          case 'box': {
            // Square annotation
            // Expand Rect by half border width so border draws centered on the boundary
            const halfBorder = borderWidth / 2;
            const x1 = Math.min(ann.x, ann.x + ann.width) - halfBorder;
            const y1 = convertY(Math.max(ann.y, ann.y + ann.height)) - halfBorder;
            const x2 = Math.max(ann.x, ann.x + ann.width) + halfBorder;
            const y2 = convertY(Math.min(ann.y, ann.y + ann.height)) + halfBorder;

            // Stroke color: use strokeColor if available, otherwise use color
            const strokeColorArr = ann.strokeColor ? hexToColorArray(ann.strokeColor) : colorArr;

            const annDictObj = {
              Type: 'Annot',
              Subtype: 'Square',
              Rect: [x1, y1, x2, y2],
              C: strokeColorArr,  // C is for stroke/border color
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of(ann.subject || ''),
              M: PDFString.of(new Date().toISOString()),
              F: 4
            };

            // Use BS (Border Style) dictionary instead of Border array
            annDictObj.BS = context.obj({
              Type: 'Border',
              W: borderWidth,
              S: 'S'  // S = Solid, D = Dashed
            });

            // Add interior color (fill) if specified - IC is for fill color
            if (ann.fillColor && ann.fillColor !== 'none') {
              annDictObj.IC = hexToColorArray(ann.fillColor);
            }

            annotDict = context.obj(annDictObj);
            break;
          }

          case 'circle': {
            // Circle annotation
            // Expand Rect by half border width so border draws centered on the boundary
            const halfBorder = borderWidth / 2;
            const x1 = ann.x - halfBorder;
            const y1 = convertY(ann.y + ann.height) - halfBorder;
            const x2 = ann.x + ann.width + halfBorder;
            const y2 = convertY(ann.y) + halfBorder;

            // Stroke color: use strokeColor if available, otherwise use color
            const strokeColorArr = ann.strokeColor ? hexToColorArray(ann.strokeColor) : colorArr;

            const annDictObj = {
              Type: 'Annot',
              Subtype: 'Circle',
              Rect: [x1, y1, x2, y2],
              C: strokeColorArr,  // C is for stroke/border color
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of(ann.subject || ''),
              M: PDFString.of(new Date().toISOString()),
              F: 4
            };

            // Use BS (Border Style) dictionary instead of Border array
            annDictObj.BS = context.obj({
              Type: 'Border',
              W: borderWidth,
              S: 'S'  // S = Solid
            });

            // Add interior color (fill) if specified - IC is for fill color
            if (ann.fillColor && ann.fillColor !== 'none') {
              annDictObj.IC = hexToColorArray(ann.fillColor);
            }

            annotDict = context.obj(annDictObj);
            break;
          }

          case 'line': {
            // Line annotation
            const x1 = ann.startX;
            const y1 = convertY(ann.startY);
            const x2 = ann.endX;
            const y2 = convertY(ann.endY);

            const rectX1 = Math.min(x1, x2) - borderWidth;
            const rectY1 = Math.min(y1, y2) - borderWidth;
            const rectX2 = Math.max(x1, x2) + borderWidth;
            const rectY2 = Math.max(y1, y2) + borderWidth;

            // Stroke color: use strokeColor if available, otherwise use color
            const strokeColorArr = ann.strokeColor ? hexToColorArray(ann.strokeColor) : colorArr;

            const lineDict = {
              Type: 'Annot',
              Subtype: 'Line',
              Rect: [rectX1, rectY1, rectX2, rectY2],
              L: [x1, y1, x2, y2],
              C: strokeColorArr,
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of(ann.subject || ''),
              M: PDFString.of(new Date().toISOString()),
              F: 4
            };

            // Use BS (Border Style) dictionary
            lineDict.BS = context.obj({
              Type: 'Border',
              W: borderWidth,
              S: 'S'
            });

            annotDict = context.obj(lineDict);
            break;
          }

          case 'draw': {
            // Ink annotation (freehand drawing)
            if (!ann.points || ann.points.length < 2) continue;

            const inkList = [];
            for (const pt of ann.points) {
              inkList.push(pt.x);
              inkList.push(convertY(pt.y));
            }

            // Calculate bounding rect
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (let i = 0; i < inkList.length; i += 2) {
              minX = Math.min(minX, inkList[i]);
              maxX = Math.max(maxX, inkList[i]);
              minY = Math.min(minY, inkList[i + 1]);
              maxY = Math.max(maxY, inkList[i + 1]);
            }

            // Stroke color
            const strokeColorArr = ann.strokeColor ? hexToColorArray(ann.strokeColor) : colorArr;

            const inkDict = {
              Type: 'Annot',
              Subtype: 'Ink',
              Rect: [minX - borderWidth, minY - borderWidth, maxX + borderWidth, maxY + borderWidth],
              InkList: [inkList],
              C: strokeColorArr,
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of(ann.subject || ''),
              M: PDFString.of(new Date().toISOString()),
              F: 4
            };

            // Use BS (Border Style) dictionary
            inkDict.BS = context.obj({
              Type: 'Border',
              W: borderWidth,
              S: 'S'
            });

            annotDict = context.obj(inkDict);
            break;
          }

          case 'polyline': {
            // PolyLine annotation
            if (!ann.points || ann.points.length < 2) continue;

            const vertices = [];
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const pt of ann.points) {
              const px = pt.x;
              const py = convertY(pt.y);
              vertices.push(px, py);
              minX = Math.min(minX, px); maxX = Math.max(maxX, px);
              minY = Math.min(minY, py); maxY = Math.max(maxY, py);
            }

            // Stroke color
            const strokeColorArr = ann.strokeColor ? hexToColorArray(ann.strokeColor) : colorArr;

            const polylineDict = {
              Type: 'Annot',
              Subtype: 'PolyLine',
              Rect: [minX - borderWidth, minY - borderWidth, maxX + borderWidth, maxY + borderWidth],
              Vertices: vertices,
              C: strokeColorArr,
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of(ann.subject || ''),
              M: PDFString.of(new Date().toISOString()),
              F: 4
            };

            // Use BS (Border Style) dictionary
            polylineDict.BS = context.obj({
              Type: 'Border',
              W: borderWidth,
              S: 'S'
            });

            annotDict = context.obj(polylineDict);
            break;
          }

          case 'polygon':
          case 'cloud': {
            // Polygon annotation
            if (!ann.points || ann.points.length < 3) continue;

            const vertices = [];
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const pt of ann.points) {
              const px = pt.x;
              const py = convertY(pt.y);
              vertices.push(px, py);
              minX = Math.min(minX, px); maxX = Math.max(maxX, px);
              minY = Math.min(minY, py); maxY = Math.max(maxY, py);
            }

            // Stroke color
            const strokeColorArr = ann.strokeColor ? hexToColorArray(ann.strokeColor) : colorArr;

            const polygonDict = {
              Type: 'Annot',
              Subtype: 'Polygon',
              Rect: [minX - borderWidth, minY - borderWidth, maxX + borderWidth, maxY + borderWidth],
              Vertices: vertices,
              C: strokeColorArr,
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of(ann.subject || ''),
              M: PDFString.of(new Date().toISOString()),
              F: 4
            };

            // Use BS (Border Style) dictionary
            polygonDict.BS = context.obj({
              Type: 'Border',
              W: borderWidth,
              S: 'S'
            });

            // Add interior color (fill) if specified
            if (ann.fillColor && ann.fillColor !== 'none') {
              polygonDict.IC = hexToColorArray(ann.fillColor);
            }

            annotDict = context.obj(polygonDict);
            break;
          }

          case 'text':
          case 'textbox':
          case 'callout': {
            // FreeText annotation
            const x1 = ann.x;
            const y1 = convertY(ann.y + ann.height);
            const x2 = ann.x + ann.width;
            const y2 = convertY(ann.y);

            const fontSize = ann.fontSize || 14;
            const textColorArr = ann.textColor ? hexToColorArray(ann.textColor) : [0, 0, 0];

            // Default appearance string for text rendering
            const da = `${textColorArr[0]} ${textColorArr[1]} ${textColorArr[2]} rg /Helv ${fontSize} Tf`;

            const annDictObj = {
              Type: 'Annot',
              Subtype: 'FreeText',
              Rect: [x1, y1, x2, y2],
              Contents: PDFString.of(ann.text || ''),
              DA: PDFString.of(da),
              C: colorArr,
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              M: PDFString.of(new Date().toISOString()),
              F: 4
            };

            // Border
            if (ann.strokeColor && ann.strokeColor !== 'none') {
              annDictObj.C = hexToColorArray(ann.strokeColor);
            }

            // Interior color (background)
            if (ann.fillColor && ann.fillColor !== 'none') {
              annDictObj.IC = hexToColorArray(ann.fillColor);
            }

            // Callout line
            if (ann.type === 'callout' && ann.arrowX !== undefined) {
              const arrowX = ann.arrowX;
              const arrowY = convertY(ann.arrowY);
              const kneeX = ann.kneeX !== undefined ? ann.kneeX : arrowX;
              const kneeY = ann.kneeY !== undefined ? convertY(ann.kneeY) : arrowY;

              // CL array: [arrowX, arrowY, kneeX, kneeY, textX, textY]
              const textConnectionX = ann.arrowX < (ann.x + ann.width / 2) ? x1 : x2;
              const textConnectionY = (y1 + y2) / 2;
              annDictObj.CL = [arrowX, arrowY, kneeX, kneeY, textConnectionX, textConnectionY];
              annDictObj.IT = 'FreeTextCallout';
            }

            annotDict = context.obj(annDictObj);
            break;
          }

          case 'comment': {
            // Text annotation (sticky note)
            const x = ann.x;
            const y = convertY(ann.y);

            annotDict = context.obj({
              Type: 'Annot',
              Subtype: 'Text',
              Rect: [x, y - 24, x + 24, y],
              Contents: PDFString.of(ann.text || ann.comment || ''),
              C: hexToColorArray(ann.color || '#FFFF00'),
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              M: PDFString.of(new Date().toISOString()),
              Name: 'Comment',
              Open: false,
              F: 4
            });
            break;
          }
        }

        // Add annotation to page
        if (annotDict) {
          const annotRef = context.register(annotDict);
          annotsArray.push(annotRef);
        }
      }
    }

    // Save the PDF
    const pdfBytes = await pdfDocLib.save();
    const outputPath = saveAsPath || currentPdfPath;

    fs.writeFileSync(outputPath, Buffer.from(pdfBytes));

    console.log('PDF saved successfully to:', outputPath);
    return true;
  } catch (error) {
    console.error('Error saving PDF:', error);
    alert('Failed to save PDF: ' + error.message);
    return false;
  } finally {
    hideLoading();
  }
}

// Save As - prompt for new file path
async function savePDFAs() {
  if (!currentPdfPath) {
    alert('No PDF loaded');
    return;
  }

  const { ipcRenderer } = window.require('electron');
  const savePath = await ipcRenderer.invoke('dialog:saveFile', currentPdfPath);

  if (savePath) {
    await savePDF(savePath);
  }
}

// Render PDF page (single page mode)
async function renderPage(pageNum) {
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  // Set canvas dimensions
  pdfCanvas.width = viewport.width;
  pdfCanvas.height = viewport.height;
  annotationCanvas.width = viewport.width;
  annotationCanvas.height = viewport.height;

  // Render PDF page
  const renderContext = {
    canvasContext: pdfCtx,
    viewport: viewport
  };
  await page.render(renderContext).promise;

  // Redraw annotations
  redrawAnnotations();

  // Update page info
  pageInfo.textContent = `Page ${pageNum} / ${pdfDoc.numPages}`;
  prevPageBtn.disabled = pageNum === 1;
  nextPageBtn.disabled = pageNum === pdfDoc.numPages;

  // Update status bar
  updateAllStatus();
}

// Render all pages (continuous mode)
async function renderContinuous() {
  const continuousContainer = document.getElementById('continuous-container');
  continuousContainer.innerHTML = ''; // Clear existing content

  console.log('Rendering continuous mode with', pdfDoc.numPages, 'pages');

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale });

    console.log(`Rendering page ${pageNum}, viewport: ${viewport.width}x${viewport.height}`);

    // Create wrapper for each page
    const pageWrapper = document.createElement('div');
    pageWrapper.className = 'page-wrapper';
    pageWrapper.dataset.page = pageNum;

    // Add page number label
    const pageLabel = document.createElement('div');
    pageLabel.className = 'page-number-label';
    pageLabel.textContent = `Page ${pageNum}`;
    pageWrapper.appendChild(pageLabel);

    // Create container for canvas layers
    const canvasContainer = document.createElement('div');
    canvasContainer.style.position = 'relative';
    canvasContainer.style.display = 'inline-block';

    // Create PDF canvas
    const pdfCanvas = document.createElement('canvas');
    pdfCanvas.className = 'pdf-canvas';
    pdfCanvas.width = viewport.width;
    pdfCanvas.height = viewport.height;
    pdfCanvas.dataset.page = pageNum;
    pdfCanvas.style.display = 'block';
    pdfCanvas.style.background = 'white';
    pdfCanvas.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.3)';

    // Create annotation canvas
    const annotationCanvas = document.createElement('canvas');
    annotationCanvas.className = 'annotation-canvas';
    annotationCanvas.width = viewport.width;
    annotationCanvas.height = viewport.height;
    annotationCanvas.dataset.page = pageNum;
    annotationCanvas.style.position = 'absolute';
    annotationCanvas.style.top = '0';
    annotationCanvas.style.left = '0';
    annotationCanvas.style.cursor = 'crosshair';

    // Append canvases to container
    canvasContainer.appendChild(pdfCanvas);
    canvasContainer.appendChild(annotationCanvas);
    pageWrapper.appendChild(canvasContainer);
    continuousContainer.appendChild(pageWrapper);

    // Render PDF page AFTER adding to DOM
    const pdfCtx = pdfCanvas.getContext('2d');
    try {
      await page.render({
        canvasContext: pdfCtx,
        viewport: viewport
      }).promise;
      console.log(`Page ${pageNum} rendered successfully`);
    } catch (error) {
      console.error(`Error rendering page ${pageNum}:`, error);
    }

    // Render annotations for this page
    const annotationCtx = annotationCanvas.getContext('2d');
    renderAnnotationsForPage(annotationCtx, pageNum, viewport.width, viewport.height);

    // Add event listeners for annotations (using closure to capture pageNum)
    (function(pageNumber) {
      annotationCanvas.addEventListener('mousedown', function(e) {
        handleContinuousMouseDown(e, pageNumber);
      });
      annotationCanvas.addEventListener('mousemove', function(e) {
        handleContinuousMouseMove(e, pageNumber);
      });
      annotationCanvas.addEventListener('mouseup', function(e) {
        handleContinuousMouseUp(e, pageNumber);
      });
    })(pageNum);
  }

  // Update page info
  pageInfo.textContent = `Continuous View - ${pdfDoc.numPages} pages`;
  prevPageBtn.disabled = true;
  nextPageBtn.disabled = true;

  // Update status bar
  updateAllStatus();

  console.log('Continuous mode rendering complete');
}

// Render annotations for a specific page
function renderAnnotationsForPage(ctx, pageNum, width, height) {
  ctx.clearRect(0, 0, width, height);

  // Apply scale transformation for zooming
  ctx.save();
  ctx.scale(scale, scale);

  annotations.forEach(annotation => {
    if (annotation.page !== pageNum) return;

    // Use annotation's opacity property (default to 1 for most, 0.3 for highlight)
    const baseOpacity = annotation.opacity !== undefined ? annotation.opacity :
                       (annotation.type === 'highlight' ? 0.3 : 1);

    // Use strokeColor/fillColor if available, otherwise fallback to color
    const strokeColor = annotation.strokeColor || annotation.color;
    const fillColor = annotation.fillColor || annotation.color;

    ctx.strokeStyle = strokeColor;
    ctx.fillStyle = fillColor;
    ctx.lineWidth = annotation.lineWidth || 3;
    ctx.globalAlpha = baseOpacity;

    switch (annotation.type) {
      case 'draw':
        ctx.strokeStyle = strokeColor;
        ctx.beginPath();
        annotation.path.forEach((point, index) => {
          if (index === 0) {
            ctx.moveTo(point.x, point.y);
          } else {
            ctx.lineTo(point.x, point.y);
          }
        });
        ctx.stroke();
        break;

      case 'highlight':
        ctx.fillStyle = fillColor;
        ctx.fillRect(
          annotation.x,
          annotation.y,
          annotation.width,
          annotation.height
        );
        break;

      case 'line':
        ctx.strokeStyle = strokeColor;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(annotation.startX, annotation.startY);
        ctx.lineTo(annotation.endX, annotation.endY);
        ctx.stroke();
        break;

      case 'circle':
        // Draw ellipse that fits in bounding box
        const contCircW = annotation.width || annotation.radius * 2;
        const contCircH = annotation.height || annotation.radius * 2;
        const contCircX = annotation.x !== undefined ? annotation.x : annotation.centerX - annotation.radius;
        const contCircY = annotation.y !== undefined ? annotation.y : annotation.centerY - annotation.radius;
        const contCircCX = contCircX + contCircW / 2;
        const contCircCY = contCircY + contCircH / 2;

        ctx.beginPath();
        ctx.ellipse(contCircCX, contCircCY, Math.abs(contCircW / 2), Math.abs(contCircH / 2), 0, 0, 2 * Math.PI);

        // Fill if fillColor is set and not 'none'
        if (annotation.fillColor && annotation.fillColor !== 'none' && annotation.fillColor !== null) {
          ctx.fillStyle = annotation.fillColor;
          ctx.fill();
        }

        ctx.strokeStyle = strokeColor;
        ctx.stroke();
        break;

      case 'box':
        // Fill if fillColor is set and not 'none'
        if (annotation.fillColor && annotation.fillColor !== 'none' && annotation.fillColor !== null) {
          ctx.fillStyle = annotation.fillColor;
          ctx.fillRect(annotation.x, annotation.y, annotation.width, annotation.height);
        }

        ctx.strokeStyle = strokeColor;
        ctx.strokeRect(
          annotation.x,
          annotation.y,
          annotation.width,
          annotation.height
        );
        break;

      case 'comment':
        ctx.globalAlpha = baseOpacity;
        ctx.fillStyle = annotation.fillColor || '#FFD700';
        ctx.fillRect(annotation.x, annotation.y, 24, 24);
        ctx.strokeStyle = '#FFA500';
        ctx.lineWidth = 2;
        ctx.strokeRect(annotation.x, annotation.y, 24, 24);

        if (annotation.text) {
          ctx.fillStyle = '#000';
          ctx.font = '12px Arial';
          ctx.fillText(
            annotation.text.substring(0, 20) + (annotation.text.length > 20 ? '...' : ''),
            annotation.x + 30,
            annotation.y + 16
          );
        }
        break;

      case 'text':
        ctx.fillStyle = annotation.color;
        ctx.font = `${annotation.fontSize || 16}px Arial`;
        ctx.fillText(annotation.text, annotation.x, annotation.y);
        break;
    }
  });

  // Restore context (undo scale transformation)
  ctx.restore();
  ctx.globalAlpha = 1;
}

// Redraw all pages in continuous mode
function redrawContinuous() {
  const pageWrappers = document.querySelectorAll('.page-wrapper');
  pageWrappers.forEach(wrapper => {
    const pageNum = parseInt(wrapper.dataset.page);
    const annotationCanvas = wrapper.querySelector('.annotation-canvas');
    const ctx = annotationCanvas.getContext('2d');
    renderAnnotationsForPage(ctx, pageNum, annotationCanvas.width, annotationCanvas.height);
  });
}

// Switch view mode
async function setViewMode(mode) {
  if (!pdfDoc) return;

  viewMode = mode;
  const singleContainer = document.getElementById('canvas-container');
  const continuousContainer = document.getElementById('continuous-container');

  if (mode === 'single') {
    singleContainer.style.display = 'inline-block';
    continuousContainer.style.display = 'none';
    await renderPage(currentPage);

    // Update button states
    document.getElementById('single-page')?.classList.add('active');
    document.getElementById('continuous')?.classList.remove('active');
  } else if (mode === 'continuous') {
    singleContainer.style.display = 'none';
    continuousContainer.style.display = 'flex';
    await renderContinuous();

    // Update button states
    document.getElementById('single-page')?.classList.remove('active');
    document.getElementById('continuous')?.classList.add('active');
  }
}

// Mouse event handlers for continuous mode
let activeContinuousCanvas = null;
let activeContinuousPage = null;

function handleContinuousMouseDown(e, pageNum) {
  const canvas = e.target;
  const rect = canvas.getBoundingClientRect();
  // Convert to unscaled coordinates
  startX = (e.clientX - rect.left) / scale;
  startY = (e.clientY - rect.top) / scale;

  activeContinuousCanvas = canvas;
  activeContinuousPage = pageNum;
  currentPage = pageNum; // Update current page for annotation storage

  if (currentTool === 'select') {
    const clickedAnnotation = findAnnotationAt(startX, startY);
    if (clickedAnnotation) {
      showProperties(clickedAnnotation);
    } else {
      hideProperties();
    }
    return;
  }

  isDrawing = true;

  if (currentTool === 'draw') {
    currentPath = [{ x: startX, y: startY }];
  } else if (currentTool === 'comment') {
    addComment(startX, startY);
    isDrawing = false;
  } else if (currentTool === 'text') {
    addText(startX, startY);
    isDrawing = false;
  }
}

function handleContinuousMouseMove(e, pageNum) {
  // Only handle mousemove if we're actively drawing
  if (!isDrawing) return;
  if (activeContinuousPage !== pageNum) return;
  if (!activeContinuousCanvas) return;

  const canvas = activeContinuousCanvas;
  const rect = canvas.getBoundingClientRect();
  // Convert to unscaled coordinates
  const currentX = (e.clientX - rect.left) / scale;
  const currentY = (e.clientY - rect.top) / scale;
  const ctx = canvas.getContext('2d');

  if (currentTool === 'draw') {
    currentPath.push({ x: currentX, y: currentY });
    ctx.strokeStyle = colorPicker.value;
    ctx.lineWidth = parseInt(lineWidth.value);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(currentPath[currentPath.length - 2].x, currentPath[currentPath.length - 2].y);
    ctx.lineTo(currentX, currentY);
    ctx.stroke();
  } else if (currentTool === 'highlight' || currentTool === 'line' || currentTool === 'circle' || currentTool === 'box') {
    // Redraw page to show preview
    renderAnnotationsForPage(ctx, pageNum, canvas.width, canvas.height);

    if (currentTool === 'highlight') {
      ctx.fillStyle = colorPicker.value;
      ctx.globalAlpha = 0.3;
      ctx.fillRect(startX, startY, currentX - startX, currentY - startY);
      ctx.globalAlpha = 1;
    } else if (currentTool === 'line') {
      ctx.strokeStyle = colorPicker.value;
      ctx.lineWidth = parseInt(lineWidth.value);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(currentX, currentY);
      ctx.stroke();
    } else if (currentTool === 'circle') {
      const radius = Math.sqrt(Math.pow(currentX - startX, 2) + Math.pow(currentY - startY, 2));
      ctx.strokeStyle = colorPicker.value;
      ctx.lineWidth = parseInt(lineWidth.value);
      ctx.beginPath();
      ctx.arc(startX, startY, radius, 0, 2 * Math.PI);
      ctx.stroke();
    } else if (currentTool === 'box') {
      ctx.strokeStyle = colorPicker.value;
      ctx.lineWidth = parseInt(lineWidth.value);
      ctx.strokeRect(startX, startY, currentX - startX, currentY - startY);
    }
  }
}

function handleContinuousMouseUp(e, pageNum) {
  if (!isDrawing || activeContinuousPage !== pageNum) return;

  const rect = activeContinuousCanvas.getBoundingClientRect();
  // Convert to unscaled coordinates
  const endX = (e.clientX - rect.left) / scale;
  const endY = (e.clientY - rect.top) / scale;

  if (currentTool === 'draw' && currentPath.length > 1) {
    annotations.push(createAnnotation({
      type: 'draw',
      page: pageNum,
      path: currentPath,
      color: colorPicker.value,
      strokeColor: colorPicker.value,
      lineWidth: parseInt(lineWidth.value)
    }));
    currentPath = [];
  } else if (currentTool === 'highlight') {
    annotations.push(createAnnotation({
      type: 'highlight',
      page: pageNum,
      x: Math.min(startX, endX),
      y: Math.min(startY, endY),
      width: Math.abs(endX - startX),
      height: Math.abs(endY - startY),
      color: colorPicker.value,
      fillColor: colorPicker.value
    }));
  } else if (currentTool === 'line') {
    annotations.push(createAnnotation({
      type: 'line',
      page: pageNum,
      startX: startX,
      startY: startY,
      endX: endX,
      endY: endY,
      color: colorPicker.value,
      strokeColor: colorPicker.value,
      lineWidth: parseInt(lineWidth.value)
    }));
  } else if (currentTool === 'circle') {
    // Use bounding box model (x, y, width, height) for ellipse
    const circleX = Math.min(startX, endX);
    const circleY = Math.min(startY, endY);
    const circleW = Math.abs(endX - startX);
    const circleH = Math.abs(endY - startY);
    annotations.push(createAnnotation({
      type: 'circle',
      page: pageNum,
      x: circleX,
      y: circleY,
      width: circleW,
      height: circleH,
      color: colorPicker.value,
      strokeColor: colorPicker.value,
      fillColor: colorPicker.value,
      lineWidth: parseInt(lineWidth.value)
    }));
  } else if (currentTool === 'box') {
    // Normalize coordinates so x,y is always top-left
    const boxX = Math.min(startX, endX);
    const boxY = Math.min(startY, endY);
    const boxW = Math.abs(endX - startX);
    const boxH = Math.abs(endY - startY);
    annotations.push(createAnnotation({
      type: 'box',
      page: pageNum,
      x: boxX,
      y: boxY,
      width: boxW,
      height: boxH,
      color: colorPicker.value,
      fillColor: colorPicker.value,
      strokeColor: colorPicker.value,
      lineWidth: parseInt(lineWidth.value)
    }));
  }

  isDrawing = false;
  activeContinuousCanvas = null;
  activeContinuousPage = null;

  // Redraw to show final annotation
  redrawContinuous();
}

// Redraw all annotations
function redrawAnnotations() {
  annotationCtx.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);

  // Apply scale transformation for zooming
  annotationCtx.save();
  annotationCtx.scale(scale, scale);

  annotations.forEach(annotation => {
    if (annotation.page !== currentPage) return;

    // Use annotation's opacity property (default to 1 for most, 0.3 for highlight)
    const baseOpacity = annotation.opacity !== undefined ? annotation.opacity :
                       (annotation.type === 'highlight' ? 0.3 : 1);

    // Use strokeColor/fillColor if available, otherwise fallback to color
    const strokeColor = annotation.strokeColor || annotation.color;
    const fillColor = annotation.fillColor || annotation.color;

    annotationCtx.strokeStyle = strokeColor;
    annotationCtx.fillStyle = fillColor;
    annotationCtx.lineWidth = annotation.lineWidth || 3;
    annotationCtx.globalAlpha = baseOpacity;

    switch (annotation.type) {
      case 'draw':
        annotationCtx.strokeStyle = strokeColor;
        annotationCtx.beginPath();
        annotation.path.forEach((point, index) => {
          if (index === 0) {
            annotationCtx.moveTo(point.x, point.y);
          } else {
            annotationCtx.lineTo(point.x, point.y);
          }
        });
        annotationCtx.stroke();
        break;

      case 'highlight':
        annotationCtx.fillStyle = fillColor;
        annotationCtx.fillRect(
          annotation.x,
          annotation.y,
          annotation.width,
          annotation.height
        );
        break;

      case 'line':
        annotationCtx.strokeStyle = strokeColor;
        annotationCtx.lineCap = 'round';
        annotationCtx.beginPath();
        annotationCtx.moveTo(annotation.startX, annotation.startY);
        annotationCtx.lineTo(annotation.endX, annotation.endY);
        annotationCtx.stroke();
        break;

      case 'polyline':
        if (annotation.points && annotation.points.length >= 2) {
          annotationCtx.strokeStyle = strokeColor;
          annotationCtx.lineCap = 'round';
          annotationCtx.lineJoin = 'round';
          annotationCtx.beginPath();
          annotation.points.forEach((point, index) => {
            if (index === 0) {
              annotationCtx.moveTo(point.x, point.y);
            } else {
              annotationCtx.lineTo(point.x, point.y);
            }
          });
          annotationCtx.stroke();
        }
        break;

      case 'circle':
        // Draw ellipse that fits in bounding box
        const ellipseX = annotation.x;
        const ellipseY = annotation.y;
        const ellipseW = annotation.width || annotation.radius * 2;
        const ellipseH = annotation.height || annotation.radius * 2;
        const ellipseCX = ellipseX + ellipseW / 2;
        const ellipseCY = ellipseY + ellipseH / 2;
        const ellipseRX = ellipseW / 2;
        const ellipseRY = ellipseH / 2;

        annotationCtx.beginPath();
        annotationCtx.ellipse(ellipseCX, ellipseCY, Math.abs(ellipseRX), Math.abs(ellipseRY), 0, 0, 2 * Math.PI);

        // Fill if fillColor is set and not 'none'
        if (annotation.fillColor && annotation.fillColor !== 'none' && annotation.fillColor !== null) {
          annotationCtx.fillStyle = annotation.fillColor;
          annotationCtx.fill();
        }

        annotationCtx.strokeStyle = strokeColor;
        annotationCtx.stroke();
        break;

      case 'box':
        // Fill if fillColor is set and not 'none'
        if (annotation.fillColor && annotation.fillColor !== 'none' && annotation.fillColor !== null) {
          annotationCtx.fillStyle = annotation.fillColor;
          annotationCtx.fillRect(
            annotation.x,
            annotation.y,
            annotation.width,
            annotation.height
          );
        }

        annotationCtx.strokeStyle = strokeColor;
        annotationCtx.strokeRect(
          annotation.x,
          annotation.y,
          annotation.width,
          annotation.height
        );
        break;

      case 'polygon':
        annotationCtx.strokeStyle = strokeColor;
        drawPolygonShape(annotationCtx, annotation.x, annotation.y, annotation.width, annotation.height, annotation.sides || 6);
        break;

      case 'cloud':
        annotationCtx.strokeStyle = strokeColor;
        drawCloudShape(annotationCtx, annotation.x, annotation.y, annotation.width, annotation.height);
        break;

      case 'comment':
        // Draw comment icon with rotation support
        const cWidth = annotation.width || 24;
        const cHeight = annotation.height || 24;
        annotationCtx.save();
        annotationCtx.globalAlpha = baseOpacity;

        // Apply rotation if set
        if (annotation.rotation) {
          const cCenterX = annotation.x + cWidth / 2;
          const cCenterY = annotation.y + cHeight / 2;
          annotationCtx.translate(cCenterX, cCenterY);
          annotationCtx.rotate(annotation.rotation * Math.PI / 180);
          annotationCtx.translate(-cCenterX, -cCenterY);
        }

        annotationCtx.fillStyle = annotation.fillColor || '#FFD700';
        annotationCtx.fillRect(annotation.x, annotation.y, cWidth, cHeight);
        annotationCtx.strokeStyle = '#FFA500';
        annotationCtx.lineWidth = 2;
        annotationCtx.strokeRect(annotation.x, annotation.y, cWidth, cHeight);

        // Draw note icon inside
        annotationCtx.fillStyle = '#FFA500';
        annotationCtx.font = `${Math.min(cWidth, cHeight) * 0.6}px Arial`;
        annotationCtx.textAlign = 'center';
        annotationCtx.textBaseline = 'middle';
        annotationCtx.fillText('📝', annotation.x + cWidth/2, annotation.y + cHeight/2);
        annotationCtx.textAlign = 'left';
        annotationCtx.textBaseline = 'alphabetic';

        annotationCtx.restore();

        // Draw text preview (outside rotation)
        if (annotation.text && !annotation.rotation) {
          annotationCtx.globalAlpha = baseOpacity;
          annotationCtx.fillStyle = '#000';
          annotationCtx.font = '12px Arial';
          annotationCtx.fillText(
            annotation.text.substring(0, 20) + (annotation.text.length > 20 ? '...' : ''),
            annotation.x + cWidth + 6,
            annotation.y + cHeight/2 + 4
          );
        }
        break;

      case 'text':
        annotationCtx.fillStyle = annotation.color;
        annotationCtx.font = `${annotation.fontSize || 16}px Arial`;
        annotationCtx.fillText(annotation.text, annotation.x, annotation.y);
        break;

      case 'textbox':
        // Draw text box with border and optional fill
        const tbWidth = annotation.width || 150;
        const tbHeight = annotation.height || 50;
        const tbFontSize = annotation.fontSize || 14;
        const tbPadding = 5;
        const tbLineWidth = annotation.lineWidth !== undefined ? annotation.lineWidth : 1;
        const tbBorderStyle = annotation.borderStyle || 'solid';

        // Draw fill
        if (annotation.fillColor && annotation.fillColor !== 'transparent') {
          annotationCtx.fillStyle = annotation.fillColor;
          annotationCtx.fillRect(annotation.x, annotation.y, tbWidth, tbHeight);
        }

        // Draw border with style
        if (tbLineWidth > 0) {
          annotationCtx.strokeStyle = annotation.strokeColor || strokeColor;
          annotationCtx.lineWidth = tbLineWidth;
          // Set line dash based on border style
          if (tbBorderStyle === 'dashed') {
            annotationCtx.setLineDash([8, 4]);
          } else if (tbBorderStyle === 'dotted') {
            annotationCtx.setLineDash([2, 2]);
          } else {
            annotationCtx.setLineDash([]);
          }
          annotationCtx.strokeRect(annotation.x, annotation.y, tbWidth, tbHeight);
          annotationCtx.setLineDash([]); // Reset line dash
        }

        // Draw text inside the box
        if (annotation.text) {
          // Build font string with style options
          const tbFontFamily = annotation.fontFamily || 'Arial';
          const tbFontStyle = (annotation.fontItalic ? 'italic ' : '') + (annotation.fontBold ? 'bold ' : '');
          annotationCtx.fillStyle = annotation.textColor || annotation.color || '#000000';
          annotationCtx.font = `${tbFontStyle}${tbFontSize}px ${tbFontFamily}`;

          // Get text alignment and line spacing
          const tbTextAlign = annotation.textAlign || 'left';
          const tbLineSpacing = annotation.lineSpacing || 1.5;
          const lineHeight = tbFontSize * tbLineSpacing;

          // Word wrap text with newline support
          const paragraphs = annotation.text.split('\n');
          let y = annotation.y + tbFontSize + tbPadding;
          const maxWidth = tbWidth - tbPadding * 2;

          for (let p = 0; p < paragraphs.length; p++) {
            if (y > annotation.y + tbHeight - tbPadding) break;

            const words = paragraphs[p].split(' ');
            let line = '';

            for (let i = 0; i < words.length; i++) {
              const testLine = line + words[i] + ' ';
              const metrics = annotationCtx.measureText(testLine);
              if (metrics.width > maxWidth && i > 0) {
                // Calculate x position based on alignment
                let textX = annotation.x + tbPadding;
                const lineWidth = annotationCtx.measureText(line.trim()).width;
                if (tbTextAlign === 'center') {
                  textX = annotation.x + tbPadding + (maxWidth - lineWidth) / 2;
                } else if (tbTextAlign === 'right') {
                  textX = annotation.x + tbWidth - tbPadding - lineWidth;
                }

                annotationCtx.fillText(line.trim(), textX, y);

                // Draw underline if enabled
                if (annotation.fontUnderline) {
                  annotationCtx.beginPath();
                  annotationCtx.moveTo(textX, y + 2);
                  annotationCtx.lineTo(textX + lineWidth, y + 2);
                  annotationCtx.strokeStyle = annotationCtx.fillStyle;
                  annotationCtx.lineWidth = 1;
                  annotationCtx.stroke();
                }

                // Draw strikethrough if enabled
                if (annotation.fontStrikethrough) {
                  annotationCtx.beginPath();
                  annotationCtx.moveTo(textX, y - tbFontSize / 3);
                  annotationCtx.lineTo(textX + lineWidth, y - tbFontSize / 3);
                  annotationCtx.strokeStyle = annotationCtx.fillStyle;
                  annotationCtx.lineWidth = 1;
                  annotationCtx.stroke();
                }

                line = words[i] + ' ';
                y += lineHeight;
                if (y > annotation.y + tbHeight - tbPadding) break;
              } else {
                line = testLine;
              }
            }
            if (y <= annotation.y + tbHeight - tbPadding && line.trim()) {
              // Calculate x position based on alignment
              let textX = annotation.x + tbPadding;
              const lineWidth = annotationCtx.measureText(line.trim()).width;
              if (tbTextAlign === 'center') {
                textX = annotation.x + tbPadding + (maxWidth - lineWidth) / 2;
              } else if (tbTextAlign === 'right') {
                textX = annotation.x + tbWidth - tbPadding - lineWidth;
              }

              annotationCtx.fillText(line.trim(), textX, y);

              // Draw underline if enabled
              if (annotation.fontUnderline) {
                annotationCtx.beginPath();
                annotationCtx.moveTo(textX, y + 2);
                annotationCtx.lineTo(textX + lineWidth, y + 2);
                annotationCtx.strokeStyle = annotationCtx.fillStyle;
                annotationCtx.lineWidth = 1;
                annotationCtx.stroke();
              }

              // Draw strikethrough if enabled
              if (annotation.fontStrikethrough) {
                annotationCtx.beginPath();
                annotationCtx.moveTo(textX, y - tbFontSize / 3);
                annotationCtx.lineTo(textX + lineWidth, y - tbFontSize / 3);
                annotationCtx.strokeStyle = annotationCtx.fillStyle;
                annotationCtx.lineWidth = 1;
                annotationCtx.stroke();
              }

              y += lineHeight;
            }
          }
        }
        break;

      case 'callout':
        // Draw callout annotation (text box with two-segment leader line like PDF-XChange/Adobe)
        const coWidth = annotation.width || 150;
        const coHeight = annotation.height || 50;
        const coFontSize = annotation.fontSize || 14;
        const coPadding = 5;
        const coLineWidth = annotation.lineWidth !== undefined ? annotation.lineWidth : 1;
        const coBorderStyle = annotation.borderStyle || 'solid';

        // Set stroke style for leader line
        annotationCtx.strokeStyle = annotation.strokeColor || strokeColor;
        annotationCtx.lineWidth = coLineWidth > 0 ? coLineWidth : 1;

        // Arrow tip position
        const arrowX = annotation.arrowX !== undefined ? annotation.arrowX : annotation.x - 60;
        const arrowY = annotation.arrowY !== undefined ? annotation.arrowY : annotation.y + coHeight;

        // Calculate knee point - positioned horizontally from the text box edge
        // The knee Y is at the same level as the arm origin (horizontal arm)
        const kneeX = annotation.kneeX !== undefined ? annotation.kneeX : annotation.x - 30;
        const kneeY = annotation.kneeY !== undefined ? annotation.kneeY : annotation.y + coHeight / 2;

        // Calculate arm origin (connection point on text box edge)
        // This is where the horizontal arm connects to the text box
        let armOriginX, armOriginY;
        if (annotation.armOriginX !== undefined && annotation.armOriginY !== undefined) {
          armOriginX = annotation.armOriginX;
          armOriginY = annotation.armOriginY;
        } else {
          // Default: connect from left or right edge based on arrow position
          if (arrowX < annotation.x + coWidth / 2) {
            armOriginX = annotation.x; // Left edge
          } else {
            armOriginX = annotation.x + coWidth; // Right edge
          }
          armOriginY = kneeY; // Same Y as knee for horizontal arm
        }

        // Draw the two-segment leader line:
        // Segment 1: Horizontal arm from text box edge to knee
        // Segment 2: Diagonal line from knee to arrow tip
        annotationCtx.beginPath();
        annotationCtx.moveTo(armOriginX, armOriginY);
        annotationCtx.lineTo(kneeX, kneeY); // Horizontal arm (armOriginY should equal kneeY)
        annotationCtx.lineTo(arrowX, arrowY); // Diagonal to arrow
        annotationCtx.stroke();

        // Draw arrowhead
        const angle = Math.atan2(arrowY - kneeY, arrowX - kneeX);
        const arrowSize = 10;
        annotationCtx.beginPath();
        annotationCtx.moveTo(arrowX, arrowY);
        annotationCtx.lineTo(
          arrowX - arrowSize * Math.cos(angle - Math.PI / 6),
          arrowY - arrowSize * Math.sin(angle - Math.PI / 6)
        );
        annotationCtx.moveTo(arrowX, arrowY);
        annotationCtx.lineTo(
          arrowX - arrowSize * Math.cos(angle + Math.PI / 6),
          arrowY - arrowSize * Math.sin(angle + Math.PI / 6)
        );
        annotationCtx.stroke();

        // Draw fill
        if (annotation.fillColor && annotation.fillColor !== 'transparent') {
          annotationCtx.fillStyle = annotation.fillColor;
          annotationCtx.fillRect(annotation.x, annotation.y, coWidth, coHeight);
        }

        // Draw border with style
        if (coLineWidth > 0) {
          annotationCtx.strokeStyle = annotation.strokeColor || strokeColor;
          annotationCtx.lineWidth = coLineWidth;
          // Set line dash based on border style
          if (coBorderStyle === 'dashed') {
            annotationCtx.setLineDash([8, 4]);
          } else if (coBorderStyle === 'dotted') {
            annotationCtx.setLineDash([2, 2]);
          } else {
            annotationCtx.setLineDash([]);
          }
          annotationCtx.strokeRect(annotation.x, annotation.y, coWidth, coHeight);
          annotationCtx.setLineDash([]); // Reset line dash
        }

        // Draw text inside the box
        if (annotation.text) {
          // Build font string with style options
          const coFontFamily = annotation.fontFamily || 'Arial';
          const coFontStyle = (annotation.fontItalic ? 'italic ' : '') + (annotation.fontBold ? 'bold ' : '');
          annotationCtx.fillStyle = annotation.textColor || annotation.color || '#000000';
          annotationCtx.font = `${coFontStyle}${coFontSize}px ${coFontFamily}`;

          // Get text alignment and line spacing
          const coTextAlign = annotation.textAlign || 'left';
          const coLineSpacing = annotation.lineSpacing || 1.5;
          const coLineHeight = coFontSize * coLineSpacing;

          // Word wrap text with newline support
          const coParagraphs = annotation.text.split('\n');
          let coY = annotation.y + coFontSize + coPadding;
          const coMaxWidth = coWidth - coPadding * 2;

          for (let p = 0; p < coParagraphs.length; p++) {
            if (coY > annotation.y + coHeight - coPadding) break;

            const coWords = coParagraphs[p].split(' ');
            let coLine = '';

            for (let i = 0; i < coWords.length; i++) {
              const testLine = coLine + coWords[i] + ' ';
              const metrics = annotationCtx.measureText(testLine);
              if (metrics.width > coMaxWidth && i > 0) {
                // Calculate x position based on alignment
                let textX = annotation.x + coPadding;
                const lineWidth = annotationCtx.measureText(coLine.trim()).width;
                if (coTextAlign === 'center') {
                  textX = annotation.x + coPadding + (coMaxWidth - lineWidth) / 2;
                } else if (coTextAlign === 'right') {
                  textX = annotation.x + coWidth - coPadding - lineWidth;
                }

                annotationCtx.fillText(coLine.trim(), textX, coY);

                // Draw underline if enabled
                if (annotation.fontUnderline) {
                  annotationCtx.beginPath();
                  annotationCtx.moveTo(textX, coY + 2);
                  annotationCtx.lineTo(textX + lineWidth, coY + 2);
                  annotationCtx.strokeStyle = annotationCtx.fillStyle;
                  annotationCtx.lineWidth = 1;
                  annotationCtx.stroke();
                }

                // Draw strikethrough if enabled
                if (annotation.fontStrikethrough) {
                  annotationCtx.beginPath();
                  annotationCtx.moveTo(textX, coY - coFontSize / 3);
                  annotationCtx.lineTo(textX + lineWidth, coY - coFontSize / 3);
                  annotationCtx.strokeStyle = annotationCtx.fillStyle;
                  annotationCtx.lineWidth = 1;
                  annotationCtx.stroke();
                }

                coLine = coWords[i] + ' ';
                coY += coLineHeight;
                if (coY > annotation.y + coHeight - coPadding) break;
              } else {
                coLine = testLine;
              }
            }
            if (coY <= annotation.y + coHeight - coPadding && coLine.trim()) {
              // Calculate x position based on alignment
              let textX = annotation.x + coPadding;
              const lineWidth = annotationCtx.measureText(coLine.trim()).width;
              if (coTextAlign === 'center') {
                textX = annotation.x + coPadding + (coMaxWidth - lineWidth) / 2;
              } else if (coTextAlign === 'right') {
                textX = annotation.x + coWidth - coPadding - lineWidth;
              }

              annotationCtx.fillText(coLine.trim(), textX, coY);

              // Draw underline if enabled
              if (annotation.fontUnderline) {
                annotationCtx.beginPath();
                annotationCtx.moveTo(textX, coY + 2);
                annotationCtx.lineTo(textX + lineWidth, coY + 2);
                annotationCtx.strokeStyle = annotationCtx.fillStyle;
                annotationCtx.lineWidth = 1;
                annotationCtx.stroke();
              }

              // Draw strikethrough if enabled
              if (annotation.fontStrikethrough) {
                annotationCtx.beginPath();
                annotationCtx.moveTo(textX, coY - coFontSize / 3);
                annotationCtx.lineTo(textX + lineWidth, coY - coFontSize / 3);
                annotationCtx.strokeStyle = annotationCtx.fillStyle;
                annotationCtx.lineWidth = 1;
                annotationCtx.stroke();
              }

              coY += coLineHeight;
            }
          }
        }
        break;

      case 'image':
        // Draw image with rotation and flip
        const img = imageCache.get(annotation.imageId);
        if (img && img.complete) {
          annotationCtx.save();

          // Move to center of image for rotation and flip
          const centerX = annotation.x + annotation.width / 2;
          const centerY = annotation.y + annotation.height / 2;
          annotationCtx.translate(centerX, centerY);
          annotationCtx.rotate((annotation.rotation || 0) * Math.PI / 180);

          // Apply flip transformations
          const scaleX = annotation.flipX ? -1 : 1;
          const scaleY = annotation.flipY ? -1 : 1;
          annotationCtx.scale(scaleX, scaleY);

          // Draw the image centered at origin
          annotationCtx.drawImage(
            img,
            -annotation.width / 2,
            -annotation.height / 2,
            annotation.width,
            annotation.height
          );

          annotationCtx.restore();
        } else {
          // Draw placeholder while loading
          annotationCtx.fillStyle = '#f0f0f0';
          annotationCtx.fillRect(annotation.x, annotation.y, annotation.width, annotation.height);
          annotationCtx.strokeStyle = '#ccc';
          annotationCtx.strokeRect(annotation.x, annotation.y, annotation.width, annotation.height);
          annotationCtx.fillStyle = '#999';
          annotationCtx.font = '12px Arial';
          annotationCtx.textAlign = 'center';
          annotationCtx.fillText('Loading...', annotation.x + annotation.width/2, annotation.y + annotation.height/2);
          annotationCtx.textAlign = 'left';
        }
        break;
    }
  });

  annotationCtx.globalAlpha = 1;

  // Draw selection highlight and handles (only if annotation is on current page)
  if (selectedAnnotation && selectedAnnotation.page === currentPage) {
    const sel = selectedAnnotation;
    annotationCtx.strokeStyle = '#667eea';
    annotationCtx.lineWidth = 2;
    annotationCtx.setLineDash([5, 5]);

    switch (sel.type) {
      case 'draw':
        if (sel.path && sel.path.length > 0) {
          const minX = Math.min(...sel.path.map(p => p.x)) - 5;
          const minY = Math.min(...sel.path.map(p => p.y)) - 5;
          const maxX = Math.max(...sel.path.map(p => p.x)) + 5;
          const maxY = Math.max(...sel.path.map(p => p.y)) + 5;
          annotationCtx.strokeRect(minX, minY, maxX - minX, maxY - minY);
        }
        break;
      case 'line':
        // For lines, just draw a thin dashed line connecting handles
        annotationCtx.beginPath();
        annotationCtx.moveTo(sel.startX, sel.startY);
        annotationCtx.lineTo(sel.endX, sel.endY);
        annotationCtx.stroke();
        break;
      case 'circle':
        // Selection indicator for ellipse using bounding box
        const selCircW = sel.width || sel.radius * 2;
        const selCircH = sel.height || sel.radius * 2;
        const selCircX = sel.x !== undefined ? sel.x : sel.centerX - sel.radius;
        const selCircY = sel.y !== undefined ? sel.y : sel.centerY - sel.radius;
        annotationCtx.strokeRect(selCircX - 5, selCircY - 5, selCircW + 10, selCircH + 10);
        break;
      case 'box':
      case 'polygon':
      case 'cloud':
        annotationCtx.strokeRect(sel.x - 5, sel.y - 5, sel.width + 10, sel.height + 10);
        break;
      case 'highlight':
        annotationCtx.strokeRect(sel.x - 5, sel.y - 5, sel.width + 10, sel.height + 10);
        break;
      case 'comment':
        const selCW = sel.width || 24;
        const selCH = sel.height || 24;
        annotationCtx.strokeRect(sel.x - 5, sel.y - 5, selCW + 10, selCH + 10);
        // Draw line from top center to rotation handle
        annotationCtx.beginPath();
        annotationCtx.moveTo(sel.x + selCW/2, sel.y - 5);
        annotationCtx.lineTo(sel.x + selCW/2, sel.y - 30);
        annotationCtx.stroke();
        break;
      case 'text':
        const textWidth = annotationCtx.measureText(sel.text).width;
        const fontSize = sel.fontSize || 16;
        annotationCtx.strokeRect(sel.x - 5, sel.y - fontSize - 5, textWidth + 10, fontSize + 10);
        break;
      case 'textbox':
        const selTbWidth = sel.width || 150;
        const selTbHeight = sel.height || 50;
        annotationCtx.strokeRect(sel.x - 5, sel.y - 5, selTbWidth + 10, selTbHeight + 10);
        break;
      case 'callout':
        const selCoWidth = sel.width || 150;
        const selCoHeight = sel.height || 50;
        annotationCtx.strokeRect(sel.x - 5, sel.y - 5, selCoWidth + 10, selCoHeight + 10);
        // Also draw selection indicators on arrow and knee points
        const selArrowX = sel.arrowX !== undefined ? sel.arrowX : sel.x - 60;
        const selArrowY = sel.arrowY !== undefined ? sel.arrowY : sel.y + selCoHeight;
        const selKneeX = sel.kneeX !== undefined ? sel.kneeX : sel.x - 30;
        const selKneeY = sel.kneeY !== undefined ? sel.kneeY : sel.y + selCoHeight / 2;
        // Draw small circles at arrow and knee for visibility
        annotationCtx.beginPath();
        annotationCtx.arc(selArrowX, selArrowY, 4, 0, 2 * Math.PI);
        annotationCtx.stroke();
        annotationCtx.beginPath();
        annotationCtx.arc(selKneeX, selKneeY, 4, 0, 2 * Math.PI);
        annotationCtx.stroke();
        break;
      case 'polyline':
        // Draw bounding box around polyline
        if (sel.points && sel.points.length > 0) {
          const plMinX = Math.min(...sel.points.map(p => p.x));
          const plMinY = Math.min(...sel.points.map(p => p.y));
          const plMaxX = Math.max(...sel.points.map(p => p.x));
          const plMaxY = Math.max(...sel.points.map(p => p.y));
          annotationCtx.strokeRect(plMinX - 5, plMinY - 5, plMaxX - plMinX + 10, plMaxY - plMinY + 10);
        }
        break;
      case 'image':
        // Draw selection box around image
        annotationCtx.strokeRect(sel.x - 5, sel.y - 5, sel.width + 10, sel.height + 10);
        // Draw line from top center to rotation handle
        annotationCtx.beginPath();
        annotationCtx.moveTo(sel.x + sel.width/2, sel.y - 5);
        annotationCtx.lineTo(sel.x + sel.width/2, sel.y - 30);
        annotationCtx.stroke();
        break;
    }

    annotationCtx.setLineDash([]);

    // Draw resize/move handles
    const handles = getAnnotationHandles(sel);
    const hs = HANDLE_SIZE;

    handles.forEach(handle => {
      // Draw rotation handle as a circle with rotation icon
      if (handle.type === HANDLE_TYPES.ROTATE) {
        annotationCtx.fillStyle = '#667eea';
        annotationCtx.beginPath();
        annotationCtx.arc(handle.x + hs/2, handle.y + hs/2, hs/2 + 2, 0, 2 * Math.PI);
        annotationCtx.fill();
        // Draw rotation arrow
        annotationCtx.strokeStyle = '#ffffff';
        annotationCtx.lineWidth = 1.5;
        annotationCtx.beginPath();
        annotationCtx.arc(handle.x + hs/2, handle.y + hs/2, 4, -Math.PI/2, Math.PI);
        annotationCtx.stroke();
        // Arrow head
        annotationCtx.beginPath();
        annotationCtx.moveTo(handle.x + hs/2 - 4, handle.y + hs/2 + 2);
        annotationCtx.lineTo(handle.x + hs/2 - 4, handle.y + hs/2 + 6);
        annotationCtx.lineTo(handle.x + hs/2 - 7, handle.y + hs/2 + 4);
        annotationCtx.stroke();
        return;
      }

      // Draw handle background (white)
      annotationCtx.fillStyle = '#ffffff';
      annotationCtx.fillRect(handle.x, handle.y, hs, hs);

      // Draw handle border (blue)
      annotationCtx.strokeStyle = '#667eea';
      annotationCtx.lineWidth = 2;
      annotationCtx.strokeRect(handle.x, handle.y, hs, hs);

      // For line endpoints, draw circles instead of squares
      if (handle.type === HANDLE_TYPES.LINE_START || handle.type === HANDLE_TYPES.LINE_END) {
        annotationCtx.fillStyle = '#667eea';
        annotationCtx.beginPath();
        annotationCtx.arc(handle.x + hs/2, handle.y + hs/2, hs/2, 0, 2 * Math.PI);
        annotationCtx.fill();
        annotationCtx.strokeStyle = '#ffffff';
        annotationCtx.lineWidth = 1;
        annotationCtx.stroke();
      }
    });
  }

  // Restore context (undo scale transformation)
  annotationCtx.restore();

  // Update annotation count in status bar
  updateStatusAnnotations();

  // Update annotations list panel
  updateAnnotationsList();
}

// Find annotation at coordinates
function findAnnotationAt(x, y) {
  // Search in reverse order (top annotations first)
  for (let i = annotations.length - 1; i >= 0; i--) {
    const ann = annotations[i];
    if (ann.page !== currentPage) continue;

    switch (ann.type) {
      case 'draw':
        // Check if point is near the path
        for (let point of ann.path) {
          const dist = Math.sqrt(Math.pow(x - point.x, 2) + Math.pow(y - point.y, 2));
          if (dist < 10) return ann;
        }
        break;
      case 'line':
        // Check if point is near the line
        const dist = distanceToLine(x, y, ann.startX, ann.startY, ann.endX, ann.endY);
        if (dist < 10) return ann;
        break;
      case 'polyline':
        // Check if point is near any segment of the polyline
        if (ann.points && ann.points.length >= 2) {
          for (let i = 0; i < ann.points.length - 1; i++) {
            const segDist = distanceToLine(x, y, ann.points[i].x, ann.points[i].y, ann.points[i+1].x, ann.points[i+1].y);
            if (segDist < 10) return ann;
          }
        }
        break;
      case 'circle':
        // Check if point is near ellipse boundary, or inside if has fill color
        const findCircW = ann.width || ann.radius * 2;
        const findCircH = ann.height || ann.radius * 2;
        const findCircX = ann.x !== undefined ? ann.x : ann.centerX - ann.radius;
        const findCircY = ann.y !== undefined ? ann.y : ann.centerY - ann.radius;
        // If has fill color, check if inside the ellipse
        if (ann.fillColor) {
          const ellCX = findCircX + findCircW / 2;
          const ellCY = findCircY + findCircH / 2;
          const ellRX = Math.abs(findCircW / 2);
          const ellRY = Math.abs(findCircH / 2);
          const normDist = Math.pow((x - ellCX) / ellRX, 2) + Math.pow((y - ellCY) / ellRY, 2);
          if (normDist <= 1) return ann;
        }
        // Also check near the border (stroke)
        if (isPointNearEllipse(x, y, findCircX, findCircY, findCircW, findCircH)) return ann;
        break;
      case 'box':
        // If has fill color, check if inside the rectangle
        if (ann.fillColor) {
          if (x >= ann.x && x <= ann.x + ann.width && y >= ann.y && y <= ann.y + ann.height) return ann;
        }
        // Also check near the border (stroke)
        if (isPointNearRect(x, y, ann.x, ann.y, ann.width, ann.height)) return ann;
        break;
      case 'highlight':
        if (x >= ann.x && x <= ann.x + ann.width && y >= ann.y && y <= ann.y + ann.height) return ann;
        break;
      case 'comment':
        if (x >= ann.x && x <= ann.x + 24 && y >= ann.y && y <= ann.y + 24) return ann;
        break;
      case 'text':
        const textWidth = annotationCtx.measureText(ann.text).width;
        const fontSize = ann.fontSize || 16;
        if (x >= ann.x && x <= ann.x + textWidth && y >= ann.y - fontSize && y <= ann.y) return ann;
        break;
      case 'textbox':
        const tbWidth = ann.width || 150;
        const tbHeight = ann.height || 50;
        if (x >= ann.x && x <= ann.x + tbWidth && y >= ann.y && y <= ann.y + tbHeight) return ann;
        break;
      case 'callout':
        const coWidth = ann.width || 150;
        const coHeight = ann.height || 50;
        // Check if clicking inside the text box
        if (x >= ann.x && x <= ann.x + coWidth && y >= ann.y && y <= ann.y + coHeight) return ann;
        // Also check if clicking near the arrow tip or knee
        const arrowX = ann.arrowX !== undefined ? ann.arrowX : ann.x - 60;
        const arrowY = ann.arrowY !== undefined ? ann.arrowY : ann.y + coHeight;
        const kneeX = ann.kneeX !== undefined ? ann.kneeX : ann.x - 30;
        const kneeY = ann.kneeY !== undefined ? ann.kneeY : ann.y + coHeight / 2;
        if (Math.sqrt(Math.pow(x - arrowX, 2) + Math.pow(y - arrowY, 2)) < 15) return ann;
        if (Math.sqrt(Math.pow(x - kneeX, 2) + Math.pow(y - kneeY, 2)) < 15) return ann;
        break;
      case 'polygon':
      case 'cloud':
        if (x >= ann.x && x <= ann.x + ann.width && y >= ann.y && y <= ann.y + ann.height) return ann;
        break;
      case 'image':
        if (x >= ann.x && x <= ann.x + ann.width && y >= ann.y && y <= ann.y + ann.height) return ann;
        break;
    }
  }
  return null;
}

// Helper: distance from point to line segment
function distanceToLine(px, py, x1, y1, x2, y2) {
  const A = px - x1;
  const B = py - y1;
  const C = x2 - x1;
  const D = y2 - y1;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;
  if (lenSq !== 0) param = dot / lenSq;

  let xx, yy;
  if (param < 0) {
    xx = x1;
    yy = y1;
  } else if (param > 1) {
    xx = x2;
    yy = y2;
  } else {
    xx = x1 + param * C;
    yy = y1 + param * D;
  }

  const dx = px - xx;
  const dy = py - yy;
  return Math.sqrt(dx * dx + dy * dy);
}

// Helper: check if point is near rectangle outline
function isPointNearRect(px, py, x, y, w, h, threshold = 10) {
  const insideOuter = px >= x - threshold && px <= x + w + threshold && py >= y - threshold && py <= y + h + threshold;
  const insideInner = px >= x + threshold && px <= x + w - threshold && py >= y + threshold && py <= y + h - threshold;
  return insideOuter && !insideInner;
}

// Helper: check if point is near ellipse outline (not inside)
function isPointNearEllipse(px, py, x, y, w, h, threshold = 10) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rx = Math.abs(w / 2);
  const ry = Math.abs(h / 2);

  // Normalized distance from center (1 means on the ellipse boundary)
  const normDist = Math.pow((px - cx) / rx, 2) + Math.pow((py - cy) / ry, 2);

  // Calculate normalized distance for outer and inner boundaries
  const outerRx = rx + threshold;
  const outerRy = ry + threshold;
  const innerRx = Math.max(rx - threshold, 0);
  const innerRy = Math.max(ry - threshold, 0);

  const outerDist = Math.pow((px - cx) / outerRx, 2) + Math.pow((py - cy) / outerRy, 2);
  const innerDist = innerRx > 0 && innerRy > 0
    ? Math.pow((px - cx) / innerRx, 2) + Math.pow((py - cy) / innerRy, 2)
    : Infinity;

  // Point is near the ellipse outline if inside outer boundary but outside inner boundary
  return outerDist <= 1 && innerDist > 1;
}

// Helper function to format date
function formatDate(date) {
  if (!date) return '';
  const d = new Date(date);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Helper function to get display name for annotation type
function getTypeDisplayName(type) {
  const names = {
    'draw': 'Freehand',
    'highlight': 'Highlight',
    'line': 'Line',
    'polyline': 'Polyline',
    'circle': 'Ellipse',
    'box': 'Rectangle',
    'polygon': 'Polygon',
    'cloud': 'Cloud',
    'comment': 'Sticky Note',
    'text': 'Text',
    'textbox': 'Text Box',
    'callout': 'Callout',
    'image': 'Image'
  };
  return names[type] || type.charAt(0).toUpperCase() + type.slice(1);
}

// Show properties panel
function showProperties(annotation) {
  selectedAnnotation = annotation;

  // Restore section visibility (may have been hidden by text editing mode)
  if (propGeneralSection) propGeneralSection.style.display = 'block';
  if (propAppearanceSection) propAppearanceSection.style.display = 'block';
  if (propActionsSection) propActionsSection.style.display = 'flex';

  // Check if annotation is locked - disable editing if so
  const isLocked = annotation.locked || false;

  // General section
  propType.value = getTypeDisplayName(annotation.type);

  if (propSubject) {
    propSubject.value = annotation.subject || '';
    propSubject.disabled = isLocked;
  }

  if (propAuthor) {
    propAuthor.value = annotation.author || defaultAuthor;
    propAuthor.disabled = isLocked;
  }

  if (propCreated) {
    propCreated.value = formatDate(annotation.createdAt);
  }

  if (propModified) {
    propModified.value = formatDate(annotation.modifiedAt);
  }

  // Appearance section
  propColor.value = annotation.color || '#000000';
  propColor.disabled = isLocked;

  // Update color palette display
  const mainPalette = document.getElementById('main-color-palette');
  const mainPreview = document.getElementById('prop-color-preview');
  const mainHex = document.getElementById('prop-color-hex');
  if (mainPalette) {
    updateColorDisplay(mainPalette, annotation.color || '#000000', mainPreview, mainHex);
  }

  propLineWidth.value = annotation.lineWidth || 3;
  propLineWidth.disabled = isLocked;

  // Opacity
  if (propOpacity) {
    const opacityVal = annotation.opacity !== undefined ? annotation.opacity * 100 : 100;
    propOpacity.value = opacityVal;
    propOpacity.disabled = isLocked;
    if (propOpacityValue) {
      propOpacityValue.textContent = Math.round(opacityVal) + '%';
    }
  }

  // Icon selector (for comments/sticky notes)
  if (propIconGroup) {
    if (annotation.type === 'comment') {
      propIconGroup.style.display = 'grid';
      if (propIcon) {
        propIcon.value = annotation.icon || 'comment';
        propIcon.disabled = isLocked;
      }
    } else {
      propIconGroup.style.display = 'none';
    }
  }

  // Fill color (for shapes with fill)
  if (propFillColorGroup) {
    if (['highlight', 'box', 'circle', 'textbox', 'callout'].includes(annotation.type)) {
      propFillColorGroup.style.display = 'grid';
      const fillPreview = document.getElementById('prop-fill-color-preview');
      const fillHex = document.getElementById('prop-fill-color-hex');

      // Check if fill color is None (null/undefined/empty)
      if (!annotation.fillColor) {
        // Show "None" state
        if (fillPreview) {
          fillPreview.style.background = 'linear-gradient(135deg, #fff 45%, #ff0000 45%, #ff0000 55%, #fff 55%)';
        }
        if (fillHex) {
          fillHex.textContent = 'None';
        }
        if (propFillColor) {
          propFillColor.value = '#ffffff';
          propFillColor.disabled = isLocked;
        }
      } else {
        if (propFillColor) {
          propFillColor.value = annotation.fillColor;
          propFillColor.disabled = isLocked;
        }
        // Update fill color palette display
        const fillPalette = document.getElementById('fill-color-palette');
        if (fillPalette) {
          updateColorDisplay(fillPalette, annotation.fillColor, fillPreview, fillHex);
        }
      }
    } else {
      propFillColorGroup.style.display = 'none';
    }
  }

  // Stroke color (for shapes)
  if (propStrokeColorGroup) {
    if (['line', 'box', 'circle', 'draw', 'textbox', 'callout'].includes(annotation.type)) {
      propStrokeColorGroup.style.display = 'grid';
      if (propStrokeColor) {
        propStrokeColor.value = annotation.strokeColor || annotation.color || '#000000';
        propStrokeColor.disabled = isLocked;
      }
      // Update stroke color palette display
      const strokePalette = document.getElementById('stroke-color-palette');
      const strokePreview = document.getElementById('prop-stroke-color-preview');
      const strokeHex = document.getElementById('prop-stroke-color-hex');
      if (strokePalette) {
        updateColorDisplay(strokePalette, annotation.strokeColor || annotation.color || '#000000', strokePreview, strokeHex);
      }
    } else {
      propStrokeColorGroup.style.display = 'none';
    }
  }

  // Border style (for textbox and callout)
  if (propBorderStyleGroup) {
    if (['textbox', 'callout'].includes(annotation.type)) {
      propBorderStyleGroup.style.display = 'grid';
      if (propBorderStyle) {
        propBorderStyle.value = annotation.borderStyle || 'solid';
        propBorderStyle.disabled = isLocked;
      }
    } else {
      propBorderStyleGroup.style.display = 'none';
    }
  }

  // Hide general color for types that use fill/stroke or images
  const propColorGroup = document.getElementById('prop-color-group');
  if (propColorGroup) {
    if (['line', 'box', 'circle', 'draw', 'highlight', 'image', 'textbox', 'callout'].includes(annotation.type)) {
      propColorGroup.style.display = 'none';
    } else {
      propColorGroup.style.display = 'grid';
    }
  }

  // Image-specific properties
  const propImageSection = document.getElementById('prop-image-section');
  const propImageWidth = document.getElementById('prop-image-width');
  const propImageHeight = document.getElementById('prop-image-height');
  const propImageRotation = document.getElementById('prop-image-rotation');

  if (annotation.type === 'image') {
    if (propImageSection) propImageSection.style.display = 'block';
    if (propImageWidth) {
      propImageWidth.value = Math.round(annotation.width);
      propImageWidth.disabled = isLocked;
    }
    if (propImageHeight) {
      propImageHeight.value = Math.round(annotation.height);
      propImageHeight.disabled = isLocked;
    }
    if (propImageRotation) {
      propImageRotation.value = Math.round(annotation.rotation || 0);
      propImageRotation.disabled = isLocked;
    }
  } else {
    if (propImageSection) propImageSection.style.display = 'none';
  }

  // Content section (for text/comments)
  const propContentSection = document.getElementById('prop-content-section');
  if (annotation.type === 'text' || annotation.type === 'comment') {
    if (propContentSection) propContentSection.style.display = 'block';
    if (propTextGroup) propTextGroup.style.display = 'grid';
    propText.value = annotation.text || '';
    propText.disabled = isLocked;
  } else {
    if (propContentSection) propContentSection.style.display = 'none';
    if (propTextGroup) propTextGroup.style.display = 'none';
  }

  if (annotation.type === 'text') {
    if (propFontSizeGroup) propFontSizeGroup.style.display = 'grid';
    propFontSize.value = annotation.fontSize || 16;
    propFontSize.disabled = isLocked;
  } else {
    if (propFontSizeGroup) propFontSizeGroup.style.display = 'none';
  }

  // Text formatting section (for textbox/callout)
  if (propTextFormatSection) {
    if (['textbox', 'callout'].includes(annotation.type)) {
      propTextFormatSection.style.display = 'block';

      // Text color
      if (propTextColor) {
        const textColorValue = annotation.textColor || annotation.color || '#000000';
        propTextColor.value = textColorValue;
        propTextColor.disabled = isLocked;
        // Update text color palette display
        const textColorPalette = document.getElementById('text-color-palette');
        const textColorPreview = document.getElementById('prop-text-color-preview');
        const textColorHex = document.getElementById('prop-text-color-hex');
        if (textColorPalette) {
          updateColorDisplay(textColorPalette, textColorValue, textColorPreview, textColorHex);
        }
      }

      // Font family
      if (propFontFamily) {
        propFontFamily.value = annotation.fontFamily || 'Arial';
        propFontFamily.disabled = isLocked;
      }

      // Font size
      if (propTextFontSize) {
        propTextFontSize.value = annotation.fontSize || 14;
        propTextFontSize.disabled = isLocked;
      }

      // Text styles (bold, italic, underline, strikethrough)
      if (propTextBold) {
        propTextBold.classList.toggle('active', annotation.fontBold || false);
        propTextBold.disabled = isLocked;
      }
      if (propTextItalic) {
        propTextItalic.classList.toggle('active', annotation.fontItalic || false);
        propTextItalic.disabled = isLocked;
      }
      if (propTextUnderline) {
        propTextUnderline.classList.toggle('active', annotation.fontUnderline || false);
        propTextUnderline.disabled = isLocked;
      }
      if (propTextStrikethrough) {
        propTextStrikethrough.classList.toggle('active', annotation.fontStrikethrough || false);
        propTextStrikethrough.disabled = isLocked;
      }
    } else {
      propTextFormatSection.style.display = 'none';
    }
  }

  // Paragraph section (for textbox/callout)
  if (propParagraphSection) {
    if (['textbox', 'callout'].includes(annotation.type)) {
      propParagraphSection.style.display = 'block';

      // Text alignment
      const align = annotation.textAlign || 'left';
      if (propAlignLeft) {
        propAlignLeft.classList.toggle('active', align === 'left');
        propAlignLeft.disabled = isLocked;
      }
      if (propAlignCenter) {
        propAlignCenter.classList.toggle('active', align === 'center');
        propAlignCenter.disabled = isLocked;
      }
      if (propAlignRight) {
        propAlignRight.classList.toggle('active', align === 'right');
        propAlignRight.disabled = isLocked;
      }

      // Line spacing
      if (propLineSpacing) {
        propLineSpacing.value = annotation.lineSpacing || '1.5';
        propLineSpacing.disabled = isLocked;
      }
    } else {
      propParagraphSection.style.display = 'none';
    }
  }

  // Line width visibility
  if (['highlight', 'comment', 'image'].includes(annotation.type)) {
    if (propLineWidthGroup) propLineWidthGroup.style.display = 'none';
  } else {
    if (propLineWidthGroup) propLineWidthGroup.style.display = 'grid';
  }

  // Status properties (now in General section as dropdowns)
  if (propLocked) {
    propLocked.value = annotation.locked ? 'yes' : 'no';
  }

  if (propPrintable) {
    propPrintable.value = annotation.printable !== false ? 'yes' : 'no';
    propPrintable.disabled = isLocked;
  }

  // Read Only property
  const propReadOnly = document.getElementById('prop-readonly');
  if (propReadOnly) {
    propReadOnly.value = annotation.readOnly ? 'yes' : 'no';
    propReadOnly.disabled = isLocked;
  }

  // Marked property
  const propMarked = document.getElementById('prop-marked');
  if (propMarked) {
    propMarked.value = annotation.marked ? 'yes' : 'no';
    propMarked.disabled = isLocked;
  }

  // Disable delete button if locked
  if (propDelete) {
    propDelete.disabled = isLocked;
    propDelete.style.opacity = isLocked ? '0.5' : '1';
    propDelete.style.cursor = isLocked ? 'not-allowed' : 'pointer';
  }

  propertiesPanel.classList.add('visible');
  redrawAnnotations();
}

// Hide properties panel
function hideProperties() {
  selectedAnnotation = null;
  propertiesPanel.classList.remove('visible');
  redrawAnnotations();
}

// Update annotation properties
function updateAnnotationProperties() {
  if (!selectedAnnotation) return;

  // Check if locked - don't update if locked (except for lock toggle itself)
  if (selectedAnnotation.locked && propLocked && propLocked.value === 'no') {
    // Allow unlocking
    selectedAnnotation.locked = false;
    selectedAnnotation.modifiedAt = new Date().toISOString();
    showProperties(selectedAnnotation); // Refresh the panel to enable fields
    return;
  }

  if (selectedAnnotation.locked) return;

  // Update modified timestamp
  selectedAnnotation.modifiedAt = new Date().toISOString();

  // General properties
  if (propSubject) {
    selectedAnnotation.subject = propSubject.value;
  }

  if (propAuthor) {
    selectedAnnotation.author = propAuthor.value;
  }

  // Appearance properties
  selectedAnnotation.color = propColor.value;
  selectedAnnotation.lineWidth = parseInt(propLineWidth.value);

  // Opacity
  if (propOpacity) {
    selectedAnnotation.opacity = parseInt(propOpacity.value) / 100;
    if (propOpacityValue) {
      propOpacityValue.textContent = propOpacity.value + '%';
    }
  }

  // Icon (for comments)
  if (propIcon && selectedAnnotation.type === 'comment') {
    selectedAnnotation.icon = propIcon.value;
  }

  // Fill color - only update if not set to "None"
  if (propFillColor && ['highlight', 'box', 'circle', 'textbox', 'callout'].includes(selectedAnnotation.type)) {
    const fillHex = document.getElementById('prop-fill-color-hex');
    // Check if fill is currently "None" - if so, don't overwrite with the color input value
    const isNone = fillHex && fillHex.textContent === 'None';
    if (!isNone) {
      selectedAnnotation.fillColor = propFillColor.value;
      // Keep color in sync for backward compatibility (except textbox/callout which have separate text color)
      if (!['textbox', 'callout'].includes(selectedAnnotation.type)) {
        selectedAnnotation.color = propFillColor.value;
      }
      if (fillHex) {
        fillHex.textContent = propFillColor.value.toUpperCase();
      }
    }
  }

  // Stroke color
  if (propStrokeColor && ['line', 'box', 'circle', 'draw', 'textbox', 'callout'].includes(selectedAnnotation.type)) {
    selectedAnnotation.strokeColor = propStrokeColor.value;
    // For types that primarily use stroke, update color too
    if (['line', 'draw'].includes(selectedAnnotation.type)) {
      selectedAnnotation.color = propStrokeColor.value;
    }
    const strokeHex = document.getElementById('prop-stroke-color-hex');
    if (strokeHex) {
      strokeHex.textContent = propStrokeColor.value.toUpperCase();
    }
  }

  // Border style (for textbox and callout)
  if (propBorderStyle && ['textbox', 'callout'].includes(selectedAnnotation.type)) {
    selectedAnnotation.borderStyle = propBorderStyle.value;
  }

  // Update color hex display
  const colorHex = document.getElementById('prop-color-hex');
  if (colorHex) {
    colorHex.textContent = propColor.value.toUpperCase();
  }

  // Content properties
  if (selectedAnnotation.type === 'text' || selectedAnnotation.type === 'comment') {
    selectedAnnotation.text = propText.value;
  }

  if (selectedAnnotation.type === 'text') {
    selectedAnnotation.fontSize = parseInt(propFontSize.value);
  }

  // Status properties (now using select dropdowns)
  if (propLocked) {
    selectedAnnotation.locked = propLocked.value === 'yes';
  }

  if (propPrintable) {
    selectedAnnotation.printable = propPrintable.value === 'yes';
  }

  // Read Only property
  const propReadOnly = document.getElementById('prop-readonly');
  if (propReadOnly) {
    selectedAnnotation.readOnly = propReadOnly.value === 'yes';
  }

  // Marked property
  const propMarked = document.getElementById('prop-marked');
  if (propMarked) {
    selectedAnnotation.marked = propMarked.value === 'yes';
  }

  // Update modified date display
  if (propModified) {
    propModified.value = formatDate(selectedAnnotation.modifiedAt);
  }

  // Redraw based on view mode
  if (viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }

  // If annotation was just locked, refresh panel to disable fields
  if (propLocked && propLocked.value === 'yes') {
    showProperties(selectedAnnotation);
  }
}

// Tool selection
function setTool(tool) {
  // Cancel any ongoing polyline drawing when switching tools
  if (isDrawingPolyline && tool !== 'polyline') {
    polylinePoints = [];
    isDrawingPolyline = false;
    redrawAnnotations();
  }

  currentTool = tool;

  // Hide properties panel when switching tools
  if (tool !== 'select') {
    hideProperties();
  }

  // Update UI - remove active state from all tool buttons
  [toolSelect, toolHighlight, toolDraw, toolLine, toolCircle, toolBox, toolComment, toolText].forEach(btn => {
    if (btn) btn.classList.remove('active');
  });
  // Also remove from optional buttons
  [toolPolygon, toolCloud, toolPolyline, toolTextbox, toolCallout].forEach(btn => {
    if (btn) btn.classList.remove('active');
  });

  switch (tool) {
    case 'select':
      toolSelect.classList.add('active');
      annotationCanvas.style.cursor = 'default';
      break;
    case 'highlight':
      toolHighlight.classList.add('active');
      annotationCanvas.style.cursor = 'crosshair';
      break;
    case 'draw':
      toolDraw.classList.add('active');
      annotationCanvas.style.cursor = 'crosshair';
      break;
    case 'line':
      toolLine.classList.add('active');
      annotationCanvas.style.cursor = 'crosshair';
      break;
    case 'circle':
      toolCircle.classList.add('active');
      annotationCanvas.style.cursor = 'crosshair';
      break;
    case 'box':
      toolBox.classList.add('active');
      annotationCanvas.style.cursor = 'crosshair';
      break;
    case 'polygon':
      if (toolPolygon) toolPolygon.classList.add('active');
      annotationCanvas.style.cursor = 'crosshair';
      break;
    case 'cloud':
      if (toolCloud) toolCloud.classList.add('active');
      annotationCanvas.style.cursor = 'crosshair';
      break;
    case 'polyline':
      if (toolPolyline) toolPolyline.classList.add('active');
      annotationCanvas.style.cursor = 'crosshair';
      break;
    case 'comment':
      toolComment.classList.add('active');
      annotationCanvas.style.cursor = 'pointer';
      break;
    case 'text':
      toolText.classList.add('active');
      annotationCanvas.style.cursor = 'text';
      break;
    case 'textbox':
      if (toolTextbox) toolTextbox.classList.add('active');
      annotationCanvas.style.cursor = 'crosshair';
      break;
    case 'callout':
      if (toolCallout) toolCallout.classList.add('active');
      annotationCanvas.style.cursor = 'crosshair';
      break;
  }

  // Update status bar
  updateStatusTool(tool);
}

// Status bar update functions
function updateStatusTool(tool) {
  if (!statusTool) return;
  const toolNames = {
    'select': 'Select',
    'highlight': 'Highlight',
    'draw': 'Freehand',
    'line': 'Line',
    'polyline': 'Polyline',
    'circle': 'Ellipse',
    'box': 'Rectangle',
    'polygon': 'Polygon',
    'cloud': 'Cloud',
    'comment': 'Note',
    'text': 'Text',
    'textbox': 'Text Box',
    'callout': 'Callout'
  };
  statusTool.textContent = toolNames[tool] || tool;
}

function updateStatusPage() {
  if (!statusPage) return;
  if (pdfDoc) {
    statusPage.textContent = `${currentPage} / ${pdfDoc.numPages}`;
  } else {
    statusPage.textContent = '-';
  }
}

function updateStatusZoom() {
  if (!statusZoom) return;
  statusZoom.textContent = `${Math.round(scale * 100)}%`;
}

function updateStatusAnnotations() {
  if (!statusAnnotations) return;
  const pageAnnotations = annotations.filter(a => a.page === currentPage);
  statusAnnotations.textContent = `${pageAnnotations.length} (${annotations.length} total)`;
}

function updateStatusMessage(message) {
  if (!statusMessage) return;
  statusMessage.textContent = message || 'Ready';
}

function updateAllStatus() {
  updateStatusPage();
  updateStatusZoom();
  updateStatusAnnotations();
  updateAnnotationsList();
}

// Annotations list panel functions
function getAnnotationIcon(type) {
  const icons = {
    rectangle: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" stroke-width="2"/></svg>',
    circle: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" stroke-width="2"/></svg>',
    ellipse: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="10" ry="6" stroke-width="2"/></svg>',
    line: '<svg viewBox="0 0 24 24"><line x1="4" y1="20" x2="20" y2="4" stroke-width="2"/></svg>',
    arrow: '<svg viewBox="0 0 24 24"><line x1="4" y1="20" x2="20" y2="4" stroke-width="2"/><polyline points="14,4 20,4 20,10" stroke-width="2"/></svg>',
    freehand: '<svg viewBox="0 0 24 24"><path d="M3 17c3-3 6-10 9-10s3 4 6 4s3-3 3-3" stroke-width="2" fill="none"/></svg>',
    highlight: '<svg viewBox="0 0 24 24"><rect x="2" y="8" width="20" height="8" fill="currentColor" opacity="0.3"/></svg>',
    underline: '<svg viewBox="0 0 24 24"><line x1="4" y1="18" x2="20" y2="18" stroke-width="2"/><path d="M6 4v8a6 6 0 0 0 12 0V4" stroke-width="2" fill="none"/></svg>',
    strikeout: '<svg viewBox="0 0 24 24"><line x1="4" y1="12" x2="20" y2="12" stroke-width="2"/><text x="12" y="16" text-anchor="middle" font-size="10">abc</text></svg>',
    textbox: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" stroke-width="2"/><line x1="7" y1="9" x2="17" y2="9" stroke-width="1.5"/><line x1="7" y1="12" x2="14" y2="12" stroke-width="1.5"/></svg>',
    comment: '<svg viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" stroke-width="2"/></svg>',
    callout: '<svg viewBox="0 0 24 24"><path d="M4 4h16v12H8l-4 4V4z" stroke-width="2"/></svg>',
    stamp: '<svg viewBox="0 0 24 24"><rect x="3" y="14" width="18" height="6" rx="1" stroke-width="2"/><path d="M8 14V8a4 4 0 0 1 8 0v6" stroke-width="2"/></svg>',
    image: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" stroke-width="2"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><path d="M21 15l-5-5L5 21" stroke-width="2"/></svg>',
    polygon: '<svg viewBox="0 0 24 24"><polygon points="12,2 22,8 22,16 12,22 2,16 2,8" stroke-width="2" fill="none"/></svg>',
    polyline: '<svg viewBox="0 0 24 24"><polyline points="4,18 8,10 14,14 20,6" stroke-width="2" fill="none"/></svg>',
    ink: '<svg viewBox="0 0 24 24"><path d="M3 17c3-3 6-10 9-10s3 4 6 4s3-3 3-3" stroke-width="2" fill="none"/></svg>',
    default: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>'
  };
  return icons[type] || icons.default;
}

function getAnnotationColor(ann) {
  return ann.color || ann.strokeColor || ann.fillColor || '#3b82f6';
}

function getAnnotationDetails(ann) {
  if (ann.text) return ann.text.substring(0, 30) + (ann.text.length > 30 ? '...' : '');
  if (ann.subject) return ann.subject;
  if (ann.author) return `By ${ann.author}`;
  return '';
}

function updateAnnotationsList() {
  if (!annotationsListContent || !annotationsListCount) return;

  const filterValue = annotationsListFilter?.value || 'all';
  let filteredAnnotations = filterValue === 'current'
    ? annotations.filter(a => a.page === currentPage)
    : [...annotations];

  // Sort by page, then by creation time
  filteredAnnotations.sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page;
    return (a.createdAt || '').localeCompare(b.createdAt || '');
  });

  // Update count
  const countText = filterValue === 'current'
    ? `${filteredAnnotations.length} on page ${currentPage} (${annotations.length} total)`
    : `${annotations.length} annotations`;
  annotationsListCount.textContent = countText;

  // Clear current content
  annotationsListContent.innerHTML = '';

  if (filteredAnnotations.length === 0) {
    annotationsListContent.innerHTML = `
      <div class="annotations-list-empty">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
        </svg>
        <p>No annotations${filterValue === 'current' ? ' on this page' : ''}</p>
      </div>
    `;
    return;
  }

  // Create list items
  filteredAnnotations.forEach((ann, index) => {
    const item = document.createElement('div');
    item.className = 'annotation-list-item';
    if (selectedAnnotation === ann) {
      item.classList.add('selected');
    }

    const color = getAnnotationColor(ann);
    const icon = getAnnotationIcon(ann.type);
    const details = getAnnotationDetails(ann);
    const typeName = ann.type.charAt(0).toUpperCase() + ann.type.slice(1);

    item.innerHTML = `
      <div class="annotation-list-icon" style="background: ${color}20; color: ${color};">
        ${icon}
      </div>
      <div class="annotation-list-info">
        <div class="annotation-list-type">${typeName}</div>
        <div class="annotation-list-details">${details || 'No description'}</div>
      </div>
      <div class="annotation-list-page">P${ann.page}</div>
    `;

    item.addEventListener('click', () => {
      // Navigate to the page if different
      if (ann.page !== currentPage) {
        currentPage = ann.page;
        renderPage(currentPage);
      }

      // Select the annotation
      selectedAnnotation = ann;
      drawAnnotations();
      showPropertiesPanel(ann);
      updateAnnotationsList();
    });

    annotationsListContent.appendChild(item);
  });
}

function toggleAnnotationsListPanel() {
  if (annotationsListPanel) {
    annotationsListPanel.classList.toggle('visible');
    if (annotationsListPanel.classList.contains('visible')) {
      updateAnnotationsList();
    }
  }
}

function showAnnotationsListPanel() {
  if (annotationsListPanel) {
    annotationsListPanel.classList.add('visible');
    updateAnnotationsList();
  }
}

function hideAnnotationsListPanel() {
  if (annotationsListPanel) {
    annotationsListPanel.classList.remove('visible');
  }
}

// Add event listener for filter change
if (annotationsListFilter) {
  annotationsListFilter.addEventListener('change', updateAnnotationsList);
}

// Mouse event handlers
annotationCanvas.addEventListener('mousedown', (e) => {
  const rect = annotationCanvas.getBoundingClientRect();
  // Convert to unscaled coordinates for storage
  startX = (e.clientX - rect.left) / scale;
  startY = (e.clientY - rect.top) / scale;

  if (currentTool === 'select') {
    // First check if clicking on a handle of the selected annotation
    if (selectedAnnotation && !selectedAnnotation.locked) {
      const handle = findHandleAt(startX, startY, selectedAnnotation);
      if (handle) {
        // Start resizing
        isResizing = true;
        activeHandle = handle;
        dragStartX = startX;
        dragStartY = startY;
        originalAnnotation = cloneAnnotation(selectedAnnotation);
        return;
      }

      // Check if clicking inside the selected annotation (for moving)
      if (isPointInsideAnnotation(startX, startY, selectedAnnotation)) {
        isDragging = true;
        dragStartX = startX;
        dragStartY = startY;
        originalAnnotation = cloneAnnotation(selectedAnnotation);
        annotationCanvas.style.cursor = 'move';
        return;
      }
    }

    // Check if clicking on a different annotation
    const clickedAnnotation = findAnnotationAt(startX, startY);
    if (clickedAnnotation) {
      showProperties(clickedAnnotation);
      // Check if we should start moving immediately
      if (!clickedAnnotation.locked) {
        isDragging = true;
        dragStartX = startX;
        dragStartY = startY;
        originalAnnotation = cloneAnnotation(clickedAnnotation);
        annotationCanvas.style.cursor = 'move';
      }
    } else {
      hideProperties();
    }
    return;
  }

  isDrawing = true;

  if (currentTool === 'draw') {
    currentPath = [{ x: startX, y: startY }];
  } else if (currentTool === 'polyline') {
    // For polyline, add points on each click
    if (!isDrawingPolyline) {
      // Start new polyline
      polylinePoints = [{ x: startX, y: startY }];
      isDrawingPolyline = true;
    } else {
      // Add another point
      polylinePoints.push({ x: startX, y: startY });
    }
    isDrawing = false; // Don't use regular drawing mode
  } else if (currentTool === 'comment') {
    addComment(startX, startY);
    isDrawing = false;
  } else if (currentTool === 'text') {
    addText(startX, startY);
    isDrawing = false;
  }
});

annotationCanvas.addEventListener('mousemove', (e) => {
  const rect = annotationCanvas.getBoundingClientRect();
  // Convert to unscaled coordinates
  const currentX = (e.clientX - rect.left) / scale;
  const currentY = (e.clientY - rect.top) / scale;

  // Handle cursor feedback when hovering over handles or annotations
  if (currentTool === 'select' && !isDragging && !isResizing && !isDrawing) {
    if (selectedAnnotation) {
      const handle = findHandleAt(currentX, currentY, selectedAnnotation);
      if (handle) {
        annotationCanvas.style.cursor = getCursorForHandle(handle);
        return;
      }
      if (isPointInsideAnnotation(currentX, currentY, selectedAnnotation)) {
        annotationCanvas.style.cursor = selectedAnnotation.locked ? 'not-allowed' : 'move';
        return;
      }
    }
    // Check if hovering over any annotation
    const hoverAnnotation = findAnnotationAt(currentX, currentY);
    if (hoverAnnotation) {
      annotationCanvas.style.cursor = hoverAnnotation.locked ? 'not-allowed' : 'pointer';
    } else {
      annotationCanvas.style.cursor = 'default';
    }
    return;
  }

  // Handle resizing or rotation
  if (isResizing && selectedAnnotation && activeHandle) {
    // Handle rotation separately
    if (activeHandle === HANDLE_TYPES.ROTATE) {
      Object.assign(selectedAnnotation, cloneAnnotation(originalAnnotation));
      window.shiftKeyPressed = e.shiftKey;
      applyRotation(selectedAnnotation, currentX, currentY, originalAnnotation);
      redrawAnnotations();
      return;
    }

    const deltaX = currentX - dragStartX;
    const deltaY = currentY - dragStartY;

    // Restore original and apply resize
    Object.assign(selectedAnnotation, cloneAnnotation(originalAnnotation));
    applyResize(selectedAnnotation, activeHandle, deltaX, deltaY, originalAnnotation, e.shiftKey);

    redrawAnnotations();
    return;
  }

  // Handle dragging (moving)
  if (isDragging && selectedAnnotation) {
    const deltaX = currentX - dragStartX;
    const deltaY = currentY - dragStartY;

    // Restore original position and apply move
    Object.assign(selectedAnnotation, cloneAnnotation(originalAnnotation));
    applyMove(selectedAnnotation, deltaX, deltaY);

    redrawAnnotations();
    return;
  }

  // Handle polyline preview (separate from isDrawing)
  if (currentTool === 'polyline' && isDrawingPolyline && polylinePoints.length > 0) {
    redrawAnnotations();
    annotationCtx.strokeStyle = colorPicker.value;
    annotationCtx.lineWidth = parseInt(lineWidth.value);
    annotationCtx.lineCap = 'round';
    annotationCtx.lineJoin = 'round';
    annotationCtx.beginPath();
    // Draw existing points
    polylinePoints.forEach((point, index) => {
      if (index === 0) {
        annotationCtx.moveTo(point.x, point.y);
      } else {
        annotationCtx.lineTo(point.x, point.y);
      }
    });
    // Draw line to current mouse position
    annotationCtx.lineTo(currentX, currentY);
    annotationCtx.stroke();
    // Draw small circles at each point
    polylinePoints.forEach(point => {
      annotationCtx.beginPath();
      annotationCtx.arc(point.x, point.y, 4, 0, 2 * Math.PI);
      annotationCtx.fillStyle = colorPicker.value;
      annotationCtx.fill();
    });
    return;
  }

  if (!isDrawing) return;

  if (currentTool === 'draw') {
    currentPath.push({ x: currentX, y: currentY });

    // Draw temporary line with scale
    annotationCtx.save();
    annotationCtx.scale(scale, scale);
    annotationCtx.strokeStyle = colorPicker.value;
    annotationCtx.lineWidth = parseInt(lineWidth.value);
    annotationCtx.lineCap = 'round';
    annotationCtx.lineJoin = 'round';
    annotationCtx.beginPath();
    annotationCtx.moveTo(currentPath[currentPath.length - 2].x, currentPath[currentPath.length - 2].y);
    annotationCtx.lineTo(currentX, currentY);
    annotationCtx.stroke();
    annotationCtx.restore();
  } else if (currentTool === 'highlight') {
    // Show preview rectangle
    redrawAnnotations();
    annotationCtx.save();
    annotationCtx.scale(scale, scale);
    annotationCtx.fillStyle = colorPicker.value;
    annotationCtx.globalAlpha = 0.3;
    annotationCtx.fillRect(
      startX,
      startY,
      currentX - startX,
      currentY - startY
    );
    annotationCtx.globalAlpha = 1;
    annotationCtx.restore();
  } else if (currentTool === 'line') {
    // Show preview line
    redrawAnnotations();
    annotationCtx.save();
    annotationCtx.scale(scale, scale);
    let lineEndX = currentX;
    let lineEndY = currentY;

    // Snap to angle increments when Shift is held (and angle snapping is enabled)
    if (e.shiftKey && preferences.enableAngleSnap) {
      const dx = currentX - startX;
      const dy = currentY - startY;
      const length = Math.sqrt(dx * dx + dy * dy);
      const currentAngle = Math.atan2(dy, dx) * (180 / Math.PI);
      const snappedAngle = snapAngle(currentAngle, preferences.angleSnapDegrees) * (Math.PI / 180);
      lineEndX = startX + length * Math.cos(snappedAngle);
      lineEndY = startY + length * Math.sin(snappedAngle);
    }

    annotationCtx.strokeStyle = colorPicker.value;
    annotationCtx.lineWidth = parseInt(lineWidth.value);
    annotationCtx.lineCap = 'round';
    annotationCtx.beginPath();
    annotationCtx.moveTo(startX, startY);
    annotationCtx.lineTo(lineEndX, lineEndY);
    annotationCtx.stroke();
    annotationCtx.restore();
  } else if (currentTool === 'circle') {
    // Show preview ellipse that fits in bounding box using preference colors
    redrawAnnotations();
    annotationCtx.save();
    annotationCtx.scale(scale, scale);
    const circleX = Math.min(startX, currentX);
    const circleY = Math.min(startY, currentY);
    const circleW = Math.abs(currentX - startX);
    const circleH = Math.abs(currentY - startY);
    const circleCX = circleX + circleW / 2;
    const circleCY = circleY + circleH / 2;

    if (circleW > 0 && circleH > 0) {
      annotationCtx.beginPath();
      annotationCtx.ellipse(circleCX, circleCY, circleW / 2, circleH / 2, 0, 0, 2 * Math.PI);

      // Fill with preference color if not "None"
      if (!preferences.circleFillNone) {
        annotationCtx.fillStyle = preferences.circleFillColor;
        annotationCtx.globalAlpha = preferences.circleOpacity / 100;
        annotationCtx.fill();
        annotationCtx.globalAlpha = 1;
      }

      annotationCtx.strokeStyle = preferences.circleStrokeColor;
      annotationCtx.lineWidth = preferences.circleBorderWidth;
      annotationCtx.stroke();
    }
    annotationCtx.restore();
  } else if (currentTool === 'box') {
    // Show preview rectangle using preference colors
    redrawAnnotations();
    annotationCtx.save();
    annotationCtx.scale(scale, scale);
    const boxX = Math.min(startX, currentX);
    const boxY = Math.min(startY, currentY);
    const boxW = Math.abs(currentX - startX);
    const boxH = Math.abs(currentY - startY);

    // Fill with preference color if not "None"
    if (!preferences.rectFillNone) {
      annotationCtx.fillStyle = preferences.rectFillColor;
      annotationCtx.globalAlpha = preferences.rectOpacity / 100;
      annotationCtx.fillRect(boxX, boxY, boxW, boxH);
      annotationCtx.globalAlpha = 1;
    }

    annotationCtx.strokeStyle = preferences.rectStrokeColor;
    annotationCtx.lineWidth = preferences.rectBorderWidth;
    annotationCtx.strokeRect(boxX, boxY, boxW, boxH);
    annotationCtx.restore();
  } else if (currentTool === 'polygon') {
    // Show preview polygon (hexagon)
    redrawAnnotations();
    annotationCtx.save();
    annotationCtx.scale(scale, scale);
    const width = currentX - startX;
    const height = currentY - startY;
    const cx = startX + width / 2;
    const cy = startY + height / 2;
    const rx = Math.abs(width) / 2;
    const ry = Math.abs(height) / 2;
    const sides = 6;

    annotationCtx.strokeStyle = colorPicker.value;
    annotationCtx.lineWidth = parseInt(lineWidth.value);
    annotationCtx.beginPath();
    for (let i = 0; i <= sides; i++) {
      const angle = (i * 2 * Math.PI / sides) - Math.PI / 2;
      const px = cx + rx * Math.cos(angle);
      const py = cy + ry * Math.sin(angle);
      if (i === 0) {
        annotationCtx.moveTo(px, py);
      } else {
        annotationCtx.lineTo(px, py);
      }
    }
    annotationCtx.closePath();
    annotationCtx.stroke();
    annotationCtx.restore();
  } else if (currentTool === 'cloud') {
    // Show preview cloud shape
    redrawAnnotations();
    annotationCtx.save();
    annotationCtx.scale(scale, scale);
    const x = Math.min(startX, currentX);
    const y = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);

    if (width > 10 && height > 10) {
      annotationCtx.strokeStyle = colorPicker.value;
      annotationCtx.lineWidth = parseInt(lineWidth.value);
      drawCloudShape(annotationCtx, x, y, width, height);
    }
    annotationCtx.restore();
  } else if (currentTool === 'textbox') {
    // Show preview text box with preference colors
    redrawAnnotations();
    annotationCtx.save();
    annotationCtx.scale(scale, scale);
    const tbX = Math.min(startX, currentX);
    const tbY = Math.min(startY, currentY);
    const tbWidth = Math.abs(currentX - startX);
    const tbHeight = Math.abs(currentY - startY);

    // Set border style
    if (preferences.textboxBorderStyle === 'dashed') {
      annotationCtx.setLineDash([8, 4]);
    } else if (preferences.textboxBorderStyle === 'dotted') {
      annotationCtx.setLineDash([2, 2]);
    } else {
      annotationCtx.setLineDash([]);
    }

    // Draw fill (only if not "None")
    if (!preferences.textboxFillNone) {
      annotationCtx.fillStyle = preferences.textboxFillColor;
      annotationCtx.globalAlpha = (preferences.textboxOpacity || 100) / 100;
      annotationCtx.fillRect(tbX, tbY, tbWidth, tbHeight);
      annotationCtx.globalAlpha = 1;
    }

    // Draw stroke
    annotationCtx.strokeStyle = preferences.textboxStrokeColor;
    annotationCtx.lineWidth = preferences.textboxBorderWidth;
    annotationCtx.strokeRect(tbX, tbY, tbWidth, tbHeight);
    annotationCtx.setLineDash([]);
    annotationCtx.restore();
  } else if (currentTool === 'callout') {
    // Show preview callout with preference colors
    // Mouse down (startX, startY) = arrow tip
    // Mouse up (currentX, currentY) = center of text box
    redrawAnnotations();
    annotationCtx.save();
    annotationCtx.scale(scale, scale);

    // Default text box size
    const defaultWidth = 150;
    const defaultHeight = 60;

    // Text box centered at currentX, currentY
    const coX = currentX - defaultWidth / 2;
    const coY = currentY - defaultHeight / 2;
    const coWidth = defaultWidth;
    const coHeight = defaultHeight;

    // Arrow tip at startX, startY
    const arrowX = startX;
    const arrowY = startY;

    // Calculate two-segment leader line (like PDF-XChange/Adobe)
    const boxCenterX = currentX;
    const boxCenterY = currentY;

    // Determine which edge to connect to based on arrow position
    const isArrowLeft = arrowX < boxCenterX;

    // Connect from left or right edge
    let armOriginX, armOriginY;
    if (isArrowLeft) {
      armOriginX = coX; // Left edge
    } else {
      armOriginX = coX + coWidth; // Right edge
    }
    // Arm origin Y is clamped to the box height
    armOriginY = Math.max(coY, Math.min(coY + coHeight, boxCenterY));

    // Knee point: horizontal arm extends from text box, then bends toward arrow
    const armLength = Math.min(30, Math.abs(arrowX - armOriginX) * 0.4);
    const kneeX = isArrowLeft ? armOriginX - armLength : armOriginX + armLength;
    const kneeY = armOriginY; // Same Y as arm origin (horizontal arm)

    // Set border style
    if (preferences.calloutBorderStyle === 'dashed') {
      annotationCtx.setLineDash([8, 4]);
    } else if (preferences.calloutBorderStyle === 'dotted') {
      annotationCtx.setLineDash([2, 2]);
    } else {
      annotationCtx.setLineDash([]);
    }

    // Draw fill (only if not "None")
    if (!preferences.calloutFillNone) {
      annotationCtx.fillStyle = preferences.calloutFillColor;
      annotationCtx.globalAlpha = (preferences.calloutOpacity || 100) / 100;
      annotationCtx.fillRect(coX, coY, coWidth, coHeight);
      annotationCtx.globalAlpha = 1;
    }

    // Draw stroke
    annotationCtx.strokeStyle = preferences.calloutStrokeColor;
    annotationCtx.lineWidth = preferences.calloutBorderWidth;
    annotationCtx.strokeRect(coX, coY, coWidth, coHeight);

    // Draw leader line
    annotationCtx.beginPath();
    annotationCtx.moveTo(armOriginX, armOriginY);
    annotationCtx.lineTo(kneeX, kneeY);
    annotationCtx.lineTo(arrowX, arrowY);
    annotationCtx.stroke();

    // Draw arrowhead
    const angle = Math.atan2(arrowY - kneeY, arrowX - kneeX);
    const arrowSize = 10;
    annotationCtx.beginPath();
    annotationCtx.moveTo(arrowX, arrowY);
    annotationCtx.lineTo(arrowX - arrowSize * Math.cos(angle - Math.PI / 6), arrowY - arrowSize * Math.sin(angle - Math.PI / 6));
    annotationCtx.moveTo(arrowX, arrowY);
    annotationCtx.lineTo(arrowX - arrowSize * Math.cos(angle + Math.PI / 6), arrowY - arrowSize * Math.sin(angle + Math.PI / 6));
    annotationCtx.stroke();

    annotationCtx.setLineDash([]);
    annotationCtx.restore();
  }
});

// Mouse up handler
annotationCanvas.addEventListener('mouseup', (e) => {
  // Handle end of dragging/resizing
  if (isDragging || isResizing) {
    isDragging = false;
    isResizing = false;
    activeHandle = null;
    originalAnnotation = null;
    annotationCanvas.style.cursor = 'default';

    // Update properties panel with new values
    if (selectedAnnotation) {
      showProperties(selectedAnnotation);
    }
    return;
  }
});

annotationCanvas.addEventListener('mouseup', (e) => {
  if (!isDrawing) return;

  const rect = annotationCanvas.getBoundingClientRect();
  // Convert to unscaled coordinates
  const endX = (e.clientX - rect.left) / scale;
  const endY = (e.clientY - rect.top) / scale;

  if (currentTool === 'draw' && currentPath.length > 1) {
    annotations.push(createAnnotation({
      type: 'draw',
      page: currentPage,
      path: currentPath,
      color: colorPicker.value,
      strokeColor: colorPicker.value,
      lineWidth: parseInt(lineWidth.value)
    }));
    currentPath = [];
  } else if (currentTool === 'highlight') {
    annotations.push(createAnnotation({
      type: 'highlight',
      page: currentPage,
      x: Math.min(startX, endX),
      y: Math.min(startY, endY),
      width: Math.abs(endX - startX),
      height: Math.abs(endY - startY),
      color: colorPicker.value,
      fillColor: colorPicker.value
    }));
  } else if (currentTool === 'line') {
    let finalEndX = endX;
    let finalEndY = endY;

    // Snap to angle increments when Shift is held (and angle snapping is enabled)
    if (e.shiftKey && preferences.enableAngleSnap) {
      const dx = endX - startX;
      const dy = endY - startY;
      const length = Math.sqrt(dx * dx + dy * dy);
      const currentAngle = Math.atan2(dy, dx) * (180 / Math.PI);
      const snappedAngle = snapAngle(currentAngle, preferences.angleSnapDegrees) * (Math.PI / 180);
      finalEndX = startX + length * Math.cos(snappedAngle);
      finalEndY = startY + length * Math.sin(snappedAngle);
    }

    annotations.push(createAnnotation({
      type: 'line',
      page: currentPage,
      startX: startX,
      startY: startY,
      endX: finalEndX,
      endY: finalEndY,
      color: colorPicker.value,
      strokeColor: colorPicker.value,
      lineWidth: parseInt(lineWidth.value)
    }));
  } else if (currentTool === 'circle') {
    // Use bounding box model (x, y, width, height) for ellipse
    const circleX = Math.min(startX, endX);
    const circleY = Math.min(startY, endY);
    const circleW = Math.abs(endX - startX);
    const circleH = Math.abs(endY - startY);
    annotations.push(createAnnotation({
      type: 'circle',
      page: currentPage,
      x: circleX,
      y: circleY,
      width: circleW,
      height: circleH,
      color: preferences.circleStrokeColor,
      strokeColor: preferences.circleStrokeColor,
      fillColor: preferences.circleFillNone ? null : preferences.circleFillColor,
      lineWidth: preferences.circleBorderWidth,
      borderStyle: preferences.circleBorderStyle,
      opacity: preferences.circleOpacity / 100
    }));
  } else if (currentTool === 'box') {
    // Normalize coordinates so x,y is always top-left
    const boxX = Math.min(startX, endX);
    const boxY = Math.min(startY, endY);
    const boxW = Math.abs(endX - startX);
    const boxH = Math.abs(endY - startY);
    annotations.push(createAnnotation({
      type: 'box',
      page: currentPage,
      x: boxX,
      y: boxY,
      width: boxW,
      height: boxH,
      color: preferences.rectStrokeColor,
      strokeColor: preferences.rectStrokeColor,
      fillColor: preferences.rectFillNone ? null : preferences.rectFillColor,
      lineWidth: preferences.rectBorderWidth,
      borderStyle: preferences.rectBorderStyle,
      opacity: preferences.rectOpacity / 100
    }));
  } else if (currentTool === 'polygon') {
    const width = endX - startX;
    const height = endY - startY;
    annotations.push(createAnnotation({
      type: 'polygon',
      page: currentPage,
      x: startX,
      y: startY,
      width: width,
      height: height,
      sides: 6,
      color: colorPicker.value,
      strokeColor: colorPicker.value,
      lineWidth: parseInt(lineWidth.value)
    }));
  } else if (currentTool === 'cloud') {
    const x = Math.min(startX, endX);
    const y = Math.min(startY, endY);
    const width = Math.abs(endX - startX);
    const height = Math.abs(endY - startY);
    if (width > 10 && height > 10) {
      annotations.push(createAnnotation({
        type: 'cloud',
        page: currentPage,
        x: x,
        y: y,
        width: width,
        height: height,
        color: colorPicker.value,
        strokeColor: colorPicker.value,
        lineWidth: parseInt(lineWidth.value)
      }));
    }
  } else if (currentTool === 'textbox') {
    // Create textbox immediately like rectangle - user can edit text via properties panel
    // Normalize coordinates so x,y is always top-left corner with positive width/height
    const x = Math.min(startX, endX);
    const y = Math.min(startY, endY);
    const width = Math.abs(endX - startX);
    const height = Math.abs(endY - startY);
    if (width > 5 && height > 5) {
      annotations.push(createAnnotation({
        type: 'textbox',
        page: currentPage,
        x: x,
        y: y,
        width: width,
        height: height,
        text: '',
        color: '#000000',
        strokeColor: preferences.textboxStrokeColor,
        fillColor: preferences.textboxFillNone ? null : preferences.textboxFillColor,
        fontSize: preferences.textboxFontSize,
        lineWidth: preferences.textboxBorderWidth,
        borderStyle: preferences.textboxBorderStyle,
        opacity: preferences.textboxOpacity / 100
      }));
    }
  } else if (currentTool === 'callout') {
    // Create callout with two-segment leader line (like PDF-XChange/Adobe)
    // Mouse down = arrow tip, mouse up = center of text box
    const defaultWidth = 150;
    const defaultHeight = 60;

    // Text box centered at endX, endY
    const x = endX - defaultWidth / 2;
    const y = endY - defaultHeight / 2;
    const w = defaultWidth;
    const h = defaultHeight;

    // Arrow tip at startX, startY
    const arrowX = startX;
    const arrowY = startY;

    // Calculate arm origin (connection point on text box edge)
    // The arm extends horizontally from this point
    let armOriginX, armOriginY;
    const boxCenterX = endX;
    const boxCenterY = endY;

    // Determine which edge to connect to based on arrow position
    const isArrowLeft = arrowX < boxCenterX;
    const isArrowAbove = arrowY < boxCenterY;

    // Connect from left or right edge
    if (isArrowLeft) {
      armOriginX = x; // Left edge
    } else {
      armOriginX = x + w; // Right edge
    }
    // Arm origin Y is clamped to the box height
    armOriginY = Math.max(y, Math.min(y + h, boxCenterY));

    // Knee point: horizontal arm extends from text box, then bends toward arrow
    // The knee X is partway between the arm origin and arrow
    const armLength = Math.min(30, Math.abs(arrowX - armOriginX) * 0.4);
    const kneeX = isArrowLeft ? armOriginX - armLength : armOriginX + armLength;
    const kneeY = armOriginY; // Same Y as arm origin (horizontal arm)

    annotations.push(createAnnotation({
      type: 'callout',
      page: currentPage,
      x: x,
      y: y,
      width: w,
      height: h,
      text: '',
      color: '#000000',
      strokeColor: preferences.calloutStrokeColor,
      fillColor: preferences.calloutFillNone ? null : preferences.calloutFillColor,
      fontSize: preferences.calloutFontSize,
      lineWidth: preferences.calloutBorderWidth,
      borderStyle: preferences.calloutBorderStyle,
      opacity: preferences.calloutOpacity / 100,
      armOriginX: armOriginX,
      armOriginY: armOriginY,
      kneeX: kneeX,
      kneeY: kneeY,
      arrowX: arrowX,
      arrowY: arrowY
    }));
  }

  isDrawing = false;
  redrawAnnotations();
});

// Double-click handler for polyline and text editing
annotationCanvas.addEventListener('dblclick', (e) => {
  // Handle polyline finish
  if (currentTool === 'polyline' && isDrawingPolyline && polylinePoints.length >= 2) {
    // Finish the polyline - create annotation
    annotations.push(createAnnotation({
      type: 'polyline',
      page: currentPage,
      points: [...polylinePoints],
      color: colorPicker.value,
      strokeColor: colorPicker.value,
      lineWidth: parseInt(lineWidth.value)
    }));

    // Reset polyline state
    polylinePoints = [];
    isDrawingPolyline = false;
    redrawAnnotations();
    return;
  }

  // Handle double-click to edit text in textbox/callout
  const rect = annotationCanvas.getBoundingClientRect();
  // Convert to unscaled coordinates
  const x = (e.clientX - rect.left) / scale;
  const y = (e.clientY - rect.top) / scale;

  const clickedAnnotation = findAnnotationAt(x, y);
  if (clickedAnnotation && (clickedAnnotation.type === 'textbox' || clickedAnnotation.type === 'callout')) {
    if (clickedAnnotation.locked) return;

    // Create text input overlay
    startTextEditing(clickedAnnotation);
  }
});

// Text editing state
let editingAnnotation = null;
let textEditOverlay = null;

// Show properties panel in text editing mode (only Character and Paragraph sections)
function showTextEditingProperties(annotation) {
  // Show properties panel
  propertiesPanel.classList.add('visible');

  // Hide all other sections
  if (propGeneralSection) propGeneralSection.style.display = 'none';
  if (propAppearanceSection) propAppearanceSection.style.display = 'none';
  if (propContentSection) propContentSection.style.display = 'none';
  if (propImageSection) propImageSection.style.display = 'none';
  if (propActionsSection) propActionsSection.style.display = 'none';

  // Show only Character and Paragraph sections
  if (propTextFormatSection) propTextFormatSection.style.display = 'block';
  if (propParagraphSection) propParagraphSection.style.display = 'block';

  // Populate text formatting values
  if (propTextColor) propTextColor.value = annotation.textColor || annotation.color || '#000000';
  if (propFontFamily) propFontFamily.value = annotation.fontFamily || 'Arial';
  if (propTextFontSize) propTextFontSize.value = annotation.fontSize || 14;
  if (propTextBold) propTextBold.classList.toggle('active', !!annotation.fontBold);
  if (propTextItalic) propTextItalic.classList.toggle('active', !!annotation.fontItalic);
  if (propTextUnderline) propTextUnderline.classList.toggle('active', !!annotation.fontUnderline);
  if (propTextStrikethrough) propTextStrikethrough.classList.toggle('active', !!annotation.fontStrikethrough);

  // Populate paragraph values
  const align = annotation.textAlign || 'left';
  if (propAlignLeft) propAlignLeft.classList.toggle('active', align === 'left');
  if (propAlignCenter) propAlignCenter.classList.toggle('active', align === 'center');
  if (propAlignRight) propAlignRight.classList.toggle('active', align === 'right');
  if (propLineSpacing) propLineSpacing.value = annotation.lineSpacing || 1.2;
}

// Start editing text in a textbox or callout
function startTextEditing(annotation) {
  if (editingAnnotation) {
    finishTextEditing();
  }

  editingAnnotation = annotation;

  // Create textarea overlay
  textEditOverlay = document.createElement('textarea');
  textEditOverlay.className = 'text-edit-overlay';
  textEditOverlay.value = annotation.text || '';

  // Position the textarea over the annotation (accounting for scale)
  const canvasRect = annotationCanvas.getBoundingClientRect();
  const width = annotation.width || 150;
  const height = annotation.height || 50;

  textEditOverlay.style.position = 'absolute';
  textEditOverlay.style.left = (canvasRect.left + annotation.x * scale + window.scrollX) + 'px';
  textEditOverlay.style.top = (canvasRect.top + annotation.y * scale + window.scrollY) + 'px';
  textEditOverlay.style.width = (width * scale) + 'px';
  textEditOverlay.style.height = (height * scale) + 'px';
  textEditOverlay.style.fontSize = ((annotation.fontSize || 14) * scale) + 'px';
  textEditOverlay.style.fontFamily = 'Arial, sans-serif';
  textEditOverlay.style.padding = '5px';
  textEditOverlay.style.border = '2px solid #667eea';
  textEditOverlay.style.borderRadius = '2px';
  textEditOverlay.style.background = annotation.fillColor || '#ffffd0';
  textEditOverlay.style.color = annotation.color || '#000000';
  textEditOverlay.style.resize = 'none';
  textEditOverlay.style.outline = 'none';
  textEditOverlay.style.zIndex = '1000';
  textEditOverlay.style.boxSizing = 'border-box';

  document.body.appendChild(textEditOverlay);
  textEditOverlay.focus();
  textEditOverlay.select();

  // Switch properties panel to text editing mode (only Character and Paragraph sections)
  showTextEditingProperties(annotation);

  // Handle blur (finish editing)
  textEditOverlay.addEventListener('blur', finishTextEditing);

  // Handle Escape to cancel, Enter with Ctrl/Cmd to finish
  textEditOverlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      cancelTextEditing();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      finishTextEditing();
    }
  });
}

// Finish text editing and save
function finishTextEditing() {
  if (!editingAnnotation || !textEditOverlay) return;

  // Save annotation reference for restoring properties view
  const annotation = editingAnnotation;

  // Update annotation text
  editingAnnotation.text = textEditOverlay.value;
  editingAnnotation.modifiedAt = new Date().toISOString();

  // Remove overlay
  if (textEditOverlay.parentNode) {
    textEditOverlay.parentNode.removeChild(textEditOverlay);
  }

  textEditOverlay = null;
  editingAnnotation = null;

  // Redraw
  redrawAnnotations();

  // Restore normal properties view for the annotation
  if (annotation && selectedAnnotation === annotation) {
    showProperties(annotation);
  }
}

// Cancel text editing
function cancelTextEditing() {
  if (!textEditOverlay) return;

  // Save annotation reference for restoring properties view
  const annotation = editingAnnotation;

  // Remove overlay without saving
  if (textEditOverlay.parentNode) {
    textEditOverlay.parentNode.removeChild(textEditOverlay);
  }

  textEditOverlay = null;
  editingAnnotation = null;

  // Restore normal properties view for the annotation
  if (annotation && selectedAnnotation === annotation) {
    showProperties(annotation);
  }
}

// Press Escape to cancel polyline
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isDrawingPolyline) {
    polylinePoints = [];
    isDrawingPolyline = false;
    redrawAnnotations();
  }
});

// Add comment
function addComment(x, y) {
  const commentText = prompt('Enter your comment:');
  if (commentText) {
    annotations.push(createAnnotation({
      type: 'comment',
      page: currentPage,
      x: x,
      y: y,
      text: commentText,
      color: colorPicker.value,
      fillColor: '#FFD700'
    }));
    if (viewMode === 'continuous') {
      redrawContinuous();
    } else {
      redrawAnnotations();
    }
  }
}

// Add text
function addText(x, y) {
  const text = prompt('Enter text:');
  if (text) {
    annotations.push(createAnnotation({
      type: 'text',
      page: currentPage,
      x: x,
      y: y,
      text: text,
      color: colorPicker.value,
      fontSize: parseInt(lineWidth.value) * 4
    }));
    if (viewMode === 'continuous') {
      redrawContinuous();
    } else {
      redrawAnnotations();
    }
  }
}

// Open PDF file function
async function openPDFFile() {
  try {
    console.log('Opening file dialog');
    const filePath = await window.electronAPI.openFile();
    console.log('File selected:', filePath);
    if (filePath) {
      // Reset state
      annotations = [];
      currentPage = 1;
      await loadPDF(filePath);
    }
  } catch (error) {
    console.error('Error opening file:', error);
    alert('Failed to open PDF file: ' + error.message);
  }
}

// Event listeners
toolSelect.addEventListener('click', () => setTool('select'));
toolHighlight.addEventListener('click', () => setTool('highlight'));
toolDraw.addEventListener('click', () => setTool('draw'));
toolLine.addEventListener('click', () => setTool('line'));
toolCircle.addEventListener('click', () => setTool('circle'));
toolBox.addEventListener('click', () => setTool('box'));
toolComment.addEventListener('click', () => setTool('comment'));
toolText.addEventListener('click', () => setTool('text'));
if (toolPolygon) toolPolygon.addEventListener('click', () => setTool('polygon'));
if (toolCloud) toolCloud.addEventListener('click', () => setTool('cloud'));
if (toolPolyline) toolPolyline.addEventListener('click', () => setTool('polyline'));
if (toolTextbox) toolTextbox.addEventListener('click', () => setTool('textbox'));
if (toolCallout) toolCallout.addEventListener('click', () => setTool('callout'));

toolClear.addEventListener('click', () => {
  if (confirm('Clear all annotations on this page?')) {
    annotations = annotations.filter(a => a.page !== currentPage);
    if (viewMode === 'continuous') {
      redrawContinuous();
    } else {
      redrawAnnotations();
    }
  }
});

toolUndo.addEventListener('click', () => {
  const pageAnnotations = annotations.filter(a => a.page === currentPage);
  if (pageAnnotations.length > 0) {
    annotations = annotations.filter(a => a !== pageAnnotations[pageAnnotations.length - 1]);
    if (viewMode === 'continuous') {
      redrawContinuous();
    } else {
      redrawAnnotations();
    }
  }
});

// Color Palette - 5 rows × 8 columns = 40 preset colors
const PRESET_COLORS = [
  // Row 1: Basic colors
  '#000000', '#404040', '#808080', '#c0c0c0', '#ffffff', '#800000', '#ff0000', '#ff6600',
  // Row 2: Warm colors
  '#804000', '#ff8000', '#ffcc00', '#ffff00', '#ccff00', '#80ff00', '#00ff00', '#00ff80',
  // Row 3: Cool colors
  '#008040', '#00ffcc', '#00ffff', '#00ccff', '#0080ff', '#0000ff', '#4000ff', '#8000ff',
  // Row 4: Purple/Pink
  '#ff00ff', '#ff00cc', '#ff0080', '#ff0040', '#800080', '#8000c0', '#4040c0', '#000080',
  // Row 5: Pastels and earth tones
  '#ffcccc', '#ffd9b3', '#ffffcc', '#ccffcc', '#ccffff', '#cce5ff', '#e5ccff', '#996633'
];

// Track open color dropdowns
let openColorDropdown = null;

// Close all color dropdowns
function closeAllColorDropdowns() {
  document.querySelectorAll('.color-palette-dropdown.visible').forEach(d => {
    d.classList.remove('visible');
  });
  openColorDropdown = null;
}

// Initialize color palettes with dropdown behavior
function initColorPalette(config) {
  const {
    paletteId,
    colorInputId,
    previewId,
    hexId,
    customBtnId,
    buttonId,
    dropdownId
  } = config;

  const palette = document.getElementById(paletteId);
  const colorInput = document.getElementById(colorInputId);
  const preview = document.getElementById(previewId);
  const hexDisplay = document.getElementById(hexId);
  const customBtn = document.getElementById(customBtnId);
  const button = document.getElementById(buttonId);
  const dropdown = document.getElementById(dropdownId);

  if (!palette || !colorInput) return;

  // Create swatches
  PRESET_COLORS.forEach(color => {
    const swatch = document.createElement('div');
    swatch.className = 'color-swatch';
    swatch.style.backgroundColor = color;
    swatch.dataset.color = color;
    swatch.title = color.toUpperCase();

    swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      // Update the color input
      colorInput.value = color;
      // Update visual feedback
      updateColorDisplay(palette, color, preview, hexDisplay);
      // Close dropdown
      closeAllColorDropdowns();
      // Trigger change event
      colorInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    palette.appendChild(swatch);
  });

  // Toggle dropdown on button click
  if (button && dropdown) {
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = dropdown.classList.contains('visible');

      // Close any other open dropdown
      closeAllColorDropdowns();

      if (!isOpen) {
        dropdown.classList.add('visible');
        openColorDropdown = dropdown;
      }
    });
  }

  // Custom color button
  if (customBtn) {
    customBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeAllColorDropdowns();
      colorInput.click();
    });
  }

  // When color input changes (from custom picker)
  colorInput.addEventListener('input', () => {
    updateColorDisplay(palette, colorInput.value, preview, hexDisplay);
  });
}

function updateColorDisplay(palette, color, preview, hexDisplay) {
  // Update selected state on swatches
  if (palette) {
    const swatches = palette.querySelectorAll('.color-swatch');
    swatches.forEach(s => {
      if (s.dataset.color.toLowerCase() === color.toLowerCase()) {
        s.classList.add('selected');
      } else {
        s.classList.remove('selected');
      }
    });
  }

  // Update preview swatch
  if (preview) {
    preview.style.backgroundColor = color;
  }

  // Update hex display
  if (hexDisplay) {
    hexDisplay.textContent = color.toUpperCase();
  }
}

// Close color dropdowns when clicking outside
document.addEventListener('click', (e) => {
  if (openColorDropdown && !e.target.closest('.color-palette-wrapper')) {
    closeAllColorDropdowns();
  }
});

// Initialize all three color palettes
initColorPalette({
  paletteId: 'main-color-palette',
  colorInputId: 'prop-color',
  previewId: 'prop-color-preview',
  hexId: 'prop-color-hex',
  customBtnId: 'main-color-custom-btn',
  buttonId: 'main-color-btn',
  dropdownId: 'main-color-dropdown'
});

initColorPalette({
  paletteId: 'fill-color-palette',
  colorInputId: 'prop-fill-color',
  previewId: 'prop-fill-color-preview',
  hexId: 'prop-fill-color-hex',
  customBtnId: 'fill-color-custom-btn',
  buttonId: 'fill-color-btn',
  dropdownId: 'fill-color-dropdown'
});

initColorPalette({
  paletteId: 'stroke-color-palette',
  colorInputId: 'prop-stroke-color',
  previewId: 'prop-stroke-color-preview',
  hexId: 'prop-stroke-color-hex',
  customBtnId: 'stroke-color-custom-btn',
  buttonId: 'stroke-color-btn',
  dropdownId: 'stroke-color-dropdown'
});

initColorPalette({
  paletteId: 'text-color-palette',
  colorInputId: 'prop-text-color',
  previewId: 'prop-text-color-preview',
  hexId: 'prop-text-color-hex',
  customBtnId: 'text-color-custom-btn',
  buttonId: 'text-color-btn',
  dropdownId: 'text-color-dropdown'
});

// Fill color "None" button handler
const fillColorNoneBtn = document.getElementById('fill-color-none-btn');
if (fillColorNoneBtn) {
  fillColorNoneBtn.addEventListener('click', () => {
    if (selectedAnnotation) {
      // Set fill color to null/empty (no fill)
      selectedAnnotation.fillColor = null;
      selectedAnnotation.modifiedAt = new Date().toISOString();

      // Update the preview to show "None" state
      const preview = document.getElementById('prop-fill-color-preview');
      const hexLabel = document.getElementById('prop-fill-color-hex');
      if (preview) {
        preview.style.background = 'linear-gradient(135deg, #fff 45%, #ff0000 45%, #ff0000 55%, #fff 55%)';
      }
      if (hexLabel) {
        hexLabel.textContent = 'None';
      }

      // Close dropdown
      const dropdown = document.getElementById('fill-color-dropdown');
      if (dropdown) dropdown.classList.remove('show');

      redrawAnnotations();
    }
  });
}

// Properties panel event listeners
propColor.addEventListener('input', updateAnnotationProperties);
propLineWidth.addEventListener('input', updateAnnotationProperties);
propText.addEventListener('input', updateAnnotationProperties);
propFontSize.addEventListener('input', updateAnnotationProperties);

// New property event listeners
if (propSubject) propSubject.addEventListener('input', updateAnnotationProperties);
if (propAuthor) propAuthor.addEventListener('input', updateAnnotationProperties);
if (propOpacity) propOpacity.addEventListener('input', updateAnnotationProperties);
if (propIcon) propIcon.addEventListener('change', updateAnnotationProperties);
if (propLocked) propLocked.addEventListener('change', updateAnnotationProperties);
if (propPrintable) propPrintable.addEventListener('change', updateAnnotationProperties);
const propReadOnly = document.getElementById('prop-readonly');
const propMarked = document.getElementById('prop-marked');
if (propReadOnly) propReadOnly.addEventListener('change', updateAnnotationProperties);
if (propMarked) propMarked.addEventListener('change', updateAnnotationProperties);
if (propFillColor) propFillColor.addEventListener('input', updateAnnotationProperties);
if (propStrokeColor) propStrokeColor.addEventListener('input', updateAnnotationProperties);
if (propBorderStyle) propBorderStyle.addEventListener('change', updateAnnotationProperties);

// Text formatting event listeners (for textbox/callout)
if (propTextColor) propTextColor.addEventListener('input', updateTextFormatProperties);
if (propFontFamily) propFontFamily.addEventListener('change', updateTextFormatProperties);
if (propTextFontSize) propTextFontSize.addEventListener('change', updateTextFormatProperties);
if (propLineSpacing) propLineSpacing.addEventListener('change', updateTextFormatProperties);

// Text style button handlers
if (propTextBold) {
  propTextBold.addEventListener('click', () => {
    if (selectedAnnotation && ['textbox', 'callout'].includes(selectedAnnotation.type)) {
      selectedAnnotation.fontBold = !selectedAnnotation.fontBold;
      propTextBold.classList.toggle('active', selectedAnnotation.fontBold);
      selectedAnnotation.modifiedAt = new Date().toISOString();
      redrawAnnotations();
    }
  });
}

if (propTextItalic) {
  propTextItalic.addEventListener('click', () => {
    if (selectedAnnotation && ['textbox', 'callout'].includes(selectedAnnotation.type)) {
      selectedAnnotation.fontItalic = !selectedAnnotation.fontItalic;
      propTextItalic.classList.toggle('active', selectedAnnotation.fontItalic);
      selectedAnnotation.modifiedAt = new Date().toISOString();
      redrawAnnotations();
    }
  });
}

if (propTextUnderline) {
  propTextUnderline.addEventListener('click', () => {
    if (selectedAnnotation && ['textbox', 'callout'].includes(selectedAnnotation.type)) {
      selectedAnnotation.fontUnderline = !selectedAnnotation.fontUnderline;
      propTextUnderline.classList.toggle('active', selectedAnnotation.fontUnderline);
      selectedAnnotation.modifiedAt = new Date().toISOString();
      redrawAnnotations();
    }
  });
}

if (propTextStrikethrough) {
  propTextStrikethrough.addEventListener('click', () => {
    if (selectedAnnotation && ['textbox', 'callout'].includes(selectedAnnotation.type)) {
      selectedAnnotation.fontStrikethrough = !selectedAnnotation.fontStrikethrough;
      propTextStrikethrough.classList.toggle('active', selectedAnnotation.fontStrikethrough);
      selectedAnnotation.modifiedAt = new Date().toISOString();
      redrawAnnotations();
    }
  });
}

// Text alignment button handlers
if (propAlignLeft) {
  propAlignLeft.addEventListener('click', () => {
    if (selectedAnnotation && ['textbox', 'callout'].includes(selectedAnnotation.type)) {
      selectedAnnotation.textAlign = 'left';
      propAlignLeft.classList.add('active');
      if (propAlignCenter) propAlignCenter.classList.remove('active');
      if (propAlignRight) propAlignRight.classList.remove('active');
      selectedAnnotation.modifiedAt = new Date().toISOString();
      redrawAnnotations();
    }
  });
}

if (propAlignCenter) {
  propAlignCenter.addEventListener('click', () => {
    if (selectedAnnotation && ['textbox', 'callout'].includes(selectedAnnotation.type)) {
      selectedAnnotation.textAlign = 'center';
      if (propAlignLeft) propAlignLeft.classList.remove('active');
      propAlignCenter.classList.add('active');
      if (propAlignRight) propAlignRight.classList.remove('active');
      selectedAnnotation.modifiedAt = new Date().toISOString();
      redrawAnnotations();
    }
  });
}

if (propAlignRight) {
  propAlignRight.addEventListener('click', () => {
    if (selectedAnnotation && ['textbox', 'callout'].includes(selectedAnnotation.type)) {
      selectedAnnotation.textAlign = 'right';
      if (propAlignLeft) propAlignLeft.classList.remove('active');
      if (propAlignCenter) propAlignCenter.classList.remove('active');
      propAlignRight.classList.add('active');
      selectedAnnotation.modifiedAt = new Date().toISOString();
      redrawAnnotations();
    }
  });
}

// Update text format properties function
function updateTextFormatProperties() {
  if (!selectedAnnotation || !['textbox', 'callout'].includes(selectedAnnotation.type)) return;
  if (selectedAnnotation.locked) return;

  selectedAnnotation.modifiedAt = new Date().toISOString();

  if (propTextColor) {
    selectedAnnotation.textColor = propTextColor.value;
    selectedAnnotation.color = propTextColor.value; // Keep in sync
  }

  if (propFontFamily) {
    selectedAnnotation.fontFamily = propFontFamily.value;
  }

  if (propTextFontSize) {
    selectedAnnotation.fontSize = parseInt(propTextFontSize.value);
  }

  if (propLineSpacing) {
    selectedAnnotation.lineSpacing = parseFloat(propLineSpacing.value);
  }

  redrawAnnotations();
}

// Image property event listeners
const propImageWidth = document.getElementById('prop-image-width');
const propImageHeight = document.getElementById('prop-image-height');
const propImageRotation = document.getElementById('prop-image-rotation');
const propImageReset = document.getElementById('prop-image-reset');

if (propImageWidth) {
  propImageWidth.addEventListener('input', () => {
    if (selectedAnnotation && selectedAnnotation.type === 'image') {
      selectedAnnotation.width = parseInt(propImageWidth.value) || 20;
      selectedAnnotation.modifiedAt = new Date().toISOString();
      redrawAnnotations();
    }
  });
}

if (propImageHeight) {
  propImageHeight.addEventListener('input', () => {
    if (selectedAnnotation && selectedAnnotation.type === 'image') {
      selectedAnnotation.height = parseInt(propImageHeight.value) || 20;
      selectedAnnotation.modifiedAt = new Date().toISOString();
      redrawAnnotations();
    }
  });
}

if (propImageRotation) {
  propImageRotation.addEventListener('input', () => {
    if (selectedAnnotation && selectedAnnotation.type === 'image') {
      selectedAnnotation.rotation = parseInt(propImageRotation.value) || 0;
      selectedAnnotation.modifiedAt = new Date().toISOString();
      redrawAnnotations();
    }
  });
}

if (propImageReset) {
  propImageReset.addEventListener('click', () => {
    if (selectedAnnotation && selectedAnnotation.type === 'image') {
      selectedAnnotation.width = selectedAnnotation.originalWidth;
      selectedAnnotation.height = selectedAnnotation.originalHeight;
      selectedAnnotation.rotation = 0;
      selectedAnnotation.modifiedAt = new Date().toISOString();
      showProperties(selectedAnnotation);
      redrawAnnotations();
    }
  });
}

propDelete.addEventListener('click', () => {
  if (selectedAnnotation) {
    // Check if annotation is locked
    if (selectedAnnotation.locked) {
      alert('This annotation is locked and cannot be deleted.');
      return;
    }
    if (confirm('Delete this annotation?')) {
      annotations = annotations.filter(a => a !== selectedAnnotation);
      hideProperties();
      if (viewMode === 'continuous') {
        redrawContinuous();
      } else {
        redrawAnnotations();
      }
    }
  }
});

propClose.addEventListener('click', hideProperties);

// Prevent clicks in properties panel from propagating to canvas (which would deselect)
propertiesPanel.addEventListener('mousedown', (e) => {
  e.stopPropagation();
});
propertiesPanel.addEventListener('click', (e) => {
  e.stopPropagation();
});

prevPageBtn.addEventListener('click', async () => {
  if (currentPage > 1) {
    currentPage--;
    hideProperties();
    await renderPage(currentPage);
  }
});

nextPageBtn.addEventListener('click', async () => {
  if (currentPage < pdfDoc.numPages) {
    currentPage++;
    hideProperties();
    await renderPage(currentPage);
  }
});

zoomInBtn.addEventListener('click', async () => {
  scale += 0.25;
  zoomLevel.textContent = `${Math.round(scale * 100)}%`;
  if (viewMode === 'continuous') {
    await renderContinuous();
  } else {
    await renderPage(currentPage);
  }
});

zoomOutBtn.addEventListener('click', async () => {
  if (scale > 0.5) {
    scale -= 0.25;
    zoomLevel.textContent = `${Math.round(scale * 100)}%`;
    if (viewMode === 'continuous') {
      await renderContinuous();
    } else {
      await renderPage(currentPage);
    }
  }
});

// Ribbon tab switching
ribbonTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const tabName = tab.dataset.tab;

    // Update active tab
    ribbonTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    // Update active content
    ribbonContents.forEach(content => {
      content.classList.remove('active');
      if (content.id === `tab-${tabName}`) {
        content.classList.add('active');
      }
    });
  });
});

// Connect ribbon buttons to existing functionality
// Home tab buttons
document.getElementById('zoom-in-ribbon')?.addEventListener('click', () => {
  zoomInBtn.click();
});

document.getElementById('zoom-out-ribbon')?.addEventListener('click', () => {
  zoomOutBtn.click();
});

document.getElementById('prev-page-ribbon')?.addEventListener('click', () => {
  prevPageBtn.click();
});

document.getElementById('next-page-ribbon')?.addEventListener('click', () => {
  nextPageBtn.click();
});

document.getElementById('first-page')?.addEventListener('click', async () => {
  if (pdfDoc && currentPage !== 1) {
    currentPage = 1;
    hideProperties();
    await renderPage(currentPage);
  }
});

document.getElementById('last-page')?.addEventListener('click', async () => {
  if (pdfDoc && currentPage !== pdfDoc.numPages) {
    currentPage = pdfDoc.numPages;
    hideProperties();
    await renderPage(currentPage);
  }
});

document.getElementById('fit-width')?.addEventListener('click', async () => {
  if (pdfDoc) {
    const page = await pdfDoc.getPage(currentPage);
    const viewport = page.getViewport({ scale: 1 });
    const container = document.querySelector('.main-view');
    const containerWidth = container.clientWidth - 40; // padding
    scale = containerWidth / viewport.width;
    zoomLevel.textContent = `${Math.round(scale * 100)}%`;
    if (viewMode === 'continuous') {
      await renderContinuous();
    } else {
      await renderPage(currentPage);
    }
  }
});

// View tab buttons
document.getElementById('actual-size')?.addEventListener('click', async () => {
  scale = 1;
  zoomLevel.textContent = '100%';
  if (pdfDoc) {
    if (viewMode === 'continuous') {
      await renderContinuous();
    } else {
      await renderPage(currentPage);
    }
  }
});

document.getElementById('fit-page')?.addEventListener('click', async () => {
  if (pdfDoc) {
    const page = await pdfDoc.getPage(currentPage);
    const viewport = page.getViewport({ scale: 1 });
    const container = document.querySelector('.main-view');
    const containerWidth = container.clientWidth - 40;
    const containerHeight = container.clientHeight - 40;
    const scaleX = containerWidth / viewport.width;
    const scaleY = containerHeight / viewport.height;
    scale = Math.min(scaleX, scaleY);
    zoomLevel.textContent = `${Math.round(scale * 100)}%`;

    if (viewMode === 'continuous') {
      await renderContinuous();
    } else {
      await renderPage(currentPage);
    }
  }
});

// View mode buttons
document.getElementById('single-page')?.addEventListener('click', () => {
  setViewMode('single');
});

document.getElementById('continuous')?.addEventListener('click', () => {
  setViewMode('continuous');
});

// Menu System
const menuItems = document.querySelectorAll('.menu-item');
const menuDropdowns = document.querySelectorAll('.menu-dropdown');
let activeMenu = null;

// Toggle menu visibility
function toggleMenu(menuName) {
  const menuItem = document.querySelector(`[data-menu="${menuName}"]`);
  const dropdown = document.getElementById(`menu-${menuName}`);

  if (activeMenu === menuName) {
    closeAllMenus();
    return;
  }

  closeAllMenus();
  activeMenu = menuName;
  menuItem.classList.add('active');
  dropdown.classList.add('visible');
}

// Close all menus
function closeAllMenus() {
  menuItems.forEach(item => item.classList.remove('active'));
  menuDropdowns.forEach(dropdown => dropdown.classList.remove('visible'));
  activeMenu = null;
}

// Menu item click handlers
menuItems.forEach(item => {
  item.addEventListener('click', (e) => {
    e.stopPropagation();
    const menuName = item.dataset.menu;
    toggleMenu(menuName);
  });

  // Close menu when mouse leaves the menu item
  item.addEventListener('mouseleave', (e) => {
    // Small delay to allow moving to dropdown
    setTimeout(() => {
      const menuName = item.dataset.menu;
      const dropdown = document.getElementById(`menu-${menuName}`);
      // Check if mouse is not over the dropdown
      if (dropdown && !dropdown.matches(':hover') && !item.matches(':hover')) {
        closeAllMenus();
      }
    }, 100);
  });
});

// Close menus when mouse leaves the dropdown
menuDropdowns.forEach(dropdown => {
  dropdown.addEventListener('mouseleave', (e) => {
    // Small delay to allow moving back to menu item
    setTimeout(() => {
      const menuItem = dropdown.closest('.menu-item') ||
                       document.querySelector(`[data-menu="${dropdown.id.replace('menu-', '')}"]`);
      if (!dropdown.matches(':hover') && (!menuItem || !menuItem.matches(':hover'))) {
        closeAllMenus();
      }
    }, 100);
  });
});

// Close menus when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.menu-item') && !e.target.closest('.menu-dropdown')) {
    closeAllMenus();
  }
});

// FILE MENU ACTIONS
document.getElementById('menu-open')?.addEventListener('click', () => {
  closeAllMenus();
  openPDFFile();
});

document.getElementById('menu-save')?.addEventListener('click', async () => {
  closeAllMenus();
  await savePDFAs(); // Use Save As to avoid overwriting original
});

document.getElementById('menu-save-as')?.addEventListener('click', async () => {
  closeAllMenus();
  await savePDFAs();
});

document.getElementById('menu-close')?.addEventListener('click', () => {
  closeAllMenus();
  if (pdfDoc && confirm('Close current PDF?')) {
    pdfDoc = null;
    annotations = [];
    currentPage = 1;
    pdfContainer.classList.remove('visible');
    placeholder.style.display = 'block';
    fileInfo.textContent = '';
  }
});

document.getElementById('menu-exit')?.addEventListener('click', () => {
  closeAllMenus();
  if (confirm('Exit PDF Annotator?')) {
    window.close();
  }
});

// EDIT MENU ACTIONS
document.getElementById('menu-undo')?.addEventListener('click', () => {
  closeAllMenus();
  toolUndo.click();
});

document.getElementById('menu-redo')?.addEventListener('click', () => {
  closeAllMenus();
  alert('Redo functionality to be implemented');
});

document.getElementById('menu-delete')?.addEventListener('click', () => {
  closeAllMenus();
  if (selectedAnnotation) {
    propDelete.click();
  }
});

document.getElementById('menu-clear-page')?.addEventListener('click', () => {
  closeAllMenus();
  toolClear.click();
});

document.getElementById('menu-clear-all')?.addEventListener('click', () => {
  closeAllMenus();
  if (confirm('Clear all annotations from all pages?')) {
    annotations = [];
    if (viewMode === 'continuous') {
      redrawContinuous();
    } else {
      redrawAnnotations();
    }
  }
});

document.getElementById('menu-select-all')?.addEventListener('click', () => {
  closeAllMenus();
  alert('Select All functionality to be implemented');
});

document.getElementById('menu-preferences')?.addEventListener('click', () => {
  closeAllMenus();
  showPreferencesDialog();
});

// Preferences Dialog button handlers
document.getElementById('pref-close-btn')?.addEventListener('click', hidePreferencesDialog);
document.getElementById('pref-cancel-btn')?.addEventListener('click', hidePreferencesDialog);
document.getElementById('pref-save-btn')?.addEventListener('click', savePreferencesFromDialog);
document.getElementById('pref-reset-btn')?.addEventListener('click', resetPreferencesToDefaults);

// Close preferences dialog when clicking overlay background
document.getElementById('preferences-dialog')?.addEventListener('click', (e) => {
  if (e.target.id === 'preferences-dialog') {
    hidePreferencesDialog();
  }
});

// Preferences tab switching
document.querySelectorAll('.pref-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    // Remove active from all tabs
    document.querySelectorAll('.pref-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.pref-tab-content').forEach(c => c.classList.remove('active'));

    // Activate clicked tab
    tab.classList.add('active');
    const tabId = tab.getAttribute('data-pref-tab');
    document.getElementById(`pref-tab-${tabId}`)?.classList.add('active');
  });
});

// Fill color "None" checkbox handlers
function setupFillNoneCheckbox(checkboxId, colorInputId) {
  const checkbox = document.getElementById(checkboxId);
  const colorInput = document.getElementById(colorInputId);
  if (checkbox && colorInput) {
    checkbox.addEventListener('change', () => {
      colorInput.disabled = checkbox.checked;
    });
  }
}

setupFillNoneCheckbox('pref-textbox-fill-none', 'pref-textbox-fill-color');
setupFillNoneCheckbox('pref-callout-fill-none', 'pref-callout-fill-color');
setupFillNoneCheckbox('pref-rect-fill-none', 'pref-rect-fill-color');
setupFillNoneCheckbox('pref-circle-fill-none', 'pref-circle-fill-color');

// Preferences dialog dragging
(function setupPreferencesDialogDrag() {
  const overlay = document.getElementById('preferences-dialog');
  if (!overlay) return;

  const dialog = overlay.querySelector('.preferences-dialog');
  const header = overlay.querySelector('.preferences-header');
  if (!dialog || !header) return;

  let isDraggingDialog = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  header.addEventListener('mousedown', (e) => {
    // Don't start drag if clicking on close button
    if (e.target.closest('.preferences-close-btn')) return;

    isDraggingDialog = true;
    const rect = dialog.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDraggingDialog) return;

    const overlayRect = overlay.getBoundingClientRect();
    let newX = e.clientX - overlayRect.left - dragOffsetX;
    let newY = e.clientY - overlayRect.top - dragOffsetY;

    // Constrain to overlay bounds
    const dialogRect = dialog.getBoundingClientRect();
    const maxX = overlayRect.width - dialogRect.width;
    const maxY = overlayRect.height - dialogRect.height;

    newX = Math.max(0, Math.min(newX, maxX));
    newY = Math.max(0, Math.min(newY, maxY));

    dialog.style.left = newX + 'px';
    dialog.style.top = newY + 'px';
    dialog.style.transform = 'none';
  });

  document.addEventListener('mouseup', () => {
    isDraggingDialog = false;
  });
})();

// VIEW MENU ACTIONS
document.getElementById('menu-zoom-in')?.addEventListener('click', () => {
  closeAllMenus();
  zoomInBtn.click();
});

document.getElementById('menu-zoom-out')?.addEventListener('click', () => {
  closeAllMenus();
  zoomOutBtn.click();
});

document.getElementById('menu-actual-size')?.addEventListener('click', () => {
  closeAllMenus();
  document.getElementById('actual-size')?.click();
});

document.getElementById('menu-fit-width')?.addEventListener('click', () => {
  closeAllMenus();
  document.getElementById('fit-width')?.click();
});

document.getElementById('menu-fit-page')?.addEventListener('click', () => {
  closeAllMenus();
  document.getElementById('fit-page')?.click();
});

document.getElementById('menu-rotate-left')?.addEventListener('click', () => {
  closeAllMenus();
  alert('Rotate Left functionality to be implemented');
});

document.getElementById('menu-rotate-right')?.addEventListener('click', () => {
  closeAllMenus();
  alert('Rotate Right functionality to be implemented');
});

document.getElementById('menu-single-page')?.addEventListener('click', () => {
  closeAllMenus();
  setViewMode('single');
});

document.getElementById('menu-continuous')?.addEventListener('click', () => {
  closeAllMenus();
  setViewMode('continuous');
});

document.getElementById('menu-show-properties')?.addEventListener('click', () => {
  closeAllMenus();
  if (propertiesPanel.classList.contains('visible')) {
    hideProperties();
  } else if (selectedAnnotation) {
    showProperties(selectedAnnotation);
  }
});

document.getElementById('menu-show-annotations-list')?.addEventListener('click', () => {
  closeAllMenus();
  toggleAnnotationsListPanel();
});

// TOOLS MENU ACTIONS
document.getElementById('menu-tool-select')?.addEventListener('click', () => {
  closeAllMenus();
  setTool('select');
});

document.getElementById('menu-tool-hand')?.addEventListener('click', () => {
  closeAllMenus();
  alert('Hand Tool functionality to be implemented');
});

document.getElementById('menu-tool-highlight')?.addEventListener('click', () => {
  closeAllMenus();
  setTool('highlight');
});

document.getElementById('menu-tool-draw')?.addEventListener('click', () => {
  closeAllMenus();
  setTool('draw');
});

document.getElementById('menu-tool-line')?.addEventListener('click', () => {
  closeAllMenus();
  setTool('line');
});

document.getElementById('menu-tool-box')?.addEventListener('click', () => {
  closeAllMenus();
  setTool('box');
});

document.getElementById('menu-tool-circle')?.addEventListener('click', () => {
  closeAllMenus();
  setTool('circle');
});

document.getElementById('menu-tool-text')?.addEventListener('click', () => {
  closeAllMenus();
  setTool('text');
});

document.getElementById('menu-tool-comment')?.addEventListener('click', () => {
  closeAllMenus();
  setTool('comment');
});

// HELP MENU ACTIONS
document.getElementById('menu-about')?.addEventListener('click', () => {
  closeAllMenus();
  showAboutDialog();
});

document.getElementById('menu-shortcuts')?.addEventListener('click', () => {
  closeAllMenus();
  const shortcuts = `Keyboard Shortcuts:

FILE:
Ctrl+O - Open PDF
Ctrl+S - Save
Ctrl+W - Close

EDIT:
Ctrl+Z - Undo
Delete - Delete selected annotation
Ctrl+Shift+C - Clear page annotations

VIEW:
Ctrl++ - Zoom In
Ctrl+- - Zoom Out
Ctrl+0 - Actual Size
Ctrl+1 - Fit Width
Ctrl+2 - Fit Page

TOOLS:
V - Select Tool
H - Hand Tool
1 - Highlight
2 - Freehand
3 - Line
4 - Rectangle
5 - Ellipse
T - Text Box
N - Note`;
  alert(shortcuts);
});

// Keyboard Shortcuts
document.addEventListener('keydown', (e) => {
  // Check if typing in an input field
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
    return;
  }

  const ctrl = e.ctrlKey || e.metaKey;
  const shift = e.shiftKey;

  // File shortcuts
  if (ctrl && e.key === 'o') {
    e.preventDefault();
    openPDFFile();
  } else if (ctrl && e.key === 's') {
    e.preventDefault();
    savePDFAs();
  } else if (ctrl && e.key === 'w') {
    e.preventDefault();
    document.getElementById('menu-close')?.click();
  }

  // Edit shortcuts
  else if (ctrl && !shift && e.key === 'z') {
    e.preventDefault();
    toolUndo.click();
  } else if (e.key === 'Delete') {
    e.preventDefault();
    if (selectedAnnotation) {
      propDelete.click();
    }
  } else if (ctrl && shift && e.key === 'C') {
    e.preventDefault();
    toolClear.click();
  } else if (ctrl && !shift && e.key === 'c') {
    // Copy selected annotation
    e.preventDefault();
    if (selectedAnnotation) {
      copyAnnotation(selectedAnnotation);
    }
  } else if (ctrl && !shift && e.key === 'v') {
    // Paste from clipboard
    e.preventDefault();
    pasteFromClipboard();
  } else if (ctrl && e.key === ',') {
    e.preventDefault();
    showPreferencesDialog();
  }

  // ESC key - close dialogs or switch back to select tool
  else if (e.key === 'Escape') {
    e.preventDefault();
    // First check if preferences dialog is open
    const prefsDialog = document.getElementById('preferences-dialog');
    if (prefsDialog && prefsDialog.classList.contains('visible')) {
      hidePreferencesDialog();
      return;
    }
    // Switch to select tool
    setTool('select');
    // Switch to Home ribbon tab
    const homeTab = document.querySelector('.ribbon-tab[data-tab="home"]');
    if (homeTab) {
      homeTab.click();
    }
    // Deselect any selected annotation
    if (selectedAnnotation) {
      selectedAnnotation = null;
      propertiesPanel.classList.remove('visible');
      redrawAnnotations();
    }
  }

  // View shortcuts
  else if (ctrl && e.key === '=') {
    e.preventDefault();
    zoomInBtn.click();
  } else if (ctrl && e.key === '-') {
    e.preventDefault();
    zoomOutBtn.click();
  } else if (ctrl && e.key === '0') {
    e.preventDefault();
    document.getElementById('actual-size')?.click();
  } else if (ctrl && e.key === '1') {
    e.preventDefault();
    document.getElementById('fit-width')?.click();
  } else if (ctrl && e.key === '2') {
    e.preventDefault();
    document.getElementById('fit-page')?.click();
  }

  // Tool shortcuts (only if PDF is loaded)
  else if (pdfDoc) {
    if (e.key === 'v' || e.key === 'V') {
      e.preventDefault();
      setTool('select');
    } else if (e.key === '1') {
      e.preventDefault();
      setTool('highlight');
    } else if (e.key === '2') {
      e.preventDefault();
      setTool('draw');
    } else if (e.key === '3') {
      e.preventDefault();
      setTool('line');
    } else if (e.key === '4') {
      e.preventDefault();
      setTool('box');
    } else if (e.key === '5') {
      e.preventDefault();
      setTool('circle');
    } else if (e.key === 't' || e.key === 'T') {
      e.preventDefault();
      setTool('text');
    } else if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      setTool('comment');
    }
  }

  // Help shortcuts
  else if (e.key === 'F1') {
    e.preventDefault();
    document.getElementById('menu-shortcuts')?.click();
  } else if (e.key === 'F12') {
    e.preventDefault();
    document.getElementById('menu-show-properties')?.click();
  } else if (e.key === 'F11') {
    e.preventDefault();
    toggleAnnotationsListPanel();
  }
});

// Scroll navigation and zoom
document.querySelector('.main-view')?.addEventListener('wheel', async (e) => {
  if (!pdfDoc) return;

  // Check if Ctrl key is pressed for zoom functionality
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();

    const zoomStep = 0.1;
    const minZoom = 0.5;
    const maxZoom = 5.0;

    // Zoom in (scroll up) or zoom out (scroll down)
    if (e.deltaY < 0) {
      // Zoom in
      scale = Math.min(scale + zoomStep, maxZoom);
    } else {
      // Zoom out
      scale = Math.max(scale - zoomStep, minZoom);
    }

    // Update zoom level display
    zoomLevel.textContent = `${Math.round(scale * 100)}%`;

    // Re-render based on view mode
    if (viewMode === 'continuous') {
      await renderContinuous();
    } else {
      await renderPage(currentPage);
    }
    return;
  }

  // Page navigation in single page mode (without Ctrl)
  if (viewMode !== 'single') return;

  const mainView = e.currentTarget;
  const scrollTop = mainView.scrollTop;
  const scrollHeight = mainView.scrollHeight;
  const clientHeight = mainView.clientHeight;

  // Scrolling down at the bottom
  if (e.deltaY > 0 && scrollTop + clientHeight >= scrollHeight - 5) {
    if (currentPage < pdfDoc.numPages) {
      e.preventDefault();
      currentPage++;
      await renderPage(currentPage);
      // Scroll to top after page change
      mainView.scrollTop = 0;
    }
  }
  // Scrolling up at the top
  else if (e.deltaY < 0 && scrollTop <= 5) {
    if (currentPage > 1) {
      e.preventDefault();
      currentPage--;
      await renderPage(currentPage);
      // Scroll to bottom after page change
      mainView.scrollTop = mainView.scrollHeight;
    }
  }
});

// Context menu handling
const contextMenu = document.getElementById('annotation-context-menu');
const pageContextMenu = document.getElementById('page-context-menu');

// Store right-click position for paste operations
let contextMenuClickX = 0;
let contextMenuClickY = 0;

function showContextMenu(x, y, annotation) {
  if (!contextMenu || !annotation) return;

  hidePageContextMenu();

  // Position the context menu
  const menuWidth = 250;
  const menuHeight = 500; // Approximate height

  // Adjust position to keep menu in viewport
  let posX = x;
  let posY = y;

  if (x + menuWidth > window.innerWidth) {
    posX = window.innerWidth - menuWidth - 10;
  }
  if (y + menuHeight > window.innerHeight) {
    posY = window.innerHeight - menuHeight - 10;
  }

  contextMenu.style.left = posX + 'px';
  contextMenu.style.top = posY + 'px';
  contextMenu.classList.add('visible');
}

function hideContextMenu() {
  if (contextMenu) {
    contextMenu.classList.remove('visible');
  }
}

function showPageContextMenu(x, y) {
  if (!pageContextMenu) return;

  hideContextMenu();

  // Position the context menu
  const menuWidth = 250;
  const menuHeight = 550; // Approximate height

  // Adjust position to keep menu in viewport
  let posX = x;
  let posY = y;

  if (x + menuWidth > window.innerWidth) {
    posX = window.innerWidth - menuWidth - 10;
  }
  if (y + menuHeight > window.innerHeight) {
    posY = window.innerHeight - menuHeight - 10;
  }

  pageContextMenu.style.left = posX + 'px';
  pageContextMenu.style.top = posY + 'px';
  pageContextMenu.classList.add('visible');
}

function hidePageContextMenu() {
  if (pageContextMenu) {
    pageContextMenu.classList.remove('visible');
  }
}

function hideAllContextMenus() {
  hideContextMenu();
  hidePageContextMenu();
}

// Delete annotation helper
function deleteSelectedAnnotation(showConfirm = true) {
  if (!selectedAnnotation) return;

  if (selectedAnnotation.locked) {
    alert('This annotation is locked and cannot be deleted.');
    return;
  }

  if (!showConfirm || confirm('Delete this annotation?')) {
    annotations = annotations.filter(a => a !== selectedAnnotation);
    selectedAnnotation = null;
    hideProperties();
    if (viewMode === 'continuous') {
      redrawContinuous();
    } else {
      redrawAnnotations();
    }
    updateStatusMessage('Annotation deleted');
  }
}

// Cut annotation (copy + delete)
function cutAnnotation() {
  if (!selectedAnnotation) return;

  if (selectedAnnotation.locked) {
    alert('This annotation is locked and cannot be cut.');
    return;
  }

  copyAnnotation(selectedAnnotation);
  annotations = annotations.filter(a => a !== selectedAnnotation);
  selectedAnnotation = null;
  hideProperties();
  if (viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }
  updateStatusMessage('Annotation cut');
}

// Duplicate annotation
function duplicateAnnotation() {
  if (!selectedAnnotation) return;

  const newAnnotation = cloneAnnotation(selectedAnnotation);

  // Offset position
  if (newAnnotation.x !== undefined) newAnnotation.x += 20;
  if (newAnnotation.y !== undefined) newAnnotation.y += 20;
  if (newAnnotation.startX !== undefined) newAnnotation.startX += 20;
  if (newAnnotation.startY !== undefined) newAnnotation.startY += 20;
  if (newAnnotation.endX !== undefined) newAnnotation.endX += 20;
  if (newAnnotation.endY !== undefined) newAnnotation.endY += 20;
  if (newAnnotation.centerX !== undefined) newAnnotation.centerX += 20;
  if (newAnnotation.centerY !== undefined) newAnnotation.centerY += 20;
  if (newAnnotation.path) {
    newAnnotation.path = newAnnotation.path.map(p => ({ x: p.x + 20, y: p.y + 20 }));
  }

  newAnnotation.createdAt = new Date().toISOString();
  newAnnotation.modifiedAt = new Date().toISOString();

  // For images, copy cached image
  if (newAnnotation.type === 'image') {
    const newImageId = generateImageId();
    const originalImg = imageCache.get(selectedAnnotation.imageId);
    if (originalImg) {
      imageCache.set(newImageId, originalImg);
    }
    newAnnotation.imageId = newImageId;
  }

  annotations.push(newAnnotation);
  selectedAnnotation = newAnnotation;
  showProperties(newAnnotation);

  if (viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }
  updateStatusMessage('Annotation duplicated');
}

// Z-order functions
function bringToFront() {
  if (!selectedAnnotation) return;
  const index = annotations.indexOf(selectedAnnotation);
  if (index > -1) {
    annotations.splice(index, 1);
    annotations.push(selectedAnnotation);
    if (viewMode === 'continuous') {
      redrawContinuous();
    } else {
      redrawAnnotations();
    }
  }
}

function sendToBack() {
  if (!selectedAnnotation) return;
  const index = annotations.indexOf(selectedAnnotation);
  if (index > -1) {
    annotations.splice(index, 1);
    annotations.unshift(selectedAnnotation);
    if (viewMode === 'continuous') {
      redrawContinuous();
    } else {
      redrawAnnotations();
    }
  }
}

function bringForward() {
  if (!selectedAnnotation) return;
  const index = annotations.indexOf(selectedAnnotation);
  if (index > -1 && index < annotations.length - 1) {
    annotations.splice(index, 1);
    annotations.splice(index + 1, 0, selectedAnnotation);
    if (viewMode === 'continuous') {
      redrawContinuous();
    } else {
      redrawAnnotations();
    }
  }
}

function sendBackward() {
  if (!selectedAnnotation) return;
  const index = annotations.indexOf(selectedAnnotation);
  if (index > 0) {
    annotations.splice(index, 1);
    annotations.splice(index - 1, 0, selectedAnnotation);
    if (viewMode === 'continuous') {
      redrawContinuous();
    } else {
      redrawAnnotations();
    }
  }
}

// Rotation functions for annotations
function rotateAnnotationLeft() {
  if (!selectedAnnotation || selectedAnnotation.locked) return;

  if (selectedAnnotation.type === 'image' || selectedAnnotation.type === 'comment') {
    selectedAnnotation.rotation = (selectedAnnotation.rotation || 0) - 90;
    selectedAnnotation.modifiedAt = new Date().toISOString();
    showProperties(selectedAnnotation);
    if (viewMode === 'continuous') {
      redrawContinuous();
    } else {
      redrawAnnotations();
    }
  }
}

function rotateAnnotationRight() {
  if (!selectedAnnotation || selectedAnnotation.locked) return;

  if (selectedAnnotation.type === 'image' || selectedAnnotation.type === 'comment') {
    selectedAnnotation.rotation = (selectedAnnotation.rotation || 0) + 90;
    selectedAnnotation.modifiedAt = new Date().toISOString();
    showProperties(selectedAnnotation);
    if (viewMode === 'continuous') {
      redrawContinuous();
    } else {
      redrawAnnotations();
    }
  }
}

// Flip functions for annotations
function flipAnnotationHorizontal() {
  if (!selectedAnnotation || selectedAnnotation.locked) return;

  if (selectedAnnotation.type === 'image') {
    selectedAnnotation.flipX = !selectedAnnotation.flipX;
    selectedAnnotation.modifiedAt = new Date().toISOString();
    if (viewMode === 'continuous') {
      redrawContinuous();
    } else {
      redrawAnnotations();
    }
  } else if (selectedAnnotation.type === 'line') {
    // Swap start and end X coordinates
    const temp = selectedAnnotation.startX;
    selectedAnnotation.startX = selectedAnnotation.endX;
    selectedAnnotation.endX = temp;
    selectedAnnotation.modifiedAt = new Date().toISOString();
    if (viewMode === 'continuous') {
      redrawContinuous();
    } else {
      redrawAnnotations();
    }
  }
}

function flipAnnotationVertical() {
  if (!selectedAnnotation || selectedAnnotation.locked) return;

  if (selectedAnnotation.type === 'image') {
    selectedAnnotation.flipY = !selectedAnnotation.flipY;
    selectedAnnotation.modifiedAt = new Date().toISOString();
    if (viewMode === 'continuous') {
      redrawContinuous();
    } else {
      redrawAnnotations();
    }
  } else if (selectedAnnotation.type === 'line') {
    // Swap start and end Y coordinates
    const temp = selectedAnnotation.startY;
    selectedAnnotation.startY = selectedAnnotation.endY;
    selectedAnnotation.endY = temp;
    selectedAnnotation.modifiedAt = new Date().toISOString();
    if (viewMode === 'continuous') {
      redrawContinuous();
    } else {
      redrawAnnotations();
    }
  }
}

// Context menu item click handler
if (contextMenu) {
  contextMenu.addEventListener('click', (e) => {
    // Handle arrange icon buttons
    const iconBtn = e.target.closest('.arrange-icon-btn');
    if (iconBtn) {
      const action = iconBtn.dataset.action;
      e.stopPropagation();

      switch (action) {
        case 'bring-to-front':
          bringToFront();
          break;
        case 'send-to-back':
          sendToBack();
          break;
        case 'bring-forward':
          bringForward();
          break;
        case 'send-backward':
          sendBackward();
          break;
        case 'rotate-left':
          rotateAnnotationLeft();
          break;
        case 'rotate-right':
          rotateAnnotationRight();
          break;
        case 'flip-horizontal':
          flipAnnotationHorizontal();
          break;
        case 'flip-vertical':
          flipAnnotationVertical();
          break;
      }
      hideContextMenu();
      return;
    }

    const item = e.target.closest('.context-menu-item');
    if (!item) return;

    const action = item.dataset.action;

    switch (action) {
      case 'copy':
        if (selectedAnnotation) {
          copyAnnotation(selectedAnnotation);
        }
        break;
      case 'cut':
        cutAnnotation();
        break;
      case 'paste':
        pasteFromClipboard();
        break;
      case 'delete':
        deleteSelectedAnnotation(false);
        break;
      case 'duplicate':
        duplicateAnnotation();
        break;
      case 'properties':
        if (selectedAnnotation) {
          showProperties(selectedAnnotation);
        }
        break;
    }

    hideContextMenu();
  });
}

// Page context menu click handler
if (pageContextMenu) {
  pageContextMenu.addEventListener('click', (e) => {
    const item = e.target.closest('.context-menu-item');
    if (!item || item.classList.contains('disabled')) return;

    const action = item.dataset.action;

    switch (action) {
      case 'add-sticky-note':
        // Add a comment/sticky note at the click position
        if (pdfDoc) {
          setTool('comment');
          // Create annotation at stored position
          const annotation = {
            type: 'comment',
            page: currentPage,
            x: contextMenuClickX,
            y: contextMenuClickY,
            text: '',
            color: currentColor,
            fillColor: '#FFD700',
            lineWidth: 2,
            opacity: 1,
            locked: false,
            printable: true,
            author: defaultAuthor,
            subject: '',
            createdAt: new Date().toISOString(),
            modifiedAt: new Date().toISOString()
          };
          annotations.push(annotation);
          selectedAnnotation = annotation;
          showProperties(annotation);
          redrawAnnotations();
          setTool('select');
        }
        break;
      case 'paste':
        pasteFromClipboard();
        break;
      case 'deselect':
        selectedAnnotation = null;
        hideProperties();
        redrawAnnotations();
        break;
      case 'tool-hand':
        setTool('select');
        break;
    }

    hidePageContextMenu();
  });
}

// Right-click handler for annotations
annotationCanvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();

  const rect = annotationCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  // Store click position for paste operations
  contextMenuClickX = x;
  contextMenuClickY = y;

  // Find annotation at click position
  const annotation = findAnnotationAt(x, y);

  if (annotation) {
    // Select the annotation
    selectedAnnotation = annotation;
    redrawAnnotations();

    // Show annotation context menu at mouse position
    showContextMenu(e.clientX, e.clientY, annotation);
  } else {
    // Show page context menu when clicking on empty area
    if (pdfDoc) {
      showPageContextMenu(e.clientX, e.clientY);
    }
  }
});

// Hide context menus on click outside
document.addEventListener('click', (e) => {
  if (contextMenu && !contextMenu.contains(e.target)) {
    hideContextMenu();
  }
  if (pageContextMenu && !pageContextMenu.contains(e.target)) {
    hidePageContextMenu();
  }
});

// Hide context menus on scroll
document.querySelector('.main-view')?.addEventListener('scroll', hideAllContextMenus);

// Initialize
console.log('Renderer script loaded');
loadPreferences();
setTool('select');

// Listen for auto-load PDF from main process (development)
if (window.electronAPI && window.electronAPI.onLoadPdf) {
  window.electronAPI.onLoadPdf(async (filePath) => {
    console.log('Auto-loading PDF:', filePath);
    await loadPDF(filePath);
  });
}
