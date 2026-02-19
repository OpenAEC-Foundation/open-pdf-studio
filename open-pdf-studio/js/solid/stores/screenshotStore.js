import { createSignal } from 'solid-js';

const [active, setActive] = createSignal(false);
const [selectionRect, setSelectionRect] = createSignal(null); // { left, top, width, height }
const [containerEl, setContainerEl] = createSignal(null); // the container element to position relative to
const [onComplete, setOnComplete] = createSignal(null); // callback(rect) when selection is done
const [onCancel, setOnCancel] = createSignal(null); // callback when cancelled

export function startScreenshot(container, completeFn, cancelFn) {
  setContainerEl(container);
  setOnComplete(() => completeFn);
  setOnCancel(() => cancelFn);
  setSelectionRect(null);
  setActive(true);
}

export function endScreenshot() {
  setActive(false);
  setSelectionRect(null);
}

export { active, selectionRect, setSelectionRect, containerEl, onComplete, onCancel };
