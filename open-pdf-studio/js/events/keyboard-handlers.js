import { state } from '../core/state.js';
import { propertiesPanel, toolUndo, toolClear, propDelete, zoomInBtn, zoomOutBtn } from '../ui/dom-elements.js';
import { setTool } from '../tools/manager.js';
import { showPreferencesDialog, hidePreferencesDialog } from '../core/preferences.js';
import { showDocPropertiesDialog } from '../ui/dialogs.js';
import { copyAnnotation, pasteFromClipboard } from '../annotations/clipboard.js';
import { redrawAnnotations, redrawContinuous } from '../annotations/rendering.js';
import { openPDFFile } from '../pdf/loader.js';
import { savePDFAs } from '../pdf/saver.js';
import { toggleAnnotationsListPanel } from '../ui/annotations-list.js';
import { toggleLeftPanel } from '../ui/left-panel.js';
import { switchToTab } from '../ui/ribbon.js';

// Handle keydown events
export function handleKeydown(e) {
  // Check if typing in an input field
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
    return;
  }

  const ctrl = e.ctrlKey || e.metaKey;
  const shift = e.shiftKey;

  // File shortcuts
  if (ctrl && e.key === 'o') {
    e.preventDefault();
    openPDFFile();
  } else if (ctrl && e.key === 's') {
    e.preventDefault();
    savePDFAs();
  } else if (ctrl && e.key === 'w') {
    e.preventDefault();
    document.getElementById('menu-close')?.click();
  }

  // Edit shortcuts
  else if (ctrl && !shift && e.key === 'z') {
    e.preventDefault();
    if (toolUndo) toolUndo.click();
  } else if (e.key === 'Delete') {
    e.preventDefault();
    if (state.selectedAnnotation) {
      if (propDelete) propDelete.click();
    }
  } else if (ctrl && shift && e.key === 'C') {
    e.preventDefault();
    if (toolClear) toolClear.click();
  } else if (ctrl && !shift && e.key === 'c') {
    // Copy selected annotation
    e.preventDefault();
    if (state.selectedAnnotation) {
      copyAnnotation(state.selectedAnnotation);
    }
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
    // First check if preferences dialog is open
    const prefsDialog = document.getElementById('preferences-dialog');
    if (prefsDialog && prefsDialog.classList.contains('visible')) {
      hidePreferencesDialog();
      return;
    }
    // Switch to select tool
    setTool('select');
    // Switch to Home ribbon tab
    switchToTab('home');
    // Deselect any selected annotation
    if (state.selectedAnnotation) {
      state.selectedAnnotation = null;
      propertiesPanel.classList.remove('visible');
      if (state.viewMode === 'continuous') {
        redrawContinuous();
      } else {
        redrawAnnotations();
      }
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
