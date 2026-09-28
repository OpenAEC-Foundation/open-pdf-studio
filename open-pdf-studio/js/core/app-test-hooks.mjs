// Laadhaken om app-modules onder node te draaien, voor tests en de
// benchmark van #491 (scripts/bench/undo-node.mjs).
//
// - `./x.js` dat alleen als `./x.ts` bestaat, wordt het .ts-bestand (zoals
//   Vite doet). De types haalt TypeScript eraf (transpileModule): node 20,
//   waarop CI draait, kan dat niet zelf.
// - `solid-js` en `solid-js/store` worden de reactieve browserbouw, net als in
//   de app. Onder node kiest het pakket anders de serverbouw, waarin een memo
//   één keer rekent en daarna nooit meer: reactief gedrag is daar niet te
//   testen.
// - Modules die de DOM, het canvas of de Tauri-brug nodig hebben, worden
//   stubs: elke export is een lege functie die zijn aanroepen telt in
//   globalThis.__stubCalls ({ naam: aantal }). De state-store, de
//   undo-manager, het eigenschappenpaneel, de schaalopzoeking en de
//   hoeveelhedenstaat blijven echt.
// - buildSchedule (quantities/engine.js) telt zijn aanroepen in
//   globalThis.__buildScheduleCount.
//
// Gebruik: register('<pad>/app-test-hooks.mjs', import.meta.url) en daarna
// de app-modules met een dynamische import() laden. Zet vóór het laden een
// kale `window`/`document` neer (zie installeerBrowserStubs hieronder).

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let typescript = null;

// Een .ts-module als gewone JavaScript: alleen de types eraf, verder niets.
function zonderTypes(bron, bestand) {
  typescript ??= require('typescript');
  return typescript.transpileModule(bron, {
    fileName: bestand,
    compilerOptions: {
      module: typescript.ModuleKind.ESNext,
      target: typescript.ScriptTarget.ES2022,
      isolatedModules: true,
    },
  }).outputText;
}

const STUBS = [
  '/js/bridge.ts',
  '/js/annotations/rendering.js',
  '/js/core/preferences.js',
  '/js/quantities/label-i18n.js',
  '/js/i18n/config.js',
  '/js/i18n/useTranslation.js',
  '/js/text/text-selection.js',
  '/js/ui/panels/left-panel.js',
  '/js/ui/panels/bookmarks.js',
  '/js/annotations/stamp-line-width.js',
];

const pad = (url) => fileURLToPath(url).split('\\').join('/');

function isStub(url) {
  if (!url.startsWith('file:')) return false;
  const p = pad(url);
  return STUBS.some((s) => p.endsWith(s));
}

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

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'solid-js' || specifier.startsWith('solid-js/')) {
    // De 'browser'-voorwaarde staat in het exports-veld van solid-js vóór 'node'.
    const conditions = [...new Set(['browser', ...(context.conditions || [])])];
    return nextResolve(specifier, { ...context, conditions });
  }
  try {
    return await nextResolve(specifier, context);
  } catch (fout) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
      const ts = new URL(`${specifier.slice(0, -3)}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(ts))) return { url: ts.href, shortCircuit: true };
    }
    throw fout;
  }
}

export async function load(url, context, nextLoad) {
  if (url.startsWith('file:') && pad(url).endsWith('/js/quantities/engine.js')) {
    const bron = readFileSync(fileURLToPath(url), 'utf8');
    const kop = 'export function buildSchedule(';
    if (bron.includes(kop)) {
      return {
        format: 'module',
        shortCircuit: true,
        source: `${bron.replace(kop, 'function buildScheduleGeteld(')}
export function buildSchedule(...args) {
  globalThis.__buildScheduleCount = (globalThis.__buildScheduleCount || 0) + 1;
  return buildScheduleGeteld(...args);
}
`,
      };
    }
  }
  if (isStub(url)) {
    const { namen, standaard } = exportNamen(readFileSync(fileURLToPath(url), 'utf8'));
    const regels = namen.map((n) => `export function ${n}() {
  const tel = (globalThis.__stubCalls ??= {});
  tel[${JSON.stringify(n)}] = (tel[${JSON.stringify(n)}] || 0) + 1;
  return undefined;
}`);
    if (standaard) regels.push('export default { t: (k, o) => (o && o.defaultValue) || k, on() {}, language: "en" };');
    return { format: 'module', shortCircuit: true, source: regels.join('\n') };
  }
  if (url.startsWith('file:') && url.endsWith('.ts')) {
    const bestand = fileURLToPath(url);
    return { format: 'module', shortCircuit: true, source: zonderTypes(readFileSync(bestand, 'utf8'), bestand) };
  }
  return nextLoad(url, context);
}

/** Het kleine stukje browser dat de app-modules bij het laden aanraken. */
export function installeerBrowserStubs() {
  globalThis.window ??= globalThis;
  globalThis.document ??= {
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener() {},
    removeEventListener() {},
    documentElement: { setAttribute() {} },
  };
  if (!globalThis.localStorage) {
    const opslag = new Map();
    globalThis.localStorage = {
      getItem: (k) => (opslag.has(k) ? opslag.get(k) : null),
      setItem: (k, v) => { opslag.set(k, String(v)); },
      removeItem: (k) => { opslag.delete(k); },
    };
  }
}
