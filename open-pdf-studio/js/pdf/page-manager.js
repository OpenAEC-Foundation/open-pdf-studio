import { meld as meldSplit } from './split-view/split-haken.js';
import { state, getActiveDocument } from '../core/state.js';
import { getCachedPdfBytes, setCachedPdfBytes, cancelAnnotationLoading, markAllAnnotationPagesLoaded, laadAnnotatiesVoorPaginas } from './loader.js';
import { setViewMode, rotateAnnotation } from './renderer.js';
import { generateThumbnails, clearThumbnailCache } from '../ui/panels/left-panel.js';
import { markDocumentModified } from '../ui/chrome/tabs.js';
import { updateAllStatus } from '../ui/chrome/status-bar.js';
import { hideProperties } from '../ui/panels/properties-panel.js';
import { saveFileDialog, writeBinaryFile, readBinaryFile, isTauri, unlockFile } from '../core/platform.js';
import { showLoading, hideLoading } from '../ui/chrome/dialogs.js';
import { recordPageStructure } from '../core/undo-manager.js';
import { PDFDocument, degrees } from 'pdf-lib';
import {
  herschikViewports, leesPdfViewports, viewportsVanPaginas, draaiViewports,
  beginViewportLezing, rondViewportLezingAf, viewportLezingLoopt,
} from './pdf-viewports.js';
import * as pdfjsLib from 'pdfjs-dist';
import { resetAnnotationStorage } from './form-layer.js';
import { clearPdfVectorCache } from '../tools/pdf-snap-extractor.js';
import { clearTextCache } from '../search/find-controller.js';
import i18next from '../i18n/config.js';
import { showMessage } from '../bridge.js';
import { onthoudWerkbestand, losgelatenWerkbestanden, ruimWerkbestandenOp } from './document-release.js';
import { nieuwMergeVerslag, REDEN_VOORBEELD, REDEN_GEEN_PAGINAS } from './merge-verslag.js';
import { pdfjsBronnen } from '../core/basis-url.js';
import { zonderKopVoetStromen } from './saver/kopvoet.js';
import { labelsNaHerladen } from './pagina-labels-app.js';
import { relinkZonesInPages, zoneIdsInPages, zoneIdsInAnnotations } from './spatial-zone-relink.js';
import { isPageOrder, isIdentityOrder, pageMappingForOrder, remapBookmarkPages } from './page-order.js';
import { reorderPageTree } from './page-tree-reorder.js';
import {
  A4, normRotation, isValidPlan, isStructureUnchanged, treeOrderForPlan, pageMappingForPlan,
  remapBookmarksForPlan, blankSizeNeighbour, blankSizeFor, shownSize,
} from './page-edit-plan.js';
import { herschikControles } from '../annotations/schaalcontrole.js';

// Page clipboard for cut/copy/paste
let pageClipboard = null; // { bytes: Uint8Array, cut: boolean, sourcePageNum: number }

export function getPageClipboard() {
  return pageClipboard;
}

/**
 * Copy a page to the page clipboard.
 * Extracts the page as a standalone single-page PDF.
 */
export async function copyPage(pageNum) {
  if (!getActiveDocument()?.pdfDoc) return;

  const cacheKey = getCacheKey();
  const currentBytes = getCachedPdfBytes(cacheKey);
  if (!currentBytes) return;

  const srcDoc = await PDFDocument.load(currentBytes, { ignoreEncryption: true });
  const newDoc = await PDFDocument.create();
  const [copiedPage] = await newDoc.copyPages(srcDoc, [pageNum - 1]);
  newDoc.addPage(copiedPage);

  pageClipboard = {
    bytes: new Uint8Array(await newDoc.save()),
    cut: false,
    sourcePageNum: pageNum,
  };
}

/**
 * Copy multiple pages to the page clipboard.
 */
export async function copyPages(pageNumbers) {
  if (!getActiveDocument()?.pdfDoc || !pageNumbers || pageNumbers.length === 0) return;

  const cacheKey = getCacheKey();
  const currentBytes = getCachedPdfBytes(cacheKey);
  if (!currentBytes) return;

  const srcDoc = await PDFDocument.load(currentBytes, { ignoreEncryption: true });
  const newDoc = await PDFDocument.create();
  const indices = pageNumbers.map(p => p - 1);
  const copiedPages = await newDoc.copyPages(srcDoc, indices);
  for (const page of copiedPages) newDoc.addPage(page);

  pageClipboard = {
    bytes: new Uint8Array(await newDoc.save()),
    cut: false,
    sourcePageNum: pageNumbers[0],
  };
}

/**
 * Cut a page (copy + delete).
 */
export async function cutPage(pageNum) {
  const activeDoc = getActiveDocument();
  if (!activeDoc?.pdfDoc) return;
  if (activeDoc.pdfDoc.numPages <= 1) return;

  await copyPage(pageNum);
  if (pageClipboard) {
    pageClipboard.cut = true;
    await deletePages([pageNum]);
  }
}

/**
 * Cut multiple pages (copy + delete).
 */
export async function cutPages(pageNumbers) {
  const activeDoc = getActiveDocument();
  if (!activeDoc?.pdfDoc || !pageNumbers || pageNumbers.length === 0) return;
  if (activeDoc.pdfDoc.numPages <= pageNumbers.length) return;

  await copyPages(pageNumbers);
  if (pageClipboard) {
    pageClipboard.cut = true;
    await deletePages(pageNumbers);
  }
}

/**
 * Paste the page clipboard after the given page number.
 */
export async function pastePage(afterPageNum) {
  if (!getActiveDocument()?.pdfDoc || !pageClipboard) return;

  const cacheKey = getCacheKey();
  const currentBytes = getCachedPdfBytes(cacheKey);
  if (!currentBytes) return;

  const doc = getActiveDocument();
  const oldAnnotations = doc.annotations.map(a => ({ ...a }));
  const oldRotations = { ...doc.pageRotations };
  const oldPage = doc.currentPage;

  showLoading('Pasting page...');
  try {
    const destDoc = await PDFDocument.load(currentBytes, { ignoreEncryption: true });
    const oldNumPages = destDoc.getPageCount();
    const srcDoc = await PDFDocument.load(pageClipboard.bytes, { ignoreEncryption: true });
    const srcPageCount = srcDoc.getPageCount();

    const indices = [];
    for (let i = 0; i < srcPageCount; i++) indices.push(i);
    const copiedPages = await destDoc.copyPages(srcDoc, indices);

    const insertIdx = afterPageNum; // insert after this page (0-based index = afterPageNum)
    for (let i = 0; i < copiedPages.length; i++) {
      destDoc.insertPage(insertIdx + i, copiedPages[i]);
    }
    relinkCopiedPageZones(destDoc, copiedPages, doc);

    // Build page mapping
    const pageMapping = {};
    for (let oldP = 1; oldP <= oldNumPages; oldP++) {
      if (oldP <= insertIdx) {
        pageMapping[oldP] = oldP;
      } else {
        pageMapping[oldP] = oldP + srcPageCount;
      }
    }

    const newAnnotations = remapAnnotations(doc.annotations, pageMapping);
    const newRotations = remapRotations(doc.pageRotations, pageMapping);
    const newBytes = new Uint8Array(await destDoc.save());
    const targetPage = insertIdx + 1;

    // Meetschalen van de ingevoegde pagina's komen uit die pagina's zelf (#400).
    const newViewports = viewportsVanPaginas(copiedPages, insertIdx + 1);
    const inModel = await reloadFromBytes(newBytes, newAnnotations, newRotations, targetPage, { pageMapping, newViewports });
    recordPageStructure(currentBytes, oldAnnotations, oldRotations, oldPage, newBytes, inModel || newAnnotations, newRotations, targetPage);
  } finally {
    hideLoading();
  }
}

