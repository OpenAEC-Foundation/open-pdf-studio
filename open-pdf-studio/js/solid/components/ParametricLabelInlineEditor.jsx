import { For, Show, createEffect, onCleanup } from 'solid-js';
import {
  active, anchor, setAnchor, fields, values, setFieldValue,
  onCommit, onCancel, locator, hideParametricLabelInput,
} from '../stores/parametricLabelInputStore.js';

export default function ParametricLabelInlineEditor() {
  let rootRef;
  let firstInputRef;

  const commit = () => {
    if (!active()) return;
    const callback = onCommit();
    const nextValues = { ...values() };
    hideParametricLabelInput();
    if (callback) callback(nextValues);
  };

  const cancel = () => {
    if (!active()) return;
    const callback = onCancel();
    hideParametricLabelInput();
    if (callback) callback();
  };

  const handleKeyDown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  };

  createEffect(() => {
    if (!active()) return;

    queueMicrotask(() => {
      firstInputRef?.focus();
      firstInputRef?.select();
    });

    const onOutside = (event) => {
      if (rootRef && event.target instanceof Node && rootRef.contains(event.target)) return;
      commit();
    };
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('mousedown', onOutside, true);

    let raf = 0;
    const tick = () => {
      if (!active()) return;
      const locate = locator();
      if (typeof locate === 'function') {
        const pos = locate();
        if (!pos) {
          cancel();
          return;
        }
        const current = anchor();
        if (pos.left !== current.left || pos.top !== current.top) setAnchor(pos);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    onCleanup(() => {
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('mousedown', onOutside, true);
      if (raf) cancelAnimationFrame(raf);
    });
  });

  return (
    <Show when={active()}>
      <div
        ref={rootRef}
        class="parametric-label-inline-editor"
        style={{
          position: 'fixed',
          left: `${anchor().left}px`,
          top: `${anchor().top}px`,
          'z-index': '1200',
        }}
        onKeyDown={handleKeyDown}
      >
        <For each={fields()}>{(field, index) => (
          <label class="parametric-label-inline-field">
            <span>{field.label}</span>
            <input
              ref={(element) => { if (index() === 0) firstInputRef = element; }}
              type={field.type === 'number' ? 'number' : 'text'}
              min={field.min}
              max={field.max}
              step={field.step}
              value={values()[field.key] ?? ''}
              onInput={(event) => setFieldValue(field.key, event.currentTarget.value)}
            />
          </label>
        )}</For>
      </div>
    </Show>
  );
}
