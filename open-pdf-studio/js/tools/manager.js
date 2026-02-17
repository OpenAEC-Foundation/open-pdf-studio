import { state } from '../core/state.js';
import {
  annotationCanvas, pdfContainer,
  toolSelect, toolHand, toolSelectComments, toolHighlight, toolDraw, toolLine, toolArrow, toolCircle,
  toolBox, toolComment, toolText, toolPolygon, toolCloud,
  toolPolyline, toolTextbox, toolCallout,
  toolStamp, toolSignature, toolMeasureDistance, toolMeasureArea, toolMeasurePerimeter,
  toolRedaction, toolEditText, toolClear
} from '../ui/dom-elements.js';
import { hideProperties } from '../ui/panels/properties-panel.js';
import { redrawAnnotations } from '../annotations/rendering.js';
import { updateStatusTool } from '../ui/chrome/status-bar.js';
import { isPdfAReadOnly } from '../pdf/loader.js';

// Tools that are always allowed (view-only, non-modifying)
const READONLY_ALLOWED_TOOLS = new Set(['select', 'selectComments', 'hand']);

// Get cursor for a given tool
export function getCursorForTool(tool = state.currentTool) {
  switch (tool) {
    case 'select':
    case 'selectComments':
      return 'default';
    case 'hand':
      return 'grab';
    case 'text':
    case 'editText':
      return 'text';
    default:
      return 'crosshair';
  }
}

// Helper to set cursor on all annotation canvases and container
function setAllCanvasCursors(cursor) {
  if (annotationCanvas) annotationCanvas.style.cursor = cursor;
  if (pdfContainer) pdfContainer.style.cursor = cursor;
  // Also set cursor on continuous view canvases
  document.querySelectorAll('.annotation-canvas').forEach(canvas => {
    canvas.style.cursor = cursor;
  });
}

// Enable or disable text selection based on current tool.
// Stacking: textLayer (z:5) < annotation-canvas (z:6) < formLayer (z:7) < linkLayer (z:10)
function setTextSelectionEnabled(enabled) {
  const textLayers = document.querySelectorAll('.textLayer');
  textLayers.forEach(layer => {
    // When enabled, the layer needs pointer-events: auto so native drag-to-select
    // works across span boundaries.  When disabled, pointer-events: none lets clicks
    // fall through to the annotation canvas.
    layer.style.pointerEvents = enabled ? 'auto' : 'none';
    const spans = layer.querySelectorAll('span');
    spans.forEach(span => {
      span.style.pointerEvents = enabled ? 'auto' : 'none';
      span.style.cursor = enabled ? 'text' : 'default';
    });
  });
}

// Configure layer stacking for tools that need text layer access (select, editText).
// Drops annotation canvas below text layer, disables its pointer-events, and disables
// form/link pointer events (they sit above the text layer and would intercept events).
// Centralised here to avoid race conditions with async tool deactivation.
function setAnnotationCanvasForTextAccess(enabled) {
  document.querySelectorAll('#annotation-canvas, .annotation-canvas').forEach(el => {
    el.style.zIndex = enabled ? '2' : '';
    el.style.pointerEvents = enabled ? 'none' : '';
  });
  document.querySelectorAll('.formLayer section, .linkLayer .pdf-link').forEach(el => {
    el.style.pointerEvents = enabled ? 'none' : '';
  });
}

