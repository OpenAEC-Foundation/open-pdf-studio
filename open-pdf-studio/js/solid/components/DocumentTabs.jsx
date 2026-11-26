import { For, Show, createSignal, onCleanup } from 'solid-js';
import { state, findDocumentByPath } from '../../core/state.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import i18next from '../../i18n/config.js';
import { invoke } from '../../core/platform.js';
import { previewDock, receiveDock, requestDock } from '../../ui/chrome/tab-dock.js';
import { hostVersieLabel } from '../../pdf/host-versies.js';
import { tabItems, isActiefTabItem, heeftMeerWeergaven } from '../../ui/chrome/weergave-tabs-model.js';
import { kanAllesSluiten, kanAndereSluiten } from '../../ui/chrome/tabs-sluiten-model.js';
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
  losmaakPositie,
  besluitBijLoslaten,
  padVoorNieuweInstantie,
  losmaakBlokkade,
} from '../../ui/chrome/tab-losmaken.js';

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

// Only acknowledge a transfer once the receiver has a loaded document.
async function openDockedPdf(path) {
  const { createTab, closeTab } = await import('../../ui/chrome/tabs.js');
  const { loadPDFIfNeeded } = await import('../../pdf/loader.js');
  const existing = findDocumentByPath(path) >= 0;
  const { index } = createTab(path);
  const doc = state.documents[index];
  try {
    await loadPDFIfNeeded(path, index);
    return !!doc.pdfDoc && state.documents.includes(doc);
  } finally {
    const current = state.documents.indexOf(doc);
    if (!existing && !doc.pdfDoc && current >= 0) await closeTab(current);
  }
}

const [editingIndex, setEditingIndex] = createSignal(-1);
const [dropTargetIndex, setDropTargetIndex] = createSignal(-1);
const [draggingIndex, setDraggingIndex] = createSignal(-1);

// Mouse-based drag state (module-level so handlers can access it)
let dragState = null;

// Een document kan in meer tabbladen open staan (#919): `weergave` is dan
// het tabblad (de weergave) van dat document; null bij één tabblad.
function handleTabClick(index, weergave = null) {
  if (editingIndex() === index) return;
  blurCompareTab(); // switching to a PDF tab leaves the compare view
  import('../../ui/chrome/weergave-tabs.js').then(m => m.toonTabItem(index, weergave));
}

function sluitTab(index, weergave = null) {
  import('../../ui/chrome/weergave-tabs.js').then(m => m.sluitTabItem(index, weergave));
}

// Andere / alle tabbladen sluiten (#1156): per document het gewone sluiten.
function sluitAndere(index, weergave = null) {
  import('../../ui/chrome/tabs-sluiten.js').then(m => m.sluitAndereTabs(index, weergave))
    .catch(e => console.warn('[tabs] andere tabbladen sluiten mislukt:', e));
}

function sluitAlle() {
  import('../../ui/chrome/tabs-sluiten.js').then(m => m.sluitAlleTabs())
    .catch(e => console.warn('[tabs] alle tabbladen sluiten mislukt:', e));
}

function handleCloseTab(e, index, weergave = null) {
  e.stopPropagation();
  sluitTab(index, weergave);
}

function handleMiddleClick(e, index, weergave = null) {
  if (e.button === 1) {
    e.preventDefault();
    sluitTab(index, weergave);
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
    document: state.documents[index],
    startX: e.clientX,
    startY: e.clientY,
    started: false,
  };

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
  // Een document in meer tabbladen (#919) gaat niet los naar een ander
  // venster: dat zou de andere tabbladen ervan meenemen.
  const { buiten, losGewapend } = losmaakPositie(e.clientX, e.clientY,
    window.innerWidth, window.innerHeight, tabBarRect,
    heeftMeerWeergaven(state.documents[dragState.fromIndex]));
  dragState.buiten = buiten;
  dragState.losGewapend = losGewapend;

  // Find which tab the mouse is over (reorder)
  let targetIndex = -1;
  if (!dragState.losGewapend) {
    const tabElements = tabsContainer.querySelectorAll('.document-tab');
    for (let i = 0; i < tabElements.length; i++) {
      const rect = tabElements[i].getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX < rect.right) {
        // Het document van dat tabblad; een document kan meer tabbladen
        // hebben (#919). Het vergelijkingstabblad: achteraan.
        const ruw = tabElements[i].dataset.index;
        const idx = Number(ruw);
        targetIndex = ruw !== undefined && ruw !== '' && Number.isInteger(idx) ? idx : state.documents.length;
        break;
      }
    }
  }
  setDropTargetIndex(targetIndex !== -1 && targetIndex !== dragState.fromIndex ? targetIndex : -1);

  dragState.x = e.clientX;
  dragState.y = e.clientY;
  if (losGewapend && buiten) checkDockTarget(dragState);
}

