import { Show } from 'solid-js';
import { formFieldsBarVisible, hideFormFieldsBar } from '../stores/formFieldsBarStore.js';

export default function FormFieldsBar() {
  function dismiss() {
    hideFormFieldsBar();
    import('../../pdf/form-layer.js').then(m => m.dismissFormFieldsBar());
  }

  return (
    <Show when={formFieldsBarVisible()}>
      <div class="form-fields-bar">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M8 1C4.13 1 1 4.13 1 8s3.13 7 7 7 7-3.13 7-7-3.13-7-7-7zm.5 11h-1V7h1v5zm0-6.5h-1v-1h1v1z" fill="#0066cc"/>
        </svg>
        <span>This document contains interactive form fields. You can fill in the form and save your data.</span>
        <button title="Close" onClick={dismiss}>&times;</button>
      </div>
    </Show>
  );
}
