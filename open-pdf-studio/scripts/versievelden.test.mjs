// Eén versienummer voor de hele repo (#667): de app, de interne crates en
// pakketten, hun lockfile-items en de bundels volgen hetzelfde nummer in het
// schema JJJJ.W.N (jaar, ISO-week zonder voorloopnul, volgnummer vanaf 0).
// Sluit aan op scripts/release-config.test.mjs, dat de rest van de
// release-configuratie bewaakt.
//
// De versies worden hier met eigen, losse lezers uitgelezen en niet met die
// van bump-version.js, zodat een fout in het bumpscript niet door dezelfde
// fout in de test wordt toegedekt.

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import bump from './bump-version.js';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = path.resolve(projectDir, '..');
const bumpScript = path.join(projectDir, 'scripts', 'bump-version.js');

const lees = (pad, basis = repoDir) => readFileSync(path.join(basis, pad), 'utf8');
const appVersie = JSON.parse(lees('open-pdf-studio/package.json')).version;

// Versie in de [package]-tabel, regel voor regel.
function pakketVersie(toml) {
  let inPakket = false;
  for (const regel of toml.split(/\r?\n/)) {
    if (/^\s*\[/.test(regel)) inPakket = /^\s*\[package\]\s*$/.test(regel);
    else if (inPakket) {
      const m = /^\s*version\s*=\s*"([^"]*)"/.exec(regel);
      if (m) return m[1];
    }
  }
  return undefined;
}

// Versie in de [project]-tabel van een pyproject.toml.
function projectVersie(toml) {
  let inProject = false;
  for (const regel of toml.split(/\r?\n/)) {
    if (/^\s*\[/.test(regel)) inProject = /^\s*\[project\]\s*$/.test(regel);
    else if (inProject) {
      const m = /^\s*version\s*=\s*"([^"]*)"/.exec(regel);
      if (m) return m[1];
    }
  }
  return undefined;
}

function pakketNaam(toml) {
  const tabel = toml.split(/^\[/m).find((t) => t.startsWith('package]'));
  return tabel && /^name\s*=\s*"([^"]+)"/m.exec(tabel)?.[1];
}

// Alle [[package]]-blokken van een Cargo.lock als { naam, versie }.
function lockPakketten(lock) {
  return lock.split(/^\[\[package\]\]\r?$/m).slice(1).map((blok) => ({
    naam: /^name = "([^"]+)"/m.exec(blok)?.[1],
    versie: /^version = "([^"]+)"/m.exec(blok)?.[1],
  }));
}

const workspace = lees('Cargo.toml');
const crates = [.../^members\s*=\s*\[([^\]]*)\]/m.exec(workspace)[1].matchAll(/"([^"]+)"/g)]
  .map(([, map]) => ({ map, naam: pakketNaam(lees(`${map}/Cargo.toml`)) }));
const crateNamen = new Set(crates.map((c) => c.naam));

const lockVersies = (tekst) => lockPakketten(tekst).filter((p) => crateNamen.has(p.naam)).map((p) => p.versie);
const jsonVersie = (tekst) => [JSON.parse(tekst).version];

// Elk versieveld van de repo met zijn eigen lezer.
const VELDEN = {
  'open-pdf-studio/package.json': jsonVersie,
  'open-pdf-studio/package-lock.json': (tekst) => {
    const lock = JSON.parse(tekst);
    return [lock.version, lock.packages[''].version];
  },
  'open-pdf-studio/src-tauri/tauri.conf.json': jsonVersie,
  ...Object.fromEntries(crates.map(({ map }) => [`${map}/Cargo.toml`, (tekst) => [pakketVersie(tekst)]])),
  'Cargo.lock': lockVersies,
  'open-pdf-studio/src-tauri/Cargo.lock': lockVersies,
  'open-pdf-render/Cargo.lock': lockVersies,
  'mcp-stdio/package.json': jsonVersie,
  'python/pyproject.toml': (tekst) => [projectVersie(tekst)],
  'mcpb/manifest.json': jsonVersie,
  '.github/workflows/release.yml': (tekst) => [/^\s+default:\s*'v([^']*)'/m.exec(tekst)?.[1]],
  'snap/snapcraft.yaml': (tekst) => [/^version:\s*'([^']*)'/m.exec(tekst)?.[1]],
};

