import { state } from '../../core/state.js';
import { statusTool, statusAnnotations, statusMessage, zoomLevel, pageInput, pageTotal } from '../dom-elements.js';

// Update status bar tool indicator
export function updateStatusTool() {
  if (!statusTool) return;

  const toolNames = {
    'select': 'Select Tool',
    'selectComments': 'Select Comments',
    'hand': 'Hand Tool',
    'highlight': 'Highlight',
    'draw': 'Freehand',
    'line': 'Line',
    'arrow': 'Arrow',
    'circle': 'Ellipse',
    'box': 'Rectangle',
    'polygon': 'Polygon',
    'cloud': 'Cloud',
    'polyline': 'Polyline',
    'textbox': 'Text Box',
    'callout': 'Callout',
    'comment': 'Sticky Note',
    'text': 'Text'
  };

  statusTool.textContent = toolNames[state.currentTool] || state.currentTool;
}

// Update status bar page indicator
export function updateStatusPage() {
  if (!pageInput || !pageTotal) return;

  pageInput.value = state.currentPage;
  pageInput.max = state.pdfDoc?.numPages || 1;
  pageTotal.textContent = state.pdfDoc?.numPages || 0;
}

// Update status bar zoom indicator
export function updateStatusZoom() {
  if (!zoomLevel) return;
  zoomLevel.value = `${Math.round(state.scale * 100)}%`;
}

// Update status bar annotation count
export function updateStatusAnnotations() {
  if (!statusAnnotations) return;

  const pageAnnotations = state.annotations.filter(a => a.page === state.currentPage);
  const totalAnnotations = state.annotations.length;

  if (state.viewMode === 'continuous') {
    statusAnnotations.textContent = `${totalAnnotations}`;
  } else {
    statusAnnotations.textContent = `${pageAnnotations.length} (${totalAnnotations} total)`;
  }
}

// Update status message (temporary message)
let messageTimeout = null;

export function updateStatusMessage(message, duration = 3000) {
  if (!statusMessage) return;

  // Clear any existing timeout
  if (messageTimeout) {
    clearTimeout(messageTimeout);
  }

  statusMessage.textContent = message;
  statusMessage.style.display = 'inline';

  // Clear message after duration
  messageTimeout = setTimeout(() => {
    statusMessage.textContent = '';
    statusMessage.style.display = 'none';
  }, duration);
}

// Update all status bar elements
export function updateAllStatus() {
  updateStatusTool();
  updateStatusPage();
  updateStatusZoom();
  updateStatusAnnotations();
}
