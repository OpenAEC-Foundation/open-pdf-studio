import { createSignal, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import PrefSelect from '../preferences/PrefSelect.jsx';
import { closeDialog, openDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { getActiveDocument } from '../../../core/state.js';
import { isTauri } from '../../../core/platform.js';
import { leesGetal } from '../../../core/getal-invoer.js';
import { bewaarLinkKeuze, LINK_DIALOOG } from '../../../annotations/link/link-maken.js';
import {
  normaliseerDoel, linkRand, linkRanddikte, isGebrokenDoel, LINK_STANDAARD_KLEUR, linkGebied,
  linkDoelVanBladwijzer, bladwijzerKeuzes,
} from '../../../annotations/link/link-model.js';
import { boomVolgorde } from '../../../ui/panels/bladwijzer-boom.js';
import { kiesLinkGebied } from '../../../annotations/link/link-gebied.js';

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
  // Terug van "Gebied kiezen" (#1226): de keuzes van vóór het kiezen, met het
  // gekozen gebied als doel.
  const terug = data.terug || null;
  const doel = terug?.doel || bestaand?.linkTarget || null;
  const opBureaublad = isTauri();

  const [soort, setSoort] = createSignal(doel?.kind || 'uri');
  const [uri, setUri] = createSignal(doel?.kind === 'uri' ? doel.uri : '');
  // Een gebroken paginadoel (doelpagina verwijderd) heeft geen nummer: het
  // veld begint leeg, zodat OK pas na een nieuwe pagina iets bewaart.
  const gebroken = isGebrokenDoel(doel);
  const [pagina, setPagina] = createSignal(gebroken ? ''
    : String(doel?.kind === 'page' ? doel.page : Math.min(aantal, (doc?.currentPage || 1))));
  const [weergave, setWeergave] = createSignal(doel?.kind === 'page' && (doel.fit === 'fit' || doel.fit === 'rect') ? doel.fit : 'xyz');
  // Benoemde plekken (#1226): de bladwijzers van het document.
  const bladwijzers = doc?.bookmarks || [];
  const plekken = bladwijzerKeuzes(bladwijzers, boomVolgorde(bladwijzers));
  const [plek, setPlek] = createSignal(plekken[0]?.id || '');
  // Het gekozen gebied op de doelpagina (#1226), in PDF-eenheden.
  const [gebied, setGebied] = createSignal(doel?.kind === 'page' && doel.fit === 'rect' ? linkGebied(doel) : null);
  const [bestand, setBestand] = createSignal(doel?.kind === 'file' ? doel.file : '');
  const [rand, setRand] = createSignal(terug?.rand ?? (bestaand ? linkRand(bestaand) : 'none'));
  const [kleur, setKleur] = createSignal(terug?.kleur ?? (bestaand?.color || LINK_STANDAARD_KLEUR));
  const [dikte, setDikte] = createSignal(terug?.dikte ?? String(bestaand ? linkRanddikte(bestaand) : 1));
  const [fout, setFout] = createSignal('');

  const sluit = () => closeDialog(LINK_DIALOOG);

  // Een bestaand paginadoel houdt zijn eigen positie zolang pagina en
  // weergave niet veranderen.
  function gekozenDoel() {
    if (soort() === 'uri') return { kind: 'uri', uri: uri() };
    if (soort() === 'file') return { kind: 'file', file: bestand() };
    // Een bladwijzer: zijn bestemming zoals die nu is.
    if (weergave() === 'bookmark') return linkDoelVanBladwijzer(bladwijzers.find((b) => b.id === plek()), aantal);
    const page = Number(pagina());
    if (weergave() === 'rect') return { kind: 'page', page, fit: 'rect', ...(gebied() || {}) };
    const zelfde = doel?.kind === 'page' && doel.fit !== 'rect' && doel.page === page && (doel.fit === 'fit') === (weergave() === 'fit');
    return zelfde ? { ...doel } : { kind: 'page', page, fit: weergave() };
  }

  // Gebied kiezen (#1226): het venster gaat even dicht, de gebruiker bladert
  // naar de doelpagina en sleept een vak, en het venster komt terug met dat
  // gebied. Afbreken (Esc) brengt het venster terug zoals het was.
  async function kiesGebied() {
    const stand = { rand: rand(), kleur: kleur(), dikte: dikte() };
    const vorig = gekozenDoel();
    sluit();
    const gekozen = await kiesLinkGebied(t('link.pickAreaHint'));
    const nieuwDoel = gekozen
      ? { kind: 'page', page: gekozen.page, fit: 'rect', ...gekozen.gebied }
      : vorig;
    openDialog(LINK_DIALOOG, { ...data, terug: { ...stand, doel: nieuwDoel } });
  }

  function bevestig() {
    const kandidaat = gekozenDoel();
    if (soort() === 'page' && weergave() === 'rect' && !gebied()) {
      setFout(t('link.areaMissing'));
      return;
    }
    if (soort() === 'page' && weergave() === 'bookmark' && !kandidaat) {
      setFout(t('link.bookmarkMissing'));
      return;
    }
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
                value={pagina()} disabled={weergave() === 'bookmark'} onInput={(e) => { setPagina(e.currentTarget.value); setFout(''); }} />
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
                  { value: 'rect', label: t('link.viewArea') },
                  { value: 'bookmark', label: t('link.viewBookmark') },
                ]} />
            </div>
            <Show when={weergave() === 'bookmark'}>
              <div class="link-dialog-row link-dialog-indent">
                <Show when={plekken.length > 0} fallback={<span class="link-dialog-note" id="link-dialog-no-bookmarks">{t('link.noBookmarks')}</span>}>
                  <label>{t('link.bookmark')}</label>
                  <PrefSelect id="link-dialog-bookmark" value={plek} setValue={setPlek} style={{ flex: '1' }}
                    options={plekken.map((p) => ({ value: p.id, label: p.label }))} />
                </Show>
              </div>
            </Show>
            <Show when={weergave() === 'rect'}>
              <div class="link-dialog-row link-dialog-indent">
                <button class="pref-btn pref-btn-secondary" id="link-dialog-pick-area" onClick={kiesGebied}>{t('link.pickArea')}</button>
                <span class="link-dialog-note" id="link-dialog-area-note">
                  {gebied() ? t('link.areaChosen', { page: pagina() }) : t('link.areaNone')}
                </span>
              </div>
            </Show>
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
