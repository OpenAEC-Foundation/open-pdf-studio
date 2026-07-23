import { createSignal } from 'solid-js';

const [active, setActive] = createSignal(false);
const [anchor, setAnchor] = createSignal({ left: 0, top: 0 });
const [fields, setFields] = createSignal([]);
const [values, setValues] = createSignal({});
const [onCommit, setOnCommit] = createSignal(null);
const [onCancel, setOnCancel] = createSignal(null);
const [locator, setLocator] = createSignal(null);

export function showParametricLabelInput(options = {}) {
  setAnchor(options.anchor || { left: 0, top: 0 });
  setFields(Array.isArray(options.fields) ? options.fields : []);
  setValues({ ...(options.values || {}) });
  setOnCommit(() => (typeof options.commit === 'function' ? options.commit : null));
  setOnCancel(() => (typeof options.cancel === 'function' ? options.cancel : null));
  setLocator(() => (typeof options.locate === 'function' ? options.locate : null));
  setActive(true);
}

export function hideParametricLabelInput() {
  setActive(false);
  setLocator(() => null);
  setOnCommit(() => null);
  setOnCancel(() => null);
}

export function setFieldValue(key, value) {
  setValues((current) => ({ ...current, [key]: value }));
}

export function parametricLabelInputActive() {
  return active();
}

export {
  active, anchor, setAnchor,
  fields, values, onCommit, onCancel, locator,
};
