/**
 * PDF Annotator - Main Entry Point
 *
 * Single Solid.js render() call mounts the entire UI tree.
 * Canvas/PDF operations remain vanilla JS.
 */

// Local startup diagnostics use allowlisted phases and Rust-side redaction.
// They contain no document names or full local paths.
function recordStartupDiagnostic(phase, detail) {
  try {
    window.__TAURI__?.core?.invoke?.('startup_diagnostic', { phase, detail });
  } catch { /* diagnostics must never throw */ }
}

recordStartupDiagnostic('frontend-boot-start');

window.addEventListener('error', (e) => {
  recordStartupDiagnostic('frontend-error', e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  recordStartupDiagnostic('frontend-rejection', String(e.reason?.message || e.reason));
});

// Core modules
import { state } from './core/state.js';
import { loadPreferences, savePreferences } from './core/preferences.js';
import { initDomElements } from './ui/dom-elements.js';
import { initPropertiesPanel } from './ui/panels/properties-panel.js';
import { initToolPalette } from './solid/components/ToolPalette.jsx';
import { initSymbolPalette } from './solid/stores/symbolStore.js';
import { initSteelCatalogs } from './symbols/steel-catalog-store.js';
import { initPaletteOrder } from './solid/stores/paletteOrder.js';
import { initPlugins } from './plugins/plugin-manager.js';

// UI initialization
import { initMenus } from './ui/chrome/menus.js';
import { initFullscreen } from './ui/chrome/fullscreen.js';
import { initContextMenus } from './ui/chrome/context-menus.js';
import { initAnnotationsList } from './ui/panels/annotations-list.js';
import { initAttachments } from './ui/panels/attachments.js';
import { initLinks } from './ui/panels/links.js';
import { initBookmarks } from './ui/panels/bookmarks.js';
import { initLeftPanel } from './ui/panels/left-panel.js';

// Event setup
import { setupEventListeners } from './ui/setup.js';

// Reactive cursor (single source of truth for the PDF area cursor)
import { initCursor } from './ui/cursor.js';

// PDF operations (for handling file drops from command line args)
import { loadPDF } from './pdf/loader.js';
import { fitPage } from './pdf/renderer.js';

// Text selection
import { initTextSelection } from './text/text-selection.js';

// Tab management
import { initTabs, createTab, switchToTab, closeActiveTab } from './ui/chrome/tabs.js';

// Search/Find
import { initFindBar } from './search/find-bar.js';

// Font utilities
import { initFontDropdowns } from './utils/fonts.js';

// Auto-update
import { checkForUpdates } from './ui/chrome/updater.js';

// MCP bridge — wires up `mcp:*` event listeners so the in-process MCP
// server (started with `--mcp-server`) can drive the LIVE WebView from
// outside. Inert when Tauri isn't present.
import { initMcpBridge } from './mcp-bridge.js';

// i18n
import './i18n/config.js';

// Solid.js
import { render } from 'solid-js/web';
import App from './solid/App.jsx';

// Recent files (mobile)
import { addRecentFile } from './mobile/recent-files.js';

// Tauri API
import { isTauri, isMobile, isDevMode, getOpenedFiles, loadSession, saveSession, fileExists, isDefaultPdfApp, openDefaultAppsSettings, extractFileName } from './core/platform.js';

// Global promise queue — serializes all file loads across multiple openFiles() calls
// (Windows single-instance plugin sends separate open-files events per file)
let fileOpenQueue = Promise.resolve();

// Register open-files listener immediately (before init) so events from the
// single-instance plugin are never lost. Queue files until the app is ready.
let appReady = false;
let pendingOpenFiles = [];
if (window.__TAURI__?.event) {
  window.__TAURI__.event.listen('open-files', (event) => {
    const files = event.payload;
    if (!Array.isArray(files)) return;
    if (appReady) {
      openFiles(files);
    } else {
      pendingOpenFiles.push(...files);
    }
  });
}

// Open PDF files: tabs created instantly, loads serialized through global queue
function openFiles(filePaths) {
  // 1. Create all tabs instantly (synchronous) so the tab bar updates right away
  const pending = [];
  for (const filePath of filePaths) {
    if (filePath && filePath.toLowerCase().endsWith('.pdf')) {
      const { index } = createTab(filePath, false); // don't auto-switch
      pending.push({ filePath, index });
    }
  }
  // 2. Switch to the last new tab immediately (shows placeholder until load completes)
  if (pending.length > 0) {
    switchToTab(pending[pending.length - 1].index);
  }
  // 3. Chain loads onto the global queue (serialized even across multiple callers)
  for (const { filePath, index } of pending) {
    fileOpenQueue = fileOpenQueue.then(async () => {
      await loadPDF(filePath, index);
      addRecentFile(filePath, extractFileName(filePath));
    }).catch(e => console.warn('Failed to open file:', filePath, e));
  }
  return fileOpenQueue;
}

// Disable default browser context menu
function disableDefaultContextMenu() {
  document.addEventListener('contextmenu', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      return;
    }
    e.preventDefault();
  });
}

