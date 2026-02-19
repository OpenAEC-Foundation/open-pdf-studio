import { For, Show } from 'solid-js';
import { activeTab } from '../../../stores/leftPanelStore.js';
import { items, countText, emptyMessage } from '../../../stores/panels/destinationsStore.js';

export default function DestinationsPanel() {
  return (
    <div class={`left-panel-content${activeTab() === 'destinations' ? ' active' : ''}`} id="destinations-panel">
      <div class="left-panel-header">
        <span>Destinations</span>
      </div>
      <div class="destinations-container">
        <Show when={emptyMessage()}>
          <div class="destinations-empty">{emptyMessage()}</div>
        </Show>
        <Show when={!emptyMessage()}>
          <For each={items()}>
            {(dest) => (
              <div
                class="destination-list-item"
                onClick={() => {
                  import('../../../../ui/panels/destinations.js').then(m => m.navigateToDestination(dest.name));
                }}
              >
                <div class="destination-list-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                    <circle cx="12" cy="10" r="3"/>
                  </svg>
                </div>
                <div class="destination-list-info">
                  <div class="destination-list-name">{dest.name}</div>
                  <Show when={dest.fitType}>
                    <div class="destination-list-detail">{dest.fitType}</div>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </Show>
      </div>
      <div class="destinations-count">{countText()}</div>
    </div>
  );
}
