import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = path.resolve(projectDir, '..');

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(projectDir, relativePath), 'utf8'));
}

test('the primary window is visible from native creation', async () => {
  const config = await readJson('src-tauri/tauri.conf.json');
  assert.equal(config.app.windows[0].visible, true);
});

test('macOS native runtime preparation is wired into local and release builds', async () => {
  const pkg = await readJson('package.json');
  assert.match(pkg.scripts.predev, /prepare:native-runtime/);
  assert.match(pkg.scripts.prebuild, /prepare:native-runtime/);
  assert.equal(pkg.scripts['prepare:native-runtime'], 'node scripts/native-runtime.mjs');
});

test('quality tests do not depend on shell glob expansion', async () => {
  const pkg = await readJson('package.json');
  assert.doesNotMatch(pkg.scripts['test:quality'], /\*/);
  for (const name of [
    'native-runtime.test.mjs',
    'release-config.test.mjs',
    'square-image-annotation.test.mjs',
  ]) {
    assert.match(pkg.scripts['test:quality'], new RegExp(name.replaceAll('.', '\\.')));
  }
});

test('render regression caches the workspace target and allows cold CI builds', async () => {
  const workflow = await readFile(path.join(repoDir, '.github', 'workflows', 'render-regression.yml'), 'utf8');
  const runner = await readFile(path.join(repoDir, 'scripts', 'run-render-regression.mjs'), 'utf8');
  assert.match(workflow, /^\s+target\s*$/m);
  assert.doesNotMatch(workflow, /open-pdf-studio\/src-tauri\/target/);
  assert.doesNotMatch(workflow, /open-pdf-render\/target/);
  assert.match(workflow, /OPS_STARTUP_TIMEOUT_MS:\s*'600000'/);
  assert.match(runner, /process\.env\.OPS_STARTUP_TIMEOUT_MS/);
});

test('Windows installers retain the embedded WebView2 bootstrapper and loader', async () => {
  const config = await readJson('src-tauri/tauri.conf.json');
  assert.deepEqual(config.bundle.windows.webviewInstallMode, {
    type: 'embedBootstrapper',
    silent: true,
  });
  assert.equal(config.bundle.resources['WebView2Loader.dll'], 'WebView2Loader.dll');
});

test('CI exercises macOS 26 startup and frontend readiness', async () => {
  const workflow = await readFile(path.join(repoDir, '.github', 'workflows', 'ci.yml'), 'utf8');
  const smoke = await readFile(path.join(projectDir, 'scripts', 'macos-startup-smoke.sh'), 'utf8');
  assert.match(workflow, /macos-26/);
  assert.match(workflow, /npm run prepare:native-runtime/);
  assert.match(workflow, /macos-startup-smoke\.sh/);
  assert.match(workflow, /createUpdaterArtifacts\\?"?:false/);
  assert.match(smoke, /survival_seconds=10/);
  assert.match(smoke, /kill -0 "\$pid"/);
  assert.match(smoke, /new_crash_report/);
});

test('release workflows verify macOS signatures and notarization', async () => {
  for (const name of ['release.yml', 'nightly.yml']) {
    const workflow = await readFile(path.join(repoDir, '.github', 'workflows', name), 'utf8');
    assert.match(workflow, /codesign --verify --deep --strict/);
    assert.match(workflow, /spctl --assess --type execute/);
    assert.match(workflow, /xcrun stapler validate/);
    assert.match(workflow, /macos-startup-smoke\.sh/);
    assert.match(workflow, /APPLE_SIGNING_IDENTITY/);
  }
});

test('all release metadata targets version 1.78.0', async () => {
  const pkg = await readJson('package.json');
  const packageLock = await readJson('package-lock.json');
  const config = await readJson('src-tauri/tauri.conf.json');
  const cargo = await readFile(path.join(projectDir, 'src-tauri', 'Cargo.toml'), 'utf8');
  const release = await readFile(path.join(repoDir, '.github', 'workflows', 'release.yml'), 'utf8');
  const cargoLock = await readFile(path.join(repoDir, 'Cargo.lock'), 'utf8');

  assert.equal(pkg.version, '1.78.0');
  assert.equal(packageLock.version, '1.78.0');
  assert.equal(packageLock.packages[''].version, '1.78.0');
  assert.equal(config.version, '1.78.0');
  assert.match(cargo, /^version = "1\.78\.0"$/m);
  assert.match(release, /default: 'v1\.78\.0'/);
  assert.match(cargoLock, /name = "open-pdf-studio"\r?\nversion = "1\.78\.0"/);
});

test('development optimization profiles live at the workspace root', async () => {
  const workspaceCargo = await readFile(path.join(repoDir, 'Cargo.toml'), 'utf8');
  const appCargo = await readFile(path.join(projectDir, 'src-tauri', 'Cargo.toml'), 'utf8');
  assert.match(workspaceCargo, /\[profile\.dev\.package\.open-pdf-render\]/);
  assert.match(workspaceCargo, /\[profile\.dev\.package\.pdfium-render\]/);
  assert.doesNotMatch(appCargo, /\[profile\./);
});