// Block browser/webview default shortcuts in production (Ctrl+I, Ctrl+U, Ctrl+G, etc.)
function disableBrowserShortcuts() {
  document.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl) return;

    // Browser shortcuts to block: inspect (I/Shift+I), view source (U), find (G/Shift+G), console (J)
    const blocked = ['i', 'u', 'g', 'j'];
    if (blocked.includes(e.key.toLowerCase()) && !e.target.matches('input, textarea')) {
      e.preventDefault();
    }
    // Ctrl+P: suppress the WebView2 NATIVE print dialog (it fires as a
    // browser accelerator that the app's bubble-phase handler is too late to
    // stop) and open OUR print dialog instead. Same capture-phase
    // preventDefault that already suppresses the other accelerators above.
    if (e.key.toLowerCase() === 'p' && !e.shiftKey && !e.altKey && !e.target.matches('input, textarea')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      import('./ui/chrome/dialogs.js').then(({ showPrintDialog }) => showPrintDialog());
      return;
    }
    // Ctrl+Shift+I (DevTools), Ctrl+Shift+J (Console), Ctrl+Shift+C (Inspect element)
    if (e.shiftKey && ['I', 'J', 'C'].includes(e.key)) {
      e.preventDefault();
    }
    // F5 refresh, Ctrl+R refresh (allow in dev mode)
    if ((e.key === 'r' || e.key === 'R') && !window.__devMode) {
      e.preventDefault();
    }
  }, true);

  // Block F5/F12 at capture phase
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F5') {
      e.preventDefault();
    }
  }, true);
}

