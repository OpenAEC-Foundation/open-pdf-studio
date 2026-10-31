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
// Snellere pdf-lib-standaarden voor elke load en save (#581); als eerste,
// vóór elk module dat pdf-lib gebruikt.
import './pdf/pdf-lib-snelheid.js';
// Polyfills voor oudere Android-WebViews (#596): vóór PDF.js en de rest van
// de app (pdf-lib hierboven heeft ze niet nodig).
import './core/oude-webview-start.js';
// Gesplitste weergave (#715): vroeg, zodat zijn capture-luisteraar op window
// vóór die van de gereedschappen staat (die pas bij hun init komen); zie
// split-haken.js. Zonder afhankelijkheden.
import './pdf/split-view/split-haken.js';
import { state } from './core/state.js';
import { loadPreferences, savePreferences } from './core/preferences.js';
import { initDomElements } from './ui/dom-elements.js';
import { initPropertiesPanel } from './ui/panels/properties-panel.js';
import { initToolPalette } from './solid/components/ToolPalette.jsx';
import { initSymbolPalette } from './solid/stores/symbolStore.js';
import { initSteelCatalogs } from './symbols/steel-catalog-store.js';
import { initLineworkCatalogs } from './symbols/linework-catalog-store.js';
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
import { loadPDF, loadPDFIfNeeded } from './pdf/loader.js';
import { createFileOpenQueue } from './pdf/queued-load.js';
import { fitPage } from './pdf/renderer.js';

// Text selection
import { initTextSelection } from './text/text-selection.js';

// Tab management
import { initTabs, createTab, switchToTab, closeActiveTab } from './ui/chrome/tabs.js';

// Search/Find
import { initFindBar, applySourcePreferences } from './search/find-bar.js';

// Font utilities
import { initFontDropdowns } from './utils/fonts.js';

// Auto-update

// MCP bridge — wires up `mcp:*` event listeners so the in-process MCP
// server (started with `--mcp-server`) can drive the LIVE WebView from
// outside. Inert when Tauri isn't present.
import { initMcpBridge } from './mcp-bridge.js';

// i18n
import i18next from './i18n/config.js';
import { language } from './i18n/useTranslation.js';
import { installeerGetalVelden, herformatteerGetalVelden } from './ui/getal-veld.js';

// Solid.js
import { render } from 'solid-js/web';
import App from './solid/App.jsx';

// Recent files (mobile)
import { addRecentFile } from './mobile/recent-files.js';

// Tauri API
import { isTauri, isMobile, isDevMode, getOpenedFiles, loadSession, saveSession, fileExists, isDefaultPdfApp, openDefaultAppsSettings, extractFileName, invoke } from './core/platform.js';
import { instantieRol, taakToegestaan } from './core/instantie-rol.js';
import { volgendeTaak } from './core/volgende-taak.js';
import { meldSchoonAfsluiten } from './herstel/haken.js';
import { sessieHerstelBeleid } from './core/sessie-herstel.js';
import { sessieBestanden, bronPad } from './pdf/wachtwoord-pdf.js';
// De brug naar de gastpagina (#694): alleen in de gehoste bouw.
import { startHostBrug } from './core/host-brug-start.js';
import { installeerWorkerShim } from './core/blob-worker.js';
import { sneltoetsActief } from './core/keybindings/app-shortcuts.js';

