// Unit-tests voor de pure delen van de webbundel (#692): manifest, tar,
// pakketherkenning, derdenvermeldingen en bron.json.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gunzipSync, gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import {
  MANIFEST, archiefHashTekst, bestandenIn, bronJson, bundelLicenties, bundelNaam, controleerManifest,
  isVeiligPad, isViteHulp, leesManifest, leesTar, licentieBestanden, maakTar, manifestTekst, noticesTekst,
  pakketGegevens, pakketMap, pakketMappen, pakUit, sha256, splitsTarPad,
} from './webbundel.mjs';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tijdelijk = () => fs.mkdtempSync(path.join(os.tmpdir(), 'opds-webbundel-'));

test('archive name carries the version', () => {
  assert.equal(bundelNaam('2026.43.6'), 'open-pdf-studio-web-2026.43.6');
});

test('manifest is sorted, in sha256sum format, and reads back', () => {
  const tekst = manifestTekst([
    { pad: 'b/x.js', hash: 'b'.repeat(64) },
    { pad: 'a.html', hash: 'a'.repeat(64) },
  ]);
  assert.equal(tekst, `${'a'.repeat(64)}  a.html\n${'b'.repeat(64)}  b/x.js\n`);
  assert.deepEqual([...leesManifest(tekst)], [['a.html', 'a'.repeat(64)], ['b/x.js', 'b'.repeat(64)]]);
  assert.throws(() => leesManifest('nonsense\n'));
});

test('manifest check finds changed, missing and unlisted files', () => {
  const map = tijdelijk();
  try {
    fs.mkdirSync(path.join(map, 'assets'));
    fs.writeFileSync(path.join(map, 'index.html'), 'hallo');
    fs.writeFileSync(path.join(map, 'assets', 'a.js'), 'a');
    const items = bestandenIn(map).map((p) => ({ pad: p, hash: sha256(fs.readFileSync(path.join(map, p))) }));
    fs.writeFileSync(path.join(map, MANIFEST), manifestTekst(items));
    assert.deepEqual(controleerManifest(map), []);

    fs.writeFileSync(path.join(map, 'assets', 'a.js'), 'b');
    fs.writeFileSync(path.join(map, 'extra.txt'), 'x');
    fs.rmSync(path.join(map, 'index.html'));
    assert.deepEqual(controleerManifest(map).sort(), ['hash differs: assets/a.js', 'missing: index.html', 'not in manifest: extra.txt']);
  } finally {
    fs.rmSync(map, { recursive: true, force: true });
  }
});

test('archive hash file works with sha256sum -c', () => {
  assert.equal(archiefHashTekst('f'.repeat(64), 'x.tar.gz'), `${'f'.repeat(64)}  x.tar.gz\n`);
});

test('bron.json names version, tag, commit, licence and source', () => {
  const commit = '0123456789abcdef0123456789abcdef01234567';
  assert.deepEqual(bronJson({ versie: '2026.43.6', tag: 'v2026.43.6', commit }), {
    versie: '2026.43.6',
    tag: 'v2026.43.6',
    commit,
    licentie: 'LGPL-3.0-or-later',
    broncode: `https://github.com/OpenAEC-Foundation/open-pdf-studio/tree/${commit}`,
  });
  assert.throws(() => bronJson({ versie: '1', tag: 'v1', commit: 'abc' }));
});

test('package folder from a module id', () => {
  assert.equal(pakketMap('C:\\app\\node_modules\\pdf-lib\\cjs\\index.js'), 'C:/app/node_modules/pdf-lib');
  assert.equal(pakketMap('/app/node_modules/@pdf-lib/fontkit/dist/x.mjs?commonjs-es-import'), '/app/node_modules/@pdf-lib/fontkit');
  assert.equal(pakketMap('\0/app/node_modules/a/node_modules/b/i.js?commonjs-proxy'), '/app/node_modules/a/node_modules/b');
  assert.equal(pakketMap('/app/js/main.js'), null);
  assert.equal(pakketMap('/app/node_modules/@scope'), null);
});

test('vite helpers count as the vite package', () => {
  assert.ok(isViteHulp('\0vite/preload-helper.js'));
  assert.ok(isViteHulp('\0vite/modulepreload-polyfill.js'));
  assert.ok(isViteHulp('\0commonjsHelpers.js'));
  assert.ok(isViteHulp('__vite-browser-external'));
  assert.ok(!isViteHulp('/app/js/vite-like.js'));
  assert.deepEqual(
    pakketMappen(['\0vite/preload-helper.js', '/a/node_modules/x/i.js', '/a/node_modules/x/j.js', '/a/js/m.js'], '/a'),
    ['/a/node_modules/vite', '/a/node_modules/x'],
  );
});

test('licence files are found in the package root only', () => {
  const map = tijdelijk();
  try {
    for (const n of ['LICENSE', 'LICENCE.md', 'COPYING', 'NOTICE.txt', 'License-MIT', 'README.md', 'licenses.js']) {
      fs.writeFileSync(path.join(map, n), n);
    }
    assert.deepEqual(licentieBestanden(map), ['COPYING', 'LICENCE.md', 'LICENSE', 'License-MIT', 'NOTICE.txt']);
    assert.deepEqual(bundelLicenties(['pdfjs/LICENSE', 'pdfjs/web/standard_fonts/LICENSE_FOXIT', 'assets/license.js']),
      ['pdfjs/LICENSE', 'pdfjs/web/standard_fonts/LICENSE_FOXIT']);
  } finally {
    fs.rmSync(map, { recursive: true, force: true });
  }
});

