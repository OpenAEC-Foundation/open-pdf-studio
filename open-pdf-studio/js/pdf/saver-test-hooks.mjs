// Laadhaken om de echte saver (js/pdf/saver.js) onder node te draaien, voor
// opslaan-en-heropenen-tests op echte PDF-bytes.
//
// saver.js trekt via de lader, het platform en de schermonderdelen de halve
// app mee. Deze haken vervangen precies die modules door dunne doorgeefluiken
// naar `globalThis.__saverTest.impl`; de state-store, pdf-lib en alle
// saver-logica blijven echt. Een export `naam` roept
// `globalThis.__saverTest.impl[naam](...args)` aan als die bestaat en geeft
// anders undefined terug. De exportnamen komen uit de echte bron, zodat elke
// importeur zijn namen vindt. Schermcomponenten (.jsx) worden op dezelfde
// manier leeg.
//
// Gebruik: eerst register('../core/app-test-hooks.mjs', ...), dan deze; zet
// vóór het laden een `document` met createElement (canvas) neer.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const STUBS = [
  'js/pdf/loader.js',
  'js/core/platform.js',
  'js/ui/chrome/dialogs.js',
  'js/ui/chrome/tabs.js',
  'js/ui/chrome/status-bar.js',
  'js/pdf/form-layer.js',
  'js/plugins/plugin-pdf.js',
  'js/plugins/annotation-type-registry.js',
  'js/pdf/handtekeningen/verificatie.js',
  'js/pdf/handtekeningen/opslaan.js',
  'js/pdf/page-manager.js',
  'js/pdf/document-release.js',
];

function exportNamen(bron) {
  const namen = new Set();
  const decl = /^\s*export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = decl.exec(bron))) namen.add(m[1]);
  const lijst = /^\s*export\s*\{([^}]*)\}/gm;
  while ((m = lijst.exec(bron))) {
    for (const deel of m[1].split(',')) {
      const stukken = deel.trim().replace(/^type\s+/, '').split(/\s+as\s+/);
      const naam = (stukken[1] || stukken[0] || '').trim();
      if (naam && naam !== 'default') namen.add(naam);
    }
  }
  return { namen: [...namen], standaard: /^\s*export\s+default\b/m.test(bron) };
}

function stubBron(bestand) {
  const { namen, standaard } = exportNamen(readFileSync(bestand, 'utf8'));
  const regels = namen.map(
    (n) => `export const ${n} = (...a) => globalThis.__saverTest?.impl?.[${JSON.stringify(n)}]?.(...a);`,
  );
  if (standaard) regels.push('export default function () { return undefined; }');
  return regels.join('\n');
}

const pad = (url) => fileURLToPath(url).replace(/\\/g, '/');

export async function resolve(specifier, context, nextResolve) {
  // De browserbouw van pdf.js vraagt DOMMatrix; onder node de legacy-bouw.
  if (specifier === 'pdfjs-dist') return nextResolve('pdfjs-dist/legacy/build/pdf.mjs', context);
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.startsWith('file:')) {
    const p = pad(url);
    if (p.endsWith('.jsx') || STUBS.some((s) => p.endsWith(`/${s}`))) {
      return { format: 'module', shortCircuit: true, source: stubBron(fileURLToPath(url)) };
    }
  }
  return nextLoad(url, context);
}
