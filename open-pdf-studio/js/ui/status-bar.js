import { state } from '../core/state.js';
import { statusTool, statusPage, statusZoom, statusAnnotations, statusMessage } from './dom-elements.js';

// Update status bar tool indicator
export function updateStatusTool() {
  if (!statusTool) return;

  const toolNames = {
    'select': 'Select Tool',
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

  statusTool.textContent = `Tool: ${toolNames[state.currentTool] || state.currentTool}`;
}

// Update status bar page indicator
export function updateStatusPage() {
  if (!statusPage) return;

  if (state.viewMode === 'continuous') {
    statusPage.textContent = `Continuous View - ${state.pdfDoc?.numPages || 0} pages`;
  } else {
    statusPage.textContent = `Page ${state.currentPage} of ${state.pdfDoc?.numPages || 0}`;
  }
}

// Update status bar zoom indicator
export function updateStatusZoom() {
  if (!statusZoom) return;
  statusZoom.textContent = `Zoom: ${Math.round(state.scale * 100)}%`;
}

// Update status bar annotation count
export function updateStatusAnnotations() {
  if (!statusAnnotations) return;

  const pageAnnotations = state.annotations.filter(a => a.page === state.currentPage);
  const totalAnnotations = state.annotations.length;

  if (state.viewMode === 'continuous') {
    statusAnnotations.textContent = `Annotations: ${totalAnnotations}`;
  } else {
    statusAnnotations.textContent = `Annotations: ${pageAnnotations.length} (${totalAnnotations} total)`;
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
