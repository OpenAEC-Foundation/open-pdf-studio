import { For, Show, createSignal, onCleanup } from 'solid-js';
import { state } from '../../core/state.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import i18next from '../../i18n/config.js';
import { invoke } from '../../core/platform.js';
import { laadDesktopDragPlugin } from '../../core/desktop-drag-plugin.js';
import { hostVersieLabel } from '../../pdf/host-versies.js';
import {
  revealInFileManager,
  revealInFileManagerLabelKey,
  canRevealInFileManager,
} from '../../core/file-manager-reveal.js';
import {
  compareActive,
  compareFocused,
  focusCompareTab,
  blurCompareTab,
  exitCompare,
  compareOldPath,
  compareNewPath,
} from '../../compare/compare-store.js';

import {
  buitenTabbalk,
  buitenVenster,
  besluitBijLoslaten,
  moetOsSleepStarten,
  besluitNaOsSleep,
  padVoorNieuweInstantie,
  losmaakBlokkade,
} from '../../ui/chrome/tab-losmaken.js';

// Cached current-window label (set once on first mount). All windows ask
// Rust for their own label so cross-window dock IPC can identify the source.
let _currentWindowLabel = null;
async function getCurrentWindowLabel() {
  if (_currentWindowLabel !== null) return _currentWindowLabel;
  try {
    _currentWindowLabel = await invoke('current_window_label');
  } catch {
    _currentWindowLabel = 'main';
  }
  return _currentWindowLabel;
}

// Right-click context menu (Chrome-style "Open in new window" etc.)
const [ctxMenu, setCtxMenu] = createSignal(null);

// Tear a tab off into a SECOND app instance (its own process and window).
//
// Order matters: the tab is closed HERE first — that asks to save a modified
// document (Save / Don't Save / Cancel) and releases the file lock and any
// temporary working copy — and only then does the new instance open the file
// from disk, so it always sees what the user chose to keep. If starting the
// new instance fails, the document is reopened here.
async function detachTabToNewWindow(index) {
  const doc = state.documents[index];
  const blokkade = losmaakBlokkade(doc);
  if (blokkade === 'geen-document') return;
  // Untitled docs are backed by a TEMP file that this window owns and deletes
  // on close — handing it to another process would leave a dangling reference.
  if (blokkade === 'eerst-opslaan') {
    alert(i18next.t('tabs.saveBeforeDetach'));
    return;
  }
  const { closeTab } = await import('../../ui/chrome/tabs.js');
  const closed = await closeTab(index);
  if (!closed) return; // user cancelled the save question
  // Read the path AFTER closing: saving may have moved the document from a
  // working copy to its real file.
  const pdfPath = padVoorNieuweInstantie(doc);
  if (!pdfPath) return;
  try {
    await invoke('spawn_window_with_pdf', { pdfPath });
  } catch (e) {
    console.error('[detach] starting a new instance failed:', e);
    try {
      const [{ createTab }, { loadPDFIfNeeded }] = await Promise.all([
        import('../../ui/chrome/tabs.js'),
        import('../../pdf/loader.js'),
      ]);
      const { index: nieuw } = createTab(pdfPath);
      await loadPDFIfNeeded(pdfPath, nieuw);
    } catch (err) {
      console.warn('[detach] reopening here failed:', err);
    }
    alert(i18next.t('tabs.detachFailed', { error: e?.message || e }));
  }
}

// Close a tab in the current window. If this empties out a NON-main window
// (i.e. a previously detached one) destroy the window too — the detached
// window has no reason to keep hanging around as an empty shell.
async function closeTabAndMaybeCloseWindow(index) {
  const { closeTab } = await import('../../ui/chrome/tabs.js');
  closeTab(index);
  const label = await getCurrentWindowLabel();
  if (label && label !== 'main' && state.documents.length === 0) {
    try {
      await invoke('close_window_by_label', { label });
    } catch (e) {
      console.warn('close_window_by_label failed:', e);
    }
  }
}

const [editingIndex, setEditingIndex] = createSignal(-1);
const [dropTargetIndex, setDropTargetIndex] = createSignal(-1);
const [draggingIndex, setDraggingIndex] = createSignal(-1);

