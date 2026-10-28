// De modus "Pagina's bewerken" (#764): één scherm met alle pagina's als
// kaarten. Hier doet de gebruiker wat vroeger in losse vensters met
// paginabereiken moest: draaien, verwijderen, verslepen, invoegen en
// splitspunten zetten — meteen zichtbaar, en niets ervan raakt het document
// voordat hij op Opslaan drukt.
//
// Wat de kaarten tonen komt uit het plan (store), niet uit het document: een
// gedraaide of verplaatste pagina ziet er meteen anders uit, en Ctrl+Z binnen
// deze modus zet het plan terug zonder dat er iets herladen hoeft te worden.

import { For, Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import {
  organizerActief, organizerPlan, organizerSelectie, organizerZoom, organizerBezig,
  organizerMelding, organizerKanOngedaan, organizerKanOpnieuw, organizerMaat,
  organizerGesleept, organizerSamenvatting, klikItem, selecteerAlles, wisSelectie,
  draaiSelectie, verwijderSelectie, verplaatsNaarGap, sleepStart, sleepStop,
  voegBlancoInOp, voegPdfToe, wisselSplitsingBij, splitsSelectie, exporteerNu,
  bewaarOrganizer, sluitOrganizer, ongedaanMaken, opnieuwDoen, zetOrganizerZoom,
  zetOrganizerMaat, BLANCO_MATEN,
} from '../../stores/pagina-organizer-store.js';
import { miniatuurVoor } from '../../../pagina-organizer/organizer-thumbs.js';
import { getActiveDocument } from '../../../core/state.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

const ICON = {
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><rect x="3" y="3" width="7" height="10"/><rect x="14" y="3" width="7" height="10"/><rect x="3" y="16" width="7" height="5"/><rect x="14" y="16" width="7" height="5"/></svg>',
  rotateLeft: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5v5h5"/><path d="M3.5 10a8 8 0 1 1 1.7 6.3"/></svg>',
  rotateRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 5v5h-5"/><path d="M20.5 10a8 8 0 1 0-1.7 6.3"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  cut: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8 7.5 20 18M8 16.5 20 6"/></svg>',
  undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 7H5V3"/><path d="M5 7a8 8 0 1 1-1 8"/></svg>',
  redo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 7h4V3"/><path d="M19 7a8 8 0 1 0 1 8"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5 9 17.5 20 6.5"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 5l14 14M19 5 5 19"/></svg>',
  zoomIn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  zoomOut: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 12h14"/></svg>',
};

const pdfBestanden = (dataTransfer) => {
  const files = [...(dataTransfer?.files || [])];
  return files.filter((f) => /\.pdf$/i.test(f.name || '') || f.type === 'application/pdf');
};

/** Eén paginakaart: miniatuur, nummer, vinkje en de drie snelle acties. */
function Kaart(props) {
  const [beeld, setBeeld] = createSignal(null);
  const [mislukt, setMislukt] = createSignal(false);
  // Een document van honderden pagina's mag niet in één keer alles tekenen:
  // pas als de kaart in beeld komt, vraagt hij zijn miniatuur aan.
  const [inBeeld, setInBeeld] = createSignal(false);
  let token = 0;
  let kaart = null;
  let waarnemer = null;

  const laad = async () => {
    const mijn = ++token;
    const item = props.item;
    if (item.bron === 'blanco') {
      setBeeld(null);
      return;
    }
    try {
      const bestand = item.bron === 'bestand' ? organizerPlan()?.bestanden.get(item.bestandId) : null;
      const url = await miniatuurVoor(item, { doelBreedte: props.breedte, bestand });
      if (mijn === token) setBeeld(url);
    } catch (e) {
      console.warn('[organizer] miniatuur mislukt:', e);
      if (mijn === token) setMislukt(true);
    }
  };

  // Opnieuw tekenen als de kaart breder of smaller wordt (zoom), en bij het
  // eerste tekenen — maar alleen voor kaarten die al in beeld waren.
  createEffect(() => {
    void props.breedte;
    void props.item.rotatie;
    if (inBeeld()) laad();
  });

  onMount(() => {
    if (typeof IntersectionObserver !== 'function') {
      setInBeeld(true);
      return;
    }
    // Een ruime marge: de volgende rijen zijn al klaar voordat de gebruiker
    // ze ziet, zodat het scrollen niet achter miniaturen aanloopt.
    waarnemer = new IntersectionObserver((rijen) => {
      if (rijen.some((rij) => rij.isIntersecting)) {
        setInBeeld(true);
        waarnemer?.disconnect();
        waarnemer = null;
      }
    }, { rootMargin: '600px 0px' });
    if (kaart) waarnemer.observe(kaart);
  });

  onCleanup(() => {
    waarnemer?.disconnect();
    waarnemer = null;
    token++; // een lopende render mag niets meer zetten
  });

  const gekozen = () => { organizerSelectie(); return organizerSelectie().has(props.item.id); };

  const sleep = (e) => {
    const ids = organizerSelectie().has(props.item.id) ? [...organizerSelectie()] : [props.item.id];
    if (!organizerSelectie().has(props.item.id)) klikItem(props.item.id);
    sleepStart(ids);
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', ids.join(',')); } catch { /* sommige webviews */ }
  };

  return (
    <div
      class="po-card"
      classList={{
        selected: gekozen(),
        dragging: organizerGesleept().includes(props.item.id),
        blanco: props.item.bron === 'blanco',
      }}
      data-page={props.nummer}
      // De draaiing van deze pagina in het plan: de kaart laat hem aan het
      // beeld zien, en zo is hij ook zonder beeld te controleren.
      data-rotatie={props.item.rotatie || 0}
      ref={kaart}
      draggable={true}
      onClick={(e) => klikItem(props.item.id, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey })}
      onDragStart={sleep}
      onDragEnd={() => sleepStop()}
    >
      <div class="po-card-actions">
        <button
          class="po-act"
          title={props.t('organizer.rotateLeft')}
          innerHTML={ICON.rotateLeft}
          onClick={(e) => { e.stopPropagation(); draaiSelectie(-90, [props.item.id]); }}
        />
        <button
          class="po-act"
          title={props.t('organizer.rotateRight')}
          innerHTML={ICON.rotateRight}
          onClick={(e) => { e.stopPropagation(); draaiSelectie(90, [props.item.id]); }}
        />
        <button
          class="po-act po-act-danger"
          title={props.t('organizer.deletePage')}
          innerHTML={ICON.trash}
          onClick={(e) => { e.stopPropagation(); verwijderSelectie([props.item.id]); }}
        />
      </div>

      <label class="po-check" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={gekozen()}
          onChange={() => klikItem(props.item.id, { ctrl: true })}
          title={props.t('organizer.selectPage')}
        />
      </label>

      <div class="po-thumb" style={{ 'aspect-ratio': props.item.bron === 'blanco' ? '1 / 1.414' : undefined }}>
        <Show when={beeld()} fallback={
          <Show when={props.item.bron === 'blanco' || mislukt()} fallback={<div class="po-spinner" />}>
            <div class="po-blank-sheet">
              <span>{props.item.bron === 'blanco' ? props.t('organizer.blankPage') : props.t('organizer.noPreview')}</span>
              <Show when={props.item.bron === 'blanco'}>
                <small>{BLANCO_MATEN[props.item.maatId || 'a4']?.label || 'A4'}</small>
              </Show>
            </div>
          </Show>
        }>
          <img src={beeld()} draggable={false} alt="" />
        </Show>
      </div>

      <div class="po-card-label">
        <span>{props.nummer}</span>
        <Show when={props.item.bron !== 'doc'}>
          <em>{props.item.bron === 'blanco' ? props.t('organizer.inserted') : props.t('organizer.fromFile')}</em>
        </Show>
      </div>
    </div>
  );
}

