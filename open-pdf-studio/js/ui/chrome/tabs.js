import { state, createDocument, getActiveDocument, findDocumentByPath, clearSelection } from '../../core/state.js';
import { renderPage, renderContinuous, clearPdfView } from '../../pdf/renderer.js';
import { hideFormFieldsBar } from '../../pdf/form-layer.js';
import { redrawAnnotations, redrawContinuous, updateQuickAccessButtons } from '../../annotations/rendering.js';
import { updateAllStatus } from './status-bar.js';
import { generateThumbnails, clearThumbnails, clearThumbnailCache, refreshActiveTab } from '../panels/left-panel.js';
import { openPDFFile, cancelAnnotationLoading } from '../../pdf/loader.js';
import { savePDF } from '../../pdf/saver.js';
import { unlockFile } from '../../core/platform.js';

const tabsContainer = document.getElementById('document-tabs');
const noDocsMessage = document.getElementById('no-docs-message');

/**
 * Create a new tab for a document
 * @param {string} filePath - Path to the PDF file (null for new untitled document)
 * @returns {Object} The created document object
 */
export function createTab(filePath = null) {
  // Check if file is already open
  if (filePath) {
    const existingIndex = findDocumentByPath(filePath);
    if (existingIndex !== -1) {
      // File already open, switch to its tab
      switchToTab(existingIndex);
      return state.documents[existingIndex];
    }
  }

  // Create new document
  const doc = createDocument(filePath);
  state.documents.push(doc);

  // Switch to the new tab
  const newIndex = state.documents.length - 1;
  switchToTab(newIndex);

  // Update tab bar UI
  updateTabBar();

  return doc;
}

/**
 * Switch to a specific tab
 * @param {number} index - Index of the tab to switch to
 */
export function switchToTab(index) {
  if (index < 0 || index >= state.documents.length) return;

  // Save scroll position of current document
  const currentDoc = getActiveDocument();
  if (currentDoc) {
    const container = document.getElementById('pdf-container');
    if (container) {
      currentDoc.scrollPosition = {
        x: container.scrollLeft,
        y: container.scrollTop
      };
    }
  }

  // Clear any selected annotation
  state.selectedAnnotation = null;
  const propertiesPanel = document.getElementById('properties-panel');
  if (propertiesPanel) {
    propertiesPanel.classList.remove('visible');
  }

  // Switch active document
  state.activeDocumentIndex = index;

  // Update tab bar UI
  updateTabBar();

  // Hide form fields bar before rendering (will be re-shown if new doc has form fields)
  hideFormFieldsBar();

  // Render the new active document
  const newDoc = getActiveDocument();
  if (newDoc && newDoc.pdfDoc) {
    if (newDoc.viewMode === 'continuous') {
      renderContinuous();
    } else {
      renderPage(newDoc.currentPage);
    }

    // Restore scroll position
    const container = document.getElementById('pdf-container');
    if (container && newDoc.scrollPosition) {
      setTimeout(() => {
        container.scrollLeft = newDoc.scrollPosition.x;
        container.scrollTop = newDoc.scrollPosition.y;
      }, 50);
    }

    // Regenerate thumbnails for the new document
    generateThumbnails();

    // Refresh active left panel tab content
    refreshActiveTab();
  } else {
    // No PDF loaded for this document yet
    clearPdfView();
    clearThumbnails();
  }

  // Update UI elements
  updateAllStatus();
  updateQuickAccessButtons();
  updateWindowTitle();
}

/**
 * Close a tab
 * @param {number} index - Index of the tab to close
 * @param {boolean} force - Force close without checking for unsaved changes
 * @returns {boolean} True if tab was closed, false if cancelled
 */
export async function closeTab(index, force = false) {
  if (index < 0 || index >= state.documents.length) return false;

  // Cancel any in-progress background annotation loading
  cancelAnnotationLoading();

  const doc = state.documents[index];

  // Check for unsaved changes - show Save / Don't Save / Cancel dialog
  if (!force && doc.modified) {
    const action = await showUnsavedChangesDialog(doc.fileName);
    if (action === 'cancel') return false;
    if (action === 'save') {
      const saved = await savePDF();
      if (!saved) return false; // Save failed or was cancelled
    }
    // action === 'dontsave' → proceed to close without saving
  }

  // Clear selection and hide contextual ribbon tabs
  clearSelection();
  document.querySelectorAll('.contextual-tabs').forEach(el => {
    el.classList.remove('visible');
  });

  // Release file lock so other apps can write to it again
  if (doc.filePath) {
    await unlockFile(doc.filePath);
  }

  // Clear thumbnail cache for this document
  clearThumbnailCache(doc.id);

  // Remove the document
  state.documents.splice(index, 1);

  // Adjust active index
  if (state.documents.length === 0) {
    state.activeDocumentIndex = -1;
    clearPdfView();
    clearThumbnails();
    updateWindowTitle();
  } else if (index <= state.activeDocumentIndex) {
    // If closing current or earlier tab, adjust index
    state.activeDocumentIndex = Math.max(0, state.activeDocumentIndex - 1);
    switchToTab(state.activeDocumentIndex);
  }

  // Update tab bar UI
  updateTabBar();
  updateQuickAccessButtons();

  return true;
}

