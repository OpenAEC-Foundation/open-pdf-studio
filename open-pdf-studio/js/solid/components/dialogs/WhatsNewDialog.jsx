import { createSignal, createMemo, For, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { useTranslation } from '../../../i18n/useTranslation.js';
import {
  getReleases, getActiveLang, setActiveLang,
  isLoading, getError, closeWhatsNew
} from '../../stores/whatsNewStore.js';
import { parseBilingualBody, renderMarkdown } from '../../../help/release-notes.js';
import { state } from '../../../core/state.js';
import { savePreferences } from '../../../core/preferences.js';
import { getAppVersion, isTauri } from '../../../core/platform.js';
import { isGehost } from '../../../core/gehost.js';
import { openExtern } from '../../../core/extern-openen.js';
import { openDialog } from '../../stores/dialogStore.js';
import { neemInReleasenotes, feedbackVoorinvulling } from '../../../help/virusscanner-melding.js';

// Als gast opent een link in de release-notes geen tabblad (#695): het adres
// komt in een melding. Elders gedraagt de link zich zoals altijd.
function vangLinkAlsGast(e) {
  if (!isGehost()) return;
  const a = e.target?.closest?.('a[href]');
  if (!a) return;
  e.preventDefault();
  openExtern(a.href);
}

export default function WhatsNewDialog() {
  const { t } = useTranslation('appMenu');
  const { t: tDialogs } = useTranslation('dialogs');
  // Uitleg over een waarschuwing van een virusscanner (#761): één keer, de
  // eerste keer dat dit venster opent (help/virusscanner-melding.js).
  const virusUitleg = neemInReleasenotes({ inTauri: isTauri() });
  const [dontShow, setDontShow] = createSignal(true);

  const parsed = createMemo(() => {
    return getReleases().map(r => ({
      ...r,
      sections: parseBilingualBody(r.bodyMarkdown)
    }));
  });

  // Taal-tabs alleen tonen als minstens één release daadwerkelijk een
  // Nederlandse sectie heeft — anders tonen beide tabs dezelfde Engelse
  // tekst en lijkt de vertaling "kapot" (#240).
  const hasAnyDutch = createMemo(() => parsed().some(r => !!r.sections.nl));

  const close = async () => {
    if (dontShow()) {
      try {
        const v = await getAppVersion();
        if (v) {
          state.preferences.lastSeenReleaseVersion = v;
          savePreferences();
        }
      } catch {
        /* ignore */
      }
    }
    closeWhatsNew();
  };

  // Het feedbackvenster opent met het onderwerp en de gevraagde gegevens al
  // ingevuld; dit venster maakt er plaats voor.
  const meldWaarschuwing = async () => {
    await close();
    openDialog('feedback', feedbackVoorinvulling(tDialogs));
  };

  const langTab = (lang, label) => (
    <button
      type="button"
      class={`wn-tab ${getActiveLang() === lang ? 'active' : ''}`}
      onClick={() => setActiveLang(lang)}
    >
      {label}
    </button>
  );

  const footer = (
    <>
      <label class="wn-dont-show">
        <input
          type="checkbox"
          checked={dontShow()}
          onChange={(e) => setDontShow(e.currentTarget.checked)}
        />
        {t('whatsNew.dontShowAgain')}
      </label>
      <button type="button" class="wn-close-btn" onClick={close}>
        {t('whatsNew.close')}
      </button>
    </>
  );

  return (
    <Dialog
      title={t('whatsNew.title')}
      dialogClass="whats-new-dialog"
      onClose={close}
      footer={footer}
      footerClass="whats-new-footer"
      bodyClass="whats-new-body"
    >
      <Show when={hasAnyDutch()}>
        <div class="wn-tabs">
          {langTab('nl', t('whatsNew.tabNl'))}
          {langTab('en', t('whatsNew.tabEn'))}
        </div>
      </Show>
      <div class="wn-content">
        <Show when={virusUitleg}>
          <section class="wn-virus-notice" id="wn-virus-notice">
            <h3>{tDialogs('virusNotice.title')}</h3>
            <p>{tDialogs('virusNotice.intro')}</p>
            <p>{tDialogs('virusNotice.signed')}</p>
            <p>{tDialogs('virusNotice.action')}</p>
            <p>{tDialogs('virusNotice.include')}</p>
            <button type="button" id="wn-virus-report" class="pref-btn pref-btn-secondary" onClick={meldWaarschuwing}>{tDialogs('virusNotice.report')}</button>
          </section>
        </Show>
        <Show when={isLoading()}>
          <p class="wn-loading">{t('whatsNew.loading')}</p>
        </Show>
        <Show when={!isLoading() && getError()}>
          <p class="wn-error">{t('whatsNew.error')}</p>
        </Show>
        <Show when={!isLoading() && !getError() && parsed().length === 0}>
          <p class="wn-empty">{t('whatsNew.empty')}</p>
        </Show>
        {/* Geen enkele release heeft NL (tabs verborgen) terwijl de app-taal
            NL is: één melding bovenaan in plaats van eentje per release. */}
        <Show when={!isLoading() && !getError() && parsed().length > 0 && !hasAnyDutch() && getActiveLang() === 'nl'}>
          <p class="wn-lang-fallback">{t('whatsNew.noDutchFallback')}</p>
        </Show>
        <For each={parsed()}>
          {(rel) => {
            const lang = () => getActiveLang();
            const body = () => {
              const s = rel.sections;
              if (lang() === 'nl') return s.nl || s.en || '';
              return s.en || s.nl || '';
            };
            const date = () => {
              try { return new Date(rel.publishedAt).toLocaleDateString(); }
              catch { return ''; }
            };
            // NL-tab actief maar deze release heeft geen Nederlandse
            // sectie -> Engelse fallback tonen mét melding. Alleen in de
            // gemengde situatie (tabs zichtbaar); anders staat er al één
            // melding bovenaan de lijst.
            const showsEnFallback = () => hasAnyDutch() && lang() === 'nl' && !rel.sections.nl && !!rel.sections.en;
            return (
              <article class="wn-release">
                <header class="wn-release-header">
                  <span class="wn-release-tag">{rel.tag}</span>
                  <span class="wn-release-date">{date()}</span>
                </header>
                <Show when={showsEnFallback()}>
                  <p class="wn-lang-fallback">{t('whatsNew.noDutchFallback')}</p>
                </Show>
                <div class="wn-release-body" innerHTML={renderMarkdown(body())} onClick={vangLinkAlsGast} />
              </article>
            );
          }}
        </For>
      </div>
    </Dialog>
  );
}
