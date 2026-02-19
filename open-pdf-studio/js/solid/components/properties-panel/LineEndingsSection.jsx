import { Show } from 'solid-js';
import { annotProps, sectionVis, updateAnnotProp } from '../../stores/propertiesStore.js';
import CollapsibleSection from './CollapsibleSection.jsx';

export default function LineEndingsSection() {
  const isLocked = () => annotProps.locked;

  return (
    <Show when={sectionVis.lineEndings}>
      <CollapsibleSection title="Line Endings" name="lineEndings" id="prop-line-endings-section">
        <div class="property-group">
          <label>Start</label>
          <select value={annotProps.startHead} disabled={isLocked()}
            onChange={(e) => updateAnnotProp('startHead', e.target.value)}>
            <option value="none">None</option>
            <option value="open">Open Arrow</option>
            <option value="closed">Closed Arrow</option>
            <option value="diamond">Diamond</option>
            <option value="circle">Circle</option>
            <option value="square">Square</option>
            <option value="slash">Slash</option>
          </select>
        </div>

        <div class="property-group">
          <label>End</label>
          <select value={annotProps.endHead} disabled={isLocked()}
            onChange={(e) => updateAnnotProp('endHead', e.target.value)}>
            <option value="none">None</option>
            <option value="open">Open Arrow</option>
            <option value="closed">Closed Arrow</option>
            <option value="diamond">Diamond</option>
            <option value="circle">Circle</option>
            <option value="square">Square</option>
            <option value="slash">Slash</option>
          </select>
        </div>

        <div class="property-group">
          <label>Head Size</label>
          <input type="number" min="4" max="40"
            value={annotProps.headSize} disabled={isLocked()}
            onInput={(e) => updateAnnotProp('headSize', e.target.value)} />
        </div>
      </CollapsibleSection>
    </Show>
  );
}
