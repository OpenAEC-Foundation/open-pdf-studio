// Bewaakt het goedgekeurde app-logo (#986): de bron in docs/branding is het
// vastgestelde beeld, elk afgeleid icoon staat in docs/branding/icons.json en
// bestaat met de juiste maat, en alles wat app, installers en pakketten als
// app-icoon gebruiken komt uit die lijst. Zo kan een oud of los gegenereerd
// icoon het goedgekeurde logo niet ongemerkt vervangen.

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const lees = (rel) => readFileSync(path.join(REPO, rel));
const tekst = (rel) => lees(rel).toString('utf8');
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// Checksum van het goedgekeurde beeld zoals vastgelegd in issue #986.
const GOEDGEKEURD_SHA256 = 'd74363e89b5f3f8723925bf3857d85e12543739a7466e9beb0e31656880f2b65';
const BRON = 'docs/branding/open-pdf-studio.png';

const iconen = JSON.parse(tekst('docs/branding/icons.json'));
const app = iconen.find((a) => a.name === 'Open PDF Studio');
const uitvoer = new Map(app.outputs.map((o) => [o.path, o]));

function pngMaat(buf) {
  assert.equal(buf.subarray(1, 4).toString('latin1'), 'PNG', 'geen PNG');
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

function icoMaten(buf) {
  assert.equal(buf.readUInt16LE(2), 1, 'geen ICO');
  const n = buf.readUInt16LE(4);
  return Array.from({ length: n }, (_, i) => buf[6 + i * 16] || 256);
}

// 24-bits BMP (zoals generate-art.py schrijft) -> lijst van [r, g, b].
function bmpPixels(buf) {
  assert.equal(buf.subarray(0, 2).toString('latin1'), 'BM', 'geen BMP');
  const start = buf.readUInt32LE(10);
  const w = buf.readInt32LE(18);
  const h = Math.abs(buf.readInt32LE(22));
  assert.equal(buf.readUInt16LE(28), 24, 'verwacht 24 bits per pixel');
  const rij = Math.ceil((w * 3) / 4) * 4;
  const px = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = start + y * rij + x * 3;
      px.push([buf[o + 2], buf[o + 1], buf[o]]);
    }
  }
  return px;
}

test('de bron is het goedgekeurde beeld, 512 x 512', () => {
  assert.equal(app.source, BRON);
  assert.equal(app.sha256, GOEDGEKEURD_SHA256);
  const bron = lees(BRON);
  assert.equal(sha256(bron), GOEDGEKEURD_SHA256, 'docs/branding/open-pdf-studio.png is gewijzigd');
  assert.deepEqual(pngMaat(bron), [512, 512]);
});

