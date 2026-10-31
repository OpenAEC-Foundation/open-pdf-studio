// De draagbare Windows-zip (#881): welke bestanden erin gaan, waar ze staan,
// dat de zip zelf klopt, en dat de releaseworkflow hem bouwt en uploadt. Met
// een nep-doelmap en een nep-src-tauri; er draait geen cargo.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import {
  DATAMAP, LEESMIJ, MARKERING, PROGRAMMA, TOPMAP, crc32, draagbareIndeling, hashRegel,
  leesBundelConfig, leesmijTekst, maakDraagbareZip, markeringTekst, schrijfZip, zipNaam,
} from './draagbare-zip.mjs';
import { zipNaam as zipNaamFrontend } from '../js/core/draagbaar.js';

const hier = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(hier, '..');
const repo = path.resolve(app, '..');
const echteSrcTauri = path.join(app, 'src-tauri');
const lees = (...p) => fs.readFileSync(path.join(...p), 'utf8').replace(/\r\n/g, '\n');

/** Nep-src-tauri met de echte configuratie en nepbestanden voor elke resource. */
function nepOpzet() {
  const basis = fs.mkdtempSync(path.join(os.tmpdir(), 'opds-draagbaar-'));
  const src = path.join(basis, 'src-tauri');
  const doel = path.join(basis, 'target', 'release');
  fs.mkdirSync(src, { recursive: true });
  fs.mkdirSync(doel, { recursive: true });
  for (const f of ['tauri.conf.json', 'tauri.windows.conf.json']) {
    fs.copyFileSync(path.join(echteSrcTauri, f), path.join(src, f));
  }
  const schrijf = (p, inhoud = path.basename(p)) => {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, inhoud);
  };
  for (const bron of Object.keys(leesBundelConfig(src).resources)) {
    // Een resource zonder extensie is een map (kaders, tessdata, fonts, ...).
    if (path.extname(bron)) schrijf(path.join(src, bron));
    else {
      schrijf(path.join(src, bron, 'een.bin'));
      schrijf(path.join(src, bron, 'sub', 'twee.bin'));
    }
  }
  schrijf(path.join(doel, PROGRAMMA), 'MZ programma');
  schrijf(path.join(doel, 'pdfium-worker.exe'), 'MZ worker');
  // Rommel in de doelmap die NIET mee mag.
  schrijf(path.join(doel, 'open_pdf_studio.pdb'));
  schrijf(path.join(doel, 'deps', 'iets.rlib'));
  return { basis, src, doel, ruimOp: () => fs.rmSync(basis, { recursive: true, force: true }) };
}

/** Minimale zip-lezer: de centrale map en de inhoud per naam. */
function leesZip(buf) {
  const eind = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eind >= 0, 'einde van de centrale map');
  const aantal = buf.readUInt16LE(eind + 10);
  let p = buf.readUInt32LE(eind + 16);
  const uit = new Map();
  for (let i = 0; i < aantal; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const methode = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const grootte = buf.readUInt32LE(p + 20);
    const naamLen = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30);
    const commentaar = buf.readUInt16LE(p + 32);
    const lokaal = buf.readUInt32LE(p + 42);
    const naam = buf.subarray(p + 46, p + 46 + naamLen).toString('utf8');
    assert.equal(buf.readUInt32LE(lokaal), 0x04034b50, naam);
    const start = lokaal + 30 + buf.readUInt16LE(lokaal + 26) + buf.readUInt16LE(lokaal + 28);
    const ruw = buf.subarray(start, start + grootte);
    const data = methode === 8 ? zlib.inflateRawSync(ruw) : Buffer.from(ruw);
    assert.equal(crc32(data), crc, `crc ${naam}`);
    uit.set(naam, data);
    p += 46 + naamLen + extra + commentaar;
  }
  return uit;
}

test('zipnaam: zoals de installers, zonder v, gelijk aan die van de frontend', () => {
  assert.equal(zipNaam('v2026.44.4'), 'Open.PDF.Studio_2026.44.4_x64_portable.zip');
  assert.equal(zipNaam('2026.44.4'), 'Open.PDF.Studio_2026.44.4_x64_portable.zip');
  assert.equal(zipNaamFrontend('v2026.44.4'), zipNaam('v2026.44.4'));
  assert.throws(() => zipNaam('nightly'), /Invalid version/);
});

test('bundelconfig: Windows-resources over de gewone heen, sidecar uit externalBin', () => {
  const c = leesBundelConfig(echteSrcTauri);
  assert.deepEqual(c.externalBin, ['binaries/pdfium-worker']);
  // Uit tauri.conf.json ...
  assert.equal(c.resources['resources/tessdata'], 'tessdata');
  assert.equal(c.resources['resources/kaders'], 'kaders');
  // ... en uit tauri.windows.conf.json.
  assert.equal(c.resources['binaries/win-x64/pdfium.dll'], 'pdfium.dll');
  assert.equal(c.resources['WebView2Loader.dll'], 'WebView2Loader.dll');
  assert.equal(c.resources['binaries/open-pdf-thumbnails.dll'], 'open-pdf-thumbnails.dll');
});

