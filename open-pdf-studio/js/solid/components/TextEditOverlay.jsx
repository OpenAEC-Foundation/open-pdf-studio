import { Show, createEffect } from 'solid-js';
import { active, overlayStyle, text, setText, onCommit, onCancel, hideTextEditOverlay } from '../stores/textEditOverlayStore.js';

export default function TextEditOverlay() {
  let textareaRef;

  createEffect(() => {
    if (active() && textareaRef) {
      textareaRef.focus();
      textareaRef.select();
    }
  });

  const handleBlur = () => {
    if (!active()) return;
    const commitFn = onCommit();
    if (commitFn) commitFn(text());
    hideTextEditOverlay();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      const cancelFn = onCancel();
      if (cancelFn) cancelFn();
      hideTextEditOverlay();
    }
    // Don't propagate keyboard events during editing
    e.stopPropagation();
  };

  return (
    <Show when={active()}>
      <textarea
        ref={textareaRef}
        class="inline-text-editor"
        style={overlayStyle()}
        value={text()}
        onInput={(e) => setText(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
      />
    </Show>
  );
}
