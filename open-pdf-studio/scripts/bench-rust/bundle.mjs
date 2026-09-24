// Load app modules into node.
//
// Most of js/ cannot be imported directly under node: js/core/state.ts is a
// solid-js reactive store behind a .js specifier that only Vite resolves,
// js/i18n/config.js has a top-level await, and several modules register DOM
// listeners at import time. This bundles a chosen set of exports with esbuild,
// replacing those few modules with stubs, so the *algorithms* can be timed.
//
// What that means for the numbers: they are a LOWER bound for the real app.
// The reactive store adds a proxy read per property access, and the real canvas
// is slower than the recorder used here.

import { writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as esbuild from 'esbuild';

const here = new URL('.', import.meta.url).pathname.replace(/^\//, '');
export const appRoot = join(here, '..', '..');
const jsRoot = join(appRoot, 'js');

/** Every identifier the app imports from a module, so a stub can satisfy them all. */
function importedNames(modulePath) {
  const names = new Set();
  const re = new RegExp(String.raw`import\s*\{([^}]*)\}\s*from\s*['"][^'"]*${modulePath}['"]`, 'g');
  (function walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); continue; }
      if (!/\.(js|jsx|ts|mjs)$/.test(e.name)) continue;
      let m; const src = readFileSync(p, 'utf8');
      while ((m = re.exec(src))) {
        for (const raw of m[1].split(',')) {
          const id = raw.split(/\s+as\s+/)[0].trim().replace(/^type\s+/, '');
          if (/^[A-Za-z_$][\w$]*$/.test(id)) names.add(id);
        }
      }
    }
  })(jsRoot);
  return [...names];
}

const fillers = (mod, head = '') => head + importedNames(mod)
  .filter((n) => !new RegExp(`export\\s+(const|let|var|function|class)\\s+${n}\\b`).test(head)
    && !new RegExp(`export\\s+(const|let|var)\\s+[^;]*\\b${n}\\s*=`).test(head))
  .map((n) => `export const ${n} = function ${n}() { return undefined; };`).join('\n');

const STUBS = {
  'stub:state': fillers('core/state\\.js', `
export const state = { documents: [], activeDocumentIndex: 0, preferences: {}, imageCache: {} };
export function getActiveDocument() { return state.documents[state.activeDocumentIndex] || null; }
export function getPageRotation() { return 0; }
`),
  'stub:dom': fillers('ui/dom-elements\\.js', `
export let annotationCtx = { measureText: () => ({ width: 10 }), font: '' };
export let pdfCtx = null, textHighlightCtx = null;
export let placeholder = null, pdfContainer = null, pdfCanvas = null;
export let textHighlightCanvas = null, annotationCanvas = null;
export let continuousContainer = null, canvasContainer = null;
export const propertiesPanel = null;
export function initDomElements() {}
`),
  // A re-export barrel that drags in the whole app.
  'stub:bridge': fillers('bridge\\.js'),
  // Registers DOM listeners at import time and pulls the renderer in with it.
  'stub:viewport': fillers('pdf/pdf-viewport\\.js'),
  'stub:renderer': fillers('pdf/renderer\\.js'),
  // Top-level await: turns every importer into an async module, which esbuild
  // cannot express inside its lazy-init wrappers.
  'stub:i18n': `
const t = (k) => k;
export default { t, language: 'en', changeLanguage: () => {}, on: () => {}, isInitialized: true };
export const LANGUAGES = []; export const RTL_LANGUAGES = [];
export function isRTL() { return false; }
export async function loadLocale() {}
`,
  // pdf.js touches DOMMatrix at import time.
  'stub:pdfjs': `
export const GlobalWorkerOptions = {}; export const version = '0';
export function getDocument() { throw new Error('stub'); }
export const AnnotationEditorType = {}; export const AnnotationMode = {};
export const Util = {}; export const PixelsPerInch = { PDF_TO_CSS_UNITS: 1 };
export const AnnotationLayer = class {}; export const OPS = {};
export const XfaLayer = class {}; export const renderTextLayer = () => {};
export default {};
`,
};

const byPath = [
  [/js[\\/]core[\\/]state\.js$/, 'stub:state'],
  [/js[\\/]ui[\\/]dom-elements\.js$/, 'stub:dom'],
  [/js[\\/]bridge\.js$/, 'stub:bridge'],
  [/js[\\/]pdf[\\/]pdf-viewport\.js$/, 'stub:viewport'],
  [/js[\\/]pdf[\\/]renderer\.js$/, 'stub:renderer'],
  [/js[\\/]i18n[\\/]config\.js$/, 'stub:i18n'],
];

const stubPlugin = {
  name: 'stub',
  setup(build) {
    build.onResolve({ filter: /^stub:/ }, (a) => ({ path: a.path, namespace: 'stub' }));
    build.onResolve({ filter: /^pdfjs-dist/ }, () => ({ path: 'stub:pdfjs', namespace: 'stub' }));
    build.onResolve({ filter: /\.js$/ }, (a) => {
      if (a.namespace === 'stub' && !a.path.startsWith('.')) return undefined;
      // Match the RESOLVED path: the same module is imported as './config.js'
      // from a sibling and as '../i18n/config.js' from elsewhere.
      const abs = a.path.startsWith('.') ? join(a.resolveDir, a.path) : a.path;
      for (const [re, id] of byPath) if (re.test(abs)) return { path: id, namespace: 'stub' };
      return undefined;
    });
    build.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: 'js' }));
  },
};

/**
 * @param {string} tag              unique name for the generated bundle
 * @param {Array<[string,string[]]>} picks  [module path relative to the app root, export names]
 * @returns the bundle's namespace, plus `state` from the stub
 */
export async function loadAppModules(tag, picks) {
  const entry = join(here, `_entry-${tag}.mjs`);
  const out = join(here, `_${tag}.bundle.mjs`); // beside the app so node_modules resolves
  const lines = picks.map(([mod, names]) =>
    `export { ${names.join(', ')} } from '${join(appRoot, mod).replace(/\\/g, '/')}';`);
  lines.push(`export { state } from 'stub:state';`);
  writeFileSync(entry, lines.join('\n'));
  await esbuild.build({
    entryPoints: [entry], bundle: true, format: 'esm', outfile: out,
    platform: 'node', target: 'esnext', plugins: [stubPlugin], logLevel: 'error',
    define: { 'import.meta.glob': '__viteGlob', 'import.meta.env.DEV': 'false', __APP_VERSION__: '"bench"' },
    banner: { js: 'const __viteGlob = () => ({});' },
    external: ['solid-js', 'solid-js/store', 'i18next', 'pdf-lib', '@tauri-apps/api', 'mupdf'],
  });
  return import(`file:///${out.replace(/\\/g, '/')}`);
}
