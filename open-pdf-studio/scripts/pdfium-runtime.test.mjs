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
