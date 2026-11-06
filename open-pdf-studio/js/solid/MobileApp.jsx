import { createSignal, onMount, onCleanup, Show, For } from 'solid-js';
import { useTranslation } from '../i18n/useTranslation.js';
import { state, getActiveDocument } from '../core/state.js';
import { isTauri, extractFileName } from '../core/platform.js';
import { knopUit, meldingTekst } from '../core/webfuncties.js';
import { loadPDF, loadPDFIfNeeded } from '../pdf/loader.js';
import { fitWidth, fitPage, goToPage, setZoom } from '../pdf/renderer.js';
import { draaiVanafKnop } from '../pdf/pagina-draaien.js';
import { createTab } from '../ui/chrome/tabs.js';
import { initDomElements } from '../ui/dom-elements.js';
import { applyTheme, savePreferences } from '../core/preferences.js';
import { getSelectedText } from '../text/text-selection.js';
import { initPinchZoom, initDoubleTap, initSwipeNavigation } from '../mobile/touch-gestures.js';
import { getRecentFiles, addRecentFile, clearRecentFiles } from '../mobile/recent-files.js';
import { LANGUAGES } from '../i18n/config.js';
import { changeLanguage } from '../i18n/useTranslation.js';
import LoadingOverlay from './components/LoadingOverlay.jsx';
import DialogHost from './components/DialogHost.jsx';
import { openDialog } from './stores/dialogStore.js';
import { setTool } from '../tools/manager.js';
import { savePDF, savePDFAs } from '../pdf/saver.js';
import { MOBIELE_GEREEDSCHAPPEN } from '../mobile/mobiele-gereedschappen.js';
import { MOBIELE_ACTIES, actieUit, geselecteerdeMarkeringen } from '../mobile/mobiele-acties.js';
import { showMessage } from './stores/dialogStore.js';
import { showLoading, hideLoading } from '../ui/chrome/dialogs.js';
import { foutBericht } from '../core/fout-bericht.js';
import { startIpcWekker } from '../mobile/ipc-wekker.js';

