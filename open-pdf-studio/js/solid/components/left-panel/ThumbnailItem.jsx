import { Show, createSignal, onMount, onCleanup } from 'solid-js';
import {
  activePage, thumbnailData, draggedPage, dropTarget, placeholderSize,
  selectedPages, selectPage, togglePageSelection, selectPageRange, isPageSelected
} from '../../stores/panels/thumbnailStore.js';
import { showThumbnailMenu } from '../../stores/contextMenuStore.js';
import { state } from '../../../core/state.js';
import { labelVan, heeftEigenLabel } from '../../../pdf/pagina-labels.js';
import { zetPaginaLabel } from '../../../pdf/pagina-labels-app.js';
import { besluitSchaalInvoer } from '../../../pdf/pagina-schalen.js';
import { zetPaginaSchalen } from '../../../pdf/pagina-schalen-app.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function ThumbnailItem(props) {
  const isActive = () => activePage() === props.pageNum;
  const imageData = () => thumbnailData[String(props.pageNum)];
  const isDragging = () => draggedPage() === props.pageNum;
  const drop = () => dropTarget();
  const isDropBefore = () => drop()?.page === props.pageNum && drop()?.position === 'before';
  const isDropAfter = () => drop()?.page === props.pageNum && drop()?.position === 'after';
  const isDropNaast = () => drop()?.page === props.pageNum && !!drop()?.naast;
  const isSelected = () => { selectedPages(); return isPageSelected(props.pageNum); };

  const size = () => placeholderSize();

  // Paginalabel (bladnaam, #580) in plaats van het nummer; het nummer staat
  // dan in de tooltip. Dubbelklikken hernoemt de pagina: Enter bewaart, Esc
  // breekt af, leeg zet haar terug op haar nummer.
  const { t: tc } = useTranslation('common');
  const doc = () => state.documents[state.activeDocumentIndex];
  const label = () => labelVan(doc()?.pageLabels, props.pageNum);
  const benoemd = () => heeftEigenLabel(doc()?.pageLabels, props.pageNum);
  const [hernoemen, setHernoemen] = createSignal(false);
  let hernoemKlaar = false;
  const rondHernoemenAf = (waarde) => {
    if (hernoemKlaar) return;
    hernoemKlaar = true;
    setHernoemen(false);
    const d = doc();
    if (waarde == null || !d?.pdfDoc) return;
    const nieuw = waarde.replace(/\s+/g, ' ').trim();
    if ((nieuw || String(props.pageNum)) === label()) return;
    zetPaginaLabel(d, props.pageNum, nieuw);
  };
  const startHernoemen = (e) => {
    e.stopPropagation();
    hernoemKlaar = false;
    setHernoemen(true);
  };

  // Page scale (pagina-schalen.js): a badge under the label. Its own scale in
  // full colour, the document scale dimmed, else a dash on hover. Click to
  // edit. What Enter, leaving the field and Esc do is in besluitSchaalInvoer:
  // Enter sets the selected pages (or this one), leaving the field only ever
  // changes this page and only when its text changed, Esc cancels.
  const { t: tx } = useTranslation('context');
  const eigenSchaal = () => doc()?.pageScales?.[props.pageNum] || null;
  const docSchaal = () => doc()?.measureScale?.scaleRatio || null;
  const schaalTekst = () => eigenSchaal()?.scaleRatio || docSchaal() || '–';
  const schaalTitel = () => {
    if (schaalFout()) return tx('thumbnail.scaleInvalid');
    const s = eigenSchaal();
    if (s) {
      const sleutel = s.method === 'manual' ? 'thumbnail.scaleOwnSet'
        : s.method === 'ocr' ? 'thumbnail.scaleOwnOcr' : 'thumbnail.scaleOwnDetected';
      const tekst = tx(sleutel, { scale: s.scaleRatio });
      return s.alternatives?.length > 1
        ? `${tekst} ${tx('thumbnail.scaleAlsoOnSheet', { scales: s.alternatives.join(', ') })}` : tekst;
    }
    return docSchaal() ? tx('thumbnail.scaleDocument', { scale: docSchaal() }) : tx('thumbnail.scaleNone');
  };
  const [schaalBewerken, setSchaalBewerken] = createSignal(false);
  const [schaalFout, setSchaalFout] = createSignal(false);
  let schaalKlaar = false;
  let schaalBegin = '';
  const startSchaal = (e) => {
    e?.stopPropagation();
    schaalKlaar = false;
    schaalBegin = eigenSchaal()?.scaleRatio || '';
    setSchaalFout(false);
    setSchaalBewerken(true);
  };
  const rondSchaalAf = (waarde, via) => {
    if (schaalKlaar) return;
    const d = doc();
    const besluit = besluitSchaalInvoer({
      pageNum: props.pageNum,
      selectie: [...selectedPages()],
      schalen: d?.pageScales || null,
      begin: schaalBegin,
      waarde,
      via,
    });
    // Not a scale (an imperial 1/4, text): the editor stays open on Enter.
    if (besluit.actie === 'fout') { setSchaalFout(true); return; }
    schaalKlaar = true;
    setSchaalFout(false);
    setSchaalBewerken(false);
    if (besluit.actie === 'zet' && d?.pdfDoc) zetPaginaSchalen(d, besluit.paginas, besluit.ratio);
  };
  // "Set Page Scale..." in the thumbnail menu opens this editor.
  onMount(() => {
    const h = (e) => { if (e.detail?.pageNum === props.pageNum) startSchaal(); };
    window.addEventListener('ops-paginaschaal-bewerk', h);
    onCleanup(() => window.removeEventListener('ops-paginaschaal-bewerk', h));
  });

  const handleClick = (e) => {
    e.currentTarget.closest('.thumbnails-container')?.focus({ preventScroll: true });
    if (e.ctrlKey && e.shiftKey) {
      selectPageRange(props.pageNum, true);
    } else if (e.shiftKey) {
      selectPageRange(props.pageNum, false);
    } else if (e.ctrlKey) {
      togglePageSelection(props.pageNum);
    } else {
      selectPage(props.pageNum);
      props.onNavigate(props.pageNum);
    }
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    // If right-clicked page is not in selection, select it alone
    if (!isPageSelected(props.pageNum)) {
      selectPage(props.pageNum);
    }
    showThumbnailMenu(e.clientX, e.clientY, props.pageNum);
  };

  // Slepen gaat met pointer-events (ThumbnailsPanel, #962); de native
  // HTML5-drag zou de wijzer overnemen en in de desktop-app niets doen.
  return (
    <div
      class="thumbnail-item"
      classList={{
        active: isActive(),
        selected: isSelected(),
        found: !!props.found,
        dragging: isDragging(),
        'drop-before': isDropBefore(),
        'drop-after': isDropAfter(),
        'drop-side': isDropNaast()
      }}
      data-page={props.pageNum}
      draggable={false}
      onDragStart={(e) => e.preventDefault()}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      <Show when={imageData()} fallback={
        <div class="thumbnail-canvas thumbnail-loading" style={{ 'aspect-ratio': `${size().width} / ${size().height}` }}>
          <div class="thumbnail-spinner" />
        </div>
      }>
        {/* Vult de kolombreedte (layout.css); gerenderd op die breedte maal
            devicePixelRatio, dus scherp ook als het paneel breed is (#579). */}
        <img class="thumbnail-canvas" src={imageData().dataURL} draggable={false} alt="" />
      </Show>
      <Show when={hernoemen()} fallback={
        <div
          class="thumbnail-label"
          classList={{ named: benoemd() }}
          title={benoemd() ? `${tc('page')} ${props.pageNum}` : undefined}
          onDblClick={startHernoemen}
        >{label()}</div>
      }>
        <input
          class="thumbnail-label-input"
          type="text"
          spellcheck={false}
          value={benoemd() ? label() : ''}
          placeholder={String(props.pageNum)}
          ref={(el) => queueMicrotask(() => { el.focus(); el.select(); })}
          onClick={(e) => e.stopPropagation()}
          onDblClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            // Niet naar de miniaturenlijst (Delete verwijdert daar pagina's).
            e.stopPropagation();
            if (e.key === 'Enter') { e.preventDefault(); rondHernoemenAf(e.currentTarget.value); }
            else if (e.key === 'Escape') { e.preventDefault(); rondHernoemenAf(null); }
          }}
          onBlur={(e) => rondHernoemenAf(e.currentTarget.value)}
        />
      </Show>
      <Show when={schaalBewerken()} fallback={
        <div
          class="thumbnail-scale"
          classList={{ own: !!eigenSchaal(), none: !eigenSchaal() && !docSchaal() }}
          title={schaalTitel()}
          onClick={startSchaal}
          onDblClick={(e) => e.stopPropagation()}
        >{schaalTekst()}</div>
      }>
        <input
          class="thumbnail-label-input thumbnail-scale-input"
          classList={{ invalid: schaalFout() }}
          type="text"
          spellcheck={false}
          value={schaalBegin}
          title={schaalFout() ? tx('thumbnail.scaleInvalid') : undefined}
          onInput={() => { if (schaalFout()) setSchaalFout(false); }}
          placeholder={docSchaal() || '1:100'}
          ref={(el) => queueMicrotask(() => { el.focus(); el.select(); })}
          onClick={(e) => e.stopPropagation()}
          onDblClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') { e.preventDefault(); rondSchaalAf(e.currentTarget.value, 'enter'); }
            else if (e.key === 'Escape') { e.preventDefault(); rondSchaalAf(null, 'escape'); }
          }}
          onBlur={(e) => rondSchaalAf(e.currentTarget.value, 'blur')}
        />
      </Show>
    </div>
  );
}
