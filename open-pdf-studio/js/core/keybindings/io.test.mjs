// The keyboard shortcuts file (#714): exported on one PC, imported on
// another, gives the same shortcuts; anything malformed is rejected whole.

import assert from 'node:assert/strict';
import test from 'node:test';
import { serializeShortcutsFile, parseShortcutsFile, FILE_FORMAT, FILE_VERSION } from './io.js';
import { createKeybindingRegistry } from './registry.js';

const OV = { 'view.fitPage': ['Ctrl+K', 'F6'], 'file.save': [], 'ext:demo:hello': ['Ctrl+Alt+H'] };

test('export, then import gives the same overrides', () => {
  const tekst = serializeShortcutsFile(OV, { appVersion: '1.33.0' });
  const data = JSON.parse(tekst);
  assert.equal(data.format, FILE_FORMAT);
  assert.equal(data.version, FILE_VERSION);
  assert.equal(data.app, '1.33.0');
  assert.deepEqual(Object.keys(data.shortcuts), ['ext:demo:hello', 'file.save', 'view.fitPage'], 'sorted');
  const r = parseShortcutsFile(tekst);
  assert.equal(r.ok, true);
  assert.deepEqual(r.overrides, OV);
});

test('the same set gives the same file, and another PC ends up with the same shortcuts', () => {
  const omgekeerd = Object.fromEntries(Object.entries(OV).reverse());
  assert.equal(serializeShortcutsFile(OV), serializeShortcutsFile(omgekeerd));
  const pc1 = createKeybindingRegistry();
  const pc2 = createKeybindingRegistry();
  for (const r of [pc1, pc2]) {
    r.define({ id: 'view.fitPage', defaults: ['Ctrl+2'] });
    r.define({ id: 'file.save', defaults: ['Ctrl+S'] });
  }
  pc1.setOverrides(OV);
  pc2.setOverrides({ 'file.save': ['F12'] }); // what PC 2 had before
  const r = parseShortcutsFile(serializeShortcutsFile(pc1.getOverrides()));
  pc2.setOverrides(r.overrides);
  for (const id of ['view.fitPage', 'file.save']) assert.deepEqual(pc2.bindingsOf(id), pc1.bindingsOf(id), id);
  assert.equal(pc2.ownerOf('F12'), null, 'an import replaces, it does not merge');
});

test('combinations are read leniently and stored canonically', () => {
  const r = parseShortcutsFile(JSON.stringify({ format: FILE_FORMAT, version: 1, shortcuts: { 'view.fitPage': ['ctrl+k', 'Strg+K', 'shift+f3'] } }));
  assert.deepEqual(r.overrides, { 'view.fitPage': ['Ctrl+K', 'Shift+F3'] });
  // A byte order mark from an editor is fine.
  assert.equal(parseShortcutsFile('﻿' + serializeShortcutsFile({})).ok, true);
});

test('malformed files are rejected', () => {
  const geval = (data) => parseShortcutsFile(typeof data === 'string' ? data : JSON.stringify(data));
  const goed = (shortcuts) => ({ format: FILE_FORMAT, version: 1, shortcuts });
  const fouten = [
    ['not json', 'notJson'],
    [[1, 2], 'wrongFormat'],
    [{ shortcuts: {} }, 'wrongFormat'],
    [{ format: 'something-else', version: 1, shortcuts: {} }, 'wrongFormat'],
    [{ format: FILE_FORMAT, version: '1', shortcuts: {} }, 'wrongFormat'],
    [{ format: FILE_FORMAT, version: 99, shortcuts: {} }, 'unsupportedVersion'],
    [{ format: FILE_FORMAT, version: 1 }, 'invalidShortcuts'],
    [goed([]), 'invalidShortcuts'],
    [goed({ 'view.fitPage': 'Ctrl+K' }), 'invalidShortcuts'],
    [goed({ 'bad<id>': ['F6'] }), 'invalidCommand'],
    [goed({ 'view.fitPage': ['Ctrl+Nonsense'] }), 'invalidBinding'],
    [goed({ 'view.fitPage': [42] }), 'invalidBinding'],
    [goed({ 'view.fitPage': ['Escape'] }), 'invalidBinding'],
    [goed({ 'view.fitPage': ['Ctrl+Tab'] }), 'invalidBinding'],
    [goed({ 'view.fitPage': ['F6'], 'file.save': ['f6'] }), 'duplicateBinding'],
    [goed({ 'view.fitPage': Array(40).fill('F6') }), 'invalidShortcuts'],
  ];
  for (const [data, code] of fouten) {
    const r = geval(data);
    assert.equal(r.ok, false, JSON.stringify(data));
    assert.equal(r.error, code, JSON.stringify(data));
  }
  assert.equal(parseShortcutsFile(null).ok, false);
  assert.equal(parseShortcutsFile('x'.repeat(2 * 1024 * 1024)).error, 'tooLarge');
});
