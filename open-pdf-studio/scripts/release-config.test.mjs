import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { createRenderFixture } from './create-render-fixture.mjs';

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

test('render regression caches the workspace target and prebuilds cold CI jobs', async () => {
  const workflow = await readFile(path.join(repoDir, '.github', 'workflows', 'render-regression.yml'), 'utf8');
  const runner = await readFile(path.join(repoDir, 'scripts', 'run-render-regression.mjs'), 'utf8');
  assert.match(workflow, /^\s+target\s*$/m);
  assert.match(workflow, /uses: actions\/cache\/restore@v4/);
  assert.match(workflow, /uses: actions\/cache\/save@v4/);
  assert.match(workflow, /id: cargo-cache/);
  assert.match(workflow, /key: render-regression-v2-/);
  assert.match(workflow, /name: Prebuild desktop app/);
  assert.match(workflow, /cargo build -p open-pdf-studio/);
  assert.match(workflow, /name: Save cargo registry \+ target\s+if: steps\.cargo-cache\.outputs\.cache-hit != 'true'/);
  assert.doesNotMatch(workflow, /open-pdf-studio\/src-tauri\/target/);
  assert.doesNotMatch(workflow, /open-pdf-render\/target/);
  assert.match(workflow, /timeout-minutes: 45/);
  assert.match(runner, /const MAX_WAIT_MS = 600_000/);
});

test('render regression uses the bundled deterministic PDF fixture', async () => {
  const workflow = await readFile(path.join(repoDir, '.github', 'workflows', 'render-regression.yml'), 'utf8');
  const app = await readFile(path.join(projectDir, 'src-tauri', 'src', 'lib.rs'), 'utf8');
  const mcpServer = await readFile(path.join(projectDir, 'src-tauri', 'src', 'mcp_server.rs'), 'utf8');
  assert.match(workflow, /OPS_TEST_PDFS_DIR: \$\{\{ github\.workspace \}\}\/open-pdf-studio\/src-tauri\/resources\/kaders/);
  assert.match(workflow, /--pdf grootformaat_a1_liggend\.pdf/);
  assert.doesNotMatch(workflow, /Prepare deterministic render corpus/);
  assert.match(app, /mcp_server::resolve_test_pdfs_dir/);
  assert.match(mcpServer, /env!\("CARGO_MANIFEST_DIR"\)/);
  assert.doesNotMatch(mcpServer, /std::env::current_dir\(\)/);
});

test('generated render fixture is a complete one-page PDF', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'open-pdf-studio-render-'));
  const output = path.join(dir, 'render-fixture.pdf');
  try {
    await createRenderFixture(output);
    const bytes = await readFile(output);
    const pdf = await PDFDocument.load(bytes);
    assert.equal(pdf.getPageCount(), 1);
    assert.match(Buffer.from(bytes).subarray(-32).toString('latin1'), /%%EOF/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Windows installers retain the embedded WebView2 bootstrapper and loader', async () => {
  const config = await readJson('src-tauri/tauri.conf.json');
  const windows = await readJson('src-tauri/tauri.windows.conf.json');
  const resources = { ...config.bundle.resources, ...windows.bundle.resources };
  assert.deepEqual(config.bundle.windows.webviewInstallMode, {
    type: 'embedBootstrapper',
    silent: true,
  });
  assert.equal(resources['WebView2Loader.dll'], 'WebView2Loader.dll');
  assert.equal(resources['binaries/win-x64/pdfium.dll'], 'pdfium.dll');
});

