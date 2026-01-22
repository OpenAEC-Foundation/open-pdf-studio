// DOM element references
// All element references are exported for use by other modules

// Main containers
export const placeholder = document.getElementById('placeholder');
export const fileInfo = document.getElementById('file-info');
export const pdfContainer = document.getElementById('pdf-container');
export const pdfCanvas = document.getElementById('pdf-canvas');
export const annotationCanvas = document.getElementById('annotation-canvas');
export const continuousContainer = document.getElementById('continuous-container');
export const canvasContainer = document.getElementById('canvas-container');

// Loading overlay
export const loadingOverlay = document.getElementById('loading-overlay');
export const loadingText = loadingOverlay?.querySelector('.loading-text');

// About dialog
export const aboutDialog = document.getElementById('about-dialog');

// Page navigation
export const pageInfo = document.getElementById('page-info');
export const pageInput = document.getElementById('page-input');
export const pageTotal = document.getElementById('page-total');
export const prevPageBtn = document.getElementById('prev-page');
export const nextPageBtn = document.getElementById('next-page');

// Zoom controls
export const zoomInBtn = document.getElementById('zoom-in');
export const zoomOutBtn = document.getElementById('zoom-out');
export const zoomLevel = document.getElementById('zoom-input');

// Ribbon elements
export const ribbonTabs = document.querySelectorAll('.ribbon-tab');
export const ribbonContents = document.querySelectorAll('.ribbon-content');

// Tool buttons
export const toolSelect = document.getElementById('tool-select');
export const toolHighlight = document.getElementById('tool-highlight');
export const toolDraw = document.getElementById('tool-draw');
export const toolLine = document.getElementById('tool-line');
export const toolArrow = document.getElementById('tool-arrow');
export const toolCircle = document.getElementById('tool-circle');
export const toolBox = document.getElementById('tool-box');
export const toolComment = document.getElementById('tool-comment');
export const toolText = document.getElementById('tool-text');
export const toolPolygon = document.getElementById('tool-polygon');
export const toolCloud = document.getElementById('tool-cloud');
export const toolPolyline = document.getElementById('tool-polyline');
export const toolTextbox = document.getElementById('tool-textbox');
export const toolCallout = document.getElementById('tool-callout');
export const toolClear = document.getElementById('tool-clear');
export const toolUndo = document.getElementById('tool-undo');
export const colorPicker = document.getElementById('color-picker');
export const lineWidth = document.getElementById('line-width');

// Properties panel elements
export const propertiesPanel = document.getElementById('properties-panel');
export const propType = document.getElementById('prop-type');
export const propColor = document.getElementById('prop-color');
export const propLineWidth = document.getElementById('prop-line-width');
export const propBorderStyle = document.getElementById('prop-border-style');
export const propBorderStyleGroup = document.getElementById('prop-border-style-group');
export const propText = document.getElementById('prop-text');
export const propFontSize = document.getElementById('prop-font-size');
export const propTextGroup = document.getElementById('prop-text-group');
export const propFontSizeGroup = document.getElementById('prop-font-size-group');
export const propLineWidthGroup = document.getElementById('prop-line-width-group');
export const propDelete = document.getElementById('prop-delete');
export const propClose = document.getElementById('prop-close');

// Properties panel elements (PDF-XChange style)
export const propAuthor = document.getElementById('prop-author');
export const propSubject = document.getElementById('prop-subject');
export const propCreated = document.getElementById('prop-created');
export const propModified = document.getElementById('prop-modified');
export const propOpacity = document.getElementById('prop-opacity');
export const propOpacitySelect = document.getElementById('prop-opacity-select');
export const propOpacityValue = document.getElementById('prop-opacity-value');
export const propLocked = document.getElementById('prop-locked');
export const propPrintable = document.getElementById('prop-printable');
export const propIcon = document.getElementById('prop-icon');
export const propIconGroup = document.getElementById('prop-icon-group');
export const propStrokeColor = document.getElementById('prop-stroke-color');
export const propStrokeColorGroup = document.getElementById('prop-stroke-color-group');
export const propFillColor = document.getElementById('prop-fill-color');
export const propFillColorGroup = document.getElementById('prop-fill-color-group');

// Text formatting elements (for textbox/callout)
export const propTextFormatSection = document.getElementById('prop-text-format-section');
export const propParagraphSection = document.getElementById('prop-paragraph-section');
export const propTextColor = document.getElementById('prop-text-color');
export const propFontFamily = document.getElementById('prop-font-family');
export const propTextFontSize = document.getElementById('prop-text-font-size');
export const propTextBold = document.getElementById('prop-text-bold');
export const propTextItalic = document.getElementById('prop-text-italic');
export const propTextUnderline = document.getElementById('prop-text-underline');
export const propTextStrikethrough = document.getElementById('prop-text-strikethrough');
export const propAlignLeft = document.getElementById('prop-align-left');
export const propAlignCenter = document.getElementById('prop-align-center');
export const propAlignRight = document.getElementById('prop-align-right');
export const propLineSpacing = document.getElementById('prop-line-spacing');

// Property panel sections (for text editing mode)
export const propGeneralSection = document.getElementById('prop-general-section');
export const propAppearanceSection = document.getElementById('prop-appearance-section');
export const propContentSection = document.getElementById('prop-content-section');
export const propImageSection = document.getElementById('prop-image-section');
export const propActionsSection = document.getElementById('prop-actions-section');

// Image properties
export const propImageWidth = document.getElementById('prop-image-width');
export const propImageHeight = document.getElementById('prop-image-height');
export const propImageRotation = document.getElementById('prop-image-rotation');
export const propImageReset = document.getElementById('prop-image-reset');

// Arrow properties (Line Endings section)
export const propLineEndingsSection = document.getElementById('prop-line-endings-section');
export const propArrowStart = document.getElementById('prop-arrow-start');
export const propArrowEnd = document.getElementById('prop-arrow-end');
export const propArrowHeadSize = document.getElementById('prop-arrow-head-size');

// Arrow dimensions section
export const propDimensionsSection = document.getElementById('prop-dimensions-section');
export const propArrowLength = document.getElementById('prop-arrow-length');

// Status bar elements
export const statusTool = document.getElementById('status-tool');
export const statusPage = document.getElementById('status-page');
export const statusZoom = document.getElementById('status-zoom');
export const statusAnnotations = document.getElementById('status-annotations');
export const statusMessage = document.getElementById('status-message');

// Annotations list panel elements
export const annotationsListPanel = document.getElementById('annotations-list-panel');
export const annotationsListContent = document.getElementById('annotations-list-content');
export const annotationsListFilter = document.getElementById('annotations-list-filter');
export const annotationsListCount = document.getElementById('annotations-list-count');

// Menu elements
export const menuItems = document.querySelectorAll('.menu-item');
export const menuDropdowns = document.querySelectorAll('.menu-dropdown');

// Canvas contexts - initialized after DOM is ready
export let pdfCtx = null;
export let annotationCtx = null;

// Initialize canvas contexts
export function initCanvasContexts() {
  if (pdfCanvas) {
    pdfCtx = pdfCanvas.getContext('2d');
  }
  if (annotationCanvas) {
    annotationCtx = annotationCanvas.getContext('2d');
  }
}

// Call initialization
initCanvasContexts();
