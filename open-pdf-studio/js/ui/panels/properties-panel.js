import { state } from '../../core/state.js';
import { redrawAnnotations, redrawContinuous } from '../../annotations/rendering.js';
import {
  storeShowProperties,
  storeHideProperties,
  storeClosePanel,
  storeShowMultiSelection,
  storeShowTextEditProperties,
  setPanelVisible,
  panelVisible,
} from '../../solid/stores/propertiesStore.js';

function redraw() {
  if (state.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }
}

// Show properties panel for a single annotation
export function showProperties(annotation) {
  state.selectedAnnotation = annotation;
  storeShowProperties(annotation);
  redraw();
}

// Hide properties (deselect annotation, show doc info)
export function hideProperties() {
  state.selectedAnnotation = null;
  storeHideProperties();
  redraw();
}

// Close the properties panel entirely (X button)
export function closePropertiesPanel() {
  state.selectedAnnotation = null;
  storeClosePanel();
  redraw();
}

// Toggle properties panel open/closed (for keyboard shortcut)
export function togglePropertiesPanel() {
  if (panelVisible()) {
    closePropertiesPanel();
  } else {
    setPanelVisible(true);
    if (state.selectedAnnotation) {
      showProperties(state.selectedAnnotation);
    } else {
      hideProperties();
    }
  }
}

// Show properties panel for multi-selection
export function showMultiSelectionProperties() {
  const selected = state.selectedAnnotations;
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