test('Linux resources exclude Windows-only runtime files', async () => {
  const config = await readJson('src-tauri/tauri.conf.json');
  const linux = await readJson('src-tauri/tauri.linux.conf.json');
  const resources = { ...config.bundle.resources, ...linux.bundle.resources };

  assert.equal(resources['WebView2Loader.dll'], undefined);
  assert.equal(resources['binaries/win-x64/pdfium.dll'], undefined);
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
  assert.doesNotMatch(smoke, /CFDictionary/);
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

test('macOS bundling retries transient notarization service failures', async () => {
  let retryModule;
  try {
    retryModule = await import('./macos-notarization-retry.mjs');
  } catch {
    retryModule = null;
  }
  assert.equal(typeof retryModule?.bundleMacOSWithRetry, 'function');

  const results = [
    { code: 1, output: 'failed to notarize app: HTTP status code: 500. Please try again later.' },
    { code: 0, output: 'bundle complete' },
  ];
  const attempts = [];
  const cleanups = [];
  const waits = [];
  const result = await retryModule.bundleMacOSWithRetry({
    runBundle: async (attempt) => {
      attempts.push(attempt);
      return results.shift();
    },
    cleanBundleOutput: async () => cleanups.push('clean'),
    wait: async (milliseconds) => waits.push(milliseconds),
    logger: { error() {}, log() {} },
    retryDelayMs: 25,
  });

  assert.deepEqual(attempts, [1, 2]);
  assert.deepEqual(cleanups, ['clean', 'clean']);
  assert.deepEqual(waits, [25]);
  assert.deepEqual(result, { attempts: 2 });
});

test('macOS bundling does not retry non-transient failures', async () => {
  const { bundleMacOSWithRetry } = await import('./macos-notarization-retry.mjs');
  let attempts = 0;
  await assert.rejects(
    bundleMacOSWithRetry({
      runBundle: async () => {
        attempts += 1;
        return { code: 2, output: 'configuration file is invalid' };
      },
      cleanBundleOutput: async () => {},
      wait: async () => {},
      logger: { error() {}, log() {} },
    }),
    /configuration file is invalid/,
  );
  assert.equal(attempts, 1);
});

test('macOS bundling rejects invalid retry configuration', async () => {
  const { bundleMacOSWithRetry } = await import('./macos-notarization-retry.mjs');
  const options = {
    runBundle: async () => ({ code: 0, output: '' }),
    cleanBundleOutput: async () => {},
    wait: async () => {},
    logger: { error() {}, log() {} },
  };

  await assert.rejects(
    bundleMacOSWithRetry({ ...options, maxAttempts: 0 }),
    /maxAttempts must be a positive integer/,
  );
  await assert.rejects(
    bundleMacOSWithRetry({ ...options, retryDelayMs: Number.NaN }),
    /retryDelayMs must be a non-negative integer/,
  );
});

test('release workflows compile macOS once and retry only the bundle phase', async () => {
  for (const name of ['release.yml', 'nightly.yml']) {
    const workflow = await readFile(path.join(repoDir, '.github', 'workflows', name), 'utf8');
    assert.match(workflow, /Build macOS app without bundles/);
    assert.match(workflow, /--target universal-apple-darwin --no-bundle/);
    assert.match(workflow, /node scripts\/macos-notarization-retry\.mjs/);
    assert.match(workflow, /Upload macOS release assets/);
    assert.doesNotMatch(workflow, /retryAttempts:/);
  }
});

test('all release metadata targets version 1.79.0', async () => {
  const pkg = await readJson('package.json');
  const packageLock = await readJson('package-lock.json');
  const config = await readJson('src-tauri/tauri.conf.json');
  const cargo = await readFile(path.join(projectDir, 'src-tauri', 'Cargo.toml'), 'utf8');
  const release = await readFile(path.join(repoDir, '.github', 'workflows', 'release.yml'), 'utf8');
  const cargoLock = await readFile(path.join(repoDir, 'Cargo.lock'), 'utf8');

  assert.equal(pkg.version, '1.79.0');
  assert.equal(packageLock.version, '1.79.0');
  assert.equal(packageLock.packages[''].version, '1.79.0');
  assert.equal(config.version, '1.79.0');
  assert.match(cargo, /^version = "1\.79\.0"$/m);
  assert.match(release, /default: 'v1\.79\.0'/);
  assert.match(cargoLock, /name = "open-pdf-studio"\r?\nversion = "1\.79\.0"/);
});

test('development optimization profiles live at the workspace root', async () => {
  const workspaceCargo = await readFile(path.join(repoDir, 'Cargo.toml'), 'utf8');
  const appCargo = await readFile(path.join(projectDir, 'src-tauri', 'Cargo.toml'), 'utf8');
  assert.match(workspaceCargo, /\[profile\.dev\.package\.open-pdf-render\]/);
  assert.match(workspaceCargo, /\[profile\.dev\.package\.pdfium-render\]/);
  assert.doesNotMatch(appCargo, /\[profile\./);
});
