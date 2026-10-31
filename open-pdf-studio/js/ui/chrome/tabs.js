import { state, createDocument, getActiveDocument, findDocumentByPath, clearSelection } from '../../core/state.js';
import { appVersion } from '../../core/app-version.js';
import { renderPage, renderContinuous, clearPdfView } from '../../pdf/renderer.js';
import { hideFormFieldsBar } from '../../pdf/form-layer.js';
import { redrawAnnotations, redrawContinuous, updateQuickAccessButtons } from '../../annotations/rendering.js';
import { updateAllStatus } from './status-bar.js';
import { generateThumbnails, clearThumbnails, clearThumbnailCache, refreshActiveTab, refreshAllTabs, saveThumbnailScrollPosition } from '../panels/left-panel.js';
import { cancelAnnotationLoading, hidePdfABar } from '../../pdf/loader.js';
import { savePDF } from '../../pdf/saver.js';
import { unlockFile, lockFile, renameFile, fileExists } from '../../core/platform.js';
import { cancelPendingZoom } from '../setup/navigation-events.js';
import { closeAllPopups } from '../../bridge.js';
import { persistReaderPosition, restoreReaderPosition } from '../../pdf/reader-mode-view.js';
import { hasPendingRestore } from '../../core/reader-mode-tracking.js';
import { actiefNaSluiten } from '../../pdf/handtekeningen/opslaan.js';
import { compareActive, compareFocused, focusCompareTab, blurCompareTab } from '../../compare/compare-store.js';
import { volgendTabDoel, voerTabWisselUit } from './tab-sneltoets.js';
import { isBeveiligdDocument } from '../../pdf/wachtwoord-pdf.js';
import { hostVersieLabel } from '../../pdf/host-versies.js';
import i18next from '../../i18n/config.js';
import { meldWijziging, meldGesloten } from '../../herstel/haken.js';
import { meld as meldSplit } from '../../pdf/split-view/split-haken.js';
import { renderQueue } from '../../pdf/render-queue-state.js';

/**
 * Create a new tab for a document
 * @param {string} filePath - Path to the PDF file (null for new untitled document)
 * @param {boolean} autoSwitch - Whether to switch to the new tab (default: true)
 * @returns {{ doc: Object, index: number }} The created document object and its index
 */
export function createTab(filePath = null, autoSwitch = true) {
  // Check if file is already open
  if (filePath) {
    const existingIndex = findDocumentByPath(filePath);
    if (existingIndex !== -1) {
      // File already open, switch to its tab
      if (autoSwitch) {
        switchToTab(existingIndex);
      }
      return { doc: state.documents[existingIndex], index: existingIndex };
    }
  }

  // Create new document
  const doc = createDocument(filePath);
  // Weergavemodus uit de voorkeuren; enkelpagina is de standaard
  // (createDocument zelf blijft een pure helper).
  doc.viewMode = state.preferences?.defaultViewMode === 'continuous' ? 'continuous' : 'single';
  state.documents.push(doc);

  // Switch to the new tab
  const newIndex = state.documents.length - 1;
  if (autoSwitch) {
    switchToTab(newIndex);
  }

  // Update tab bar UI
  updateTabBar();

  return { doc, index: newIndex };
}

/**
 * Switch to a specific tab
 * @param {number} index - Index of the tab to switch to
 * @returns {Promise<void>|undefined} de eerste render van het nieuwe tabblad
 *   (undefined zonder PDF); de tabwissel-sneltoets wacht hierop (#539)
 */