// Mouse-based drag state (module-level so handlers can access it)
let dragState = null;

function handleTabClick(index) {
  if (editingIndex() === index) return;
  blurCompareTab(); // switching to a PDF tab leaves the compare view
  import('../../ui/chrome/tabs.js').then(m => m.switchToTab(index));
}

function handleCloseTab(e, index) {
  e.stopPropagation();
  import('../../ui/chrome/tabs.js').then(m => m.closeTab(index));
}

function handleMiddleClick(e, index) {
  if (e.button === 1) {
    e.preventDefault();
    import('../../ui/chrome/tabs.js').then(m => m.closeTab(index));
  }
}

function handleAddClick() {
  import('../../pdf/loader.js').then(m => m.openPDFFile());
}

function handleDoubleClick(e, index) {
  e.stopPropagation();
  const doc = state.documents[index];
  if (!doc) return;

  if (!doc.filePath) {
    import('../../ui/chrome/tabs.js').then(m => m.renameDocument(index, ''));
    return;
  }

  setEditingIndex(index);
}

function handleRenameKeyDown(e, index) {
  if (e.key === 'Enter') {
    e.preventDefault();
    commitRename(e.target, index);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    cancelRename();
  }
}

function commitRename(input, index) {
  const newName = input.value.trim();
  setEditingIndex(-1);
  if (!newName) return;
  import('../../ui/chrome/tabs.js').then(m => m.renameDocument(index, newName));
}

function cancelRename() {
  setEditingIndex(-1);
}

function handleInputMount(el, doc) {
  const name = doc.fileName || '';
  el.value = name.replace(/\.pdf$/i, '');
  requestAnimationFrame(() => {
    el.focus();
    el.select();
  });
}

// --- Mouse-based tab reordering ---

const DRAG_THRESHOLD = 5; // pixels before drag starts

function handleMouseDown(e, index) {
  // Only left button, not on close button or rename input
  if (e.button !== 0) return;
  if (e.target.closest('.document-tab-close') || e.target.closest('.document-tab-rename-input')) return;
  if (editingIndex() === index) return;

  dragState = {
    fromIndex: index,
    startX: e.clientX,
    startY: e.clientY,
    started: false,
  };

  // Alvast laden zodat er straks geen asynchroon gat zit tussen "cursor
  // verlaat de tabbalk" en het daadwerkelijk starten van de OS-drag — zie
  // preloadDragDeps().
  preloadDragDeps();

  document.addEventListener('mousemove', onDocMouseMove);
  document.addEventListener('mouseup', onDocMouseUp);
}

function onDocMouseMove(e) {
  if (!dragState) return;

  if (!dragState.started) {
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
    dragState.started = true;
    setDraggingIndex(dragState.fromIndex);
    document.body.style.userSelect = 'none';
  }

  const tabsContainer = document.getElementById('document-tabs');
  if (!tabsContainer) return;

  // Tear-off gesture: once the cursor is far enough above or below the tab
  // bar, releasing the button opens the tab in a second app instance. This
  // stays an ordinary in-WebView drag: while the button is held, the WebView
  // keeps delivering mouse events outside the window, so no OS drag loop is
  // needed for it.
  const tabBarRect = tabsContainer.getBoundingClientRect();
  dragState.losGewapend = buitenTabbalk(e.clientY, tabBarRect);

  // Find which tab the mouse is over (reorder)
  let targetIndex = -1;
  if (!dragState.losGewapend) {
    const tabElements = tabsContainer.querySelectorAll('.document-tab');
    for (let i = 0; i < tabElements.length; i++) {
      const rect = tabElements[i].getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX < rect.right) {
        targetIndex = i;
        break;
      }
    }
  }
  setDropTargetIndex(targetIndex !== -1 && targetIndex !== dragState.fromIndex ? targetIndex : -1);

  // Re-dock: only while the cursor hangs over ANOTHER instance of this app do
  // we hand off to a native OS file drag, so that instance can take the tab
  // (its onDragDropEvent opens it). Asked at most every 120 ms.
  const buiten = buitenVenster(e.clientX, e.clientY, window.innerWidth, window.innerHeight);
  if (dragState.losGewapend && buiten && !dragState.doelVraag) {
    const nu = Date.now();
    if (!dragState.laatsteDoelVraag || nu - dragState.laatsteDoelVraag > 120) {
      dragState.laatsteDoelVraag = nu;
      const vraag = dragState;
      vraag.doelVraag = dropTargetKind().then((doelSoort) => {
        vraag.doelVraag = null;
        // The gesture may have ended (or moved back) while we were asking.
        if (dragState !== vraag || vraag.nativeDragStarted) return;
        if (!moetOsSleepStarten({ losGewapend: vraag.losGewapend, buitenVenster: true, doelSoort })) return;
        vraag.nativeDragStarted = true;
        const from = vraag.fromIndex;
        endMouseDrag();
        startNativeTabDrag(from);
      });
    }
  }
}