// Recepten van een al gepubliceerde release (met de hash van die download):
// die lopen een release achter, maar volgen wel het schema.
const GEPUBLICEERD = {
  'flake.nix': (tekst) => [/^\s*version = "([^"]*)";/m.exec(tekst)?.[1]],
  'packaging/aur/PKGBUILD': (tekst) => [/^pkgver=(\S*)/m.exec(tekst)?.[1]],
};

test('het versieschema is JJJJ.W.N: jaar, ISO-week 1-53 zonder voorloopnul, volgnummer vanaf 0', () => {
  for (const goed of ['2026.43.4', '2026.43.0', '2026.1.0', '2026.9.12', '2026.10.3', '2026.53.1', '2027.1.0']) {
    assert.ok(bump.isGeldigeVersie(goed), goed);
    assert.ok(bump.isGeldigeTag(`v${goed}`), `v${goed}`);
  }
  for (const fout of [
    '1.9.0', '0.1.0', '26.43.4', '02026.43.4',
    '2026.043.4', '2026.0.4', '2026.54.0', '2026.60.1',
    '2026.43.04', '2026.43', '2026.43.4.1', '2026.43.4-nightly.20261021.abc1234',
    'v2026.43.4', ' 2026.43.4', '', undefined,
  ]) {
    assert.equal(bump.isGeldigeVersie(fout), false, String(fout));
  }
  for (const fout of ['2026.43.4', 'V2026.43.4', 'v2026.043.4', 'v2026.54.0', 'vv2026.43.4']) {
    assert.equal(bump.isGeldigeTag(fout), false, fout);
  }
});

test('alle versievelden hebben het appnummer en volgen het schema', () => {
  assert.ok(bump.isGeldigeVersie(appVersie), `package.json: ${appVersie}`);
  for (const [pad, leesVersies] of Object.entries(VELDEN)) {
    const versies = leesVersies(lees(pad));
    assert.ok(versies.length > 0, `${pad}: geen versieveld gevonden`);
    for (const v of versies) assert.equal(v, appVersie, `${pad}: ${v}, verwacht ${appVersie}`);
  }
});

test('elke workspace-crate staat met het appnummer in Cargo.lock', () => {
  const pakketten = lockPakketten(lees('Cargo.lock'));
  for (const { naam } of crates) {
    const items = pakketten.filter((p) => p.naam === naam);
    assert.equal(items.length, 1, `Cargo.lock: ${naam}`);
    assert.equal(items[0].versie, appVersie, `Cargo.lock: ${naam}`);
  }
});

test('de pakketrecepten van een gepubliceerde release volgen het schema', () => {
  for (const [pad, leesVersies] of Object.entries(GEPUBLICEERD)) {
    for (const v of leesVersies(lees(pad))) assert.ok(bump.isGeldigeVersie(v), `${pad}: ${v}`);
  }
});

test('bump-version kent precies dezelfde versievelden', () => {
  assert.deepEqual(bump.versievelden().map((v) => v.pad).sort(), Object.keys(VELDEN).sort());
  assert.deepEqual(bump.GEPUBLICEERDE_RELEASES.map((v) => v.pad).sort(), Object.keys(GEPUBLICEERD).sort());
  assert.deepEqual(bump.workspaceCrates().map((c) => c.naam).sort(), [...crateNamen].sort());
});

