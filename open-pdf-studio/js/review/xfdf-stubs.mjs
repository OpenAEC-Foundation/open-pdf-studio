// Load hooks for the XFDF round trip of the shared review (#237): the real
// xfdf.js loads, its pure helpers (colours, layers, page, scale region) stay
// real, every other relative import becomes a stub that forwards to
// globalThis.__xfdfStubs[name] (or does nothing). `state` is
// globalThis.__xfdfStubs.state. Set __xfdfStubs before the import.
//
// Use: register('./xfdf-stubs.mjs', import.meta.url), then
// `await import('../annotations/xfdf.js')`.
import { readFileSync } from 'node:fs';

const DOEL = new URL('../annotations/xfdf.js', import.meta.url).href;
const ECHT = new Set(['./xfdf-kleur.js', './xfdf-laag.js', './xfdf-schaalgebied.js', './xfdf-pagina.js', './fill-utils.js', './annotatie-lagen.js']);
const MARKERING = 'xfdf-stub=';

let namenPerBron = null;
function namen() {
  if (namenPerBron) return namenPerBron;
  const bron = readFileSync(new URL(DOEL), 'utf8');
  namenPerBron = new Map();
  for (const m of bron.matchAll(/^import\s*\{([^}]*)\}\s*from\s*'([^']+)';/gm)) {
    const lijst = m[1].split(',').map((s) => s.trim()).filter(Boolean).map((s) => s.split(/\s+as\s+/)[0].trim());
    namenPerBron.set(m[2], [...(namenPerBron.get(m[2]) ?? []), ...lijst]);
  }
  for (const m of bron.matchAll(/^import\s+(\w+)\s+from\s*'([^']+)';/gm)) namenPerBron.set(m[2], [...(namenPerBron.get(m[2]) ?? []), `default:${m[1]}`]);
  return namenPerBron;
}

const zonderQuery = (url) => url.split('?')[0];

export async function resolve(specifier, context, nextResolve) {
  if (context.parentURL && zonderQuery(context.parentURL) === DOEL && specifier.startsWith('.') && !ECHT.has(specifier)) {
    const url = new URL(specifier, DOEL).href;
    return { url: `${url}?${MARKERING}${encodeURIComponent(specifier)}`, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  const i = url.indexOf(`?${MARKERING}`);
  if (i >= 0) {
    const spec = decodeURIComponent(url.slice(i + 1 + MARKERING.length));
    const source = [...new Set(namen().get(spec) ?? [])].map((naam) => {
      if (naam.startsWith('default:')) return 'export default globalThis.__xfdfStubs?.i18next ?? { t: (k) => k };';
      if (naam === 'state') return 'export const state = globalThis.__xfdfStubs.state;';
      return `export const ${naam} = (...a) => (globalThis.__xfdfStubs?.[${JSON.stringify(naam)}] ?? (() => undefined))(...a);`;
    }).join('\n');
    return { format: 'module', source, shortCircuit: true };
  }
  // The app's package.json has no "type": "module": load these as modules.
  if (url.startsWith('file:') && /\/js\/annotations\/[^/?]+\.js$/.test(zonderQuery(url))) {
    return { format: 'module', source: readFileSync(new URL(zonderQuery(url)), 'utf8'), shortCircuit: true };
  }
  return nextLoad(url, context);
}