async function checkDockTarget(gesture) {
  if (gesture.checking || gesture.timer) return;
  gesture.checking = true;
  try {
    const target = await invoke('tab_drop_target', { x: gesture.x, y: gesture.y });
    if (dragState === gesture && gesture.buiten && target) previewDock(target);
  } catch { /* No desktop hit test in the browser. */ }
  gesture.checking = false;
  if (dragState === gesture && gesture.buiten && gesture.losGewapend) {
    gesture.timer = setTimeout(() => {
      gesture.timer = null;
      if (dragState === gesture && gesture.buiten) checkDockTarget(gesture);
    }, 80);
  }
}

// Stop the in-WebView drag tracking and clear its visual state.
function endMouseDrag() {
  clearTimeout(dragState?.timer);
  document.removeEventListener('mousemove', onDocMouseMove);
  document.removeEventListener('mouseup', onDocMouseUp);
  document.body.style.userSelect = '';
  dragState = null;
  setDraggingIndex(-1);
  setDropTargetIndex(-1);
}

// Hide the context menu when clicking anywhere else / pressing Escape.
function hideCtxMenu() { setCtxMenu(null); }

function handleTabContextMenu(e, index, weergave = null) {
  e.preventDefault();
  e.stopPropagation();
  setCtxMenu({ x: e.clientX, y: e.clientY, index, weergave });
}

