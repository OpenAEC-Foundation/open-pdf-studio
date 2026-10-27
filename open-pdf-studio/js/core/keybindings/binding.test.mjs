// Key combinations (#714): one canonical spelling, display per platform and
// the combinations a keydown stands for.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseBinding, formatBinding, bindingParts, splitBinding, isSingleKey, isFunctionKey,
  detectPlatform, bindingFromEvent, eventCandidates, eventFieldsFor, keyFromCode, normalizeKeyName,
} from './binding.js';

const ev = (key, code, mods = {}) => ({
  key, code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods,
});

test('modifiers come in the fixed order Ctrl, Alt, Shift, Meta, whatever the input order or case', () => {
  assert.equal(parseBinding('shift+ctrl+s'), 'Ctrl+Shift+S');
  assert.equal(parseBinding('Meta+Alt+Shift+Ctrl+K'), 'Ctrl+Alt+Shift+Meta+K');
  assert.equal(parseBinding(' Ctrl + Shift + z '), 'Ctrl+Shift+Z');
  assert.equal(parseBinding('alt+f4'), 'Alt+F4');
});

test('aliases: Control, Strg, Option, Cmd, Win, Del, PgUp, Esc, Return', () => {
  assert.equal(parseBinding('Control+2'), 'Ctrl+2');
  assert.equal(parseBinding('Strg+2'), 'Ctrl+2');
  assert.equal(parseBinding('Option+X'), 'Alt+X');
  assert.equal(parseBinding('Cmd+K'), 'Meta+K');
  assert.equal(parseBinding('Win+E'), 'Meta+E');
  assert.equal(parseBinding('Super+E'), 'Meta+E');
  assert.equal(parseBinding('Del'), 'Delete');
  assert.equal(parseBinding('PgUp'), 'PageUp');
  assert.equal(parseBinding('pgdn'), 'PageDown');
  assert.equal(parseBinding('Esc'), 'Escape');
  assert.equal(parseBinding('Return'), 'Enter');
  assert.equal(parseBinding('ctrl+home'), 'Ctrl+Home');
});

test('the plus key: Ctrl++ and Ctrl+Plus are the same combination', () => {
  assert.equal(parseBinding('Ctrl++'), 'Ctrl+Plus');
  assert.equal(parseBinding('Ctrl+Plus'), 'Ctrl+Plus');
  assert.equal(parseBinding('+'), 'Plus');
  assert.equal(parseBinding('Ctrl+='), 'Ctrl+=');
  assert.equal(parseBinding('Ctrl+-'), 'Ctrl+-');
  assert.equal(parseBinding('Ctrl+,'), 'Ctrl+,');
});

test('function keys, digits, numeric keypad', () => {
  assert.equal(parseBinding('f1'), 'F1');
  assert.equal(parseBinding('F24'), 'F24');
  assert.equal(parseBinding('F25'), null);
  assert.equal(parseBinding('5'), '5');
  assert.equal(parseBinding('Ctrl+Shift+NumpadAdd'), 'Ctrl+Shift+NumpadAdd');
  assert.equal(parseBinding('Num 5'), 'Numpad5');
});

test('nonsense is rejected', () => {
  for (const s of ['', '   ', 'Ctrl', 'Ctrl+Shift', 'Hyper+K', 'Ctrl+Ctrl+K', 'Ctrl+Foo', 'é', 'Ctrl+ä', null, 42, {}, 'x'.repeat(100)]) {
    assert.equal(parseBinding(s), null, String(s));
  }
});

test('parse is idempotent: the canonical form parses to itself', () => {
  for (const c of ['Ctrl+Shift+S', 'F3', 'Shift+F3', 'Ctrl+Plus', 'Ctrl+=', 'Delete', 'Ctrl+Alt+Shift+Meta+PageDown', 'Ctrl+Shift+NumpadSubtract', 'Ctrl+,']) {
    assert.equal(parseBinding(c), c);
  }
});

test('display per platform', () => {
  assert.equal(formatBinding('Ctrl+Shift+S', 'win'), 'Ctrl+Shift+S');
  assert.equal(formatBinding('Meta+K', 'win'), 'Win+K');
  assert.equal(formatBinding('Meta+K', 'linux'), 'Super+K');
  assert.equal(formatBinding('Meta+Alt+K', 'mac'), 'Option+Cmd+K');
  assert.equal(formatBinding('Delete'), 'Del');
  assert.equal(formatBinding('Ctrl+PageDown'), 'Ctrl+PgDn');
  assert.equal(formatBinding('Ctrl+Plus'), 'Ctrl++');
  assert.equal(formatBinding('Ctrl+Shift+NumpadAdd'), 'Ctrl+Shift+Num +');
  assert.deepEqual(bindingParts('Ctrl+Shift+Z'), ['Ctrl', 'Shift', 'Z']);
  assert.deepEqual(bindingParts('nonsense+'), []);
});

test('platform detection', () => {
  assert.equal(detectPlatform({ platform: 'MacIntel' }), 'mac');
  assert.equal(detectPlatform({ platform: 'Win32' }), 'win');
  assert.equal(detectPlatform({ platform: 'Linux x86_64' }), 'linux');
  assert.equal(detectPlatform({ userAgentData: { platform: 'Windows' } }), 'win');
});

