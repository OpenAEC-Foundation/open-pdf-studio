import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { normalizeStartupTool } from './startup-tool.js';
import { voegSamenMetStandaarden } from './preferences-merge.js';

test('old profiles and invalid startup tools fall back to Select, Hand survives storage round trip', () => {
  for (const value of [undefined, null, '', false, 0, {}, [], 'rectangle', 'pan', 'HAND', 'select']) {
    assert.equal(normalizeStartupTool(value), 'select');
  }
  const saved = JSON.parse(JSON.stringify({ startupTool: 'hand' }));
  const loaded = voegSamenMetStandaarden({ startupTool: 'select' }, saved);
  assert.equal(normalizeStartupTool(loaded.startupTool), 'hand');
  assert.equal(normalizeStartupTool(voegSamenMetStandaarden({ startupTool: 'select' }, {}).startupTool), 'select');
});

test('all shipped locales describe the startup choice and both navigation tools', () => {
  const root = new URL('../i18n/locales/', import.meta.url);
  for (const locale of readdirSync(root)) {
    const prefs = JSON.parse(readFileSync(new URL(`${locale}/preferences.json`, root)));
    const ribbon = JSON.parse(readFileSync(new URL(`${locale}/ribbon.json`, root)));
    for (const label of [prefs.general.startupTool, ribbon.home.select, ribbon.home.hand]) {
      assert.ok(typeof label === 'string' && label.trim(), locale);
    }
  }
});
