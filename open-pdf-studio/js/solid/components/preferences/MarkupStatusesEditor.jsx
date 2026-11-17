import { For, Show, createSignal } from 'solid-js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import PrefColorPicker from './PrefColorPicker.jsx';
import { showMessage } from '../../stores/dialogStore.js';
import {
  STANDAARD_EIGEN_KLEUR, STATUS_SET_EXTENSIE, normaliseerEigenStatussen, statusSetsVan, geldigeSetNaam,
  verplaats, vrijeNaam, exporteerStatusSet, importeerStatusSet, voegSetIn,
} from '../../../review/status-sets.js';

// Statussets van markeringen (#1076): sets met een naam, per status een naam,
// een kleur en of het punt daarmee klaar is. Eén set is actief; die staat in
// het statusmenu. Een set is als bestand te delen met het team. De regels
// staan in review/status-sets.js; dit venster bewaart ook een lege of dubbele
// naam, maar status-sets.js laat hem weg (rode rand).
//
// props.sets / props.active / props.legacy: de voorkeursignalen
// markupStatusSets, activeMarkupStatusSet en de oude platte markupStatuses.
export default function MarkupStatusesEditor(props) {
  const { t } = useTranslation('preferences');
  const [sets, setSets] = props.sets;
  const [actief, setActief] = props.active;
  const [oud, setOud] = props.legacy;

  // De oude platte lijst wordt bij de eerste wijziging een set.
  const heeftSets = () => Array.isArray(sets()) && sets().length > 0;
  const beginstand = () => statusSetsVan({ markupStatusSets: sets(), activeMarkupStatusSet: actief(), markupStatuses: oud() });
  const rijSets = () => (heeftSets() ? sets() : beginstand().sets);
  const actieveNaam = () => (heeftSets() ? actief() : beginstand().actief);
  const [gekozen, setGekozen] = createSignal(Math.max(0, rijSets().findIndex((s) => s.name === actieveNaam())));
  const index = () => Math.max(0, Math.min(gekozen(), rijSets().length - 1));
  const set = () => rijSets()[index()] || null;
  const rijen = () => (Array.isArray(set()?.statuses) ? set().statuses : []);

  const bewaar = (nieuweSets, nieuwActief = actieveNaam()) => {
    setSets(nieuweSets);
    setActief(nieuwActief);
    if (Array.isArray(oud()) && oud().length > 0) setOud([]);
  };
  const wijzigSet = (patch) => bewaar(rijSets().map((s, i) => (i === index() ? { ...s, ...patch } : s)));
  const wijzigRijen = (statuses) => wijzigSet({ statuses });

  const naamGeldig = (naam, i) => geldigeSetNaam(naam)
    && !rijSets().some((s, j) => j !== i && String(s.name).trim().toLowerCase() === String(naam).trim().toLowerCase());
  const geldigeStatussen = () => new Set(normaliseerEigenStatussen(rijen()).map((s) => s.name.toLowerCase()));
  const statusOngeldig = (naam) => !!String(naam || '').trim()
    && !geldigeStatussen().has(String(naam).trim().replace(/\s+/g, ' ').toLowerCase());

  const hernoem = (naam) => {
    const was = set()?.name;
    const wasActief = !!was && was === actieveNaam();
    // De actieve set blijft actief onder haar nieuwe naam.
    bewaar(rijSets().map((s, i) => (i === index() ? { ...s, name: naam } : s)), wasActief ? naam : actieveNaam());
  };
  const nieuweSet = () => {
    const naam = vrijeNaam(t('annotations.markupStatusSetDefaultName'), rijSets().map((s) => s.name));
    const lijst = [...rijSets(), { name: naam, statuses: [] }];
    bewaar(lijst, actieveNaam() || naam);
    setGekozen(lijst.length - 1);
  };
  const verwijderSet = () => {
    const weg = set();
    if (!weg) return;
    const i = index();
    bewaar(rijSets().filter((_, j) => j !== i), weg.name === actieveNaam() ? '' : actieveNaam());
    setGekozen(Math.max(0, i - 1));
  };

  const wijzig = (i, veld, waarde) => wijzigRijen(rijen().map((r, j) => (j === i ? { ...r, [veld]: waarde } : r)));
  const voegToe = () => wijzigRijen([...rijen(), { name: '', color: STANDAARD_EIGEN_KLEUR, closed: false }]);
  const verwijder = (i) => wijzigRijen(rijen().filter((_, j) => j !== i));
  const schuif = (i, stap) => wijzigRijen(verplaats(rijen(), i, stap));

  const titel = () => t('annotations.markupStatuses');
  const kanExporteren = () => !!set() && normaliseerEigenStatussen(rijen()).length > 0 && naamGeldig(set().name, index());

  async function exporteer() {
    try {
      const tekst = exporteerStatusSet(set());
      const { saveFileDialog, writeBinaryFile } = await import('../../../core/platform.js');
      const naam = `${set().name.trim().replace(/[\\/:*?"<>|]/g, '_')}.${STATUS_SET_EXTENSIE}`;
      const pad = await saveFileDialog(naam, [{ name: titel(), extensions: [STATUS_SET_EXTENSIE] }]);
      if (!pad) return;
      await writeBinaryFile(pad, new TextEncoder().encode(tekst));
    } catch (e) {
      showMessage(t('annotations.markupStatusSetExportFailed', { error: e?.message || String(e) }), titel());
    }
  }

  async function importeer() {
    try {
      const { openFileDialog, readBinaryFile } = await import('../../../core/platform.js');
      const pad = await openFileDialog([STATUS_SET_EXTENSIE, 'json']);
      if (!pad || typeof pad !== 'string') return;
      const uitkomst = importeerStatusSet(new TextDecoder('utf-8').decode(await readBinaryFile(pad)));
      if (uitkomst.fout) {
        showMessage(t(uitkomst.fout === 'version' ? 'annotations.markupStatusSetImportNewer' : 'annotations.markupStatusSetImportFailed'), titel());
        return;
      }
      const { sets: lijst, vervangen } = voegSetIn(rijSets(), uitkomst.set);
      bewaar(lijst, actieveNaam() || uitkomst.set.name);
      setGekozen(lijst.findIndex((s) => s.name.toLowerCase() === uitkomst.set.name.toLowerCase()));
      showMessage(t(vervangen ? 'annotations.markupStatusSetReplaced' : 'annotations.markupStatusSetImported', { name: uitkomst.set.name }), titel());
    } catch (e) {
      showMessage(t('annotations.markupStatusSetImportFailed'), titel());
    }
  }

  return (
    <div class="markup-statuses-editor">
      <div class="pref-row">
        <label>{t('annotations.markupStatusSetActive')}</label>
        <select class="markup-status-set-select" value={actieveNaam()} onChange={(e) => bewaar(rijSets(), e.target.value)}>
          <option value="" selected={!actieveNaam()}>{t('annotations.markupStatusSetNone')}</option>
          <For each={rijSets()}>
            {(s) => <option value={s.name} selected={s.name === actieveNaam()}>{s.name}</option>}
          </For>
        </select>
      </div>
      <div class="pref-row markup-status-set-row">
        <label>{t('annotations.markupStatusSetEdit')}</label>
        <select class="markup-status-set-select" value={String(index())} disabled={rijSets().length === 0}
          onChange={(e) => setGekozen(Number(e.target.value))}>
          <For each={rijSets()}>
            {(s, i) => <option value={String(i())} selected={i() === index()}>{s.name}</option>}
          </For>
        </select>
      </div>
      <div class="pref-row markup-status-set-row">
        <button type="button" class="pref-btn" onClick={nieuweSet}>{t('annotations.markupStatusSetNew')}</button>
        <button type="button" class="pref-btn" disabled={!set()} onClick={verwijderSet}>{t('annotations.markupStatusSetRemove')}</button>
        <button type="button" class="pref-btn" onClick={importeer}>{t('annotations.markupStatusSetImport')}</button>
        <button type="button" class="pref-btn" disabled={!kanExporteren()} onClick={exporteer}>{t('annotations.markupStatusSetExport')}</button>
      </div>
      <Show when={set()}>
        <div class="pref-row">
          <label>{t('annotations.markupStatusSetName')}</label>
          <input type="text" class="markup-status-set-name" maxLength={40} value={set().name || ''}
            classList={{ invalid: !naamGeldig(set().name, index()) }}
            onChange={(e) => hernoem(e.target.value)} />
        </div>
        <For each={rijen()}>
          {(rij, i) => (
            <div class="pref-row markup-status-row">
              <button type="button" class="pref-btn markup-status-move" disabled={i() === 0}
                title={t('annotations.markupStatusMoveUp')} aria-label={t('annotations.markupStatusMoveUp')}
                onClick={() => schuif(i(), -1)}>{'▲'}</button>
              <button type="button" class="pref-btn markup-status-move" disabled={i() === rijen().length - 1}
                title={t('annotations.markupStatusMoveDown')} aria-label={t('annotations.markupStatusMoveDown')}
                onClick={() => schuif(i(), 1)}>{'▼'}</button>
              <input type="text" class="markup-status-name" maxLength={40}
                value={rij.name || ''} placeholder={t('annotations.markupStatusName')}
                classList={{ invalid: statusOngeldig(rij.name) }}
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
        <div class="pref-row">
          <button type="button" class="pref-btn" onClick={voegToe}>{t('annotations.markupStatusAdd')}</button>
        </div>
      </Show>
      <Show when={!set()}>
        <div class="pref-row"><span class="pref-hint">{t('annotations.markupStatusesEmpty')}</span></div>
      </Show>
      <div class="pref-row">
        <span class="pref-hint">{t('annotations.markupStatusesHint')}</span>
      </div>
    </div>
  );
}
