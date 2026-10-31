// Ready-made shortcut sets (#886): the preset must only name commands that
// exist, give every key one owner (defaults it takes over are moved), survive
// Export and Import unchanged, and never replace the user's own shortcuts
// without asking.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseShortcutsFile, serializeShortcutsFile } from './io.js';
import { CORE_COMMANDS, RIBBON_ALIASES } from './default-commands.js';
import { RIBBON_COMMANDS } from './ribbon-commands.generated.js';
import { createKeybindingRegistry } from './registry.js';
import { customShortcutFor } from './dispatch.js';
import { eventFieldsFor } from './binding.js';
import { SHORTCUT_PRESETS, presetById, presetOverrides, vervangtEigenSneltoetsen } from './presets.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const LOCALES = join(HIER, '../../i18n/locales');
const preset = presetById('markup-style');

function registry() {
  const r = createKeybindingRegistry();
  for (const def of CORE_COMMANDS) r.define(def);
  for (const def of RIBBON_COMMANDS) if (!RIBBON_ALIASES[def.id]) r.define({ id: `ribbon:#${def.id}` });
  return r;
}

test('the markup-style preset only names known commands and leaves no key with two owners', () => {
  assert.ok(preset);
  const r = registry();
  r.setOverrides(presetOverrides(preset));
  for (const id of Object.keys(preset.shortcuts)) assert.ok(r.has(id), id);
  const owners = new Map();
  for (const command of r.commands()) {
    for (const combo of r.bindingsOf(command.id)) {
      assert.ok(!owners.has(combo), `${combo}: ${owners.get(combo)} and ${command.id}`);
      owners.set(combo, command.id);
      assert.equal(r.ownerOf(combo), command.id);
    }
  }
  assert.equal(r.ownerOf('H'), 'tool.highlight');
  assert.equal(r.ownerOf('Shift+V'), 'tool.hand');
  assert.equal(r.ownerOf('F11'), 'view.fullscreen');
  assert.equal(r.ownerOf('Alt+L'), 'panels.annotationsList');
  assert.equal(r.ownerOf('Ctrl+2'), 'view.splitVertical');
  assert.equal(r.ownerOf('Ctrl+9'), 'view.fitPage');
});

test('every preset is a valid shortcuts file and survives Export and Import unchanged', () => {
  const ids = new Set();
  for (const p of SHORTCUT_PRESETS) {
    assert.ok(!ids.has(p.id), `preset id ${p.id} twice`);
    ids.add(p.id);
    assert.match(p.id, /^[a-z][a-z0-9-]*$/);
    const tekst = serializeShortcutsFile(presetOverrides(p));
    const r = parseShortcutsFile(tekst);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.overrides, presetOverrides(p));
    // Export after loading writes the same file again.
    const reg = registry();
    reg.setOverrides(r.overrides);
    assert.equal(serializeShortcutsFile(reg.getOverrides()), tekst);
  }
});

test('Reset all after the preset restores the displaced defaults', () => {
  const r = registry();
  r.setOverrides(presetOverrides(preset));
  r.setOverrides({});
  assert.equal(r.ownerOf('H'), 'tool.hand');
  assert.equal(r.ownerOf('F11'), 'panels.annotationsList');
  assert.equal(r.ownerOf('Ctrl+2'), 'view.fitPage');
});

test('preset shortcuts dispatch normally but never steal typing or dialog keys', () => {
  const r = registry();
  r.setOverrides(presetOverrides(preset));
  for (const combo of ['H', 'P', 'R', 'Alt+Shift+L']) {
    const event = eventFieldsFor(combo);
    assert.equal(customShortcutFor(event, r)?.id, r.ownerOf(combo));
    assert.equal(customShortcutFor(event, r, { inTextEntry: true }), null);
    assert.equal(customShortcutFor(event, r, { modalOpen: true }), null);
  }
});

test('the working copy gets its own copy of the preset', () => {
  const a = presetOverrides(preset);
  a['tool.highlight'].push('Ctrl+Alt+H');
  assert.deepEqual(presetById('markup-style').shortcuts['tool.highlight'], ['H']);
});

test('replacing asks first only when the user has own shortcuts that would change', () => {
  const nieuw = presetOverrides(preset);
  assert.equal(vervangtEigenSneltoetsen({}, nieuw), false, 'only defaults: nothing to lose');
  assert.equal(vervangtEigenSneltoetsen(undefined, nieuw), false);
  assert.equal(vervangtEigenSneltoetsen(presetOverrides(preset), nieuw), false, 'the same set again');
  assert.equal(vervangtEigenSneltoetsen({ 'file.save': ['Ctrl+Alt+S'] }, nieuw), true);
  assert.equal(vervangtEigenSneltoetsen({ 'tool.highlight': ['H', 'Ctrl+Alt+H'] }, nieuw), true);
  assert.equal(vervangtEigenSneltoetsen({ 'file.close': [] }, {}), true, 'removing a default key is also an own setting');
});

test('Import and Load preset in the shortcuts tab go through the confirmation', () => {
  const bron = readFileSync(join(HIER, '../../solid/components/preferences/KeyboardShortcutsTab.jsx'), 'utf8');
  const importeer = bron.slice(bron.indexOf('async function importeer('), bron.indexOf('const Toets'));
  assert.match(bron, /vervangtEigenSneltoetsen\(huidig\(\), nieuw\)/);
  assert.match(importeer, /await vervang\(r\.overrides\)/);
  assert.doesNotMatch(importeer, /setOverrides\(/, 'Import does not replace without asking');
  assert.match(bron, /await vervang\(presetOverrides\(preset\)\)/);
});

test('all 40 locales have the preset texts, translated', () => {
  const locales = readdirSync(LOCALES);
  assert.equal(locales.length, 40);
  const lees = (l) => JSON.parse(readFileSync(join(LOCALES, l, 'preferences.json'), 'utf8')).keyboardShortcuts;
  const en = lees('en');
  for (const l of locales) {
    const ks = lees(l);
    for (const [naam, waarde] of [
      ['loadPreset', ks.loadPreset],
      ['replaceConfirm', ks.replaceConfirm],
      ...SHORTCUT_PRESETS.map((p) => [p.labelKey, p.labelKey.split('.').slice(1).reduce((o, k) => o?.[k], ks)]),
    ]) {
      assert.equal(typeof waarde, 'string', `${l} ${naam} missing`);
      assert.ok(waarde.trim(), `${l} ${naam} empty`);
    }
    if (l !== 'en') assert.notEqual(ks.replaceConfirm, en.replaceConfirm, `${l} replaceConfirm is English`);
  }
  assert.equal(en.presets.markupStyle, SHORTCUT_PRESETS[0].label);
});
