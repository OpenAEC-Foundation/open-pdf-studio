// Static Flathub requirements for the Flatpak in flatpak/ (#389): an offline
// build from declared sources only, minimal sandbox permissions, and
// AppStream metadata that matches the app. The real build and
// flatpak-builder-lint run in CI (flatpak/ci-check.sh).

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CARGO_SOURCES_FILE,
  NPM_SOURCES_FILE,
  cargoSources,
  generate,
  npmSources,
  parseCargoLock,
} from '../../flatpak/generate-sources.mjs';
import { flathubManifest } from '../../flatpak/flathub-manifest.mjs';
import { OCR_RUNTIME_ASSETS } from './ocr-runtime.mjs';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = path.resolve(appDir, '..');
const APP_ID = 'org.openaec.OpenPdfStudio';

const read = (relative) => readFileSync(path.join(repoDir, relative), 'utf8').replace(/\r\n/g, '\n');
const manifest = read(`flatpak/${APP_ID}.yml`);
const metainfo = read(`flatpak/${APP_ID}.metainfo.xml`);
const desktop = read(`flatpak/${APP_ID}.desktop`);
const pkg = JSON.parse(read('open-pdf-studio/package.json'));
const tauriConf = JSON.parse(read('open-pdf-studio/src-tauri/tauri.conf.json'));

// Top-level scalar of the manifest ("key: value").
const scalar = (key) => new RegExp(`^${key}:\\s*'?([^'\\n]*)'?$`, 'm').exec(manifest)?.[1];

// Items of a top-level list ("key:\n  - item"), comments skipped.
function topLevelList(key) {
  const start = manifest.indexOf(`\n${key}:\n`);
  assert.ok(start >= 0, `manifest has ${key}`);
  const items = [];
  for (const line of manifest.slice(start + key.length + 3).split('\n')) {
    if (/^\S/.test(line)) break;
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item) items.push(item[1].trim());
  }
  return items;
}

// "- type: x" source blocks of the manifest as { type, url, ... } (one level).
function manifestSources() {
  const sources = [];
  const block = manifest.slice(manifest.indexOf('\n    sources:\n'));
  let current = null;
  for (const line of block.split('\n').slice(2)) {
    const start = /^ {6}- (\S+)(?::\s*(.*))?$/.exec(line);
    if (start) {
      current = start[2] === undefined ? { include: start[1] } : { [start[1]]: start[2] };
      sources.push(current);
      continue;
    }
    const field = /^ {8}([\w-]+):\s*(.*)$/.exec(line);
    if (field && current) current[field[1]] = field[2];
    const listItem = /^ {10}- (.*)$/.exec(line);
    if (listItem && current) {
      const key = Object.keys(current).at(-1);
      current[key] = [...(Array.isArray(current[key]) ? current[key] : []), listItem[1]];
    }
  }
  return sources;
}

const xml = (tag) => [...metainfo.matchAll(new RegExp(`<${tag}(\\s[^>]*)?>([^<]*)</${tag}>`, 'g'))]
  .map((m) => ({ attrs: m[1] ?? '', text: m[2].trim() }));
const attr = (attrs, name) => new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1];

test('the manifest uses the GNOME runtime with the node and rust SDK extensions', () => {
  assert.equal(scalar('app-id'), APP_ID);
  assert.equal(scalar('runtime'), 'org.gnome.Platform');
  assert.equal(scalar('sdk'), 'org.gnome.Sdk');
  assert.match(scalar('runtime-version'), /^\d+$/, 'a stable runtime branch, not master');
  assert.deepEqual(topLevelList('sdk-extensions').sort(), [
    'org.freedesktop.Sdk.Extension.node22',
    'org.freedesktop.Sdk.Extension.rust-stable',
  ]);
  assert.equal(scalar('command'), 'open-pdf-studio');
});

