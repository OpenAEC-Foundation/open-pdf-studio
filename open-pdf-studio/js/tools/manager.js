import { state } from '../core/state.js';
import {
  annotationCanvas,
  toolSelect, toolHighlight, toolDraw, toolLine, toolArrow, toolCircle,
  toolBox, toolComment, toolText, toolPolygon, toolCloud,
  toolPolyline, toolTextbox, toolCallout
} from '../ui/dom-elements.js';
import { hideProperties } from '../ui/properties-panel.js';
import { redrawAnnotations } from '../annotations/rendering.js';
import { updateStatusTool } from '../ui/status-bar.js';

// Set current tool
export function setTool(tool) {
  // Cancel any ongoing polyline drawing when switching tools
  if (state.isDrawingPolyline && tool !== 'polyline') {
    state.polylinePoints = [];
    state.isDrawingPolyline = false;
    redrawAnnotations();
  }

  state.currentTool = tool;

  // Hide properties panel when switching tools
  if (tool !== 'select') {
    hideProperties();
  }

  // Update UI - remove active state from all tool buttons
  [toolSelect, toolHighlight, toolDraw, toolLine, toolArrow, toolCircle, toolBox, toolComment, toolText].forEach(btn => {
    if (btn) btn.classList.remove('active');
  });
  // Also remove from optional buttons
  [toolPolygon, toolCloud, toolPolyline, toolTextbox, toolCallout].forEach(btn => {
    if (btn) btn.classList.remove('active');
  });

  switch (tool) {
    case 'select':
      if (toolSelect) toolSelect.classList.add('active');
      if (annotationCanvas) annotationCanvas.style.cursor = 'default';
      break;
    case 'highlight':
      if (toolHighlight) toolHighlight.classList.add('active');
      if (annotationCanvas) annotationCanvas.style.cursor = 'crosshair';
      break;
    case 'draw':
      if (toolDraw) toolDraw.classList.add('active');
      if (annotationCanvas) annotationCanvas.style.cursor = 'crosshair';
      break;
    case 'line':
      if (toolLine) toolLine.classList.add('active');
      if (annotationCanvas) annotationCanvas.style.cursor = 'crosshair';
      break;
    case 'arrow':
      if (toolArrow) toolArrow.classList.add('active');
      if (annotationCanvas) annotationCanvas.style.cursor = 'crosshair';
      break;
    case 'circle':
      if (toolCircle) toolCircle.classList.add('active');
      if (annotationCanvas) annotationCanvas.style.cursor = 'crosshair';
      break;
    case 'box':
      if (toolBox) toolBox.classList.add('active');
      if (annotationCanvas) annotationCanvas.style.cursor = 'crosshair';
      break;
    case 'polygon':
      if (toolPolygon) toolPolygon.classList.add('active');
      if (annotationCanvas) annotationCanvas.style.cursor = 'crosshair';
      break;
    case 'cloud':
      if (toolCloud) toolCloud.classList.add('active');
      if (annotationCanvas) annotationCanvas.style.cursor = 'crosshair';
      break;
    case 'polyline':
      if (toolPolyline) toolPolyline.classList.add('active');
      if (annotationCanvas) annotationCanvas.style.cursor = 'crosshair';
      break;
    case 'textbox':
      if (toolTextbox) toolTextbox.classList.add('active');
      if (annotationCanvas) annotationCanvas.style.cursor = 'crosshair';
      break;
    case 'callout':
      if (toolCallout) toolCallout.classList.add('active');
      if (annotationCanvas) annotationCanvas.style.cursor = 'crosshair';
      break;
    case 'comment':
      if (toolComment) toolComment.classList.add('active');
      if (annotationCanvas) annotationCanvas.style.cursor = 'crosshair';
      break;
    case 'text':
      if (toolText) toolText.classList.add('active');
      if (annotationCanvas) annotationCanvas.style.cursor = 'text';
      break;
    default:
      if (annotationCanvas) annotationCanvas.style.cursor = 'default';
  }

  // Update status bar
  updateStatusTool();
}
