import { createSignal } from 'solid-js';

const [visible, setVisible] = createSignal(false);
const [labelText, setLabelText] = createSignal('');

export function showPdfABar(text) {
  setLabelText(text);
  setVisible(true);
}

export function hidePdfABar() {
  setVisible(false);
}

export { visible, labelText };