async function onDocMouseUp(event) {
  if (!dragState) {
    endMouseDrag();
    return;
  }

  const doc = dragState.document;
  const from = state.documents.indexOf(doc);
  const wasStarted = dragState.started;
  const losGewapend = !!dragState.losGewapend;
  const buiten = dragState.buiten;
  const target = dropTargetIndex();
  endMouseDrag();

  if (!wasStarted || from < 0) return;

  const besluit = besluitBijLoslaten({ losGewapend, aantalTabs: state.documents.length, buiten });
  if (besluit === 'losmaken') {
    let destination;
    try {
      if (buiten && window.__TAURI__) destination = await invoke('tab_drop_target', { x: event.clientX, y: event.clientY });
      if (destination) {
        const path = padVoorNieuweInstantie(doc);
        if (!path || losmaakBlokkade(doc) || doc.modified) {
          alert(i18next.t('tabs.saveBeforeDetach'));
          return;
        }
        if (!await requestDock(destination, path)) throw new Error(i18next.t('tabs.dragNotStarted'));
        const index = state.documents.indexOf(doc);
        if (index >= 0 && !doc.modified && path === padVoorNieuweInstantie(doc)) {
          const { closeTab } = await import('../../ui/chrome/tabs.js');
          await closeTab(index);
        }
      } else {
        const index = state.documents.indexOf(doc);
        if (index >= 0) await detachTabToNewWindow(index);
      }
    } catch (error) {
      console.warn('[tabs] transfer failed', error);
      alert(i18next.t('tabs.dragNotStarted'));
    }
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

  // Aan/uit van "Andere tabbladen sluiten" en "Alle tabbladen sluiten" (#1156).
  const tabToestand = () => ({ aantalTabItems: tabItems(state.documents).length, vergelijkActief: compareActive() });
  const andereSluitenAan = () => kanAndereSluiten(tabToestand());
  const allesSluitenAan = () => kanAllesSluiten(tabToestand());

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

  let disposed = false;
  let stopDock;
  if (window.__TAURI__ && typeof BroadcastChannel !== 'undefined') {
    invoke('instance_role').then(({ pid }) => {
      if (!disposed && pid) stopDock = receiveDock(pid, () => document.getElementById('document-tabs'), openDockedPdf);
    }).catch(e => console.warn('[tabs] receiver unavailable', e));
  }
  onCleanup(() => {
    disposed = true;
    stopDock?.();
    endMouseDrag();
    document.removeEventListener('mousemove', onDocMouseMove);
    document.removeEventListener('mouseup', onDocMouseUp);
    document.removeEventListener('mousedown', onDocClick, true);
    document.removeEventListener('keydown', onDocKeyDown);
  });

  return (
    <div class="document-tabs" id="document-tabs" data-dock-label={t('dropHereToDock')}>
      <Show when={state.documents.length === 0}>
        <div class="document-tabs-empty">{t('noDocumentsOpen')}</div>
      </Show>

      {/* Eén tabblad per document, of per weergave als het document in meer
          tabbladen open staat (#919, weergave-tabs-model.js). */}
      <For each={tabItems(state.documents)}>
        {(item) => {
        const doc = state.documents[item.index];
        const i = () => item.index;
        return (
          <div
            class={'document-tab'
              + (isActiefTabItem(item, state.documents, state.activeDocumentIndex) && !compareFocused() ? ' active' : '')
              + (draggingIndex() === i() ? ' dragging' : '')
              + (dropTargetIndex() === i() ? ' drop-target' : '')}
            data-index={i()}
            onClick={() => handleTabClick(i(), item.weergave)}
            onAuxClick={(e) => handleMiddleClick(e, i(), item.weergave)}
            onDblClick={(e) => handleDoubleClick(e, i())}
            onMouseDown={(e) => handleMouseDown(e, i())}
            onContextMenu={(e) => handleTabContextMenu(e, i(), item.weergave)}
          >
            <span class="document-tab-modified">{doc.modified ? '*' : ''}</span>
            <Show when={doc.hersteld}>
              <span class="document-tab-recovered" title={tDialogs('recovery.tabTip')}>{tDialogs('recovery.tabLabel')}</span>
            </Show>
            <Show when={editingIndex() === i() && (!item.weergave || isActiefTabItem(item, state.documents, state.activeDocumentIndex))} fallback={
              <span class="document-tab-title" title={doc.filePath || doc.fileName}>{doc.fileName}<Show when={item.aantal > 1}><span class="document-tab-view">:{item.nummer}</span></Show></span>
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
            <span class="document-tab-close" title={t('closeTab')} onClick={(e) => handleCloseTab(e, i(), item.weergave)}>&times;</span>
          </div>
        );
        }}
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
            // Interface size (#883): like the other context menus.
            'min-width': 'calc(200px * var(--ui-scale, 1))',
            'font-size': 'calc(13px * var(--ui-scale, 1))',
          }}
          onMouseLeave={hideCtxMenu}
        >
          <Show when={state.documents[ctxMenu().index]?.pdfDoc}>
            <div
              style={{ padding: '6px 14px', cursor: 'default' }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#cce4f7'}
              onMouseLeave={(e) => e.currentTarget.style.background = ''}
              onClick={() => { const idx = ctxMenu().index; hideCtxMenu(); import('../../ui/chrome/weergave-tabs.js').then(m => m.openNieuweWeergave(idx)).catch(e => console.warn('[tabs] nieuw tabblad voor dit document mislukt:', e)); }}
            >{tCommon('tabs.newTabForDocument')}</div>
          </Show>
          <div
            style={{ padding: '6px 14px', cursor: 'default' }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#cce4f7'}
            onMouseLeave={(e) => e.currentTarget.style.background = ''}
            onClick={() => { const idx = ctxMenu().index; hideCtxMenu(); import('../../pdf/split-view/split-view.js').then(m => m.openDocumentInSplit(idx)).catch(e => console.warn('[tabs] openen in gesplitste weergave mislukt:', e)); }}
          >{tCommon('tabs.openInSplitView')}</div>
          {/* Losmaken neemt het hele document mee: niet bij meer tabbladen (#919). */}
          <Show when={!heeftMeerWeergaven(state.documents[ctxMenu().index])}>
            <div
              style={{ padding: '6px 14px', cursor: 'pointer' }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#cce4f7'}
              onMouseLeave={(e) => e.currentTarget.style.background = ''}
              onClick={() => { const idx = ctxMenu().index; hideCtxMenu(); detachTabToNewWindow(idx); }}
            >{tCommon('tabs.openInNewWindow')}</div>
          </Show>
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
            onClick={() => { const { index: idx, weergave } = ctxMenu(); hideCtxMenu(); sluitTab(idx, weergave); }}
          >{tCommon('tabs.closeTab')}</div>
          {/* Andere / alle tabbladen sluiten (#1156); uit als het niets zou doen. */}
          <div
            class="document-tab-ctxmenu-close-others"
            aria-disabled={!andereSluitenAan()}
            style={{ padding: '6px 14px', cursor: 'default', color: andereSluitenAan() ? '' : '#a0a0a0' }}
            onMouseEnter={(e) => { if (andereSluitenAan()) e.currentTarget.style.background = '#cce4f7'; }}
            onMouseLeave={(e) => e.currentTarget.style.background = ''}
            onClick={() => { if (!andereSluitenAan()) return; const { index: idx, weergave } = ctxMenu(); hideCtxMenu(); sluitAndere(idx, weergave); }}
          >{tCommon('tabs.closeOtherTabs')}</div>
          <div
            class="document-tab-ctxmenu-close-all"
            aria-disabled={!allesSluitenAan()}
            style={{ padding: '6px 14px', cursor: 'default', color: allesSluitenAan() ? '' : '#a0a0a0' }}
            onMouseEnter={(e) => { if (allesSluitenAan()) e.currentTarget.style.background = '#cce4f7'; }}
            onMouseLeave={(e) => e.currentTarget.style.background = ''}
            onClick={() => { if (!allesSluitenAan()) return; hideCtxMenu(); sluitAlle(); }}
          >{tCommon('tabs.closeAllTabs')}</div>
        </div>
      </Show>
    </div>
  );
}
