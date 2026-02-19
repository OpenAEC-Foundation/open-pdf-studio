import { createSignal } from 'solid-js';

const [dialogs, setDialogs] = createSignal([]);

export function openDialog(name, data = {}) {
  setDialogs(prev => {
    if (prev.some(d => d.name === name)) return prev;
    return [...prev, { name, data }];
  });
}

export function closeDialog(name) {
  setDialogs(prev => prev.filter(d => d.name !== name));
}

export function getDialogs() {
  return dialogs();
}
