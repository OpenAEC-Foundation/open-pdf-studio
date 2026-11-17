import { createSignal, onMount, For, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { BLADWIJZER_KLEUREN, normaliseerKleur, kleurLabelSleutel } from '../../../ui/panels/bladwijzer-stijl.js';

export default function BookmarkDialog(props) {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');
  const { t: tContext } = useTranslation('context');

  const [title, setTitle] = createSignal(props.data?.title || '');
  const [page, setPage] = createSignal(props.data?.page || 1);
  // Kleur en vet/cursief (#689): /C en /F van het outline-item.
  const [kleur, setKleur] = createSignal(normaliseerKleur(props.data?.color));
  const [vet, setVet] = createSignal(!!props.data?.bold);
  const [cursief, setCursief] = createSignal(!!props.data?.italic);

  // Bestemming (#1157): de geselecteerde tekst, wat nu in beeld is, de
  // bovenkant van een pagina, of (bij bewerken) laten zoals het is. De
  // aanroeper geeft de keuzes die er zijn; zonder keuzes alleen een pagina.
  const doelen = () => props.data?.doelen || [];
  const [doel, setDoel] = createSignal(props.data?.doel || null);
  const doelLabel = (id) => t({
    behouden: 'bookmark.destKeep',
    selectie: 'bookmark.destSelection',
    beeld: 'bookmark.destView',
    pagina: 'bookmark.destPageTop',
  }[id]);
  function kiesDoel(id) {
    setDoel(id);
    // De plek ligt op een pagina: die hoort er dan bij.
    const keuze = doelen().find(d => d.id === id);
    if (keuze?.page) setPage(keuze.page);
  }
  // Een zelf getypte pagina wijst naar de bovenkant van die pagina.
  function typPagina(waarde) {
    setPage(waarde);
    if (doelen().length > 0) setDoel('pagina');
  }

  let titleInputRef;
  let resolved = false;

  const isEdit = () => !!props.data?.isEdit;
  // Nesten onder een nieuwe bladwijzer (#690) vraagt ook een titel.
  const headerText = () => props.data?.modus === 'nest'
    ? t('bookmark.nestTitle')
    : (isEdit() ? t('bookmark.editTitle') : t('bookmark.addTitle'));

  onMount(() => {
    if (titleInputRef) {
      setTimeout(() => titleInputRef.focus(), 50);
    }
  });

  const cancel = () => {
    if (!resolved) {
      resolved = true;
      if (props.data?.onOk) props.data.onOk(null);
    }
    closeDialog('bookmark');
  };

  function handleOk() {
    const t = title().trim();
    if (!t) {
      if (titleInputRef) titleInputRef.focus();
      return;
    }
    let p = parseInt(page());
    if (isNaN(p) || p < 1) p = 1;
    resolved = true;
    if (props.data?.onOk) {
      props.data.onOk({ title: t, page: p, color: kleur(), bold: vet(), italic: cursief(), doel: doel() });
    }
    closeDialog('bookmark');
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      handleOk();
    }
  }

  const footer = (
    <div class="bookmark-dialog-footer">
      <button class="primary" onClick={handleOk}>{tCommon('ok')}</button>
      <button onClick={cancel}>{tCommon('cancel')}</button>
    </div>
  );

  return (
    <Dialog
      title={headerText()}
      overlayClass="bookmark-dialog-overlay"
      dialogClass="bookmark-dialog"
      headerClass="bookmark-dialog-header"
      bodyClass="bookmark-dialog-body"
      footerClass=""
      onClose={cancel}
      footer={footer}
    >
      <label>{t('bookmark.titleLabel')}</label>
      <input
        ref={titleInputRef}
        type="text"
        placeholder={t('bookmark.titlePlaceholder')}
        value={title()}
        onInput={(e) => setTitle(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <Show when={doelen().length > 0}>
        <label>{t('bookmark.destinationLabel')}</label>
        <select
          class="bookmark-dialog-dest"
          aria-label={t('bookmark.destinationLabel')}
          value={doel() || ''}
          onChange={(e) => kiesDoel(e.target.value)}
        >
          <For each={doelen()}>
            {(d) => <option value={d.id} selected={doel() === d.id}>{doelLabel(d.id)}</option>}
          </For>
        </select>
      </Show>
      <label>{t('bookmark.pageLabel')}</label>
      <input
        type="text" inputmode="decimal" data-getal
        min="1"
        value={page()}
        onInput={(e) => typPagina(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <label>{t('bookmark.colorLabel')}</label>
      <div class="bookmark-dialog-colors" role="radiogroup" aria-label={t('bookmark.colorLabel')}>
        <button
          type="button"
          class="bookmark-swatch bookmark-swatch-default"
          classList={{ selected: !kleur() }}
          title={tContext('bookmark.colorDefault')}
          aria-label={tContext('bookmark.colorDefault')}
          aria-checked={!kleur()}
          role="radio"
          onClick={() => setKleur(null)}
        />
        <For each={BLADWIJZER_KLEUREN}>
          {(k) => (
            <button
              type="button"
              class="bookmark-swatch"
              classList={{ selected: kleur() === k.hex }}
              style={{ background: k.hex }}
              title={tContext(kleurLabelSleutel(k.sleutel))}
              aria-label={tContext(kleurLabelSleutel(k.sleutel))}
              aria-checked={kleur() === k.hex}
              role="radio"
              onClick={() => setKleur(k.hex)}
            />
          )}
        </For>
        <input
          type="color"
          class="bookmark-swatch-custom"
          classList={{ selected: !!kleur() && !BLADWIJZER_KLEUREN.some(k => k.hex === kleur()) }}
          title={tContext('bookmark.colorCustom')}
          aria-label={tContext('bookmark.colorCustom')}
          value={kleur() || '#000000'}
          onInput={(e) => setKleur(normaliseerKleur(e.target.value))}
        />
      </div>
      <label>{t('bookmark.styleLabel')}</label>
      <div class="bookmark-dialog-style">
        <label class="bookmark-dialog-check">
          <input type="checkbox" checked={vet()} onChange={(e) => setVet(e.target.checked)} />
          <span style={{ 'font-weight': 700 }}>{tContext('bookmark.bold')}</span>
        </label>
        <label class="bookmark-dialog-check">
          <input type="checkbox" checked={cursief()} onChange={(e) => setCursief(e.target.checked)} />
          <span style={{ 'font-style': 'italic' }}>{tContext('bookmark.italic')}</span>
        </label>
      </div>
    </Dialog>
  );
}