export default function PagesOrganizer() {
  const { t } = useTranslation('ribbon');
  const [gapOver, setGapOver] = createSignal(null);
  let root = null;

  const breedte = () => Math.round(150 * organizerZoom());
  const doelBreedte = () => Math.round(breedte() * (window.devicePixelRatio || 1));

  const toets = (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const k = (e.key || '').toLowerCase();
    // In een keuzelijst of vinkje horen de toetsen bij dat veld; Escape blijft
    // wel van de modus.
    const veld = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '');
    if (veld && k !== 'escape') return;
    if (k === 'escape') {
      e.preventDefault(); e.stopPropagation();
      sluitOrganizer();
      return;
    }
    if (ctrl && k === 's') {
      e.preventDefault(); e.stopPropagation();
      bewaarOrganizer();
      return;
    }
    if (ctrl && !e.shiftKey && k === 'z') {
      e.preventDefault(); e.stopPropagation();
      ongedaanMaken();
      return;
    }
    if ((ctrl && k === 'y') || (ctrl && e.shiftKey && k === 'z')) {
      e.preventDefault(); e.stopPropagation();
      opnieuwDoen();
      return;
    }
    if (ctrl && k === 'a') {
      e.preventDefault(); e.stopPropagation();
      selecteerAlles();
      return;
    }
    if (k === 'delete' || k === 'backspace') {
      e.preventDefault(); e.stopPropagation();
      verwijderSelectie();
    }
  };

  const gapDrop = async (e, index) => {
    e.preventDefault();
    e.stopPropagation();
    setGapOver(null);
    const files = pdfBestanden(e.dataTransfer);
    if (files.length) {
      let at = index;
      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (await voegPdfToe(at, { naam: file.name, bytes })) at += 1;
      }
      sleepStop();
      return;
    }
    const ids = organizerGesleept();
    if (ids.length) verplaatsNaarGap(ids, index);
    sleepStop();
  };

  const gapDragOver = (e, index) => {
    const types = [...(e.dataTransfer?.types || [])];
    const sleept = organizerGesleept().length > 0;
    const bestand = types.includes('Files');
    if (!sleept && !bestand) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = bestand && !sleept ? 'copy' : 'move';
    setGapOver(index);
  };

  const sleepOverGrid = (e) => {
    // Een bestand dat naast de gaps valt, hoort achteraan.
    const types = [...(e.dataTransfer?.types || [])];
    if (!types.includes('Files')) return;
    e.preventDefault();
    setGapOver(organizerPlan()?.items.length ?? null);
  };

  const gridDrop = async (e) => {
    const files = pdfBestanden(e.dataTransfer);
    if (!files.length) return;
    e.preventDefault();
    e.stopPropagation();
    setGapOver(null);
    let at = organizerPlan()?.items.length ?? 0;
    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (await voegPdfToe(at, { naam: file.name, bytes })) at += 1;
    }
  };

  // De sneltoetsen hangen aan het venster en niet aan dit element: na een
  // klik op een knop die verdwijnt (de selectiebalk) raakt het scherm anders
  // de focus kwijt en deed Ctrl+Z niets meer. In de capture-fase, zodat het
  // document zelf geen ongedaan-maakstap van deze wijzigingen ziet.
  //
  // Alleen zolang de modus open is: dit onderdeel staat altijd in de app, dus
  // een listener die hier in de opbouw wordt gehangen zou Ctrl+S en Delete van
  // het hele programma overnemen.
  createEffect(() => {
    if (!organizerActief()) return;
    window.addEventListener('keydown', toets, true);
    onCleanup(() => window.removeEventListener('keydown', toets, true));
  });

  // Zodra het scherm er staat, krijgt het de focus (toetsenbord en Escape).
  createEffect(() => {
    if (organizerActief() && typeof root?.focus === 'function') root.focus();
  });

  onCleanup(() => sleepStop());

  const samenvatting = () => organizerSamenvatting();

  return (
    <Show when={organizerActief()}>
      <div class="po-root" ref={root} tabIndex={-1}>
        <header class="po-header">
          <div class="po-title">
            <span class="po-title-icon" innerHTML={ICON.edit} />
            <span>{t('organizer.title')}</span>
            <Show when={samenvatting()}>
              <small>
                {t('organizer.pageCount', { n: samenvatting().aantal })}
                <Show when={samenvatting().verwijderd}>{` · ${t('organizer.removedCount', { n: samenvatting().verwijderd })}`}</Show>
                <Show when={samenvatting().ingevoegd}>{` · ${t('organizer.insertedCount', { n: samenvatting().ingevoegd })}`}</Show>
                <Show when={samenvatting().delen > 1}>{` · ${t('organizer.partCount', { n: samenvatting().delen })}`}</Show>
              </small>
            </Show>
          </div>

          <div class="po-tools">
            <label class="po-maat" title={t('organizer.blankSize')}>
              <select value={organizerMaat()} onChange={(e) => zetOrganizerMaat(e.currentTarget.value)}>
                <For each={Object.entries(BLANCO_MATEN)}>
                  {([id, m]) => <option value={id}>{m.label}</option>}
                </For>
              </select>
            </label>
            <button class="po-tool" title={t('organizer.undo')} disabled={!organizerKanOngedaan()} innerHTML={ICON.undo}
              onClick={() => ongedaanMaken()} />
            <button class="po-tool" title={t('organizer.redo')} disabled={!organizerKanOpnieuw()} innerHTML={ICON.redo}
              onClick={() => opnieuwDoen()} />
            <span class="po-sep" />
            <button class="po-tool" title={t('organizer.zoomOut')} innerHTML={ICON.zoomOut}
              onClick={() => zetOrganizerZoom(organizerZoom() - 0.15)} />
            <span class="po-zoom">{Math.round(organizerZoom() * 100)}%</span>
            <button class="po-tool" title={t('organizer.zoomIn')} innerHTML={ICON.zoomIn}
              onClick={() => zetOrganizerZoom(organizerZoom() + 0.15)} />
            <span class="po-sep" />
            <button class="po-btn" onClick={() => sluitOrganizer()}>{t('organizer.cancel')}</button>
            <button class="po-btn po-btn-primary" disabled={organizerBezig()} onClick={() => bewaarOrganizer()}>
              {organizerBezig() ? t('organizer.saving') : t('organizer.save')}
            </button>
          </div>
        </header>

        <Show when={organizerSelectie().size > 0}>
          <div class="po-selbar">
            <span class="po-sel-count">{t('organizer.selected', { n: organizerSelectie().size })}</span>
            <button class="po-btn" onClick={() => verwijderSelectie()}>{t('organizer.deleteSelected')}</button>
            <button class="po-btn" onClick={() => exporteerNu()}>{t('organizer.extractSelected')}</button>
            <button class="po-btn" onClick={() => splitsSelectie()}>{t('organizer.splitAtSelected')}</button>
            <button class="po-btn po-btn-quiet" onClick={() => wisSelectie()}>{t('organizer.clearSelection')}</button>
          </div>
        </Show>

        <div
          class="po-scroll"
          onDragOver={sleepOverGrid}
          onDrop={gridDrop}
          onClick={(e) => { if (e.target === e.currentTarget) wisSelectie(); }}
        >
          <div class="po-grid" style={{ '--po-card': `${breedte()}px` }}>
            <For each={organizerPlan()?.items || []}>
              {(item, index) => (
                <>
                  <div
                    class="po-gap"
                    classList={{ 'po-gap-over': gapOver() === index(), 'po-gap-first': index() === 0 }}
                    onDragOver={(e) => gapDragOver(e, index())}
                    onDragLeave={() => { if (gapOver() === index()) setGapOver(null); }}
                    onDrop={(e) => gapDrop(e, index())}
                  >
                    <button
                      class="po-gap-btn"
                      title={t('organizer.insertHere')}
                      innerHTML={ICON.plus}
                      onClick={(e) => { e.stopPropagation(); voegBlancoInOp(index()); }}
                    />
                    <Show when={index() > 0}>
                      <button
                        class="po-gap-btn po-gap-cut"
                        classList={{ actief: organizerPlan().splits.has(item.id) }}
                        title={t('organizer.splitHere')}
                        innerHTML={ICON.cut}
                        onClick={(e) => { e.stopPropagation(); wisselSplitsingBij(item.id); }}
                      />
                    </Show>
                    <span class="po-drop-line" />
                  </div>
                  <Kaart item={item} nummer={index() + 1} breedte={doelBreedte()} t={t} />
                </>
              )}
            </For>
            <div
              class="po-gap po-gap-end"
              classList={{ 'po-gap-over': gapOver() === (organizerPlan()?.items.length ?? 0) }}
              onDragOver={(e) => gapDragOver(e, organizerPlan()?.items.length ?? 0)}
              onDragLeave={() => setGapOver(null)}
              onDrop={(e) => gapDrop(e, organizerPlan()?.items.length ?? 0)}
            >
              <button
                class="po-gap-btn"
                title={t('organizer.appendHere')}
                innerHTML={ICON.plus}
                onClick={(e) => { e.stopPropagation(); voegBlancoInOp(organizerPlan()?.items.length ?? 0); }}
              />
              <span class="po-drop-line" />
            </div>
          </div>
        </div>

        <Show when={organizerMelding()}>
          <div class="po-notice">{organizerMelding()}</div>
        </Show>
        <footer class="po-footer">
          {t('organizer.hint')}
          <Show when={getActiveDocument()?.fileName}>
            <span class="po-file">{getActiveDocument().fileName}</span>
          </Show>
        </footer>
      </div>
    </Show>
  );
}
