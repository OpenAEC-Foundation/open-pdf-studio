// Laadhaken voor de gedragstest van geefDocumentVrij (#705): vervangen de
// cache-modules die document-release.js bij het vrijgeven laadt door
// doorgeefluiken die elke aanroep noteren in `globalThis.__vrijTest.aanroepen`.

const STUBS = {
  'js/pdf/loader.js': ['clearCachedPdfBytes'],
  'js/pdf/vector-renderer.js': ['invalidateDocumentCache'],
  'js/pdf/page-bitmap-cache.js': ['invalidateDocumentBitmaps'],
  'js/pdf/progressive-render.js': ['forgetContentBytes'],
  'js/pdf/weergave-per-document.js': ['vergeetWeergaveStand'],
  'js/pdf/tile-cache.js': ['tileCacheClearForFile'],
  'js/pdf/renderer.js': ['clearBitmapJSCacheForFile', 'clearLowResCacheForFile'],
  'js/tools/pdf-snap-extractor.js': ['vergeetSnapGeometrie'],
  'js/core/platform.js': ['isTauri', 'invoke', 'unlockFile'],
  'js/pdf/split-view/paneel-bitmaps.js': ['vergeetPaneelBeelden'],
};

function bron(namen) {
  return namen.map((n) => {
    const terug = n === 'isTauri' ? 'false' : 'undefined';
    return `export const ${n} = (...a) => { (globalThis.__vrijTest ??= { aanroepen: [] }).aanroepen.push([${JSON.stringify(n)}, ...a]); return ${terug}; };`;
  }).join('\n');
}

export async function resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith('.') || !context.parentURL?.startsWith('file:')) return nextResolve(specifier, context);
  const doel = new URL(specifier, context.parentURL).href;
  for (const [pad, namen] of Object.entries(STUBS)) {
    if (doel.endsWith(`/${pad}`)) {
      return { url: `data:text/javascript,${encodeURIComponent(bron(namen))}`, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}
