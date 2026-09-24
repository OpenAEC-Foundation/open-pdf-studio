import { createSignal, For } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { getActiveDocument } from '../../../core/state.js';
import { layerRows, DEFAULT_LAYER_ID } from '../../../annotations/annotatie-lagen.js';
import { deleteAnnotationLayer } from '../../stores/annotationLayersStore.js';

// Een laag met markeringen verwijderen (#468): eerst vragen wat er met de
// markeringen gebeurt — naar een andere laag, of mee weg. Het basisvenster
// (Dialog) is verplaatsbaar en sluit niet bij een klik ernaast.
export default function AnnotationLayerDeleteDialog(props) {
  const data = props.data || {};
  const { t } = useTranslation('ribbon');
  const [keuze, setKeuze] = createSignal('move');
  const [doel, setDoel] = createSignal(DEFAULT_LAYER_ID);

  const doelen = () => layerRows(getActiveDocument(), t('annotationLayers.defaultName'))
    .filter((r) => r.id !== data.layerId);

  const sluit = () => closeDialog('annotation-layer-delete');
  const bevestig = () => {
    sluit();
    deleteAnnotationLayer(data.layerId, keuze(), doel());
  };

  const footer = (
    <div class="message-dialog-footer">
      <button class="pref-btn pref-btn-primary" onClick={bevestig}>{t('annotationLayers.ok')}</button>
      <button class="pref-btn pref-btn-secondary" onClick={sluit}>{t('annotationLayers.cancel')}</button>
    </div>
  );

  return (
    <Dialog
      title={t('annotationLayers.deleteTitle')}
      dialogClass="annotation-layer-delete-dialog"
      onClose={sluit}
      footer={footer}
    >
      <div class="al-delete-body">
        <p>{t('annotationLayers.deleteMessage', { name: data.name, count: data.count })}</p>
        <label class="al-delete-choice">
          <input type="radio" name="al-delete-choice" checked={keuze() === 'move'}
            onChange={() => setKeuze('move')} />
          <span>{t('annotationLayers.deleteMove')}</span>
        </label>
        <select class="al-delete-target" disabled={keuze() !== 'move'}
          onChange={(e) => setDoel(e.currentTarget.value)}>
          <For each={doelen()}>
            {(r) => <option value={r.id} selected={r.id === doel()}>{r.name}</option>}
          </For>
        </select>
        <label class="al-delete-choice">
          <input type="radio" name="al-delete-choice" checked={keuze() === 'delete'}
            onChange={() => setKeuze('delete')} />
          <span>{t('annotationLayers.deleteRemove')}</span>
        </label>
      </div>
    </Dialog>
  );
}
