// Meet de JavaScript-bundel van de productiebouw (#454): grootte (ruw en
// gzip) van de entry-chunk die bij het opstarten laadt, het totaal aan JS, en
// de grootste modules in de entry-chunk. Bouwt zelf via de Vite-API met een
// kleine meet-plugin die in generateBundle per chunk de modules en hun
// gerenderde lengte uitleest (rollup-uitvoerstatistiek, vóór minificatie: de
// som is groter dan de chunk zelf, bruikbaar als verhouding); de bouw schrijft naar
// dist/ zoals `npx vite build`.
//
// Gebruik (in open-pdf-studio/):
//   node scripts/meet-bundel.mjs                 desktopbouw
//   node scripts/meet-bundel.mjs --mode hosted   gehoste bouw
//   node scripts/meet-bundel.mjs --top 40 --json pad/naar/meting.json
//   node scripts/meet-bundel.mjs --waarom dialogs/   wie trekt deze modules de entry in?
//
// De groottebewaking zelf staat in scripts/bundel-grootte.test.mjs en leest
// alleen dist/; dit script is voor het meten en het rapport in
// docs/performance/.

import path from 'node:path';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(hier, '..');

function arg(naam, standaard) {
  const i = process.argv.indexOf(naam);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : standaard;
}

export function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

export function gzipGrootte(code) {
  return zlib.gzipSync(Buffer.from(code)).length;
}

// Korte, stabiele modulenaam: pad relatief aan de app, node_modules ingekort
// tot pakket + pad, virtuele modules zonder \0-voorvoegsel.
export function moduleNaam(id) {
  let s = String(id).replace(/^\0/, '').replace(/\\/g, '/').replace(/\?.*$/, '');
  const nm = s.lastIndexOf('/node_modules/');
  if (nm >= 0) return `npm:${s.slice(nm + '/node_modules/'.length)}`;
  const basis = app.replace(/\\/g, '/');
  if (s.startsWith(basis + '/')) s = s.slice(basis.length + 1);
  return s;
}

// Zet een rollup-bundel om in een meting: per JS-chunk de grootte en de
// modules. Puur, zodat het met een nagemaakte bundel te testen is.
export function meetBundel(bundel) {
  const chunks = [];
  for (const item of Object.values(bundel)) {
    if (item.type !== 'chunk') continue;
    const modules = Object.entries(item.modules || {})
      .map(([id, m]) => ({ id: moduleNaam(id), bytes: m.renderedLength || 0 }))
      .filter((m) => m.bytes > 0)
      .sort((a, b) => b.bytes - a.bytes);
    chunks.push({
      bestand: item.fileName,
      entry: !!item.isEntry,
      dynamisch: !!item.isDynamicEntry,
      bytes: Buffer.byteLength(item.code),
      gzip: gzipGrootte(item.code),
      imports: item.imports || [],
      modules,
    });
  }
  chunks.sort((a, b) => b.bytes - a.bytes);
  return chunks;
}

// Statische sluiting van de entry-chunk: alles wat bij het opstarten laadt
// (entry + de chunks die zij statisch importeert, recursief).
export function opstartChunks(chunks) {
  const perNaam = new Map(chunks.map((c) => [c.bestand, c]));
  const gezien = new Set();
  const rij = chunks.filter((c) => c.entry).map((c) => c.bestand);
  while (rij.length) {
    const n = rij.shift();
    if (gezien.has(n) || !perNaam.has(n)) continue;
    gezien.add(n);
    rij.push(...perNaam.get(n).imports);
  }
  return chunks.filter((c) => gezien.has(c.bestand));
}

// Telt modules per map (eerste twee padsegmenten) voor een grof beeld.
export function perMap(modules) {
  const m = new Map();
  for (const { id, bytes } of modules) {
    const delen = id.startsWith('npm:') ? [id.split('/')[0].startsWith('npm:@') ? id.split('/').slice(0, 2).join('/') : id.split('/')[0]] : id.split('/').slice(0, 2);
    const sleutel = delen.join('/');
    m.set(sleutel, (m.get(sleutel) || 0) + bytes);
  }
  return [...m.entries()].map(([map, bytes]) => ({ map, bytes })).sort((a, b) => b.bytes - a.bytes);
}