test('elk afgeleid icoon bestaat en heeft de opgegeven maat', () => {
  for (const o of app.outputs) {
    assert.ok(existsSync(path.join(REPO, o.path)), `${o.path} ontbreekt`);
    const buf = lees(o.path);
    const ext = path.extname(o.path).toLowerCase();
    if (ext === '.png') {
      assert.deepEqual(pngMaat(buf), o.size, `${o.path}: maat`);
      if (o.size[0] === 512) assert.equal(sha256(buf), GOEDGEKEURD_SHA256, `${o.path} wijkt af van de bron`);
    } else if (ext === '.ico') {
      const maten = icoMaten(buf);
      for (const m of [16, 32, 48, 256]) assert.ok(maten.includes(m), `${o.path} mist ${m} px`);
    } else if (ext === '.icns') {
      assert.equal(buf.subarray(0, 4).toString('latin1'), 'icns', `${o.path}: geen ICNS`);
    } else if (ext === '.svg') {
      assert.match(buf.toString('utf8'), /href="data:image\/png;base64,/, `${o.path}: geen ingebed logo`);
    } else {
      assert.fail(`onbekend uitvoertype ${o.path}`);
    }
  }
});

test('Tauri-bundel en Windows-installer gebruiken alleen goedgekeurde iconen', () => {
  const conf = JSON.parse(tekst('open-pdf-studio/src-tauri/tauri.conf.json'));
  const tauriPad = (p) => `open-pdf-studio/src-tauri/${p}`;
  const gebruikt = [...conf.bundle.icon, conf.bundle.windows.nsis.installerIcon,
    ...Object.keys(conf.bundle.resources).filter((p) => p.startsWith('icons/'))];
  for (const p of gebruikt) assert.ok(uitvoer.has(tauriPad(p)), `${p} staat niet in docs/branding/icons.json`);
  // Het venstericoon dat lib.rs inbakt.
  assert.match(tekst('open-pdf-studio/src-tauri/src/lib.rs'), /include_bytes!\("\.\.\/icons\/icon\.png"\)/);
  assert.ok(uitvoer.has(tauriPad('icons/icon.png')));
  // Geen andere Tauri-config overschrijft de iconen.
  for (const f of readdirSync(path.join(REPO, 'open-pdf-studio/src-tauri')).filter((f) => /^tauri\..+\.conf\.json$/.test(f))) {
    const c = JSON.parse(tekst(`open-pdf-studio/src-tauri/${f}`));
    assert.equal(c.bundle?.icon, undefined, `${f} zet eigen iconen`);
  }
});

test('Linux-pakketten (snap, flatpak, nix) installeren goedgekeurde iconen', () => {
  const bestanden = ['snap/snapcraft.yaml', 'flake.nix',
    ...readdirSync(path.join(REPO, 'flatpak')).filter((f) => f.endsWith('.yml')).map((f) => `flatpak/${f}`)];
  let gevonden = 0;
  for (const f of bestanden) {
    for (const [p] of tekst(f).matchAll(/(?:open-pdf-studio\/src-tauri\/icons\/[\w@.-]+|snap\/gui\/[\w.-]+\.png)/g)) {
      gevonden++;
      assert.ok(uitvoer.has(p), `${f}: ${p} staat niet in docs/branding/icons.json`);
    }
  }
  assert.ok(gevonden >= 10, 'iconverwijzingen in de pakketbestanden niet gevonden');
  assert.match(tekst('snap/snapcraft.yaml'), /^icon: snap\/gui\/open-pdf-studio\.png$/m);
});

test('web, titelbalk, Info en MCP-bundel gebruiken het goedgekeurde logo', () => {
  assert.match(tekst('open-pdf-studio/index.html'), /rel="icon"[^>]*href="%BASE_URL%favicon\.ico"/);
  assert.ok(uitvoer.has('open-pdf-studio/public/favicon.ico'));
  for (const f of ['TitleBar.jsx', 'dialogs/AboutDialog.jsx']) {
    assert.match(tekst(`open-pdf-studio/js/solid/components/${f}`), /import appIcoon from '\/icon\.png';/, f);
  }
  assert.ok(uitvoer.has('open-pdf-studio/public/icon.png'));
  assert.equal(JSON.parse(tekst('mcpb/manifest.json')).icon, 'icon.png');
  assert.ok(uitvoer.has('mcpb/icon.png'));
});

test('de installer-afbeeldingen tonen het goedgekeurde logo', () => {
  assert.match(tekst('open-pdf-studio/src-tauri/nsis/art/generate-art.py'), /ICON = HERE\.parent\.parent \/ "icons" \/ "icon\.png"/);
  const amber = [234, 158, 17]; // PDF-label van het goedgekeurde logo
  const dichtbij = ([r, g, b]) => Math.abs(r - amber[0]) <= 14 && Math.abs(g - amber[1]) <= 14 && Math.abs(b - amber[2]) <= 14;
  for (const dpi of [96, 120, 144, 168, 192]) {
    for (const soort of ['sidebar', 'header']) {
      const f = `open-pdf-studio/src-tauri/nsis/art/${soort}-${dpi}.bmp`;
      const n = bmpPixels(lees(f)).filter(dichtbij).length;
      assert.ok(n > 20, `${f}: geen amberkleurig PDF-label; draai generate-art.py opnieuw`);
    }
  }
});