// Copied pages keep the spatial zone ids of their original; an id that the
// document already uses gets a fresh one, or both zones become invalid.
function relinkCopiedPageZones(destDoc, copiedPages, doc) {
  const copies = new Set(copiedPages.map((page) => page.ref));
  const others = destDoc.getPages().filter((page) => !copies.has(page.ref));
  const taken = new Set([
    ...zoneIdsInAnnotations(doc?.annotations),
    ...zoneIdsInPages(destDoc.context, others),
  ]);
  relinkZonesInPages(destDoc.context, copiedPages, taken);
}

// Get the cache key for the current document's bytes
export function getCacheKey() {
  const doc = getActiveDocument();
  if (!doc) return null;
  if (doc.filePath) return doc.filePath;
  return `__memory__${doc.id}`;
}

// Reload PDF.js from new bytes, preserving annotations and rotations.
// Returns the annotations now in the model: with a page mapping these include
// the ones loaded from pages that are new in the bytes (see below), which the
// caller records for redo.
export async function reloadFromBytes(newBytes, annotations, rotations, targetPage, viewportUpdate = null, doc = getActiveDocument()) {
  if (!doc) return;

  const oldPath = doc.filePath || `__memory__${doc.id}`;
  if (!oldPath) return;

  // Paginalabels (#580) horen bij een stand van de bytes: de oude stand (die
  // ongedaan maken terugzet) en de aangeleverde nieuwe (die opnieuw doen laadt).
  const oudeBytes = getCachedPdfBytes(oldPath);
  const aangeleverdeBytes = newBytes;

  // Kop-/voetteksten die als pagina-inhoud in de oude weergave stonden (#375):
  // het scherm tekent ze zelf, dus uit de nieuwe werkkopie halen — anders
  // staan ze dubbel, en na paginabewerkingen met verouderde nummers.
  if (doc._kopVoetBron && doc._kopVoetBron === oldPath) {
    try {
      newBytes = await zonderKopVoetStromen(newBytes);
    } catch (e) {
      console.warn('[reloadFromBytes] kop-/voetteksten niet uit de weergave gehaald', e);
    }
    doc._kopVoetBron = null;
  }

  // Welke pagina's hun annotaties al in het model hadden, vóór het laden
  // hieronder die administratie wist (zie de annotaties verderop).
  const oudGereed = doc._annotationPagesReady ? new Set(doc._annotationPagesReady) : null;

  // Cancel any in-progress annotation loading
  cancelAnnotationLoading(doc);

  // Destroy old pdf.js document to free memory
  if (doc.pdfDoc) {
    await (doc.pdfDoc.loadingTask || doc.pdfDoc).destroy();
  }

  // ── Issue #247 fix ──────────────────────────────────────────────────────
  // The PDFium main-view renderer reads each page bitmap from the file on
  // DISK, keyed by path (the Rust DocHandle / PdfBytes / PdfiumDoc / pixmap
  // caches are all path-keyed). After a structural edit (merge / insert /
  // delete) only the in-memory bytes change — the on-disk file does not — so
  // the main view kept rendering the pre-edit document while the thumbnails
  // (drawn from pdf.js) updated. Fix: persist the edited bytes to a FRESH temp
  // working file and point the document at it. A brand-new path has no cache
  // entries anywhere, so the main view rebuilds from the edited content, and
  // the user's original file is never touched (saved docs route Save → Save-As).
  let renderPath = oldPath;
  if (isTauri() && window.__TAURI__?.path && window.__TAURI__?.fs) {
    const invoke = window.__TAURI__?.core?.invoke;
    try {
      const tempDir = await window.__TAURI__.path.tempDir();
      const sep = (tempDir.endsWith('/') || tempDir.endsWith('\\')) ? '' : '/';
      renderPath = `${tempDir}${sep}opds-edit-${Date.now()}.pdf`;
      try { await invoke?.('allow_fs_scope', { path: renderPath }); } catch {}
      await writeBinaryFile(renderPath, newBytes.slice());

      const prevPath = oldPath;
      const wasUntitled = !!doc.isUntitled;
      const prevWasOurTemp = !!doc._renderTemp; // a temp working copy WE created earlier
      // Remember the real file Ctrl+S must write to: the original opened path.
      // An untitled doc has none → it stays untitled (Ctrl+S → Save-As).
      const saveTarget = doc.saveTargetPath || (wasUntitled ? null : oldPath);
      doc.filePath = renderPath;
      doc._renderTemp = true;
      doc.saveTargetPath = saveTarget;
      doc.isUntitled = !saveTarget; // saved docs keep Ctrl+S → original; untitled → Save-As

      // Delete the previous working/temp file (never a real saved original).
      // A temp file that was opened through the normal open flow (the PDF of
      // an imported drawing, #400) carries the app's own file lock; the tab
      // only releases the lock of the path it points to when it closes, and
      // from here on that is the new working copy. Release it first, or the
      // file cannot be removed and stays locked until the app exits.
      if ((prevWasOurTemp || wasUntitled) && prevPath && prevPath !== renderPath) {
        try { await unlockFile(prevPath); } catch {}
        try { await window.__TAURI__.fs.remove(prevPath); } catch {}
      }
      // The document remembers the working files the app made for it (#400):
      // the PDF of an imported drawing and every `opds-edit` copy. Whatever it
      // no longer refers to goes now, after its per-path caches are released;
      // a file that is still in use stays remembered and is tried again at the
      // next edit and when the tab closes, instead of lingering until the
      // clean-up of the next day.
      onthoudWerkbestand(doc, renderPath);
      try {
        await ruimWerkbestandenOp(doc, losgelatenWerkbestanden(doc, state.documents.filter((d) => d !== doc)));
      } catch (e) {
        console.warn('[reloadFromBytes] working files not removed', e);
      }
    } catch (e) {
      console.warn('[reloadFromBytes] temp working-file write failed; main view may stay stale', e);
      renderPath = oldPath;
    }
  }

  // Update cache with new bytes (keyed by the path we now render from)
  setCachedPdfBytes(renderPath, newBytes.slice());

  // Reset form field annotation storage
  resetAnnotationStorage(doc);

  // Caches derived from the old bytes that are NOT keyed by file path: the
  // snap-to-content geometry (keyed by page number) and the search text (keyed
  // by document id). Neither notices that the bytes were replaced, so after a
  // shift/straighten/delete the snap points and search highlights would sit at
  // the old positions, or belong to another page. Cleared before the re-render
  // below, which prefetches the snap geometry again.
  clearPdfVectorCache();
  clearTextCache(doc.id);

  // Load new bytes into pdf.js (slice to prevent buffer detachment of the original)
  doc.pdfDoc = await pdfjsLib.getDocument({
    data: newBytes.slice(),
    ...pdfjsBronnen(),
    isEvalSupported: false,
    verbosity: 0,
  }).promise;

  // Meetschalen uit de PDF zelf (/VP + /Measure) staan per paginanummer; na
  // invoegen, verwijderen of verplaatsen horen ze bij andere pagina's (#400).
  // Met een paginatoewijzing verhuizen ze meteen mee — het document hoeft er
  // niet nog een keer voor door pdf-lib. Stond er nog een lezing open (net
  // bijgesneden, of het document was nog aan het openen), dan is wat hier
  // verhuist nog van vóór die lezing: het geldt als tussenwaarde en de nieuwe
  // bytes worden alsnog gelezen. De oude lezing komt niet meer binnen.
  //
  // Zonder toewijzing (bijsnijden, rechtzetten, formaat wijzigen, ongedaan
  // maken en opnieuw doen) is niet bekend welke pagina waar bleef en of de
  // schaal nog klopt. Dan gelden er even géén viewports — de maatvoering valt
  // terug op de schaal van het document — tot de lezing klaar is. Liever kort
  // geen meetschaal uit de PDF dan die van een andere pagina of versie.
  if (viewportUpdate?.pageMapping) {
    const lezingStondOpen = viewportLezingLoopt(doc);
    doc.pdfViewports = herschikViewports(doc.pdfViewports, viewportUpdate.pageMapping, viewportUpdate.newViewports);
    // De schaalcontroles per blad verhuizen mee (#629).
    if (doc.scaleChecks) doc.scaleChecks = herschikControles(doc.scaleChecks, viewportUpdate.pageMapping);
    if (lezingStondOpen) leesViewportsOpnieuw(doc, newBytes);
  } else {
    doc.pdfViewports = undefined;
    leesViewportsOpnieuw(doc, newBytes);
  }

  // Pagina's die deze bewerking nieuw in het document bracht: geen beeld van
  // een oude pagina in de toewijzing.
  const nieuwePaginas = [];
  if (viewportUpdate?.pageMapping) {
    const beeld = new Set(Object.values(viewportUpdate.pageMapping).filter((n) => n != null));
    for (let p = 1; p <= doc.pdfDoc.numPages; p++) if (!beeld.has(p)) nieuwePaginas.push(p);
  }

  // Paginalabels verhuizen mee met hun pagina (#580). Samenvoegen schreef de
  // labels van de ingevoegde pagina's in de bytes; die komen erbij.
  let ingevoegdeLabels = null;
  if (viewportUpdate?.labelsUitBytes && nieuwePaginas.length) {
    try {
      const uitBytes = await doc.pdfDoc.getPageLabels();
      if (Array.isArray(uitBytes)) ingevoegdeLabels = new Map(nieuwePaginas.map((p) => [p, String(uitBytes[p - 1] ?? '')]));
    } catch (e) {
      console.warn('[reloadFromBytes] paginalabels van de ingevoegde pagina’s niet gelezen', e);
    }
  }
  await labelsNaHerladen(doc, {
    oudeBytes,
    nieuweBytes: aangeleverdeBytes,
    pageMapping: viewportUpdate?.pageMapping || null,
    ingevoegdeLabels,
  });

  // 3D models and 3D markup pages move with the pages: scan the new bytes.
  // Only a document that had either needs this extra parse; for all others
  // a page operation costs what it did before.
  if (doc.threeD?.length || doc.threeDSnapshots?.length) {
    try {
      const { find3DAnnotations, findThreeDSnapshots } = await import('./three-d/pdf-3d.js');
      const lib = await PDFDocument.load(aangeleverdeBytes.slice(), { ignoreEncryption: true, updateMetadata: false });
      doc.threeD = find3DAnnotations(lib);
      doc.threeDSnapshots = findThreeDSnapshots(lib);
    } catch (e) {
      console.warn('[3d] rescan after reload failed:', e);
    }
  }

  // Restore annotations and rotations
  doc.annotations = annotations;
  doc.pageRotations = rotations;

  // Clamp current page
  const numPages = doc.pdfDoc.numPages;
  doc.currentPage = Math.max(1, Math.min(targetPage, numPages));
  // Gesplitste weergave (#715): het andere paneel volgt zijn pagina mee, of
  // gaat naar de dichtstbijzijnde pagina als die van hem verwijderd is.
  meldSplit('paginaStructuur', { doc, pageMapping: viewportUpdate?.pageMapping || null, numPages });

  // Mark all pages as loaded so background loader won't overwrite
  markAllAnnotationPagesLoaded(numPages, doc);

  // Annotaties die alleen in de nieuwe bytes staan: die van ingevoegde
  // pagina's (samenvoegen, pagina's uit een bestand), en die van pagina's
  // die vóór deze bewerking nog niet geladen waren. Als 'geladen' gemarkeerd
  // zonder dat ze in het model staan, tekent de app ze niet en haalt de
  // volgende save ze weg (die vervangt de annotaties van een geladen pagina
  // door die uit het model). Dus nu laden, vóór het tekenen en vóór de
  // aanroeper de stand voor ongedaan maken vastlegt.
  if (viewportUpdate?.pageMapping && oudGereed && doc._annotationPagesReady) {
    const gereed = new Set();
    for (const p of oudGereed) {
      const n = viewportUpdate.pageMapping[p];
      if (n != null) gereed.add(n);
    }
    for (const a of annotations) gereed.add(a.page);
    const teLaden = [];
    for (let p = 1; p <= numPages; p++) if (!gereed.has(p)) teLaden.push(p);
    if (teLaden.length) {
      // In _loadedAnnotationPages blijven ze staan: zo laadt het tekenen ze
      // niet tegelijk nog een keer (dubbele annotaties).
      for (const p of teLaden) doc._annotationPagesReady.delete(p);
      try {
        const lib = await laadAnnotatiesVoorPaginas(doc, teLaden);
        if (lib) {
          const { leesAnnotatieLagen, voegGelezenLagenToe } = await import('./saver/annotatie-lagen.js');
          if (voegGelezenLagenToe(doc, leesAnnotatieLagen(lib))) {
            const { refreshAnnotationLayers } = await import('../bridge.js');
            refreshAnnotationLayers?.();
          }
        }
      } catch (e) {
        // Niet geladen blijft 'niet gereed': de saver laat de annotaties van
        // die pagina's dan in het bestand staan.
        console.warn('[reloadFromBytes] annotaties van nieuwe pagina’s niet geladen', e);
      }
    }
  }

  // Clear selection
  if (doc) {
    doc.selectedAnnotation = null;
    doc.selectedAnnotations = [];
  }
  clearThumbnailCache(doc.id);
  doc.modified = true;
  doc.savedUndoStackLength = -1;
  if (getActiveDocument() !== doc) return doc.annotations;
  hideProperties();

  // Re-render (preserve the book-spread / facing layout variants of continuous)
  await setViewMode(
    doc?.facingSpread && doc?.viewMode === 'continuous' ? 'facing'
    : doc?.bookSpread && doc?.viewMode === 'continuous' ? 'book'
    : (doc?.viewMode || 'single')
  );
  if (getActiveDocument() !== doc) return doc.annotations;
  generateThumbnails();
  updateAllStatus();
  return doc.annotations;
}