export default function MobileApp() {
  const { t } = useTranslation('common');
  const { t: tRibbon } = useTranslation('ribbon');
  const { t: tContext } = useTranslation('context');
  // Feedback gaat naar een andere host: als gast uit, net als in de
  // titelbalk van het bureaublad (#548). Op Android gewoon aan (#593).
  const feedbackUit = knopUit('send-feedback', { inTauri: isTauri() });
  const [drawerOpen, setDrawerOpen] = createSignal(false);
  const [toolsOpen, setToolsOpen] = createSignal(false);
  const [moreOpen, setMoreOpen] = createSignal(false);
  const [darkMode, setDarkMode] = createSignal(false);
  const [fullscreen, setFullscreen] = createSignal(false);
  const [barsVisible, setBarsVisible] = createSignal(false);
  const [toolbarCollapsed, setToolbarCollapsed] = createSignal(false);
  const [gotoOpen, setGotoOpen] = createSignal(false);
  const [gotoValue, setGotoValue] = createSignal('');
  const [recentFiles, setRecentFiles] = createSignal([]);
  const [copyFabVisible, setCopyFabVisible] = createSignal(false);
  const [prefsOpen, setPrefsOpen] = createSignal(false);
  let fileInputRef;
  // Afbeelding uit de galerij, foto met de camera, en een scan met de camera
  // (#953). `capture` laat de bestandskiezer van Android meteen de camera
  // openen (RustWebChromeClient van wry); zonder camera-app valt hij terug
  // op de gewone bestandskiezer.
  let imageInputRef;
  let photoInputRef;
  let scanInputRef;
  let mainRef;
  let barsTimer = null;

  const hasDocument = () => state.documents && state.documents.length > 0;
  const currentDoc = () => hasDocument() ? state.documents[state.activeDocumentIndex] : null;
  const totalPages = () => state.documents[state.activeDocumentIndex]?.pdfDoc?.numPages || 0;
  const fileName = () => {
    const doc = currentDoc();
    if (!doc || !doc.filePath) return 'Open PDF Studio';
    // Ook voor een content://-URI van Android een leesbare naam.
    return extractFileName(doc.filePath);
  };

  onMount(() => {
    // Read initial theme
    const currentTheme = document.documentElement.getAttribute('data-theme');
    setDarkMode(currentTheme === 'dark');

    // Load recent files
    setRecentFiles(getRecentFiles());

    // Init touch gestures on main container
    if (mainRef) {
      initPinchZoom(mainRef);
      initDoubleTap(mainRef);
      initSwipeNavigation(mainRef);
    }

    // Listen for text selection changes to show/hide copy FAB
    const selectionHandler = () => {
      const text = getSelectedText();
      setCopyFabVisible(!!text);
    };
    document.addEventListener('selectionchange', selectionHandler);

    // Terug uit de bestandskiezer: een wachtend antwoord van de plug-in
    // doorhalen (#596, zie ipc-wekker.js).
    const stopWekker = isTauri()
      ? startIpcWekker({ ping: () => window.__TAURI__?.core?.invoke('plugin:app|version').catch(() => {}) })
      : () => {};

    onCleanup(() => {
      stopWekker();
      document.removeEventListener('selectionchange', selectionHandler);
      if (barsTimer) clearTimeout(barsTimer);
    });
  });

  // --- File operations ---

  // Strategy: Try Tauri dialog first (gives us a content:// URI we can save back to).
  // If dialog plugin is unavailable or fails, fall back to HTML <input type="file">
  // which works on every Android WebView (WRY implements onShowFileChooser).

  async function handleOpen() {
    setDrawerOpen(false);

    // Attempt 1: Tauri dialog plugin (preferred — returns a path we can save to)
    if (isTauri() && window.__TAURI__?.dialog) {
      try {
        const path = await window.__TAURI__.dialog.open({
          multiple: false,
          filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
        });
        if (path) {
          const { index } = createTab(path);
          await new Promise(r => setTimeout(r, 0));
          initDomElements();
          // Picking a file that is already open only shows it: a reload
          // would drop its unsaved annotations and undo history.
          if (await loadPDFIfNeeded(path, index)) await fitPage();
          addRecentFile(path, extractFileName(path));
          setRecentFiles(getRecentFiles());
          return; // Success — done
        }
        // path is null = user cancelled, don't fall through
        return;
      } catch (e) {
        console.warn('Tauri dialog failed, falling back to HTML file input:', e);
      }
    }

    // Attempt 2: HTML <input type="file"> (guaranteed fallback)
    fileInputRef?.click();
  }

  async function handleFileInput(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const arrayBuffer = await file.arrayBuffer();
      const data = new Uint8Array(arrayBuffer);
      const { index } = createTab(file.name);
      await new Promise(r => setTimeout(r, 0));
      initDomElements();
      await loadPDF(file.name, index, data);
      await fitPage();
      addRecentFile(file.name, file.name);
      setRecentFiles(getRecentFiles());
    } catch (err) {
      alert('Failed to load PDF: ' + foutBericht(err));
      console.warn('Failed to load PDF:', err);
    }
    e.target.value = '';
  }

  async function handleOpenRecent(recent) {
    setDrawerOpen(false);
    // On mobile, content:// URI permissions expire after app restart, and
    // HTML file input paths are just display names — neither can be reopened.
    // Prompt the user to re-pick the file.
    alert('Please use the Open button to reopen this file. Android does not allow apps to reopen files by path.');
  }

  function handleClearRecents() {
    clearRecentFiles();
    setRecentFiles([]);
  }

  // --- Navigation ---

  const isRTL = () => document.documentElement.getAttribute('dir') === 'rtl';

  function handlePrevPage() {
    if (!hasDocument()) return;
    const doc = getActiveDocument();
    if (doc && doc.currentPage > 1) {
      goToPage(doc.currentPage - 1);
    }
  }

  function handleNextPage() {
    if (!hasDocument()) return;
    const doc = getActiveDocument();
    if (doc && doc.currentPage < totalPages()) {
      goToPage(doc.currentPage + 1);
    }
  }

  function handleZoomIn() {
    if (!hasDocument()) return;
    const doc = getActiveDocument();
    const currentScale = doc?.scale || 1.5;
    const newScale = Math.min(5.0, currentScale * 1.25);
    setZoom(newScale);
  }

  function handleZoomOut() {
    if (!hasDocument()) return;
    const doc = getActiveDocument();
    const currentScale = doc?.scale || 1.5;
    const newScale = Math.max(0.25, currentScale / 1.25);
    setZoom(newScale);
  }

  // Rechtstreeks aanroepen: de events die hier eerder verstuurd werden
  // ('save-document', 'show-about', 'set-tool') had niemand opgevangen (#593).
  function handleSave() {
    setDrawerOpen(false);
    savePDF().catch((e) => console.warn('Save failed:', e));
  }

  function handleSaveAs() {
    setDrawerOpen(false);
    savePDFAs().catch((e) => console.warn('Save as failed:', e));
  }

  function handleFeedback() {
    setDrawerOpen(false);
    openDialog('feedback');
  }

  function handleAbout() {
    setDrawerOpen(false);
    openDialog('about');
  }

  function handlePickTool(tool) {
    setToolsOpen(false);
    setTool(tool);
  }

  // --- Meer-menu (#953): delen, afbeelding/foto/scan, markeringen ---

  async function handleShare() {
    setDrawerOpen(false);
    setMoreOpen(false);
    const { deelHuidigDocument } = await import('../pdf/delen.js');
    await deelHuidigDocument();
  }

  function redrawAnn() {
    import('../annotations/rendering.js').then((m) => {
      if (getActiveDocument()?.viewMode === 'continuous') m.redrawContinuous();
      else m.redrawAnnotations();
    });
  }

  async function handleImageInput(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const [foto, { addImageFromBytes }] = await Promise.all([
        import('../mobile/foto.js'), import('../annotations/image-drop.js'),
      ]);
      if (foto.moetHercoderen(file.type)) {
        const { bytes } = await foto.fotoNaarJpeg(file);
        await addImageFromBytes(bytes, foto.jpegNaam(file.name));
      } else {
        await addImageFromBytes(new Uint8Array(await file.arrayBuffer()), file.name);
      }
    } catch (err) {
      console.warn('Insert image failed:', err);
      showMessage(t('mobileMore.imageFailed', { error: foutBericht(err) }));
    }
  }

  async function handleScanInput(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      let doel = 'new';
      if (getActiveDocument()?.pdfDoc) {
        const { kiesUitKnoppen } = await import('../pdf/host-opslaan-als-ui.js');
        doel = await kiesUitKnoppen({
          title: t('mobileMore.scanDocument'),
          message: t('mobileMore.scanWhere'),
          knoppen: [
            { id: 'insert', label: t('mobileMore.scanInsertAfter'), primair: true },
            { id: 'new', label: t('mobileMore.scanNewDocument') },
            { id: null, label: t('cancel') },
          ],
        });
        if (!doel) return;
      }
      showLoading(t('mobileMore.scanBusy'));
      const { fotoNaarJpeg, scanDpi, SCAN_MAX_PX } = await import('../mobile/foto.js');
      const { bytes, breedte, hoogte } = await fotoNaarJpeg(file, { max: SCAN_MAX_PX });
      const paginas = [{ bytes, dpi: scanDpi(breedte, hoogte) }];
      if (doel === 'insert') {
        const { finishScan } = await import('../pdf/scanner.js');
        await finishScan(paginas, { ocr: false, destination: 'insert' });
      } else {
        // Een nieuw, naamloos document uit de bytes, zoals een PDF uit de
        // bestandskiezer (handleFileInput); Opslaan vraagt waar.
        const [{ imagesToPdf, scanDocumentName }, { markDocumentModified, updateWindowTitle }] = await Promise.all([
          import('../pdf/scan-to-pdf.js'), import('../ui/chrome/tabs.js'),
        ]);
        // createTab hergebruikt een tabblad met dezelfde naam: een tweede
        // scan in dezelfde minuut krijgt een eigen naam.
        const basis = scanDocumentName();
        let naam = basis;
        for (let n = 2; state.documents.some((d) => d.filePath === naam); n++) {
          naam = basis.replace(/\.pdf$/i, ` (${n}).pdf`);
        }
        const data = await imagesToPdf(paginas, { title: naam.replace(/\.pdf$/i, '') });
        const { index } = createTab(naam);
        await new Promise(r => setTimeout(r, 0));
        initDomElements();
        await loadPDF(naam, index, data);
        const doc = state.documents[index];
        if (doc) { doc.isUntitled = true; doc.fileName = naam; }
        markDocumentModified();
        updateWindowTitle();
        await fitPage();
      }
    } catch (err) {
      console.warn('Scan failed:', err);
      hideLoading();
      showMessage(t('mobileMore.scanFailed', { error: foutBericht(err) }));
      return;
    }
    hideLoading();
  }

  async function handleCopyMarkup() {
    const sel = geselecteerdeMarkeringen(getActiveDocument());
    if (sel.length === 0) return;
    const { copyAnnotation, copyAnnotations } = await import('../annotations/clipboard.js');
    if (sel.length > 1) copyAnnotations(sel);
    else copyAnnotation(sel[0]);
  }

  async function handlePasteMarkup() {
    const { pasteAnnotation, pasteAnnotations } = await import('../annotations/clipboard.js');
    if ((state.clipboardAnnotations?.length || 0) > 1) pasteAnnotations();
    else pasteAnnotation({ bijMuis: false });
  }

  async function handleDeleteMarkup() {
    const doc = getActiveDocument();
    const sel = geselecteerdeMarkeringen(doc);
    if (!doc || sel.length === 0) return;
    const { showConfirm } = await import('../ui/chrome/confirm-dialog.js');
    const ok = await showConfirm({
      title: tContext('deleteAnnotation.title'),
      message: sel.length > 1
        ? `${tContext('multiSelect.deleteAnnotations', { count: sel.length })}?`
        : tContext('deleteAnnotation.confirmSingle'),
      preferenceKey: 'confirmBeforeDelete',
    });
    if (!ok) return;
    const [{ deleteAnnotationsWithUndo }, { hideProperties }] = await Promise.all([
      import('../annotations/mutations.js'), import('../ui/panels/properties-panel.js'),
    ]);
    if (!deleteAnnotationsWithUndo(doc, sel).length) return;
    doc.selectedAnnotation = null;
    doc.selectedAnnotations = [];
    hideProperties();
    redrawAnn();
  }

  // Eén handler per item van MOBIELE_ACTIES (mobiele-acties.test.mjs).
  const ACTIE_HANDLERS = {
    share: handleShare,
    insertImage: () => imageInputRef?.click(),
    // Hyperlink (#953): uit de tekstselectie, anders een vak slepen.
    insertLink: () => import('../annotations/link/link-maken.js').then((m) => m.startLink()),
    takePhoto: () => photoInputRef?.click(),
    scanDocument: () => scanInputRef?.click(),
    copyMarkup: handleCopyMarkup,
    pasteMarkup: handlePasteMarkup,
    deleteMarkup: handleDeleteMarkup,
  };

  function handlePickAction(id) {
    setMoreOpen(false);
    setDrawerOpen(false);
    ACTIE_HANDLERS[id]?.();
  }

  // --- Dark mode toggle ---

  function handleToggleDarkMode() {
    const newMode = !darkMode();
    setDarkMode(newMode);
    applyTheme(newMode ? 'dark' : 'light');
  }

  // --- Go-to-page ---

  function handleOpenGoto() {
    const doc = getActiveDocument();
    setGotoValue(String(doc ? doc.currentPage : 1));
    setGotoOpen(true);
  }

  function handleGotoSubmit() {
    const num = parseInt(gotoValue(), 10);
    if (!isNaN(num)) {
      const clamped = Math.max(1, Math.min(num, totalPages()));
      goToPage(clamped);
    }
    setGotoOpen(false);
  }

  function handleGotoKeyDown(e) {
    if (e.key === 'Enter') {
      handleGotoSubmit();
    } else if (e.key === 'Escape') {
      setGotoOpen(false);
    }
  }

  // --- Page rotation ---

  function handleRotate() {
    draaiVanafKnop(90);
  }

  // --- Fullscreen ---

  function handleToggleFullscreen() {
    const newState = !fullscreen();
    setFullscreen(newState);
    setBarsVisible(false);

    if (newState) {
      try {
        document.documentElement.requestFullscreen?.();
      } catch (e) { /* ignore */ }
    } else {
      try {
        if (document.fullscreenElement) {
          document.exitFullscreen?.();
        }
      } catch (e) { /* ignore */ }
    }
  }

  function handleFullscreenTap() {
    if (!fullscreen()) return;

    if (barsVisible()) {
      setBarsVisible(false);
      if (barsTimer) clearTimeout(barsTimer);
    } else {
      setBarsVisible(true);
      if (barsTimer) clearTimeout(barsTimer);
      barsTimer = setTimeout(() => {
        setBarsVisible(false);
      }, 3000);
    }
  }

  // --- Text copy ---

  async function handleCopyText() {
    const text = getSelectedText();
    if (text) {
      try {
        await navigator.clipboard.writeText(text);
        setCopyFabVisible(false);
        window.getSelection()?.removeAllRanges();
      } catch (e) {
        console.warn('Failed to copy text:', e);
      }
    }
  }

  // --- Collapsible toolbar ---

  function handleToggleCollapse() {
    setToolbarCollapsed(!toolbarCollapsed());
  }

  return (
    <div class="mobile-app" classList={{ fullscreen: fullscreen(), 'bars-visible': barsVisible() }}>
      {/* Hidden file input for browser fallback */}
      <input
        type="file"
        accept=".pdf,application/pdf"
        style="display:none"
        ref={fileInputRef}
        onChange={handleFileInput}
      />
      <input type="file" accept="image/*" style="display:none" ref={imageInputRef} onChange={handleImageInput} />
      <input type="file" accept="image/*" capture="environment" style="display:none" ref={photoInputRef} onChange={handleImageInput} />
      <input type="file" accept="image/*" capture="environment" style="display:none" ref={scanInputRef} onChange={handleScanInput} />

      {/* Top bar */}
      <div class="mobile-topbar">
        <button class="mobile-topbar-btn" onClick={() => setDrawerOpen(true)} aria-label="Menu">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <span class="mobile-topbar-title">{fileName()}</span>
        <button class="mobile-topbar-btn" onClick={handleToggleDarkMode} aria-label="Toggle dark mode">
          <Show when={darkMode()} fallback={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
            </svg>
          }>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          </Show>
        </button>
        <button class="mobile-topbar-btn" onClick={handleOpen} aria-label="Open file">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
          </svg>
        </button>
      </div>

      {/* Main PDF view */}
      <div class="mobile-main" ref={mainRef} onClick={handleFullscreenTap}>
        <Show when={!hasDocument()}>
          <div class="mobile-placeholder">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="64" height="64">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            <p>Open a PDF file to get started</p>
            <button class="mobile-open-btn" onClick={handleOpen}>
              {t('open')} PDF
            </button>
          </div>
        </Show>

        <div id="placeholder" style="display:none"></div>
        <div id="pdf-container" class="mobile-pdf-container" classList={{ visible: hasDocument() }}>
          <div id="canvas-wrapper">
            <div id="canvas-container" class="single-page-container">
              <canvas id="pdf-canvas"></canvas>
              <canvas id="text-highlight-canvas"></canvas>
              <canvas id="annotation-canvas"></canvas>
            </div>
            <div id="continuous-container" class="continuous-container"></div>
          </div>
        </div>
      </div>

      {/* Bottom toolbar */}
      <Show when={hasDocument()}>
        <div class="mobile-bottombar" classList={{ collapsed: toolbarCollapsed() }}>
          {/* Collapse/expand handle */}
          <button class="mobile-toolbar-collapse-handle" onClick={handleToggleCollapse} aria-label={toolbarCollapsed() ? 'Expand toolbar' : 'Collapse toolbar'}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <Show when={toolbarCollapsed()} fallback={
                <polyline points="6 9 12 15 18 9" />
              }>
                <polyline points="6 15 12 9 18 15" />
              </Show>
            </svg>
          </button>

          <div class="mobile-toolbar-content">
            <button class="mobile-toolbar-btn" onClick={isRTL() ? handleNextPage : handlePrevPage} disabled={isRTL() ? (state.documents[state.activeDocumentIndex]?.currentPage || 1) >= totalPages() : (state.documents[state.activeDocumentIndex]?.currentPage || 1) <= 1} aria-label="Previous page">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>

            <button class="mobile-page-info" onClick={handleOpenGoto} aria-label="Go to page">
              {state.documents[state.activeDocumentIndex]?.currentPage || 1} / {totalPages()}
            </button>

            <button class="mobile-toolbar-btn" onClick={isRTL() ? handlePrevPage : handleNextPage} disabled={isRTL() ? (state.documents[state.activeDocumentIndex]?.currentPage || 1) <= 1 : (state.documents[state.activeDocumentIndex]?.currentPage || 1) >= totalPages()} aria-label="Next page">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="9 6 15 12 9 18" />
              </svg>
            </button>

            <div class="mobile-toolbar-separator"></div>

            <button class="mobile-toolbar-btn" onClick={handleZoomOut} aria-label="Zoom out">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="8" y1="11" x2="14" y2="11" />
              </svg>
            </button>

            <button class="mobile-toolbar-btn" onClick={handleZoomIn} aria-label="Zoom in">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="11" y1="8" x2="11" y2="14" />
                <line x1="8" y1="11" x2="14" y2="11" />
              </svg>
            </button>

            <div class="mobile-toolbar-separator"></div>

            {/* Rotate button */}
            <button class="mobile-toolbar-btn" onClick={handleRotate} aria-label="Rotate page">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="1 4 1 10 7 10" />
                <path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
              </svg>
            </button>

            {/* Fullscreen button */}
            <button class="mobile-toolbar-btn" onClick={handleToggleFullscreen} aria-label={fullscreen() ? 'Exit fullscreen' : 'Fullscreen'}>
              <Show when={fullscreen()} fallback={
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="15 3 21 3 21 9" />
                  <polyline points="9 21 3 21 3 15" />
                  <line x1="21" y1="3" x2="14" y2="10" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              }>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="4 14 10 14 10 20" />
                  <polyline points="20 10 14 10 14 4" />
                  <line x1="14" y1="10" x2="21" y2="3" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              </Show>
            </button>

            <div class="mobile-toolbar-separator"></div>

            <button class="mobile-toolbar-btn" onClick={() => setToolsOpen(!toolsOpen())} aria-label="Annotation tools">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>

            <button class="mobile-toolbar-btn" id="mobile-more" onClick={() => { setToolsOpen(false); setMoreOpen(!moreOpen()); }} aria-label={t('mobileMore.more')}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <circle cx="12" cy="5" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="12" cy="19" r="2" />
              </svg>
            </button>
          </div>
        </div>
      </Show>

      {/* Annotation tools dropdown */}
      <Show when={toolsOpen()}>
        <div class="mobile-tools-overlay" onClick={() => setToolsOpen(false)}>
          <div class="mobile-tools-menu" onClick={(e) => e.stopPropagation()}>
            <For each={MOBIELE_GEREEDSCHAPPEN}>
              {(item) => (
                <button
                  class="mobile-tools-item"
                  classList={{ active: state.currentTool === item.tool }}
                  data-tool={item.tool}
                  onClick={() => handlePickTool(item.tool)}
                >
                  <ToolIcon tool={item.tool} />
                  <span>{tRibbon(item.label)}</span>
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* Meer-menu (#953) */}
      <Show when={moreOpen()}>
        <div class="mobile-tools-overlay" onClick={() => setMoreOpen(false)}>
          <div class="mobile-tools-menu" onClick={(e) => e.stopPropagation()}>
            <For each={MOBIELE_ACTIES}>
              {(item) => (
                <button
                  class="mobile-tools-item"
                  data-action={item.id}
                  disabled={actieUit(item.id, { doc: getActiveDocument(), state })}
                  onClick={() => handlePickAction(item.id)}
                >
                  <ActionIcon action={item.id} />
                  <span>{t(item.label)}</span>
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* Go-to-page dialog */}
      <Show when={gotoOpen()}>
        <div class="mobile-goto-overlay" onClick={() => setGotoOpen(false)}>
          <div class="mobile-goto-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Go to Page</h3>
            <input
              type="text" inputmode="decimal" data-getal
              min="1"
              max={totalPages()}
              value={gotoValue()}
              onInput={(e) => setGotoValue(e.target.value)}
              onKeyDown={handleGotoKeyDown}
              autofocus
            />
            <div class="mobile-goto-buttons">
              <button onClick={() => setGotoOpen(false)}>Cancel</button>
              <button class="primary" onClick={handleGotoSubmit}>Go</button>
            </div>
          </div>
        </div>
      </Show>

      {/* Copy text FAB */}
      <Show when={copyFabVisible() && hasDocument()}>
        <button class="mobile-copy-fab" onClick={handleCopyText}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="1" />
            <path d="M5 15H4a1 1 0 01-1-1V4a1 1 0 011-1h10a1 1 0 011 1v1" />
          </svg>
          Copy
        </button>
      </Show>

      {/* Slide-out drawer */}
      <div class="mobile-drawer-overlay" classList={{ open: drawerOpen() }} onClick={() => setDrawerOpen(false)}>
        <div class="mobile-drawer" classList={{ open: drawerOpen() }} onClick={(e) => e.stopPropagation()}>
          <div class="mobile-drawer-header">
            <span>Open PDF Studio</span>
            <button class="mobile-drawer-close" onClick={() => setDrawerOpen(false)}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div class="mobile-drawer-items">
            <button class="mobile-drawer-item" onClick={handleOpen}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
              </svg>
              <span>{t('open')}</span>
            </button>
            <Show when={hasDocument()}>
              <button class="mobile-drawer-item" onClick={handleSave}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
                  <polyline points="17 21 17 13 7 13 7 21" />
                  <polyline points="7 3 7 8 15 8" />
                </svg>
                <span>{t('save')}</span>
              </button>
              <button class="mobile-drawer-item" onClick={handleSaveAs}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
                  <polyline points="17 21 17 13 7 13 7 21" />
                  <polyline points="7 3 7 8 15 8" />
                </svg>
                <span>{t('saveAs')}</span>
              </button>
              <button class="mobile-drawer-item" id="mobile-share" onClick={handleShare}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="18" cy="5" r="3" />
                  <circle cx="6" cy="12" r="3" />
                  <circle cx="18" cy="19" r="3" />
                  <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" />
                  <line x1="15.4" y1="6.5" x2="8.6" y2="10.5" />
                </svg>
                <span>{t('share.share')}</span>
              </button>
            </Show>
            <button class="mobile-drawer-item" id="mobile-scan" onClick={() => handlePickAction('scanDocument')}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              <span>{t('mobileMore.scanDocument')}</span>
            </button>
            <div class="mobile-drawer-divider"></div>

            {/* Recent files */}
            <Show when={recentFiles().length > 0}>
              <div class="mobile-drawer-section-label">Recent Files</div>
              <For each={recentFiles()}>
                {(recent) => (
                  <button class="mobile-recent-item" onClick={() => handleOpenRecent(recent)}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    <span class="mobile-recent-item-name">{recent.name}</span>
                  </button>
                )}
              </For>
              <button class="mobile-recent-clear" onClick={handleClearRecents}>
                Clear Recent Files
              </button>
              <div class="mobile-drawer-divider"></div>
            </Show>

            <button class="mobile-drawer-item" onClick={() => { setDrawerOpen(false); setPrefsOpen(true); }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
              </svg>
              <span>{t('preferences')}</span>
            </button>
            <button
              class="mobile-drawer-item"
              id="mobile-send-feedback"
              disabled={feedbackUit}
              title={feedbackUit ? meldingTekst(t, t('sendFeedback')) : undefined}
              onClick={handleFeedback}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
              </svg>
              <span>{t('sendFeedback')}</span>
            </button>
            <button class="mobile-drawer-item" onClick={handleAbout}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              <span>{tRibbon('help.about')}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Mobile preferences full-screen page */}
      <Show when={prefsOpen()}>
        <MobilePreferences onClose={() => setPrefsOpen(false)} onThemeChange={(theme) => setDarkMode(theme === 'dark')} />
      </Show>

      {/* Dialogen (feedback, over, meldingen, notities): zonder deze host
          opende openDialog() op mobiel niets (#593). */}
      <DialogHost />
      <LoadingOverlay />
    </div>
  );
}

function ToolIcon(props) {
  const pad = {
    select: <path d="M4 3l7 17 2.5-7.5L21 10z" />,
    highlight: <rect x="3" y="10" width="18" height="6" rx="1" />,
    draw: <><path d="M12 19l7-7 3 3-7 7-3-3z" /><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" /></>,
    textbox: <><rect x="3" y="4" width="18" height="16" /><polyline points="8 9 8 8 16 8 16 9" /><line x1="12" y1="8" x2="12" y2="16" /></>,
    comment: <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />,
  }[props.tool];
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">{pad}</svg>
  );
}

function ActionIcon(props) {
  const pad = {
    share: <><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.6" y1="13.5" x2="15.4" y2="17.5" /><line x1="15.4" y1="6.5" x2="8.6" y2="10.5" /></>,
    insertImage: <><rect x="3" y="3" width="18" height="18" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></>,
    insertLink: <path d="M10 14a4.5 4.5 0 006.36 0l3-3a4.5 4.5 0 00-6.36-6.36l-1.5 1.5M14 10a4.5 4.5 0 00-6.36 0l-3 3a4.5 4.5 0 006.36 6.36l1.5-1.5" stroke-linecap="round" stroke-linejoin="round" />,
    takePhoto: <><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" /><circle cx="12" cy="13" r="4" /></>,
    scanDocument: <><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="2" y1="14" x2="22" y2="14" /></>,
    copyMarkup: <><rect x="9" y="9" width="13" height="13" /><path d="M5 15H4a1 1 0 01-1-1V4a1 1 0 011-1h10a1 1 0 011 1v1" /></>,
    pasteMarkup: <><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" /><rect x="8" y="2" width="8" height="4" /></>,
    deleteMarkup: <><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6M14 11v6M9 6V4h6v2" /></>,
  }[props.action];
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">{pad}</svg>
  );
}

function MobilePreferences(props) {
  const { t } = useTranslation('preferences');
  const { t: tRibbon } = useTranslation('ribbon');

  function update(key, value) {
    state.preferences[key] = value;
    savePreferences();
  }

  function handleThemeChange(value) {
    update('theme', value);
    applyTheme(value);
    const resolved = value === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : value;
    props.onThemeChange?.(resolved);
  }

  function handleLanguageChange(value) {
    update('language', value);
    changeLanguage(value);
  }

  return (
    <div class="mobile-prefs-page">
      <div class="mobile-prefs-header">
        <button class="mobile-topbar-btn" onClick={props.onClose} aria-label="Back">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span class="mobile-prefs-title">Preferences</span>
      </div>

      <div class="mobile-prefs-body">
        <div class="mobile-prefs-section">
          <div class="mobile-prefs-section-title">{t('general.theme')}</div>
          <select value={state.preferences.theme || 'system'} onChange={e => handleThemeChange(e.target.value)}>
            <option value="system">{tRibbon('theme.system')}</option>
            <option value="light">{tRibbon('theme.light')}</option>
            <option value="dark">{tRibbon('theme.dark')}</option>
            <option value="blue">{tRibbon('theme.blue')}</option>
            <option value="highContrast">{tRibbon('theme.highContrast')}</option>
          </select>
        </div>

        <div class="mobile-prefs-section">
          <div class="mobile-prefs-section-title">{t('general.language')}</div>
          <select value={state.preferences.language || 'auto'} onChange={e => handleLanguageChange(e.target.value)}>
            <For each={LANGUAGES}>
              {(lang) => <option value={lang.code}>{lang.code === 'auto' ? 'Auto-detect' : lang.name}</option>}
            </For>
          </select>
        </div>

        <div class="mobile-prefs-section">
          <div class="mobile-prefs-section-title">{t('general.author')}</div>
          <input type="text" value={state.preferences.authorName || ''} onInput={e => update('authorName', e.target.value)} placeholder="Author name" />
        </div>

        <div class="mobile-prefs-section">
          <div class="mobile-prefs-section-title">{t('annotations.generalDefaults')}</div>
          <div class="mobile-prefs-row">
            <label>{t('annotations.defaultAnnotationColor')}</label>
            <input type="color" value={state.preferences.defaultAnnotationColor || '#ff0000'} onInput={e => update('defaultAnnotationColor', e.target.value)} />
          </div>
          <div class="mobile-prefs-row">
            <label>{t('annotations.defaultLineWidth')}</label>
            <input type="text" inputmode="decimal" data-getal min="1" max="20" value={state.preferences.defaultLineWidth || 3} onInput={e => update('defaultLineWidth', parseInt(e.target.value) || 3)} />
          </div>
          <div class="mobile-prefs-row">
            <label>{t('annotations.highlightOpacity')}</label>
            <input type="range" min="10" max="100" value={state.preferences.highlightOpacity || 30} onInput={e => update('highlightOpacity', parseInt(e.target.value))} />
            <span class="mobile-prefs-range-value">{state.preferences.highlightOpacity || 30}%</span>
          </div>
        </div>

        <div class="mobile-prefs-section">
          <div class="mobile-prefs-section-title">{t('behavior.startup')}</div>
          <label class="mobile-prefs-toggle">
            <span>{t('behavior.restoreLastSession')}</span>
            <input type="checkbox" checked={state.preferences.restoreLastSession ?? true} onChange={e => update('restoreLastSession', e.target.checked)} />
          </label>
        </div>

        <div class="mobile-prefs-section">
          <div class="mobile-prefs-section-title">{t('behavior.deletion')}</div>
          <label class="mobile-prefs-toggle">
            <span>{t('behavior.confirmBeforeDeleting')}</span>
            <input type="checkbox" checked={state.preferences.confirmBeforeDelete ?? true} onChange={e => update('confirmBeforeDelete', e.target.checked)} />
          </label>
        </div>
      </div>
    </div>
  );
}