// Set current tool
export function setTool(tool) {
  // Block annotation tools when PDF/A read-only is active
  if (isPdfAReadOnly() && !READONLY_ALLOWED_TOOLS.has(tool)) {
    return;
  }

  // Cancel any ongoing polyline drawing when switching tools
  if (state.isDrawingPolyline && tool !== 'polyline') {
    state.polylinePoints = [];
    state.isDrawingPolyline = false;
    redrawAnnotations();
  }

  // Cancel any ongoing measurement when switching tools
  if (state.measurePoints && tool !== 'measureArea' && tool !== 'measurePerimeter') {
    state.measurePoints = null;
    redrawAnnotations();
  }

  // Deactivate PDF text editing when switching away
  if (state.currentTool === 'editText' && tool !== 'editText') {
    import('./text-edit-tool.js').then(m => m.deactivateEditTextTool());
  }

  state.currentTool = tool;

  // Hide properties panel when switching tools (keep visible for annotation tools)
  if (tool !== 'select' && tool !== 'selectComments') {
    hideProperties();
  }

  // Enable text selection only for select tool
  // (editText tool manages its own pointer-events via enableTextLayerHover)
  if (tool !== 'editText') {
    setTextSelectionEnabled(tool === 'select');
  }

  // Update UI - remove active state from all tool buttons
  [toolSelect, toolHand, toolSelectComments, toolHighlight, toolDraw, toolLine, toolArrow, toolCircle, toolBox, toolComment, toolText].forEach(btn => {
    if (btn) btn.classList.remove('active');
  });
  // Also remove from optional buttons
  [toolPolygon, toolCloud, toolPolyline, toolTextbox, toolCallout,
   toolStamp, toolSignature, toolMeasureDistance, toolMeasureArea, toolMeasurePerimeter, toolRedaction, toolEditText].forEach(btn => {
    if (btn) btn.classList.remove('active');
  });

  switch (tool) {
    case 'select':
      if (toolSelect) toolSelect.classList.add('active');
      setAllCanvasCursors('default');
      break;
    case 'selectComments':
      if (toolSelectComments) toolSelectComments.classList.add('active');
      setAllCanvasCursors('default');
      break;
    case 'hand':
      if (toolHand) toolHand.classList.add('active');
      setAllCanvasCursors('grab');
      break;
    case 'highlight':
      if (toolHighlight) toolHighlight.classList.add('active');
      setAllCanvasCursors('crosshair');
      break;
    case 'draw':
      if (toolDraw) toolDraw.classList.add('active');
      setAllCanvasCursors('crosshair');
      break;
    case 'line':
      if (toolLine) toolLine.classList.add('active');
      setAllCanvasCursors('crosshair');
      break;
    case 'arrow':
      if (toolArrow) toolArrow.classList.add('active');
      setAllCanvasCursors('crosshair');
      break;
    case 'circle':
      if (toolCircle) toolCircle.classList.add('active');
      setAllCanvasCursors('crosshair');
      break;
    case 'box':
      if (toolBox) toolBox.classList.add('active');
      setAllCanvasCursors('crosshair');
      break;
    case 'polygon':
      if (toolPolygon) toolPolygon.classList.add('active');
      setAllCanvasCursors('crosshair');
      break;
    case 'cloud':
      if (toolCloud) toolCloud.classList.add('active');
      setAllCanvasCursors('crosshair');
      break;
    case 'polyline':
      if (toolPolyline) toolPolyline.classList.add('active');
      setAllCanvasCursors('crosshair');
      break;
    case 'textbox':
      if (toolTextbox) toolTextbox.classList.add('active');
      setAllCanvasCursors('crosshair');
      break;
    case 'callout':
      if (toolCallout) toolCallout.classList.add('active');
      setAllCanvasCursors('crosshair');
      break;
    case 'comment':
      if (toolComment) toolComment.classList.add('active');
      setAllCanvasCursors('crosshair');
      break;
    case 'text':
      if (toolText) toolText.classList.add('active');
      setAllCanvasCursors('text');
      break;
    case 'stamp':
      if (toolStamp) toolStamp.classList.add('active');
      setAllCanvasCursors('crosshair');
      break;
    case 'signature':
      if (toolSignature) toolSignature.classList.add('active');
      setAllCanvasCursors('crosshair');
      break;
    case 'measureDistance':
      if (toolMeasureDistance) toolMeasureDistance.classList.add('active');
      setAllCanvasCursors('crosshair');
      break;
    case 'measureArea':
      if (toolMeasureArea) toolMeasureArea.classList.add('active');
      setAllCanvasCursors('crosshair');
      break;
    case 'measurePerimeter':
      if (toolMeasurePerimeter) toolMeasurePerimeter.classList.add('active');
      setAllCanvasCursors('crosshair');
      break;
    case 'redaction':
      if (toolRedaction) toolRedaction.classList.add('active');
      setAllCanvasCursors('crosshair');
      break;
    case 'editText':
      if (toolEditText) toolEditText.classList.add('active');
      setAllCanvasCursors('text');
      import('./text-edit-tool.js').then(m => m.activateEditTextTool());
      break;
    default:
      setAllCanvasCursors('default');
  }

  // Drop annotation canvas below text layer for tools that need text access
  setAnnotationCanvasForTextAccess(tool === 'select' || tool === 'editText');

  // Update status bar
  updateStatusTool();
}

// Enable or disable annotation tool buttons based on PDF/A read-only state
export function updatePdfAToolState() {
  const locked = isPdfAReadOnly();

  // All annotation tool buttons that should be disabled when PDF/A is read-only
  const annotationToolBtns = [
    toolHighlight, toolDraw, toolLine, toolArrow, toolCircle, toolBox,
    toolComment, toolText, toolPolygon, toolCloud, toolPolyline,
    toolTextbox, toolCallout, toolStamp, toolSignature,
    toolMeasureDistance, toolMeasureArea, toolMeasurePerimeter,
    toolRedaction, toolEditText, toolClear
  ];

  for (const btn of annotationToolBtns) {
    if (btn) btn.disabled = locked;
  }

  // Additional ribbon buttons that modify the document
  const additionalBtnIds = [
    'qa-save', 'qa-undo', 'qa-redo',
    'btn-apply-redactions', 'ribbon-clear-all', 'tool-undo',
    'form-text-field', 'form-checkbox', 'form-radio',
    'insert-page', 'delete-page',
    'rotate-left', 'rotate-right',
    'add-text'
  ];
  for (const id of additionalBtnIds) {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = locked;
  }

  // If locked and current tool is an annotation tool, switch back to select
  if (locked && !READONLY_ALLOWED_TOOLS.has(state.currentTool)) {
    setTool('select');
  }
}

// Reset to hand tool whenever a PDF is loaded (avoids circular dependency with loader.js)
document.addEventListener('pdf-loaded', () => {
  setTool('hand');
});
