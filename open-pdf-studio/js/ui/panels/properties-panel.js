import { state, getActiveDocument } from '../../core/state.js';
import { redrawAnnotations, redrawContinuous } from '../../annotations/rendering.js';
import { savePreferences } from '../../core/preferences.js';
import { clearTextSelection } from '../../text/text-selection.js';
import {
  storeShowProperties,
  storeHideProperties,
  storeClosePanel,
  storeShowMultiSelection,
  storeShowTextEditProperties,
  setPropertiesPanelVisible as setPanelVisible,
  propertiesPanelVisible as panelVisible,
  setPropertiesPanelCollapsed as setPanelCollapsed,
  propertiesPanelCollapsed as panelCollapsed,
} from '../../bridge.js';

function redraw() {
  if (getActiveDocument()?.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }
}

// Show properties panel for a single annotation
export function showProperties(annotation) {
  clearTextSelection();
  const doc = state.documents[state.activeDocumentIndex];
  if (doc) {
    doc.selectedAnnotation = annotation;
  }
  storeShowProperties(annotation);
  redraw();
}

// Hide properties (deselect annotation, show doc info)
export function hideProperties() {
  const doc = getActiveDocument();
  if (doc) { doc.selectedAnnotation = null; doc.selectedAnnotations = []; }
  storeHideProperties();
  redraw();
}

// Collapse the properties panel (keeps the vertical strip visible)
export function closePropertiesPanel() {
  setPanelCollapsed(true);
}

// Toggle properties panel expanded/collapsed (for keyboard shortcut F12 and ribbon button)
export function togglePropertiesPanel() {
  if (!panelVisible()) {
    setPanelVisible(true);
    setPanelCollapsed(false);
    state.preferences.propertiesPanelVisible = true;
    savePreferences();
    const _togDoc = getActiveDocument();
    if (_togDoc?.selectedAnnotation) {
      showProperties(_togDoc.selectedAnnotation);
    } else {
      hideProperties();
    }
  } else if (panelCollapsed()) {
    setPanelCollapsed(false);
  } else {
    setPanelCollapsed(true);
  }
}

// Initialize panel — restore visibility from saved preferences
export function initPropertiesPanel() {
  const visible = state.preferences?.propertiesPanelVisible !== false;
  setPanelVisible(visible);
  setPanelCollapsed(false);
}

// Show properties panel for multi-selection
export function showMultiSelectionProperties() {
  clearTextSelection();
  const _multiDoc = getActiveDocument();
  const selected = _multiDoc ? _multiDoc.selectedAnnotations : [];
  if (!selected || selected.length < 2) return;
  storeShowMultiSelection(selected);
}

// Show text edit properties (PDF text editing mode)
export function showTextEditProperties(info) {
  storeShowTextEditProperties(info);
}

// No-op functions - Solid handles these inline now
export function updateAnnotationProperties() {}
export function updateArrowProperties() {}
export function updateTextFormatProperties() {}
export function updateColorDisplay() {}
