// Licentie-overzicht (#629): LICENSE.md, GPL-3.0.txt en LICENSING.md in de
// hoofdmap blijven kloppen met de pakketten en manifesten.
//
// - LICENSE.md bevat alleen de LGPL v3; de GPL v3 staat los in GPL-3.0.txt.
//   Samen in één bestand herkent GitHub de licentie niet ("Other").
// - Geen tweede licentiebestand in de hoofdmap (LICENSE*, COPYING*): ook dat
//   maakt de licentieherkenning van GitHub onzeker.
// - Elke runtime-afhankelijkheid uit package.json staat in de tabel van
//   LICENSING.md, met de licentie uit haar eigen package.json.
// - Elk manifest (Cargo.toml, package.json, pyproject, Snap, Flatpak, AUR,
//   MCP-bundel) noemt de licentie die LICENSING.md voor dat onderdeel noemt.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(app, '..');
const lees = (p) => fs.readFileSync(path.join(repo, p), 'utf8').replace(/\r\n/g, '\n');
const LICENSING = lees('LICENSING.md');

/** De tabelregels van LICENSING.md als lijsten cellen. */
const RIJEN = LICENSING.split('\n')
  .filter((r) => r.startsWith('|') && !/^\|\s*-/.test(r))
  .map((r) => r.slice(1, -1).split('|').map((c) => c.trim()));

/** De licentiecel van de rij waarvan de eerste cel `naam` (tussen backticks) noemt. */
function licentieVoor(naam) {
  const rij = RIJEN.find((cellen) => cellen[0].split(/[,\s]+/).some((w) => w.replace(/`/g, '') === naam));
  return rij ? rij[1] : null;
}

test('LICENSE.md is alleen de LGPL v3, de GPL v3 staat in GPL-3.0.txt', () => {
  const lgpl = lees('LICENSE.md').split('\n');
  assert.equal(lgpl[0].trim(), 'GNU LESSER GENERAL PUBLIC LICENSE');
  assert.equal(lgpl[1].trim(), 'Version 3, 29 June 2007');
  assert.ok(!lgpl.some((r) => r.trim() === 'GNU GENERAL PUBLIC LICENSE'), 'geen GPL-tekst in LICENSE.md');
  assert.ok(lgpl.length < 200, `LICENSE.md is ${lgpl.length} regels, de LGPL v3 is er 165`);

  const gpl = lees('GPL-3.0.txt').split('\n');
  assert.equal(gpl[0].trim(), 'GNU GENERAL PUBLIC LICENSE');
  assert.equal(gpl[1].trim(), 'Version 3, 29 June 2007');
  assert.ok(gpl.some((r) => r.includes('END OF TERMS AND CONDITIONS')));
});

test('de hoofdmap heeft precies één licentiebestand', () => {
  const namen = fs.readdirSync(repo).filter((n) => /^(un)?licen[sc]e|^copying/i.test(n));
  assert.deepEqual(namen, ['LICENSE.md']);
});

test('elke runtime-afhankelijkheid staat in LICENSING.md met haar eigen licentie', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8'));
  for (const naam of Object.keys(pkg.dependencies)) {
    const vermeld = licentieVoor(naam);
    assert.ok(vermeld, `${naam} ontbreekt in LICENSING.md`);
    const eigen = path.join(app, 'node_modules', ...naam.split('/'), 'package.json');
    if (!fs.existsSync(eigen)) continue;
    const licentie = JSON.parse(fs.readFileSync(eigen, 'utf8')).license;
    // Een pakket zonder licentieveld (alleen een LICENSE-bestand upstream)
    // houdt de licentie die LICENSING.md noemt.
    if (typeof licentie === 'string') assert.equal(vermeld, licentie, `${naam}: licentie in LICENSING.md`);
  }
});

test('de MuPDF-vraag staat beantwoord in LICENSING.md', () => {
  assert.equal(licentieVoor('mupdf'), 'AGPL-3.0-or-later');
  assert.match(LICENSING, /## The AGPL question \(MuPDF\)/);
});

/** De `license = "..."` van een Cargo.toml (of pyproject). */
function tomlLicentie(p) {
  return lees(p).match(/^license\s*=\s*"([^"]+)"/m)?.[1] ?? null;
}

test('elk manifest noemt de licentie uit LICENSING.md', () => {
  const lgpl = 'LGPL-3.0-or-later';
  const krat = (naam) => tomlLicentie(`${naam}/Cargo.toml`);
  // Rust-kratten van deze repository.
  for (const naam of ['pdfium-worker', 'open-pdf-thumbnails', 'open-pdf-cad', 'open-pdf-cmyk', 'open-pdf-signatures']) {
    assert.equal(krat(naam), lgpl, `${naam}/Cargo.toml`);
    assert.equal(licentieVoor(naam), lgpl, `${naam} in LICENSING.md`);
  }
  for (const naam of ['open-pdf-render', 'open-pdf-security']) {
    assert.equal(krat(naam), 'MIT', `${naam}/Cargo.toml`);
    assert.equal(licentieVoor(naam), 'MIT', `${naam} in LICENSING.md`);
  }
  assert.equal(tomlLicentie('open-pdf-studio/src-tauri/Cargo.toml'), lgpl);
  assert.equal(JSON.parse(lees('open-pdf-studio/package.json')).license, lgpl);
  assert.equal(tomlLicentie('python/pyproject.toml'), lgpl);
  assert.equal(JSON.parse(lees('mcpb/manifest.json')).license, lgpl);
  assert.match(lees('snap/snapcraft.yaml'), /^license: LGPL-3\.0-or-later$/m);
  assert.match(lees('flatpak/org.openaec.OpenPdfStudio.metainfo.xml'), /<project_license>LGPL-3\.0-or-later<\/project_license>/);
  assert.match(lees('packaging/aur/PKGBUILD'), /^license=\('LGPL-3\.0-or-later'\)$/m);
  assert.match(LICENSING, /Licence of the application \| \*\*LGPL-3\.0-or-later\*\*/);
});

test('de Flatpak installeert beide licentieteksten', () => {
  const manifest = lees('flatpak/org.openaec.OpenPdfStudio.yml');
  assert.match(manifest, /install -Dm644 LICENSE\.md /);
  assert.match(manifest, /install -Dm644 GPL-3\.0\.txt /);
});