// Leest de viewports van deze bytes op de achtergrond. Een lezing die nog liep
// wordt hiermee ongeldig; alleen de laatste zet haar uitkomst.
function leesViewportsOpnieuw(doc, bytes) {
  const kenmerk = beginViewportLezing(doc);
  PDFDocument.load(bytes.slice(), { ignoreEncryption: true, updateMetadata: false })
    .then((lib) => { rondViewportLezingAf(doc, kenmerk, leesPdfViewports(lib)); })
    .catch(() => { rondViewportLezingAf(doc, kenmerk, null); /* viewports zijn optioneel */ });
}

// Build remapped annotations array based on page mapping
function remapAnnotations(annotations, pageMapping) {
  const remapped = [];
  for (const ann of annotations) {
    const newPage = pageMapping[ann.page];
    if (newPage !== undefined && newPage !== null) {
      remapped.push({ ...ann, page: newPage });
    }
  }
  return remapped;
}

// Build remapped rotations object based on page mapping
function remapRotations(rotations, pageMapping) {
  const remapped = {};
  for (const [pageStr, rotation] of Object.entries(rotations)) {
    const oldPage = parseInt(pageStr, 10);
    const newPage = pageMapping[oldPage];
    if (newPage !== undefined && newPage !== null && rotation !== 0) {
      remapped[newPage] = rotation;
    }
  }
  return remapped;
}

/**
 * Insert blank pages into the current document.
 * @param {'before'|'after'|'start'|'end'} position - Where to insert
 * @param {number} refPage - Reference page number (used for before/after)
 * @param {number} count - Number of pages to insert
 * @param {number} widthPt - Page width in points
 * @param {number} heightPt - Page height in points
 */
