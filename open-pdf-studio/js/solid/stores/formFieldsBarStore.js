import { createSignal } from 'solid-js';

const [formFieldsBarVisible, setFormFieldsBarVisible] = createSignal(false);

function showFormFieldsBar() {
  setFormFieldsBarVisible(true);
}

function hideFormFieldsBar() {
  setFormFieldsBarVisible(false);
}

export { formFieldsBarVisible, setFormFieldsBarVisible, showFormFieldsBar, hideFormFieldsBar };