// Stop the in-WebView drag tracking and clear its visual state.
function endMouseDrag() {
  document.removeEventListener('mousemove', onDocMouseMove);
  document.removeEventListener('mouseup', onDocMouseUp);
  document.body.style.userSelect = '';
  dragState = null;
  setDraggingIndex(-1);
  setDropTargetIndex(-1);
}

// What lies under the mouse cursor right now: 'zelf' | 'instantie' | 'geen'.
async function dropTargetKind() {
  try {
    const r = await invoke('tab_drop_target');
    return r?.kind || 'geen';
  } catch {
    return 'geen';
  }
}

// Voorladen van alles wat `startNativeTabDrag` nodig heeft.
//
// WAAROM (issue #335): de OS-drag moet starten TERWIJL de muisknop nog
// ingedrukt is. Werd `startDrag` pas aangeroepen na een dynamische import en
// een `invoke`, dan zat daar een asynchroon gat van tientallen ms tot (in dev,
// bij een koude module-load) veel langer. Liet de gebruiker in dat gat de knop
// los, dan startte `DoDragDrop` zonder ingedrukte knop en liep zijn modale lus
// nooit af — de complete event-loop van de app stond dan permanent stil.
// Daarom laden we module en drag-icoon één keer voor, zodra de gebruiker een
// tab aanraakt (handleMouseDown) — ruim voordat ze nodig zijn.
let _dragModulePromise = null;
let _dragIconPromise = null;
function preloadDragDeps() {
  if (!_dragModulePromise) {
    // Tab naar buiten slepen kan alleen op het bureaublad. In elke webbouw
    // zet Vite hier een lege vervanger neer, zodat de plugin niet in de
    // webbundel komt (#692, #776; scripts/web-bouw.mjs).
    _dragModulePromise = laadDesktopDragPlugin();
  }
  if (!_dragIconPromise) {
    _dragIconPromise = invoke('drag_icon_path').catch(() => '');
  }
}

// Synchrone spiegel van de primaire-muisknopstatus. De Rust-preflight kost een
// IPC-rondgang; deze check kost niets en dekt het laatste stukje van het gat
// tussen "preflight zegt ok" en "startDrag is aangeroepen".
let _primaryDown = false;
if (typeof document !== 'undefined') {
  const down = (e) => { if (e.button === 0 || e.buttons & 1) _primaryDown = true; };
  const up = () => { _primaryDown = false; };
  document.addEventListener('pointerdown', down, true);
  document.addEventListener('mousedown', down, true);
  document.addEventListener('pointerup', up, true);
  document.addEventListener('mouseup', up, true);
  document.addEventListener('pointercancel', up, true);
  window.addEventListener('blur', up, true);
}

// Nette melding wanneer de tab-overdracht niet veilig gestart kan worden.
// Liever een uitleg dan een bevroren of verdwenen venster.
function explainDragUnavailable(reason) {
  const key = reason === 'missing-file' ? 'tabs.dragFileGone' : 'tabs.dragNotStarted';
  const msg = i18next.t(key, { defaultValue: reason === 'missing-file'
    ? 'Dit bestand bestaat niet meer op schijf — de tab kan niet verplaatst worden.'
    : 'De tab kon niet naar een ander venster gesleept worden. Probeer het opnieuw, of gebruik rechtsklik → openen in nieuw venster.' });
  alert(msg);
}

