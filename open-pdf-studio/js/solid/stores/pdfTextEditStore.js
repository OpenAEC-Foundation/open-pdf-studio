import { createSignal } from 'solid-js';

const [active, setActive] = createSignal(false);
const [editorStyle, setEditorStyle] = createSignal({});
const [text, setText] = createSignal('');
const [commitHandler, setCommitHandler] = createSignal(null);
const [cancelHandler, setCancelHandler] = createSignal(null);
const [keyDownHandler, setKeyDownHandler] = createSignal(null);
const [blurHandler, setBlurHandler] = createSignal(null);
const [selectOnFocus, setSelectOnFocus] = createSignal(false);

export function showPdfTextEditor(style, initialText, handlers) {
  setEditorStyle(style);
  setText(initialText);
  setCommitHandler(() => handlers.onCommit || null);
  setCancelHandler(() => handlers.onCancel || null);
  setKeyDownHandler(() => handlers.onKeyDown || null);
  setBlurHandler(() => handlers.onBlur || null);
  setSelectOnFocus(true);
  setActive(true);
}

export function hidePdfTextEditor() {
  setActive(false);
  setSelectOnFocus(false);
}

export function getEditorText() {
  return text();
}

export { active, editorStyle, text, setText, commitHandler, cancelHandler, keyDownHandler, blurHandler, selectOnFocus, setSelectOnFocus };
