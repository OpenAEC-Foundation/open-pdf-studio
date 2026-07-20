import { Show, createEffect } from 'solid-js';
import { active, editorStyle, text, setText, keyDownHandler, blurHandler, selectOnFocus, setSelectOnFocus } from '../stores/pdfTextEditStore.js';

export default function PdfTextEditOverlay() {
  let textareaRef;

  const resizeToContent = () => {
    if (!textareaRef) return;
    const base = editorStyle() || {};
    const minWidth = parseFloat(base.width) || 80;
    const minHeight = parseFloat(base.height) || 24;

    // wrap="off" keeps the live layout identical to the saved PDF: only an
    // explicit Enter creates a new line. Grow instead of introducing a visual
    // wrap that would disappear after saving.
    textareaRef.style.width = `${minWidth}px`;
    textareaRef.style.height = '0px';
    textareaRef.style.height = `${Math.max(minHeight, textareaRef.scrollHeight)}px`;
    textareaRef.style.width = `${Math.max(minWidth, textareaRef.scrollWidth + 2)}px`;
  };

  createEffect(() => {
    if (active() && textareaRef) {
      textareaRef.focus();
      if (selectOnFocus()) {
        textareaRef.select();
        setSelectOnFocus(false);
      }
    }
  });

  createEffect(() => {
    const isActive = active();
    text();
    editorStyle();
    if (isActive && textareaRef) queueMicrotask(resizeToContent);
  });

  const handleKeyDown = (e) => {
    const handler = keyDownHandler();
    if (handler) handler(e);
  };

  const handleBlur = () => {
    const handler = blurHandler();
    if (handler) handler();
  };

  return (
    <Show when={active()}>
      <textarea
        ref={textareaRef}
        class="pdf-text-editor"
        dir="auto"
        wrap="off"
        spellcheck={false}
        style={editorStyle()}
        value={text()}
        onInput={(e) => {
          setText(e.target.value);
          queueMicrotask(resizeToContent);
        }}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
      />
    </Show>
  );
}
