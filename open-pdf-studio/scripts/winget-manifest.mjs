#!/usr/bin/env node
// Generates a winget multi-file manifest set (version, defaultLocale and
// installer manifests) for one Open PDF Studio release, from the Windows
// installers that the release workflow uploaded to the GitHub release.
//
// Usage (from open-pdf-studio/):
//   node scripts/winget-manifest.mjs --assets <dir> [--out <dir>]
//     [--version 2026.43.11] [--tag v2026.43.11]
//     [--repo OpenAEC-Foundation/open-pdf-studio]
//     [--release-date YYYY-MM-DD]
//
// <dir> holds the installers as downloaded from the release (asset names as
// GitHub shows them, e.g. "Open.PDF.Studio_2026.43.11_x64-setup.exe"). The
// SHA256 of each file is computed here; the installer URLs point at the
// release download URLs, which only resolve once the release is published.
//
// The output is <out>/manifests/o/OpenAEC/OpenPDFStudio/<version>/, the
// layout of the winget-pkgs repository. Submitting it there is a manual
// maintainer step (see docs/windows-distribution.md).

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, '..');

export const MANIFEST_VERSION = '1.10.0';
export const PACKAGE_IDENTIFIER = 'OpenAEC.OpenPDFStudio';
export const DEFAULT_REPO = 'OpenAEC-Foundation/open-pdf-studio';
export const DEFAULT_LOCALE = 'en-US';

// Switches of the Tauri NSIS installer (src-tauri/nsis/installer.nsi):
// /S is the standard NSIS silent mode, /P the Tauri "passive" mode that only
// shows progress. Silent runs skip the options page, so they create the Start
// menu shortcut but neither the desktop shortcut nor the PDF association.
export const NSIS_SWITCHES = Object.freeze({ Silent: '/S', SilentWithProgress: '/P' });

// Only NSIS: an MSI cannot carry a version whose first number is above 255,
// so the release builds none (see versievelden.test.mjs).
export const SWITCHES_BY_TYPE = Object.freeze({ nsis: NSIS_SWITCHES });

const SHA256_RE = /^[0-9A-F]{64}$/;

/**
 * Recognises a Windows installer produced by the release workflow.
 * Returns { installerType, architecture, scope } or null for other assets
 * (.sig files, updater .nsis.zip, macOS/Linux bundles).
 */
export function classifyInstaller(fileName, { machineScope = 'machine' } = {}) {
  const m = /_(x64|x86|arm64)(_user)?-setup\.exe$/i.exec(fileName);
  if (m) {
    return {
      installerType: 'nsis',
      architecture: m[1].toLowerCase(),
      scope: m[2] ? 'user' : machineScope,
    };
  }
  return null;
}

/**
 * The Publisher value Tauri writes to Apps & Features: bundle.publisher, or
 * else the second segment of the bundle identifier.
 */
export function tauriManufacturer(tauriConf) {
  if (tauriConf.bundle?.publisher) return tauriConf.bundle.publisher;
  const parts = String(tauriConf.identifier).split('.');
  return parts[1] ?? tauriConf.identifier;
}

/** The Apps & Features (uninstall) key name, see UNINSTKEY in installer.nsi. */
export function nsisProductCode(productName, scope) {
  return scope === 'user' ? `${productName} (User)` : productName;
}

