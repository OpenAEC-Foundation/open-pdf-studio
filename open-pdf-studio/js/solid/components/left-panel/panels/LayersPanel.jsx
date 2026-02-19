import { For, Show } from 'solid-js';
import { activeTab } from '../../../stores/leftPanelStore.js';
import { items, countText, emptyMessage } from '../../../stores/panels/layersStore.js';

export default function LayersPanel() {
  return (
    <div class={`left-panel-content${activeTab() === 'layers' ? ' active' : ''}`} id="layers-panel">
      <div class="left-panel-header">
        <span>Layers</span>
      </div>
      <div class="layers-container">
        <Show when={emptyMessage()}>
          <div class="layers-empty">{emptyMessage()}</div>
        </Show>
        <Show when={!emptyMessage()}>
          <For each={items()}>
            {(layer) => (
              <div class="layer-list-item">
                <input
                  type="checkbox"
                  checked={layer.visible}
                  onChange={(e) => {
                    import('../../../../ui/panels/layers.js').then(m => m.toggleLayerVisibility(layer.id, e.target.checked));
                  }}
                />
                <span class="layer-list-name">{layer.name}</span>
              </div>
            )}
          </For>
        </Show>
      </div>
      <div class="layers-count">{countText()}</div>
    </div>
  );
}
