import { createSignal, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import PrefSelect from '../preferences/PrefSelect.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { getActiveDocument } from '../../../core/state.js';
import { isTauri } from '../../../core/platform.js';
import { leesGetal } from '../../../core/getal-invoer.js';
import { bewaarLinkKeuze, LINK_DIALOOG } from '../../../annotations/link/link-maken.js';
import {
  normaliseerDoel, linkRand, linkRanddikte, isGebrokenDoel, LINK_STANDAARD_KLEUR,
} from '../../../annotations/link/link-model.js';

// Hyperlink invoegen of bewerken (#953). Het doel: een webadres, een pagina in
// dit document of (alleen op het bureaublad) een bestand; daarnaast de rand.
// Het basisvenster (Dialog) is verplaatsbaar en sluit niet bij een klik
// ernaast. Pas OK zet de link in het document (link-maken.js).
export default function LinkDialog(props) {
  const data = props.data || {};
  const { t } = useTranslation('dialogs');
  const doc = getActiveDocument();
  const bestaand = data.annotationId ? doc?.annotations.find((a) => a.id === data.annotationId) : null;
  const aantal = doc?.pdfDoc?.numPages || 1;
  const doel = bestaand?.linkTarget || null;
  const opBureaublad = isTauri();

  const [soort, setSoort] = createSignal(doel?.kind || 'uri');
  const [uri, setUri] = createSignal(doel?.kind === 'uri' ? doel.uri : '');
  // Een gebroken paginadoel (doelpagina verwijderd) heeft geen nummer: het
  // veld begint leeg, zodat OK pas na een nieuwe pagina iets bewaart.
  const gebroken = isGebrokenDoel(doel);
  const [pagina, setPagina] = createSignal(gebroken ? ''
    : String(doel?.kind === 'page' ? doel.page : Math.min(aantal, (doc?.currentPage || 1))));
  const [weergave, setWeergave] = createSignal(doel?.kind === 'page' && doel.fit === 'fit' ? 'fit' : 'xyz');
  const [bestand, setBestand] = createSignal(doel?.kind === 'file' ? doel.file : '');
  const [rand, setRand] = createSignal(bestaand ? linkRand(bestaand) : 'none');
  const [kleur, setKleur] = createSignal(bestaand?.color || LINK_STANDAARD_KLEUR);
  const [dikte, setDikte] = createSignal(String(bestaand ? linkRanddikte(bestaand) : 1));
  const [fout, setFout] = createSignal('');

  const sluit = () => closeDialog(LINK_DIALOOG);

  // Een bestaand paginadoel houdt zijn eigen positie zolang pagina en
  // weergave niet veranderen.
  function gekozenDoel() {
    if (soort() === 'uri') return { kind: 'uri', uri: uri() };
    if (soort() === 'file') return { kind: 'file', file: bestand() };
    const page = Number(pagina());
    const zelfde = doel?.kind === 'page' && doel.page === page && (doel.fit === 'fit') === (weergave() === 'fit');
    return zelfde ? { ...doel } : { kind: 'page', page, fit: weergave() };
  }

  function bevestig() {
    const kandidaat = gekozenDoel();
    if (!normaliseerDoel(kandidaat, aantal)) {
      setFout(soort() === 'uri' ? t('link.invalidUri')
        : soort() === 'page' ? t('link.invalidPage', { count: aantal }) : t('link.invalidFile'));
      return;
    }
    const ann = bewaarLinkKeuze(data, { doel: kandidaat, rand: rand(), kleur: kleur(), dikte: leesGetal(dikte()) });
    if (ann) sluit();
  }

  async function bladeren() {
    try {
      const gekozen = await window.__TAURI__?.dialog?.open?.({ multiple: false });
      if (typeof gekozen === 'string' && gekozen) setBestand(gekozen);
    } catch (e) {
      console.warn('[link] bestand kiezen mislukt:', e);
    }
  }

  const keuze = (waarde, label, uit = false) => (
    <label class="link-dialog-choice" classList={{ disabled: uit }}>
      <input type="radio" name="link-dialog-target" checked={soort() === waarde} disabled={uit}
        onChange={() => { setSoort(waarde); setFout(''); }} />
      <span>{label}</span>
    </label>
  );

  const footer = (
    <div class="message-dialog-footer">
      <button class="pref-btn pref-btn-primary" id="link-dialog-ok" onClick={bevestig}>{t('link.ok')}</button>
      <button class="pref-btn pref-btn-secondary" onClick={sluit}>{t('link.cancel')}</button>
    </div>
  );

  return (
    <Dialog
      title={bestaand ? t('link.editTitle') : t('link.title')}
      dialogClass="link-dialog"
      onClose={sluit}
      footer={footer}
    >
      <div class="link-dialog-body" onKeyDown={(e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') bevestig(); }}>
        <fieldset class="link-dialog-group">
          <legend>{t('link.target')}</legend>
          {keuze('uri', t('link.targetUri'))}
          <Show when={soort() === 'uri'}>
            <div class="link-dialog-row link-dialog-indent">
              <label for="link-dialog-uri">{t('link.uri')}</label>
              <input id="link-dialog-uri" type="text" class="link-dialog-field" value={uri()}
                placeholder={t('link.uriPlaceholder')} spellcheck={false}
                ref={(el) => setTimeout(() => el?.focus(), 0)}
                onInput={(e) => { setUri(e.currentTarget.value); setFout(''); }} />
            </div>
          </Show>
          {keuze('page', t('link.targetPage'))}
          <Show when={soort() === 'page'}>
            <div class="link-dialog-row link-dialog-indent">
              <label for="link-dialog-page">{t('link.page')}</label>
              <input id="link-dialog-page" type="text" inputmode="numeric" class="link-dialog-field link-dialog-number"
                value={pagina()} onInput={(e) => { setPagina(e.currentTarget.value); setFout(''); }} />
              <span class="link-dialog-note">{t('link.pageOf', { count: aantal })}</span>
            </div>
            <Show when={gebroken}>
              <p class="link-dialog-warning link-dialog-indent">{t('link.brokenPageWarning')}</p>
            </Show>
            <div class="link-dialog-row link-dialog-indent">
              <label>{t('link.view')}</label>
              <PrefSelect value={weergave} setValue={setWeergave} style={{ flex: '1' }}
                options={[
                  { value: 'xyz', label: t('link.viewTop') },
                  { value: 'fit', label: t('link.viewFit') },
                ]} />
            </div>
          </Show>
          {keuze('file', t('link.targetFile'), !opBureaublad)}
          <Show when={soort() === 'file'}>
            <div class="link-dialog-row link-dialog-indent">
              <label for="link-dialog-file">{t('link.file')}</label>
              <input id="link-dialog-file" type="text" class="link-dialog-field" value={bestand()} spellcheck={false}
                onInput={(e) => { setBestand(e.currentTarget.value); setFout(''); }} />
              <Show when={opBureaublad}>
                <button class="pref-btn pref-btn-secondary" onClick={bladeren}>{t('link.browse')}</button>
              </Show>
            </div>
            <p class="link-dialog-warning link-dialog-indent">{t('link.fileWarning')}</p>
          </Show>
        </fieldset>

        <fieldset class="link-dialog-group">
          <legend>{t('link.look')}</legend>
          <div class="link-dialog-row">
            <label>{t('link.border')}</label>
            <PrefSelect value={rand} setValue={setRand} style={{ flex: '1' }}
              options={[
                { value: 'none', label: t('link.borderNone') },
                { value: 'solid', label: t('link.borderSolid') },
                { value: 'underline', label: t('link.borderUnderline') },
              ]} />
          </div>
          <div class="link-dialog-row">
            <label for="link-dialog-color">{t('link.color')}</label>
            <input id="link-dialog-color" type="color" value={kleur()} disabled={rand() === 'none'}
              onInput={(e) => setKleur(e.currentTarget.value)} />
            <label for="link-dialog-width">{t('link.width')}</label>
            <input id="link-dialog-width" type="text" inputmode="decimal" data-getal
              class="link-dialog-field link-dialog-number" value={dikte()} disabled={rand() === 'none'}
              onInput={(e) => setDikte(e.currentTarget.value)} />
          </div>
        </fieldset>

        <Show when={fout()}>
          <p class="link-dialog-error" role="alert">{fout()}</p>
        </Show>
      </div>
    </Dialog>
  );
}