export async function insertBlankPages(position, refPage, count, widthPt, heightPt) {
  if (!getActiveDocument()?.pdfDoc) return;

  const cacheKey = getCacheKey();
  const currentBytes = getCachedPdfBytes(cacheKey);
  if (!currentBytes) return;

  const doc = getActiveDocument();
  const oldAnnotations = doc.annotations.map(a => ({ ...a }));
  const oldRotations = { ...doc.pageRotations };
  const oldPage = doc.currentPage;

  showLoading('Inserting pages...');
  try {
    const pdfDoc = await PDFDocument.load(currentBytes, { ignoreEncryption: true });
    const oldNumPages = pdfDoc.getPageCount();

    // Determine insertion index (0-based)
    let insertIdx;
    switch (position) {
      case 'start': insertIdx = 0; break;
      case 'end': insertIdx = oldNumPages; break;
      case 'before': insertIdx = refPage - 1; break;
      case 'after': insertIdx = refPage; break;
      default: insertIdx = oldNumPages;
    }

    // Insert blank pages
    for (let i = 0; i < count; i++) {
      pdfDoc.insertPage(insertIdx + i, [widthPt, heightPt]);
    }

    // Build page mapping (old page num -> new page num)
    const pageMapping = {};
    for (let oldP = 1; oldP <= oldNumPages; oldP++) {
      if (oldP <= insertIdx) {
        pageMapping[oldP] = oldP;
      } else {
        pageMapping[oldP] = oldP + count;
      }
    }

    const newAnnotations = remapAnnotations(doc.annotations, pageMapping);
    const newRotations = remapRotations(doc.pageRotations, pageMapping);

    const newBytes = new Uint8Array(await pdfDoc.save());

    // Determine which page to navigate to
    let targetPage = insertIdx + 1; // First inserted page

    const inModel = await reloadFromBytes(newBytes, newAnnotations, newRotations, targetPage, { pageMapping });

    // Record undo
    recordPageStructure(currentBytes, oldAnnotations, oldRotations, oldPage, newBytes, inModel || newAnnotations, newRotations, targetPage);
  } finally {
    hideLoading();
  }
}

/**
 * Insert pages from another PDF file at a specific position relative to a
 * reference page. Mirrors replacePages()/mergeFiles(): opens a file picker,
 * loads the chosen PDF with pdf-lib, copies all its pages into the current
 * document and remaps annotations/rotations, all undo-able via the shared
 * page-structure convention.
 * @param {number} refPage - Reference page number (1-based)
 * @param {'before'|'after'} position - Insert before or after the reference page
 * @param {string|null} sourcePath - when given, no file picker is shown (the
 *   DWG/DXF import passes the PDF it just made, #400)
 * @param {{stil?: boolean}} [opties] - `stil`: show no message box when it
 *   fails; the caller reports the failure itself (the CAD import dialog shows
 *   it in its own status line, and one report is enough, #400)
 * @returns {Promise<boolean>} true when the pages were inserted; the CAD
 *   import dialog has to know whether it succeeded (#400)
 */
export async function insertPagesFromFile(refPage, position, sourcePath = null, { stil = false } = {}) {
  const activeDoc = getActiveDocument();
  if (!activeDoc?.pdfDoc) return false;
  if (!isTauri()) return false;

  const numPages = activeDoc.pdfDoc.numPages;
  if (refPage < 1 || refPage > numPages) return false;

  // Open file dialog to pick the source PDF
  let filePath = sourcePath;
  if (!filePath) {
    try {
      filePath = await window.__TAURI__.dialog.open({
        multiple: false,
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
      });
    } catch (e) {
      return false;
    }
  }
  if (!filePath) return false;

  const cacheKey = getCacheKey();
  const currentBytes = getCachedPdfBytes(cacheKey);
  if (!currentBytes) return false;

  const doc = getActiveDocument();
  const oldAnnotations = doc.annotations.map(a => ({ ...a }));
  const oldRotations = { ...doc.pageRotations };
  const oldPage = doc.currentPage;

  showLoading('Inserting pages...');
  let inserted = false;
  try {
    // Ensure the picked source file is inside the fs allowlist scope.
    try { await window.__TAURI__?.core?.invoke?.('allow_fs_scope', { path: filePath }); } catch {}
    const fileData = await readBinaryFile(filePath);
    const srcBytes = new Uint8Array(fileData);
    const srcDoc = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
    const srcPageCount = srcDoc.getPageCount();

    if (srcPageCount === 0) {
      if (!stil) showMessage(i18next.t('selectedPdfNoPages'));
      return false;
    }
    // Een voorbeeld van het importvenster kan inhoud missen: nooit invoegen (#400).
    {
      const { isVoorbeeldPdf } = await import('./cad-import-logica.js');
      const { PDFName } = await import('pdf-lib');
      if (isVoorbeeldPdf(srcDoc, { PDFName })) {
        if (!stil) showMessage(i18next.t('previewPdfRefused'));
        return false;
      }
    }

    const destDoc = await PDFDocument.load(currentBytes, { ignoreEncryption: true });
    const oldNumPages = destDoc.getPageCount();

    // 0-based insertion index
    const insertIdx = position === 'before' ? refPage - 1 : refPage;

    const indices = [];
    for (let i = 0; i < srcPageCount; i++) indices.push(i);
    const copiedPages = await destDoc.copyPages(srcDoc, indices);
    for (let i = 0; i < copiedPages.length; i++) {
      destDoc.insertPage(insertIdx + i, copiedPages[i]);
    }
    relinkCopiedPageZones(destDoc, copiedPages, doc);
    // PDF-lagen (OCG's) van de ingevoegde pagina's horen ook in de lagenlijst
    // van de catalogus; copyPages neemt alleen de verwijzingen in de inhoud
    // mee (#400).
    try {
      const { voegLagenSamen } = await import('./cad-import-logica.js');
      const { PDFName, PDFArray, PDFDict, PDFString, PDFHexString } = await import('pdf-lib');
      const herkomst = String(filePath).split(/[\\/]/).pop() || '';
      voegLagenSamen(destDoc, copiedPages, { PDFName, PDFArray, PDFDict, PDFString, PDFHexString }, srcDoc, herkomst);
    } catch (e) {
      console.warn('[insert-pages] lagen samenvoegen mislukt:', e);
    }

    // Build page mapping for existing annotations/rotations
    const pageMapping = {};
    for (let oldP = 1; oldP <= oldNumPages; oldP++) {
      if (oldP <= insertIdx) {
        pageMapping[oldP] = oldP;
      } else {
        pageMapping[oldP] = oldP + srcPageCount;
      }
    }

    const newAnnotations = remapAnnotations(doc.annotations, pageMapping);
    const newRotations = remapRotations(doc.pageRotations, pageMapping);

    const newBytes = new Uint8Array(await destDoc.save());
    const targetPage = insertIdx + 1; // Navigate to first inserted page

    // De meetschalen van de ingevoegde pagina's komen uit de pagina's zelf;
    // die zijn hier al ingelezen (#400).
    const newViewports = viewportsVanPaginas(copiedPages, insertIdx + 1);
    const inModel = await reloadFromBytes(newBytes, newAnnotations, newRotations, targetPage, { pageMapping, newViewports });

    // Record undo
    recordPageStructure(currentBytes, oldAnnotations, oldRotations, oldPage, newBytes, inModel || newAnnotations, newRotations, targetPage);
    inserted = true;
  } catch (err) {
    console.error('Failed to insert pages from file:', err);
    if (!stil) showMessage(i18next.t('failedToInsertPagesFromFile', { error: err.message }));
  } finally {
    hideLoading();
  }
  return inserted;
}

/**
 * Delete pages from the current document.
 * @param {number[]} pageNumbers - Page numbers to delete (1-based)
 */