// Initialize application
async function init() {
  const mobile = isMobile();

  // STANDALONE PRINT-QUEUE WINDOW (?view=printqueue): a separate Tauri window
  // opened by the print-catch watcher. Renders ONLY the catch/merge UI — no
  // ribbon, no document workspace, no worker pool usage — so it works as its
  // own window beside the main app instead of as an integrated dialog.
  if (new URLSearchParams(location.search).get('view') === 'printqueue') {
    if (!mobile) disableDefaultContextMenu();
    try { await loadPreferences(); } catch (_) {}
    const { default: PrintQueueWindow } = await import('./solid/components/PrintQueueWindow.jsx');
    render(() => PrintQueueWindow(), document.getElementById('app-root'));
    recordStartupDiagnostic('frontend-ready');
    return;
  }

  // Disable context menu on desktop only (long-press is expected on mobile)
  if (!mobile) {
    disableDefaultContextMenu();
  }

  // Set dev mode flag before blocking shortcuts (allows Ctrl+R refresh in dev)
  if (isTauri()) {
    window.__devMode = await isDevMode();
  }

  // Block browser shortcuts (Ctrl+I, Ctrl+U, F5, etc.)
  if (isTauri() && !mobile) {
    disableBrowserShortcuts();
  }

  // Load user preferences (before render so theme is applied)
  await loadPreferences();

  // Single render call — mounts the entire UI tree
  // render() is synchronous, so DOM elements exist immediately after
  render(() => App(), document.getElementById('app-root'));
  recordStartupDiagnostic('frontend-rendered');

  // Restore properties panel visibility from preferences
  initPropertiesPanel();

  // Restore tool palette visibility, mode and position from preferences
  initPaletteOrder();
  initToolPalette();
  initSymbolPalette();

  // Re-register downloaded parametric steel catalogs from preferences so the
  // palette entries (parametricId) resolve to templates after a restart.
  initSteelCatalogs();

  // Load installed plugins (extension palettes, custom annotation types, etc.)
  initPlugins();

  // Screenshot-annotate mode: wire the PrtScn hotkey event and apply the
  // (opt-in) preference. No-op outside Tauri. Lazy so it never blocks startup.
  import('./tools/screenshot-annotate.js')
    .then(m => m.initScreenshotAnnotate())
    .catch(() => {});

  // Wire the MCP <-> WebView bridge early. The bridge is just
  // event-listener registration on window.__TAURI__.event — it does not need
  // the window to be visible or DOM-ready. Wiring it here means the in-process
  // MCP server's `app_*` tools are available during the remaining startup.
  // Inert outside Tauri.
  initMcpBridge().catch(e => console.warn('initMcpBridge failed:', e));

  // "Open PDF Printer" job queue: watch the spool so prints from ANY
  // application pop the in-app sort/merge dialog. No-op when the virtual
  // printer isn't installed.
  import('./solid/stores/printQueueStore.js')
    .then(m => m.startPrintQueueWatcher())
    .catch(() => {});

  // Lazy-load printer enumeration so the print dialog shows the OS default
  // printer instantly (Ctrl+P) instead of waiting on PowerShell/lpstat.
  import('./solid/stores/printerStore.js')
    .then(m => m.loadPrinters())
    .catch(() => {});

  // The native window is visible from creation; frontend startup cannot keep
  // it hidden. Now that Solid has rendered, grab canvas and container refs.
  initDomElements();

  // Wire the reactive cursor — runs once, then updates the .main-view cursor
  // automatically whenever any cursor-relevant state changes.
  initCursor();

  // Initialize UI components (desktop-only UI modules)
  if (!mobile) {
    initMenus();
    initFullscreen();
    initContextMenus();
    initAnnotationsList();
    initAttachments();
    initLinks();
    initBookmarks();
    initLeftPanel();
    initFindBar();
    initFontDropdowns();
  }

  // Initialize text selection
  initTextSelection();

  // Initialize tab management
  initTabs();

  // Setup all event listeners
  setupEventListeners();

  // Setup session save on window close (desktop only — Android lifecycle handles this)
  if (!mobile) {
    setupSessionSaveOnClose();
  }

  // Listen for deep-link events on mobile (Android intent to open PDF)
  if (mobile && isTauri() && window.__TAURI__?.event) {
    try {
      window.__TAURI__.event.listen('deep-link://new-url', async (event) => {
        try {
          const urls = event.payload;
          if (urls && urls.length > 0) {
            let filePath = urls[0];
            // Strip file:// prefix if present
            if (filePath.startsWith('file://')) {
              filePath = decodeURIComponent(filePath.replace('file://', ''));
            }
            // Accept content:// URIs directly (Android picker uses opaque IDs that don't end in .pdf)
            if (filePath.startsWith('content://') || filePath.toLowerCase().endsWith('.pdf')) {
              const { index } = createTab(filePath);
              await new Promise(r => setTimeout(r, 0));
              initDomElements();
              await loadPDF(filePath, index);
              await fitPage();
              addRecentFile(filePath, extractFileName(filePath));
            }
          }
        } catch (e) {
          console.warn('Failed to handle deep-link:', e);
        }
      });
    } catch (e) {
      console.warn('Failed to setup deep-link listener:', e);
    }
  }

  // Check for file passed as command line argument
  const hasCommandLineFile = await checkCommandLineArgs();

  // Drain any files queued by the single-instance plugin before the app was ready
  if (pendingOpenFiles.length > 0 && !hasCommandLineFile) {
    openFiles(pendingOpenFiles);
  }
  pendingOpenFiles = [];
  appReady = true;

  // Detached-window mode: a detached document window is its OWN app process,
  // launched by `spawn_window_with_pdf` with the PDF path as a command-line
  // argument and `OPDS_DETACHED=1` in its env. The PDF therefore arrives via
  // the normal command-line path (`checkCommandLineArgs` above) — no special
  // handling needed. We only skip session-restore so the detached window
  // shows JUST its one document, not the whole previous session.
  if (!hasCommandLineFile) {
    await restoreLastSession();
  }

  // Dev convenience: ALWAYS have Desktop\test.pdf open on boot — the standing
  // test document, so every reload/restart drops you straight back into it.
  // Dev-only; skipped silently when the file doesn't exist.
  if (import.meta.env.DEV && isTauri() && !hasCommandLineFile) {
    try {
      const desktop = await window.__TAURI__.path.desktopDir();
      const sep = (desktop.endsWith('\\') || desktop.endsWith('/')) ? '' : '\\';
      const testPdf = `${desktop}${sep}test.pdf`;
      const norm = (p) => String(p || '').replace(/\//g, '\\').toLowerCase();
      const alreadyOpen = state.documents.some(d => norm(d.filePath) === norm(testPdf));
      if (!alreadyOpen && await fileExists(testPdf)) {
        await openFiles([testPdf]);
      }
    } catch (e) {
      console.warn('[dev] test.pdf auto-open failed:', e);
    }
  }

  // Cross-window IPC: another window dragged a tab onto OUR tab bar; open it.
  // Setup is best-effort and silent on failure — works only inside Tauri.
  try {
    if (window.__TAURI__?.event?.listen) {
      window.__TAURI__.event.listen('open-pdf-in-window', (evt) => {
        const path = evt?.payload?.pdfPath || evt?.payload?.pdf_path;
        if (path) openFiles([path]);
      });
    }
  } catch (e) {
    console.warn('open-pdf-in-window listener setup failed:', e);
  }

  // Desktop-only: check default PDF app and auto-update (deferred to avoid blocking startup)
  if (!mobile) {
    setTimeout(() => checkDefaultPdfApp(), 3000);
    checkForUpdates(true);
    // What's New dialog — fire-and-forget, never blocks startup.
    setTimeout(() => {
      import('./help/whats-new-trigger.js')
        .then(m => m.checkForNewReleaseOnStartup())
        .catch(() => { /* offline / network error — silently skip */ });
    }, 1500);
  }

  recordStartupDiagnostic('frontend-ready');
}

// Check for PDF files passed as command line arguments
async function checkCommandLineArgs() {
  if (!isTauri()) return false;

  try {
    const files = await getOpenedFiles();
    if (Array.isArray(files) && files.length > 0) {
      await openFiles(files);
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
    await saveSessionData();
  });
}

// Save session data to disk
async function saveSessionData() {
  try {
    // Skip untitled docs: their filePath is a temp file that gets deleted on
    // close — restoring it next launch would open a dangling/empty path.
    const openFiles = state.documents
      .filter(doc => doc.filePath && !doc.isUntitled)
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

// Proactive (debounced) session persistence. The beforeunload hook alone is
// unreliable: its async store-write races the page teardown, so a Vite dev
// full-reload (any plain-.js edit) lost the open documents — exactly when
// you're mid-testing. Hook points (loadPDF / closeTab / switchToTab /
// save-as) call this via window.__OPDS_SESSION_SAVE__ so the session file is
// already on disk BEFORE any reload happens.
let _sessionSaveTimer = null;
function scheduleSessionSave() {
  if (_sessionSaveTimer) clearTimeout(_sessionSaveTimer);
  _sessionSaveTimer = setTimeout(() => {
    _sessionSaveTimer = null;
    saveSessionData();
  }, 400);
}
window.__OPDS_SESSION_SAVE__ = scheduleSessionSave;

// Restore last session if preference is enabled.
// In dev (Vite) ALWAYS restore, regardless of the preference: full-page
// reloads happen on every plain-.js edit and the open test document must
// survive them.
async function restoreLastSession() {
  if (!state.preferences.restoreLastSession && !import.meta.env.DEV) {
    return;
  }

  if (!isTauri()) return;

  try {
    const sessionData = await loadSession();

    if (sessionData && sessionData.openFiles && sessionData.openFiles.length > 0) {
      // Filter to files that still exist, then open in parallel
      const validFiles = [];
      for (const filePath of sessionData.openFiles) {
        try {
          if (await fileExists(filePath)) {
            validFiles.push(filePath);
          }
        } catch (e) {
          console.warn('Failed to check file:', filePath, e);
        }
      }
      if (validFiles.length > 0) {
        await openFiles(validFiles);
      }
    }
  } catch (e) {
    console.warn('Failed to restore session:', e);
  }
}

// Check if this app is the default PDF handler and show info bar if not
async function checkDefaultPdfApp() {
  if (!isTauri()) return;
  if (state.preferences.dontAskDefaultPdf) return;

  try {
    const isDefault = await isDefaultPdfApp();
    if (isDefault) return;

    const { showDefaultAppBar } = await import('./solid/stores/defaultAppBarStore.js');
    showDefaultAppBar();
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
