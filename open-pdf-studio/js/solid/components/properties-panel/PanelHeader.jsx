import { storeClosePanel } from '../../stores/propertiesStore.js';
import { closePropertiesPanel } from '../../../ui/panels/properties-panel.js';

export default function PanelHeader() {
  return (
    <div id="prop-panel-header" class="prop-panel-header">
      <h3 style="margin: 0; padding: 8px 0; background: none;">Properties</h3>
      <button class="prop-panel-close-btn" title="Close"
        onClick={() => closePropertiesPanel()}>&times;</button>
    </div>
  );
}
