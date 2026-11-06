// Werkruimten beheren (#932): de huidige indeling onder een naam bewaren,
// een opgeslagen werkruimte kiezen of verwijderen.

import { createSignal, For, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { state } from '../../../core/state.js';
import { normaliseerWerkruimten, normaliseerNaam, vindWerkruimte, MAX_NAAM_LENGTE, MAX_WERKRUIMTEN } from '../../../core/werkruimte.js';
import {
  bewaarHuidigeWerkruimte, kiesWerkruimte, verwijderOpgeslagenWerkruimte,
} from '../../../ui/panels/werkruimte-toepassen.js';

export default function WorkspaceDialog() {
  const { t } = useTranslation('ribbon');
  const { t: tc } = useTranslation('common');
  const [naam, setNaam] = createSignal(state.preferences.activeWorkspace || '');
  const [melding, setMelding] = createSignal('');

  const lijst = () => normaliseerWerkruimten(state.preferences.workspaces);
  const close = () => closeDialog('workspaces');
  const bestaat = () => !!vindWerkruimte(state.preferences.workspaces, naam());
  const vol = () => !bestaat() && lijst().length >= MAX_WERKRUIMTEN;

  function bewaar() {
    if (!normaliseerNaam(naam()) || vol()) return;
    const bewaard = bewaarHuidigeWerkruimte(naam());
    if (bewaard) {
      setNaam(bewaard);
      setMelding(t('workspace.savedAs', { name: bewaard }));
    }
  }

  return (
    <Dialog title={t('workspace.dialogTitle')} dialogClass="workspace-dialog" onClose={close}
      footer={<button class="pref-btn pref-btn-primary" onClick={close}>{tc('close')}</button>}>
      <div class="workspace-dialog-body">
        <p class="workspace-dialog-intro">{t('workspace.intro')}</p>
        <div class="workspace-dialog-row">
          <label for="workspace-name">{t('workspace.name')}</label>
          <input id="workspace-name" class="workspace-dialog-field" type="text" maxLength={MAX_NAAM_LENGTE}
            value={naam()} onInput={e => { setNaam(e.currentTarget.value); setMelding(''); }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); bewaar(); } }} />
          <button class="pref-btn" id="workspace-save" disabled={!normaliseerNaam(naam()) || vol()} onClick={bewaar}>
            {bestaat() ? t('workspace.overwrite') : t('workspace.save')}
          </button>
        </div>
        <Show when={vol()}><p class="workspace-dialog-note" role="alert">{t('workspace.full', { max: MAX_WERKRUIMTEN })}</p></Show>
        <Show when={melding()}><p class="workspace-dialog-note" role="status">{melding()}</p></Show>
        <div class="workspace-dialog-list" role="list">
          <Show when={lijst().length} fallback={<div class="workspace-dialog-empty">{t('workspace.none')}</div>}>
            <For each={lijst()}>
              {(w) => (
                <div class="workspace-dialog-item" role="listitem">
                  <span class="workspace-dialog-item-name" title={w.naam}>{w.naam}</span>
                  <button class="pref-btn" onClick={() => { kiesWerkruimte(w.naam); setNaam(w.naam); setMelding(''); }}>
                    {t('workspace.apply')}
                  </button>
                  <button class="pref-btn" onClick={() => { verwijderOpgeslagenWerkruimte(w.naam); setMelding(''); }}>
                    {t('workspace.delete')}
                  </button>
                </div>
              )}
            </For>
          </Show>
        </div>
      </div>
    </Dialog>
  );
}
