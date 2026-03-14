import { state, getActiveDocument, selectAllOnPage, clearSelection } from '../core/state.js';
import { undo, redo, recordAdd, recordBulkDelete, recordDelete, recordModify, recordBulkModify, recordClearPage } from '../core/undo-manager.js';
import { setTool } from './manager.js';
import { showPreferencesDialog } from '../core/preferences.js';
import { showDocPropertiesDialog, showNewDocDialog } from '../ui/chrome/dialogs.js';
import { copyAnnotation, copyAnnotations } from '../annotations/clipboard.js';
import { redrawAnnotations, redrawContinuous } from '../annotations/rendering.js';
import { applyMove } from '../annotations/transforms.js';
import { createMeasureAreaAnnotation, createMeasurePerimeterAnnotation } from './annotation-creators.js';
import { openPDFFile, isPdfAReadOnly } from '../pdf/loader.js';
import { actualSize, fitWidth, fitPage } from '../pdf/renderer.js';
import { savePDF, savePDFAs } from '../pdf/saver.js';
import { toggleAnnotationsListPanel } from '../ui/panels/annotations-list.js';
import { toggleLeftPanel } from '../ui/panels/left-panel.js';
import { switchRibbonTab as switchToTab } from '../bridge.js';
import { openFindBar, closeFindBar, onFindNext } from '../search/find-bar.js';
import { closeActiveTab } from '../ui/chrome/tabs.js';
import { hideProperties, showProperties, showMultiSelectionProperties, togglePropertiesPanel } from '../ui/panels/properties-panel.js';
import { openDialog, aiPanelVisible, setAiPanelVisible, aiIsAuthenticated } from '../bridge.js';
import { getTool } from './tool-registry.js';