export function switchToTab(index) {
  if (index < 0 || index >= state.documents.length) return;
  let eersteRender;

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

  // Save thumbnail panel scroll position
  saveThumbnailScrollPosition();

  // Cancel any pending zoom render from the previous document
  cancelPendingZoom();

  // Clear any selected annotation (panel stays open per user preference)
  const curDoc = getActiveDocument();
  if (curDoc) {
    curDoc.selectedAnnotation = null;
    curDoc.selectedAnnotations = [];
  }
  import('../../solid/stores/propertiesStore.js').then(m => m.storeHideProperties());

  // Switch active document
  state.activeDocumentIndex = index;
  // Renders of the previous document that have not started yet are dropped,
  // so this document's page does not wait behind them (#506).
  renderQueue.activeDocumentChanged();

  // Update tab bar UI
  updateTabBar();

  // Gesplitste weergave (#715): lay-out van het aankomende document (wel of
  // niet gesplitst) vóór het renderen, zodat de viewer meteen de juiste maat
  // heeft.
  meldSplit('actiefDocument', getActiveDocument());

  // Hide form fields bar and PDF/A bar before rendering (will be re-shown if new doc has them)
  hideFormFieldsBar();
  hidePdfABar();
  import('../../pdf/handtekeningen/verificatie.js').then(m => m.toonBalkVoorActiefDocument());

  // CRITICAL: deactivate the vector viewport singleton BEFORE the new doc's
  // renderPage() runs. Multiple PDFs share #pdf-canvas; the viewport's RAF
  // loop holds the LAST rendered doc's filePath/pageNum and would keep drawing
  // that page on every dirty tick (resize, panel toggle) until the new doc's
  // setPage() call lands. That's the cross-document ghost the user reports
  // when switching tabs rapidly. The vector path will reactivate it via
  // setPage() once the new doc's commands are ready; raster docs leave it off.
  if (window.__pdfViewport) window.__pdfViewport.active = false;

  // Clear the shared single-page canvases immediately so the previous doc's
  // pixels are not visible during the (potentially multi-hundred-ms) async
  // chain that loads the new doc's page. Without this, switching from a
  // large vector PDF to another shows the previous PDF until the new one
  // finishes its IPC + decode pipeline.
  const _spc = document.getElementById('pdf-canvas');
  if (_spc) {
    const _spx = _spc.getContext('2d');
    if (_spx) _spx.clearRect(0, 0, _spc.width, _spc.height);
  }
  const _ann = document.getElementById('annotation-canvas');
  if (_ann) {
    const _anx = _ann.getContext('2d');
    if (_anx) _anx.clearRect(0, 0, _ann.width, _ann.height);
  }
  // Also clear stale text-layer DOM (text-layer is per-page, contains spans
  // from the previous doc that would be visible until the new page's text
  // layer overwrites them).
  const _tl = document.querySelector('.textLayer');
  if (_tl) _tl.remove();

  // Render the new active document
  const newDoc = getActiveDocument();
  const placeholder = document.getElementById('placeholder');
  const pdfContainer = document.getElementById('pdf-container');

  if (newDoc && newDoc.pdfDoc) {
    // Show PDF container, hide placeholder
    if (placeholder) placeholder.style.display = 'none';
    if (pdfContainer) pdfContainer.classList.add('visible');

    // Clamp currentPage to valid range (could drift if document was modified)
    if (newDoc.currentPage < 1 || newDoc.currentPage > newDoc.pdfDoc.numPages) {
      newDoc.currentPage = 1;
    }

    // Enkelpagina: renderPage hergebruikt wat er van dit document al klaarstaat
    // — de viewport zet zoom en verschuiving terug zoals het document werd
    // verlaten en tekent direct de gecachte paginabitmap (pdf-viewport.js
    // setPage, weergave-per-document.js), in plaats van opnieuw passend te
    // maken en te renderen (#539).
    const firstRender = newDoc.viewMode === 'continuous'
      ? renderContinuous()
      : renderPage(newDoc.currentPage);
    eersteRender = firstRender;

    // Reader Mode: a tracked document that finished loading while another
    // tab was in front (multi-file open, session restore, a tab switch
    // during the load) has not shown its stored position yet. Do that on
    // this first activation, once the page is up — same order as the loader.
    const readerRestorePending = hasPendingRestore(newDoc);
    if (readerRestorePending) {
      Promise.resolve(firstRender)
        .then(() => restoreReaderPosition(newDoc))
        .catch((e) => console.warn('[reader-mode] restore failed:', e));
    }

    // Restore scroll position (not for a document that still has to jump to
    // its stored reading position: it has no scroll of its own yet, and this
    // could undo the jump). Zodra de pagina's van het document staan en niet
    // na een vaste 50 ms: in de doorlopende weergave was dan eerst de
    // bovenkant van het document te zien (en renderden daar pagina's voor
    // niets) voordat het beeld naar de bewaarde plek sprong, en een trage
    // opbouw kreeg een te vroege, afgekapte scrollpositie (#539).
    if (pdfContainer && newDoc.scrollPosition && !readerRestorePending) {
      const { x, y } = newDoc.scrollPosition;
      Promise.resolve(firstRender)
        .catch((e) => console.warn('[tabs] render na tabwissel mislukt:', e))
        .then(() => {
          if (getActiveDocument() !== newDoc) return;
          pdfContainer.scrollLeft = x;
          pdfContainer.scrollTop = y;
        });
    }

    // Regenerate thumbnails for the new document
    generateThumbnails();

    // Refresh active left panel tab content
    refreshActiveTab();
  } else {
    // No PDF loaded for this document yet — show placeholder
    if (placeholder) placeholder.style.display = '';
    if (pdfContainer) pdfContainer.classList.remove('visible');
    clearPdfView();
    clearThumbnails();
  }

  // Update UI elements
  updateAllStatus();
  updateQuickAccessButtons();
  updateWindowTitle();

  // Persist the new active-tab index (debounced) for session restore.
  window.__OPDS_SESSION_SAVE__?.();

  // Update PDF/A read-only tool state and bar for the new document
  import('../../tools/manager.js').then(m => m.updatePdfAToolState());
  if (newDoc && newDoc.pdfaCompliance) {
    import('../../pdf/loader.js').then(({ isPdfAReadOnly }) => {
      if (isPdfAReadOnly()) {
        const label = `PDF/A-${newDoc.pdfaCompliance.part}${newDoc.pdfaCompliance.conformance ? newDoc.pdfaCompliance.conformance.toLowerCase() : ''}`;
        const text = `This document complies with the ${label} standard and has been opened read-only to prevent modification.`;
        import('../../solid/stores/pdfaBarStore.js').then(m => m.showPdfABar(text));
      }
    });
  }

  return eersteRender;
}

