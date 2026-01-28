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

// Tab management
import { initTabs, createTab } from './ui/tabs.js';

// Search/Find
import { initFindBar } from './search/find-bar.js';

// Tauri API
import { isTauri, getOpenedFile, loadSession, saveSession, fileExists } from './tauri-api.js';

// Disable default browser context menu in production
function disableDefaultContextMenu() {
  // Only disable in Tauri (production) environment
  if (!isTauri()) return;

  document.addEventListener('contextmenu', (e) => {
    // Allow context menu on input/textarea for copy/paste
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      return;
    }
    e.preventDefault();
  });
}

// Initialize application
async function init() {
  // Disable browser context menu in production
  disableDefaultContextMenu();

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

  // Initialize tab management
  initTabs();

  // Initialize find bar
  initFindBar();

  // Initialize preferences dialog drag
  initPreferencesDialogDrag();

  // Initialize preferences tab switching
  initPreferencesTabs();

  // Setup all event listeners
  setupEventListeners();

  // Update initial status
  updateAllStatus();

  // Setup session save on window close
  setupSessionSaveOnClose();

  // Check for file passed as command line argument
  const hasCommandLineFile = await checkCommandLineArgs();

  // Restore last session if enabled and no command line file
  if (!hasCommandLineFile) {
    await restoreLastSession();
  }
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
  if (!isTauri()) return false;

  try {
    const filePath = await getOpenedFile();
    if (filePath && filePath.toLowerCase().endsWith('.pdf')) {
      createTab(filePath);
      await loadPDF(filePath);
      return true;
    }
  } catch (e) {
    console.warn('Failed to check command line args:', e);
  }
  return false;
}

// Save session data (open documents) before window closes
function setupSessionSaveOnClose() {
  window.addEventListener('beforeunload', async () => {
    if (!isTauri()) return;

    try {
      // Get list of open file paths (only files that have been saved)
      const openFiles = state.documents
        .filter(doc => doc.filePath)
        .map(doc => doc.filePath);

      const sessionData = {
        openFiles: openFiles,
        activeIndex: state.activeDocumentIndex
      };

      await saveSession(sessionData);
    } catch (e) {
      console.warn('Failed to save session:', e);
    }
  });
}

// Restore last session if preference is enabled
async function restoreLastSession() {
  // Check if restore is enabled in preferences
  if (!state.preferences.restoreLastSession) {
    return;
  }

  if (!isTauri()) return;

  try {
    const sessionData = await loadSession();

    if (sessionData && sessionData.openFiles && sessionData.openFiles.length > 0) {
      // Load each file from the saved session
      for (const filePath of sessionData.openFiles) {
        try {
          // Check if file still exists
          if (await fileExists(filePath)) {
            createTab(filePath);
            await loadPDF(filePath);
          }
        } catch (e) {
          console.warn('Failed to restore file:', filePath, e);
        }
      }
    }
  } catch (e) {
    console.warn('Failed to restore session:', e);
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