export async function deletePages(pageNumbers) {
  const activeDoc = getActiveDocument();
  if (!activeDoc?.pdfDoc) return;

  const numPages = activeDoc.pdfDoc.numPages;

  // Guard: can't delete all pages
  if (pageNumbers.length >= numPages) {
    showMessage(i18next.t('cannotDeleteAllPages'));
    return;
  }

  const cacheKey = getCacheKey();
  const currentBytes = getCachedPdfBytes(cacheKey);
  if (!currentBytes) return;

  const doc = getActiveDocument();
  const oldAnnotations = doc.annotations.map(a => ({ ...a }));
  const oldRotations = { ...doc.pageRotations };
  const oldPage = doc.currentPage;

  showLoading('Deleting pages...');
  try {
    const pdfDoc = await PDFDocument.load(currentBytes, { ignoreEncryption: true });

    // Sort descending so indices don't shift during removal
    const sorted = [...pageNumbers].sort((a, b) => b - a);
    const deleteSet = new Set(pageNumbers);

    for (const pageNum of sorted) {
      pdfDoc.removePage(pageNum - 1);
    }

    // Build page mapping: old page -> new page (deleted pages map to null)
    const pageMapping = {};
    let newIdx = 1;
    for (let oldP = 1; oldP <= numPages; oldP++) {
      if (deleteSet.has(oldP)) {
        pageMapping[oldP] = null;
      } else {
        pageMapping[oldP] = newIdx++;
      }
    }

    const newAnnotations = remapAnnotations(doc.annotations, pageMapping);
    const newRotations = remapRotations(doc.pageRotations, pageMapping);

    const newBytes = new Uint8Array(await pdfDoc.save());
    const newNumPages = pdfDoc.getPageCount();

    // Clamp current page
    let targetPage = Math.min(doc.currentPage, newNumPages);

    const inModel = await reloadFromBytes(newBytes, newAnnotations, newRotations, targetPage, { pageMapping });

    // Record undo
    recordPageStructure(currentBytes, oldAnnotations, oldRotations, oldPage, newBytes, inModel || newAnnotations, newRotations, targetPage);
  } finally {
    hideLoading();
  }
}

/**
 * Extract pages to a new PDF file.
 * @param {number[]} pageNumbers - Page numbers to extract (1-based)
 * @param {boolean} deleteFromOriginal - Whether to delete extracted pages from the source
 */
export async function extractPages(pageNumbers, deleteFromOriginal) {
  const activeDoc = getActiveDocument();
  if (!activeDoc?.pdfDoc) return;

  if (pageNumbers.length === 0) {
    showMessage(i18next.t('noPagesSelected'));
    return;
  }

  const cacheKey = getCacheKey();
  const currentBytes = getCachedPdfBytes(cacheKey);
  if (!currentBytes) return;

  // Ask user where to save
  const doc = getActiveDocument();
  const baseName = (doc.fileName || 'document').replace(/\.pdf$/i, '');
  const defaultPath = `${baseName}_extracted.pdf`;

  const savePath = await saveFileDialog(defaultPath, [{ name: 'PDF Files', extensions: ['pdf'] }]);
  if (!savePath) return;

  showLoading('Extracting pages...');
  try {
    // Create new document with extracted pages
    const srcDoc = await PDFDocument.load(currentBytes, { ignoreEncryption: true });
    const extractDoc = await PDFDocument.create();

    const indices = pageNumbers.map(p => p - 1);
    const copiedPages = await extractDoc.copyPages(srcDoc, indices);
    for (const page of copiedPages) {
      extractDoc.addPage(page);
    }

    const extractBytes = new Uint8Array(await extractDoc.save());
    await writeBinaryFile(savePath, extractBytes);

    // Optionally delete from original
    if (deleteFromOriginal) {
      const numPages = activeDoc.pdfDoc.numPages;
      if (pageNumbers.length >= numPages) {
        showMessage(i18next.t('cannotDeleteAllPagesSource'));
      } else {
        await deletePages(pageNumbers);
      }
    }
  } finally {
    hideLoading();
  }
}

/**
 * Reorder pages in the current document, as one undo step.
 * The pages are moved inside the document itself (page-tree-reorder.js), so
 * links, named destinations, form fields and layers keep their pages; the
 * annotations, rotations, measure scales, page labels and bookmarks of the
 * app model move along with their page.
 * @param {number[]} newPageOrder - Array where newPageOrder[i] = old page number that becomes page i+1
 *   e.g. [3,1,2,4] means old page 3 becomes new page 1, old page 1 becomes new page 2, etc.
 * @returns {Promise<boolean>} true when the order was changed
 */
export async function reorderPages(newPageOrder) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return false;

  const numPages = doc.pdfDoc.numPages;
  if (!isPageOrder(newPageOrder, numPages)) return false;
  if (isIdentityOrder(newPageOrder)) return false;

  const cacheKey = getCacheKey();
  const currentBytes = getCachedPdfBytes(cacheKey);
  if (!currentBytes) return false;

  const oldAnnotations = doc.annotations.map(a => ({ ...a }));
  const oldRotations = { ...doc.pageRotations };
  const oldPage = doc.currentPage;
  const oldBookmarks = Array.isArray(doc.bookmarks) ? doc.bookmarks.map(b => ({ ...b })) : null;

  showLoading('Reordering pages...');
  try {
    const pdfDoc = await PDFDocument.load(currentBytes, { ignoreEncryption: true });
    // Filled-in form values live only in the pdf.js document, which the
    // reload below replaces.
    let veldenGezet = 0;
    try {
      const { schrijfFormulierWaarden } = await import('./saver.js');
      veldenGezet = schrijfFormulierWaarden(pdfDoc, doc) || 0;
    } catch (e) {
      console.warn('[reorder] form values not carried over:', e);
    }

    const orderedPages = reorderPageTree(pdfDoc, newPageOrder);
    const pageMapping = pageMappingForOrder(newPageOrder);

    const newAnnotations = remapAnnotations(doc.annotations, pageMapping);
    const newRotations = remapRotations(doc.pageRotations, pageMapping);

    const newBytes = new Uint8Array(await pdfDoc.save({ updateFieldAppearances: veldenGezet > 0 }));

    // Navigate to the page that the current page moved to
    const targetPage = pageMapping[doc.currentPage] || 1;

    // Measure scales come from the pages themselves, numbered from the first (#400).
    const newViewports = viewportsVanPaginas(orderedPages, 1);
    const inModel = await reloadFromBytes(newBytes, newAnnotations, newRotations, targetPage, { pageMapping, newViewports });

    // Bookmarks are written from the model by the saver: they follow their page.
    const newBookmarks = oldBookmarks ? remapBookmarkPages(oldBookmarks, pageMapping) : null;
    if (newBookmarks) doc.bookmarks = newBookmarks.map(b => ({ ...b }));

    recordPageStructure(currentBytes, oldAnnotations, oldRotations, oldPage, newBytes, inModel || newAnnotations, newRotations, targetPage,
      newBookmarks ? { bookmarks: { old: oldBookmarks, new: newBookmarks } } : {});
    if (newBookmarks) await refreshBookmarksPanel();
    return true;
  } finally {
    hideLoading();
  }
}

async function refreshBookmarksPanel() {
  try {
    const { activeTab } = await import('../solid/stores/leftPanelStore.js');
    if (activeTab() === 'bookmarks') {
      const { updateBookmarksList } = await import('../ui/panels/bookmarks.js');
      updateBookmarksList();
    }
  } catch { /* panel not open */ }
}

