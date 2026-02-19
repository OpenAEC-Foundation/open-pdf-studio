import { Show } from 'solid-js';
import { annotProps, sectionVis, updateAnnotProp, resetImageSize } from '../../stores/propertiesStore.js';
import CollapsibleSection from './CollapsibleSection.jsx';

export default function ImageSection() {
  const isLocked = () => annotProps.locked;

  return (
    <Show when={sectionVis.image}>
      <CollapsibleSection title="Image" name="image" id="prop-image-section">
        <div class="property-group">
          <label>Width</label>
          <input type="number" min="20" max="2000"
            value={annotProps.imageWidth} disabled={isLocked()}
            onInput={(e) => updateAnnotProp('imageWidth', e.target.value)} />
        </div>

        <div class="property-group">
          <label>Height</label>
          <input type="number" min="20" max="2000"
            value={annotProps.imageHeight} disabled={isLocked()}
            onInput={(e) => updateAnnotProp('imageHeight', e.target.value)} />
        </div>

        <div class="property-group">
          <label>Rotation</label>
          <input type="number" min="-360" max="360" step="1"
            value={annotProps.imageRotation} disabled={isLocked()}
            onInput={(e) => updateAnnotProp('imageRotation', e.target.value)} />
        </div>

        <div class="property-group property-group-full">
          <button type="button" class="property-btn secondary"
            disabled={isLocked()}
            onClick={() => resetImageSize()}>
            Reset to Original Size
          </button>
        </div>
      </CollapsibleSection>
    </Show>
  );
}