test('notices carry the full licence text with copyright lines', () => {
  const pdfLib = pakketGegevens(path.join(APP, 'node_modules', 'pdf-lib'));
  assert.equal(pdfLib.naam, 'pdf-lib');
  assert.equal(pdfLib.licentie, 'MIT');
  const tekst = noticesTekst([pdfLib, { naam: 'zonder', versie: '1.0.0', licentie: 'MIT', auteur: 'X', homepage: '', teksten: [] }], ['pdfjs/LICENSE']);
  assert.match(tekst, /LGPL-3\.0-or-later/);
  assert.match(tekst, /pdf-lib \d+\.\d+\.\d+\nLicense: MIT/);
  assert.match(tekst, /Copyright \(c\)/);
  assert.match(tekst, /zonder 1\.0\.0[\s\S]*ships no licence file/);
  assert.match(tekst, / {2}pdfjs\/LICENSE\n$/);
});

test('ustar paths over 100 bytes go into the prefix field', () => {
  assert.deepEqual(splitsTarPad('a/b.js'), { prefix: '', naam: 'a/b.js' });
  const lang = `${'d'.repeat(90)}/${'e'.repeat(30)}/f.js`;
  assert.deepEqual(splitsTarPad(lang), { prefix: `${'d'.repeat(90)}/${'e'.repeat(30)}`, naam: 'f.js' });
  assert.throws(() => splitsTarPad('x'.repeat(120)));
});

test('tar is deterministic and reads back', () => {
  const items = [
    { pad: 'index.html', data: Buffer.from('<!doctype html>') },
    { pad: 'assets/leeg.js', data: Buffer.alloc(0) },
    { pad: 'pdfjs/web/cmaps/x.bcmap', data: new Uint8Array(1000).fill(7) },
  ];
  const a = maakTar(items, 1700000000);
  assert.deepEqual(a, maakTar(items, 1700000000));
  assert.equal(a.length % 512, 0);
  const terug = leesTar(gunzipSync(gzipSync(a)));
  assert.deepEqual(terug.map((i) => i.pad), items.map((i) => i.pad));
  assert.deepEqual(terug[2].data, Buffer.from(items[2].data));
});

test('unsafe archive paths are refused', () => {
  for (const pad of ['../x', '/etc/x', 'a/../../x', 'C:/x', 'a\\b', 'a//b']) assert.ok(!isVeiligPad(pad), pad);
  assert.ok(isVeiligPad('assets/a.js'));
  assert.throws(() => maakTar([{ pad: '../x', data: Buffer.alloc(1) }]));
});

test('system tar reads our archive', (t) => {
  let tar;
  try { tar = execFileSync('tar', ['--version'], { encoding: 'utf8' }); } catch { t.skip('no tar'); return; }
  assert.ok(tar);
  const map = tijdelijk();
  try {
    const items = [{ pad: 'index.html', data: Buffer.from('hoi') }, { pad: `${'p'.repeat(110)}/b.txt`, data: Buffer.from('lang') }];
    fs.writeFileSync(path.join(map, 'x.tar'), maakTar(items, 0));
    const uit = path.join(map, 'uit');
    fs.mkdirSync(uit);
    execFileSync('tar', ['-xf', 'x.tar', '-C', 'uit'], { cwd: map });
    assert.equal(fs.readFileSync(path.join(uit, 'index.html'), 'utf8'), 'hoi');
    assert.equal(fs.readFileSync(path.join(uit, 'p'.repeat(110), 'b.txt'), 'utf8'), 'lang');
    const eigen = path.join(map, 'eigen');
    pakUit(leesTar(fs.readFileSync(path.join(map, 'x.tar'))), eigen);
    assert.deepEqual(bestandenIn(eigen), bestandenIn(uit));
  } finally {
    fs.rmSync(map, { recursive: true, force: true });
  }
});

test('release workflow builds, checks and attaches the web bundle after the version check', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['pack:hosted'], 'node scripts/pak-webbundel.mjs');
  assert.equal(pkg.scripts['verify:hosted-bundle'], 'node scripts/controleer-webbundel.mjs');
  const yml = fs.readFileSync(path.join(APP, '..', '.github', 'workflows', 'release.yml'), 'utf8').replace(/\r\n/g, '\n');
  const job = /\n {2}web-bundle:\n([\s\S]*?)(?=\n {2}[a-z-]+:\n)/.exec(yml)?.[1];
  assert.ok(job, 'release.yml has a web-bundle job');
  assert.match(job, /needs: create-release/);
  assert.match(job, /npm run pack:hosted -- --tag "\$VERSION"/);
  assert.match(job, /npm run verify:hosted-bundle/);
  assert.match(job, /gh release upload "\$VERSION" "\$ARCHIVE" "\$ARCHIVE\.sha256" --clobber/);
  // De versiecontrole staat in create-release, waar deze job op wacht.
  assert.match(yml, /create-release:[\s\S]*bump-version\.js --check "\$VERSION"[\s\S]*\n {2}build:\n/);
});
