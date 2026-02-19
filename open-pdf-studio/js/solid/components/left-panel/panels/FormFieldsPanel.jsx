import { For, Show } from 'solid-js';
import { activeTab } from '../../../stores/leftPanelStore.js';
import { groups, countText, emptyMessage } from '../../../stores/panels/formFieldsStore.js';

const FIELD_TYPE_ICONS = {
  text: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7V4h16v3"/><line x1="12" y1="4" x2="12" y2="20"/><line x1="8" y1="20" x2="16" y2="20"/></svg>',
  checkbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="1"/><polyline points="9 11 12 14 22 4"/></svg>',
  radiobutton: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4" fill="currentColor"/></svg>',
  combobox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="1"/><polyline points="8 10 12 14 16 10"/></svg>',
  listbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="1"/><line x1="7" y1="8" x2="17" y2="8"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="7" y1="16" x2="17" y2="16"/></svg>',
  button: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="18" height="12" rx="1"/><line x1="8" y1="12" x2="16" y2="12"/></svg>',
};

export default function FormFieldsPanel() {
  return (
    <div class={`left-panel-content${activeTab() === 'form-fields' ? ' active' : ''}`} id="form-fields-panel">
      <div class="left-panel-header">
        <span>Form Fields</span>
      </div>
      <div class="form-fields-container">
        <Show when={emptyMessage()}>
          <div class="form-fields-empty">{emptyMessage()}</div>
        </Show>
        <Show when={!emptyMessage()}>
          <For each={groups()}>
            {(group) => (
              <div>
                <div class="form-fields-page-header">{group.pageLabel}</div>
                <For each={group.fields}>
                  {(field) => (
                    <div class="form-field-list-item">
                      <div class="form-field-list-icon">
                        <span innerHTML={FIELD_TYPE_ICONS[field.type] || FIELD_TYPE_ICONS.text}></span>
                      </div>
                      <div class="form-field-list-info">
                        <div class="form-field-list-name">{field.fieldName}</div>
                        <div class="form-field-list-type">{field.typeLabel}</div>
                        <Show when={field.value !== undefined && field.value !== null && field.value !== ''}>
                          <div class="form-field-list-value">{String(field.value)}</div>
                        </Show>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            )}
          </For>
        </Show>
      </div>
      <div class="form-fields-count">{countText()}</div>
    </div>
  );
}
