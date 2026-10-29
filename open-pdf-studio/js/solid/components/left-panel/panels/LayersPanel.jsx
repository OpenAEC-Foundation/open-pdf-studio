import { For, Show } from 'solid-js';
import { activeTab } from '../../../stores/leftPanelStore.js';
import {
  items, countText, emptyMessage, canSetDefault, defaultPending,
} from '../../../stores/panels/layersStore.js';
import { useTranslation } from '../../../../i18n/useTranslation.js';

// Inspringing per niveau van de lagenboom, in px.
const INSPRINGING = 14;

export default function LayersPanel() {
  const { t } = useTranslation('properties');

  const wissel = (layer, zichtbaar) => {
    import('../../../../ui/panels/layers.js').then((m) => m.toggleLayer(layer.id, zichtbaar));
  };

  const alsStandaard = () => {
    import('../../../../ui/panels/layers.js').then((m) => m.setLayerStateAsDefault());
  };

  const titel = (layer) => {
    if (layer.locked) return t('leftPanel.layerLocked');
    if (layer.radio) return t('leftPanel.layerRadioGroup');
    return layer.name;
  };

  return (
    <div class={`left-panel-content${activeTab() === 'layers' ? ' active' : ''}`} id="layers-panel">
      <div class="left-panel-header">
        <span>{t('leftPanel.layers')}</span>
      </div>
      <Show when={!emptyMessage()}>
        {/* De huidige stand als standaard van het document bewaren (#377). */}
        <div class="layers-toolbar">
          <button
            class="layers-toolbar-btn"
            title={t('leftPanel.layersSetDefaultTitle')}
            disabled={!canSetDefault() || defaultPending()}
            onClick={alsStandaard}
          >
            {t('leftPanel.layersSetDefault')}
          </button>
          <Show when={defaultPending()}>
            <span class="layers-toolbar-note">{t('leftPanel.layersDefaultPending')}</span>
          </Show>
        </div>
      </Show>
      <div class="layers-container">
        <Show when={emptyMessage()}>
          <div class="layers-empty">{emptyMessage()}</div>
        </Show>
        <Show when={!emptyMessage()}>
          <For each={items()}>
            {(layer) => (
              <div
                class={`layer-list-item${layer.kop ? ' layer-list-kop' : ''}${layer.locked ? ' layer-list-locked' : ''}`}
                style={{ 'margin-left': `${(layer.depth || 0) * INSPRINGING}px` }}
                title={layer.kop ? undefined : titel(layer)}
              >
                <Show when={!layer.kop}>
                  {/* Laag aan/uit in de weergave (#684, zie pdf/lagen-schakelen.js). */}
                  <span class="layer-list-toggle">
                    <input
                      type="checkbox"
                      id={`layer-toggle-${layer.id}`}
                      checked={layer.visible}
                      disabled={!!layer.locked}
                      onChange={(e) => wissel(layer, e.currentTarget.checked)}
                    />
                  </span>
                </Show>
                <Show when={layer.kop} fallback={
                  <label class="layer-list-name" for={`layer-toggle-${layer.id}`}>{layer.name}</label>
                }>
                  <span class="layer-list-name">{layer.name}</span>
                </Show>
                <Show when={layer.locked}>
                  <svg class="layer-list-lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <rect x="5" y="11" width="14" height="10" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
                  </svg>
                </Show>
              </div>
            )}
          </For>
        </Show>
      </div>
      <div class="layers-count">{countText()}</div>
    </div>
  );
}
