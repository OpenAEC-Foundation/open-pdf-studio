// The keyboard shortcut registry (#714): conflicts, reassigning, removing,
// resetting, and what is stored.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createKeybindingRegistry, assignBinding, removeBinding, resetCommand, effectiveBindings,
  sanitizeOverrides, buildIndex, ownerOf, isModified, isValidCommandId,
} from './registry.js';

function maak() {
  const r = createKeybindingRegistry();
  r.define({ id: 'file.save', category: 'file', label: 'Save', defaults: ['Ctrl+S'] });
  r.define({ id: 'edit.redo', category: 'edit', label: 'Redo', defaults: ['Ctrl+Y', 'ctrl+shift+z'] });
  r.define({ id: 'view.fitPage', category: 'view', label: 'Fit Page', defaults: ['Ctrl+2'] });
  r.define({ id: 'tool.select', category: 'tools', label: 'Select', defaults: ['V'] });
  r.define({ id: 'ribbon:#insert-page', category: 'ribbon:organize', label: 'Insert page' });
  return r;
}

test('defaults are stored in canonical form and are the effective shortcuts without overrides', () => {
  const r = maak();
  assert.deepEqual(r.defaultsOf('edit.redo'), ['Ctrl+Y', 'Ctrl+Shift+Z']);
  assert.deepEqual(r.bindingsOf('edit.redo'), ['Ctrl+Y', 'Ctrl+Shift+Z']);
  assert.equal(r.ownerOf('ctrl+shift+z'), 'edit.redo');
  assert.equal(r.ownerOf('Ctrl+K'), null);
  assert.equal(r.isDefaultActive('file.save', 'Ctrl+S'), true);
  assert.equal(r.isDefaultActive('file.save', 'Ctrl+Y'), false);
});

test('give a command without a shortcut one (a ribbon command)', () => {
  const r = maak();
  const { overrides, conflict, combo } = assignBinding(r.model, {}, 'ribbon:#insert-page', 'Ctrl+Alt+I');
  assert.equal(conflict, null);
  assert.equal(combo, 'Ctrl+Alt+I');
  assert.deepEqual(overrides, { 'ribbon:#insert-page': ['Ctrl+Alt+I'] });
  r.setOverrides(overrides);
  assert.equal(r.ownerOf('Ctrl+Alt+I'), 'ribbon:#insert-page');
});

test('a command can have more than one shortcut', () => {
  const r = maak();
  let ov = assignBinding(r.model, {}, 'view.fitPage', 'F6').overrides;
  ov = assignBinding(r.model, ov, 'view.fitPage', 'Ctrl+K').overrides;
  assert.deepEqual(effectiveBindings(r.model, ov, 'view.fitPage'), ['Ctrl+2', 'F6', 'Ctrl+K']);
});

test('a combination that is taken is a conflict naming the other command; nothing changes', () => {
  const r = maak();
  const voor = {};
  const uit = assignBinding(r.model, voor, 'view.fitPage', 'Ctrl+S');
  assert.equal(uit.conflict, 'file.save');
  assert.equal(uit.overrides, voor);
  // Also a combination that an override gave to someone.
  const ov = assignBinding(r.model, {}, 'ribbon:#insert-page', 'F6').overrides;
  assert.equal(assignBinding(r.model, ov, 'view.fitPage', 'F6').conflict, 'ribbon:#insert-page');
  // Assigning a command its own key is no conflict and no change.
  assert.equal(assignBinding(r.model, {}, 'file.save', 'Ctrl+S').conflict, null);
  assert.deepEqual(assignBinding(r.model, {}, 'file.save', 'Ctrl+S').overrides, {});
});

test('reassign moves the combination to the new command', () => {
  const r = maak();
  const { overrides } = assignBinding(r.model, {}, 'view.fitPage', 'Ctrl+S', { reassign: true });
  assert.deepEqual(overrides, { 'file.save': [], 'view.fitPage': ['Ctrl+2', 'Ctrl+S'] });
  r.setOverrides(overrides);
  assert.equal(r.ownerOf('Ctrl+S'), 'view.fitPage');
  assert.equal(r.isDefaultActive('file.save', 'Ctrl+S'), false);
  assert.deepEqual(r.bindingsOf('file.save'), []);
  // One of two defaults: the other one stays.
  const twee = assignBinding(r.model, {}, 'view.fitPage', 'Ctrl+Y', { reassign: true }).overrides;
  assert.deepEqual(effectiveBindings(r.model, twee, 'edit.redo'), ['Ctrl+Shift+Z']);
});

test('remove a shortcut; removing all defaults is stored as an empty list', () => {
  const r = maak();
  let ov = removeBinding(r.model, {}, 'edit.redo', 'Ctrl+Y');
  assert.deepEqual(ov, { 'edit.redo': ['Ctrl+Shift+Z'] });
  ov = removeBinding(r.model, ov, 'edit.redo', 'Ctrl+Shift+Z');
  assert.deepEqual(ov, { 'edit.redo': [] });
  assert.equal(ownerOf(r.model, ov, 'Ctrl+Y'), null);
  // Removing what is not there changes nothing.
  assert.equal(removeBinding(r.model, ov, 'edit.redo', 'F9'), ov);
});