// Native OS file drag of a tab's PDF, ONLY started while the cursor is over
// another instance of this app (re-dock). Where it lands decides the rest:
//   * on another instance → that instance opens it as a tab; we close ours;
//   * back on ourselves    → nothing changes;
//   * anywhere else        → the tab is torn off into a new instance.
// The OS result alone is not enough: on Windows it reports "Dropped" even when
// the window under the cursor accepted nothing (and "Cancel", not
// "Cancelled", for Escape), so we look at what is under the cursor once the
// drag is over.
async function startNativeTabDrag(index) {
  const doc = state.documents[index];
  if (!doc) return;
  const pdfPath = padVoorNieuweInstantie(doc);
  if (!pdfPath || losmaakBlokkade(doc)) {
    alert(i18next.t('tabs.saveBeforeDetach'));
    return;
  }

  preloadDragDeps();
  const mod = await _dragModulePromise;
  const icon = await _dragIconPromise;
  if (!mod?.startDrag) {
    // Geen drag-backend beschikbaar → losmaken naar een nieuwe instantie.
    detachTabToNewWindow(index);
    return;
  }

  // Laatste controle vlak vóór we de OS-drag starten: bestaat het bestand nog
  // en houdt de gebruiker de muisknop nog vast? Zonder ingedrukte knop hangt
  // `DoDragDrop` de hele app op; zonder bestaand bestand paniekt de OS-laag en
  // wordt het proces hard afgebroken. Zie window_mgmt::tab_drag_preflight.
  let pre = { ok: false, reason: 'preflight-failed' };
  try {
    pre = await invoke('tab_drag_preflight', { pdfPath });
  } catch (e) {
    console.warn('[tab-drag] preflight faalde:', e);
  }
  if (!pre?.ok) {
    if (pre?.reason === 'button-released') {
      // Knop al losgelaten: niet meer over te dragen, dus losmaken naar een
      // nieuwe instantie.
      detachTabToNewWindow(index);
    } else {
      explainDragUnavailable(pre?.reason);
    }
    return;
  }

  // Allerlaatste synchrone check: knop in de tussentijd toch losgelaten?
  if (!_primaryDown) {
    detachTabToNewWindow(index);
    return;
  }

  // Mark THIS instance as the drag source so our own drop handler ignores a
  // drop that lands back on us (no duplicate tab).
  window.__OPDS_DRAGGING_OUT__ = pdfPath;
  window.__OPDS_SELF_DROP__ = false;
  // De callback mag maar één keer werk doen: de OS-laag kan hem in theorie
  // vaker afvuren, en dubbel sluiten zou een al gesloten tab-index raken.
  let settled = false;
  try {
    await mod.startDrag({ item: [pdfPath], icon }, (payload) => {
      // DEFENSIEF: deze callback loopt vanuit Rust terwijl de OS-drag nog
      // wordt afgerond. Alles in een try/catch, en het echte werk pas ná een
      // korte pauze, zodat de OS-drag eerst netjes afloopt en de eigen
      // drop-afhandeling een terugzetten op dit venster kan melden.
      try {
        if (settled) return;
        settled = true;
        const resultaat = payload?.result;
        setTimeout(async () => {
          try {
            const zelfDrop = !!window.__OPDS_SELF_DROP__;
            window.__OPDS_DRAGGING_OUT__ = null;
            window.__OPDS_SELF_DROP__ = false;
            const doelSoort = await dropTargetKind();
            const besluit = besluitNaOsSleep({ resultaat, doelSoort, zelfDrop });
            // The index may have shifted meanwhile; find the document again.
            const nu = state.documents.indexOf(doc);
            if (nu === -1) return;
            if (besluit === 'sluiten') {
              closeTabAndMaybeCloseWindow(nu);
            } else if (besluit === 'losmaken') {
              detachTabToNewWindow(nu);
            }
          } catch (err) {
            console.error('[tab-drag] afhandeling na drop faalde:', err);
          }
        }, 50);
      } catch (err) {
        console.error('[tab-drag] drop-callback faalde:', err);
      }
    });
  } catch (e) {
    window.__OPDS_DRAGGING_OUT__ = null;
    window.__OPDS_SELF_DROP__ = false;
    console.warn('native tab drag failed, tearing off instead:', e);
    if (!settled) {
      settled = true;
      detachTabToNewWindow(index);
    }
  }
}

