import { createSignal } from 'solid-js';

const [visible, setVisible] = createSignal(false);
// Het label van de conformiteit ('PDF/A-2b'); de balk vertaalt de zin zelf.
const [label, setLabel] = createSignal('');

export function showPdfABar(pdfaLabel) {
  setLabel(pdfaLabel);
  setVisible(true);
}

export function hidePdfABar() {
  setVisible(false);
}

export { visible, label };
