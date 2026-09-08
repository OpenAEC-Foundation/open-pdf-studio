import { createSignal } from 'solid-js';

const [active, setActive] = createSignal(false);
const [overlayStyle, setOverlayStyle] = createSignal({});
const [text, setText] = createSignal('');
// Inline opmaak per regel: [[{ text, bold, italic }], …] — gevuld door de
// contenteditable-overlay bij elke invoer; null zolang er niets bekend is.
const [lineRuns, setLineRuns] = createSignal(null);
const [initialRuns, setInitialRuns] = createSignal(null);
const [onCommit, setOnCommit] = createSignal(null);
const [onCancel, setOnCancel] = createSignal(null);
const [heightGrowth, setHeightGrowth] = createSignal(0);
// Opmaak-opdrachten (vet/cursief) vanuit het eigenschappenpaneel naar de
// open editor; de overlay registreert hier zijn handler.
let _formatHandler = null;

export function showTextEditOverlay(style, initialText, commitFn, cancelFn, runs = null) {
  setHeightGrowth(0);
  setOverlayStyle(style);
  setText(initialText);
  setInitialRuns(runs);
  setLineRuns(runs);
  setOnCommit(() => commitFn);
  setOnCancel(() => cancelFn);
  setActive(true);
}

export function hideTextEditOverlay() {
  setActive(false);
  setHeightGrowth(0);
  setLineRuns(null);
  setInitialRuns(null);
}

export function getTextValue() {
  return text();
}

export function getLineRuns() {
  return lineRuns();
}

export function getHeightGrowth() {
  return heightGrowth();
}

export function setEditorFormatHandler(fn) {
  _formatHandler = fn;
}

/** Vet/cursief toepassen op de selectie in de open editor. */
export function applyEditorFormat(prop, value) {
  if (!active() || !_formatHandler) return false;
  return _formatHandler(prop, value);
}

export {
  active, overlayStyle, setOverlayStyle, text, setText, lineRuns, setLineRuns, initialRuns,
  onCommit, onCancel, heightGrowth, setHeightGrowth,
};
