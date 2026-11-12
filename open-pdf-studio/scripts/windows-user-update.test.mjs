import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { userInstallConfig, userUpdateManifest } from './windows-user-update.mjs';

const root = new URL('../', import.meta.url);
const config = JSON.parse(await readFile(new URL('src-tauri/tauri.conf.json', root), 'utf8'));

test('user build selects only its own feed and keeps updater verification and system defaults', () => {
  const before = structuredClone(config);
  const user = userInstallConfig(config);
  assert.deepEqual(config, before);
  assert.equal(config.bundle.windows.nsis.installMode, 'perMachine');
  assert.equal(user.bundle.windows.nsis.installMode, 'currentUser');
  assert.ok(user.plugins.updater.endpoints.every(x => x.endsWith('/latest-user.json')));
  assert.equal(user.plugins.updater.pubkey, config.plugins.updater.pubkey);
  assert.ok(config.plugins.updater.endpoints.every(x => x.endsWith('/latest.json')));
  const custom = structuredClone(config);
  custom.plugins.updater.endpoints = ['https://example.org/custom'];
  assert.throws(() => userInstallConfig(custom), /latest.json/);
});

test('user feed keeps the signed bytes and never points at the system installer', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'opds-user-feed-'));
  try {
    // What the user build leaves behind: the artifact names of a real release.
    const stem = 'Open PDF Studio_2026.46.2';
    const zip = `${stem}_x64-setup.nsis.zip`;
    const bytes = Buffer.from([0x50, 0x4b, 3, 4, 0, 255]);
    await writeFile(path.join(dir, zip), bytes);
    await writeFile(path.join(dir, `${stem}_x64_user-setup.exe`), 'installer');
    await assert.rejects(userUpdateManifest(dir, 'owner/repo', 'v2026.46.2', '2026.46.2'), /ENOENT/);
    await assert.rejects(access(path.join(dir, 'latest-user.json')));
    await writeFile(path.join(dir, `${zip}.sig`), 'signed-zip\n');
    await writeFile(path.join(dir, `${stem}_x64-setup.exe.sig`), 'signed-exe\n');
    await assert.rejects(userUpdateManifest(dir, 'owner/repo', 'v2026.46.3', '2026.46.2'), /version/);
    const manifest = await userUpdateManifest(dir, 'owner/repo', 'v2026.46.2', '2026.46.2');
    assert.equal(manifest.version, '2026.46.2');
    // The release stores assets with dots for spaces; the feed must use those names.
    const base = 'https://github.com/owner/repo/releases/download/v2026.46.2/';
    assert.deepEqual(manifest.platforms, {
      'windows-x86_64': { signature: 'signed-zip', url: `${base}Open.PDF.Studio_2026.46.2_x64_user-setup.nsis.zip` },
      'windows-x86_64-nsis': { signature: 'signed-exe', url: `${base}Open.PDF.Studio_2026.46.2_x64_user-setup.exe` },
    });
    assert.deepEqual(await readFile(path.join(dir, `${stem}_x64_user-setup.nsis.zip`)), bytes);
    assert.equal(await readFile(path.join(dir, `${stem}_x64_user-setup.nsis.zip.sig`), 'utf8'), 'signed-zip\n');
    assert.equal(await readFile(path.join(dir, `${stem}_x64_user-setup.exe.sig`), 'utf8'), 'signed-exe\n');
    assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'latest-user.json'))), manifest);
    await writeFile(path.join(dir, 'Other_x64-setup.nsis.zip'), bytes);
    await assert.rejects(userUpdateManifest(dir, 'owner/repo', 'v2026.46.2', '2026.46.2'), /exactly one/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the feed is refused when the installer is missing', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'opds-user-feed-'));
  try {
    const stem = 'Open PDF Studio_2026.46.2';
    await writeFile(path.join(dir, `${stem}_x64-setup.nsis.zip`), 'zip');
    await writeFile(path.join(dir, `${stem}_x64-setup.nsis.zip.sig`), 'a');
    await writeFile(path.join(dir, `${stem}_x64-setup.exe.sig`), 'b');
    await assert.rejects(userUpdateManifest(dir, 'owner/repo', 'v2026.46.2', '2026.46.2'), /user installer/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('release and nightly configure the user build; stable release uploads a separate signed feed', async () => {
  for (const name of ['release', 'nightly']) {
    const workflow = await readFile(new URL(`../.github/workflows/${name}.yml`, root), 'utf8');
    assert.match(workflow, /node scripts\/windows-user-update.mjs configure src-tauri\/tauri.conf.json/);
    if (name === 'release') {
      assert.match(workflow, /node scripts\/windows-user-update.mjs manifest/);
      assert.match(workflow, /_user-setup\.exe\.sig[^\n]+_user-setup\.nsis\.zip\.sig[^\n]+latest-user\.json/);
      assert.match(workflow, /gh release upload \$VERSION "\$NEW_PATH" @USER_FILES/);
    }
  }
});

test('configure CLI writes the per-user configuration consumed by the build', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'opds-user-config-'));
  try {
    const file = path.join(dir, 'tauri.conf.json');
    await writeFile(file, JSON.stringify(config));
    const script = new URL('./windows-user-update.mjs', import.meta.url);
    const run = spawnSync(process.execPath, [fileURLToPath(script), 'configure', file], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(JSON.parse(await readFile(file)), userInstallConfig(config));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