// Hide the context menu when clicking anywhere else / pressing Escape.
function hideCtxMenu() { setCtxMenu(null); }

function handleTabContextMenu(e, index) {
  e.preventDefault();
  e.stopPropagation();
  setCtxMenu({ x: e.clientX, y: e.clientY, index });
}

function onDocMouseUp() {
  if (!dragState) {
    endMouseDrag();
    return;
  }

  const from = dragState.fromIndex;
  const wasStarted = dragState.started;
  const losGewapend = !!dragState.losGewapend;
  const target = dropTargetIndex();
  endMouseDrag();

  if (!wasStarted) return;

  const besluit = besluitBijLoslaten({ losGewapend, aantalTabs: state.documents.length });
  if (besluit === 'losmaken') {
    // Released away from the tab bar (and not over another instance, or the
    // OS drag would have taken over): open it in a second instance.
    detachTabToNewWindow(from);
    return;
  }
  if (besluit !== 'herschikken') return;
  if (target === -1 || target === from) return;

  // Track which doc is active by its id
  const activeId = state.documents[state.activeDocumentIndex]?.id;

  // Reorder
  const [moved] = state.documents.splice(from, 1);
  state.documents.splice(target, 0, moved);

  // Maintain active tab
  if (activeId) {
    const newActiveIndex = state.documents.findIndex(d => d.id === activeId);
    if (newActiveIndex !== -1) {
      state.activeDocumentIndex = newActiveIndex;
    }
  }

  import('../../ui/chrome/tabs.js').then(m => m.updateTabBar());
}

