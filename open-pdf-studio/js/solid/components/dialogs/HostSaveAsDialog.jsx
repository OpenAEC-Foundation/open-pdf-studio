// Opslaan als op de site (#726): een naam en een map uit storage.list().
// Begint in de map van het geopende document; een map openen met een klik,
// terug met "Omhoog". Een bestand aanklikken neemt zijn naam over. De site
// beslist of een map schrijfbaar is; een weigering komt na het opslaan.
// "Downloaden" geeft de oude route: een download in de browser.

import { createSignal, For, Show, onMount } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { hostMappen } from '../../../core/platform.js';
import { controleerNaam } from '../../../core/host-opslaan-als.js';

export default function HostSaveAsDialog(props) {
  const { t } = useTranslation('common');
  const data = props.data || {};
  let naamVeld;

  const [naam, setNaam] = createSignal(data.naam || 'document.pdf');
  // De weg vanaf de map van het geopende document (id null).
  const [weg, setWeg] = createSignal([{ id: null, name: t('hostSaveAs.currentFolder') }]);
  const [items, setItems] = createSignal([]);
  const [laden, setLaden] = createSignal(false);
  const [lijstFout, setLijstFout] = createSignal(false);
  const [naamFout, setNaamFout] = createSignal('');

  const huidig = () => weg()[weg().length - 1];
  let beurt = 0;

  async function laad() {
    const eigen = ++beurt;
    setLaden(true);
    setLijstFout(false);
    setItems([]);
    try {
      const lijst = await hostMappen(huidig().id);
      if (eigen === beurt) setItems(lijst);
    } catch (e) {
      console.warn('[gast] mappen van de site niet geladen:', e);
      if (eigen === beurt) setLijstFout(true);
    } finally {
      if (eigen === beurt) setLaden(false);
    }
  }

  onMount(() => {
    laad();
    // De naam geselecteerd zonder .pdf, zoals in een bestandsdialoog.
    requestAnimationFrame(() => {
      if (!naamVeld) return;
      naamVeld.focus();
      const eind = naam().toLowerCase().endsWith('.pdf') ? naam().length - 4 : naam().length;
      naamVeld.setSelectionRange(0, eind);
    });
  });

  function openMap(item) {
    setWeg([...weg(), { id: item.id, name: item.name }]);
    laad();
  }

  function omhoog() {
    if (weg().length < 2) return;
    setWeg(weg().slice(0, -1));
    laad();
  }

  function kies(item) {
    if (item.kind === 'folder') openMap(item);
    else setNaam(item.name);
  }

  function klaar(waarde) {
    closeDialog('host-save-as');
    data.resolve?.(waarde);
  }

  function opslaan() {
    const { naam: schoon, fout } = controleerNaam(naam());
    if (fout) {
      setNaamFout(t(fout === 'leeg' ? 'hostSaveAs.nameEmpty' : 'hostSaveAs.nameInvalid'));
      naamVeld?.focus();
      return;
    }
    klaar({ naam: schoon, map: huidig().id });
  }

  function downloaden() {
    const { naam: schoon, fout } = controleerNaam(naam());
    klaar({ download: true, naam: fout ? (data.naam || 'document.pdf') : schoon });
  }

  const footer = (
    <>
      <button class="pref-btn pref-btn-secondary" onClick={downloaden}>{t('hostSaveAs.download')}</button>
      <div class="extract-pages-footer-right">
        <button class="pref-btn pref-btn-primary" onClick={opslaan}>{t('hostSaveAs.save')}</button>
        <button class="pref-btn pref-btn-secondary" onClick={() => klaar(null)}>{t('cancel')}</button>
      </div>
    </>
  );

  return (
    <Dialog
      title={t('hostSaveAs.title')}
      overlayClass="extract-pages-overlay"
      dialogClass="extract-pages-dialog host-save-as-dialog"
      headerClass="extract-pages-header"
      bodyClass="extract-pages-content"
      footerClass="extract-pages-footer"
      onClose={() => klaar(null)}
      footer={footer}
    >
      <div class="extract-pages-form">
        <div class="extract-pages-row">
          <label class="extract-pages-label">{t('hostSaveAs.location')}</label>
          <span class="host-save-as-weg" title={weg().map((m) => m.name).join(' / ')}>
            {weg().map((m) => m.name).join(' / ')}
          </span>
          <button class="pref-btn pref-btn-secondary host-save-as-omhoog" disabled={weg().length < 2} onClick={omhoog}>
            {t('hostSaveAs.up')}
          </button>
        </div>
        <div class="host-save-as-lijst" role="listbox" aria-label={t('hostSaveAs.location')}>
          <Show when={laden()}>
            <div class="host-save-as-status">{t('hostSaveAs.loading')}</div>
          </Show>
          <Show when={!laden() && lijstFout()}>
            <div class="host-save-as-status host-save-as-fout">{t('hostSaveAs.listError')}</div>
          </Show>
          <Show when={!laden() && !lijstFout() && items().length === 0}>
            <div class="host-save-as-status">{t('hostSaveAs.empty')}</div>
          </Show>
          <For each={items()}>
            {(item) => (
              <div
                class={`host-save-as-item ${item.kind === 'folder' ? 'is-map' : 'is-bestand'}`}
                role="option"
                tabIndex={0}
                onClick={() => kies(item)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); kies(item); } }}
              >
                <Show
                  when={item.kind === 'folder'}
                  fallback={<svg class="host-save-as-icoon" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 1.5h6l3 3v10h-9z M9.5 1.5v3h3" fill="none" stroke="currentColor" /></svg>}
                >
                  <svg class="host-save-as-icoon" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 3.5h5l1.5 1.5h6.5v8.5h-13z" fill="#e8c46a" stroke="#b8932f" /></svg>
                </Show>
                <span class="host-save-as-naam">{item.name}</span>
                <Show when={item.kind === 'folder' && item.writable === false}>
                  <span class="host-save-as-alleen-lezen">{t('hostSaveAs.readOnly')}</span>
                </Show>
              </div>
            )}
          </For>
        </div>
        <div class="extract-pages-row">
          <label class="extract-pages-label" for="host-save-as-naam">{t('hostSaveAs.fileName')}</label>
          <input
            id="host-save-as-naam"
            ref={naamVeld}
            type="text"
            class="extract-pages-input-wide"
            value={naam()}
            onInput={(e) => { setNaam(e.currentTarget.value); setNaamFout(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); opslaan(); } }}
          />
        </div>
        <Show when={naamFout()}>
          <div class="extract-pages-info host-save-as-fout">{naamFout()}</div>
        </Show>
      </div>
    </Dialog>
  );
}
