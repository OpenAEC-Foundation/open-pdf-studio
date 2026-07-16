import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const repoRoot = new URL('../../', import.meta.url);
const appRoot = new URL('../', import.meta.url);

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, appRoot), 'utf8'));
}

test('desktop runtime resources stay on their own platform', async () => {
  const base = await readJson('src-tauri/tauri.conf.json');
  const linux = await readJson('src-tauri/tauri.linux.conf.json');
  const windows = await readJson('src-tauri/tauri.windows.conf.json');

  const baseResources = base.bundle.resources;
  const linuxResources = { ...baseResources, ...linux.bundle.resources };
  const windowsResources = { ...baseResources, ...windows.bundle.resources };

  assert.equal(linuxResources['binaries/win-x64/pdfium.dll'], undefined);
  assert.equal(linuxResources['WebView2Loader.dll'], undefined);
  assert.equal(
    linuxResources['binaries/linux-x64/libpdfium.so'],
    'libpdfium.so',
  );

  assert.equal(
    windowsResources['binaries/win-x64/pdfium.dll'],
    'pdfium.dll',
  );
  assert.equal(
    windowsResources['WebView2Loader.dll'],
    'WebView2Loader.dll',
  );
  assert.equal(
    base.bundle.windows.webviewInstallMode.type,
    'embedBootstrapper',
  );
});

test('CI builds and starts the AppImage on Debian 13', async () => {
  const workflow = await readFile(
    new URL('.github/workflows/ci.yml', repoRoot),
    'utf8',
  );

  assert.match(workflow, /Fetch libpdfium\.so \(Linux\)/);
  assert.match(
    workflow,
    /tauri build -- --bundles appimage --config '\{"bundle":\{"createUpdaterArtifacts":false\}\}'/,
  );
  assert.match(workflow, /find \.\.\/target\/release\/bundle\/appimage/);
  assert.match(workflow, /appimage=\$\(realpath "\$appimage"\)/);
  assert.match(workflow, /debian:13-slim/);
  assert.match(workflow, /gvfs/);
  assert.match(workflow, /libegl1/);
  assert.match(workflow, /libgles2/);
  assert.match(workflow, /libgtk-3-0t64/);
  assert.match(workflow, /linux-appimage-smoke\.sh/);
});

test('the AppImage GIO guard runs before Tauri setup', async () => {
  const main = await readFile(new URL('src-tauri/src/main.rs', appRoot), 'utf8');
  const guard = main.indexOf('configure_appimage_gio_modules();');
  const tauri = main.indexOf('app_lib::run(');

  assert.notEqual(guard, -1);
  assert.notEqual(tauri, -1);
  assert.ok(guard < tauri);
});