// The pages of the added PDFs that a plan uses, copied into `destDoc`: one
// copyPages per file, so fonts and images a file's pages share are copied
// once. Refuses a preview PDF of the CAD import (it may miss content, #400)
// and merges the layers of the copied pages (as insertPagesFromFile does).
// Returns entry key -> copied PDFPage (not yet in the page tree).
async function kopieerBronPaginas(destDoc, entries, sources) {
  const perBron = new Map();
  for (const e of entries) {
    if (e.kind !== 'file') continue;
    if (!perBron.has(e.source)) perBron.set(e.source, []);
    perBron.get(e.source).push(e);
  }
  const kopie = new Map();
  if (!perBron.size) return kopie;
  const pdfLib = await import('pdf-lib');
  const { voegLagenSamen, isVoorbeeldPdf } = await import('./cad-import-logica.js');
  for (const [id, lijst] of perBron) {
    const bron = sources[id];
    const srcDoc = await PDFDocument.load(bron.bytes.slice(), { ignoreEncryption: true });
    if (isVoorbeeldPdf(srcDoc, pdfLib)) {
      const err = new Error('preview PDF');
      err.voorbeeld = true;
      throw err;
    }
    const pages = await destDoc.copyPages(srcDoc, lijst.map((e) => e.index));
    lijst.forEach((e, i) => kopie.set(e.key, pages[i]));
    try {
      voegLagenSamen(destDoc, pages, pdfLib, srcDoc, String(bron.name || '').split(/[\\/]/).pop() || '');
    } catch (e) {
      console.warn('[edit-pages] merging layers failed:', e);
    }
  }
  return kopie;
}

// The box a page shows: its CropBox within its MediaBox (as pdf.js measures
// a page, so the same size the rest of the app works with).
function effectiveSize(page) {
  const span = (r) => ({ x1: Math.min(r.x, r.x + r.width), y1: Math.min(r.y, r.y + r.height), x2: Math.max(r.x, r.x + r.width), y2: Math.max(r.y, r.y + r.height) });
  const m = span(page.getMediaBox());
  const c = span(page.getCropBox());
  const x1 = Math.max(m.x1, c.x1), y1 = Math.max(m.y1, c.y1);
  const x2 = Math.min(m.x2, c.x2), y2 = Math.min(m.y2, c.y2);
  return x2 > x1 && y2 > y1 ? { width: x2 - x1, height: y2 - y1 } : { width: m.x2 - m.x1, height: m.y2 - m.y1 };
}

// Size of a blank entry: the size the organizer gave it (#846, exactly);
// without one that of the nearest document page next to it, the same way up
// as that page shows after the edit (blankSizeFor), else A4.
function blankSize(plan, entry, oldPages, doc) {
  if (entry.width > 0 && entry.height > 0) return { width: entry.width, height: entry.height };
  const buur = blankSizeNeighbour(plan.entries, plan.entries.indexOf(entry));
  if (!buur) return { ...A4 };
  const page = oldPages[buur.page - 1];
  return blankSizeFor(effectiveSize(page), page.getRotation().angle + (doc.pageRotations?.[buur.page] || 0) + buur.rotation);
}

/**
 * Carries out the pending edits of the Edit Pages organizer (#764) — reorder,
 * rotate, delete, insert blank pages and pages of other PDFs — as ONE undo
 * step. The pages stay in the document (the page tree is rewritten in place,
 * page-tree-reorder.js), so links, named destinations, form fields and layers
 * keep their pages; annotations, rotations, measure scales, page labels and
 * bookmarks of the app model follow their page. A turn of a document page
 * works like the rotate buttons (the app rotation, with its annotations and
 * measure scales turned along); a new page is turned in the PDF itself.
 * @param {object} plan  see page-edit-plan.js
 * @param {{sources?: Record<string, {bytes: Uint8Array, name?: string, pageCount: number}>}} [opts]
 *   the PDFs the plan inserts pages from
 * @returns {Promise<boolean>} true when the document changed
 */
export async function applyPageEdits(plan, { sources = {} } = {}) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return false;
  const numPages = doc.pdfDoc.numPages;
  const counts = Object.fromEntries(Object.entries(sources).map(([id, s]) => [id, s?.pageCount]));
  if (!isValidPlan(plan, numPages, counts)) return false;
  if (isStructureUnchanged(plan, numPages)) return false;

  const currentBytes = getCachedPdfBytes(getCacheKey());
  if (!currentBytes) return false;

  const oldAnnotations = doc.annotations.map(a => ({ ...a }));
  const oldRotations = { ...doc.pageRotations };
  const oldPage = doc.currentPage;
  const oldBookmarks = Array.isArray(doc.bookmarks) ? doc.bookmarks.map(b => ({ ...b })) : null;

  showLoading('Applying page edits...');
  try {
    const pdfDoc = await PDFDocument.load(currentBytes, { ignoreEncryption: true });
    // Filled-in form values live only in the pdf.js document, which the
    // reload below replaces.
    let veldenGezet = 0;
    try {
      const { schrijfFormulierWaarden } = await import('./saver.js');
      veldenGezet = schrijfFormulierWaarden(pdfDoc, doc) || 0;
    } catch (e) {
      console.warn('[edit-pages] form values not carried over:', e);
    }
    const oldPages = pdfDoc.getPages();

    // 1. New pages, appended in plan order behind the existing ones.
    const { added, order, removeCount } = treeOrderForPlan(plan, numPages);
    const kopie = await kopieerBronPaginas(pdfDoc, added, sources);
    const nieuw = [];
    for (const e of added) {
      const page = e.kind === 'blank'
        ? pdfDoc.addPage((({ width, height }) => [width, height])(blankSize(plan, e, oldPages, doc)))
        : pdfDoc.addPage(kopie.get(e.key));
      const r = normRotation(e.rotation);
      if (r) page.setRotation(degrees(normRotation(page.getRotation().angle + r)));
      nieuw.push(page);
    }
    if (kopie.size) relinkCopiedPageZones(pdfDoc, [...kopie.values()], doc);

    // 2. Every page in place, the deleted ones at the end; 3. those go.
    reorderPageTree(pdfDoc, order);
    for (let k = 0; k < removeCount; k++) pdfDoc.removePage(order.length - 1 - k);
    // removePage leaves pdf-lib's page cache as it was.
    pdfDoc.pageCache?.invalidate?.();

    // 4. The app model follows the pages.
    const pageMapping = pageMappingForPlan(plan, numPages);
    const newAnnotations = remapAnnotations(doc.annotations, pageMapping);
    const newRotations = remapRotations(doc.pageRotations, pageMapping);
    const newViewports = {};
    const nieuwNummer = new Map(plan.entries.map((e, i) => [e.key, i + 1]));
    added.forEach((e, i) => Object.assign(newViewports, viewportsVanPaginas([nieuw[i]], nieuwNummer.get(e.key))));
    plan.entries.forEach((e, i) => {
      const delta = normRotation(e.rotation);
      if (e.kind !== 'page' || !delta) return;
      const naar = i + 1;
      const page = oldPages[e.page - 1];
      const crop = page.getCropBox();
      const appRot = doc.pageRotations?.[e.page] || 0;
      const oud = shownSize(crop.width, crop.height, page.getRotation().angle + appRot);
      for (const a of newAnnotations) if (a.page === naar) rotateAnnotation(a, delta, oud.width, oud.height);
      const r = normRotation(appRot + delta);
      if (r) newRotations[naar] = r; else delete newRotations[naar];
      if (doc.pdfViewports?.[e.page]) newViewports[naar] = draaiViewports(doc.pdfViewports[e.page], delta, oud.width, oud.height);
    });

    const newBytes = new Uint8Array(await pdfDoc.save({ updateFieldAppearances: veldenGezet > 0 }));
    const targetPage = pageMapping[doc.currentPage] || Math.min(doc.currentPage, plan.entries.length);
    const inModel = await reloadFromBytes(newBytes, newAnnotations, newRotations, targetPage, { pageMapping, newViewports });

    const newBookmarks = oldBookmarks ? remapBookmarksForPlan(oldBookmarks, pageMapping, numPages) : null;
    if (newBookmarks) doc.bookmarks = newBookmarks.map(b => ({ ...b }));

    recordPageStructure(currentBytes, oldAnnotations, oldRotations, oldPage, newBytes, inModel || newAnnotations, newRotations, targetPage,
      newBookmarks ? { bookmarks: { old: oldBookmarks, new: newBookmarks } } : {});
    if (newBookmarks) await refreshBookmarksPanel();
    return true;
  } catch (err) {
    console.error('[edit-pages] applying the page edits failed:', err);
    showMessage(err?.voorbeeld
      ? i18next.t('previewPdfRefused')
      : i18next.t('dialogs:pageOrganizer.applyFailed', { error: err?.message ?? String(err) }));
    return false;
  } finally {
    hideLoading();
  }
}