/**
 * Tabwissel met de sneltoets (#539): Ctrl+Tab / Ctrl+PageDown naar het
 * volgende, Ctrl+Shift+Tab / Ctrl+PageUp naar het vorige tabblad, met omloop
 * en in de volgorde van de tabbalk (het vergelijkingstabblad achteraan).
 * Met één tabblad gebeurt er niets.
 * @param {number} richting  1 = volgende, -1 = vorige
 * @returns {Promise<void>|undefined} de eerste render van het nieuwe tabblad
 */
export function wisselTabMetSneltoets(richting) {
  const doel = volgendTabDoel({
    aantalDocumenten: state.documents.length,
    actieveIndex: state.activeDocumentIndex,
    vergelijkActief: compareActive(),
    vergelijkGefocust: compareFocused(),
  }, richting);
  return voerTabWisselUit(doel, { switchToTab, focusCompareTab, blurCompareTab });
}

/**
 * Close a tab
 * @param {number} index - Index of the tab to close
 * @param {boolean} force - Force close without checking for unsaved changes
 * @returns {boolean} True if tab was closed, false if cancelled
 */
export async function closeTab(index, force = false, dialogAction = null) {
  if (index < 0 || index >= state.documents.length) return false;

  const doc = state.documents[index];

  // Check for unsaved changes - show Save / Don't Save / Cancel dialog.
  // `dialogAction` ('save'|'dontsave') slaat de native dialoog over — voor de
  // MCP-brug en tests, die geen OS-dialoog kunnen bedienen maar wél de echte
  // sluitvolgorde (opslaan → opruimen → sluiten) moeten doorlopen.
  let vorigActief = null;
  // Een met een wachtwoord geopende PDF is alleen-lezen en kan niet
  // opgeslagen worden: niets te vragen.
  if (!force && doc.modified && !isBeveiligdDocument(doc)) {
    const action = dialogAction || await showUnsavedChangesDialog(doc.fileName);
    if (action === 'cancel') return false;
    if (action === 'save') {
      // Opslaan (en de vraag over handtekeningen) werkt op het actieve
      // document. Sluiten vanaf een achtergrondtabblad wisselt daarom eerst
      // naar dat tabblad; na het sluiten komt het vorige tabblad terug.
      if (index !== state.activeDocumentIndex) {
        vorigActief = state.documents[state.activeDocumentIndex] || null;
        switchToTab(index);
      }
      // Met `dialogAction` (MCP-brug, tests) kan niemand een vraag over
      // handtekeningen beantwoorden; die keuze is dan al gemaakt.
      const saved = await savePDF(null, { zonderHandtekeningVraag: !!dialogAction }, doc);
      if (!saved) {
        // Save failed or was cancelled: terug naar het tabblad van de gebruiker.
        if (vorigActief) {
          const terug = state.documents.indexOf(vorigActief);
          if (terug !== -1) switchToTab(terug);
        }
        return false;
      }
    }
    // action === 'dontsave' → proceed to close without saving
  }

  // Reader Mode: remember where we were in this file, before anything below
  // tears down its rendered state. Only for a document whose tracking is on;
  // skipped for untitled/blank docs — there's no file path to key the memory
  // on, and nothing meaningful to resume. Which file, which zoom/scroll and
  // when not to write: see reader-mode-view.js / reader-mode-tracking.js.
  persistReaderPosition(doc);

  // Cancel any in-progress background annotation loading for this document.
  // PAS NA de opslaan-dialoog: cancelAnnotationLoading wist de
  // gereedheids-sets maar laat doc.annotations staan, en de saver behandelt
  // een "niet gereed"-pagina als niet-geladen (bestand = waarheid): hij
  // behoudt dan alle bestaande annotaties in het bestand EN schrijft het
  // model er nog eens bij — elke opslag-bij-sluiten verdubbelde zo alle
  // annotaties.
  cancelAnnotationLoading(doc);

  // Close all open sticky note popups
  closeAllPopups();

  // Clear selection and hide contextual ribbon tabs
  clearSelection();
  import('../../solid/stores/ribbonStore.js').then(m => m.setContextualTabsVisible(false));

  // Release file lock so other apps can write to it again
  if (doc.filePath) {
    await unlockFile(doc.filePath);
  }
  // Na een save met text-edits rendert het document uit een tijdelijke
  // werkkopie (reloadFromBytes) terwijl de lock op het ECHTE bestand staat
  // (saveTargetPath). Die lock ook loslaten, en de werkkopie opruimen —
  // anders blijft het bestand vergrendeld tot de app afsluit. (#345)
  if (doc.saveTargetPath && doc.saveTargetPath !== doc.filePath) {
    await unlockFile(doc.saveTargetPath);
  }
  // Met een wachtwoord geopend: de lock staat op het origineel, het document
  // rendert uit een ontsleutelde werkkopie (die gaat hieronder weg).
  if (doc.originalFilePath && doc.originalFilePath !== doc.filePath) {
    await unlockFile(doc.originalFilePath);
  }
  if (doc._renderTemp && doc.filePath && !doc.isUntitled) {
    try {
      if (window.__TAURI__?.fs?.remove) await window.__TAURI__.fs.remove(doc.filePath);
    } catch (e) { console.warn('[tabs] werkkopie opruimen mislukt:', e); }
  }

  // Delete the temp backing file of an untitled (never-saved) blank doc.
  if (doc.isUntitled && doc.filePath) {
    try {
      if (window.__TAURI__?.fs?.remove) await window.__TAURI__.fs.remove(doc.filePath);
    } catch (e) { console.warn('[blank-pdf] temp cleanup on close failed:', e); }
  }

  // Clear thumbnail cache for this document
  clearThumbnailCache(doc.id);

  // Remove the document
  state.documents.splice(index, 1);
  // Gesloten (opgeslagen of bewust niet): de herstelmomentopname kan weg.
  meldGesloten(doc);
  // Gesplitste weergave (#715): sluiten sluit beide panelen.
  meldSplit('documentGesloten', doc);

  // Geef vrij wat dit document in het geheugen vasthield: de PDF.js-instantie,
  // de ruwe bestandsbytes, vector-commandobuffers, bitmaps en de documentcaches
  // aan de Rust-kant — alleen als geen ander tabblad hetzelfde bestand nog
  // gebruikt (document-release.js). Zonder dit bleef na het sluiten van zware
  // tekeningen gigabytes aan heap staan tot de app afsloot.
  // Het vrijgeven start hier en wordt aan het eind van het sluiten afgewacht:
  // het ruimt ook de tijdelijke werkbestanden van het document op, en wie het
  // laatste tabblad sluit en meteen afsluit, liet die anders staan (#400).
  const vrijgave = import('../../pdf/document-release.js')
    .then(({ geefDocumentVrij }) => geefDocumentVrij(doc, state.documents, {
      klembord: [state.clipboardAnnotation, state.clipboardAnnotations],
    }))
    .catch((e) => console.warn('[tabs] vrijgeven van document mislukt:', e));

  // Een gesloten document gebruikt zijn knipsel-bronnen niet meer; wat nergens
  // anders nodig is, gaat uit het geheugen. Bewust HIER en niet na opslaan: de
  // undo-geschiedenis houdt verwijderde knipsels vast, en een Ctrl+Z na het
  // opruimen zou een knipsel zonder bronbytes terugzetten. Bij sluiten gaat die
  // geschiedenis mee weg.
  import('../../annotations/vector-snippet-clipboard.js')
    .then(({ ruimKnipselBronnenOp }) => ruimKnipselBronnenOp(state.documents))
    .catch(() => {});

  // Adjust active index
  if (state.documents.length === 0) {
    state.activeDocumentIndex = -1;
    clearPdfView();
    import('../../pdf/pdf-viewport.js').then(m => m.vergeetGetoondDocument()).catch(() => {});
    clearThumbnails();
    refreshAllTabs();
    updateWindowTitle();
    import('../../search/find-bar.js').then(m => m.closeFindBar());
    import('../../pdf/handtekeningen/verificatie.js').then(m => m.toonBalkVoorActiefDocument());
  } else if (vorigActief) {
    state.activeDocumentIndex = actiefNaSluiten(state.documents, index, vorigActief);
    switchToTab(state.activeDocumentIndex);
  } else if (index <= state.activeDocumentIndex) {
    // If closing current or earlier tab, adjust index
    state.activeDocumentIndex = Math.max(0, state.activeDocumentIndex - 1);
    switchToTab(state.activeDocumentIndex);
  }

  // Update tab bar UI
  updateTabBar();
  updateQuickAccessButtons();

  // Keep the persisted session in sync (debounced) — survives dev reloads.
  window.__OPDS_SESSION_SAVE__?.();

  // De interface is bijgewerkt; nu pas wachten tot alles is vrijgegeven.
  await vrijgave;

  // De ontsleutelde werkkopie van een beveiligde PDF weg, nu de caches en de
  // worker-processen hem hebben losgelaten. Rust verwijdert alleen bestanden
  // in zijn eigen map; wat nog in gebruik is, ruimt het afsluiten of de
  // volgende start op.
  if (isBeveiligdDocument(doc) && doc.filePath && doc.filePath !== doc.originalFilePath
      && !state.documents.some((d) => d.filePath === doc.filePath)) {
    try {
      await window.__TAURI__?.core?.invoke?.('release_protected_pdf', { path: doc.filePath });
    } catch (e) { console.warn('[tabs] werkkopie van beveiligde PDF niet verwijderd:', e); }
  }

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
 * Rename a document's file on disk and update state.
 * @param {number} index - Document index
 * @param {string} newName - New filename (without .pdf extension)
 * @returns {Promise<boolean>} True if renamed successfully
 */
export async function renameDocument(index, newName) {
  if (index < 0 || index >= state.documents.length) return false;

  const doc = state.documents[index];

  // Met een wachtwoord geopend: alleen-lezen, ook de bestandsnaam. (Het pad
  // zou bovendien de werkkopie zijn, niet het origineel.)
  if (isBeveiligdDocument(doc)) {
    const { showMessage } = await import('../../solid/stores/dialogStore.js');
    const i18next = (await import('../../i18n/config.js')).default;
    showMessage(i18next.t('protectedPdfReadOnly'));
    return false;
  }

  // Untitled docs — trigger Save As instead
  if (!doc.filePath) {
    const { savePDFAs } = await import('../../pdf/saver.js');
    return await savePDFAs(doc);
  }

  // Validate: no invalid characters
  const invalidChars = /[\\/:*?"<>|]/;
  if (invalidChars.test(newName)) {
    const { showMessage } = await import('../../solid/stores/dialogStore.js');
    const i18next = (await import('../../i18n/config.js')).default;
    showMessage(i18next.t('statusbar:renameInvalidChars', { defaultValue: 'File name cannot contain \\ / : * ? " < > |' }));
    return false;
  }

  // Validate: not empty
  const trimmed = newName.trim();
  if (!trimmed) return false;

  // Auto-append .pdf if missing
  const finalName = trimmed.toLowerCase().endsWith('.pdf') ? trimmed : trimmed + '.pdf';

  // Build new path
  const oldPath = doc.filePath;
  const dir = oldPath.replace(/[\\/][^\\/]+$/, '');
  const sep = oldPath.includes('\\') ? '\\' : '/';
  const newPath = dir + sep + finalName;

  // Same name — no-op
  if (newPath === oldPath) return true;

  // Check if target already exists
  const exists = await fileExists(newPath);
  if (exists) {
    const { showMessage } = await import('../../solid/stores/dialogStore.js');
    const i18next = (await import('../../i18n/config.js')).default;
    showMessage(i18next.t('statusbar:renameFileExists', { defaultValue: 'A file with this name already exists.' }));
    return false;
  }

  try {
    // Unlock old file, rename, lock new file
    await unlockFile(oldPath);
    await renameFile(oldPath, newPath);
    await lockFile(newPath);

    // Update PDF byte cache
    const { getCachedPdfBytes, setCachedPdfBytes, clearCachedPdfBytes } = await import('../../pdf/loader.js');
    const cached = getCachedPdfBytes(oldPath);
    if (cached) {
      setCachedPdfBytes(newPath, cached);
      clearCachedPdfBytes(oldPath);
    }

    // Update document state
    const doc = getActiveDocument();
    if (doc) {
      const { verhuisOpenDocument } = await import('../../pdf/pad-verhuizen.js');
      await verhuisOpenDocument(doc, oldPath, newPath);
    }
    updateWindowTitle();
    return true;
  } catch (err) {
    // Re-lock old path on failure
    await lockFile(oldPath);
    const { showMessage } = await import('../../solid/stores/dialogStore.js');
    const i18next = (await import('../../i18n/config.js')).default;
    showMessage(i18next.t('statusbar:renameError', { defaultValue: 'Failed to rename file: {{error}}', error: err?.message || String(err) }));
    return false;
  }
}

/**
 * Update the tab bar UI to reflect current documents
 */
export function updateTabBar() {
  // No-op: DocumentTabs.jsx now reads directly from reactive state
}

/**
 * Update window title based on active document
 */
export function updateWindowTitle() {
  const doc = getActiveDocument();
  const baseTitle = `Open PDF Studio v${appVersion()}`;

  // Update document.title (browser/OS window title)
  if (doc) {
    const modified = doc.modified ? '*' : '';
    // Een oudere versie van de site (#712): "Versie 3 van 5 – alleen-lezen".
    const versie = hostVersieLabel(doc, (s, o) => i18next.t(s, o));
    document.title = `${modified}${doc.fileName}${versie ? ` (${versie})` : ''} - ${baseTitle}`;
  } else {
    document.title = baseTitle;
  }

  // Tab bar and title bar derive from reactive state automatically
}

/**
 * Mark the active document as modified
 */
export function markDocumentModified(doc = getActiveDocument()) {
  if (doc) {
    doc.modified = true;
    // Direct modification bypasses undo stack, so clean point is unreachable
    doc.savedUndoStackLength = -1;
    meldWijziging(doc);
    updateTabBar();
    updateWindowTitle();
  }
}

/**
 * Mark the active document as saved (not modified)
 */
export function markDocumentSaved(doc = getActiveDocument()) {
  if (doc) {
    doc.modified = false;
    doc.savedUndoStackLength = (doc.undoStack || []).length;
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
