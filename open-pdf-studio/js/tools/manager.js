import { state } from '../core/state.js';
import {
  annotationCanvas, pdfContainer,
  toolSelect, toolHand, toolHighlight, toolDraw, toolLine, toolArrow, toolCircle,
  toolBox, toolComment, toolText, toolPolygon, toolCloud,
  toolPolyline, toolTextbox, toolCallout,
  toolStamp, toolSignature, toolMeasureDistance, toolMeasureArea, toolMeasurePerimeter,
  toolRedaction
} from '../ui/dom-elements.js';
import { hideProperties } from '../ui/panels/properties-panel.js';
import { redrawAnnotations } from '../annotations/rendering.js';
import { updateStatusTool } from '../ui/chrome/status-bar.js';

// Get cursor for a given tool
export function getCursorForTool(tool = state.currentTool) {
  switch (tool) {
    case 'select':
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

// Enable or disable text selection based on current tool
function setTextSelectionEnabled(enabled) {
  const textLayers = document.querySelectorAll('.textLayer');
  textLayers.forEach(layer => {
    layer.style.pointerEvents = enabled ? 'none' : 'none';
    // Enable/disable pointer events on spans within text layer
    const spans = layer.querySelectorAll('span');
    spans.forEach(span => {
      span.style.pointerEvents = enabled ? 'auto' : 'none';
      span.style.cursor = enabled ? 'text' : 'default';
    });
  });
}

// Set current tool
export function setTool(tool) {
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

  // Hide properties panel when switching tools
  if (tool !== 'select') {
    hideProperties();
  }

  // Enable text selection only for select tool
  setTextSelectionEnabled(tool === 'select');

  // Update UI - remove active state from all tool buttons
  [toolSelect, toolHand, toolHighlight, toolDraw, toolLine, toolArrow, toolCircle, toolBox, toolComment, toolText].forEach(btn => {
    if (btn) btn.classList.remove('active');
  });
  // Also remove from optional buttons
  [toolPolygon, toolCloud, toolPolyline, toolTextbox, toolCallout,
   toolStamp, toolSignature, toolMeasureDistance, toolMeasureArea, toolMeasurePerimeter, toolRedaction].forEach(btn => {
    if (btn) btn.classList.remove('active');
  });

  switch (tool) {
    case 'select':
      if (toolSelect) toolSelect.classList.add('active');
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
      setAllCanvasCursors('text');
      import('./text-edit-tool.js').then(m => m.activateEditTextTool());
      break;
    default:
      setAllCanvasCursors('default');
  }

  // Update status bar
  updateStatusTool();
}