/**
 * Writes the selected entries of an Edit Pages plan (#764) to a new PDF, as
 * they will look after Apply: in their pending order and turn, blank and
 * inserted pages included. The document itself does not change.
 * @param {object} plan  see page-edit-plan.js
 * @param {string[]} keys  the selected entries
 * @param {{sources?: object, savePath?: string}} [opts]  `savePath` skips the save dialog
 * @returns {Promise<boolean>} true when the file was written
 */
export async function extractPlannedPages(plan, keys, { sources = {}, savePath = null } = {}) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return false;
  const sel = new Set(keys);
  const gekozen = plan.entries.filter((e) => sel.has(e.key));
  if (!gekozen.length) {
    showMessage(i18next.t('noPagesSelected'));
    return false;
  }
  const counts = Object.fromEntries(Object.entries(sources).map(([id, s]) => [id, s?.pageCount]));
  if (!isValidPlan(plan, doc.pdfDoc.numPages, counts)) return false;
  const currentBytes = getCachedPdfBytes(getCacheKey());
  if (!currentBytes) return false;

  let pad = savePath;
  if (!pad) {
    const baseName = (doc.fileName || 'document').replace(/\.pdf$/i, '');
    pad = await saveFileDialog(`${baseName}_extracted.pdf`, [{ name: 'PDF Files', extensions: ['pdf'] }]);
  }
  if (!pad) return false;

  showLoading('Extracting pages...');
  try {
    const srcDoc = await PDFDocument.load(currentBytes, { ignoreEncryption: true });
    const oldPages = srcDoc.getPages();
    const out = await PDFDocument.create();
    const eigen = gekozen.filter((e) => e.kind === 'page');
    const kopieEigen = await out.copyPages(srcDoc, eigen.map((e) => e.page - 1));
    const vanDoc = new Map(eigen.map((e, i) => [e.key, kopieEigen[i]]));
    const vanBron = await kopieerBronPaginas(out, gekozen, sources);
    for (const e of gekozen) {
      let page;
      let basis = 0;
      if (e.kind === 'page') {
        page = out.addPage(vanDoc.get(e.key));
        basis = page.getRotation().angle + (doc.pageRotations?.[e.page] || 0);
      } else if (e.kind === 'file') {
        page = out.addPage(vanBron.get(e.key));
        basis = page.getRotation().angle;
      } else {
        const { width, height } = blankSize(plan, e, oldPages, doc);
        page = out.addPage([width, height]);
      }
      page.setRotation(degrees(normRotation(basis + e.rotation)));
    }
    const bytes = new Uint8Array(await out.save());
    await writeBinaryFile(pad, bytes);
    return true;
  } catch (err) {
    console.error('[edit-pages] extracting failed:', err);
    showMessage(err?.voorbeeld
      ? i18next.t('previewPdfRefused')
      : i18next.t('dialogs:pageOrganizer.extractFailed', { error: err?.message ?? String(err) }));
    return false;
  } finally {
    hideLoading();
  }
}

/**
 * Restore page state (used by undo/redo).
 * @param {Uint8Array} bytes - PDF bytes to restore
 * @param {Array} annotations - Annotations array to restore
 * @param {Object} rotations - Page rotations to restore
 * @param {number} currentPage - Page to navigate to
 */
export async function restorePageState(bytes, annotations, rotations, currentPage, { bookmarks } = {}) {
  showLoading('Restoring...');
  try {
    // Bladwijzers die bij deze stand horen (samenvoegen); de saver schrijft
    // de outline uit het model.
    const doc = getActiveDocument();
    if (doc && Array.isArray(bookmarks)) doc.bookmarks = bookmarks.map((b) => ({ ...b }));
    await reloadFromBytes(bytes, annotations, rotations, currentPage);
  } finally {
    hideLoading();
  }
}

/**
 * Replace a page in the current document with pages from another PDF file.
 * @param {number} pageNumber - The page number to replace (1-based)
 */
export async function replacePages(pageNumber) {
  const activeDoc = getActiveDocument();
  if (!activeDoc?.pdfDoc) return;
  if (!isTauri()) return;

  const numPages = activeDoc.pdfDoc.numPages;
  if (pageNumber < 1 || pageNumber > numPages) return;

  // Open file dialog to pick replacement PDF
  let filePath;
  try {
    filePath = await window.__TAURI__.dialog.open({
      multiple: false,
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    });
  } catch (e) {
    return;
  }
  if (!filePath) return;

  const cacheKey = getCacheKey();
  const currentBytes = getCachedPdfBytes(cacheKey);
  if (!currentBytes) return;

  const doc = getActiveDocument();
  const oldAnnotations = doc.annotations.map(a => ({ ...a }));
  const oldRotations = { ...doc.pageRotations };
  const oldPage = doc.currentPage;

  showLoading('Replacing page...');
  try {
    // Read replacement file
    const fileData = await readBinaryFile(filePath);
    const srcBytes = new Uint8Array(fileData);
    const srcDoc = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
    const srcPageCount = srcDoc.getPageCount();

    if (srcPageCount === 0) {
      showMessage(i18next.t('selectedPdfNoPages'));
      return;
    }

    const destDoc = await PDFDocument.load(currentBytes, { ignoreEncryption: true });
    const oldNumPages = destDoc.getPageCount();

    // Copy all pages from source
    const indices = [];
    for (let i = 0; i < srcPageCount; i++) indices.push(i);
    const copiedPages = await destDoc.copyPages(srcDoc, indices);

    // Remove the target page
    destDoc.removePage(pageNumber - 1);

    // Insert replacement pages at the same position
    for (let i = 0; i < copiedPages.length; i++) {
      destDoc.insertPage(pageNumber - 1 + i, copiedPages[i]);
    }
    relinkCopiedPageZones(destDoc, copiedPages, doc);

    // Build page mapping
    // Pages before the replaced page: unchanged
    // The replaced page: mapped to null (deleted)
    // Pages after: shifted by (srcPageCount - 1)
    const pageMapping = {};
    for (let oldP = 1; oldP <= oldNumPages; oldP++) {
      if (oldP < pageNumber) {
        pageMapping[oldP] = oldP;
      } else if (oldP === pageNumber) {
        pageMapping[oldP] = null; // replaced page loses its annotations
      } else {
        pageMapping[oldP] = oldP + srcPageCount - 1;
      }
    }

    const newAnnotations = remapAnnotations(doc.annotations, pageMapping);
    const newRotations = remapRotations(doc.pageRotations, pageMapping);

    const newBytes = new Uint8Array(await destDoc.save());
    const targetPage = pageNumber; // Navigate to where replacement starts

    // De vervangende pagina's brengen hun eigen meetschalen mee, vanaf de
    // plek van de vervangen pagina (#400).
    const newViewports = viewportsVanPaginas(copiedPages, pageNumber);
    const inModel = await reloadFromBytes(newBytes, newAnnotations, newRotations, targetPage, { pageMapping, newViewports });

    // Record undo
    recordPageStructure(currentBytes, oldAnnotations, oldRotations, oldPage, newBytes, inModel || newAnnotations, newRotations, targetPage);
  } catch (err) {
    console.error('Failed to replace page:', err);
    showMessage(i18next.t('failedToReplacePage', { error: err.message }));
  } finally {
    hideLoading();
  }
}

/**
 * De bytes van een bronbestand om samen te voegen. Staat het bestand open in
 * de app, dan telt wat daar staat — ook annotaties en velden die nog niet
 * opgeslagen zijn — via dezelfde weg als opslaan, zonder iets weg te
 * schrijven; anders het bestand op schijf. Het bronbestand zelf verandert
 * nooit.
 */
