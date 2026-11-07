// pdf-lib 1.17.1 houdt namen en referenties anders proceslang vast (#988).
// Alleen de pools vervangen: .of(), naamdecodering en objectidentiteit blijven intact.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Zelfstandig: dezelfde functie wordt in beide dependency-modules ingevoegd.
export function createWeakInternPool(WeakReference = globalThis.WeakRef, Registry = globalThis.FinalizationRegistry) {
  // Oudere WebViews houden de bewezen sterke interning; nooit levende namen wissen.
  if (typeof WeakReference !== 'function' || typeof Registry !== 'function') return new Map();
  const entries = new Map();
  const cleanup = new Registry(({ key, ref }) => {
    if (entries.get(key) === ref) entries.delete(key);
  });
  return {
    // Aantal sleutels in de administratie, net als Map.size (meetbaar in tests).
    get size() { return entries.size; },
    get(key) { return entries.get(key)?.deref(); },
    set(key, value) {
      const previous = entries.get(key);
      if (previous) cleanup.unregister(previous);
      const ref = new WeakReference(value);
      entries.set(key, ref);
      // Held data must not keep value alive. Token comparison protects replacements
      // even if an old cleanup callback was already queued before unregister().
      cleanup.register(value, { key, ref }, ref);
      return this;
    },
  };
}

const hashes = {
  PDFName: '6b60a2234958203c704e1a308781fcd6af08919d39946651e1d111db5a87d0f4',
  PDFRef: '5f0ed72ed2e37b9d96d64b9b7869791711fe2f031a9a087686242b7c412f682f',
};
const matchFile = (id) => id.replaceAll('\\', '/').match(/\/pdf-lib\/es\/core\/objects\/(PDFName|PDFRef)\.js$/);
export function patchInternPool(source, name) {
  if (!hashes[name] || createHash('sha256').update(source).digest('hex') !== hashes[name]) {
    throw new Error(`Unqualified pdf-lib ${name} source: revalidate the intern-pool backport before upgrading`);
  }
  return source.replace('var pool = new Map();', `var pool = (${createWeakInternPool.toString()})();`);
}

// Vite's dependency optimizer bypasses Rollup transforms; qualify BOTH paths.
export function pdfLibInternEsbuild() {
  return {
    name: 'opds-pdf-lib-intern-pools',
    setup(build) {
      build.onLoad({ filter: /[\\/]pdf-lib[\\/]es[\\/]core[\\/]objects[\\/](PDFName|PDFRef)\.js$/ }, ({ path }) => {
        const name = matchFile(path)[1];
        return { contents: patchInternPool(readFileSync(path, 'utf8'), name), loader: 'js' };
      });
    },
  };
}
export function pdfLibInternPools() {
  return {
    name: 'opds-pdf-lib-intern-pools', enforce: 'pre',
    config() { return { optimizeDeps: { esbuildOptions: { plugins: [pdfLibInternEsbuild()] } } }; },
    transform(source, id) {
      const match = matchFile(id);
      return match ? { code: patchInternPool(source, match[1]), map: null } : null;
    },
  };
}
