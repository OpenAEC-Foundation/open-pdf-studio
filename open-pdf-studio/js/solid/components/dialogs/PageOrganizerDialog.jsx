import { createSignal, createMemo, For, Show, onMount } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { thumbnailData, placeholderSize } from '../../stores/panels/thumbnailStore.js';
import { getActiveDocument } from '../../../core/state.js';
import { labelVan } from '../../../pdf/pagina-labels.js';
import {
  identityOrder, isIdentityOrder, moveGroupToGap, isNoOpGap, moveSelectionBy,
  moveSelectionToEdge, rangeInOrder, gapFromRects, stepRow,
} from '../../../pdf/page-order.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

// Page organizer (#763): a grid of page thumbnails in which pages are dragged
// into a new order. Nothing changes in the document until Apply, which hands
// the whole new order to reorderPages() as one undo step; Cancel leaves the
// document as it was.
export default function PageOrganizerDialog() {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');

  const doc = getActiveDocument();
  const total = doc?.pdfDoc?.numPages || 0;

  const [order, setOrder] = createSignal(identityOrder(total));
  const [selected, setSelected] = createSignal(new Set(doc?.currentPage ? [doc.currentPage] : []));
  const [anchor, setAnchor] = createSignal(doc?.currentPage || 1);
  const [focusPage, setFocusPage] = createSignal(doc?.currentPage || 1);
  const [gap, setGap] = createSignal(null);
  const [dragging, setDragging] = createSignal(false);
  let gridRef;

  const changed = createMemo(() => !isIdentityOrder(order()));
  const hasSelection = () => selected().size > 0;
  const size = () => placeholderSize();

  const close = () => closeDialog('page-organizer');

  const apply = async () => {
    const next = order();
    close();
    // The organizer was opened on this document with this many pages.
    const active = getActiveDocument();
    if (!active || active !== doc || active.pdfDoc?.numPages !== next.length || isIdentityOrder(next)) return;
    const { reorderPages } = await import('../../../pdf/page-manager.js');
    await reorderPages(next);
  };

  const tiles = () => (gridRef ? [...gridRef.querySelectorAll('.page-organizer-tile')] : []);
  const tileRects = () => tiles().map((el) => el.getBoundingClientRect());
  const columns = () => {
    const rects = tileRects();
    if (!rects.length) return 1;
    const top = rects[0].top;
    let n = 0;
    while (n < rects.length && Math.abs(rects[n].top - top) < 2) n++;
    return Math.max(1, n);
  };

  const scrollToPage = (page) => {
    queueMicrotask(() => {
      const el = gridRef?.querySelector(`.page-organizer-tile[data-page="${page}"]`);
      el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    });
  };

  const selectOnly = (page) => {
    setSelected(new Set([page]));
    setAnchor(page);
    setFocusPage(page);
  };

  const handleTileClick = (e, page) => {
    gridRef?.focus();
    if (e.shiftKey) {
      const range = rangeInOrder(order(), anchor(), page);
      const next = e.ctrlKey || e.metaKey ? new Set([...selected(), ...range]) : new Set(range);
      setSelected(next);
      setFocusPage(page);
    } else if (e.ctrlKey || e.metaKey) {
      const next = new Set(selected());
      if (next.has(page)) next.delete(page); else next.add(page);
      setSelected(next);
      setAnchor(page);
      setFocusPage(page);
    } else {
      selectOnly(page);
    }
  };

  const moveBy = (delta) => {
    if (!hasSelection()) return;
    setOrder(moveSelectionBy(order(), selected(), delta));
    gridRef?.focus();
    scrollToPage(focusPage());
  };
  const moveToEdge = (edge) => {
    if (!hasSelection()) return;
    setOrder(moveSelectionToEdge(order(), selected(), edge));
    gridRef?.focus();
    scrollToPage(focusPage());
  };

  // Keyboard: arrows move the focus (Shift extends the selection), Ctrl+arrow
  // moves the selected pages, Ctrl+Home/End moves them to the start/end.
  // While the grid has the focus its keys stay here: the document-wide
  // shortcuts (Delete, Ctrl+A, Home/End, undo) must not act on the document
  // behind the organizer. Escape and Tab still reach the dialog.
  const handleKeyDown = (e) => {
    if (e.key !== 'Escape' && e.key !== 'Tab') e.stopPropagation();
    const list = order();
    if (!list.length) return;
    const key = e.key;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && (key || '').toLowerCase() === 'a') {
      e.preventDefault();
      setSelected(new Set(list));
      return;
    }
    if (ctrl && (key === 'ArrowLeft' || key === 'ArrowUp')) { e.preventDefault(); moveBy(-1); return; }
    if (ctrl && (key === 'ArrowRight' || key === 'ArrowDown')) { e.preventDefault(); moveBy(1); return; }
    if (ctrl && key === 'Home') { e.preventDefault(); moveToEdge('start'); return; }
    if (ctrl && key === 'End') { e.preventDefault(); moveToEdge('end'); return; }
    const at = Math.max(0, list.indexOf(focusPage()));
    let to = null;
    if (key === 'ArrowLeft') to = Math.max(0, at - 1);
    else if (key === 'ArrowRight') to = Math.min(list.length - 1, at + 1);
    else if (key === 'ArrowUp') to = stepRow(at, list.length, columns(), -1);
    else if (key === 'ArrowDown') to = stepRow(at, list.length, columns(), 1);
    else if (key === 'Home') to = 0;
    else if (key === 'End') to = list.length - 1;
    else if (key === ' ') {
      e.preventDefault();
      const next = new Set(selected());
      if (next.has(focusPage())) next.delete(focusPage()); else next.add(focusPage());
      setSelected(next);
      return;
    }
    if (to == null) return;
    e.preventDefault();
    const page = list[to];
    if (e.shiftKey) {
      setSelected(new Set(rangeInOrder(list, anchor(), page)));
      setFocusPage(page);
    } else {
      selectOnly(page);
    }
    scrollToPage(page);
  };

  const handleDragStart = (e, page) => {
    // Dragging a page outside the selection drags that page alone.
    if (!selected().has(page)) selectOnly(page);
    setDragging(true);
    try {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', [...selected()].join(','));
    } catch { /* some engines refuse data on dragstart */ }
  };

  const handleDragOver = (e) => {
    if (!dragging()) return;
    e.preventDefault();
    const g = gapFromRects(tileRects(), e.clientX, e.clientY);
    setGap(isNoOpGap(order(), selected(), g) ? null : g);
    try { e.dataTransfer.dropEffect = 'move'; } catch { /* read-only in some engines */ }
  };

  const endDrag = () => {
    setDragging(false);
    setGap(null);
  };

  const handleDrop = (e) => {
    if (!dragging()) return;
    e.preventDefault();
    const g = gap();
    endDrag();
    if (g == null) return;
    setOrder(moveGroupToGap(order(), selected(), g));
    scrollToPage(focusPage());
  };

  const handleDragLeave = (e) => {
    // Only when the pointer leaves the grid itself, not when it crosses tiles.
    if (!gridRef || gridRef.contains(e.relatedTarget)) return;
    setGap(null);
  };

  onMount(() => {
    gridRef?.focus();
    scrollToPage(focusPage());
  });

  const footer = (
    <>
      <div class="page-organizer-status">
        {t('pageOrganizer.selection', { selected: selected().size, total })}
      </div>
      <div class="extract-pages-footer-right">
        <button class="pref-btn pref-btn-primary" id="page-organizer-apply" disabled={!changed()} onClick={apply}>{tCommon('apply')}</button>
        <button class="pref-btn pref-btn-secondary" onClick={close}>{tCommon('cancel')}</button>
      </div>
    </>
  );

  return (
    <Dialog
      title={t('pageOrganizer.title')}
      overlayClass="page-organizer-overlay"
      dialogClass="page-organizer-dialog"
      bodyClass="page-organizer-body"
      onClose={close}
      footer={footer}
    >
      <div class="page-organizer-toolbar">
        <button class="page-organizer-btn" disabled={!hasSelection()} onClick={() => moveToEdge('start')}
          title={`${t('pageOrganizer.moveToStart')} (Ctrl+Home)`}>{t('pageOrganizer.moveToStart')}</button>
        <button class="page-organizer-btn" disabled={!hasSelection()} onClick={() => moveBy(-1)}
          title={`${t('pageOrganizer.moveLeft')} (Ctrl+←)`}>{t('pageOrganizer.moveLeft')}</button>
        <button class="page-organizer-btn" disabled={!hasSelection()} onClick={() => moveBy(1)}
          title={`${t('pageOrganizer.moveRight')} (Ctrl+→)`}>{t('pageOrganizer.moveRight')}</button>
        <button class="page-organizer-btn" disabled={!hasSelection()} onClick={() => moveToEdge('end')}
          title={`${t('pageOrganizer.moveToEnd')} (Ctrl+End)`}>{t('pageOrganizer.moveToEnd')}</button>
        <span class="page-organizer-sep" />
        <button class="page-organizer-btn" disabled={!changed()} onClick={() => { setOrder(identityOrder(total)); gridRef?.focus(); }}>{tCommon('reset')}</button>
        <span class="page-organizer-hint">{t('pageOrganizer.hint')}</span>
      </div>
      <div
        class="page-organizer-grid"
        ref={gridRef}
        tabIndex={0}
        role="listbox"
        aria-multiselectable="true"
        aria-label={t('pageOrganizer.title')}
        on:keydown={handleKeyDown}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <For each={order()}>
          {(page, index) => (
            <div
              class="page-organizer-tile"
              classList={{
                selected: selected().has(page),
                focused: focusPage() === page,
                dragging: dragging() && selected().has(page),
                'drop-before': gap() === index(),
                'drop-after': gap() === order().length && index() === order().length - 1,
              }}
              data-page={page}
              role="option"
              aria-selected={selected().has(page)}
              draggable={true}
              title={`${tCommon('page')} ${page}`}
              onClick={(e) => handleTileClick(e, page)}
              onDragStart={(e) => handleDragStart(e, page)}
              onDragEnd={endDrag}
            >
              <Show when={thumbnailData[String(page)]} fallback={
                <div class="page-organizer-thumb page-organizer-thumb-empty"
                  style={{ 'aspect-ratio': `${size().width} / ${size().height}` }} />
              }>
                <img class="page-organizer-thumb" src={thumbnailData[String(page)].dataURL} draggable={false} alt="" />
              </Show>
              <div class="page-organizer-label">{labelVan(doc?.pageLabels, page)}</div>
            </div>
          )}
        </For>
      </div>
    </Dialog>
  );
}
