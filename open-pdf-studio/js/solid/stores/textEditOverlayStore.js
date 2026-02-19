import { createSignal } from 'solid-js';

const [active, setActive] = createSignal(false);
const [overlayStyle, setOverlayStyle] = createSignal({});
const [text, setText] = createSignal('');
const [onCommit, setOnCommit] = createSignal(null);
const [onCancel, setOnCancel] = createSignal(null);

export function showTextEditOverlay(style, initialText, commitFn, cancelFn) {
  setOverlayStyle(style);
  setText(initialText);
  setOnCommit(() => commitFn);
  setOnCancel(() => cancelFn);
  setActive(true);
}

export function hideTextEditOverlay() {
  setActive(false);
}

export function getTextValue() {
  return text();
}

export { active, overlayStyle, text, setText, onCommit, onCancel };
