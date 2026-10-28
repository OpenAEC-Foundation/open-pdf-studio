import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  NSIS_SWITCHES,
  PACKAGE_IDENTIFIER,
  buildManifests,
  classifyInstaller,
  manifestDir,
  manifestFiles,
  readProjectMetadata,
  releaseAssetUrl,
  sha256File,
  tauriManufacturer,
  yamlScalar,
} from './winget-manifest.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, '..');
const repoDir = path.resolve(projectDir, '..');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

// Minimal parser for the YAML subset toYaml emits (block mappings, block
// sequences, plain and double-quoted scalars), so the tests check the
// structure a YAML reader sees rather than the text.
function parseYaml(text) {
  const lines = text
    .split('\n')
    .filter((l) => l.trim() && !l.trimStart().startsWith('#'))
    .map((l) => ({ indent: l.length - l.trimStart().length, text: l.trim() }));
  let i = 0;
  const scalar = (s) => (s.startsWith('"') ? JSON.parse(s) : s);
  function block(indent) {
    if (lines[i].text.startsWith('- ')) {
      const arr = [];
      while (i < lines.length && lines[i].indent === indent && lines[i].text.startsWith('- ')) {
        const rest = lines[i].text.slice(2);
        if (/^[A-Za-z0-9]+:( |$)/.test(rest)) {
          lines[i] = { indent: indent + 2, text: rest };
          arr.push(block(indent + 2));
        } else {
          arr.push(scalar(rest));
          i++;
        }
      }
      return arr;
    }
    const obj = {};
    while (i < lines.length && lines[i].indent === indent) {
      const m = /^([A-Za-z0-9]+):(?: (.*))?$/.exec(lines[i].text);
      assert.ok(m, `unexpected line: ${lines[i].text}`);
      assert.ok(!(m[1] in obj), `duplicate key ${m[1]}`);
      i++;
      if (m[2] !== undefined) obj[m[1]] = scalar(m[2]);
      else {
        assert.ok(lines[i].indent > indent || lines[i].text.startsWith('- '), `empty value for ${m[1]}`);
        obj[m[1]] = block(lines[i].indent);
      }
    }
    return obj;
  }
  const result = block(0);
  assert.equal(i, lines.length, 'trailing lines not parsed');
  return result;
}

const meta = {
  productName: 'Open PDF Studio',
  version: '2026.43.11',
  manufacturer: 'openaec',
  fileExtensions: ['pdf'],
  installMode: 'perMachine',
  publisher: 'OpenAEC Foundation',
  license: 'LGPL-3.0-or-later',
  shortDescription: 'A free, open-source PDF annotation editor',
};
const HASH_A = 'A'.repeat(64);
const HASH_B = 'B'.repeat(64);
const repo = 'OpenAEC-Foundation/open-pdf-studio';
const tag = 'v2026.43.11';

function nsisInstallers() {
  return [
    ['Open.PDF.Studio_2026.43.11_x64_user-setup.exe', HASH_B],
    ['Open.PDF.Studio_2026.43.11_x64-setup.exe', HASH_A],
  ].map(([fileName, sha256]) => ({
    fileName,
    url: releaseAssetUrl(repo, tag, fileName),
    sha256,
    ...classifyInstaller(fileName),
  }));
}

test('classifies the release assets the workflow uploads', () => {
  assert.deepEqual(classifyInstaller('Open.PDF.Studio_2026.43.11_x64-setup.exe'), {
    installerType: 'nsis',
    architecture: 'x64',
    scope: 'machine',
  });
  assert.deepEqual(classifyInstaller('Open.PDF.Studio_2026.43.11_x64_user-setup.exe'), {
    installerType: 'nsis',
    architecture: 'x64',
    scope: 'user',
  });
  assert.deepEqual(classifyInstaller('Open.PDF.Studio_2026.43.11_arm64-setup.exe'), {
    installerType: 'nsis',
    architecture: 'arm64',
    scope: 'machine',
  });
  for (const other of [
    'Open.PDF.Studio_2026.43.11_x64-setup.exe.sig',
    'Open.PDF.Studio_2026.43.11_x64-setup.nsis.zip',
    'Open.PDF.Studio_2026.43.11_amd64.deb',
    'Open.PDF.Studio_2026.43.11_universal.dmg',
    'Open.PDF.Studio_2026.43.11_x64_en-US.msi',
    'latest.json',
  ]) {
    assert.equal(classifyInstaller(other), null, other);
  }
});

test('release asset URLs are percent-encoded GitHub download URLs', () => {
  assert.equal(
    releaseAssetUrl(repo, tag, 'Open.PDF.Studio_2026.43.11_x64-setup.exe'),
    'https://github.com/OpenAEC-Foundation/open-pdf-studio/releases/download/v2026.43.11/Open.PDF.Studio_2026.43.11_x64-setup.exe',
  );
  assert.match(releaseAssetUrl(repo, tag, 'a b.exe'), /\/a%20b\.exe$/);
});

