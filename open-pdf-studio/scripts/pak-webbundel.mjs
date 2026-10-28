// Bouwt de gehoste webbundel en pakt hem in als release-bestand (#692).
//
//   npm run pack:hosted -- [--tag vJJJJ.W.N] [--commit <sha>] [--out <map>] [--no-tag-check]
//
// Bestaat de tag hier al, dan moet hij naar de gebouwde commit wijzen; anders
// klopt bron.json niet. --no-tag-check slaat dat over, voor een proefbouw op
// een tak waarvan de versie al getagd is (de releaseworkflow gebruikt het niet).
//
// Uitvoer in <map> (standaard dist-webbundel/):
//   open-pdf-studio-web-<versie>.tar.gz          de bundel, plat in het archief
//   open-pdf-studio-web-<versie>.tar.gz.sha256   voor `sha256sum -c`
//   open-pdf-studio-web-<versie>/                dezelfde bestanden uitgepakt
//
// De bundel is `vite build --mode hosted --base=./`: met een relatieve basis
// werken dezelfde bestanden onder elk subpad (js/core/basis-url.js). In de
// wortel komen erbij:
//   MANIFEST.sha256          SHA-256 van elk bestand (`sha256sum -c`)
//   THIRD-PARTY-NOTICES.txt  licentie en copyright van elk meegebundeld pakket
//   bron.json                versie, tag, commit, licentie en broncode
//
// Welke pakketten erin zitten, zegt rollup zelf: de modules van elke chunk en
// de bronbestanden van elk meegekopieerd asset. Releaseworkflow: release.yml,
// job web-bundle. Controle: scripts/controleer-webbundel.mjs.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  BRON, MANIFEST, NOTICES, archiefHashTekst, bestandenIn, bronJson, bundelLicenties,
  bundelNaam, maakTar, manifestTekst, noticesTekst, pakketGegevens, pakketMappen, sha256,
} from './webbundel.mjs';
import { DESKTOP_PAKKETTEN } from './web-bouw.mjs';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// De PDF.js-hulpbestanden (cmaps, standaardfonts, wasm) kopieert de plugin
// pdfjs-assets pas na de bundel; rollup ziet ze dus niet.
const GEKOPIEERDE_PAKKETTEN = ['pdfjs-dist'];

const VLAGGEN = new Set(['no-tag-check']);

function leesArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(argv[i]);
    if (!m) throw new Error(`Unknown argument: ${argv[i]}`);
    args[m[1]] = VLAGGEN.has(m[1]) ? true : m[2] ?? argv[++i];
  }
  return args;
}

