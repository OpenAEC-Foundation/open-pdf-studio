import { For, Show } from 'solid-js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import PrefColorPicker from './PrefColorPicker.jsx';
import { STANDAARD_EIGEN_KLEUR, normaliseerEigenStatussen } from '../../../review/status-sets.js';

// Eigen reviewstatussen van markeringen (#1076): naam, kleur en of het punt
// daarmee klaar is. De lijst staat in de voorkeuren (markupStatuses) en komt
// in het statusmenu, de lijst, het filter en de PDF (review/status-sets.js).
// Een lege of dubbele naam bewaart het venster wel, maar status-sets.js laat
// hem weg; de hint zegt dat.
export default function MarkupStatusesEditor(props) {
  const { t } = useTranslation('preferences');
  const [lijst, setLijst] = props.value;
  const rijen = () => (Array.isArray(lijst()) ? lijst() : []);
  const geldig = () => new Set(normaliseerEigenStatussen(rijen()).map((s) => s.name.toLowerCase()));

  const wijzig = (index, veld, waarde) => {
    setLijst(rijen().map((r, i) => (i === index ? { ...r, [veld]: waarde } : r)));
  };
  const voegToe = () => setLijst([...rijen(), { name: '', color: STANDAARD_EIGEN_KLEUR, closed: false }]);
  const verwijder = (index) => setLijst(rijen().filter((_, i) => i !== index));

  return (
    <div class="markup-statuses-editor">
      <For each={rijen()}>
        {(rij, i) => (
          <div class="pref-row markup-status-row">
            <input type="text" class="markup-status-name" maxLength={40}
              value={rij.name || ''} placeholder={t('annotations.markupStatusName')}
              classList={{ invalid: !!String(rij.name || '').trim() && !geldig().has(String(rij.name).trim().replace(/\s+/g, ' ').toLowerCase()) }}
              onChange={(e) => wijzig(i(), 'name', e.target.value)} />
            <PrefColorPicker value={() => rij.color || STANDAARD_EIGEN_KLEUR} setValue={(kleur) => wijzig(i(), 'color', kleur)} />
            <label class="pref-checkbox-label markup-status-closed" title={t('annotations.markupStatusClosedHint')}>
              <input type="checkbox" checked={rij.closed === true} onChange={(e) => wijzig(i(), 'closed', e.target.checked)} />
              <span>{t('annotations.markupStatusClosed')}</span>
            </label>
            <button type="button" class="pref-btn markup-status-remove" title={t('annotations.markupStatusRemove')}
              aria-label={t('annotations.markupStatusRemove')} onClick={() => verwijder(i())}>×</button>
          </div>
        )}
      </For>
      <Show when={rijen().length === 0}>
        <div class="pref-row"><span class="pref-hint">{t('annotations.markupStatusesEmpty')}</span></div>
      </Show>
      <div class="pref-row">
        <button type="button" class="pref-btn" onClick={voegToe}>{t('annotations.markupStatusAdd')}</button>
      </div>
      <div class="pref-row">
        <span class="pref-hint">{t('annotations.markupStatusesHint')}</span>
      </div>
    </div>
  );
}
