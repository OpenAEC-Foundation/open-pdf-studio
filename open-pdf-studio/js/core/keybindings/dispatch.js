// Which user-assigned shortcut does a keydown trigger (#714)?
//
// The built-in keys keep their own handling in tools/keyboard-handlers.js,
// with all its special cases (text fields, dialogs, PDF/A, the Ctrl+C that
// only copies annotations when some are selected, ...); that handling asks
// the registry whether its key still belongs to its command. This module only
// decides about the OTHER combinations: the ones the user gave a command.
//
// Rules:
//   - never while a modal dialog is open (the dialog keeps its keys),
//   - never for a reserved key (Escape, Enter, Tab, arrows, ... see RESERVED),
//   - while typing in a text field: only commands that allow it (Find), and
//     only with Ctrl/Alt/Meta or a function key; a single letter or digit
//     never fires while typing,
//   - a combination that is the command's own default goes to the built-in
//     handling, not here.
//
// Pure module.

import { eventCandidates, parseBinding, isSingleKey, isFunctionKey } from './binding.js';

/**
 * Keys that cannot be assigned: they have a fixed meaning that depends on
 * what is going on (finishing a drawing, editing text, moving with G,
 * switching document tabs, the recorder's own Escape).
 */
export const RESERVED = Object.freeze([
  'Escape', 'Enter', 'Shift+Enter', 'Tab', 'Shift+Tab', 'Backspace', 'Space',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Shift+ArrowUp', 'Shift+ArrowDown', 'Shift+ArrowLeft', 'Shift+ArrowRight',
  'G', 'Ctrl+Tab', 'Ctrl+Shift+Tab', 'Ctrl+PageUp', 'Ctrl+PageDown', 'Alt+F4',
]);
const RESERVED_SET = new Set(RESERVED);

export function isReserved(combo) {
  const c = parseBinding(combo);
  return !c || RESERVED_SET.has(c);
}

/**
 * May this combination run its command while the focus is in a text field?
 * Only a command that allows it, and never a key that types something.
 */
export function allowedWhileTyping(command, combo) {
  if (!command?.allowInInput) return false;
  return !isSingleKey(combo) || isFunctionKey(combo);
}

/**
 * The user-assigned shortcut this event triggers: { id, combo } or null.
 * @param {KeyboardEvent-like} e
 * @param {ReturnType<import('./registry.js').createKeybindingRegistry>} registry
 * @param {{ inTextEntry?: boolean, modalOpen?: boolean }} context
 */
export function customShortcutFor(e, registry, { inTextEntry = false, modalOpen = false } = {}) {
  if (!e || modalOpen) return null;
  for (const combo of eventCandidates(e)) {
    if (RESERVED_SET.has(combo)) return null;
    const id = registry.ownerOf(combo);
    if (!id) continue;
    // The built-in handling takes its own default keys.
    if (registry.defaultsOf(id).includes(combo)) return null;
    const command = registry.get(id);
    // Bound to a command that is not here (an extension that is not installed).
    if (!command) return null;
    if (inTextEntry && !allowedWhileTyping(command, combo)) return null;
    return { id, combo };
  }
  return null;
}
