import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseShortcutsFile, serializeShortcutsFile } from './io.js';
import { CORE_COMMANDS, RIBBON_ALIASES } from './default-commands.js';
import { RIBBON_COMMANDS } from './ribbon-commands.generated.js';
import { createKeybindingRegistry } from './registry.js';
import { customShortcutFor } from './dispatch.js';
import { eventFieldsFor } from './binding.js';
const text = readFileSync(new URL('../../../public/shortcuts/bluebeam-revu.json', import.meta.url), 'utf8');
const parsed = parseShortcutsFile(text);
function registry() {
  const r = createKeybindingRegistry();
  for (const def of CORE_COMMANDS) r.define(def);
  for (const def of RIBBON_COMMANDS) if (!RIBBON_ALIASES[def.id]) r.define({ id: `ribbon:#${def.id}` });
  return r;
}
test('bundled preset imports with known commands and no effective default collisions', () => {
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
  const r = registry(); r.setOverrides(parsed.overrides);
  const owners = new Map();
  for (const id of Object.keys(parsed.overrides)) assert.ok(r.has(id), id);
  for (const command of r.commands()) for (const combo of r.bindingsOf(command.id)) {
    assert.ok(!owners.has(combo), `${combo}: ${owners.get(combo)} and ${command.id}`);
    owners.set(combo, command.id);
    assert.equal(r.ownerOf(combo), command.id);
  }
  assert.equal(r.ownerOf('H'), 'tool.highlight');
  assert.equal(r.ownerOf('Shift+V'), 'tool.hand');
  assert.equal(r.ownerOf('F11'), 'view.fullscreen');
  assert.equal(r.ownerOf('Alt+L'), 'panels.annotationsList');
  assert.equal(r.ownerOf('Ctrl+2'), 'view.splitVertical');
  assert.equal(r.ownerOf('Ctrl+9'), 'view.fitPage');
});
test('preset round trips and reset restores displaced defaults', () => {
  const r = registry(); r.setOverrides(parsed.overrides);
  assert.deepEqual(parseShortcutsFile(serializeShortcutsFile(r.getOverrides())).overrides, parsed.overrides);
  r.setOverrides({});
  assert.equal(r.ownerOf('H'), 'tool.hand');
  assert.equal(r.ownerOf('F11'), 'panels.annotationsList');
  assert.equal(r.ownerOf('Ctrl+2'), 'view.fitPage');
});
test('preset shortcuts dispatch normally but never steal typing or dialog keys', () => {
  const r = registry(); r.setOverrides(parsed.overrides);
  for (const combo of ['H', 'P', 'R', 'Alt+Shift+L']) {
    const event = eventFieldsFor(combo);
    assert.equal(customShortcutFor(event, r)?.id, r.ownerOf(combo));
    assert.equal(customShortcutFor(event, r, { inTextEntry: true }), null);
    assert.equal(customShortcutFor(event, r, { modalOpen: true }), null);
  }
});