// Open PDF files: tabs created instantly, loads serialized through ONE global
// queue - also across separate openFiles() calls (the Windows single-instance
// plugin sends a separate open-files event per file). The loop itself lives in
// queued-load.js, where it runs in a unit test against a real store.
const openFiles = createFileOpenQueue({
  documents: () => state.documents,
  createTab,
  switchToTab,
  loadPDF,
  // Only a file that really opened: not one whose password dialog was
  // cancelled (its tab is closed again) or that failed to load.
  onLoaded: (filePath) => {
    if (state.documents.some(d => d.pdfDoc && bronPad(d) === filePath)) {
      addRecentFile(filePath, extractFileName(filePath));
    }
    // Op een telefoon past de pagina in het scherm, net als bij Openen in de
    // mobiele weergave; "Openen met" uit een andere app komt hier binnen (#593).
    const actief = state.documents[state.activeDocumentIndex];
    if (isMobile() && actief?.pdfDoc && bronPad(actief) === filePath) fitPage();
  },
});

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

    // In een tekstinvoer (input/textarea/contenteditable zoals de PDF-tekst-
    // editor) horen Ctrl+I (cursief) en co bij het bewerken — niet blokkeren.
    const inTekstinvoer = e.target.matches('input, textarea') || e.target.isContentEditable;

    // Browser shortcuts to block: inspect (I/Shift+I), view source (U), find (G/Shift+G), console (J)
    const blocked = ['i', 'u', 'g', 'j'];
    if (blocked.includes(e.key.toLowerCase()) && !inTekstinvoer) {
      e.preventDefault();
    }
    // Ctrl+P: suppress the WebView2 NATIVE print dialog (it fires as a
    // browser accelerator that the app's bubble-phase handler is too late to
    // stop) and open OUR print dialog instead. Same capture-phase
    // preventDefault that already suppresses the other accelerators above.
    if (e.key.toLowerCase() === 'p' && !e.shiftKey && !e.altKey && !e.target.matches('input, textarea')) {
      e.preventDefault();
      // De afdrukdialoog van de WebView blijft altijd weg; de onze opent
      // alleen zolang Ctrl+P bij Afdrukken hoort. Gaf de gebruiker Ctrl+P aan
      // een andere opdracht, dan handelt de gewone toetsafhandeling hem af (#714).
      if (!sneltoetsActief('file.print', 'Ctrl+P')) return;
      e.stopImmediatePropagation();
      import('./ui/chrome/dialogs.js').then(({ showPrintDialog }) => showPrintDialog());
      return;
    }
    // Ctrl+Shift+I (DevTools), Ctrl+Shift+J (Console), Ctrl+Shift+C (Inspect element)
    if (e.shiftKey && ['i', 'j', 'c'].includes(e.key.toLowerCase())) {
      e.preventDefault();
    }
    // F5 refresh, Ctrl+R refresh (allow in dev mode)
    if (e.key.toLowerCase() === 'r' && !window.__devMode) {
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
  // Gehoste bouw in een iframe met `#ouder=…`: het opslagcontract met de
  // gastpagina neerzetten vóór iets het leest (core/host-brug.js, #694). De
  // gewone bouw kent deze regel niet: Vite vult de modus in en de tak valt weg.
  if (import.meta.env.MODE === 'hosted') {
    // Elke worker uit een blob: in de werkplek (opaque origin) start een
    // worker van een http-adres niet (core/blob-worker.js, #704).
    installeerWorkerShim(window);
    startHostBrug();
  }
  // Getalvelden accepteren komma én punt; ze tonen het decimaalteken van de
  // app-taal en schakelen mee bij een taalwissel (ui/getal-veld.js).
  installeerGetalVelden({ taal: () => language() });
  i18next.on('languageChanged', () => queueMicrotask(() => herformatteerGetalVelden()));
  // Dev: versienummer live uit package.json zodat de titelbalk na een
  // versie-bump klopt zonder Vite-herstart.
  import('./core/app-version.js').then((m) => m.initDevVersionSync()).catch(() => {});
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
  // Hoofdinstantie of tweede instantie (losgemaakt tabblad)? Een tweede
  // instantie laat sessie, AI-koppeling, printwachtrij en PrtScn aan de
  // hoofdinstantie over (core/instantie-rol.js).
  const rol = isTauri() ? await instantieRol(invoke) : { tweede: false };
  // AI-koppeling volgens de instelling (niet wachten: bindt alleen een poort).
  if (taakToegestaan('mcp-koppeling', rol)) {
    import('./core/mcp-koppeling.js').then(m => m.pasMcpInstellingToe());
  }

  // In de browser liep alles tot hier (de modules laden) en het opbouwen van
  // het venster als één lange taak: eerst de beurt teruggeven (#707). Op het
  // bureaublad gaf loadPreferences() die beurt al terug.
  if (!isTauri()) await volgendeTaak();

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
  initLineworkCatalogs();

  // Load installed plugins (extension palettes, custom annotation types, etc.)
  initPlugins();

  // Screenshot-annotate mode: wire the PrtScn hotkey event and apply the
  // (opt-in) preference. No-op outside Tauri. Lazy so it never blocks startup.
  if (taakToegestaan('prtscn', rol)) {
    import('./tools/screenshot-annotate.js')
      .then(m => m.initScreenshotAnnotate())
      .catch(() => {});
  }

  // Wire the MCP <-> WebView bridge early. The bridge is just
  // event-listener registration on window.__TAURI__.event — it does not need
  // the window to be visible or DOM-ready. Wiring it here means the in-process
  // MCP server's `app_*` tools are available during the remaining startup.
  // Inert outside Tauri.
  initMcpBridge().catch(e => console.warn('initMcpBridge failed:', e));

  // "Open PDF Printer" job queue: watch the spool so prints from ANY
  // application pop the in-app sort/merge dialog. No-op when the virtual
  // printer isn't installed.
  if (taakToegestaan('printwachtrij', rol)) {
    import('./solid/stores/printQueueStore.js')
      .then(m => m.startPrintQueueWatcher())
      .catch(() => {});
    // The printer window ("Open printer settings") asks this window to show
    // the Virtual printer tab of the preferences.
    import('./solid/stores/printQueueStore.js')
      .then(m => m.listenForPrinterSettingsRequests())
      .catch(() => {});
  }

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
    applySourcePreferences();
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
              // The same file tapped again is already open: only show it. A
              // reload would drop its unsaved annotations and undo history.
              if (await loadPDFIfNeeded(filePath, index)) await fitPage();
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

  // Als gast in de OpenAEC-site: het document dat de site meegeeft openen
  // via het opslagcontract van de site (#546). Zonder contract gebeurt niets.
  if (!hasCommandLineFile) {
    import('./pdf/host-document.js')
      .then(m => m.startMetGastsite())
      .catch(e => console.warn('[gast] openen via de site mislukt:', e));
  }

  // Detached-window mode: a detached document window is its OWN app process,
  // launched by `spawn_window_with_pdf` with the PDF path as a command-line
  // argument and `OPDS_DETACHED=1` in its env. The PDF therefore arrives via
  // the normal command-line path (`checkCommandLineArgs` above) — no special
  // handling needed. We only skip session-restore so the detached window
  // shows JUST its one document, not the whole previous session.
  if (!hasCommandLineFile) {
    // Not awaited: the window is already rendered and interactive at this
    // point (render() ran long before this line) — waiting here just made
    // the whole app FEEL frozen until every previously-open tab finished
    // reloading. Tabs still appear and load the same way, just without
    // blocking "ready" on it. restoreLastSession() has its own try/catch.
    if (taakToegestaan('sessie-herstellen', rol)) restoreLastSession();
  }

  // Herstel van niet-opgeslagen werk (js/herstel/): momentopnamen in elke
  // instantie, het aanbod na een onverwachte afsluiting alleen in de
  // hoofdinstantie (een losgemaakt tabblad toont het niet nog eens).
  if (isTauri()) {
    import('./herstel/herstel.js')
      .then((m) => m.startHerstel({ hoofd: taakToegestaan('herstel-aanbieden', rol) }))
      .catch((e) => console.warn('[herstel] start failed:', e));
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

  // Desktop-only: check default PDF app (deferred to avoid blocking startup)
  if (!mobile) {
    if (taakToegestaan('standaard-app', rol)) setTimeout(() => checkDefaultPdfApp(), 3000);
    // Draagbaar (#881): melden als de map naast het programma niet
    // beschrijfbaar is en de gegevens dus toch in het gebruikersprofiel staan.
    import('./core/draagbaar.js')
      .then((m) => m.leesDraagbaar())
      .then(async (s) => {
        if (!s.dataDirError) return;
        const { showMessage } = await import('./solid/stores/dialogStore.js');
        showMessage(i18next.t('common:portable.notWritable', { dir: s.exeDir || '' }));
      })
      .catch(() => {});
    // Geen automatische update-check meer bij het opstarten: het update-venster
    // verscheen ongevraagd. Updaten kan nog handmatig via Help → Controleren op
    // updates (checkForUpdates(false)).
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
          // Alles opgeslagen of bewust verworpen: een nette afsluiting, de
          // herstelmomentopnamen en de markering "draait" mogen weg.
          await meldSchoonAfsluiten();
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
    // Een tweede instantie (losgemaakt tabblad) schrijft de sessie niet: ze
    // zou de tabbladen van de hoofdinstantie overschrijven.
    if (!taakToegestaan('sessie-bewaren', await instantieRol(invoke))) return;
    // Skip untitled docs: their filePath is a temp file that gets deleted on
    // close — restoring it next launch would open a dangling/empty path.
    // A PDF opened with a password is stored by its ORIGINAL path, never by
    // its decrypted working copy: the next launch asks the password again.
    const openFiles = sessieBestanden(state.documents);

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
  const beleid = sessieHerstelBeleid({
    inTauri: isTauri(),
    voorkeurAan: !!state.preferences.restoreLastSession,
    inDev: !!import.meta.env.DEV,
  });
  if (!beleid.herstellen) {
    // In de browser blijft het niet bij zwijgen: de lege weergave en de
    // voorkeur zeggen dat een herlaadbeurt daar leeg begint (#456). Een oude
    // sessie uit een vorige versie wordt hier opgeruimd.
    if (beleid.reden === 'geen-webopslag') saveSession({ openFiles: [] });
    return;
  }

  try {
    const sessionData = await loadSession();

    if (sessionData && sessionData.openFiles && sessionData.openFiles.length > 0) {
      // Filter to files that still exist — checked in parallel (was a
      // sequential for-await loop, one IPC round-trip at a time).
      const existenceChecks = await Promise.all(
        sessionData.openFiles.map(async (filePath) => {
          try {
            return (await fileExists(filePath)) ? filePath : null;
          } catch (e) {
            console.warn('Failed to check file:', filePath, e);
            return null;
          }
        })
      );
      const validFiles = existenceChecks.filter(Boolean);
      if (validFiles.length > 0) {
        // The existence checks above can take seconds on cloud/network drives.
        // If the user already opened a document meanwhile, restore the old
        // tabs in the background instead of yanking focus away from it.
        await openFiles(validFiles, { activate: state.documents.length === 0 });
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
  // Draagbaar (#881): niet bij Windows geregistreerd, dus niet vragen.
  const { leesDraagbaar, functieBeschikbaar } = await import('./core/draagbaar.js');
  if (!functieBeschikbaar('defaultAppPrompt', await leesDraagbaar())) return;

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
