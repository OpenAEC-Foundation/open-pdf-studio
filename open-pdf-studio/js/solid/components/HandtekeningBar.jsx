import { Show, For } from 'solid-js';
import { toestand, items, foutDetail } from '../stores/handtekeningBarStore.js';
import { state } from '../../core/state.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import {
  ernst, balkErnst, balkRegelDelen, kanOndertekendeVersieTonen, lijstIsAfgekapt, woordenboekNietOndertekend,
  wijktAfVanSchijf,
} from '../../pdf/handtekeningen/weergave.js';

// Balk boven de pagina met per handtekening status, ondertekenaar en tijdstip (spec §3.2).
export default function HandtekeningBar() {
  const { t, language } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');
  const v = (sleutel, opties) => t(`signatureVerification.${sleutel}`, opties);
  // Haakjes, scheidingstekens en komma's volgen de taal.
  const metNoot = (text, note) => v('format.note', { text, note });

  // Gegevens uit een handtekeningwoordenboek buiten het eigen bytebereik zijn
  // niet mee ondertekend; dat staat er dan direct achter.
  const nietOndertekend = (h, tekst) =>
    (woordenboekNietOndertekend(h) ? metNoot(tekst, v('detail.notCoveredBySignature')) : tekst);

  // Status (met "daarna nog gewijzigd") en naam met tijdstip apart: in een
  // smalle balk kort de naam in, de status blijft staan.
  const delen = (h) => balkRegelDelen(h, { v, t, taal: language(), nietOndertekend });

  // De status geldt voor het bestand op schijf; is het document in de app
  // gewijzigd, dan zegt de balk dat erbij.
  const gewijzigdInApp = () => wijktAfVanSchijf(state.documents[state.activeDocumentIndex]);

  const kleur = () => balkErnst(toestand(), items());

  const details = (h) => {
    import('../../pdf/handtekeningen/verificatie.js').then(m => m.openHandtekeningDetails(JSON.parse(JSON.stringify(h))));
  };
  const versie = (h) => {
    import('../../pdf/handtekeningen/verificatie.js').then(m => m.openOndertekendeVersie({ nummer: h.nummer, bereikEinde: h.bereikEinde }));
  };
  const sluit = () => {
    import('../../pdf/handtekeningen/verificatie.js').then(m => m.sluitBalkVoorActiefDocument());
  };

  return (
    <Show when={toestand() !== 'verborgen'}>
      <div class={`handtekening-bar handtekening-bar-${kleur()}`} role="region" aria-label={v('barLabel')}>
        <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M2 12.5c1.5-3 3-4.5 4-4.5 1.2 0 .2 3 1.4 3 .9 0 1.6-1.6 2.6-1.6.8 0 .9 1.1 1.8 1.1.5 0 1.1-.4 2.2-1.3M2 14.5h12" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
        </svg>
        <div class="handtekening-bar-regels" aria-live="polite">
          <Show when={toestand() === 'bezig'}>
            <span class="handtekening-bar-tekst">{v('checking')}</span>
          </Show>
          <Show when={toestand() === 'fout'}>
            <span class="handtekening-bar-tekst">{v('listError', { detail: foutDetail() })}</span>
          </Show>
          <Show when={toestand() === 'klaar'}>
            <For each={items()}>
              {(h) => (
                <div class="handtekening-bar-regel">
                  <span class={`handtekening-bar-stip ${ernst(h)}`} />
                  <span class="handtekening-bar-tekst" title={delen(h).tekst}>
                    <span class="handtekening-bar-status">{delen(h).status}</span>
                    <Show when={delen(h).rest}>
                      <span class="handtekening-bar-naam">{delen(h).scheiding}{delen(h).rest}</span>
                    </Show>
                  </span>
                  <span class="handtekening-bar-acties">
                    <Show when={kanOndertekendeVersieTonen(h)}>
                      <button class="handtekening-bar-actie handtekening-bar-versie" onClick={() => versie(h)}>
                        {v('showSignedVersion')}
                      </button>
                    </Show>
                    <Show when={h.soort !== 'leeg-veld'}>
                      <button class="handtekening-bar-actie handtekening-bar-details" onClick={() => details(h)}>
                        {v('details')}
                      </button>
                    </Show>
                  </span>
                </div>
              )}
            </For>
            <Show when={lijstIsAfgekapt(items())}>
              <div class="handtekening-bar-regel">
                <span class="handtekening-bar-stip waarschuwing" />
                <span class="handtekening-bar-tekst" title={v('listTruncated')}>{v('listTruncated')}</span>
              </div>
            </Show>
          </Show>
          <Show when={toestand() !== 'bezig' && gewijzigdInApp()}>
            <div class="handtekening-bar-regel handtekening-bar-opschijf">
              <span class="handtekening-bar-stip" />
              <span class="handtekening-bar-tekst" title={v('modifiedInApp')}>{v('modifiedInApp')}</span>
            </div>
          </Show>
        </div>
        <button class="handtekening-bar-close" onClick={sluit} title={tCommon('close')} aria-label={tCommon('close')}>&times;</button>
      </div>
    </Show>
  );
}
