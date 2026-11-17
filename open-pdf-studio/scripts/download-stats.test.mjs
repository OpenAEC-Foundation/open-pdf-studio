// Downloadstatistiek in de README: wat telt als installatiebestand, de
// optelling per platform en de tabel.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { platformVan, tel, tabel, PLATFORMS } from './download-stats.mjs';

test('installatiebestanden tellen per platform', () => {
  assert.equal(platformVan('Open.PDF.Studio_2026.47.0_x64-setup.exe'), 'Windows');
  assert.equal(platformVan('Open.PDF.Studio_2026.47.0_x64_user-setup.exe'), 'Windows');
  assert.equal(platformVan('Open.PDF.Studio_2026.47.0_x64_portable.zip'), 'Windows');
  assert.equal(platformVan('Open.PDF.Studio_2.4.0_x64_en-US.msi'), 'Windows');
  assert.equal(platformVan('Open.PDF.Studio_2026.47.0_universal.dmg'), 'macOS');
  assert.equal(platformVan('Open.PDF.Studio_2026.47.0_amd64.deb'), 'Linux');
  assert.equal(platformVan('Open.PDF.Studio_2026.47.0_amd64.AppImage'), 'Linux');
  assert.equal(platformVan('open-pdf-studio_2026.47.0_amd64.snap'), 'Linux');
  assert.equal(platformVan('open-pdf-studio-release.apk'), 'Android');
});

test('updates, handtekeningen en overige bestanden tellen niet', () => {
  for (const naam of [
    'latest.json', 'latest-user.json',
    'Open.PDF.Studio_2026.47.0_x64-setup.exe.sig',
    'Open.PDF.Studio_2026.47.0_x64-setup.nsis.zip', 'Open.PDF.Studio_2026.47.0_x64-setup.nsis.zip.sig',
    'Open.PDF.Studio_universal.app.tar.gz', 'Open.PDF.Studio_2026.47.0_amd64.AppImage.tar.gz',
    'Open.PDF.Studio_2026.47.0_amd64.deb.asc', 'Open.PDF.Studio_2026.47.0_x64_portable.zip.sha256',
    'open-pdf-studio.mcpb', 'open-pdf-studio-web-2026.47.0.tar.gz', 'winget-manifests-2026.47.0.zip',
    'open_pdf_studio-2026.47.0-py3-none-any.whl', 'signing-fingerprint.txt', '', null,
  ]) {
    assert.equal(platformVan(naam), null, String(naam));
  }
});

const RELEASES = [
  { tag_name: 'v1', draft: false, prerelease: false, published_at: '2026-01-01T00:00:00Z', assets: [
    { name: 'a_x64-setup.exe', download_count: 100 }, { name: 'a.dmg', download_count: 10 }, { name: 'latest.json', download_count: 999 },
  ] },
  { tag_name: 'v2', draft: false, prerelease: false, published_at: '2026-02-01T00:00:00Z', assets: [
    { name: 'b_x64-setup.exe', download_count: 50 }, { name: 'b_x64-setup.nsis.zip', download_count: 500 },
    { name: 'b_amd64.deb', download_count: 5 }, { name: 'b.apk', download_count: 3 },
  ] },
  { tag_name: 'nightly', draft: false, prerelease: true, published_at: '2026-03-01T00:00:00Z', assets: [{ name: 'n_x64-setup.exe', download_count: 7000 }] },
  { tag_name: 'v3', draft: true, prerelease: false, published_at: '2026-03-02T00:00:00Z', assets: [{ name: 'c_x64-setup.exe', download_count: 8000 }] },
];

test('optelling: alleen gepubliceerde releases, de nieuwste apart', () => {
  const s = tel(RELEASES);
  assert.equal(s.releases, 2);
  assert.equal(s.laatsteTag, 'v2');
  assert.deepEqual(s.totaal, { Windows: 150, macOS: 10, Linux: 5, Android: 3 });
  assert.deepEqual(s.laatste, { Windows: 50, macOS: 0, Linux: 5, Android: 3 });
  assert.deepEqual(tel([]).totaal, { Windows: 0, macOS: 0, Linux: 0, Android: 0 });
});

test('de tabel: rijen per platform, totaal, taartdiagram en de datum', () => {
  const en = tabel(tel(RELEASES), 'en', '2026-11-17');
  assert.match(en, /\| Windows \| 150 \| 50 \| 89\.3% \|/);
  assert.match(en, /\| \*\*Total\*\* \| \*\*168\*\* \| \*\*58\*\* \| \*\*100%\*\* \|/);
  assert.match(en, /pie showData/);
  assert.match(en, /"Windows" : 150/);
  assert.match(en, /Counted on 2026-11-17 over 2 releases; the latest is v2\./);
  const nl = tabel(tel(RELEASES), 'nl', '2026-11-17');
  assert.match(nl, /\| Platform \| Alle releases \| Laatste release \| Aandeel \|/);
  assert.match(nl, /Geteld op 2026-11-17 over 2 releases/);
  // Een platform zonder downloads krijgt geen taartpunt.
  assert.doesNotMatch(tabel(tel([RELEASES[0]]), 'en', '2026-11-17'), /"Android"/);
});

test('beide README\'s hebben de markeringen met een tabel ertussen', () => {
  for (const [bestand, kop] of [['README.md', 'All releases'], ['README.nl.md', 'Alle releases']]) {
    const s = readFileSync(new URL(`../../${bestand}`, import.meta.url), 'utf8');
    const m = s.match(/<!-- download-stats:start -->([\s\S]*?)<!-- download-stats:end -->/);
    assert.ok(m, `${bestand}: markers`);
    assert.ok(m[1].includes(kop), `${bestand}: table`);
    for (const p of PLATFORMS) assert.ok(m[1].includes(`| ${p} |`), `${bestand}: ${p}`);
  }
});
