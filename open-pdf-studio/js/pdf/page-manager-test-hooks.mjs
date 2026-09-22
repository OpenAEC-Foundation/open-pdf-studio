// Laadhaken voor de gedragstests van page-manager.js (#400).
//
// page-manager.js trekt de halve app mee (state, renderer, pdf.js, panelen) en
// is daardoor niet kaal onder node te laden. Deze haken vervangen precies die
// app-modules door dunne doorgeefluiken naar `globalThis.__pmTest`; pdf-lib,
// pdf-viewports.js, cad-import-logica.js en page-manager.js zelf blijven echt.
// Zo draait de echte code van elke structurele bewerking op echte PDF-bytes.
//
// Een export `naam` roept `globalThis.__pmTest.impl[naam](...args)` aan als die
// bestaat en geeft anders undefined terug.

const STUBS = {
  'js/core/state.js': ['getActiveDocument', 'getNextUntitledName'],
  'js/core/platform.js': ['saveFileDialog', 'writeBinaryFile', 'readBinaryFile', 'isTauri', 'invoke', 'openFileDialog', 'openFolderDialog', 'lockFile', 'unlockFile'],
  'js/core/undo-manager.js': ['recordPageStructure'],
  'js/pdf/loader.js': ['getCachedPdfBytes', 'setCachedPdfBytes', 'clearCachedPdfBytes', 'cancelAnnotationLoading', 'markAllAnnotationPagesLoaded', 'loadPDF'],
  // Wat document-release.js per pad vrijgeeft voordat een werkbestand weg mag.
  'js/pdf/vector-renderer.js': ['invalidateDocumentCache'],
  'js/pdf/page-bitmap-cache.js': ['invalidateDocumentBitmaps'],
  'js/pdf/progressive-render.js': ['forgetContentBytes'],
  'js/pdf/renderer.js': ['setViewMode', 'fitPage'],
  'js/pdf/form-layer.js': ['resetAnnotationStorage'],
  'js/ui/panels/left-panel.js': ['generateThumbnails', 'clearThumbnailCache'],
  'js/ui/panels/properties-panel.js': ['hideProperties'],
  'js/ui/chrome/tabs.js': ['markDocumentModified', 'createTab', 'updateWindowTitle'],
  'js/ui/chrome/status-bar.js': ['updateAllStatus'],
  'js/ui/chrome/dialogs.js': ['showLoading', 'hideLoading'],
  'js/tools/pdf-snap-extractor.js': ['clearPdfVectorCache'],
  'js/search/find-controller.js': ['clearTextCache'],
  'js/bridge.js': ['showMessage'],
};

function bron(namen, extra = '') {
  const regels = namen.map(
    (n) => `export const ${n} = (...a) => globalThis.__pmTest?.impl?.[${JSON.stringify(n)}]?.(...a);`,
  );
  return `${regels.join('\n')}\n${extra}`;
}

const dataUrl = (tekst) => `data:text/javascript,${encodeURIComponent(tekst)}`;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'pdfjs-dist' && context.parentURL?.endsWith('/js/pdf/page-manager.js')) {
    return { url: dataUrl(bron(['getDocument'])), shortCircuit: true };
  }
  if (!specifier.startsWith('.') || !context.parentURL?.startsWith('file:')) return nextResolve(specifier, context);
  const doel = new URL(specifier, context.parentURL).href;
  if (doel.endsWith('/js/i18n/config.js')) {
    return { url: dataUrl('export default { t: (sleutel) => sleutel };'), shortCircuit: true };
  }
  for (const [pad, namen] of Object.entries(STUBS)) {
    if (!doel.endsWith(`/${pad}`)) continue;
    const extra = pad === 'js/core/state.js' ? 'export const state = { get documents() { return globalThis.__pmTest?.documents ?? []; } };' : '';
    return { url: dataUrl(bron(namen, extra)), shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
