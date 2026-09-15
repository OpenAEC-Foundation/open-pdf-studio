import assert from 'node:assert/strict';
import test from 'node:test';

import { bundleArgs } from './tauri-bundle-only.mjs';

test('tauri-actions build wordt tauri bundle, opties blijven staan', () => {
  assert.deepEqual(bundleArgs(['build']), ['run', 'tauri', '--', 'bundle']);
  assert.deepEqual(
    bundleArgs(['build', '--target', 'x86_64-pc-windows-msvc']),
    ['run', 'tauri', '--', 'bundle', '--target', 'x86_64-pc-windows-msvc'],
  );
});

test('andere commando\'s gaan ongewijzigd door naar de Tauri-CLI', () => {
  assert.deepEqual(bundleArgs(['info', '--json']), ['run', 'tauri', '--', 'info', '--json']);
});

test('zonder argumenten geen leeg commando', () => {
  assert.deepEqual(bundleArgs([]), ['run', 'tauri', '--']);
});
