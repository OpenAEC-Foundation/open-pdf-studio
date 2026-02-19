/**
 * PDF Annotator - Main Entry Point
 *
 * Single Solid.js render() call mounts the entire UI tree.
 * Canvas/PDF operations remain vanilla JS.
 */

// Core modules
import { state } from './core/state.js';
import { loadPreferences, savePreferences } from './core/preferences.js';
import { initDomElements } from './ui/dom-elements.js';

// UI initialization
import { initMenus } from './ui/chrome/menus.js';
import { initContextMenus } from './ui/chrome/context-menus.js';
import { initAnnotationsList } from './ui/panels/annotations-list.js';
import { initAttachments } from './ui/panels/attachments.js';
import { initLinks } from './ui/panels/links.js';
import { initBookmarks } from './ui/panels/bookmarks.js';
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
import { checkForUpdates } from './ui/chrome/updater.js';

// Solid.js
import { render } from 'solid-js/web';
import App from './solid/App.jsx';

// Tauri API
import { isTauri, isDevMode, getOpenedFile, loadSession, saveSession, fileExists, isDefaultPdfApp, openDefaultAppsSettings } from './core/platform.js';

// Disable default browser context menu
function disableDefaultContextMenu() {
  document.addEventListener('contextmenu', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      return;
    }
    e.preventDefault();
  });
}

// Initialize application
async function init() {
  disableDefaultContextMenu();

  // Load user preferences (before render so theme is applied)
  loadPreferences();

  // Single render call — mounts the entire UI tree
  // render() is synchronous, so DOM elements exist immediately after
  render(() => App(), document.getElementById('app-root'));

  // Now that Solid has rendered, grab canvas and container refs
  initDomElements();

  // Initialize UI components
  initMenus();
  initContextMenus();
  initAnnotationsList();
  initAttachments();
  initLinks();
  initBookmarks();
  initLeftPanel();

  // Initialize text selection
  initTextSelection();

  // Initialize tab management
  initTabs();

  // Initialize find bar
  initFindBar();

  // Populate font dropdowns with system fonts
  initFontDropdowns();

  // Setup all event listeners
  setupEventListeners();

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

  // Check for updates silently on startup
  checkForUpdates(true);
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
  if (isTauri()) {
    try {
      const win = window.__TAURI__?.window;
      if (win) {
        const currentWindow = win.getCurrentWindow();
        currentWindow.onCloseRequested(async (event) => {
          while (state.documents.length > 0) {
            const closed = await closeActiveTab();
            if (!closed) {
              event.preventDefault();
              return;
            }
          }
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
  if (!state.preferences.restoreLastSession) {
    return;
  }

  if (!isTauri()) return;

  try {
    const sessionData = await loadSession();

    if (sessionData && sessionData.openFiles && sessionData.openFiles.length > 0) {
      for (const filePath of sessionData.openFiles) {
        try {
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
