import { Show, createSignal, onMount, onCleanup } from 'solid-js';
import {
  activePage, thumbnailData, draggedPage, dropTarget, placeholderSize,
  selectedPages, selectPage, togglePageSelection, selectPageRange, isPageSelected
} from '../../stores/panels/thumbnailStore.js';
import { showThumbnailMenu } from '../../stores/contextMenuStore.js';
import { state } from '../../../core/state.js';
import { labelVan, heeftEigenLabel } from '../../../pdf/pagina-labels.js';
import { zetPaginaLabel } from '../../../pdf/pagina-labels-app.js';
import { normaliseerSchaal } from '../../../pdf/pagina-schalen.js';
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

  // Page scale (pagina-schalen.js), Bluebeam style: a badge under the label.
  // Its own scale in full colour, the document scale dimmed, else a dash on
  // hover. Click to set: Enter sets it for the selected pages (or this one),
  // empty clears, Esc cancels.
  const eigenSchaal = () => doc()?.pageScales?.[props.pageNum] || null;
  const docSchaal = () => doc()?.measureScale?.scaleRatio || null;
  const schaalTekst = () => eigenSchaal()?.scaleRatio || docSchaal() || '–';
  const schaalTitel = () => {
    const s = eigenSchaal();
    if (s) {
      const hoe = s.method === 'manual' ? 'set' : s.method === 'ocr' ? 'read with OCR' : 'detected';
      const ook = s.alternatives?.length > 1 ? `; also on the sheet: ${s.alternatives.join(', ')}` : '';
      return `Page scale ${s.scaleRatio} (${hoe}${ook}). Click to change.`;
    }
    return docSchaal() ? `Document scale ${docSchaal()}. Click to set a scale for this page.` : 'No scale. Click to set one for this page.';
  };
  const [schaalBewerken, setSchaalBewerken] = createSignal(false);
  let schaalKlaar = false;
  const startSchaal = (e) => { e?.stopPropagation(); schaalKlaar = false; setSchaalBewerken(true); };
  const rondSchaalAf = (waarde) => {
    if (schaalKlaar) return;
    schaalKlaar = true;
    setSchaalBewerken(false);
    const d = doc();
    if (waarde == null || !d?.pdfDoc) return;
    const leeg = !waarde.trim();
    const ratio = leeg ? null : normaliseerSchaal(waarde);
    if (!leeg && !ratio) return;
    if ((ratio || null) === (eigenSchaal()?.scaleRatio || null) && !(isPageSelected(props.pageNum) && selectedPages().size > 1)) return;
    const paginas = isPageSelected(props.pageNum) && selectedPages().size > 1
      ? [...selectedPages()].sort((a, b) => a - b) : [props.pageNum];
    zetPaginaSchalen(d, paginas, ratio);
  };
  // "Set Page Scale..." in the thumbnail menu opens this editor.
  onMount(() => {
    const h = (e) => { if (e.detail?.pageNum === props.pageNum) startSchaal(); };
    window.addEventListener('ops-paginaschaal-bewerk', h);
    onCleanup(() => window.removeEventListener('ops-paginaschaal-bewerk', h));
  });

  const handleClick = (e) => {
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
          type="text"
          spellcheck={false}
          value={eigenSchaal()?.scaleRatio || ''}
          placeholder={docSchaal() || '1:100'}
          ref={(el) => queueMicrotask(() => { el.focus(); el.select(); })}
          onClick={(e) => e.stopPropagation()}
          onDblClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') { e.preventDefault(); rondSchaalAf(e.currentTarget.value); }
            else if (e.key === 'Escape') { e.preventDefault(); rondSchaalAf(null); }
          }}
          onBlur={(e) => rondSchaalAf(e.currentTarget.value)}
        />
      </Show>
    </div>
  );
}
