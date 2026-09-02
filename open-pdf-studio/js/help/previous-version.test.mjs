// Unit-tests voor de vorige-versie-selectie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVersion, compareVersions, findPreviousRelease, pickAssets, pickDownloadUrl } from './previous-version.js';

test('parseVersion: kale semver met of zonder v-prefix', () => {
  assert.deepEqual(parseVersion('v1.93.1'), [1, 93, 1]);
  assert.deepEqual(parseVersion('1.84.0'), [1, 84, 0]);
  assert.equal(parseVersion('nightly'), null);
  assert.equal(parseVersion('1.91.0-nightly.20260831'), null);
  assert.equal(parseVersion(''), null);
});

test('compareVersions ordent major/minor/patch', () => {
  assert.equal(compareVersions([1, 93, 1], [1, 93, 0]), 1);
  assert.equal(compareVersions([1, 9, 0], [1, 84, 0]), -1);
  assert.equal(compareVersions([2, 0, 0], [1, 99, 99]), 1);
  assert.equal(compareVersions([1, 93, 1], [1, 93, 1]), 0);
});

const RELEASES = [
  { tag_name: 'v1.93.1', draft: false, prerelease: false, html_url: 'u931' },
  { tag_name: 'nightly', draft: false, prerelease: true, html_url: 'un' },
  { tag_name: 'v1.92.0', draft: false, prerelease: false, html_url: 'u92' },
  { tag_name: 'v1.90.0', draft: true, prerelease: false, html_url: 'u90' },
  { tag_name: 'v1.84.0', draft: false, prerelease: false, html_url: 'u84' },
  { tag_name: 'v1.83.0', draft: false, prerelease: true, html_url: 'u83' },
];

test('findPreviousRelease: nieuwste gepubliceerde versie ONDER de huidige', () => {
  assert.equal(findPreviousRelease(RELEASES, '1.93.1').tag_name, 'v1.92.0');
  // concepten en pre-releases tellen niet mee, ook niet als ze nieuwer zijn
  assert.equal(findPreviousRelease(RELEASES, '1.92.0').tag_name, 'v1.84.0');
  // niets ouder beschikbaar
  assert.equal(findPreviousRelease(RELEASES, '1.84.0'), null);
  assert.equal(findPreviousRelease(RELEASES, 'nightly'), null);
});

test('pickAssets kiest per platform en verwart user/system niet', () => {
  const uit = pickAssets({
    html_url: 'pagina',
    assets: [
      { name: 'Open.PDF.Studio_1.92.0_x64-setup.exe', browser_download_url: 'sys' },
      { name: 'Open.PDF.Studio_1.92.0_x64_user-setup.exe', browser_download_url: 'usr' },
      { name: 'Open.PDF.Studio_1.92.0_universal.dmg', browser_download_url: 'mac' },
      { name: 'Open.PDF.Studio_1.92.0_amd64.AppImage', browser_download_url: 'lin' },
    ],
  });
  assert.equal(uit.winSystem, 'sys');
  assert.equal(uit.winUser, 'usr');
  assert.equal(uit.dmg, 'mac');
  assert.equal(uit.pageUrl, 'pagina');
});

test('pickAssets zonder assets geeft alleen de release-pagina', () => {
  const uit = pickAssets({ html_url: 'p', assets: [] });
  assert.deepEqual(uit, { winUser: null, winSystem: null, dmg: null, pageUrl: 'p' });
});

test('pickDownloadUrl kiest per platform', () => {
  const assets = { winUser: 'usr', winSystem: 'sys', dmg: 'mac', pageUrl: 'pagina' };
  assert.equal(pickDownloadUrl(assets, 'Mozilla Windows NT'), 'usr');
  assert.equal(pickDownloadUrl(assets, 'Macintosh Intel Mac OS X'), 'mac');
  assert.equal(pickDownloadUrl(assets, 'X11 Linux x86_64'), 'pagina');
  // terugval als de gebruikersinstaller ontbreekt
  assert.equal(pickDownloadUrl({ ...assets, winUser: null }, 'Windows'), 'sys');
  assert.equal(pickDownloadUrl({ pageUrl: 'pagina' }, 'Windows'), 'pagina');
});
