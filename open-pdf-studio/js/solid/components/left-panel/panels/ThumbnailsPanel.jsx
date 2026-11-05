import { For, onMount, onCleanup, createSignal, createEffect, on } from 'solid-js';
import {
  pageCount, selectAllPages, clearPageSelection, getSelectedPagesArray, formatPageRangeString, setContainerRef,
  setDraggedPage, setDropTarget, activePage,
} from '../../../stores/panels/thumbnailStore.js';
import { activeTab } from '../../../stores/leftPanelStore.js';
import ThumbnailItem from '../ThumbnailItem.jsx';
import { createOrganizerPointerDrag } from '../../../../pdf/organizer-pointer-drag.js';
import { dropDoelBijPunt, volgordeNaDrop, scrollStap } from '../../../../ui/panels/miniatuur-slepen.js';
import { useTranslation } from '../../../../i18n/useTranslation.js';
import { volgendePaginaTreffer } from '../../../../ui/panels/miniatuur-zoeken.js';
import { scrollVoorItem } from '../../../../ui/panels/bladwijzer-zoeken.js';
import { state } from '../../../../core/state.js';

export default function ThumbnailsPanel() {
  const { t } = useTranslation('properties');

  const pages = () => {
    const count = pageCount();
    return Array.from({ length: count }, (_, i) => i + 1);
  };

  const handleNavigate = (pageNum) => {
    import('../../../../pdf/renderer.js').then(m => m.goToPage(pageNum));
  };

  // Pagina's herschikken door te slepen (#962). Met pointer-events, niet met
  // HTML5-drag-and-drop: in de desktop-app gaat die naar de bestandsdrop van
  // het venster en gebeurde er niets (alleen een "+"-wijzer). Een
  // geselecteerde pagina neemt de hele selectie mee (#763).
  let containerRef;
  let sleep = null;
  let sleepPagina = null;
  let sleepPunt = null;
  let scrollFrame = null;

  const meerdereKolommen = () => {
    const kolommen = containerRef ? getComputedStyle(containerRef).gridTemplateColumns || '' : '';
    return kolommen.trim().split(/\s+/).filter(Boolean).length > 1;
  };
  const doelBij = (x, y) => {
    const tegels = [...containerRef.querySelectorAll('.thumbnail-item[data-page]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { page: Number(el.dataset.page), left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    });
    const doel = dropDoelBijPunt(tegels, x, y, meerdereKolommen());
    return doel && doel.page !== sleepPagina ? doel : null;
  };
  const stopScroll = () => {
    if (scrollFrame != null) cancelAnimationFrame(scrollFrame);
    scrollFrame = null;
  };
  const scrollTijdensSlepen = () => {
    scrollFrame = null;
    if (!sleep?.isDragging() || !containerRef || !sleepPunt) return;
    const r = containerRef.getBoundingClientRect();
    const stap = scrollStap(r.top, r.bottom, sleepPunt.y);
    if (stap) {
      containerRef.scrollTop += stap;
      setDropTarget(doelBij(sleepPunt.x, sleepPunt.y));
    }
    scrollFrame = requestAnimationFrame(scrollTijdensSlepen);
  };

  onMount(() => {
    if (!containerRef) return;
    sleep = createOrganizerPointerDrag(containerRef, {
      keyAt(target) {
        if (target.closest?.('input, button, textarea, select, a')) return null;
        const tegel = target.closest?.('.thumbnail-item[data-page]');
        return tegel && containerRef.contains(tegel) ? Number(tegel.dataset.page) : null;
      },
      start(pagina) {
        sleepPagina = pagina;
        setDraggedPage(pagina);
      },
      move(e) {
        sleepPunt = { x: e.clientX, y: e.clientY };
        setDropTarget(doelBij(e.clientX, e.clientY));
        if (scrollFrame == null) scrollFrame = requestAnimationFrame(scrollTijdensSlepen);
      },
      async finish(e) {
        stopScroll();
        const doel = e.cancelled ? null : doelBij(e.clientX, e.clientY);
        const van = sleepPagina;
        sleepPagina = null;
        sleepPunt = null;
        setDropTarget(null);
        setDraggedPage(null);
        const volgorde = volgordeNaDrop(pageCount(), getSelectedPagesArray(), van, doel);
        if (!volgorde) return;
        const { reorderPages } = await import('../../../../pdf/page-manager.js');
        await reorderPages(volgorde);
      },
    });
  });
  onCleanup(() => { stopScroll(); sleep?.destroy(); });

  // Zoekveld, zoals bij de bladwijzers (#578, #926): typen markeert de eerste
  // pagina waarvan het label (de bladnaam, #580, of anders het nummer) met de
  // tekst begint, daarna die hem bevatten, en scrolt ernaartoe. Enter opent
  // die pagina, nog eens Enter gaat naar de volgende treffer (rondgaand). Esc
  // wist het veld. De miniaturen worden niet gefilterd.
  let zoekRef;
  const [gevonden, setGevonden] = createSignal(null);
  const [geenTreffer, setGeenTreffer] = createSignal(false);

  function scrollNaar(pagina) {
    const el = containerRef?.querySelector(`.thumbnail-item[data-page="${pagina}"]`);
    if (!el) return;
    const top = scrollVoorItem(containerRef.getBoundingClientRect(), el.getBoundingClientRect(), containerRef.scrollTop, 'center');
    if (top != null) containerRef.scrollTop = top;
  }

  function zoek(tekst, naPagina) {
    const labels = state.documents[state.activeDocumentIndex]?.pageLabels;
    const pagina = volgendePaginaTreffer(pageCount(), labels, tekst, naPagina);
    setGevonden(pagina);
    setGeenTreffer(String(tekst ?? '').trim() !== '' && !pagina);
    if (pagina) requestAnimationFrame(() => scrollNaar(pagina));
    return pagina;
  }

  function wisZoeken() {
    if (zoekRef) zoekRef.value = '';
    setGevonden(null);
    setGeenTreffer(false);
  }

  // Ander document of ander paginatal: een oude treffer klopt niet meer.
  createEffect(on([() => state.activeDocumentIndex, pageCount], wisZoeken, { defer: true }));

  function onZoekToets(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      wisZoeken();
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    e.stopPropagation();
    let pagina = gevonden();
    // De eerste Enter opent de treffer; elke volgende gaat naar de volgende.
    if (!pagina || activePage() === pagina) pagina = zoek(zoekRef.value, pagina);
    if (pagina) handleNavigate(pagina);
  }

  const handleKeyDown = async (e) => {
    // Ook met Caps Lock aan (e.key is dan 'A', #577).
    if (e.ctrlKey && !e.shiftKey && (e.key || '').toLowerCase() === 'a') {
      e.preventDefault();
      selectAllPages();
    } else if (e.key === 'Escape') {
      if (sleep?.isDragging()) { e.preventDefault(); sleep.cancel(); return; }
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
        <input
          ref={zoekRef}
          class="bookmarks-search thumbnails-search"
          classList={{ 'no-match': geenTreffer() }}
          type="text"
          spellcheck={false}
          autocomplete="off"
          disabled={!pageCount()}
          placeholder={t('leftPanel.findPage')}
          title={t('leftPanel.findPageTip')}
          aria-label={t('leftPanel.findPage')}
          onInput={() => zoek(zoekRef.value, null)}
          onKeyDown={onZoekToets}
        />
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
      <div class="thumbnails-container" id="thumbnails-container" ref={(el) => { containerRef = el; setContainerRef(el); }} tabIndex={0} onKeyDown={handleKeyDown}>
        <For each={pages()}>
          {(pageNum) => (
            <ThumbnailItem
              pageNum={pageNum}
              found={gevonden() === pageNum}
              onNavigate={handleNavigate}
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
