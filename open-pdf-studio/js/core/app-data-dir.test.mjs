import test from 'node:test';
import assert from 'node:assert/strict';
import { getAppDataDir } from './platform.js';

function zetTauri(tauri) {
  globalThis.window = { __TAURI__: tauri };
}

test('getAppDataDir: effectieve map uit Rust wint (OPDS_DATA_DIR-override)', async () => {
  const aanroepen = [];
  zetTauri({
    core: { invoke: async (cmd) => { aanroepen.push(cmd); return 'C:/rig/org.openaec.openpdfstudio'; } },
    path: { appDataDir: async () => 'C:/Users/x/AppData/Roaming/org.openaec.openpdfstudio' },
  });
  assert.equal(await getAppDataDir(), 'C:/rig/org.openaec.openpdfstudio');
  assert.deepEqual(aanroepen, ['app_data_dir_effectief']);
});

test('getAppDataDir: terugval op appDataDir als het commando ontbreekt', async () => {
  zetTauri({
    core: { invoke: async () => { throw new Error('command not found'); } },
    path: { appDataDir: async () => 'C:/Roaming/org.openaec.openpdfstudio' },
  });
  assert.equal(await getAppDataDir(), 'C:/Roaming/org.openaec.openpdfstudio');
  delete globalThis.window;
});