async function hoofd() {
  const mode = arg('--mode', 'production');
  const top = Number(arg('--top', '30'));
  const jsonUit = arg('--json', '');
  const { build } = await import('vite');
  let chunks = [];
  const meetPlugin = {
    name: 'opds-meet-bundel',
    enforce: 'post',
    generateBundle(_opties, bundel) {
      chunks = meetBundel(bundel);
      // Statische importeurs per module: voor --waarom (welk pad trekt een
      // module de entry-chunk in?).
      const perNaam = new Map();
      for (const c of chunks) {
        for (const m of c.modules) {
          m.importeurs = [];
          perNaam.set(m.id, m);
        }
      }
      for (const id of this.getModuleIds()) {
        const m = perNaam.get(moduleNaam(id));
        if (m) m.importeurs = (this.getModuleInfo(id)?.importers || []).map(moduleNaam);
      }
    },
  };
  process.chdir(app);
  await build({ root: app, mode, logLevel: 'warn', plugins: [meetPlugin] });

  const entry = chunks.filter((c) => c.entry);
  const opstart = opstartChunks(chunks);
  const totaal = chunks.reduce((s, c) => ({ bytes: s.bytes + c.bytes, gzip: s.gzip + c.gzip }), { bytes: 0, gzip: 0 });
  const opstartTot = opstart.reduce((s, c) => ({ bytes: s.bytes + c.bytes, gzip: s.gzip + c.gzip }), { bytes: 0, gzip: 0 });
  const entryModules = entry.flatMap((c) => c.modules).sort((a, b) => b.bytes - a.bytes);

  const regels = [];
  regels.push(`mode: ${mode}`);
  for (const c of entry) regels.push(`entry-chunk ${c.bestand}: ${kb(c.bytes)} (gzip ${kb(c.gzip)}), ${c.modules.length} modules`);
  regels.push(`opstart (entry + statische imports, ${opstart.length} chunks): ${kb(opstartTot.bytes)} (gzip ${kb(opstartTot.gzip)})`);
  regels.push(`totaal JS (${chunks.length} chunks): ${kb(totaal.bytes)} (gzip ${kb(totaal.gzip)})`);
  regels.push('');
  regels.push(`grootste modules in de entry-chunk (top ${top}; gerenderde lengte vóór minificatie):`);
  for (const m of entryModules.slice(0, top)) regels.push(`  ${kb(m.bytes).padStart(10)}  ${m.id}`);
  regels.push('');
  regels.push('entry-chunk per map:');
  for (const m of perMap(entryModules).slice(0, 20)) regels.push(`  ${kb(m.bytes).padStart(10)}  ${m.map}`);
  regels.push('');
  regels.push('grootste andere chunks:');
  for (const c of chunks.filter((c) => !c.entry).slice(0, 15)) regels.push(`  ${kb(c.bytes).padStart(10)}  (gzip ${kb(c.gzip)})  ${c.bestand}`);
  const waarom = arg('--waarom', '');
  if (waarom) {
    regels.push('');
    regels.push(`importpad naar de entry voor modules met "${waarom}":`);
    const inEntry = new Set(entryModules.map((m) => m.id));
    for (const m of entryModules.filter((x) => x.id.includes(waarom))) {
      regels.push(`  ${m.id} <- ${(m.importeurs || []).filter((i) => inEntry.has(i)).join(', ')}`);
    }
  }
  console.log(regels.join('\n'));

  if (jsonUit) {
    fs.writeFileSync(jsonUit, JSON.stringify({ mode, chunks }, null, 1));
    console.log(`\nmeting geschreven naar ${jsonUit}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  hoofd().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