test('the three manifests carry the required winget fields', () => {
  const m = buildManifests({ meta, version: '2026.43.11', tag, repo, installers: nsisInstallers() });
  for (const [type, manifest] of [
    ['version', m.version],
    ['defaultLocale', m.defaultLocale],
    ['installer', m.installer],
  ]) {
    assert.equal(manifest.PackageIdentifier, PACKAGE_IDENTIFIER);
    assert.equal(manifest.PackageVersion, '2026.43.11');
    assert.equal(manifest.ManifestType, type);
    assert.match(manifest.ManifestVersion, /^1\.(\d{2,}|[6-9])\.\d+$/);
  }
  assert.equal(m.version.DefaultLocale, 'en-US');
  const loc = m.defaultLocale;
  for (const field of ['PackageLocale', 'Publisher', 'PackageName', 'License', 'ShortDescription']) {
    assert.ok(loc[field], field);
  }
  assert.equal(loc.License, 'LGPL-3.0-or-later');
  assert.equal(loc.ReleaseNotesUrl, 'https://github.com/OpenAEC-Foundation/open-pdf-studio/releases/tag/v2026.43.11');
  assert.ok(loc.ShortDescription.length <= 256);
  assert.equal(m.installer.UpgradeBehavior, 'install');
  assert.deepEqual(m.installer.FileExtensions, ['pdf']);
});