test('het programma heet zoals het cargo-pakket (de exe in de doelmap)', () => {
  const cargo = lees(echteSrcTauri, 'Cargo.toml');
  assert.match(cargo, /^name = "open-pdf-studio"$/m);
  assert.equal(PROGRAMMA, 'open-pdf-studio.exe');
  assert.equal(leesBundelConfig(echteSrcTauri).mainBinaryName, null);
});

test('indeling: exe, sidecar en elke resource op de plek die de app verwacht', () => {
  const o = nepOpzet();
  try {
    const items = draagbareIndeling({ targetDir: o.doel, versie: 'v2026.44.4', srcTauri: o.src });
    const doelen = items.map((i) => i.doel);
    for (const verplicht of [
      'open-pdf-studio.exe',
      'pdfium-worker.exe',
      'pdfium.dll',
      'WebView2Loader.dll',
      'open-pdf-thumbnails.dll',
      'file-icon.ico',
      'tessdata/een.bin',
      'tessdata/sub/twee.bin',
      'fonts/een.bin',
      'kaders/een.bin',
      'onderhoeken/sub/twee.bin',
      MARKERING,
      LEESMIJ,
    ]) {
      assert.ok(doelen.includes(verplicht), `${verplicht} ontbreekt in ${doelen.join(', ')}`);
    }
    // Elke resource-bestemming uit de configuratie komt voor.
    for (const doel of Object.values(leesBundelConfig(o.src).resources)) {
      assert.ok(doelen.some((d) => d === doel || d.startsWith(`${doel}/`)), doel);
    }
    // Plat naast de exe: geen resources/-, binaries/- of target-paden.
    assert.ok(!doelen.some((d) => /^(resources|binaries|deps)\//.test(d)), doelen.join(', '));
    assert.ok(!doelen.some((d) => d.endsWith('.pdb') || d.endsWith('.rlib')));
    assert.ok(!doelen.some((d) => d === DATAMAP || d.startsWith(`${DATAMAP}/`)), 'geen data-map');
    assert.ok(doelen.every((d) => !d.includes('\\')), 'zip-paden met /');
    assert.deepEqual(doelen, [...doelen].sort(), 'vaste volgorde');
    // De sidecar komt uit de doelmap.
    assert.equal(items.find((i) => i.doel === 'pdfium-worker.exe').bron, path.join(o.doel, 'pdfium-worker.exe'));
  } finally {
    o.ruimOp();
  }
});

test('indeling: sidecar met doeltriple als de doelmap hem niet heeft', () => {
  const o = nepOpzet();
  try {
    fs.rmSync(path.join(o.doel, 'pdfium-worker.exe'));
    const metTriple = path.join(o.src, 'binaries', 'pdfium-worker-x86_64-pc-windows-msvc.exe');
    fs.writeFileSync(metTriple, 'MZ');
    const items = draagbareIndeling({ targetDir: o.doel, versie: '2026.44.4', srcTauri: o.src });
    assert.equal(items.find((i) => i.doel === 'pdfium-worker.exe').bron, metTriple);
  } finally {
    o.ruimOp();
  }
});

test('indeling: een ontbrekend bestand stopt het script en wordt genoemd', () => {
  const o = nepOpzet();
  try {
    fs.rmSync(path.join(o.src, 'binaries', 'win-x64', 'pdfium.dll'));
    assert.throws(
      () => draagbareIndeling({ targetDir: o.doel, versie: '2026.44.4', srcTauri: o.src }),
      (e) => /missing files/.test(e.message) && /pdfium\.dll/.test(e.message),
    );
    fs.rmSync(path.join(o.doel, PROGRAMMA));
    assert.throws(
      () => draagbareIndeling({ targetDir: o.doel, versie: '2026.44.4', srcTauri: o.src }),
      /open-pdf-studio\.exe/,
    );
  } finally {
    o.ruimOp();
  }
});

test('indeling: een lege resourcemap telt als ontbrekend (bv. tessdata niet voorbereid)', () => {
  const o = nepOpzet();
  try {
    fs.rmSync(path.join(o.src, 'resources', 'tessdata'), { recursive: true });
    fs.mkdirSync(path.join(o.src, 'resources', 'tessdata'));
    assert.throws(
      () => draagbareIndeling({ targetDir: o.doel, versie: '2026.44.4', srcTauri: o.src }),
      /tessdata \(empty\)/,
    );
  } finally {
    o.ruimOp();
  }
});

test('zip: alles onder één map, inhoud en crc kloppen, en hij is reproduceerbaar', () => {
  const o = nepOpzet();
  try {
    const uit = path.join(o.basis, 'uit');
    const { zip, sha256, items } = maakDraagbareZip({ targetDir: o.doel, versie: 'v2026.44.4', uitMap: uit, srcTauri: o.src });
    assert.equal(path.basename(zip), 'Open.PDF.Studio_2026.44.4_x64_portable.zip');
    const inhoud = leesZip(fs.readFileSync(zip));
    assert.equal(inhoud.size, items.length);
    for (const naam of inhoud.keys()) assert.ok(naam.startsWith(`${TOPMAP}/`), naam);
    assert.equal(inhoud.get(`${TOPMAP}/open-pdf-studio.exe`).toString(), 'MZ programma');
    assert.equal(inhoud.get(`${TOPMAP}/tessdata/sub/twee.bin`).toString(), 'twee.bin');
    assert.equal(inhoud.get(`${TOPMAP}/${MARKERING}`).toString(), markeringTekst());
    assert.match(inhoud.get(`${TOPMAP}/${LEESMIJ}`).toString(), /Open PDF Studio 2026\.44\.4 - portable/);

    // .sha256 in het formaat van sha256sum -c.
    assert.match(fs.readFileSync(sha256, 'utf8'), /^[0-9a-f]{64} {2}Open\.PDF\.Studio_2026\.44\.4_x64_portable\.zip\n$/);
    assert.equal(fs.readFileSync(sha256, 'utf8'), hashRegel(zip));

    const tweede = path.join(o.basis, 'tweede.zip');
    schrijfZip(tweede, items);
    assert.ok(fs.readFileSync(tweede).equals(fs.readFileSync(zip)), 'zelfde invoer, zelfde bytes');
  } finally {
    o.ruimOp();
  }
});

test('zip: niet-inpakbare inhoud wordt opgeslagen, niet opgeblazen', () => {
  const basis = fs.mkdtempSync(path.join(os.tmpdir(), 'opds-zip-'));
  try {
    const willekeurig = Buffer.from(Array.from({ length: 512 }, (_, i) => (i * 7919) % 251));
    const bron = path.join(basis, 'w.bin');
    fs.writeFileSync(bron, willekeurig);
    const zip = path.join(basis, 'w.zip');
    schrijfZip(zip, [{ doel: 'w.bin', bron }, { doel: 'leeg.txt', tekst: '' }], '');
    const inhoud = leesZip(fs.readFileSync(zip));
    assert.ok(inhoud.get('w.bin').equals(willekeurig));
    assert.equal(inhoud.get('leeg.txt').length, 0);
  } finally {
    fs.rmSync(basis, { recursive: true, force: true });
  }
});

test('crc32 volgt de standaard', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(crc32(Buffer.alloc(0)), 0);
});

test('markering en gegevensmap: dezelfde namen als de Rust-kant', () => {
  const rust = lees(echteSrcTauri, 'src', 'draagbaar.rs');
  assert.match(rust, new RegExp(`MARKERINGEN: \\[&str; 2\\] = \\["${MARKERING.replace('.', '\\.')}", "\\.portable"\\]`));
  assert.match(rust, new RegExp(`pub const DATAMAP: &str = "${DATAMAP}";`));
  assert.match(rust, /pub const RUNTIME_MAP: &str = "WebView2Runtime";/);
  // De uitleg noemt dezelfde map voor een vaste runtime.
  assert.match(leesmijTekst('1.2.3'), /"WebView2Runtime"/);
  assert.match(markeringTekst(), /\r\n/, 'CRLF voor Windows');
});

test('releaseworkflow: bouwt de zip op windows-system en hangt zip en .sha256 aan de release', () => {
  const wf = lees(repo, '.github', 'workflows', 'release.yml');
  const start = wf.indexOf('- name: Build portable zip (Windows)');
  assert.ok(start > 0, 'stap ontbreekt');
  const stap = wf.slice(start, wf.indexOf('\n      - name:', start + 10) > 0 ? wf.indexOf('\n      - name:', start + 10) : undefined);
  assert.match(stap, /if: matrix\.target == 'windows-system'/);
  assert.match(stap, /node scripts\/draagbare-zip\.mjs --target "\$env:GITHUB_WORKSPACE\/target\/release" --version \$VERSION/);
  assert.match(stap, /gh release upload \$VERSION "\$zip" "\$zip\.sha256" --clobber/);
  // Na de NSIS-build en de handtekeningcontrole van de installer.
  assert.ok(start > wf.indexOf('- name: Verify installed binaries are signed (Windows)'));
  assert.ok(start > wf.indexOf('- name: Build Tauri app (with release upload)'));
  // Eigen binaries ondertekend in de zip.
  assert.match(stap, /Get-AuthenticodeSignature/);
  assert.match(stap, /tauri\.signing\.conf\.json/);
  // De releasetekst noemt de zip.
  assert.match(wf, /_x64_portable\.zip/);
});

test('package.json: script om de zip lokaal te bouwen; test staat in de unit-lijst', () => {
  const pkg = JSON.parse(lees(app, 'package.json'));
  assert.match(pkg.scripts['pack:portable'], /node scripts\/draagbare-zip\.mjs/);
  assert.match(lees(app, 'scripts', 'unit-testlijst.txt'), /^scripts\/draagbare-zip\.test\.mjs$/m);
});
