// Omvangsbudget en "geen Tauri"-bewaking van de web-unit (#451).
//
// Twee lagen:
//  1. Op de BRON (draait altijd, ook in CI zonder bouw): de statische
//     importgraaf vanaf web-unit/src/index.js mag geen npm-pakketten en geen
//     app-modules bevatten — PDF.js, pdf-lib en MuPDF horen achter een
//     dynamische import(). Nergens in de unit mag Tauri of de globale app-state
//     binnenkomen.
//  2. Op de BOUW (dist-web-unit/, alleen als die er is en niet ouder is dan de
//     bronnen): wat de gastheer bij het insluiten laadt, blijft binnen het
//     budget, PDF.js tot het eerste beeld ook, en geen enkel bestand bevat een
//     Tauri-aanroep.
//
// Meten:  npm run build:web-unit && node --test web-unit/bundel-budget.test.mjs
// Groeit de unit terecht, verhoog het budget dan bewust en werk de cijfers in
// docs/web-unit-451.md bij.

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(hier, '..');
const BRON = path.join(hier, 'src');
const DIST = path.join(app, 'dist-web-unit');

// KiB = 1024 bytes. Na #451: entry + statische brokken 27,9 KiB rauw /
// 10,0 KiB gzip; PDF.js-bibliotheek + worker 2.606 KiB rauw / 596 KiB gzip
// (de worker alleen al 468 KiB gzip, boven de 400 kB uit het ontwerp).
// Het ontwerpbudget (docs/superpowers/specs/2026-09-23-web-unit-design.md) is
// 250 kB gzip voor de entry; deze bewaking ligt bewust veel strakker, zodat
// een per ongeluk statische import van PDF.js of pdf-lib meteen opvalt.
export const BUDGET_START_KIB = 48;
export const BUDGET_START_GZIP_KIB = 16;
export const BUDGET_EERSTE_BEELD_GZIP_KIB = 640;

const STATISCH = /(?:^|[;\n])\s*(?:import|export)\s+(?:[^'"`;]*?\sfrom\s*)?['"]([^'"]+)['"]/g;

/** De statische import-specifiers van een bronbestand (geen import()). */
export function statischeImports(code) {
  const zonderCommentaar = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return [...zonderCommentaar.matchAll(STATISCH)].map((m) => m[1]);
}

/** De statische importgraaf vanaf een bestand: lokale bestanden + kale namen. */
export function statischeGraaf(start) {
  const bestanden = new Set();
  const pakketten = new Set();
  const rij = [start];
  while (rij.length) {
    const f = rij.pop();
    if (bestanden.has(f)) continue;
    bestanden.add(f);
    for (const s of statischeImports(fs.readFileSync(f, 'utf8'))) {
      if (s.startsWith('.')) rij.push(path.resolve(path.dirname(f), s));
      else pakketten.add(s);
    }
  }
  return { bestanden: [...bestanden], pakketten: [...pakketten] };
}

function alleBronnen(map) {
  return fs.readdirSync(map, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(map, e.name);
    if (e.isDirectory()) return alleBronnen(p);
    return /\.m?js$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
  });
}

test('statischeImports ziet import/export-from maar geen dynamische import()', () => {
  assert.deepEqual(statischeImports([
    "import { a } from './a.js';",
    "import './b.js';",
    "export { c } from './c.js';",
    "const d = await import('pdfjs-dist');",
    "// import { e } from 'nep';",
    "import {",
    "  f,",
    "} from 'pdf-lib';",
  ].join('\n')), ['./a.js', './b.js', './c.js', 'pdf-lib']);
});

test('wat de gastheer bij het insluiten laadt, haalt geen npm-pakket of app-module binnen', () => {
  const { bestanden, pakketten } = statischeGraaf(path.join(BRON, 'index.js'));
  assert.deepEqual(pakketten, [], 'statische pakketten in de start van de unit: ' + pakketten.join(', '));
  const buiten = bestanden.filter((f) => !f.startsWith(BRON + path.sep));
  assert.deepEqual(buiten, [], 'de start van de unit leunt op app-modules: ' + buiten.join(', '));
  // De zware delen zijn er wel, maar alleen lui.
  for (const lui of ['opslaan.js', 'iframe-brug.js']) {
    assert.ok(!bestanden.includes(path.join(BRON, lui)), lui + ' hoort achter een import()');
  }
});