export default function DocumentTabs() {
  const { t } = useTranslation('statusbar');
  const { t: tCtx } = useTranslation('context');
  const { t: tCommon } = useTranslation('common');
  const { t: tDialogs } = useTranslation('dialogs');

  const baseName = (p) => ((p || '').split(/[\\/]/).pop() || '').replace(/\.pdf$/i, '');
  const compareTabTip = () => {
    const a = baseName(compareOldPath());
    const b = baseName(compareNewPath());
    return a && b ? `${a} ↔ ${b}` : (t('compareTabTitle') || 'Vergelijken');
  };

  // Close the tab context menu on outside click / Escape.
  const onDocClick = (e) => {
    if (!ctxMenu()) return;
    if (e.target && e.target.closest && e.target.closest('.document-tab-ctxmenu')) return;
    setCtxMenu(null);
  };
  const onDocKeyDown = (e) => { if (e.key === 'Escape') setCtxMenu(null); };
  document.addEventListener('mousedown', onDocClick, true);
  document.addEventListener('keydown', onDocKeyDown);

  onCleanup(() => {
    document.removeEventListener('mousemove', onDocMouseMove);
    document.removeEventListener('mouseup', onDocMouseUp);
    document.removeEventListener('mousedown', onDocClick, true);
    document.removeEventListener('keydown', onDocKeyDown);
  });

  return (
    <div class="document-tabs" id="document-tabs">
      <Show when={state.documents.length === 0}>
        <div class="document-tabs-empty">{t('noDocumentsOpen')}</div>
      </Show>

      <For each={state.documents}>
        {(doc, i) => (
          <div
            class={'document-tab'
              + (i() === state.activeDocumentIndex && !compareFocused() ? ' active' : '')
              + (draggingIndex() === i() ? ' dragging' : '')
              + (dropTargetIndex() === i() ? ' drop-target' : '')}
            data-index={i()}
            onClick={() => handleTabClick(i())}
            onAuxClick={(e) => handleMiddleClick(e, i())}
            onDblClick={(e) => handleDoubleClick(e, i())}
            onMouseDown={(e) => handleMouseDown(e, i())}
            onContextMenu={(e) => handleTabContextMenu(e, i())}
          >
            <span class="document-tab-modified">{doc.modified ? '*' : ''}</span>
            <Show when={doc.hersteld}>
              <span class="document-tab-recovered" title={tDialogs('recovery.tabTip')}>{tDialogs('recovery.tabLabel')}</span>
            </Show>
            <Show when={editingIndex() === i()} fallback={
              <span class="document-tab-title" title={doc.filePath || doc.fileName}>{doc.fileName}</span>
            }>
              <input
                class="document-tab-rename-input"
                ref={(el) => handleInputMount(el, doc)}
                onKeyDown={(e) => handleRenameKeyDown(e, i())}
                onBlur={() => cancelRename()}
                onClick={(e) => e.stopPropagation()}
              />
            </Show>
            {/* Een oudere versie van de site: "Versie 3 van 5 – alleen-lezen" (#712). */}
            <Show when={hostVersieLabel(doc, tCommon)}>
              <span class="document-tab-version">{hostVersieLabel(doc, tCommon)}</span>
            </Show>
            <span class="document-tab-close" title={t('closeTab')} onClick={(e) => handleCloseTab(e, i())}>&times;</span>
          </div>
        )}
      </For>

      {/* Compare session lives as its OWN tab (not a real document) so you can
          flip between your PDFs and the side-by-side comparison. */}
      <Show when={compareActive()}>
        <div
          class={'document-tab compare-tab' + (compareFocused() ? ' active' : '')}
          title={compareTabTip()}
          onClick={() => focusCompareTab()}
          onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); exitCompare(); } }}
        >
          <span class="document-tab-title" style="display:inline-flex; align-items:center; gap:5px;">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" style="flex:none;">
              <rect x="3" y="4" width="7" height="16" /><rect x="14" y="4" width="7" height="16" />
            </svg>
            {t('compareTabTitle') || 'Vergelijken'}
          </span>
          <span class="document-tab-close" title={t('closeTab')} onClick={(e) => { e.stopPropagation(); exitCompare(); }}>&times;</span>
        </div>
      </Show>

      <div class="document-tabs-add" title={t('openPdfFile')} onClick={handleAddClick}>+</div>

      {/* Right-click context menu for tabs — Chrome-style. Rendered inline
          because there are only one-or-two items and the existing global
          context-menu store is tightly coupled to annotation operations. */}
      <Show when={ctxMenu()}>
        <div
          class="document-tab-ctxmenu"
          style={{
            position: 'fixed',
            top: `${ctxMenu().y}px`,
            left: `${ctxMenu().x}px`,
            background: '#fff',
            border: '1px solid #7a7a7a',
            'box-shadow': '2px 2px 6px rgba(0,0,0,0.25)',
            'z-index': 2000,
            'min-width': '200px',
            'font-size': '13px',
          }}
          onMouseLeave={hideCtxMenu}
        >
          <div
            style={{ padding: '6px 14px', cursor: 'pointer' }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#cce4f7'}
            onMouseLeave={(e) => e.currentTarget.style.background = ''}
            onClick={() => { const idx = ctxMenu().index; hideCtxMenu(); detachTabToNewWindow(idx); }}
          >{tCommon('tabs.openInNewWindow')}</div>
          {/* Alleen tonen voor documenten met een echt bestandspad — naamloze/
              nieuwe documenten leven in een temp-bestand dat je de gebruiker
              niet wilt laten zien. Label is platform-specifiek (Verkenner/
              Finder/bestandsbeheer). */}
          <Show when={canRevealInFileManager(state.documents[ctxMenu().index])}>
            <div
              style={{ padding: '6px 14px', cursor: 'pointer', 'border-top': '1px solid #d4d4d4' }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#cce4f7'}
              onMouseLeave={(e) => e.currentTarget.style.background = ''}
              onClick={() => {
                const doc = state.documents[ctxMenu().index];
                hideCtxMenu();
                if (doc?.filePath) revealInFileManager(doc.filePath);
              }}
            >{tCtx(revealInFileManagerLabelKey())}</div>
          </Show>
          <div
            style={{ padding: '6px 14px', cursor: 'pointer', 'border-top': '1px solid #d4d4d4' }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#cce4f7'}
            onMouseLeave={(e) => e.currentTarget.style.background = ''}
            onClick={() => { const idx = ctxMenu().index; hideCtxMenu(); import('../../ui/chrome/tabs.js').then(m => m.closeTab(idx)); }}
          >{tCommon('tabs.closeTab')}</div>
        </div>
      </Show>
    </div>
  );
}
