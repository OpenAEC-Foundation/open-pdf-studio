// Scanner input (#382): the app side of src-tauri/src/scanner.rs. Lists the
// scanners, acquires pages (WIA on Windows, SANE on Linux), and turns them
// into a searchable PDF in one step (scan-to-pdf.js): opened as a new,
// untitled document or inserted after the current page.

import { invoke, writeBinaryFileNew, writeBinaryFileAtomic } from '../core/platform.js';
import { state } from '../core/state.js';
import { createTab, updateWindowTitle, markDocumentModified } from '../ui/chrome/tabs.js';
import { loadDefaultOcrFontBytes } from './saver/ocr-text-layer.js';
import { scanToSearchablePdf, scanDocumentName } from './scan-to-pdf.js';

let jobCounter = 0;

/** 'wia', 'sane' or 'none' (not available on this platform). */
export async function scannerBackend() {
  try {
    return await invoke('scanner_backend');
  } catch {
    return 'none';
  }
}

/** @returns {Promise<Array<{id:string, name:string}>>} */
export function listScanners() {
  return invoke('scanner_list');
}

export function newScanJobId() {
  jobCounter += 1;
  return `scan-${Date.now()}-${jobCounter}`;
}

/**
 * Acquire pages and read them into memory; the scan folder is removed again.
 * @returns {Promise<{pages: Array<{bytes:Uint8Array, dpi:number}>, feederEmpty:boolean}>}
 */
export async function acquirePages(jobId, { deviceId, dpi, mode, source, maxPages }) {
  const got = await invoke('scanner_acquire', { jobId, deviceId, dpi, mode, source, maxPages });
  try {
    const pages = [];
    for (const path of got.pages || []) {
      const raw = await invoke('scanner_read_page', { path });
      pages.push({ bytes: new Uint8Array(raw), dpi });
    }
    return { pages, feederEmpty: !!got.feederEmpty };
  } finally {
    try { await invoke('scanner_discard', { dir: got.dir }); } catch { /* removed on the next start */ }
  }
}

export function cancelAcquire(jobId) {
  return invoke('scanner_cancel', { jobId }).catch(() => false);
}

/** A temporary PDF path in the app's private import folder. */
async function tempPdfPath() {
  const { tijdelijkPdfPad } = await import('./cad-import.js');
  return tijdelijkPdfPad(`scan-${Date.now()}.pdf`);
}

/** Open a temporary PDF as a new, untitled document (Save asks where). */
async function openAsNewDocument(path, name) {
  const [{ loadPDF }, { onthoudWerkbestand }, { fitPage }] = await Promise.all([
    import('./loader.js'), import('./document-release.js'), import('./renderer.js'),
  ]);
  try { await invoke('allow_fs_scope', { path }); } catch { /* best effort */ }
  const { index } = createTab(path);
  const doc = state.documents[index];
  if (doc) doc.isUntitled = true;
  // The temporary file belongs to this tab and goes when the tab no longer
  // needs it (document-release.js).
  onthoudWerkbestand(doc, path);
  await loadPDF(path, index);
  if (doc) doc.fileName = name;
  markDocumentModified();
  try { await fitPage(); } catch { /* fits itself later */ }
  updateWindowTitle();
  return doc;
}

/**
 * Build the (searchable) PDF from the scanned pages and put it where the user
 * chose: `destination` 'new' (a new document) or 'insert' (after the current
 * page of the active document).
 */
export async function finishScan(pages, { ocr = true, lang = 'auto', destination = 'new', onProgress, isCancelled } = {}) {
  const name = scanDocumentName();
  const { bytes, words } = await scanToSearchablePdf(pages, { ocr, lang, title: name.replace(/\.pdf$/i, '') }, {
    writeTemp: async (data) => {
      const path = await tempPdfPath();
      await writeBinaryFileNew(path, data);
      return path;
    },
    removeTemp: (path) => import('./cad-import.js').then((m) => m.ruimOp(path)),
    ocrPage: (path, pageIndex, language) => invoke('batch_ocr_page', { path, pageIndex, lang: language }),
    release: () => invoke('batch_ocr_release'),
    loadFontBytes: loadDefaultOcrFontBytes,
    onProgress,
    isCancelled,
  });
  const path = await tempPdfPath();
  await writeBinaryFileAtomic(path, bytes);
  if (destination === 'insert') {
    const { voegImportToeAanDocument } = await import('./cad-import.js');
    await voegImportToeAanDocument(path);
  } else {
    await openAsNewDocument(path, name);
  }
  return { pages: pages.length, words };
}
