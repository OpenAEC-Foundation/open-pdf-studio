// Een melding met eigen knoppen (#726): na Opslaan als op de site (het nieuwe
// bestand openen of verder met het origineel) en bij een weigering van de
// site (toch downloaden). Zie pdf/host-opslaan-als-ui.js.

import { For } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function HostKeuzeDialog(props) {
  const { t } = useTranslation('common');
  const data = props.data || {};
  const knoppen = Array.isArray(data.knoppen) ? data.knoppen : [];

  const kies = (id) => {
    closeDialog('host-keuze');
    data.resolve?.(id);
  };

  const footer = (
    <div class="message-dialog-footer host-keuze-footer">
      <For each={knoppen}>
        {(k) => (
          <button class={`pref-btn ${k.primair ? 'pref-btn-primary' : 'pref-btn-secondary'}`} onClick={() => kies(k.id ?? null)}>
            {k.label}
          </button>
        )}
      </For>
    </div>
  );

  return (
    <Dialog
      title={data.title || t('appName')}
      overlayClass="message-dialog-overlay"
      dialogClass="message-dialog host-keuze-dialog"
      onClose={() => kies(data.bijSluiten ?? null)}
      footer={footer}
    >
      <div class="message-dialog-body">
        <p>{data.message || ''}</p>
      </div>
    </Dialog>
  );
}
