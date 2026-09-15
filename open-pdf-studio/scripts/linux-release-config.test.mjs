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

test('every AppImage build excludes the same display-stack libraries (#362)', async () => {
  const expected = [
    'libwayland-client.so', 'libwayland-cursor.so', 'libwayland-egl.so', 'libwayland-server.so',
    'libxkbcommon.so', 'libxcb-randr.so', 'libxcb-render.so', 'libxcb-shm.so',
    'libXau.so', 'libXdmcp.so',
  ];
  const values = [];
  for (const name of ['ci.yml', 'release.yml', 'nightly.yml']) {
    const workflow = await readFile(new URL(`.github/workflows/${name}`, repoRoot), 'utf8');
    const match = workflow.match(/LINUXDEPLOY_EXCLUDED_LIBRARIES: '([^']+)'/);
    assert.ok(match, `${name} sets LINUXDEPLOY_EXCLUDED_LIBRARIES`);
    values.push(match[1]);
  }
  assert.deepEqual(values[0].split(';'), expected.map((lib) => `${lib}*`));
  assert.equal(values[1], values[0], 'release.yml matches ci.yml');
  assert.equal(values[2], values[0], 'nightly.yml matches ci.yml');

  const smoke = await readFile(new URL('scripts/linux-appimage-smoke.sh', appRoot), 'utf8');
  const smokeLibs = smoke.match(/display_stack_libs=\(([^)]+)\)/);
  assert.ok(smokeLibs, 'smoke script lists the display-stack libraries');
  assert.deepEqual(smokeLibs[1].trim().split(/\s+/), expected);
});

test('CI starts the AppImage on Fedora 44', async () => {
  const workflow = await readFile(new URL('.github/workflows/ci.yml', repoRoot), 'utf8');
  assert.match(workflow, /Verify AppImage on Fedora 44/);
  assert.match(workflow, /fedora:44/);
  assert.match(workflow, /xorg-x11-server-Xvfb/);
  assert.match(workflow, /mesa-libEGL/);
});
