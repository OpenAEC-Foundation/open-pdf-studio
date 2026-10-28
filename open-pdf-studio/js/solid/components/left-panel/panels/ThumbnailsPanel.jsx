import { For, onMount } from 'solid-js';
import { pageCount, selectAllPages, clearPageSelection, getSelectedPagesArray, formatPageRangeString, setContainerRef } from '../../../stores/panels/thumbnailStore.js';
import { activeTab } from '../../../stores/leftPanelStore.js';
import ThumbnailItem from '../ThumbnailItem.jsx';
import { identityOrder, gapForDrop, moveGroupToGap } from '../../../../pdf/page-order.js';
import { useTranslation } from '../../../../i18n/useTranslation.js';

export default function ThumbnailsPanel() {
  const { t } = useTranslation('properties');

  const pages = () => {
    const count = pageCount();
    return Array.from({ length: count }, (_, i) => i + 1);
  };

  const handleNavigate = (pageNum) => {
    import('../../../../pdf/renderer.js').then(m => m.goToPage(pageNum));
  };

  // Dragging a selected page takes the whole selection along (#763).
  const handleReorder = async (fromPage, toPage, dropBefore) => {
    const { reorderPages } = await import('../../../../pdf/page-manager.js');
    const order = identityOrder(pageCount());
    const selected = getSelectedPagesArray();
    const group = selected.includes(fromPage) ? selected : [fromPage];
    const gap = gapForDrop(order, toPage, dropBefore ? 'before' : 'after');
    if (gap < 0) return;
    await reorderPages(moveGroupToGap(order, group, gap));
  };

  const handleKeyDown = async (e) => {
    // Ook met Caps Lock aan (e.key is dan 'A', #577).
    if (e.ctrlKey && !e.shiftKey && (e.key || '').toLowerCase() === 'a') {
      e.preventDefault();
      selectAllPages();
    } else if (e.key === 'Escape') {
      clearPageSelection();
    } else if (e.key === 'Delete') {
      const selected = getSelectedPagesArray();
      if (selected.length > 0 && selected.length < pageCount()) {
        const rangeStr = formatPageRangeString(selected);
        const { openDialog } = await import('../../../stores/dialogStore.js');
        openDialog('delete-pages', {
          totalPages: pageCount(),
          currentPage: selected[0],
          pageRange: rangeStr
        });
      }
    }
  };

  return (
    <div class={`left-panel-content${activeTab() === 'thumbnails' ? ' active' : ''}`} id="thumbnails-panel">
      <div class="left-panel-header">
        <span>{t('leftPanel.thumbnails')}</span>
        {/* Paginalabels: de naambouwer leest de bladnamen uit de onderhoek (#580). */}
        <button
          class="thumbnails-header-btn"
          title={t('leftPanel.pageLabels')}
          disabled={!pageCount()}
          onClick={async () => {
            const { openDialog } = await import('../../../stores/dialogStore.js');
            openDialog('page-labels');
          }}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M1.5 3.5h8l4.5 4.5-4.5 4.5h-8z"/><path d="M4 6.5h4M4 9.5h5"/></svg>
        </button>
      </div>
      <div class="thumbnails-container" id="thumbnails-container" ref={setContainerRef} tabIndex={0} onKeyDown={handleKeyDown}>
        <For each={pages()}>
          {(pageNum) => (
            <ThumbnailItem
              pageNum={pageNum}
              onNavigate={handleNavigate}
              onReorder={handleReorder}
            />
          )}
        </For>
        {/* Trailing "+" tile: append a new page (A4/A3/… chooser) to the PDF. */}
        <div
          class="thumbnail-item thumbnail-add-page"
          title={t('leftPanel.addPage') || 'Pagina toevoegen'}
          onClick={async () => {
            // Jump to the last page first so the insert dialog's "after
            // current page" default appends at the END of the document.
            const m = await import('../../../../pdf/renderer.js');
            await m.goToPage(pageCount());
            const { showInsertPageDialog } = await import('../../../../ui/chrome/dialogs.js');
            showInsertPageDialog();
          }}
          style={{
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'center',
            'min-height': '80px',
            border: '1px dashed var(--theme-border, #999)',
            color: 'var(--theme-text, #666)',
            'font-size': '28px',
            cursor: 'pointer',
            'user-select': 'none',
          }}
        >+</div>
      </div>
    </div>
  );
}
