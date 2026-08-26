import { createSignal } from 'solid-js';

const [active, setActive] = createSignal(false);
const [editorStyle, setEditorStyle] = createSignal({});
const [text, setText] = createSignal('');
// Inline-opmaak: per regel een array runs { text, bold, italic }. Gevuld door
// de overlay (DOM-parse) bij elke invoer; geïnitialiseerd via showPdfTextEditor.
const [lineRuns, setLineRuns] = createSignal(null);
const [initialLines, setInitialLines] = createSignal(null);
// Verhoogd bij elke show zodat de overlay zijn contenteditable opnieuw opbouwt.
const [initRevision, setInitRevision] = createSignal(0);
const [commitHandler, setCommitHandler] = createSignal(null);
const [cancelHandler, setCancelHandler] = createSignal(null);
const [keyDownHandler, setKeyDownHandler] = createSignal(null);
const [blurHandler, setBlurHandler] = createSignal(null);
const [selectOnFocus, setSelectOnFocus] = createSignal(false);
// Versleep-grip: { onDragBy(dxPx, dyPx), onDragEnd(), onDragCancel() } —
// gezet door de tool; de overlay stuurt scherm-deltas, de tool rekent om
// naar PDF-punten en verplaatst record + editor (nudge).
const [dragHandlers, setDragHandlers] = createSignal(null);

// handlers.initialLines (optioneel): [[{ text, bold, italic }]] per regel —
// toont bestaande inline opmaak (vet/cursief) in de editor.
export function showPdfTextEditor(style, initialText, handlers) {
  setEditorStyle(style);
  setText(initialText);
  const init = Array.isArray(handlers?.initialLines) ? handlers.initialLines : null;
  setInitialLines(init);
  setLineRuns(init);
  setCommitHandler(() => handlers.onCommit || null);
  setCancelHandler(() => handlers.onCancel || null);
  setKeyDownHandler(() => handlers.onKeyDown || null);
  setBlurHandler(() => handlers.onBlur || null);
  setDragHandlers(handlers.dragHandlers || null);
  setSelectOnFocus(true);
  setInitRevision(r => r + 1);
  setActive(true);
}

export function hidePdfTextEditor() {
  setActive(false);
  setSelectOnFocus(false);
}

export function getEditorText() {
  return text();
}

// Runs per regel zoals nu in de editor zichtbaar: [[{ text, bold, italic }]].
// null zolang de overlay nog niets geparseerd heeft (dan geldt de platte tekst).
export function getEditorLineRuns() {
  return lineRuns();
}

// Merge a partial style object into the live editor style (used when the
// properties panel changes font/colour/weight while a text edit is open).
export function updateEditorStyle(partial) {
  setEditorStyle(prev => ({ ...(prev || {}), ...partial }));
}

// Shift the live editor's fixed position by a pixel delta (used for keyboard
// nudge / move of the active text edit). left/top are 'Npx' strings.
export function shiftEditorPosition(dxPx, dyPx) {
  setEditorStyle(prev => {
    const s = { ...(prev || {}) };
    const l = parseFloat(s.left) || 0;
    const t = parseFloat(s.top) || 0;
    s.left = `${l + dxPx}px`;
    s.top = `${t + dyPx}px`;
    return s;
  });
}

export {
  active, editorStyle, text, setText, lineRuns, setLineRuns, initialLines,
  initRevision, commitHandler, cancelHandler, keyDownHandler, blurHandler,
  selectOnFocus, setSelectOnFocus, dragHandlers,
};