export function sha256File(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

export function releaseAssetUrl(repo, tag, assetName) {
  return `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(assetName)}`;
}

/** Reads the package metadata from the repository's own config files. */
export function readProjectMetadata(dir = projectDir) {
  const tauriConf = JSON.parse(fs.readFileSync(path.join(dir, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const cargo = fs.readFileSync(path.join(dir, 'src-tauri', 'Cargo.toml'), 'utf8').replace(/\r\n/g, '\n');
  const cargoField = (name) => new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, 'm').exec(cargo)?.[1];
  return {
    productName: tauriConf.productName,
    version: tauriConf.version,
    manufacturer: tauriManufacturer(tauriConf),
    fileExtensions: (tauriConf.bundle?.fileAssociations ?? []).flatMap((a) => a.ext ?? []),
    installMode: tauriConf.bundle?.windows?.nsis?.installMode ?? 'currentUser',
    publisher: pkg.author,
    license: pkg.license ?? cargoField('license'),
    shortDescription: cargoField('description') ?? pkg.description,
  };
}

/**
 * Builds the three manifests as plain objects.
 * installers: [{ fileName, url, sha256, installerType, architecture, scope }]
 */
export function buildManifests({
  meta,
  version,
  tag = `v${version}`,
  repo = DEFAULT_REPO,
  installers,
  releaseDate,
  manifestVersion = MANIFEST_VERSION,
}) {
  if (!installers?.length) throw new Error('no Windows installers given');
  for (const inst of installers) {
    if (!SHA256_RE.test(inst.sha256)) throw new Error(`invalid SHA256 for ${inst.fileName}: ${inst.sha256}`);
    if (!(inst.installerType in SWITCHES_BY_TYPE)) throw new Error(`unsupported installer type ${inst.installerType}`);
  }
  const keys = new Set();
  for (const inst of installers) {
    const key = `${inst.architecture}/${inst.scope}/${inst.installerType}`;
    if (keys.has(key)) throw new Error(`two installers for ${key}`);
    keys.add(key);
  }

  const common = { PackageIdentifier: PACKAGE_IDENTIFIER, PackageVersion: version };
  const repoUrl = `https://github.com/${repo}`;

  const versionManifest = {
    ...common,
    DefaultLocale: DEFAULT_LOCALE,
    ManifestType: 'version',
    ManifestVersion: manifestVersion,
  };

  const localeManifest = {
    ...common,
    PackageLocale: DEFAULT_LOCALE,
    Publisher: meta.publisher,
    PublisherUrl: 'https://open-aec.com',
    PublisherSupportUrl: `${repoUrl}/issues`,
    Author: meta.publisher,
    PackageName: meta.productName,
    PackageUrl: 'https://open-aec.com/open-pdf-studio/',
    License: meta.license,
    LicenseUrl: `${repoUrl}/blob/main/LICENSE.md`,
    ShortDescription: meta.shortDescription,
    Moniker: 'open-pdf-studio',
    Tags: ['annotation', 'open-source', 'pdf', 'pdf-editor', 'pdf-viewer'],
    ReleaseNotesUrl: `${repoUrl}/releases/tag/${tag}`,
    ManifestType: 'defaultLocale',
    ManifestVersion: manifestVersion,
  };

  const order = { x64: 0, arm64: 1, x86: 2 };
  const sorted = [...installers].sort(
    (a, b) =>
      (order[a.architecture] ?? 9) - (order[b.architecture] ?? 9) ||
      a.scope.localeCompare(b.scope) ||
      a.installerType.localeCompare(b.installerType),
  );

  const installerManifest = {
    ...common,
    InstallModes: ['interactive', 'silent', 'silentWithProgress'],
    UpgradeBehavior: 'install',
    FileExtensions: meta.fileExtensions,
    ...(releaseDate ? { ReleaseDate: releaseDate } : {}),
    Installers: sorted.map((inst) => {
      const entry = {
        Architecture: inst.architecture,
        InstallerType: inst.installerType,
        Scope: inst.scope,
        InstallerUrl: inst.url,
        InstallerSha256: inst.sha256,
      };
      entry.InstallerSwitches = { ...SWITCHES_BY_TYPE[inst.installerType] };
      if (inst.scope === 'machine') entry.ElevationRequirement = 'elevatesSelf';
      const productCode = nsisProductCode(meta.productName, inst.scope);
      entry.ProductCode = productCode;
      entry.AppsAndFeaturesEntries = [
        {
          DisplayName: meta.productName,
          Publisher: meta.manufacturer,
          DisplayVersion: version,
          ProductCode: productCode,
        },
      ];
      return entry;
    }),
    ManifestType: 'installer',
    ManifestVersion: manifestVersion,
  };

  return { version: versionManifest, defaultLocale: localeManifest, installer: installerManifest };
}

// ---------------------------------------------------------------- YAML

const PLAIN_RE = /^[A-Za-z_/][A-Za-z0-9 _.,/()+-]*$/;
const RESERVED_RE = /^(?:true|false|yes|no|on|off|null|y|n|~)$/i;

export function yamlScalar(value) {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  const s = String(value);
  if (PLAIN_RE.test(s) && !RESERVED_RE.test(s) && !s.endsWith(' ')) return s;
  // A JSON string is a valid YAML double-quoted scalar.
  return JSON.stringify(s);
}

function yamlLines(value, indent) {
  const pad = ' '.repeat(indent);
  const out = [];
  for (const [key, val] of Object.entries(value)) {
    if (val === undefined || val === null) continue;
    if (Array.isArray(val)) {
      if (!val.length) continue;
      out.push(`${pad}${key}:`);
      for (const item of val) {
        if (item && typeof item === 'object') {
          const inner = yamlLines(item, indent + 2);
          inner[0] = `${pad}- ${inner[0].slice(indent + 2)}`;
          out.push(...inner);
        } else {
          out.push(`${pad}- ${yamlScalar(item)}`);
        }
      }
    } else if (typeof val === 'object') {
      out.push(`${pad}${key}:`);
      out.push(...yamlLines(val, indent + 2));
    } else {
      out.push(`${pad}${key}: ${yamlScalar(val)}`);
    }
  }
  return out;
}

const SCHEMA_NAME = { version: 'version', defaultLocale: 'defaultLocale', installer: 'installer' };

export function toYaml(manifest) {
  const type = SCHEMA_NAME[manifest.ManifestType];
  const header = [
    '# Generated by open-pdf-studio/scripts/winget-manifest.mjs',
    `# yaml-language-server: $schema=https://aka.ms/winget-manifest.${type}.${manifest.ManifestVersion}.schema.json`,
    '',
  ];
  return [...header, ...yamlLines(manifest, 0), ''].join('\n');
}

export function manifestFiles(manifests) {
  const id = manifests.version.PackageIdentifier;
  return {
    [`${id}.yaml`]: toYaml(manifests.version),
    [`${id}.locale.${manifests.defaultLocale.PackageLocale}.yaml`]: toYaml(manifests.defaultLocale),
    [`${id}.installer.yaml`]: toYaml(manifests.installer),
  };
}

export function manifestDir(outDir, version, id = PACKAGE_IDENTIFIER) {
  const [publisher, name] = id.split('.');
  return path.join(outDir, 'manifests', publisher[0].toLowerCase(), publisher, name, version);
}

/** Finds the installers for `version` in `assetsDir` and hashes them. */
export function collectInstallers({ assetsDir, version, tag, repo, machineScope }) {
  const installers = [];
  for (const fileName of fs.readdirSync(assetsDir).sort()) {
    if (!fileName.includes(`_${version}_`)) continue;
    const kind = classifyInstaller(fileName, { machineScope });
    if (!kind) continue;
    installers.push({
      fileName,
      url: releaseAssetUrl(repo, tag, fileName),
      sha256: sha256File(path.join(assetsDir, fileName)),
      ...kind,
    });
  }
  return installers;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(argv[i]);
    if (!m) throw new Error(`unknown argument: ${argv[i]}`);
    args[m[1]] = m[2] ?? argv[++i];
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.assets) throw new Error('--assets <dir> is required');
  const meta = readProjectMetadata();
  const version = args.version ?? meta.version;
  const tag = args.tag ?? `v${version}`;
  if (tag.replace(/^v/, '') !== version) throw new Error(`tag ${tag} does not match version ${version}`);
  const repo = args.repo ?? DEFAULT_REPO;
  const machineScope = meta.installMode === 'currentUser' ? 'user' : 'machine';

  const installers = collectInstallers({ assetsDir: args.assets, version, tag, repo, machineScope });
  if (!installers.length) throw new Error(`no Windows installers for ${version} in ${args.assets}`);

  const manifests = buildManifests({
    meta,
    version,
    tag,
    repo,
    installers,
    releaseDate: args['release-date'],
  });
  const dir = manifestDir(args.out ?? 'winget-manifests', version);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(manifestFiles(manifests))) {
    fs.writeFileSync(path.join(dir, name), text);
  }
  for (const inst of installers) {
    console.log(`${inst.architecture} ${inst.scope} ${inst.installerType}  ${inst.sha256}  ${inst.fileName}`);
  }
  console.log(`winget manifests written to ${dir}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (err) {
    console.error(`winget-manifest: ${err.message}`);
    process.exit(1);
  }
}