/**
 * Show unsaved changes dialog with Save / Don't Save / Cancel options.
 * Uses native Tauri 3-button dialog when available, falls back to browser confirm.
 * @param {string} fileName - Name of the file with unsaved changes
 * @returns {Promise<'save'|'dontsave'|'cancel'>}
 */
async function showUnsavedChangesDialog(fileName) {
  if (window.__TAURI__?.dialog?.message) {
    const result = await window.__TAURI__.dialog.message(
      `Do you want to save changes to "${fileName}"?`,
      {
        title: 'Save Changes',
        kind: 'warning',
        buttons: { yes: 'Save', no: "Don't Save", cancel: 'Cancel' }
      }
    );
    // result is 'Yes', 'No', or 'Cancel' (or the custom label string)
    if (result === 'Yes' || result === 'Save') return 'save';
    if (result === 'No' || result === "Don't Save") return 'dontsave';
    return 'cancel';
  }

  // Fallback for non-Tauri: browser confirm (only supports 2 choices)
  const result = confirm(`"${fileName}" has unsaved changes.\n\nClick OK to save before closing, or Cancel to discard changes.`);
  return result ? 'save' : 'dontsave';
}

/**
 * Close the current active tab
 * @returns {boolean} True if tab was closed
 */
export async function closeActiveTab() {
  if (state.activeDocumentIndex === -1) return false;
  return closeTab(state.activeDocumentIndex);
}

/**
 * Check if any open document has unsaved changes
 * @returns {boolean}
 */
export function hasUnsavedChanges() {
  return state.documents.some(doc => doc.modified);
}

/**
 * Get list of unsaved document names
 * @returns {string[]}
 */
export function getUnsavedDocumentNames() {
  return state.documents.filter(doc => doc.modified).map(doc => doc.fileName);
}

/**
 * Update the tab bar UI to reflect current documents
 */
export function updateTabBar() {
  if (!tabsContainer) return;

  // Clear existing tabs and add button (except the no-docs message)
  const existingTabs = tabsContainer.querySelectorAll('.document-tab, .document-tabs-add');
  existingTabs.forEach(tab => tab.remove());

  // Show/hide no docs message
  if (noDocsMessage) {
    noDocsMessage.style.display = state.documents.length === 0 ? 'flex' : 'none';
  }

  // Create tabs for each document
  state.documents.forEach((doc, index) => {
    const tab = document.createElement('div');
    tab.className = 'document-tab' + (index === state.activeDocumentIndex ? ' active' : '');
    tab.dataset.index = index;

    // Modified indicator
    const modifiedIndicator = document.createElement('span');
    modifiedIndicator.className = 'document-tab-modified';
    modifiedIndicator.textContent = doc.modified ? '*' : '';

    // Tab title
    const title = document.createElement('span');
    title.className = 'document-tab-title';
    title.textContent = doc.fileName;
    title.title = doc.filePath || doc.fileName;

    // Close button
    const closeBtn = document.createElement('span');
    closeBtn.className = 'document-tab-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.title = 'Close';

    // Event handlers
    tab.addEventListener('click', (e) => {
      if (!e.target.classList.contains('document-tab-close')) {
        switchToTab(index);
      }
    });

    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(index);
    });

    // Middle-click to close
    tab.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        closeTab(index);
      }
    });

    tab.appendChild(modifiedIndicator);
    tab.appendChild(title);
    tab.appendChild(closeBtn);
    tabsContainer.appendChild(tab);
  });

  // Add the "+" button after all tabs
  const addButton = document.createElement('div');
  addButton.className = 'document-tabs-add';
  addButton.innerHTML = '+';
  addButton.title = 'Open PDF file';
  addButton.addEventListener('click', () => {
    openPDFFile();
  });
  tabsContainer.appendChild(addButton);
}

/**
 * Update window title based on active document
 */
export function updateWindowTitle() {
  const doc = getActiveDocument();
  const baseTitle = 'OpenPDFStudio';

  // Update document.title (browser/OS window title)
  if (doc) {
    const modified = doc.modified ? '*' : '';
    document.title = `${modified}${doc.fileName} - ${baseTitle}`;
  } else {
    document.title = baseTitle;
  }

  // Update the file-info element in the custom title bar
  const fileInfo = document.getElementById('file-info');
  if (fileInfo) {
    if (doc && doc.fileName) {
      const modified = doc.modified ? '* ' : '';
      fileInfo.textContent = `${modified}${doc.fileName}`;
    } else {
      fileInfo.textContent = '';
    }
  }

  // Also update the tab bar to reflect any filename changes
  updateTabBar();
}

/**
 * Mark the active document as modified
 */
export function markDocumentModified() {
  const doc = getActiveDocument();
  if (doc && !doc.modified) {
    doc.modified = true;
    updateTabBar();
    updateWindowTitle();
  }
}

/**
 * Mark the active document as saved (not modified)
 */
export function markDocumentSaved() {
  const doc = getActiveDocument();
  if (doc) {
    doc.modified = false;
    updateTabBar();
    updateWindowTitle();
  }
}

/**
 * Initialize tab management
 */
export function initTabs() {
  updateTabBar();
}
