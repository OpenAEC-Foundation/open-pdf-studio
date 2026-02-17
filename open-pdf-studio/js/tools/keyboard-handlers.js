import { state, selectAllOnPage, clearSelection } from '../core/state.js';
import { undo, redo, recordBulkDelete, recordDelete, recordModify, recordBulkModify } from '../core/undo-manager.js';
import { propertiesPanel, toolUndo, toolClear, zoomInBtn, zoomOutBtn } from '../ui/dom-elements.js';
import { setTool } from './manager.js';
import { showPreferencesDialog, hidePreferencesDialog } from '../core/preferences.js';
import { showDocPropertiesDialog, showNewDocDialog } from '../ui/chrome/dialogs.js';
import { copyAnnotation, copyAnnotations } from '../annotations/clipboard.js';
import { redrawAnnotations, redrawContinuous } from '../annotations/rendering.js';
import { applyMove } from '../annotations/transforms.js';
import { openPDFFile, isPdfAReadOnly } from '../pdf/loader.js';
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
  if (ctrl && e.key === 'n') {
    e.preventDefault();
    showNewDocDialog();
  } else if (ctrl && e.key === 'o') {
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
  } else if (ctrl && e.key === 'p') {
    e.preventDefault();
    import('../ui/chrome/dialogs.js').then(({ showPrintDialog }) => showPrintDialog());
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
    if (isPdfAReadOnly()) { /* block */ }
    else if (state.selectedAnnotations.length > 1) {
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
  }
  // Arrow keys: nudge selected annotations (skip when Ctrl held)
  else if (!ctrl && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    if (isPdfAReadOnly()) { /* block nudge */ }
    else if ((state.selectedAnnotations.length > 0 || state.selectedAnnotation) && state.pdfDoc) {
      e.preventDefault();
      const step = (shift ? 10 : 1) / (state.scale || 1);
      let dx = 0, dy = 0;
      if (e.key === 'ArrowLeft') dx = -step;
      else if (e.key === 'ArrowRight') dx = step;
      else if (e.key === 'ArrowUp') dy = -step;
      else if (e.key === 'ArrowDown') dy = step;

      if (state.selectedAnnotations.length > 1) {
        const originals = state.selectedAnnotations.map(a => ({ ...a }));
        for (const ann of state.selectedAnnotations) applyMove(ann, dx, dy);
        recordBulkModify(state.selectedAnnotations, originals);
      } else if (state.selectedAnnotation) {
        const original = { ...state.selectedAnnotation };
        applyMove(state.selectedAnnotation, dx, dy);
        recordModify(state.selectedAnnotation.id, original, state.selectedAnnotation);
      }

      if (state.viewMode === 'continuous') {
        redrawContinuous();
      } else {
        redrawAnnotations();
      }
    }
  }

  else if (ctrl && shift && e.key === 'C') {
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
    // Don't preventDefault — let native paste event fire so handlePaste can
    // read clipboardData.items (required on Linux/WebKitGTK where the async
    // Clipboard API is unavailable).
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
    document.getElementById('actual-size-ribbon')?.click();
  } else if (ctrl && e.key === '1') {
    e.preventDefault();
    document.getElementById('fit-width')?.click();
  } else if (ctrl && e.key === '2') {
    e.preventDefault();
    document.getElementById('fit-page-ribbon')?.click();
  }

  // Tool shortcuts (only if PDF is loaded)
  else if (state.pdfDoc) {
    const pdfaLocked = isPdfAReadOnly();
    if (e.key === 'v' || e.key === 'V') {
      e.preventDefault();
      setTool('select');
    } else if (e.key === 'h' || e.key === 'H') {
      e.preventDefault();
      setTool('hand');
    } else if (!pdfaLocked && (e.key === '1')) {
      e.preventDefault();
      setTool('highlight');
    } else if (!pdfaLocked && (e.key === '2')) {
      e.preventDefault();
      setTool('draw');
    } else if (!pdfaLocked && (e.key === '3')) {
      e.preventDefault();
      setTool('line');
    } else if (!pdfaLocked && (e.key === '4')) {
      e.preventDefault();
      setTool('box');
    } else if (!pdfaLocked && (e.key === '5')) {
      e.preventDefault();
      setTool('circle');
    } else if (!pdfaLocked && (e.key === 't' || e.key === 'T')) {
      e.preventDefault();
      setTool('textbox');
    } else if (!pdfaLocked && (e.key === 'n' || e.key === 'N')) {
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

// Handle native paste event — works reliably on all platforms including Linux/WebKitGTK
function handlePaste(e) {
  if (!state.pdfDoc) return;
  if (isPdfAReadOnly()) return;
  const isInInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
  if (isInInput) return;

  // Must preventDefault synchronously before any async work
  e.preventDefault();

  // Check for image data in the native clipboard event
  const items = e.clipboardData?.items;
  if (items) {
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (blob) {
          import('../annotations/clipboard.js').then(({ pasteImageFromBlob }) => {
            pasteImageFromBlob(blob);
          });
        }
        return;
      }
    }
  }

  // No image found — paste from internal annotation clipboard
  import('../annotations/clipboard.js').then(({ pasteAnnotation, pasteAnnotations }) => {
    if (state.clipboardAnnotations && state.clipboardAnnotations.length > 1) {
      pasteAnnotations();
    } else if (state.clipboardAnnotation) {
      pasteAnnotation();
    }
  });
}

// Initialize keyboard handlers
export function initKeyboardHandlers() {
  document.addEventListener('keydown', handleKeydown);
  document.addEventListener('paste', handlePaste);
}
