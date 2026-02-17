/**
 * PDF Annotator - Main Entry Point
 *
 * This file initializes the application by importing all necessary modules
 * and setting up event listeners.
 */

// Core modules
import { state } from './core/state.js';
import { loadPreferences, savePreferences } from './core/preferences.js';
import { initCanvasContexts } from './ui/dom-elements.js';

// UI initialization
import { initAboutDialog, initDocPropertiesDialog, initNewDocDialog, initExportDialog, initInsertPageDialog, initExtractPagesDialog, initMergePdfsDialog, initPrintDialog, initPageSetupDialog } from './ui/chrome/dialogs.js';
import { initSignatureDialog } from './annotations/signature.js';
import { initMenus } from './ui/chrome/menus.js';
import { initRibbon } from './ui/chrome/ribbon.js';
import { initContextMenus } from './ui/chrome/context-menus.js';
import { initAnnotationsList } from './ui/panels/annotations-list.js';
import { initWatermarkDialog, initHeaderFooterDialog, initManageWatermarksDialog } from './watermark/watermark-dialog.js';
import { initAttachments } from './ui/panels/attachments.js';
import { initLinks } from './ui/panels/links.js';
import { initAllColorPalettes, initAllPrefColorPalettes } from './ui/panels/color-palette.js';
import { updateAllStatus } from './ui/chrome/status-bar.js';
import { initLeftPanel } from './ui/panels/left-panel.js';

// Event setup
import { setupEventListeners } from './ui/setup.js';

// PDF operations (for handling file drops from command line args)
import { loadPDF } from './pdf/loader.js';

// Text selection
import { initTextSelection } from './text/text-selection.js';

// Tab management
import { initTabs, createTab, closeActiveTab } from './ui/chrome/tabs.js';

// Search/Find
import { initFindBar } from './search/find-bar.js';

// Font utilities
import { initFontDropdowns } from './utils/fonts.js';

// Auto-update
import { initUpdater, checkForUpdates } from './ui/chrome/updater.js';

// Tauri API
import { isTauri, isDevMode, getOpenedFile, loadSession, saveSession, fileExists, isDefaultPdfApp, openDefaultAppsSettings } from './core/platform.js';

// Disable default browser context menu
function disableDefaultContextMenu() {
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
  await disableDefaultContextMenu();

  // Initialize canvas contexts
  initCanvasContexts();


  // Load user preferences
  loadPreferences();

  // Initialize UI components
  initMenus();
  initRibbon();
  initAboutDialog();
  initDocPropertiesDialog();
  initNewDocDialog();
  initSignatureDialog();
  initExportDialog();
  initInsertPageDialog();
  initExtractPagesDialog();
  initMergePdfsDialog();
  initPrintDialog();
  initPageSetupDialog();
  initContextMenus();
  initAnnotationsList();
  initWatermarkDialog();
  initHeaderFooterDialog();
  initManageWatermarksDialog();
  initAttachments();
  initLinks();
  initAllColorPalettes();
  initAllPrefColorPalettes();
  initLeftPanel();

  // Initialize text selection
  initTextSelection();

  // Initialize tab management
  initTabs();

  // Initialize find bar
  initFindBar();

  // Populate font dropdowns with system fonts
  initFontDropdowns();

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

  // Check if this app is the default PDF handler
  await checkDefaultPdfApp();

  // Initialize auto-updater and check for updates silently
  initUpdater();
  checkForUpdates(true);
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
  // Intercept Tauri window close (Alt+F4, system close) to prompt for unsaved changes
  if (isTauri()) {
    try {
      const win = window.__TAURI__?.window;
      if (win) {
        const currentWindow = win.getCurrentWindow();
        currentWindow.onCloseRequested(async (event) => {
          // Try to close all tabs, prompting for unsaved changes
          while (state.documents.length > 0) {
            const closed = await closeActiveTab();
            if (!closed) {
              // User cancelled — prevent window close
              event.preventDefault();
              return;
            }
          }
          // All tabs closed (saved or discarded), save session and allow close
          await saveSessionData();
        });
      }
    } catch (e) {
      console.warn('Failed to setup close handler:', e);
    }
  }

  window.addEventListener('beforeunload', async () => {
    if (!isTauri()) return;
    await saveSessionData();
  });
}

// Save session data to disk
async function saveSessionData() {
  try {
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

// Check if this app is the default PDF handler and suggest setting it
async function checkDefaultPdfApp() {
  if (!isTauri()) return;
  if (state.preferences.dontAskDefaultPdf) return;

  try {
    const isDefault = await isDefaultPdfApp();
    if (isDefault) return;

    // Ask the user using native Tauri dialog
    if (window.__TAURI__?.dialog?.message) {
      const result = await window.__TAURI__.dialog.message(
        'Open PDF Studio is not set as the default app for opening PDF files. Would you like to set it as the default?',
        {
          title: 'Default PDF App',
          kind: 'info',
          buttons: { yes: 'Set as Default', no: "Don't Ask Again", cancel: 'Not Now' }
        }
      );

      if (result === 'Yes' || result === 'Set as Default') {
        await openDefaultAppsSettings();
      } else if (result === 'No' || result === "Don't Ask Again") {
        state.preferences.dontAskDefaultPdf = true;
        savePreferences();
      }
      // 'Cancel' / 'Not Now' → do nothing, will ask again next time
    }
  } catch (e) {
    console.warn('Failed to check default PDF app:', e);
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
