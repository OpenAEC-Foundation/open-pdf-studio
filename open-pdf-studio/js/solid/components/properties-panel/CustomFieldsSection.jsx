import { Show, For } from 'solid-js';
import { sectionVis, annotProps, customFieldsDef, updateAnnotProp, collapsedSections, toggleSection, getCurrentAnnotation } from '../../stores/propertiesStore.js';

export default function CustomFieldsSection() {
  const isCollapsed = () => collapsedSections()['customFields'];

  return (
    <Show when={sectionVis.customFields}>
      <div class="prop-section">
        <div class="prop-section-header" role="button" tabIndex={0} aria-expanded={!isCollapsed()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggleSection('customFields'); } }} onClick={() => toggleSection('customFields')}>
          <span class={`prop-section-arrow ${isCollapsed() ? 'collapsed' : ''}`}>&#9660;</span>
          <span>Fields</span>
        </div>
        <Show when={!isCollapsed()}>
          <div class="prop-section-body">
            <For each={customFieldsDef()}>
              {(field) => {
                const getValue = () => {
                  const ann = getCurrentAnnotation();
                  return ann ? (ann[field.key] || '') : '';
                };
                return (
                  <div class="prop-row">
                    <label class="prop-label">{field.label}</label>
                    <input
                      class="prop-input"
                      type="text"
                      value={getValue()}
                      onInput={(e) => updateAnnotProp(field.key, e.target.value)}
                    />
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  );
}