test('single keys and function keys', () => {
  assert.equal(isSingleKey('V'), true);
  assert.equal(isSingleKey('Shift+V'), true);
  assert.equal(isSingleKey('Delete'), true);
  assert.equal(isSingleKey('Ctrl+V'), false);
  assert.equal(isSingleKey('Alt+V'), false);
  assert.equal(isFunctionKey('F3'), true);
  assert.equal(isFunctionKey('Shift+F3'), true);
  assert.equal(isFunctionKey('Ctrl+F'), false);
  assert.deepEqual([...splitBinding('Ctrl+Shift+S').mods], ['Ctrl', 'Shift']);
});

test('recording: letters, Ctrl/Shift/Alt/Meta combinations, function and navigation keys', () => {
  assert.equal(bindingFromEvent(ev('k', 'KeyK', { ctrlKey: true })), 'Ctrl+K');
  assert.equal(bindingFromEvent(ev('K', 'KeyK', { ctrlKey: true, shiftKey: true })), 'Ctrl+Shift+K');
  assert.equal(bindingFromEvent(ev('K', 'KeyK', { ctrlKey: true })), 'Ctrl+K', 'Caps Lock gives no Shift');
  assert.equal(bindingFromEvent(ev('F6', 'F6')), 'F6');
  assert.equal(bindingFromEvent(ev('PageDown', 'PageDown')), 'PageDown');
  assert.equal(bindingFromEvent(ev('Home', 'Home', { altKey: true })), 'Alt+Home');
  assert.equal(bindingFromEvent(ev('q', 'KeyQ')), 'Q');
  assert.equal(bindingFromEvent(ev('k', 'KeyK', { metaKey: true })), 'Meta+K');
});

test('recording: the layout does not change the combination', () => {
  // Shift+1 gives '!' on the key, the physical key is 1.
  assert.equal(bindingFromEvent(ev('!', 'Digit1', { shiftKey: true })), 'Shift+1');
  // Ctrl+Shift+= gives '+'.
  assert.equal(bindingFromEvent(ev('+', 'Equal', { ctrlKey: true, shiftKey: true })), 'Ctrl+Shift+=');
  // A Cyrillic layout gives another letter; the physical key counts.
  assert.equal(bindingFromEvent(ev('м', 'KeyV', { ctrlKey: true })), 'Ctrl+V');
  // Option on macOS gives a special character.
  assert.equal(bindingFromEvent(ev('ß', 'KeyS', { altKey: true })), 'Alt+S');
  // AZERTY: the unshifted digit row gives '&'.
  assert.equal(bindingFromEvent(ev('&', 'Digit1', { ctrlKey: true })), 'Ctrl+1');
});

test('recording ignores a modifier pressed on its own', () => {
  for (const key of ['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock']) {
    assert.equal(bindingFromEvent(ev(key, `${key}Left`, { ctrlKey: key === 'Control' })), null, key);
    assert.deepEqual(eventCandidates(ev(key, `${key}Left`)), [], key);
  }
  assert.equal(bindingFromEvent(ev('Dead', 'Quote')), "'");
  assert.equal(bindingFromEvent(ev('Unidentified', '')), null);
});

test('an event stands for its character, its physical key and Cmd read as Ctrl', () => {
  assert.deepEqual(eventCandidates(ev('k', 'KeyK', { ctrlKey: true })), ['Ctrl+K']);
  assert.deepEqual(eventCandidates(ev('+', 'Equal', { ctrlKey: true, shiftKey: true })), ['Ctrl+Shift+Plus', 'Ctrl+Shift+=']);
  assert.deepEqual(eventCandidates(ev('1', 'Numpad1')), ['1', 'Numpad1']);
  assert.deepEqual(eventCandidates(ev('s', 'KeyS', { metaKey: true })), ['Meta+S', 'Ctrl+S']);
  assert.deepEqual(eventCandidates(ev('м', 'KeyV')), ['V']);
});

test('keyFromCode and normalizeKeyName', () => {
  assert.equal(keyFromCode('KeyA'), 'A');
  assert.equal(keyFromCode('Digit0'), '0');
  assert.equal(keyFromCode('NumpadEnter'), 'Enter');
  assert.equal(keyFromCode('IntlRo'), null);
  assert.equal(normalizeKeyName(' '), 'Space');
  assert.equal(normalizeKeyName('ArrowLeft'), 'ArrowLeft');
});

test('the event fields of a combination give that combination back', () => {
  for (const c of ['Ctrl+N', 'Ctrl+Shift+S', 'Delete', 'F3', 'Shift+F3', 'Ctrl+=', 'Ctrl+-', 'Ctrl+,', 'V', '1',
    'Ctrl+Shift+=', 'Ctrl+Shift+NumpadAdd', 'Ctrl+Shift+NumpadSubtract', 'Alt+PageDown', 'Ctrl+Plus']) {
    const f = eventFieldsFor(c);
    assert.ok(eventCandidates(f).includes(c), `${c}: ${JSON.stringify(f)}`);
  }
  assert.deepEqual(eventFieldsFor('Ctrl+Shift+='), { key: '=', code: 'Equal', ctrlKey: true, altKey: false, shiftKey: true, metaKey: false });
  assert.equal(eventFieldsFor('V').key, 'v');
  assert.equal(eventFieldsFor('nonsense+'), null);
});
