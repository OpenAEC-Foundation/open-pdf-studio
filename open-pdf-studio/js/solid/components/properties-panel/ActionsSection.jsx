import { Show } from 'solid-js';
import { sectionVis } from '../../stores/propertiesStore.js';

export default function ActionsSection() {
  return (
    <Show when={sectionVis.actions}>
      <div class="property-actions" id="prop-actions-section">
      </div>
    </Show>
  );
}
