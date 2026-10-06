// Laadhaken voor de gedragstests van de render-lus in pdf-viewport.js.
//
// pdf-viewport.js trekt via zijn imports de app-toestand, de vectorrenderer
// en de annotatiemodules mee; die zijn onder node niet kaal te laden. Deze
// haken vervangen precies die modules door dunne doorgeefluiken naar
// `globalThis.__vpTest`. De rekenmodules (weergave-rotatie, tile-coverage,
// overlay-canvas-size, wiel-scroll, text-edit-appearance) en pdf-viewport.js
// zelf blijven echt.
//
// Een export `naam` roept `globalThis.__vpTest.impl[naam](...args)` aan als
// die bestaat en geeft anders undefined terug.

const STUBS = {
  'js/core/state.js': ['getActiveDocument'],
  'js/pdf/vector-renderer.js': ['renderVectorPage'],
  'js/annotations/geometry.js': ['findAnnotationAt'],
  'js/pdf/page-bitmap-cache.js': ['computeZoomBucket', 'getBestAvailableBitmap', 'ensureBitmap', 'getCachedBitmap'],
  'js/annotations/rendering.js': ['redrawContinuous', 'redrawAnnotations'],
  'js/pdf/bitmap-orchestrator.js': ['ensureBitmapForCurrentView', 'ensureTileForCurrentView'],
  'js/pdf/renderer.js': ['renderContinuous'],
};

function bron(namen, extra = '') {
  const regels = namen.map(
    (n) => `export const ${n} = (...a) => globalThis.__vpTest?.impl?.[${JSON.stringify(n)}]?.(...a);`,
  );
  return `${regels.join('\n')}\n${extra}`;
}

const dataUrl = (tekst) => `data:text/javascript,${encodeURIComponent(tekst)}`;

export async function resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith('.') || !context.parentURL?.startsWith('file:')) return nextResolve(specifier, context);
  const doel = new URL(specifier, context.parentURL).href;
  for (const [pad, namen] of Object.entries(STUBS)) {
    if (!doel.endsWith(`/${pad}`)) continue;
    const extra = pad === 'js/core/state.js' ? 'export const state = {};' : '';
    return { url: dataUrl(bron(namen, extra)), shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
