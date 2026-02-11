import { state, selectAllOnPage, clearSelection } from '../core/state.js';
import { undo, redo, recordBulkDelete, recordDelete } from '../core/undo-manager.js';
import { propertiesPanel, toolUndo, toolClear, zoomInBtn, zoomOutBtn } from '../ui/dom-elements.js';
import { setTool } from './manager.js';
import { showPreferencesDialog, hidePreferencesDialog } from '../core/preferences.js';
import { showDocPropertiesDialog } from '../ui/chrome/dialogs.js';
import { copyAnnotation, copyAnnotations, pasteFromClipboard } from '../annotations/clipboard.js';
import { redrawAnnotations, redrawContinuous } from '../annotations/rendering.js';
import { openPDFFile } from '../pdf/loader.js';
import { savePDF, savePDFAs } from '../pdf/saver.js';
import { toggleAnnotationsListPanel } from '../ui/panels/annotations-list.js';
import { toggleLeftPanel } from '../ui/panels/left-panel.js';
import { switchToTab } from '../ui/chrome/ribbon.js';
import { openFindBar, closeFindBar } from '../search/find-bar.js';
import { hideProperties, showProperties, showMultiSelectionProperties } from '../ui/panels/properties-panel.js';

// Handle keydown events
export function handleKeydown(e) {
  const ctrl = e.ctrlKey || e.metaKey;
  const shift = e.shiftKey;

  // Allow certain shortcuts even when in input fields
  const isInInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
  const isFindInput = e.target.id === 'find-input';

  // Handle find-related shortcuts even in inputs
  if (ctrl && e.key === 'f') {
    e.preventDefault();
    openFindBar();
    return;
  }

  if (e.key === 'F3' && !isFindInput) {
    e.preventDefault();
    if (state.search.isOpen) {
      document.getElementById('find-next-btn')?.click();
    } else {
      openFindBar();
    }
    return;
  }

  // Skip other shortcuts if typing in an input field (except find input which handles its own keys)
  if (isInInput && !isFindInput) {
    return;
  }

  // Find input handles Enter, Shift+Enter, and Escape internally
  if (isFindInput) {
    return;
  }

  // File shortcuts
  if (ctrl && e.key === 'o') {
    e.preventDefault();
    openPDFFile();
  } else if (ctrl && shift && e.key === 'S') {
    e.preventDefault();
    savePDFAs();
  } else if (ctrl && e.key === 's') {
    e.preventDefault();
    savePDF();
  } else if (ctrl && e.key === 'w') {
    e.preventDefault();
    document.getElementById('menu-close')?.click();
  }

  // Edit shortcuts
  else if (ctrl && !shift && e.key === 'z') {
    e.preventDefault();
    undo();
  } else if (ctrl && e.key === 'y') {
    e.preventDefault();
    redo();
  } else if (ctrl && shift && e.key === 'Z') {
    e.preventDefault();
    redo();
  } else if (ctrl && !shift && e.key === 'a') {
    // Ctrl+A: Select all annotations on current page
    e.preventDefault();
    if (state.pdfDoc) {
      selectAllOnPage();
      if (state.selectedAnnotations.length === 1) {
        showProperties(state.selectedAnnotations[0]);
      } else if (state.selectedAnnotations.length > 1) {
        showMultiSelectionProperties();
      }
      if (state.viewMode === 'continuous') {
        redrawContinuous();
      } else {
        redrawAnnotations();
      }
    }
  } else if (e.key === 'Delete') {
    e.preventDefault();
    if (state.selectedAnnotations.length > 1) {
      // Multi-selection delete
      if (confirm(`Delete ${state.selectedAnnotations.length} annotations?`)) {
        recordBulkDelete(state.selectedAnnotations);
        const toDelete = new Set(state.selectedAnnotations);
        state.annotations = state.annotations.filter(a => !toDelete.has(a));
        clearSelection();
        hideProperties();
        if (state.viewMode === 'continuous') {
          redrawContinuous();
        } else {
          redrawAnnotations();
        }
      }
    } else if (state.selectedAnnotation) {
      if (state.selectedAnnotation.locked) return;
      const idx = state.annotations.indexOf(state.selectedAnnotation);
      recordDelete(state.selectedAnnotation, idx);
      state.annotations = state.annotations.filter(a => a !== state.selectedAnnotation);
      hideProperties();
      if (state.viewMode === 'continuous') {
        redrawContinuous();
      } else {
        redrawAnnotations();
      }
    }
  } else if (ctrl && shift && e.key === 'C') {
    e.preventDefault();
    if (toolClear) toolClear.click();
  } else if (ctrl && !shift && e.key === 'c') {
    // Copy selected annotations
    if (state.selectedAnnotations.length > 1) {
      e.preventDefault();
      copyAnnotations(state.selectedAnnotations);
    } else if (state.selectedAnnotation) {
      e.preventDefault();
      copyAnnotation(state.selectedAnnotation);
    }
    // If no annotation selected, let native copy handle text selection
  } else if (ctrl && !shift && e.key === 'v') {
    // Paste from clipboard
    e.preventDefault();
    pasteFromClipboard();
  } else if (ctrl && e.key === ',') {
    e.preventDefault();
    showPreferencesDialog();
  } else if (ctrl && e.key === 'd') {
    e.preventDefault();
    showDocPropertiesDialog();
  }

  // ESC key - close dialogs or switch back to select tool
  else if (e.key === 'Escape') {
    e.preventDefault();
    // First check if find bar is open
    if (state.search.isOpen) {
      closeFindBar();
      return;
    }
    // Check if preferences dialog is open
    const prefsDialog = document.getElementById('preferences-dialog');
    if (prefsDialog && prefsDialog.classList.contains('visible')) {
      hidePreferencesDialog();
      return;
    }
    // Switch to select tool
    setTool('select');
    // Switch to Home ribbon tab
    switchToTab('home');
    // Deselect any selected annotations
    if (state.selectedAnnotation || state.selectedAnnotations.length > 0) {
      clearSelection();
      hideProperties();
    }
  }

  // View shortcuts
  else if (ctrl && e.key === '=') {
    e.preventDefault();
    if (zoomInBtn) zoomInBtn.click();
  } else if (ctrl && e.key === '-') {
    e.preventDefault();
    if (zoomOutBtn) zoomOutBtn.click();
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
  else if (state.pdfDoc) {
    if (e.key === 'v' || e.key === 'V') {
      e.preventDefault();
      setTool('select');
    } else if (e.key === 'h' || e.key === 'H') {
      e.preventDefault();
      setTool('hand');
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
      setTool('textbox');
    } else if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      setTool('comment');
    }
  }

  // Help shortcuts
  if (e.key === 'F1') {
    e.preventDefault();
    document.getElementById('ribbon-shortcuts')?.click();
  } else if (e.key === 'F9') {
    e.preventDefault();
    toggleLeftPanel();
  } else if (e.key === 'F12') {
    e.preventDefault();
    document.getElementById('menu-show-properties')?.click();
  } else if (e.key === 'F11') {
    e.preventDefault();
    toggleAnnotationsListPanel();
  }
}

// Initialize keyboard handlers
export function initKeyboardHandlers() {
  document.addEventListener('keydown', handleKeydown);
}
