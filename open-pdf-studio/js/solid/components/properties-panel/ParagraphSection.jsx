import { Show } from 'solid-js';
import { annotProps, sectionVis, updateAnnotProp } from '../../stores/propertiesStore.js';
import CollapsibleSection from './CollapsibleSection.jsx';

export default function ParagraphSection() {
  const isLocked = () => annotProps.locked;

  return (
    <Show when={sectionVis.paragraph}>
      <CollapsibleSection title="Paragraph" name="paragraph" id="prop-paragraph-section">
        <div class="property-group">
          <label>Text Alignment</label>
          <div class="text-align-buttons">
            <button type="button"
              class={`text-align-btn${annotProps.textAlign === 'left' ? ' active' : ''}`}
              title="Align Left" disabled={isLocked()}
              onClick={() => updateAnnotProp('textAlign', 'left')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 6h18M3 12h12M3 18h18"/>
              </svg>
            </button>
            <button type="button"
              class={`text-align-btn${annotProps.textAlign === 'center' ? ' active' : ''}`}
              title="Align Center" disabled={isLocked()}
              onClick={() => updateAnnotProp('textAlign', 'center')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 6h18M6 12h12M3 18h18"/>
              </svg>
            </button>
            <button type="button"
              class={`text-align-btn${annotProps.textAlign === 'right' ? ' active' : ''}`}
              title="Align Right" disabled={isLocked()}
              onClick={() => updateAnnotProp('textAlign', 'right')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 6h18M9 12h12M3 18h18"/>
              </svg>
            </button>
          </div>
        </div>

        <div class="property-group">
          <label>Line Spacing</label>
          <select value={annotProps.lineSpacing} disabled={isLocked()}
            onChange={(e) => updateAnnotProp('lineSpacing', e.target.value)}>
            <option value="1">1x</option>
            <option value="1.15">1.15x</option>
            <option value="1.5">1.5x</option>
            <option value="2">2x</option>
            <option value="2.5">2.5x</option>
            <option value="3">3x</option>
          </select>
        </div>

        <div class="property-group">
          <label>Rotation</label>
          <div style="display: flex; align-items: center; gap: 4px;">
            <input type="number" min="-360" max="360" step="1" style="flex: 1;"
              value={annotProps.rotation} disabled={isLocked()}
              onInput={(e) => updateAnnotProp('rotation', e.target.value)} />
            <span style="font-size: 11px; color: var(--theme-text-secondary);">&deg;</span>
          </div>
        </div>
      </CollapsibleSection>
    </Show>
  );
}