test('finish-args are minimal: portals for files, no home or host access', () => {
  const args = topLevelList('finish-args');
  assert.deepEqual(args.sort(), [
    '--device=dri',
    `--own-name=${tauriConf.identifier}.SingleInstance`,
    '--share=ipc',
    '--share=network',
    '--socket=cups',
    '--socket=fallback-x11',
    '--socket=wayland',
  ]);
  for (const arg of args) {
    assert.doesNotMatch(arg, /^--filesystem=|^--socket=(x11|session-bus|system-bus)$|^--device=all$|--talk-name=org\.freedesktop\.Flatpak/, arg);
  }
  // Every permission is explained in the manifest.
  for (const arg of ['--share=network', '--socket=cups', '--own-name=']) {
    const at = manifest.indexOf(`  - ${arg}`);
    assert.match(manifest.slice(0, at).split('\n').at(-2), /^\s+#/, `${arg} has a comment above it`);
  }
});

test('the build runs offline from declared sources only', () => {
  assert.doesNotMatch(manifest, /build-args:/, 'no module asks for network during the build');
  const buildArgs = manifest.slice(manifest.indexOf('\nbuild-options:'), manifest.indexOf('\nmodules:'));
  assert.doesNotMatch(buildArgs, /share=network/);
  assert.match(manifest, /npm ci --offline\b/);
  assert.match(manifest, /npm run build --ignore-scripts/, 'the prebuild hook would download the OCR assets');
  assert.match(manifest, /cargo build --release --offline --locked -p open-pdf-studio --features tauri\/custom-protocol/);
  assert.match(manifest, /CARGO_HOME: \/run\/build\/open-pdf-studio\/cargo$/m);
  assert.match(manifest, /npm_config_cache: \/run\/build\/open-pdf-studio\/flatpak-node\/npm-cache$/m);
  assert.match(manifest, /npm_config_offline: 'true'$/m);

  const sources = manifestSources();
  const includes = sources.filter((s) => s.include).map((s) => s.include);
  assert.deepEqual(includes, [NPM_SOURCES_FILE, CARGO_SOURCES_FILE]);
  for (const source of sources.filter((s) => s.url)) {
    assert.match(source.url, /^https:\/\//, source.url);
    if (source.type === 'git') {
      assert.match(source.commit ?? '', /^[0-9a-f]{40}$/, `${source.url} is pinned to a commit`);
    } else {
      assert.match(source.sha256 ?? '', /^[0-9a-f]{64}$/, `${source.url} has a sha256`);
      assert.doesNotMatch(source.url, /\/(raw|blob)\/(main|master)\//, `${source.url} is pinned, not a branch`);
    }
  }

  const ignore = read('.gitignore');
  assert.match(ignore, /^flatpak\/generated-sources-\*\.json$/m, 'generated sources are not committed');
});

test('the generated sources cover both lockfiles', () => {
  const outputs = generate(repoDir);
  assert.deepEqual(Object.keys(outputs).sort(), [CARGO_SOURCES_FILE, NPM_SOURCES_FILE].sort());

  const lock = JSON.parse(read('open-pdf-studio/package-lock.json'));
  const npm = JSON.parse(outputs[NPM_SOURCES_FILE]);
  const files = npm.filter((s) => s.type === 'file');
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (!key || entry.link) continue;
    const hex = Buffer.from(entry.integrity.replace(/^sha512-/, ''), 'base64').toString('hex');
    const file = files.find((s) => s.sha512 === hex);
    assert.ok(file, `${key} is in the npm cache`);
    assert.equal(`${file.dest}/${file['dest-filename']}`.replace(/\//g, ''),
      `flatpak-node/npm-cache/_cacache/content-v2/sha512/${hex}`.replace(/\//g, ''));
  }
  assert.ok(npm.some((s) => s.type === 'inline' && s.dest.includes('/_cacache/index-v5/')), 'npm cache index');

  const cargoLock = read('Cargo.lock');
  const cargo = JSON.parse(outputs[CARGO_SOURCES_FILE]);
  for (const crate of parseCargoLock(cargoLock).filter((p) => p.source)) {
    const vendored = cargo.find((s) => s.dest === `cargo/vendor/${crate.name}-${crate.version}` && s.type !== 'inline');
    assert.ok(vendored, `${crate.name} ${crate.version} is vendored`);
    if (crate.source.startsWith('registry+')) assert.equal(vendored.sha256, crate.checksum, crate.name);
    else assert.equal(vendored.commit, crate.source.split('#')[1], crate.name);
  }
  const config = cargo.find((s) => s.dest === 'cargo' && s['dest-filename'] === 'config.toml');
  assert.match(config.contents, /\[source\.crates-io\]\nreplace-with = "vendored-sources"/);
  // Every [patch] git source of the workspace is replaced too.
  for (const [, url, rev] of read('Cargo.toml').matchAll(/git = "([^"]+)", rev = "([^"]+)"/g)) {
    assert.ok(config.contents.includes(`[source."git+${url}?rev=${rev}"]`), url);
  }
});

test('the generators parse lockfiles without network and reject what they cannot vendor', () => {
  const sources = cargoSources([
    '[[package]]', 'name = "demo"', 'version = "1.0.0"',
    'source = "registry+https://github.com/rust-lang/crates.io-index"',
    `checksum = "${'a'.repeat(64)}"`, '',
    '[[package]]', 'name = "local"', 'version = "0.1.0"', '',
  ].join('\r\n'));
  assert.deepEqual(sources[0], {
    type: 'archive',
    'archive-type': 'tar-gzip',
    url: 'https://static.crates.io/crates/demo/demo-1.0.0.crate',
    sha256: 'a'.repeat(64),
    dest: 'cargo/vendor/demo-1.0.0',
  });
  assert.equal(sources.length, 3, 'crate, checksum file, config; the local crate is skipped');
  assert.throws(() => cargoSources('[[package]]\nname = "x"\nversion = "1.0.0"\nsource = "registry+https://example.com/index"\n'), /crates\.io/);
  assert.throws(() => npmSources({ packages: { '': {}, 'node_modules/x': { version: '1.0.0' } } }), /no resolved URL/);
});

test('the manifest pins the same PDFium and OCR assets as the release builds', () => {
  const sources = manifestSources();
  const pdfium = sources.find((s) => s.dest === 'pdfium');
  for (const name of ['ci.yml', 'release.yml', 'nightly.yml']) {
    const workflow = read(`.github/workflows/${name}`);
    assert.ok(workflow.includes(pdfium.url), `${name} bundles ${pdfium.url}`);
  }
  for (const asset of OCR_RUNTIME_ASSETS) {
    const source = sources.find((s) => s['dest-filename'] === asset.name);
    assert.ok(source, `${asset.name} is a declared source`);
    assert.equal(source.sha256, asset.sha256, asset.name);
    assert.equal(source.dest, `open-pdf-studio/src-tauri/resources/${path.basename(path.dirname(asset.destination))}`);
  }
  const flathub = JSON.parse(read('flatpak/flathub.json'));
  assert.deepEqual(flathub['only-arches'], pdfium['only-arches'], 'Flathub builds only the arches PDFium is declared for');
});

test('the resources land where Tauri looks for them on Linux', () => {
  const res = `\${FLATPAK_DEST}/lib/${tauriConf.productName}`;
  assert.ok(manifest.includes(`res="${res}"`), 'resource_dir() is <prefix>/lib/<productName>');
  const linux = JSON.parse(read('open-pdf-studio/src-tauri/tauri.linux.conf.json'));
  const resources = { ...tauriConf.bundle.resources, ...linux.bundle.resources };
  for (const target of Object.values(resources)) {
    if (target.endsWith('.dll')) continue;
    assert.ok(manifest.includes(`"$res/${target}"`) || new RegExp(`for dir in [^;]*\\b${target}\\b`).test(manifest), target);
  }
  // Flathub does not allow self-updates: the updater stays off in a Flatpak.
  const lib = read('open-pdf-studio/src-tauri/src/lib.rs');
  assert.match(lib, /if !linux_runtime::running_in_flatpak\(\) \{\s*builder = builder\.plugin\(tauri_plugin_updater::/);
  assert.match(read('open-pdf-studio/js/ui/chrome/updater.js'), /updates_managed_externally/);
});

test('the metainfo has what Flathub requires and matches the app', () => {
  assert.equal(xml('id')[0].text, APP_ID);
  assert.equal(xml('launchable')[0].text, `${APP_ID}.desktop`);
  assert.equal(attr(xml('launchable')[0].attrs, 'type'), 'desktop-id');
  assert.equal(xml('project_license')[0].text, pkg.license);
  assert.equal(xml('metadata_license')[0].text, 'CC0-1.0');
  assert.match(metainfo, /<content_rating type="oars-1\.1"\s*\/?>/);
  assert.match(metainfo, /<developer id="[a-z0-9]+(\.[a-z0-9-]+)+">\s*<name>[^<]+<\/name>/);
  assert.ok(xml('summary')[0].text.length <= 35 && !xml('summary')[0].text.endsWith('.'), 'short summary without a full stop');

  const urls = Object.fromEntries(xml('url').map((u) => [attr(u.attrs, 'type'), u.text]));
  for (const type of ['homepage', 'bugtracker', 'vcs-browser']) assert.match(urls[type] ?? '', /^https:\/\//, type);

  const colors = xml('color').map((c) => attr(c.attrs, 'scheme_preference'));
  assert.deepEqual(colors.sort(), ['dark', 'light']);
  assert.ok(xml('category').length > 0);
  assert.ok(xml('keyword').length > 0);
  assert.deepEqual(xml('binary').map((b) => b.text), [scalar('command')]);
  assert.deepEqual(xml('mediatype').map((m) => m.text), ['application/pdf']);

  // The newest release is the app version, with a date.
  const release = /<release\s+version="([^"]*)"\s+date="(\d{4}-\d{2}-\d{2})"/.exec(metainfo);
  assert.ok(release, 'releases list a version and a date');
  assert.equal(release[1], pkg.version, 'the top <release> is the version in package.json');

  // Screenshots: absolute URLs to images in this repository on main, as JPEG or PNG.
  const images = xml('image');
  assert.ok(images.length >= 1);
  assert.equal((metainfo.match(/<screenshot type="default">/g) ?? []).length, 1);
  for (const { text } of images) {
    const prefix = 'https://raw.githubusercontent.com/OpenAEC-Foundation/open-pdf-studio/main/';
    assert.ok(text.startsWith(prefix), text);
    const file = path.join(repoDir, text.slice(prefix.length));
    assert.ok(existsSync(file), `${text} exists in the repository`);
    const head = readFileSync(file).subarray(0, 4);
    if (/\.jpe?g$/.test(file)) assert.equal(head.readUInt16BE(0), 0xffd8, `${text} is a JPEG`);
    else assert.equal(head.toString('latin1', 1, 4), 'PNG', `${text} is a PNG`);
  }
});

test('the desktop file and icons match the app id', () => {
  assert.match(desktop, new RegExp(`^Icon=${APP_ID.replace(/\./g, '\\.')}$`, 'm'));
  assert.match(desktop, new RegExp(`^Exec=${scalar('command')} %[fF]$`, 'm'));
  assert.match(desktop, /^MimeType=(.*;)?application\/pdf;/m);
  assert.match(manifest, new RegExp(`share/applications/${APP_ID}\\.desktop$`, 'm'));
  assert.match(manifest, new RegExp(`share/metainfo/${APP_ID}\\.metainfo\\.xml$`, 'm'));

  // At least one PNG icon of 128 px or more, exported under the app id, and
  // the source file really has that size.
  const icons = [...manifest.matchAll(/install -Dm644 (\S+\.png) \$\{FLATPAK_DEST\}\/share\/icons\/hicolor\/(\d+)x\2\/apps\/(\S+)\.png/g)];
  assert.ok(icons.length > 0);
  for (const [, source, size, name] of icons) {
    assert.equal(name, APP_ID);
    const png = readFileSync(path.join(repoDir, source));
    assert.equal(png.readUInt32BE(16), Number(size), `${source} width`);
    assert.equal(png.readUInt32BE(20), Number(size), `${source} height`);
  }
  assert.ok(icons.some(([, , size]) => Number(size) >= 128), 'an icon of at least 128x128');
});

test('the Flathub manifest replaces the local checkout with the release tag', () => {
  const commit = 'c'.repeat(40);
  const flathub = flathubManifest(manifest, { tag: `v${pkg.version}`, commit });
  assert.doesNotMatch(flathub, /type: dir|path: \.\./);
  assert.match(flathub, new RegExp(
    `- type: git\\n {8}url: https://github\\.com/OpenAEC-Foundation/open-pdf-studio\\.git\\n {8}tag: v${pkg.version.replace(/\./g, '\\.')}\\n {8}commit: ${commit}\\n`,
  ));
  // Everything else stays as it is.
  const withoutSource = (text) => text.replace(/ {6}# The app itself[\s\S]*?\n\n/, '');
  assert.equal(withoutSource(flathub), withoutSource(manifest));
  assert.throws(() => flathubManifest(manifest, { tag: pkg.version, commit }), /vYYYY/);
  assert.throws(() => flathubManifest(manifest, { tag: `v${pkg.version}`, commit: 'abc1234' }), /40-character/);
});

test('CI lints the Flatpak on changes and builds it on release', () => {
  const ci = read('.github/workflows/ci.yml');
  const release = read('.github/workflows/release.yml');
  assert.match(ci, /bash flatpak\/ci-check\.sh lint/);
  const job = ci.slice(ci.indexOf('\n  flatpak-lint:\n'), ci.indexOf('\n  hosted-csp:\n'));
  assert.match(job, /Detect Flatpak changes/);
  assert.match(job, /\^\(flatpak\/\|Cargo\\\.lock\$\|open-pdf-studio\/package-lock\\\.json\$/, 'the lint job looks at changes under flatpak/ and the lockfiles');
  assert.match(release, /bash flatpak\/ci-check\.sh lint/);
  assert.match(release, /bash flatpak\/ci-check\.sh build/);
  const script = read('flatpak/ci-check.sh');
  for (const check of ['desktop-file-validate', 'appstreamcli validate', 'flatpak-builder-lint', ' manifest ', ' appstream ', ' repo repo']) {
    assert.ok(script.includes(check), `ci-check.sh runs ${check.trim()}`);
  }
});