test('elk getrackt package.json en Cargo.toml met een versie is een versieveld', (t) => {
  let getrackt;
  try {
    getrackt = execFileSync('git', ['ls-files', '-z'], { cwd: repoDir, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
      .split('\0').filter(Boolean);
  } catch {
    t.skip('geen git-checkout');
    return;
  }
  const kandidaten = getrackt.filter((p) =>
    /(^|\/)(package\.json|Cargo\.toml)$/.test(p) && !/(^|\/)(node_modules|target|vendor)\//.test(p));
  assert.ok(kandidaten.includes('open-pdf-studio/package.json'));
  for (const pad of kandidaten) {
    const tekst = lees(pad);
    const versie = pad.endsWith('.json') ? JSON.parse(tekst).version : pakketVersie(tekst);
    if (versie === undefined) continue;
    assert.ok(pad in VELDEN, `${pad} (${versie}) hoort in de versievelden van bump-version.js`);
  }
});

test('bump-version verandert alleen de versievelden', () => {
  const ander = '2099.53.7';
  for (const veld of bump.versievelden()) {
    const tekst = lees(veld.pad);
    const nieuw = veld.werkBij(tekst, ander);
    const voor = VELDEN[veld.pad](tekst);
    const na = VELDEN[veld.pad](nieuw);
    assert.equal(na.length, voor.length, veld.pad);
    for (const v of na) assert.equal(v, ander, veld.pad);
    // Terugzetten geeft het bestand byte voor byte terug: opmaak en
    // regeleinden blijven staan.
    assert.equal(veld.werkBij(nieuw, appVersie), tekst, veld.pad);
  }
});

test('bump-version zet alle velden in een kopie van de repo', () => {
  const basis = mkdtempSync(path.join(tmpdir(), 'opds-versievelden-'));
  try {
    const paden = new Set(['Cargo.toml', ...Object.keys(VELDEN), ...Object.keys(GEPUBLICEERD)]);
    for (const pad of paden) {
      mkdirSync(path.dirname(path.join(basis, pad)), { recursive: true });
      copyFileSync(path.join(repoDir, pad), path.join(basis, pad));
    }
    const { mislukt } = bump.zetVersie('2031.2.0', { basis, log: () => {} });
    assert.deepEqual(mislukt, []);
    for (const [pad, leesVersies] of Object.entries(VELDEN)) {
      for (const v of leesVersies(lees(pad, basis))) assert.equal(v, '2031.2.0', pad);
    }
    // Recepten van een gepubliceerde release blijven staan.
    for (const pad of Object.keys(GEPUBLICEERD)) assert.equal(lees(pad, basis), lees(pad), pad);
    assert.deepEqual(bump.controleer({ basis, verwacht: '2031.2.0' }).fouten, []);
    assert.ok(bump.controleer({ basis, verwacht: appVersie }).fouten.length > 0);
    assert.throws(() => bump.zetVersie('2031.02.0', { basis, log: () => {} }), /Invalid version/);
  } finally {
    rmSync(basis, { recursive: true, force: true });
  }
});

test('bump-version weigert een versie buiten het schema en schrijft dan niets', () => {
  const voor = Object.keys(VELDEN).map((pad) => lees(pad));
  // Het schema zelf staat in de eerste test; hier alleen de opdrachtregel.
  for (const fout of ['1.9.0', '2026.043.5', 'v2026.43.5']) {
    const r = spawnSync(process.execPath, [bumpScript, fout], { encoding: 'utf8' });
    assert.equal(r.status, 1, fout);
    assert.match(r.stderr, /YYYY\.W\.N/, fout);
  }
  assert.deepEqual(Object.keys(VELDEN).map((pad) => lees(pad)), voor);
});

test('--check vergelijkt de releasetag met de versievelden', () => {
  const check = (...args) => spawnSync(process.execPath, [bumpScript, '--check', ...args], { encoding: 'utf8' });
  assert.equal(check().status, 0);
  assert.equal(check(`v${appVersie}`).status, 0);
  const [jaar, week, nr] = appVersie.split('.').map(Number);
  const andere = check(`v${jaar}.${week}.${nr + 1}`);
  assert.equal(andere.status, 1);
  assert.match(andere.stderr, /open-pdf-studio\/package\.json/);
  assert.equal(check(appVersie).status, 1, 'een tag begint met v');
  assert.equal(check(`v${jaar}.0${week}.${nr}`).status, 1);
});

test('de release-workflow controleert de tag tegen de versievelden voordat er iets gebouwd wordt', () => {
  const workflow = lees('.github/workflows/release.yml').replace(/\r\n/g, '\n');
  const createRelease = workflow.slice(workflow.indexOf('  create-release:'), workflow.indexOf('\n  build:'));
  const controle = createRelease.indexOf('node open-pdf-studio/scripts/bump-version.js --check "$VERSION"');
  assert.ok(controle > 0, 'create-release draait bump-version.js --check');
  assert.ok(controle > createRelease.indexOf('id: get-version'), 'na het bepalen van de versie');
  assert.ok(controle < createRelease.indexOf('name: Create release'), 'voor het aanmaken van de release');
  assert.match(createRelease, /VERSION: \$\{\{ steps\.get-version\.outputs\.version \}\}/);
  // Alle bouwjobs wachten op create-release.
  for (const job of ['build', 'build-android', 'mcpb', 'python-library']) {
    const kop = workflow.indexOf(`\n  ${job}:\n`);
    assert.ok(kop > 0, job);
    assert.match(workflow.slice(kop, kop + 300), /needs: create-release/, job);
  }
});

// Een MSI (WiX) laat in de ProductVersion een hoofdnummer van hoogstens 255
// toe; met 2026 als eerste getal kan er dus geen MSI gebouwd worden. Windows
// krijgt alleen de NSIS-installers. Deze test houdt msi uit elke plek waar
// een bundeldoel gekozen wordt.
test('Windows bouwt alleen NSIS-installers, nooit een MSI', () => {
  const srcTauri = path.join(projectDir, 'src-tauri');
  const confs = readdirSync(srcTauri).filter((f) => /^tauri(\..+)?\.conf\.json$/.test(f));
  assert.ok(confs.includes('tauri.conf.json') && confs.includes('tauri.windows.conf.json'));
  const basis = JSON.parse(readFileSync(path.join(srcTauri, 'tauri.conf.json'), 'utf8'));
  assert.ok(Array.isArray(basis.bundle.targets), 'bundle.targets is een lijst, niet "all"');
  assert.ok(basis.bundle.targets.includes('nsis'));
  for (const conf of confs) {
    const bundle = JSON.parse(readFileSync(path.join(srcTauri, conf), 'utf8')).bundle ?? {};
    if (bundle.targets !== undefined) {
      assert.ok(Array.isArray(bundle.targets), `${conf}: bundle.targets is een lijst, niet "all"`);
      assert.ok(!bundle.targets.includes('msi'), `${conf}: geen msi in bundle.targets`);
    }
    assert.equal(bundle.windows?.wix, undefined, `${conf}: geen WiX-instellingen`);
  }

  const workflows = path.join(repoDir, '.github', 'workflows');
  for (const naam of readdirSync(workflows).filter((f) => f.endsWith('.yml'))) {
    const zonderCommentaar = readFileSync(path.join(workflows, naam), 'utf8')
      .split(/\r?\n/).filter((r) => !/^\s*#/.test(r)).join('\n');
    assert.doesNotMatch(zonderCommentaar, /\b(msi|wix)\b/i, `${naam} bouwt geen MSI`);
  }
  const pkg = JSON.parse(lees('open-pdf-studio/package.json'));
  for (const [naam, script] of Object.entries(pkg.scripts)) {
    assert.doesNotMatch(script, /\bmsi\b/i, `npm run ${naam} bouwt geen MSI`);
  }
});
