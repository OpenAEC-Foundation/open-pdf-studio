import { For, Show, createSignal } from 'solid-js';
import { annotProps, getCurrentAnnotation } from '../../stores/propertiesStore.js';
import { getActiveDocument, getAnnotationBounds } from '../../../core/state.js';
import { collectZones, locationFor, zonePolygon } from '../../../annotations/spatial-zones.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import CollapsibleSection from './CollapsibleSection.jsx';

export default function LocationSection() {
  const { t } = useTranslation('properties');
  const [error, setError] = createSignal('');
  // annotProps.id is reactive; currentAnnotation itself is a plain reference.
  const ann = () => {
    void annotProps.id;
    return getCurrentAnnotation();
  };
  const zones = () => collectZones(getActiveDocument()?.annotations);
  const locatie = () => locationFor(ann() || {}, zones(), ann() ? getAnnotationBounds(ann()) : null);
  const edit = async (request) => {
    setError('');
    try {
      // The edit service (undo, redraw) is loaded on the first edit.
      const { updateLocation } = await import('../../../annotations/spatial-zones-service.js');
      updateLocation({ documentId: getActiveDocument()?.id, annotationId: ann()?.id, ...request });
    } catch (e) {
      setError(`${t('location.invalid')} (${e.message})`);
    }
  };
  const pagesLoading = () => (getActiveDocument()?._annotationPagesReady?.size || 0)
    < (getActiveDocument()?.pdfDoc?.numPages || 0);
  const zoneInvalid = () => ann().spatialZone && !zones().find((z) => z.ann.id === ann().id)?.valid;

  return (
    <Show when={ann() && annotProps.id && !annotProps.multiCount && ann().id !== '__tool-defaults__'}>
      <CollapsibleSection title={t('location.title')} name="location">
        <div class="spatial-location">
          <Show when={pagesLoading()}><p>{t('location.loading')}</p></Show>
          <Show when={zoneInvalid()}><p role="alert">{t('location.invalid')}</p></Show>
          <p>{locatie().path || t('location.none')} — {t(`location.${locatie().source}`)}</p>
          <div class="property-group">
            <label>{t('location.override')}</label>
            <input
              type="text"
              value={ann().locationOverride ?? ''}
              disabled={!ann() || ann().locked}
              onChange={(e) => edit({ action: 'override', value: e.currentTarget.value })}
            />
            <button disabled={!ann() || ann().locked} onClick={() => edit({ action: 'automatic' })}>{t('location.automatic')}</button>
          </div>
          <Show when={zonePolygon(ann())}>
            <div class="property-group">
              <label>{t('location.zoneName')}</label>
              <input
                type="text"
                value={ann().spatialZone?.name || ''}
                disabled={!ann() || ann().locked}
                onChange={(e) => edit({
                  action: 'zone', name: e.currentTarget.value, parentId: ann().spatialZone?.parentId || '',
                })}
              />
            </div>
            <Show when={ann().spatialZone}>
              <div class="property-group">
                <label>{t('location.parent')}</label>
                <select
                  value={ann().spatialZone?.parentId || ''}
                  disabled={!ann() || ann().locked}
                  onChange={(e) => edit({ action: 'zone', name: ann().spatialZone.name, parentId: e.currentTarget.value })}
                >
                  <option value="">{t('location.none')}</option>
                  <For each={zones().filter((z) => z.valid && z.ann.id !== ann().id)}>
                    {(z) => <option value={z.zone.id}>{z.path}</option>}
                  </For>
                </select>
                <button disabled={!ann() || ann().locked} onClick={() => edit({ action: 'removeZone' })}>{t('location.removeZone')}</button>
              </div>
            </Show>
          </Show>
          <p>{t('location.rules')}</p>
          <Show when={error()}><p role="alert">{error()}</p></Show>
        </div>
      </CollapsibleSection>
    </Show>
  );
}