async function bronBytesVoorSamenvoegen(filePath) {
  const { openDocumentVoorPad } = await import('./samenvoegen-model.js');
  const open = openDocumentVoorPad(state.documents, filePath);
  if (open) {
    try {
      const { bouwMomentopname } = await import('./saver.js');
      return { bytes: await bouwMomentopname(open), uitApp: true };
    } catch (e) {
      // Met een wachtwoord geopend, of de momentopname faalde: het bestand.
      console.warn('[merge] in-app state not used, reading the file instead:', e?.message || e);
    }
  }
  // Ensure the picked source file is inside the fs allowlist scope.
  try { await window.__TAURI__?.core?.invoke?.('allow_fs_scope', { path: filePath }); } catch {}
  return { bytes: new Uint8Array(await readBinaryFile(filePath)), uitApp: false };
}

/**
 * Merge external PDF files into the current document, with everything that
 * belongs to their pages: annotations, form fields, bookmarks, links and
 * named destinations, layers and page labels (samenvoegen.js). The merged
 * annotations are loaded into the model, so they show and can be edited.
 * @param {string[]} filePaths - Paths of PDF files to merge in
 * @param {'end'|'start'|'after'} position - Where to insert the merged pages
 * @returns {Promise<object>} what really happened (merge-verslag.js): the files
 *   that went in, the ones that were refused or failed, and the pages inserted.
 *   A skipped file is not an error here, so a caller that has to report (the
 *   MCP bridge) reads this instead of assuming success.
 */
export async function mergeFiles(filePaths, position) {
  if (!filePaths || filePaths.length === 0) return nieuwMergeVerslag('no-files');
  if (!isTauri()) return nieuwMergeVerslag('not-desktop');

  // Must have a document open
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return nieuwMergeVerslag('no-document');
  const verslag = nieuwMergeVerslag();

  const cacheKey = getCacheKey();
  let currentBytes = getCachedPdfBytes(cacheKey);
  if (!currentBytes && doc.filePath) {
    // Bytes may not be in the JS cache yet (e.g. a just-opened doc) — read
    // them from disk like savePDF does, so merge never silently no-ops.
    try { currentBytes = new Uint8Array(await readBinaryFile(doc.filePath)); } catch {}
  }
  if (!currentBytes) return nieuwMergeVerslag('no-bytes');
  const oldAnnotations = doc.annotations.map(a => ({ ...a }));
  const oldRotations = { ...doc.pageRotations };
  const oldPage = doc.currentPage;
  const oldBookmarks = (doc.bookmarks || []).map(b => ({ ...b }));

  showLoading('Merging PDFs...');
  try {
    const destDoc = await PDFDocument.load(currentBytes, { ignoreEncryption: true });
    const oldNumPages = destDoc.getPageCount();
    // Ingevulde velden van dit document staan alleen in pdf.js; dat document
    // gaat bij het herladen weg.
    let veldenGezet = 0;
    try {
      const { schrijfFormulierWaarden } = await import('./saver.js');
      veldenGezet = schrijfFormulierWaarden(destDoc, doc) || 0;
    } catch (e) {
      console.warn('[merge] form values not carried over:', e);
    }

    // Determine insertion index (0-based)
    let insertIdx;
    switch (position) {
      case 'start': insertIdx = 0; break;
      case 'after': insertIdx = doc.currentPage; break;
      case 'end':
      default: insertIdx = oldNumPages; break;
    }

    // Read each file; what cannot go in is reported, the rest is merged.
    const bronnen = [];
    for (const filePath of filePaths) {
      try {
        const { bytes: srcBytes, uitApp } = await bronBytesVoorSamenvoegen(filePath);
        const srcDoc = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
        const srcPageCount = srcDoc.getPageCount();

        if (srcPageCount === 0) {
          verslag.refused.push({ path: filePath, reason: REDEN_GEEN_PAGINAS });
          continue;
        }
        // Een voorbeeld van het importvenster kan inhoud missen: overslaan (#400).
        {
          const { isVoorbeeldPdf } = await import('./cad-import-logica.js');
          const { PDFName } = await import('pdf-lib');
          if (isVoorbeeldPdf(srcDoc, { PDFName })) {
            showMessage(i18next.t('previewPdfRefused'));
            verslag.refused.push({ path: filePath, reason: REDEN_VOORBEELD });
            continue;
          }
        }
        bronnen.push({ doc: srcDoc, naam: filePath.split(/[\\/]/).pop(), pad: filePath, uitApp });
      } catch (err) {
        console.error(`Failed to merge file: ${filePath}`, err);
        const fileName = filePath.split(/[\\/]/).pop();
        const detail = err?.message || String(err);
        verslag.failed.push({ path: filePath, error: detail });
        showMessage(`${i18next.t('failedToMergeFile', { file: fileName, error: detail })}\n(${detail})`);
      }
    }

    if (bronnen.length === 0) {
      return verslag;
    }

    const { voegPdfsSamen } = await import('./samenvoegen.js');
    const samen = await voegPdfsSamen(destDoc, bronnen.map(({ doc: d, naam }) => ({ doc: d, naam })), {
      invoegIndex: insertIdx, positie: position, zoneIds: zoneIdsInAnnotations(doc?.annotations),
    });
    const totalInserted = samen.paginasIngevoegd;
    for (const b of bronnen) verslag.merged.push(b.pad);
    verslag.pagesInserted = totalInserted;
    verslag.carried = samen.bronnen.map((b, i) => ({ ...b, pad: bronnen[i].pad, uitApp: bronnen[i].uitApp }));

    // Build page mapping for existing annotations/rotations
    const pageMapping = {};
    for (let oldP = 1; oldP <= oldNumPages; oldP++) {
      if (oldP <= insertIdx) {
        pageMapping[oldP] = oldP;
      } else {
        pageMapping[oldP] = oldP + totalInserted;
      }
    }

    const newAnnotations = remapAnnotations(doc.annotations, pageMapping);
    const newRotations = remapRotations(doc.pageRotations, pageMapping);

    const newBytes = new Uint8Array(await destDoc.save({ updateFieldAppearances: veldenGezet > 0 }));

    // Navigate to first merged page
    const targetPage = insertIdx + 1;

    // Meetschalen van alle samengevoegde pagina's, op hun nieuwe nummer (#400).
    const newViewports = viewportsVanPaginas(destDoc.getPages().slice(insertIdx, insertIdx + totalInserted), insertIdx + 1);
    const inModel = await reloadFromBytes(newBytes, newAnnotations, newRotations, targetPage, {
      pageMapping, newViewports, labelsUitBytes: true,
    });
    // De bladwijzers schrijft de saver uit het model: het model krijgt die van
    // het document op hun nieuwe pagina en per bestand de nieuwe bladwijzer,
    // met de bladwijzers van dat bestand eronder.
    try {
      const { loadBookmarksFromPdf } = await import('./bladwijzers-lezen.js');
      const { bladwijzersNaSamenvoegen } = await import('./samenvoegen-model.js');
      doc.bookmarks = bladwijzersNaSamenvoegen(oldBookmarks, await loadBookmarksFromPdf(doc.pdfDoc), {
        groepIndexen: samen.bladwijzerGroepen, pageMapping, invoegIndex: insertIdx, positie: position,
      });
    } catch (e) {
      console.warn('[merge] bookmarks of the merged files not added:', e);
    }

    // Record undo
    recordPageStructure(currentBytes, oldAnnotations, oldRotations, oldPage, newBytes, inModel || newAnnotations, newRotations, targetPage, {
      bookmarks: { old: oldBookmarks, new: (doc.bookmarks || []) },
    });
    try {
      const { activeTab } = await import('../solid/stores/leftPanelStore.js');
      if (activeTab() === 'bookmarks') {
        const { updateBookmarksList } = await import('../ui/panels/bookmarks.js');
        updateBookmarksList();
      }
    } catch { /* paneel niet open */ }
    return verslag;
  } finally {
    hideLoading();
  }
}