test('an override equal to the defaults is not stored', () => {
  const r = maak();
  let ov = removeBinding(r.model, {}, 'file.save', 'Ctrl+S');
  assert.ok(isModified(ov, 'file.save'));
  ov = assignBinding(r.model, ov, 'file.save', 'Ctrl+S').overrides;
  assert.deepEqual(ov, {});
  assert.equal(isModified(ov, 'file.save'), false);
});

test('reset one command, also taking back a default another command took', () => {
  const r = maak();
  let ov = assignBinding(r.model, {}, 'view.fitPage', 'Ctrl+S', { reassign: true }).overrides;
  ov = assignBinding(r.model, ov, 'file.save', 'F2').overrides;
  ov = resetCommand(r.model, ov, 'file.save');
  assert.equal(isModified(ov, 'file.save'), false);
  assert.equal(ownerOf(r.model, ov, 'Ctrl+S'), 'file.save');
  assert.deepEqual(effectiveBindings(r.model, ov, 'view.fitPage'), ['Ctrl+2'], 'fitPage gave Ctrl+S back');
  assert.deepEqual(ov, {});
});

test('reset all is the empty set of overrides', () => {
  const r = maak();
  r.setOverrides({ 'file.save': [], 'view.fitPage': ['F6'] });
  r.setOverrides({});
  assert.deepEqual(r.bindingsOf('file.save'), ['Ctrl+S']);
  assert.deepEqual(r.bindingsOf('view.fitPage'), ['Ctrl+2']);
});

test('an override beats a default that claims the same key (e.g. a new default after an update)', () => {
  const r = maak();
  // The user gave F6 to insert-page; a later version gives fitPage F6 as default.
  r.setOverrides({ 'ribbon:#insert-page': ['F6'] });
  r.define({ id: 'view.fitPage', category: 'view', label: 'Fit Page', defaults: ['Ctrl+2', 'F6'] });
  assert.equal(r.ownerOf('F6'), 'ribbon:#insert-page');
  assert.equal(r.isDefaultActive('view.fitPage', 'F6'), false);
  assert.equal(r.isDefaultActive('view.fitPage', 'Ctrl+2'), true);
});

test('stored overrides: only differences, unknown commands kept, garbage dropped', () => {
  const schoon = sanitizeOverrides({
    'view.fitPage': ['ctrl+k', 'Ctrl+K', 'nonsense+'],
    'ext:other-pc:thing': ['F8'],
    'file.save': [],
    'bad id with <script>': ['F9'],
    'tool.select': 'V',
    'tool.hand': ['Ctrl+K'],
  });
  // Ctrl+K twice: the first id in sorted order keeps it, the same on every machine.
  assert.deepEqual(schoon, { 'ext:other-pc:thing': ['F8'], 'file.save': [], 'tool.hand': ['Ctrl+K'], 'view.fitPage': [] });
  assert.deepEqual(sanitizeOverrides(null), {});
  assert.deepEqual(sanitizeOverrides(['x']), {});
  const r = maak();
  r.setOverrides(schoon);
  assert.deepEqual(r.getOverrides()['ext:other-pc:thing'], ['F8'], 'kept for when the extension appears');
});

test('setOverrides notifies listeners; providers add commands', () => {
  const r = maak();
  let n = 0;
  r.subscribe(() => n++);
  r.setOverrides({ 'file.save': [] });
  assert.equal(n, 1);
  let lijst = [{ id: 'ext:demo:hello', category: 'extensions', label: 'Hello' }];
  const weg = r.addProvider(() => lijst);
  assert.ok(r.has('ext:demo:hello'));
  lijst = [];
  r.refresh();
  assert.equal(r.has('ext:demo:hello'), false);
  weg();
  assert.ok(n >= 3);
});

test('the index lists every bound combination once', () => {
  const r = maak();
  const index = buildIndex(r.model, { 'view.fitPage': ['F6'] });
  assert.equal(index.get('F6'), 'view.fitPage');
  assert.equal(index.has('Ctrl+2'), false);
  assert.equal(index.get('Ctrl+S'), 'file.save');
});

test('command ids', () => {
  for (const id of ['file.save', 'ribbon:#fit-page-ribbon', 'ext:my-ext:do=option', 'ext:@scope/x:y']) assert.ok(isValidCommandId(id), id);
  for (const id of ['', 'a<b', 'x'.repeat(201), 5, null]) assert.equal(isValidCommandId(id), false, String(id));
  const r = createKeybindingRegistry();
  assert.throws(() => r.define({ id: '<bad>' }));
});