function redraw() {
  if (getActiveDocument()?.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

// Handle keydown events
export async function handleKeydown(e) {
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
      onFindNext();
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

  // Delegate keydown to active tool (e.g. arc mode toggle for measureArea)
  const _activeTool = getTool(state.currentTool);
  if (_activeTool && _activeTool.onKeyDown) {
    // Build a minimal context for tool key handlers
    const _keyCtx = { state, redraw };
    _activeTool.onKeyDown(_keyCtx, e);
    if (e.defaultPrevented) return;
  }

  // Enter key - complete area/perimeter measurement
  if (e.key === 'Enter' && state.measurePoints && state.measurePoints.length >= 2) {
    e.preventDefault();
    const points = [...state.measurePoints];
    let ann;
    if (state.currentTool === 'measureArea' && points.length >= 3) {
      ann = createMeasureAreaAnnotation(points);
    } else if (state.currentTool === 'measurePerimeter' && points.length >= 2) {
      ann = createMeasurePerimeterAnnotation(points);
    }
    if (ann) {
      const doc = getActiveDocument();
      if (doc) doc.annotations.push(ann);
      recordAdd(ann);
    }
    state.measurePoints = null;
    redraw();
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
    closeActiveTab();
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
    const _selDoc = getActiveDocument();
    if (_selDoc?.pdfDoc) {
      selectAllOnPage();
      const _selAnns = _selDoc.selectedAnnotations;
      if (_selAnns.length === 1) {
        showProperties(_selAnns[0]);
      } else if (_selAnns.length > 1) {
        showMultiSelectionProperties();
      }
      redraw();
    }
  } else if (e.key === 'Delete') {
    e.preventDefault();
    // Delete selected PDF object when selectObjects tool is active
    if (state.currentTool === 'selectObjects') {
      import('../solid/stores/panels/pdfObjectStore.js').then(async (store) => {
        const selected = store.selectedPdfObject();
        if (selected) {
          const { deletePdfObject } = await import('./pdf-object-actions.js');
          await deletePdfObject(selected);
        }
      });
      return;
    }
    if (isPdfAReadOnly()) { /* block */ }
    else if ((getActiveDocument()?.selectedAnnotations || []).length > 0) {
      const selected = [...getActiveDocument().selectedAnnotations];
      // Single locked check
      if (selected.length === 1 && selected[0].locked) return;

      // Confirmation dialog
      {
        const { showConfirm } = await import('../ui/chrome/confirm-dialog.js');
        const msg = selected.length > 1
          ? `Delete ${selected.length} annotations?`
          : 'Delete this annotation?';
        const title = selected.length > 1 ? 'Delete Annotations' : 'Delete Annotation';
        const confirmed = await showConfirm({ title, message: msg, preferenceKey: 'confirmBeforeDelete' });
        if (!confirmed) return;
      }

      const doc = getActiveDocument();
      if (selected.length > 1) {
        recordBulkDelete(selected);
      } else {
        recordDelete(selected[0], (doc?.annotations || []).indexOf(selected[0]));
      }
      const toDelete = new Set(selected);
      if (doc) doc.annotations = doc.annotations.filter(a => !toDelete.has(a));
      clearSelection();
      hideProperties();
      redraw();
    }
  }
  // Arrow keys: nudge selected annotations (skip when Ctrl held)
  else if (!ctrl && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    if (isPdfAReadOnly()) { /* block nudge */ }
    else if ((getActiveDocument()?.selectedAnnotations || []).length > 0 && getActiveDocument()?.pdfDoc) {
      // Text markup annotations are anchored to text — skip nudge
      const movable = getActiveDocument().selectedAnnotations.filter(a =>
        !['textHighlight', 'textStrikethrough', 'textUnderline'].includes(a.type));
      if (movable.length === 0) return;

      e.preventDefault();
      const nudgeDoc = getActiveDocument();
      const step = (shift ? 10 : 1) / (nudgeDoc?.scale || 1);
      let dx = 0, dy = 0;
      if (e.key === 'ArrowLeft') dx = -step;
      else if (e.key === 'ArrowRight') dx = step;
      else if (e.key === 'ArrowUp') dy = -step;
      else if (e.key === 'ArrowDown') dy = step;

      if (movable.length > 1) {
        const originals = movable.map(a => ({ ...a }));
        for (const ann of movable) applyMove(ann, dx, dy);
        recordBulkModify(movable, originals);
      } else {
        const original = { ...movable[0] };
        applyMove(movable[0], dx, dy);
        recordModify(movable[0].id, original, movable[0]);
      }
      redraw();
    }
  }

  else if (ctrl && shift && e.key === 'C') {
    e.preventDefault();
    let confirmed = false;
    if (window.__TAURI__?.dialog?.ask) {
      confirmed = await window.__TAURI__.dialog.ask('Clear all annotations on current page?', { title: 'Clear Page', kind: 'warning' });
    } else {
      confirmed = confirm('Clear all annotations on current page?');
    }
    if (confirmed) {
      const cpDoc = getActiveDocument();
      const cpPage = cpDoc ? cpDoc.currentPage : 1;
      recordClearPage(cpPage, cpDoc?.annotations || []);
      if (cpDoc) cpDoc.annotations = cpDoc.annotations.filter(a => a.page !== cpPage);
      hideProperties();
      redraw();
    }
  } else if (ctrl && shift && e.key === 'A') {
    e.preventDefault();
    if (!aiIsAuthenticated()) { openDialog('ai-login'); return; }
    setAiPanelVisible(!aiPanelVisible());

  } else if (ctrl && !shift && e.key === 'c') {
    // Copy selected annotations (if none selected, let native copy handle text selection)
    const _copyDoc = getActiveDocument();
    const selected = _copyDoc ? _copyDoc.selectedAnnotations : [];
    if (selected.length > 0) {
      e.preventDefault();
      if (selected.length > 1) copyAnnotations(selected);
      else copyAnnotation(selected[0]);
    }
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

  // ESC key - deselect, or close dialogs, or switch back to hand tool
  else if (e.key === 'Escape') {
    e.preventDefault();
    // First check if find bar is open
    if (state.search.isOpen) {
      closeFindBar();
      return;
    }
    // Cancel in-progress dimension drawing
    if (state.isDrawingDimension) {
      state.dimPoints = [];
      state.isDrawingDimension = false;
      redraw();
      return;
    }
    // Cancel in-progress measurement
    if (state.measurePoints) {
      state.measurePoints = null;
      redraw();
      return;
    }
    // If annotations are selected, deselect them first
    if ((getActiveDocument()?.selectedAnnotations || []).length > 0) {
      clearSelection();
      hideProperties();
      redraw();
      return;
    }
    // Otherwise switch to hand tool (default)
    setTool('hand');
    // Switch to Home ribbon tab
    switchToTab('home');
  }

  // View shortcuts
  else if (ctrl && e.key === '=') {
    e.preventDefault();
    import('../pdf/renderer.js').then(m => m.zoomIn());
  } else if (ctrl && e.key === '-') {
    e.preventDefault();
    import('../pdf/renderer.js').then(m => m.zoomOut());
  } else if (ctrl && e.key === '0') {
    e.preventDefault();
    actualSize();
  } else if (ctrl && e.key === '1') {
    e.preventDefault();
    fitWidth();
  } else if (ctrl && e.key === '2') {
    e.preventDefault();
    fitPage();
  } else if (ctrl && e.key === '5') {
    e.preventDefault();
    state.preferences.thinLines = !state.preferences.thinLines;
    if (getActiveDocument()?.pdfDoc) {
      if (getActiveDocument()?.viewMode === 'continuous') {
        import('../pdf/renderer.js').then(m => m.renderContinuous());
      } else {
        import('../pdf/renderer.js').then(m => m.renderPage(getActiveDocument()?.currentPage || 1));
      }
    }
  }

  // Tool shortcuts (only if PDF is loaded)
  else if (getActiveDocument()?.pdfDoc) {
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
    openDialog('shortcuts');
  } else if (e.key === 'F9') {
    e.preventDefault();
    toggleLeftPanel();
  } else if (e.key === 'F12') {
    e.preventDefault();
    togglePropertiesPanel();
  } else if (e.key === 'F11') {
    e.preventDefault();
    toggleAnnotationsListPanel();
  }
}

// Handle native paste event — works reliably on all platforms including Linux/WebKitGTK
function handlePaste(e) {
  if (!getActiveDocument()?.pdfDoc) return;
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
    const clips = state.clipboardAnnotations;
    if (clips && clips.length > 1) {
      pasteAnnotations();
    } else if ((clips && clips.length === 1) || state.clipboardAnnotation) {
      pasteAnnotation();
    }
  });
}

// Initialize keyboard handlers
export function initKeyboardHandlers() {
  document.addEventListener('keydown', handleKeydown);
  document.addEventListener('paste', handlePaste);
}
