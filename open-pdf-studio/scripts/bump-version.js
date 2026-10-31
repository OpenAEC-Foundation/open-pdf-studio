/**
 * Version Bump Script
 * Updates every version field in the repository at once (#667).
 *
 * Versieschema: JJJJ.W.N — het jaar, het ISO-weeknummer zonder voorloopnul
 * (1–53) en een volgnummer vanaf 0, bijvoorbeeld 2026.43.4. De releasetag is
 * vJJJJ.W.N. De app, de interne crates en pakketten, hun lockfile-items en de
 * bundels volgen allemaal hetzelfde nummer.
 *
 * Usage:
 *   node scripts/bump-version.js <version>      zet alle versievelden
 *   node scripts/bump-version.js --check [tag]  schrijft niets; faalt als een
 *                                               versieveld afwijkt van de
 *                                               andere of van de tag
 * Example: node scripts/bump-version.js 2026.43.5
 *          node scripts/bump-version.js --check v2026.43.5
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const repoRoot = path.resolve(root, '..');

// JJJJ.W.N zonder voorloopnullen, week 1 t/m 53. De tag is hetzelfde met een v.
const VERSIE_SCHEMA = /^([1-9]\d{3})\.([1-9]|[1-4]\d|5[0-3])\.(0|[1-9]\d*)$/;
const TAG_SCHEMA = new RegExp(`^v${VERSIE_SCHEMA.source.slice(1)}`);

function isGeldigeVersie(versie) {
  return typeof versie === 'string' && VERSIE_SCHEMA.test(versie);
}

function isGeldigeTag(tag) {
  return typeof tag === 'string' && TAG_SCHEMA.test(tag);
}

// Een bestand dat via JSON.stringify opnieuw wordt opgebouwd, krijgt dezelfde
// regeleinden als het origineel (CRLF in een Windows-checkout).
function behoudRegeleinden(origineel, nieuw) {
  const lf = nieuw.replace(/\r\n/g, '\n');
  return origineel.includes('\r\n') ? lf.replace(/\n/g, '\r\n') : lf;
}

// De eerste "version"-sleutel van een JSON-bestand dat op het hoogste niveau
// met zijn versie begint (package.json, tauri.conf.json). Tekstvervanging in
// plaats van JSON.stringify, zodat de opmaak van het bestand blijft staan.
const jsonVersie = {
  lees: (tekst) => [JSON.parse(tekst).version],
  werkBij: (tekst, versie) => tekst.replace(/"version":\s*"[^"]*"/, `"version": "${versie}"`),
};

// De [package]-tabel van een Cargo.toml; een "version =" in een andere tabel
// (bv. [dependencies.x]) telt niet mee.
function pakketTabel(toml) {
  const kop = /^\[package\][ \t]*\r?$/m.exec(toml);
  if (!kop) return null;
  const start = kop.index + kop[0].length;
  const volgende = /^\[/m.exec(toml.slice(start));
  return { start, eind: volgende ? start + volgende.index : toml.length };
}

const PAKKET_VERSIE = /^version\s*=\s*"([^"]*)"/m;

const cargoPakketVersie = {
  lees: (toml) => {
    const tabel = pakketTabel(toml);
    const m = tabel && PAKKET_VERSIE.exec(toml.slice(tabel.start, tabel.eind));
    return m ? [m[1]] : [];
  },
  werkBij: (toml, versie) => {
    const tabel = pakketTabel(toml);
    const sectie = tabel ? toml.slice(tabel.start, tabel.eind) : '';
    if (!PAKKET_VERSIE.test(sectie)) throw new Error('no version in the [package] table');
    return toml.slice(0, tabel.start)
      + sectie.replace(PAKKET_VERSIE, `version = "${versie}"`)
      + toml.slice(tabel.eind);
  },
};

// De crates van de cargo-workspace (Cargo.toml in de repo-root), met de naam
// uit hun eigen [package]-tabel. Een nieuw workspace-lid gaat zo vanzelf mee.
function workspaceCrates(basis = repoRoot) {
  const workspace = fs.readFileSync(path.join(basis, 'Cargo.toml'), 'utf-8');
  const leden = /^members\s*=\s*\[([^\]]*)\]/m.exec(workspace);
  if (!leden) throw new Error('Cargo.toml: no [workspace] members');
  return [...leden[1].matchAll(/"([^"]+)"/g)].map(([, map]) => {
    const toml = fs.readFileSync(path.join(basis, map, 'Cargo.toml'), 'utf-8');
    const tabel = pakketTabel(toml);
    const naam = tabel && /^name\s*=\s*"([^"]+)"/m.exec(toml.slice(tabel.start, tabel.eind));
    if (!naam) throw new Error(`${map}/Cargo.toml: no [package] name`);
    return { naam: naam[1], map };
  });
}

function lockItem(naam) {
  const veilig = naam.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^name = "${veilig}"\\r?\\nversion = ")([^"]+)(")`, 'gm');
}

// De lockfile-items van de workspace-crates. Alleen de lockfile in de
// repo-root wordt door cargo onderhouden; de andere twee horen bij crates die
// nu workspace-lid zijn en worden door cargo nooit meer bijgewerkt.
// src-tauri/Cargo.lock is wel de cache-sleutel van de Android-build en moet
// daarom meelopen (bleef bij 1.83.0 en 1.84.0 op 1.82.0 staan). Een crate die
// in een lockfile ontbreekt, slaan we over.
function cargoLock(crates) {
  return {
    lees: (tekst) => crates.flatMap(({ naam }) => [...tekst.matchAll(lockItem(naam))].map((m) => m[2])),
    werkBij: (tekst, versie) => crates.reduce(
      (t, { naam }) => t.replace(lockItem(naam), `$1${versie}$3`),
      tekst,
    ),
  };
}

// De AppStream-metadata van de Flatpak (#389): de bovenste <release> is de
// appversie (Flathub toont hem als laatste versie). Een nieuwe versie krijgt
// een eigen <release> bovenaan met de datum van vandaag; de oudere blijven
// staan. Staat de versie al lager in de lijst (terugzetten), dan vallen de
// nieuwere items erboven weg, zodat heen en terug het bestand teruggeeft.
const RELEASE_VERSIE = /^([ \t]*)<release\b[^>]*\bversion="([^"]*)"/gm;

const metainfoRelease = {
  lees: (tekst) => {
    const eerste = [...tekst.matchAll(RELEASE_VERSIE)][0];
    return eerste ? [eerste[2]] : [];
  },
  werkBij: (tekst, versie, datum = new Date().toISOString().slice(0, 10)) => {
    const releases = [...tekst.matchAll(RELEASE_VERSIE)];
    if (releases.length === 0) throw new Error('no <release> in <releases>');
    const [eerste] = releases;
    if (eerste[2] === versie) return tekst;
    const bestaand = releases.find((m) => m[2] === versie);
    if (bestaand) return tekst.slice(0, eerste.index) + tekst.slice(bestaand.index);
    const eol = tekst.includes('\r\n') ? '\r\n' : '\n';
    const regel = `${eerste[1]}<release version="${versie}" date="${datum}"/>${eol}`;
    return tekst.slice(0, eerste.index) + regel + tekst.slice(eerste.index);
  },
};

// Elk versieveld in de repo: een pad (relatief aan de repo-root) met een lezer
// en een schrijver. bump-version zet ze allemaal; --check en
// scripts/versievelden.test.mjs eisen dat ze gelijk zijn.
function versievelden(basis = repoRoot) {
  const crates = workspaceCrates(basis);
  return [
    { pad: 'open-pdf-studio/package.json', ...jsonVersie },
    {
      pad: 'open-pdf-studio/package-lock.json',
      lees: (tekst) => {
        const lock = JSON.parse(tekst);
        return [lock.version, lock.packages?.['']?.version];
      },
      werkBij: (tekst, versie) => {
        const lock = JSON.parse(tekst);
        lock.version = versie;
        if (lock.packages && lock.packages['']) lock.packages[''].version = versie;
        return behoudRegeleinden(tekst, `${JSON.stringify(lock, null, 2)}\n`);
      },
    },
    { pad: 'open-pdf-studio/src-tauri/tauri.conf.json', ...jsonVersie },
    ...crates.map(({ map }) => ({ pad: `${map}/Cargo.toml`, ...cargoPakketVersie })),
    { pad: 'Cargo.lock', ...cargoLock(crates) },
    { pad: 'open-pdf-studio/src-tauri/Cargo.lock', ...cargoLock(crates) },
    { pad: 'open-pdf-render/Cargo.lock', ...cargoLock(crates) },
    // De stdio-brug meldt deze versie als serverInfo.version.
    { pad: 'mcp-stdio/package.json', ...jsonVersie },
    {
      // Claude Desktop-extensie: de bundelversie volgt de app.
      pad: 'mcpb/manifest.json',
      lees: (tekst) => [JSON.parse(tekst).version],
      werkBij: (tekst, versie) => {
        const manifest = JSON.parse(tekst);
        manifest.version = versie;
        return behoudRegeleinden(tekst, `${JSON.stringify(manifest, null, 2)}\n`);
      },
    },
    {
      // Standaardinvoer van een handmatige release-run (een tag, dus met v).
      pad: '.github/workflows/release.yml',
      lees: (tekst) => [...tekst.matchAll(/default:\s*'v([^']*)'/g)].map((m) => m[1]),
      werkBij: (tekst, versie) => tekst.replace(/default:\s*'v[^']*'/, `default: 'v${versie}'`),
    },
    {
      // snap.yml zet de versie bij het bouwen opnieuw uit de tag; dit is de
      // waarde voor een lokale snapcraft-build.
      pad: 'snap/snapcraft.yaml',
      lees: (tekst) => [...tekst.matchAll(/^version:\s*'([^']*)'/gm)].map((m) => m[1]),
      werkBij: (tekst, versie) => tekst.replace(/^version:\s*'[^']*'/m, `version: '${versie}'`),
    },
    { pad: 'flatpak/org.openaec.OpenPdfStudio.metainfo.xml', ...metainfoRelease },
  ];
}

// Pakketrecepten die een AL GEPUBLICEERDE release inpakken, met de hash van
// die download. Ze lopen bewust een release achter en worden na de release
// bijgewerkt (flake.nix met scripts/nix-flake-bijwerken.mjs, PKGBUILD en
// .SRCINFO met de hand); bump-version raakt ze niet aan. Ze volgen wel het
// schema.
const GEPUBLICEERDE_RELEASES = [
  {
    pad: 'flake.nix',
    lees: (tekst) => [...tekst.matchAll(/^\s*version = "([^"]*)";/gm)].map((m) => m[1]),
  },
  {
    pad: 'packaging/aur/PKGBUILD',
    lees: (tekst) => [...tekst.matchAll(/^pkgver=(.*?)\s*$/gm)].map((m) => m[1]),
  },
];

function leesBestand(basis, pad) {
  return fs.readFileSync(path.join(basis, pad), 'utf-8');
}

// Leest alle versievelden. fouten: een veld dat ontbreekt, niet aan het schema
// voldoet of afwijkt van package.json (of, met verwacht, van de tag).
// pinFouten: een gepubliceerde-releasepin die niet aan het schema voldoet.
function controleer({ basis = repoRoot, verwacht } = {}) {
  const lees = (veld) => ({ pad: veld.pad, versies: veld.lees(leesBestand(basis, veld.pad)) });
  const velden = versievelden(basis).map(lees);
  const pins = GEPUBLICEERDE_RELEASES.map(lees);
  const versie = verwacht ?? velden[0].versies[0];
  const fouten = [];
  if (!isGeldigeVersie(versie)) fouten.push(`version "${versie}" does not follow YYYY.W.N`);
  for (const { pad, versies } of velden) {
    if (versies.length === 0) fouten.push(`${pad}: no version field found`);
    for (const v of versies) if (v !== versie) fouten.push(`${pad}: ${v} (expected ${versie})`);
  }
  const pinFouten = [];
  for (const { pad, versies } of pins) {
    if (versies.length === 0) pinFouten.push(`${pad}: no version field found`);
    for (const v of versies) if (!isGeldigeVersie(v)) pinFouten.push(`${pad}: ${v} does not follow YYYY.W.N`);
  }
  return { versie, velden, pins, fouten, pinFouten };
}

function zetVersie(versie, { basis = repoRoot, log = console.log } = {}) {
  if (!isGeldigeVersie(versie)) throw new Error(`Invalid version "${versie}"`);
  let bijgewerkt = 0;
  const mislukt = [];
  for (const veld of versievelden(basis)) {
    try {
      const tekst = leesBestand(basis, veld.pad);
      const nieuw = veld.werkBij(tekst, versie);
      if (tekst !== nieuw) {
        fs.writeFileSync(path.join(basis, veld.pad), nieuw, 'utf-8');
        log(`  Updated: ${veld.pad}`);
        bijgewerkt++;
      } else {
        log(`  Already ${versie}: ${veld.pad}`);
      }
    } catch (e) {
      mislukt.push(`${veld.pad} - ${e.message}`);
    }
  }
  return { bijgewerkt, mislukt };
}

function ongeldig(waarde, soort) {
  const voorbeeld = soort === 'tag' ? 'vYYYY.W.N (e.g. v2026.43.5)' : 'YYYY.W.N (e.g. 2026.43.5)';
  console.error(`Invalid ${soort}: "${waarde}". Expected ${voorbeeld}: year, ISO week without a leading zero (1-53), sequence number from 0.`);
  return 1;
}

function hoofd(args) {
  if (args[0] === '--check') {
    const tag = args[1];
    if (tag !== undefined && !isGeldigeTag(tag)) return ongeldig(tag, 'tag');
    const { versie, velden, pins, fouten, pinFouten } = controleer({ verwacht: tag?.slice(1) });
    for (const { pad, versies } of [...velden, ...pins]) console.log(`  ${versies.join(', ') || '-'}  ${pad}`);
    for (const f of pinFouten) console.warn(`  WARNING: ${f}`);
    if (fouten.length) {
      console.error(`\nVersion fields do not match ${tag ?? versie}:\n  ${fouten.join('\n  ')}`);
      console.error('Set them with: node open-pdf-studio/scripts/bump-version.js <YYYY.W.N>');
      return 1;
    }
    console.log(`\nAll version fields are ${versie}${tag ? ` (tag ${tag})` : ''}`);
    return 0;
  }

  const versie = args[0];
  if (!versie) {
    console.error('Usage: node scripts/bump-version.js <version>');
    console.error('       node scripts/bump-version.js --check [tag]');
    console.error('Example: node scripts/bump-version.js 2026.43.5');
    return 1;
  }
  if (!isGeldigeVersie(versie)) return ongeldig(versie, 'version');

  const { bijgewerkt, mislukt } = zetVersie(versie);
  for (const m of mislukt) console.error(`  FAILED: ${m}`);
  console.log(`\nVersion bumped to ${versie} (${bijgewerkt} files updated)`);
  if (mislukt.length) return 1;
  const { fouten } = controleer({ verwacht: versie });
  if (fouten.length) {
    console.error(`\nVersion fields still differ:\n  ${fouten.join('\n  ')}`);
    return 1;
  }
  return 0;
}

module.exports = {
  VERSIE_SCHEMA,
  TAG_SCHEMA,
  isGeldigeVersie,
  isGeldigeTag,
  workspaceCrates,
  versievelden,
  GEPUBLICEERDE_RELEASES,
  metainfoRelease,
  controleer,
  zetVersie,
};

if (require.main === module) process.exitCode = hoofd(process.argv.slice(2));