test('NSIS installers get the Tauri switches, scope and product code', () => {
  const { installer } = buildManifests({ meta, version: '2026.43.11', tag, repo, installers: nsisInstallers() });
  assert.equal(installer.Installers.length, 2);
  const [machine, user] = installer.Installers;
  assert.equal(machine.Scope, 'machine');
  assert.equal(user.Scope, 'user');
  for (const inst of installer.Installers) {
    assert.equal(inst.InstallerType, 'nsis');
    assert.equal(inst.Architecture, 'x64');
    assert.deepEqual(inst.InstallerSwitches, { Silent: '/S', SilentWithProgress: '/P' });
    assert.match(inst.InstallerSha256, /^[0-9A-F]{64}$/);
    assert.match(inst.InstallerUrl, /^https:\/\/github\.com\/.+\/releases\/download\/v2026\.43\.11\//);
    assert.equal(inst.AppsAndFeaturesEntries[0].Publisher, 'openaec');
    assert.equal(inst.AppsAndFeaturesEntries[0].DisplayVersion, '2026.43.11');
  }
  assert.equal(machine.ProductCode, 'Open PDF Studio');
  assert.equal(machine.ElevationRequirement, 'elevatesSelf');
  assert.equal(machine.InstallerSha256, HASH_A);
  assert.equal(user.ProductCode, 'Open PDF Studio (User)');
  assert.equal(user.ElevationRequirement, undefined);
  assert.match(user.InstallerUrl, /_x64_user-setup\.exe$/);
});

test('the NSIS switches match the options the installer template parses', () => {
  const nsi = read(path.join(projectDir, 'src-tauri', 'nsis', 'installer.nsi'));
  assert.match(nsi, /\$\{GetOptions\} \$CMDLINE "\/P" \$PassiveMode/);
  assert.match(nsi, /\$\{If\} \$\{Silent\}/);
  assert.match(nsi, /UNINSTKEY "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\\$\{PRODUCTNAME\} \(User\)"/);
  assert.equal(NSIS_SWITCHES.Silent, '/S');
});

test('rejects bad hashes, duplicates and an empty installer list', () => {
  const [one] = nsisInstallers();
  assert.throws(() => buildManifests({ meta, version: '1.0.0', installers: [] }), /no Windows installers/);
  assert.throws(
    () => buildManifests({ meta, version: '1.0.0', installers: [{ ...one, sha256: 'abc' }] }),
    /invalid SHA256/,
  );
  assert.throws(() => buildManifests({ meta, version: '1.0.0', installers: [one, one] }), /two installers/);
  assert.throws(
    () => buildManifests({ meta, version: '1.0.0', installers: [{ ...one, installerType: 'wix' }] }),
    /unsupported installer type/,
  );
});

test('YAML output parses back to the manifest objects', () => {
  const m = buildManifests({
    meta,
    version: '2026.43.11',
    tag,
    repo,
    installers: nsisInstallers(),
    releaseDate: '2026-10-28',
  });
  const files = manifestFiles(m);
  assert.deepEqual(Object.keys(files).sort(), [
    'OpenAEC.OpenPDFStudio.installer.yaml',
    'OpenAEC.OpenPDFStudio.locale.en-US.yaml',
    'OpenAEC.OpenPDFStudio.yaml',
  ]);
  assert.deepEqual(parseYaml(files['OpenAEC.OpenPDFStudio.yaml']), m.version);
  assert.deepEqual(parseYaml(files['OpenAEC.OpenPDFStudio.locale.en-US.yaml']), m.defaultLocale);
  assert.deepEqual(parseYaml(files['OpenAEC.OpenPDFStudio.installer.yaml']), m.installer);
  const text = files['OpenAEC.OpenPDFStudio.installer.yaml'];
  assert.match(text, /^# yaml-language-server: \$schema=https:\/\/aka\.ms\/winget-manifest\.installer\.1\.\d+\.\d+\.schema\.json$/m);
  assert.match(text, /^PackageVersion: "2026\.43\.11"$/m);
  assert.match(text, /^ManifestVersion: "1\.\d+\.\d+"$/m);
  assert.doesNotMatch(text, /\t|\r/);
});

test('scalars that YAML would retype are quoted', () => {
  for (const s of ['2026.43.11', '1.10.0', 'true', 'No', 'null', '{GUID}', 'https://x/y', '']) {
    assert.match(yamlScalar(s), /^".*"$/, s);
  }
  assert.equal(yamlScalar('Open PDF Studio (User)'), 'Open PDF Studio (User)');
  assert.equal(yamlScalar('/S'), '/S');
});

test('metadata comes from the repository config', () => {
  const projectMeta = readProjectMetadata(projectDir);
  const conf = JSON.parse(read(path.join(projectDir, 'src-tauri', 'tauri.conf.json')));
  assert.equal(projectMeta.productName, conf.productName);
  assert.equal(projectMeta.version, conf.version);
  assert.equal(projectMeta.license, 'LGPL-3.0-or-later');
  assert.deepEqual(projectMeta.fileExtensions, ['pdf']);
  assert.ok(projectMeta.publisher);
  assert.ok(projectMeta.shortDescription);
  assert.equal(tauriManufacturer({ identifier: 'org.openaec.openpdfstudio', bundle: {} }), 'openaec');
  assert.equal(tauriManufacturer({ identifier: 'a.b.c', bundle: { publisher: 'X' } }), 'X');
});

test('CLI hashes the installers in a directory and writes the winget layout', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'winget-'));
  try {
    const assets = path.join(tmp, 'assets');
    fs.mkdirSync(assets);
    const version = '2026.43.11';
    fs.writeFileSync(path.join(assets, `Open.PDF.Studio_${version}_x64-setup.exe`), 'machine');
    fs.writeFileSync(path.join(assets, `Open.PDF.Studio_${version}_x64_user-setup.exe`), 'user');
    fs.writeFileSync(path.join(assets, `Open.PDF.Studio_${version}_x64-setup.exe.sig`), 'sig');
    fs.writeFileSync(path.join(assets, 'Open.PDF.Studio_2026.43.10_x64-setup.exe'), 'old');
    const out = path.join(tmp, 'out');
    const r = spawnSync(
      process.execPath,
      [path.join(scriptDir, 'winget-manifest.mjs'), '--assets', assets, '--out', out, '--version', version],
      { encoding: 'utf8' },
    );
    assert.equal(r.status, 0, r.stderr);
    const dir = manifestDir(out, version);
    assert.equal(path.relative(out, dir).split(path.sep).join('/'), `manifests/o/OpenAEC/OpenPDFStudio/${version}`);
    const installer = parseYaml(read(path.join(dir, 'OpenAEC.OpenPDFStudio.installer.yaml')));
    assert.equal(installer.Installers.length, 2);
    const machine = installer.Installers.find((x) => x.Scope === 'machine');
    assert.equal(machine.InstallerSha256, sha256File(path.join(assets, `Open.PDF.Studio_${version}_x64-setup.exe`)));
    // sha256("machine"), upper case as winget-pkgs writes it.
    assert.equal(machine.InstallerSha256, 'BC020A35B7F9CB1382E7B534C68E3C531D849B119BF14F75DDEAD6CC45C3CCC1');
    assert.ok(installer.Installers.every((x) => !x.InstallerUrl.includes('2026.43.10')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('release workflow generates winget manifests after the installers are uploaded', () => {
  const workflow = read(path.join(repoDir, '.github', 'workflows', 'release.yml'));
  const job = /^ {2}winget-manifests:\n([\s\S]*?)(?=^ {2}[a-z][\w-]*:\n|(?![\s\S]))/m.exec(workflow)?.[1];
  assert.ok(job, 'winget-manifests job missing');
  assert.match(job, /needs: \[create-release, build\]/);
  assert.match(job, /gh release download/);
  assert.match(job, /node scripts\/winget-manifest\.mjs/);
  assert.match(job, /uses: actions\/upload-artifact@/);
  assert.doesNotMatch(job, /winget-pkgs|wingetcreate|komac/i, 'submission stays a maintainer step');
});
