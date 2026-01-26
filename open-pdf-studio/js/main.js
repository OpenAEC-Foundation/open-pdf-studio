/**
 * PDF Annotator - Main Entry Point
 *
 * This file initializes the application by importing all necessary modules
 * and setting up event listeners.
 */

// Core modules
import { state } from './core/state.js';
import { loadPreferences } from './core/preferences.js';
import { initCanvasContexts } from './ui/dom-elements.js';

// UI initialization
import { initAboutDialog, initDocPropertiesDialog } from './ui/dialogs.js';
import { initMenus } from './ui/menus.js';
import { initRibbon } from './ui/ribbon.js';
import { initContextMenus } from './ui/context-menus.js';
import { initAnnotationsList } from './ui/annotations-list.js';
import { initAllColorPalettes, initAllPrefColorPalettes } from './ui/color-palette.js';
import { updateAllStatus } from './ui/status-bar.js';
import { initLeftPanel } from './ui/left-panel.js';

// Event setup
import { setupEventListeners } from './events/setup.js';

// PDF operations (for handling file drops from command line args)
import { loadPDF } from './pdf/loader.js';

// Text selection
import { initTextSelection } from './text/text-selection.js';

// Initialize application
async function init() {
  // Initialize canvas contexts
  initCanvasContexts();

  // Load user preferences
  loadPreferences();

  // Initialize UI components
  initMenus();
  initRibbon();
  initAboutDialog();
  initDocPropertiesDialog();
  initContextMenus();
  initAnnotationsList();
  initAllColorPalettes();
  initAllPrefColorPalettes();
  initLeftPanel();

  // Initialize text selection
  initTextSelection();

  // Initialize preferences dialog drag
  initPreferencesDialogDrag();

  // Initialize preferences tab switching
  initPreferencesTabs();

  // Setup all event listeners
  setupEventListeners();

  // Update initial status
  updateAllStatus();

  // Setup IPC listener for auto-loading PDF
  setupAutoLoadListener();

  // Check for file passed as command line argument
  await checkCommandLineArgs();
}

// Initialize preferences dialog drag functionality
function initPreferencesDialogDrag() {
  const overlay = document.getElementById('preferences-dialog');
  if (!overlay) return;

  const dialog = overlay.querySelector('.preferences-dialog');
  const header = overlay.querySelector('.preferences-header');
  if (!dialog || !header) return;

  let isDraggingDialog = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  header.addEventListener('mousedown', (e) => {
    // Don't start drag if clicking on close button
    if (e.target.closest('.preferences-close-btn')) return;

    isDraggingDialog = true;
    const rect = dialog.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDraggingDialog) return;

    const overlayRect = overlay.getBoundingClientRect();
    let newX = e.clientX - overlayRect.left - dragOffsetX;
    let newY = e.clientY - overlayRect.top - dragOffsetY;

    // Constrain to overlay bounds
    const dialogRect = dialog.getBoundingClientRect();
    const maxX = overlayRect.width - dialogRect.width;
    const maxY = overlayRect.height - dialogRect.height;

    newX = Math.max(0, Math.min(newX, maxX));
    newY = Math.max(0, Math.min(newY, maxY));

    dialog.style.left = newX + 'px';
    dialog.style.top = newY + 'px';
    dialog.style.transform = 'none';
  });

  document.addEventListener('mouseup', () => {
    isDraggingDialog = false;
  });
}

// Initialize preferences tab switching
function initPreferencesTabs() {
  document.querySelectorAll('.pref-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      // Remove active from all tabs
      document.querySelectorAll('.pref-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.pref-tab-content').forEach(c => c.classList.remove('active'));

      // Activate clicked tab
      tab.classList.add('active');
      const tabId = tab.getAttribute('data-pref-tab');
      document.getElementById(`pref-tab-${tabId}`)?.classList.add('active');
    });
  });
}

// Check for PDF file passed as command line argument
async function checkCommandLineArgs() {
  try {
    const { ipcRenderer } = window.require('electron');
    const filePath = await ipcRenderer.invoke('get-opened-file');
    if (filePath && filePath.endsWith('.pdf')) {
      await loadPDF(filePath);
    }
  } catch (e) {
    // Not running in Electron or no file passed
  }
}

// Setup IPC listener for auto-loading PDF from main process
function setupAutoLoadListener() {
  try {
    const { ipcRenderer } = window.require('electron');
    ipcRenderer.on('load-pdf', async (event, filePath) => {
      if (filePath && filePath.endsWith('.pdf')) {
        await loadPDF(filePath);
      }
    });
  } catch (e) {
    // Not running in Electron
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
