import assert from 'node:assert/strict';
import test from 'node:test';

import { preferencesMirrorJson } from './preferences-mirror.js';

test('Tauri-spiegel bevat alleen het thema — megabytes symboolgeometrie blijven eruit', () => {
  const prefs = { theme: 'warm-ember', customSymbolGroups: [{ svg: 'x'.repeat(100000) }] };
  const json = preferencesMirrorJson(prefs, true);
  assert.equal(json, '{"theme":"warm-ember"}');
  assert.ok(json.length < 100);
});

test('browser-spiegel (geen Tauri) bevat het volledige object — daar ís localStorage de opslag', () => {
  const prefs = { theme: 'default', authorName: 'x' };
  assert.deepEqual(JSON.parse(preferencesMirrorJson(prefs, false)), prefs);
});

test('ontbrekende voorkeuren geven een parseerbaar object', () => {
  assert.deepEqual(JSON.parse(preferencesMirrorJson(undefined, true)), {});
});
