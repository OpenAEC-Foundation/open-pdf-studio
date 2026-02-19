import { Show } from 'solid-js';
import { annotProps, sectionVis } from '../../stores/propertiesStore.js';
import CollapsibleSection from './CollapsibleSection.jsx';

export default function DimensionsSection() {
  return (
    <Show when={sectionVis.dimensions}>
      <CollapsibleSection title="Size & Dimensions" name="dimensions" id="prop-dimensions-section">
        <div class="property-group">
          <label>Length</label>
          <input type="text" value={annotProps.arrowLength} readonly />
        </div>
      </CollapsibleSection>
    </Show>
  );
}
