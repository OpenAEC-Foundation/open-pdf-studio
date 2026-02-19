import { Show } from 'solid-js';
import { annotProps, sectionVis, updateAnnotProp } from '../../stores/propertiesStore.js';
import CollapsibleSection from './CollapsibleSection.jsx';

export default function ContentSection() {
  const isLocked = () => annotProps.locked;

  return (
    <Show when={sectionVis.content}>
      <CollapsibleSection title="Content" name="content" id="prop-content-section">
        <Show when={sectionVis.textGroup}>
          <div class="property-group">
            <label>Text</label>
            <textarea rows="4" value={annotProps.text} disabled={isLocked()}
              onInput={(e) => updateAnnotProp('text', e.target.value)} />
          </div>
        </Show>

        <Show when={sectionVis.fontSizeGroup}>
          <div class="property-group">
            <label>Font Size</label>
            <input type="number" min="8" max="72"
              value={annotProps.fontSize} disabled={isLocked()}
              onInput={(e) => updateAnnotProp('fontSize', e.target.value)} />
          </div>
        </Show>
      </CollapsibleSection>
    </Show>
  );
}
