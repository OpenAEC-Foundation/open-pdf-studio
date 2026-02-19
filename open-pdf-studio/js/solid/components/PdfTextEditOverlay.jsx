import { Show, createEffect } from 'solid-js';
import { active, editorStyle, text, setText, keyDownHandler, blurHandler, selectOnFocus, setSelectOnFocus, hidePdfTextEditor } from '../stores/pdfTextEditStore.js';

export default function PdfTextEditOverlay() {
  let textareaRef;

  createEffect(() => {
    if (active() && textareaRef) {
      textareaRef.focus();
      if (selectOnFocus()) {
        textareaRef.select();
        setSelectOnFocus(false);
      }
    }
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
        style={editorStyle()}
        value={text()}
        onInput={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
      />
    </Show>
  );
}