function git(...args) {
  return execFileSync('git', args, { cwd: APP, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

/** De commit van de bundel; als de tag hier bekend is, moet hij daarnaar wijzen. */
function bepaalCommit(tag, opgegeven, tagControle = true) {
  const commit = opgegeven || git('rev-parse', 'HEAD');
  if (!tagControle) return commit;
  let tagCommit = null;
  try { tagCommit = git('rev-parse', '-q', '--verify', `refs/tags/${tag}^{commit}`); } catch { /* tag nog niet hier */ }
  if (tagCommit && tagCommit !== commit) {
    throw new Error(`Tag ${tag} points to ${tagCommit}, but the bundle is built from ${commit}`);
  }
  return commit;
}

function commitTijd(commit) {
  try { return Number(git('show', '-s', '--format=%ct', commit)) || 0; } catch { return 0; }
}

/** Vangt de module-id's en bronpaden van de build op. */
function verzamelModules(ids) {
  return {
    name: 'opds-webbundel-modules',
    apply: 'build',
    generateBundle(_opties, bundel) {
      for (const item of Object.values(bundel)) {
        if (item.type === 'chunk') for (const id of Object.keys(item.modules)) ids.add(id);
        else for (const bron of item.originalFileNames || []) ids.add(path.resolve(APP, bron));
      }
    },
  };
}

export async function bouwGehost(uitMap, { log = 'warn' } = {}) {
  const { build } = await import('vite');
  const ids = new Set();
  // vite.config.js leest ./package.json vanuit de werkmap.
  const vorige = process.cwd();
  process.chdir(APP);
  try {
    await build({
      root: APP,
      configFile: path.join(APP, 'vite.config.js'),
      mode: 'hosted',
      base: './',
      logLevel: log,
      plugins: [verzamelModules(ids)],
      build: { outDir: uitMap, emptyOutDir: true },
    });
  } finally {
    process.chdir(vorige);
  }
  return ids;
}

export async function pakWebbundel({ tag, commit, out = path.join(APP, 'dist-webbundel'), log, tagControle = true } = {}) {
  const versie = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8')).version;
  tag = tag || `v${versie}`;
  if (tag !== `v${versie}`) throw new Error(`Tag ${tag} does not match package.json version ${versie}`);
  commit = bepaalCommit(tag, commit, tagControle);

  const naam = bundelNaam(versie);
  const map = path.join(path.resolve(out), naam);
  const ids = await bouwGehost(map, { log });

  const mappen = new Set(pakketMappen(ids, APP));
  for (const p of GEKOPIEERDE_PAKKETTEN) mappen.add(path.join(APP, 'node_modules', p).replace(/\\/g, '/'));
  const pakketten = [...mappen].map(pakketGegevens);
  const desktop = pakketten.filter((p) => DESKTOP_PAKKETTEN.includes(p.naam)).map((p) => p.naam);
  if (desktop.length) throw new Error(`Desktop-only package(s) in the web bundle: ${desktop.join(', ')} (see scripts/web-bouw.mjs)`);
  const leeg = pakketten.filter((p) => !p.teksten.length).map((p) => p.naam);
  if (leeg.length) console.warn(`[webbundel] no licence file in: ${leeg.join(', ')}`);

  const vooraf = bestandenIn(map);
  fs.writeFileSync(path.join(map, NOTICES), noticesTekst(pakketten, bundelLicenties(vooraf)));
  fs.writeFileSync(path.join(map, BRON), `${JSON.stringify(bronJson({ versie, tag, commit }), null, 2)}\n`);

  const bestanden = bestandenIn(map).filter((p) => p !== MANIFEST);
  const inhoud = new Map(bestanden.map((p) => [p, fs.readFileSync(path.join(map, ...p.split('/')))]));
  const manifest = manifestTekst(bestanden.map((p) => ({ pad: p, hash: sha256(inhoud.get(p)) })));
  fs.writeFileSync(path.join(map, MANIFEST), manifest);

  const items = [{ pad: MANIFEST, data: Buffer.from(manifest) }, ...bestanden.map((p) => ({ pad: p, data: inhoud.get(p) }))];
  const archief = gzipSync(maakTar(items, commitTijd(commit)), { level: 9 });
  const archiefNaam = `${naam}.tar.gz`;
  const archiefPad = path.join(path.resolve(out), archiefNaam);
  fs.writeFileSync(archiefPad, archief);
  const hash = sha256(archief);
  fs.writeFileSync(`${archiefPad}.sha256`, archiefHashTekst(hash, archiefNaam));

  return { versie, tag, commit, map, archief: archiefPad, hash, bestanden: items.length, pakketten: pakketten.map((p) => `${p.naam}@${p.versie}`) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = leesArgs(process.argv.slice(2));
    const r = await pakWebbundel({ tag: args.tag, commit: args.commit, out: args.out, tagControle: !args['no-tag-check'] });
    console.log(`Web bundle ${r.versie} (${r.tag}, ${r.commit})`);
    console.log(`  ${r.bestanden} files, ${r.pakketten.length} third-party packages`);
    console.log(`  ${r.archief}`);
    console.log(`  sha256 ${r.hash}`);
  } catch (e) {
    console.error(`[webbundel] ${e.message}`);
    process.exit(1);
  }
}
