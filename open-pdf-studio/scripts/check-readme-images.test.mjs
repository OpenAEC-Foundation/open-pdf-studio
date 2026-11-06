// Tests voor scripts/check-readme-images.mjs: de README-beelden van deze
// repository kloppen, en de controle vangt elk soort fout op een proefmap.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { beeldVerwijzingen, controleerReadmeBeelden, pngMaat } from './check-readme-images.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Kleinste geldige PNG van de gegeven breedte (één rij, grijs). */
function png(breedte, extra = 0) {
  const crcTabel = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTabel[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const blok = (soort, data) => {
    const lengte = Buffer.alloc(4);
    lengte.writeUInt32BE(data.length);
    const inhoud = Buffer.concat([Buffer.from(soort, 'ascii'), data]);
    const som = Buffer.alloc(4);
    som.writeUInt32BE(crc(inhoud));
    return Buffer.concat([lengte, inhoud, som]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(breedte, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; // bitdiepte
  ihdr[9] = 0; // grijs
  const rij = Buffer.alloc(breedte + 1);
  const delen = [
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    blok('IHDR', ihdr),
    blok('IDAT', zlib.deflateSync(rij)),
  ];
  if (extra) delen.push(blok('tEXt', Buffer.alloc(extra, 0x41)));
  delen.push(blok('IEND', Buffer.alloc(0)));
  return Buffer.concat(delen);
}

const proefmappen = [];
test.after(() => { for (const m of proefmappen) fs.rmSync(m, { recursive: true, force: true }); });

function proefmap({ en, nl, beelden }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'readme-beelden-'));
  proefmappen.push(root);
  fs.mkdirSync(path.join(root, 'docs', 'images', 'readme'), { recursive: true });
  if (en != null) fs.writeFileSync(path.join(root, 'README.md'), en);
  if (nl != null) fs.writeFileSync(path.join(root, 'README.nl.md'), nl);
  for (const [naam, bytes] of Object.entries(beelden)) fs.writeFileSync(path.join(root, 'docs', 'images', 'readme', naam), bytes);
  return root;
}

test('the README images of this repository pass', () => {
  assert.deepEqual(controleerReadmeBeelden(REPO), []);
});

test('both READMEs use the same images in the same order', () => {
  const lijst = (naam) => beeldVerwijzingen(fs.readFileSync(path.join(REPO, naam), 'utf8'))
    .filter((p) => p.startsWith('docs/images/readme/'));
  const en = lijst('README.md');
  assert.ok(en.length >= 5, 'a hero image and at least four screenshots');
  assert.deepEqual(lijst('README.nl.md'), en);
});

test('beeldVerwijzingen finds Markdown and HTML images and skips external ones', () => {
  const tekst = [
    '![Hero](docs/images/readme/hero.png)',
    '![Titel](docs/images/readme/a.png "titel")',
    '<img src="docs/images/readme/b.png" width="50%">',
    '![Badge](https://img.shields.io/badge/x-y-blue)',
    '[link](docs/features.md)',
  ].join('\n');
  assert.deepEqual(beeldVerwijzingen(tekst), ['docs/images/readme/hero.png', 'docs/images/readme/a.png', 'docs/images/readme/b.png']);
});

test('pngMaat reads the width and rejects other files', () => {
  assert.deepEqual(pngMaat(png(1400)), { breedte: 1400, hoogte: 1 });
  assert.equal(pngMaat(Buffer.from('GIF89a')), null);
});

test('a correct pair of READMEs passes', () => {
  const tekst = '![x](docs/images/readme/a.png)';
  const root = proefmap({ en: tekst, nl: tekst, beelden: { 'a.png': png(1440) } });
  assert.deepEqual(controleerReadmeBeelden(root), []);
});

test('a missing image, an unused image, a large image and a wrong width all fail', () => {
  const root = proefmap({
    en: '![a](docs/images/readme/a.png) ![weg](docs/images/readme/weg.png) ![groot](docs/images/readme/groot.png) ![smal](docs/images/readme/smal.png)',
    nl: '![a](docs/images/readme/a.png) ![groot](docs/images/readme/groot.png) ![smal](docs/images/readme/smal.png)',
    beelden: {
      'a.png': png(1600),
      'los.png': png(1280),
      'groot.png': png(1500, 160 * 1024),
      'smal.png': png(800),
    },
  });
  const fouten = controleerReadmeBeelden(root);
  const heeft = (re) => assert.ok(fouten.some((f) => re.test(f)), `expected ${re} in:\n${fouten.join('\n')}`);
  heeft(/README\.md uses docs\/images\/readme\/weg\.png, which does not exist/);
  heeft(/los\.png is not used in README\.md/);
  heeft(/los\.png is not used in README\.nl\.md/);
  heeft(/groot\.png is \d+ kB, more than 150 kB/);
  heeft(/smal\.png is 800 px wide/);
  assert.ok(!fouten.some((f) => /a\.png/.test(f)), 'a.png is fine');
});

test('a missing Dutch README fails', () => {
  const root = proefmap({ en: 'no images', beelden: {} });
  assert.deepEqual(controleerReadmeBeelden(root), ['README.nl.md is missing']);
});
