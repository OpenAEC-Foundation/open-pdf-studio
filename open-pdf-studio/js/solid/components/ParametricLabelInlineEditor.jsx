import { For, Show, createEffect, onCleanup } from 'solid-js';
import {
  active, anchor, setAnchor, fields, values, setFieldValue,
  onCommit, onCancel, locator, hideParametricLabelInput,
  returnFocusTarget as requestedReturnFocusTarget,
} from '../stores/parametricLabelInputStore.js';
import { createOutsideCommitController } from './parametric-label-outside-events.js';
import {
  captureParametricLabelReturnFocus,
  restoreParametricLabelFocus,
} from './parametric-label-focus.js';

export default function ParametricLabelInlineEditor() {
  let rootRef;
  let firstInputRef;
  let capturedReturnFocusTarget = null;

  const scheduleFocusRestore = () => {
    const target = capturedReturnFocusTarget;
    if (!target) return;
    capturedReturnFocusTarget = null;
    queueMicrotask(() => restoreParametricLabelFocus(target));
  };

  const commit = () => {
    if (!active()) return;
    const callback = onCommit();
    const nextValues = { ...values() };
    hideParametricLabelInput();
    if (callback) callback(nextValues);
    scheduleFocusRestore();
  };

  const cancel = () => {
    if (!active()) return;
    const callback = onCancel();
    hideParametricLabelInput();
    if (callback) callback();
    scheduleFocusRestore();
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

    capturedReturnFocusTarget = captureParametricLabelReturnFocus(
      document,
      requestedReturnFocusTarget(),
    );
    queueMicrotask(() => {
      firstInputRef?.focus();
      firstInputRef?.select();
    });

    const outsideController = createOutsideCommitController({
      isActive: active,
      commit,
      isCanvasTarget: (target) =>
        target instanceof Element
        && !!target.closest('#annotation-canvas, .annotation-canvas'),
    });
    const onOutsidePointerDown = (event) =>
      outsideController.pointerDown(event, rootRef);
    const onOutsideClick = (event) =>
      outsideController.click(event, rootRef);
    document.addEventListener('pointerdown', onOutsidePointerDown, true);
    window.addEventListener('click', onOutsideClick);

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
      outsideController.reset();
      document.removeEventListener('pointerdown', onOutsidePointerDown, true);
      window.removeEventListener('click', onOutsideClick);
      if (raf) cancelAnimationFrame(raf);
      scheduleFocusRestore();
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
