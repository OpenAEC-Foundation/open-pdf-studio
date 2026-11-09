import { createSignal, createMemo, For, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { getTypeDisplayName } from '../../../utils/helpers.js';

// Wat een export niet meeneemt (#629), met doorgaan of annuleren. Eén venster
// voor elke exportopdracht (ui/chrome/export-verlies-bevestigen.js); voor XFDF
// ook de keuze van de auteurs. Verplaatsbaar, en een klik ernaast sluit het
// niet (Dialog.jsx).
export default function ExportVerliesDialog(props) {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');
  const data = props.data || {};
  const auteurs = Array.isArray(data.auteurs) ? data.auteurs : [];
  const [gekozen, setGekozen] = createSignal(auteurs.map((a) => a.naam));
  const [nietVragen, setNietVragen] = createSignal(false);
  let beantwoord = false;

  const keuze = () => (auteurs.length ? gekozen() : null);
  const verliezen = createMemo(() => (data.verliezenTonen && typeof data.verliesVoor === 'function'
    ? data.verliesVoor(keuze()) : []));
  const kanDoor = () => !auteurs.length || gekozen().length > 0;

  const soortenTekst = (soorten) => (soorten || [])
    .map((s) => (s.aantal > 1 ? `${getTypeDisplayName(s.type)} (${s.aantal})` : getTypeDisplayName(s.type)))
    .join(', ');
  const regel = (v) => t(`exportLoss.${v.code}`, { count: v.aantal ?? 0, types: soortenTekst(v.soorten) });

  const sluit = (ok) => {
    if (beantwoord) return;
    beantwoord = true;
    closeDialog('export-verlies');
    data.resolve?.({ ok, auteurs: ok ? keuze() : null, nietMeerVragen: ok && data.verliezenTonen && nietVragen() });
  };

  const wissel = (naam, aan) => {
    setGekozen((oud) => (aan ? [...new Set([...oud, naam])] : oud.filter((n) => n !== naam)));
  };

  return (
    <Dialog
      title={t(`exportLoss.title_${data.soort}`)}
      dialogClass="confirm-dialog export-verlies-dialog"
      onClose={() => sluit(false)}
    >
      <Show when={data.verliezenTonen && verliezen().length > 0}>
        <div class="confirm-dialog-body">
          <div class="confirm-dialog-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#e6a700" stroke-width="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13" stroke="#e6a700" stroke-width="2"/>
              <line x1="12" y1="17" x2="12.01" y2="17" stroke="#e6a700" stroke-width="2"/>
            </svg>
          </div>
          <div>
            <p class="confirm-dialog-message">{t('exportLoss.intro')}</p>
            <ul class="export-verlies-lijst">
              <For each={verliezen()}>{(v) => <li>{regel(v)}</li>}</For>
            </ul>
          </div>
        </div>
      </Show>
      <Show when={auteurs.length > 0}>
        <fieldset class="export-verlies-auteurs">
          <legend>{t('exportLoss.authors')}</legend>
          <div class="export-verlies-auteurs-lijst">
            <For each={auteurs}>
              {(a) => (
                <label class="export-verlies-auteur">
                  <input type="checkbox" checked={gekozen().includes(a.naam)}
                    onChange={(e) => wissel(a.naam, e.target.checked)} />
                  <span>{a.naam} ({a.aantal})</span>
                </label>
              )}
            </For>
          </div>
          <div class="export-verlies-auteurs-knoppen">
            <button type="button" class="confirm-dialog-btn" onClick={() => setGekozen(auteurs.map((a) => a.naam))}>{t('exportLoss.allAuthors')}</button>
            <button type="button" class="confirm-dialog-btn" onClick={() => setGekozen([])}>{t('exportLoss.noAuthors')}</button>
          </div>
        </fieldset>
      </Show>
      <Show when={data.verliezenTonen}>
        <label class="export-verlies-niet-vragen">
          <input type="checkbox" checked={nietVragen()} onChange={(e) => setNietVragen(e.target.checked)} />
          <span>{t('exportLoss.dontAskAgain')}</span>
        </label>
      </Show>
      <div class="confirm-dialog-buttons">
        <button type="button" class="confirm-dialog-btn confirm-dialog-btn-yes" disabled={!kanDoor()} onClick={() => sluit(true)}>{t('exportLoss.continue')}</button>
        <button type="button" class="confirm-dialog-btn" onClick={() => sluit(false)}>{tCommon('cancel')}</button>
      </div>
    </Dialog>
  );
}
