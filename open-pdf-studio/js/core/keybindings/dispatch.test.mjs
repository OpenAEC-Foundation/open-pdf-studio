// Which user-assigned shortcut a keydown triggers (#714): never while typing
// (except Find with a modifier), never in a dialog, never a reserved key, and
// a command's own default key stays with the built-in handling.

import assert from 'node:assert/strict';
import test from 'node:test';
import { createKeybindingRegistry } from './registry.js';
import { customShortcutFor, isReserved, allowedWhileTyping, RESERVED } from './dispatch.js';

const ev = (key, code, mods = {}) => ({ key, code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

function maak(overrides = {}) {
  const r = createKeybindingRegistry();
  r.define({ id: 'view.fitPage', defaults: ['Ctrl+2'] });
  r.define({ id: 'tool.select', defaults: ['V'] });
  r.define({ id: 'search.find', defaults: ['Ctrl+F'], allowInInput: true });
  r.define({ id: 'ribbon:#insert-page' });
  r.setOverrides(overrides);
  return r;
}

test('a user-assigned key runs its command', () => {
  const r = maak({ 'view.fitPage': ['Ctrl+2', 'F6'] });
  assert.deepEqual(customShortcutFor(ev('F6', 'F6'), r), { id: 'view.fitPage', combo: 'F6' });
  assert.equal(customShortcutFor(ev('F7', 'F7'), r), null);
});

test("a command's default key goes to the built-in handling", () => {
  const r = maak();
  assert.equal(customShortcutFor(ev('2', 'Digit2', { ctrlKey: true }), r), null);
  assert.equal(customShortcutFor(ev('v', 'KeyV'), r), null);
});

test('a default key given to another command runs that command', () => {
  const r = maak({ 'tool.select': [], 'ribbon:#insert-page': ['V'] });
  assert.deepEqual(customShortcutFor(ev('v', 'KeyV'), r), { id: 'ribbon:#insert-page', combo: 'V' });
});

test('single keys never fire while typing in a text field', () => {
  const r = maak({ 'ribbon:#insert-page': ['I'], 'view.fitPage': ['Ctrl+2', 'Ctrl+K'] });
  assert.equal(customShortcutFor(ev('i', 'KeyI'), r, { inTextEntry: true }), null);
  assert.equal(customShortcutFor(ev('k', 'KeyK', { ctrlKey: true }), r, { inTextEntry: true }), null, 'not Find: also not with Ctrl');
  assert.deepEqual(customShortcutFor(ev('i', 'KeyI'), r, { inTextEntry: false }), { id: 'ribbon:#insert-page', combo: 'I' });
});

test('Find also works while typing, but only with a modifier or a function key', () => {
  const r = maak({ 'search.find': ['Ctrl+F', 'Ctrl+K', 'F4', '/'] });
  assert.deepEqual(customShortcutFor(ev('k', 'KeyK', { ctrlKey: true }), r, { inTextEntry: true }), { id: 'search.find', combo: 'Ctrl+K' });
  assert.deepEqual(customShortcutFor(ev('F4', 'F4'), r, { inTextEntry: true }), { id: 'search.find', combo: 'F4' });
  assert.equal(customShortcutFor(ev('/', 'Slash'), r, { inTextEntry: true }), null);
  assert.equal(allowedWhileTyping({ allowInInput: true }, 'Shift+K'), false);
  assert.equal(allowedWhileTyping({ allowInInput: false }, 'Ctrl+K'), false);
});

test('nothing fires while a modal dialog is open', () => {
  const r = maak({ 'view.fitPage': ['F6'] });
  assert.equal(customShortcutFor(ev('F6', 'F6'), r, { modalOpen: true }), null);
});

test('reserved keys are never assigned and never dispatched', () => {
  for (const k of ['Escape', 'Enter', 'Tab', 'Shift+Tab', 'ArrowLeft', 'Shift+ArrowUp', 'G', 'Ctrl+Tab', 'Ctrl+PageDown', 'Backspace', 'Space']) {
    assert.ok(isReserved(k), k);
    assert.ok(RESERVED.includes(k), k);
  }
  for (const k of ['PageUp', 'PageDown', 'Home', 'End', 'F6', 'Ctrl+K', 'Shift+G']) assert.equal(isReserved(k), false, k);
  assert.equal(isReserved('nonsense+'), true, 'an invalid combination is not assignable either');
  const r = createKeybindingRegistry();
  r.define({ id: 'x' });
  r.setOverrides({ x: ['Escape'] });
  assert.equal(customShortcutFor(ev('Escape', 'Escape'), r), null);
});

test('Cmd on macOS matches a Ctrl shortcut; a key bound to a missing command does nothing', () => {
  const r = maak({ 'view.fitPage': ['Ctrl+K'], 'ext:not-installed:x': ['F9'] });
  assert.deepEqual(customShortcutFor(ev('k', 'KeyK', { metaKey: true }), r), { id: 'view.fitPage', combo: 'Ctrl+K' });
  assert.equal(customShortcutFor(ev('F9', 'F9'), r), null);
});