test('nergens in de unit komt Tauri, de app-state of i18next binnen', () => {
  const verboden = [/@tauri-apps\//, /core\/platform\.js$/, /core\/state\.js$/, /^i18next/, /i18n\/config\.js$/, /^solid-js/];
  for (const f of alleBronnen(BRON)) {
    const code = fs.readFileSync(f, 'utf8');
    const specs = [...statischeImports(code), ...[...code.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1])];
    for (const s of specs) {
      assert.ok(!verboden.some((r) => r.test(s)), `${path.relative(app, f)} importeert ${s}`);
    }
    assert.ok(!/__TAURI|isTauri\(/.test(code), `${path.relative(app, f)} verwijst naar Tauri`);
  }
});

// ── de bouw ─────────────────────────────────────────────────────────────────

function jongste(paden) {
  let t = 0;
  for (const p of paden) if (fs.existsSync(p)) t = Math.max(t, fs.statSync(p).mtimeMs);
  return t;
}

function bouwStatus() {
  const entry = path.join(DIST, 'open-pdf-studio.js');
  if (!fs.existsSync(entry)) return { overslaan: 'geen dist-web-unit/; draai eerst npm run build:web-unit' };
  const bronnen = [...alleBronnen(BRON), path.join(app, 'vite.web-unit.config.js')];
  if (jongste(bronnen) > fs.statSync(entry).mtimeMs) return { overslaan: 'dist-web-unit/ is ouder dan de bronnen; bouw opnieuw om te meten' };
  return { entry };
}

/** Het entry-bestand plus alles wat het statisch importeert (relatieve paden). */
export function startBestanden(entry) {
  const gezien = new Set();
  const rij = [entry];
  while (rij.length) {
    const f = rij.pop();
    if (gezien.has(f)) continue;
    gezien.add(f);
    const code = fs.readFileSync(f, 'utf8');
    for (const m of code.matchAll(/(?:from|import)\s*["'](\.{1,2}\/[^"']+)["']/g)) {
      rij.push(path.resolve(path.dirname(f), m[1]));
    }
  }
  return [...gezien];
}

const maat = (bestanden) => bestanden.reduce((s, f) => {
  const b = fs.readFileSync(f);
  return { rauw: s.rauw + b.length / 1024, gzip: s.gzip + zlib.gzipSync(b).length / 1024 };
}, { rauw: 0, gzip: 0 });

const status = bouwStatus();

test('de start van de gebouwde unit blijft binnen het budget', { skip: status.overslaan }, () => {
  const bestanden = startBestanden(status.entry);
  const { rauw, gzip } = maat(bestanden);
  const lijst = bestanden.map((f) => path.relative(DIST, f)).join(', ');
  assert.ok(rauw <= BUDGET_START_KIB, `start ${rauw.toFixed(1)} KiB > ${BUDGET_START_KIB} KiB (${lijst})`);
  assert.ok(gzip <= BUDGET_START_GZIP_KIB, `start gzip ${gzip.toFixed(1)} KiB > ${BUDGET_START_GZIP_KIB} KiB (${lijst})`);
  // De luie brokken (PDF.js, pdf-lib, MuPDF, de schrijver, de iframe-brug)
  // mogen niet statisch aan de start hangen.
  const lui = bestanden.map((f) => path.basename(f))
    .filter((n) => /^(pdf|pdf\.worker|PDFButton|mupdf|mupdf-renderer|opslaan|iframe-brug)-/.test(n));
  assert.deepEqual(lui, [], 'luie brokken in de start van de unit: ' + lui.join(', '));
});

test('de gebouwde entry exporteert de gedocumenteerde API', { skip: status.overslaan }, () => {
  const code = fs.readFileSync(status.entry, 'utf8');
  const exp = code.match(/export\s*\{([^}]*)\}/)?.[1] || '';
  const namen = exp.split(',').map((d) => d.trim().split(/\s+as\s+/).pop());
  for (const n of ['mount', 'OpenPdfStudio', 'EVENTS', 'default']) assert.ok(namen.includes(n), n + ' ontbreekt in de exports van open-pdf-studio.js');
});

test('PDF.js tot het eerste beeld blijft binnen het budget', { skip: status.overslaan }, () => {
  const brokken = fs.readdirSync(path.join(DIST, 'brokken'));
  const lib = brokken.filter((n) => /^pdf-[\w-]+\.js$/.test(n));
  const worker = brokken.filter((n) => /^pdf\.worker-[\w-]+\.js$/.test(n));
  assert.equal(lib.length, 1, 'verwacht één PDF.js-brok, gevonden: ' + lib.join(', '));
  assert.equal(worker.length, 1, 'verwacht één PDF.js-worker, gevonden: ' + worker.join(', '));
  const { gzip } = maat([...lib, ...worker].map((n) => path.join(DIST, 'brokken', n)));
  assert.ok(gzip <= BUDGET_EERSTE_BEELD_GZIP_KIB, `PDF.js + worker gzip ${gzip.toFixed(0)} KiB > ${BUDGET_EERSTE_BEELD_GZIP_KIB} KiB`);
});

test('geen enkel gebouwd script roept Tauri aan', { skip: status.overslaan }, () => {
  const scripts = [];
  const rij = [DIST];
  while (rij.length) {
    const d = rij.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) rij.push(p);
      else if (/\.m?js$/.test(e.name)) scripts.push(p);
    }
  }
  for (const f of scripts) {
    const code = fs.readFileSync(f, 'utf8');
    assert.ok(!/__TAURI_INTERNALS__|__TAURI__|plugin:fs\||@tauri-apps/.test(code), path.relative(DIST, f) + ' bevat een Tauri-verwijzing');
  }
});
