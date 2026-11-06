import { createSignal, For, onCleanup, onMount } from 'solid-js';
import * as pdfjsLib from 'pdfjs-dist';
import Dialog from '../Dialog.jsx';
import { closeDialog, showMessage } from '../../stores/dialogStore.js';
import { bereikTekst, leesBereik } from '../../../pdf/bron-paginas-kiezen.js';
import { pdfjsBronnen } from '../../../core/basis-url.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

// Welke pagina's van een bron-PDF erin komen (#963), bij Invoegen uit bestand
// en Pagina's vervangen. Een paginabereik ("1-3, 5") en een miniatuur met
// vinkje per pagina, die met elkaar meelopen.
// Ook bij Samenvoegen, per bestand (doel 'merge', met de eerdere keuze in gekozen).
// data: { bytes, naam, aantal, doel: 'insert'|'replace'|'merge', gekozen?: number[], onDone(pagina's|null) }
export default function ChoosePagesDialog(props) {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');
  const aantal = Math.max(1, props.data?.aantal || 1);
  const alle = Array.from({ length: aantal }, (_, i) => i + 1);

  const begin = Array.isArray(props.data?.gekozen) && props.data.gekozen.length
    ? alle.filter((p) => props.data.gekozen.includes(p)) : alle;
  const [gekozen, setGekozen] = createSignal(new Set(begin));
  const [bereik, setBereik] = createSignal(bereikTekst(begin));
  const [bereikFout, setBereikFout] = createSignal(false);
  const doeken = [];
  let pdf = null;
  let gestopt = false;
  let klaar = false;

  const lijst = () => alle.filter((p) => gekozen().has(p));
  const zet = (paginas) => {
    setGekozen(new Set(paginas));
    setBereik(bereikTekst(paginas));
    setBereikFout(false);
  };
  const wissel = (p) => {
    const s = new Set(gekozen());
    if (s.has(p)) s.delete(p); else s.add(p);
    zet(alle.filter((x) => s.has(x)));
  };
  const typ = (tekst) => {
    setBereik(tekst);
    const paginas = leesBereik(tekst, aantal);
    setBereikFout(paginas === null);
    if (paginas) setGekozen(new Set(paginas));
  };

  const sluit = (paginas) => {
    if (klaar) return;
    klaar = true;
    closeDialog('choose-pages');
    props.data?.onDone?.(paginas);
  };
  const ok = () => {
    if (bereikFout() || !lijst().length) { showMessage(tCommon('invalidPageRange')); return; }
    sluit(lijst());
  };

  // Miniaturen, één pagina tegelijk: bij een grote set staan de eerste snel.
  onMount(async () => {
    try {
      pdf = await pdfjsLib.getDocument({
        data: props.data.bytes.slice(), ...pdfjsBronnen(), isEvalSupported: false, verbosity: 0,
      }).promise;
      const dpr = window.devicePixelRatio || 1;
      for (let p = 1; p <= aantal && !gestopt; p++) {
        const doek = doeken[p];
        if (!doek) continue;
        const pagina = await pdf.getPage(p);
        if (gestopt) break;
        const basis = pagina.getViewport({ scale: 1 });
        const schaal = Math.min(110 / basis.width, 110 / basis.height);
        const vp = pagina.getViewport({ scale: schaal * dpr });
        doek.width = Math.ceil(vp.width);
        doek.height = Math.ceil(vp.height);
        doek.style.width = `${Math.ceil(vp.width / dpr)}px`;
        doek.style.height = `${Math.ceil(vp.height / dpr)}px`;
        await pagina.render({ canvasContext: doek.getContext('2d'), viewport: vp }).promise;
      }
    } catch (e) {
      console.warn('[choose-pages] thumbnails not drawn:', e?.message || e);
    }
  });
  onCleanup(() => {
    gestopt = true;
    pdf?.destroy?.();
    // Op een andere manier gesloten: geldt als annuleren.
    if (!klaar) { klaar = true; props.data?.onDone?.(null); }
  });

  const footer = (
    <>
      <div class="choose-pages-footer-left">
        <button class="pref-btn pref-btn-secondary" onClick={() => zet(alle)}>{t('choosePages.all')}</button>
        <button class="pref-btn pref-btn-secondary" onClick={() => zet([])}>{t('choosePages.none')}</button>
      </div>
      <div class="extract-pages-footer-right">
        <button class="pref-btn pref-btn-primary" disabled={!lijst().length || bereikFout()} onClick={ok}>
          {props.data?.doel === 'replace' ? t('choosePages.replace')
            : props.data?.doel === 'merge' ? t('choosePages.use') : t('choosePages.insert')}
        </button>
        <button class="pref-btn pref-btn-secondary" onClick={() => sluit(null)}>{tCommon('cancel')}</button>
      </div>
    </>
  );

  return (
    <Dialog
      title={t('choosePages.title')}
      overlayClass="extract-pages-overlay"
      dialogClass="choose-pages-dialog"
      headerClass="extract-pages-header"
      bodyClass="extract-pages-content"
      footerClass="extract-pages-footer"
      onClose={() => sluit(null)}
      footer={footer}
    >
      <div class="extract-pages-form">
        <div class="extract-pages-row extract-pages-info">
          {t('choosePages.from', { name: props.data?.naam || '', count: aantal })}
        </div>
        <div class="extract-pages-row">
          <label class="extract-pages-label">{t('extractPages.pageRange')}</label>
          <input
            type="text"
            class="extract-pages-input-wide"
            classList={{ 'choose-pages-fout': bereikFout() }}
            placeholder={t('extractPages.placeholder')}
            value={bereik()}
            onInput={(e) => typ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } }}
          />
        </div>
        <div class="choose-pages-grid">
          <For each={alle}>
            {(p) => (
              <label class="choose-pages-item" classList={{ 'is-gekozen': gekozen().has(p) }}>
                <canvas ref={(el) => { doeken[p] = el; }} class="choose-pages-thumb" />
                <span class="choose-pages-num">
                  <input type="checkbox" checked={gekozen().has(p)} onChange={() => wissel(p)} /> {p}
                </span>
              </label>
            )}
          </For>
        </div>
        <div class="extract-pages-row extract-pages-info">
          {t('choosePages.selected', { count: lijst().length, total: aantal })}
        </div>
      </div>
    </Dialog>
  );
}
