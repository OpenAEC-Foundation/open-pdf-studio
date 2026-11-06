// #635: elk platform legt vast welke PDFium-revisie het meelevert. De
// metadata in src-tauri/binaries/pdfium-runtime.json moet kloppen met de
// meegeleverde bestanden, de macOS-voorbereiding (native-runtime.mjs), de
// README's en de CI-stappen die de Linux-bibliotheek ophalen. Zo kan een
// binary niet stil van revisie wisselen.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { PDFIUM_RUNTIME } from './native-runtime.mjs';

const app = fileURLToPath(new URL('..', import.meta.url));
const binaries = join(app, 'src-tauri', 'binaries');
const workflows = join(app, '..', '.github', 'workflows');
const manifest = JSON.parse(readFileSync(join(binaries, 'pdfium-runtime.json'), 'utf8'));
const platforms = Object.entries(manifest.platforms);
const ASSET = { 'win-x64': 'win-x64', 'win-arm64': 'win-arm64', 'linux-x64': 'linux-x64', 'macos-universal': 'mac-univ' };
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

test('every shipped platform names its PDFium revision, archive and checksums', () => {
  assert.deepEqual(platforms.map(([name]) => name).sort(), Object.keys(ASSET).sort());
  for (const [name, entry] of platforms) {
    assert.match(entry.revision, /^\d{4,}$/, `${name}: revision`);
    assert.equal(entry.archive,
      `https://github.com/bblanchon/pdfium-binaries/releases/download/chromium%2F${entry.revision}/pdfium-${ASSET[name]}.tgz`,
      `${name}: archive of the recorded revision`);
    assert.match(entry.archive_sha256, /^[0-9a-f]{64}$/, `${name}: archive checksum`);
    assert.match(entry.library_sha256, /^[0-9a-f]{64}$/, `${name}: library checksum`);
    assert.ok(['repository', 'ci-fetch', 'native-runtime'].includes(entry.shipped_from), `${name}: shipped_from`);
    assert.ok(existsSync(join(binaries, entry.library)), `${name}: ${entry.library} exists`);
  }
});

test('all platforms ship the same revision', () => {
  // Een revisiewissel gaat over alle platforms tegelijk (#635); wijkt er één
  // bewust af, maak dat dan hier expliciet.
  assert.equal(new Set(platforms.map(([, entry]) => entry.revision)).size, 1);
});

test('libraries shipped from the repository are the recorded ones', () => {
  for (const [name, entry] of platforms.filter(([, e]) => e.shipped_from === 'repository')) {
    assert.equal(sha256(join(binaries, entry.library)), entry.library_sha256, `${name}: ${entry.library} changed without updating pdfium-runtime.json`);
  }
});

test('the Windows READMEs document the recorded revision', () => {
  for (const name of ['win-x64', 'win-arm64']) {
    const readme = readFileSync(join(binaries, name, 'README.md'), 'utf8');
    assert.ok(readme.includes(`chromium/${manifest.platforms[name].revision}`) || readme.includes(`chromium%2F${manifest.platforms[name].revision}`), `${name} README`);
  }
  const x64 = readFileSync(join(binaries, 'win-x64', 'README.md'), 'utf8');
  assert.ok(x64.includes(manifest.platforms['win-x64'].library_sha256), 'win-x64 README lists the DLL checksum');
});

test('macOS: native-runtime.mjs downloads and verifies the recorded revision', () => {
  const mac = manifest.platforms['macos-universal'];
  assert.equal(PDFIUM_RUNTIME.version, mac.revision);
  assert.equal(PDFIUM_RUNTIME.url, mac.archive);
  assert.equal(PDFIUM_RUNTIME.sha256, mac.archive_sha256);
  const runtime = JSON.parse(readFileSync(join(binaries, 'macos-universal', 'libpdfium.dylib.runtime.json'), 'utf8'));
  assert.deepEqual(runtime, { version: mac.revision, sha256: mac.archive_sha256 });
});

test('CI fetches only recorded revisions and verifies their checksums', () => {
  const byAsset = Object.fromEntries(platforms.map(([name, entry]) => [ASSET[name], entry]));
  let fetches = 0;
  for (const file of readdirSync(workflows).filter(f => /\.ya?ml$/.test(f))) {
    const text = readFileSync(join(workflows, file), 'utf8');
    for (const match of text.matchAll(/pdfium-binaries\/releases\/download\/chromium%2F(\d+)\/pdfium-([a-z0-9-]+)\.tgz"? -o (\S+)/g)) {
      const [, revision, asset, target] = match;
      const entry = byAsset[asset];
      assert.ok(entry, `${file}: unrecorded asset ${asset}`);
      assert.equal(revision, entry.revision, `${file}: ${asset} revision`);
      assert.equal(entry.shipped_from, 'ci-fetch', `${file}: ${asset} is fetched in CI`);
      assert.ok(text.includes(`echo "${entry.archive_sha256}  ${target}" | sha256sum -c -`), `${file}: ${asset} checksum verified`);
      fetches++;
    }
  }
  assert.ok(fetches >= 3, 'ci, nightly and release fetch the Linux library');
});

// pdfium-render bindt bij het laden ALLE functies van zijn binding-feature
// (pdfium_xxxx); exporteert de meegeleverde PDFium er één niet, dan mislukt
// het binden en rendert de app zonder PDFium. De standaard-feature
// pdfium_latest volgt de crate en niet onze binary, dus elke crate kiest de
// binding expliciet, en die mag niet nieuwer zijn dan de meegeleverde revisie.
test('pdfium-render binds a PDFium revision no newer than the shipped one', () => {
  const revision = Number(manifest.platforms['win-x64'].revision);
  const crates = ['../../pdfium-worker/Cargo.toml', '../src-tauri/Cargo.toml'];
  for (const crate of crates) {
    const text = readFileSync(fileURLToPath(new URL(crate, import.meta.url)), 'utf8');
    const line = text.split(/\r?\n/).find(l => /^pdfium-render\s*=/.test(l));
    assert.ok(line, `${crate}: depends on pdfium-render`);
    assert.match(line, /default-features\s*=\s*false/, `${crate}: no pdfium_latest via the default features`);
    const bindings = [...line.matchAll(/"pdfium_(\d{4})"/g)].map(m => Number(m[1]));
    assert.equal(bindings.length, 1, `${crate}: exactly one pdfium_xxxx binding feature`);
    assert.ok(bindings[0] <= revision, `${crate}: binding ${bindings[0]} is newer than the shipped PDFium ${revision}`);
  }
});

// #634: vóór pdfium-render 0.9.5 opende elke PdfPage meteen zijn structuurboom
// en hield PDFium die data vast tot het document sloot. De worker herlaadt
// getagde documenten daarom niet meer; dat mag alleen zolang de lock 0.9.5+
// vastlegt.
test('the lock pins a pdfium-render that loads structure trees lazily', () => {
  const lock = readFileSync(join(app, '..', 'Cargo.lock'), 'utf8');
  const versions = [...lock.matchAll(/name = "pdfium-render"\r?\nversion = "(\d+)\.(\d+)\.(\d+)"/g)];
  assert.ok(versions.length >= 1, 'Cargo.lock lists pdfium-render');
  for (const [, major, minor, patch] of versions) {
    const v = [Number(major), Number(minor), Number(patch)];
    assert.ok(v[0] > 0 || v[1] > 9 || (v[1] === 9 && v[2] >= 5), `pdfium-render ${v.join('.')} is older than 0.9.5`);
  }
});
