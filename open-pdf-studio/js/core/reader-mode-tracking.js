// Reader Mode — the per-document tracking rules, kept free of DOM, storage
// and renderer imports so they can be unit-tested (see
// reader-mode-tracking.test.mjs). Storage lives in reader-mode.js, the glue
// to the view in pdf/reader-mode-view.js.
//
// State on the document object:
//   doc.readerModeActive  tracking is on for this document
//   doc._readerRestore    a stored position that still has to be shown to the
//                         user (set by the loader, cleared once applied). As
//                         long as it is set the document's own page/zoom say
//                         nothing about where the reader was, so closing must
//                         not overwrite the stored position with them.
//   doc._readerRestoring  a jump to the stored position is under way

const MEMORY_KEY_PREFIX = '__memory__';

/**
 * The file a reading position is keyed on, or null when this document cannot
 * be tracked (never saved, in-memory only). After an edit reload the document
 * renders from a temporary working copy (doc.filePath) while the file the
 * user opened is doc.saveTargetPath — the position belongs to the latter.
 * @param {any} doc
 * @returns {string | null}
 */
export function readerTrackingPath(doc) {
  if (!doc || doc.isUntitled) return null;
  const path = doc.saveTargetPath || doc.filePath;
  if (!path || typeof path !== 'string' || path.startsWith(MEMORY_KEY_PREFIX)) return null;
  return path;
}

/**
 * Switch tracking on or off for one document. Switching off also drops a
 * stored position that was still waiting to be shown.
 * @param {any} doc
 * @param {boolean} on
 */
export function setTracking(doc, on) {
  if (!doc) return;
  doc.readerModeActive = !!on;
  if (!on) doc._readerRestore = null;
}

/**
 * Whether closing (or exiting) should write this document's position.
 * @param {any} doc
 * @returns {boolean}
 */
export function shouldSaveReaderPosition(doc) {
  return !!doc && !!doc.readerModeActive && !doc._readerRestore && !!readerTrackingPath(doc);
}

/**
 * The position to store. `view` carries what only the visible tab knows —
 * the viewport zoom (single-page mode keeps the real zoom there, not in
 * doc.scale) and the scroll state of the page container; leave it out for a
 * document that is not in front.
 * @param {any} doc
 * @param {{zoom?: number, scrollTop?: number, scrollHeight?: number} | null} [view]
 */
export function snapshotReaderPosition(doc, view) {
  const v = view || {};
  return {
    page: doc.currentPage,
    scale: v.zoom > 0 ? v.zoom : doc.scale,
    scrollTop: v.scrollTop > 0 ? v.scrollTop : 0,
    scrollHeight: v.scrollHeight > 0 ? v.scrollHeight : 0,
    viewMode: doc.viewMode,
  };
}

/**
 * The loader found a stored position for this document: tracking resumes,
 * and the position waits until the document is on screen. Runs for every
 * load, also one that finishes in a background tab (multi-file open, session
 * restore) — there is nothing to show yet, but the document is tracked.
 * @param {any} doc
 * @param {any} saved  result of getReaderPosition(), null when nothing is stored
 * @returns {boolean} whether tracking was resumed
 */
export function resumeTracking(doc, saved) {
  if (!doc || !saved || typeof saved !== 'object') return false;
  doc.readerModeActive = true;
  doc._readerRestore = saved;
  return true;
}

/** @param {any} doc */
export function hasPendingRestore(doc) {
  return !!doc && !!doc._readerRestore;
}

/**
 * Page to jump to, clamped to the document (it may have lost pages since).
 * @param {any} saved
 * @param {number} numPages
 * @returns {number | null}
 */
export function restoredPage(saved, numPages) {
  const page = Math.floor(Number(saved?.page));
  if (!(page >= 1)) return null;
  return numPages >= 1 ? Math.min(page, numPages) : page;
}

/**
 * Scroll offset to apply, or null to leave the scroll alone. The stored
 * offset is a ratio of the container height at that time; a ratio taken in
 * continuous view (whole document) means nothing in single-page view (one
 * page) and the other way round, so it is only used within the same mode.
 * @param {any} saved
 * @param {string} viewMode      current view mode of the document
 * @param {number} scrollHeight  current height of the page container
 * @returns {number | null}
 */
export function restoredScrollTop(saved, viewMode, scrollHeight) {
  if (!saved || !(saved.scrollHeight > 0) || !(saved.scrollTop >= 0) || !(scrollHeight > 0)) return null;
  if (saved.viewMode && viewMode && saved.viewMode !== viewMode) return null;
  return (saved.scrollTop / saved.scrollHeight) * scrollHeight;
}

/**
 * Show the stored position of a document — once, and only while it is the
 * document in front: goToPage()/setZoom() act on the ACTIVE document, so
 * after every await the front document is checked again. When the user
 * switched tabs in between, the rest stays pending (and closing keeps the
 * stored position) until the document comes to the front again.
 * @param {any} doc
 * @param {{isActive: () => boolean, goToPage: (n: number) => any, setZoom: (s: number) => any,
 *          scrollHeight: () => number, setScrollTop: (top: number) => void}} io
 * @returns {Promise<boolean>} true when the position was applied
 */
export async function applyPendingRestore(doc, io) {
  const saved = doc?._readerRestore;
  if (!saved || doc._readerRestoring) return false;
  if (!doc.pdfDoc || !io.isActive()) return false;
  doc._readerRestoring = true;
  try {
    const page = restoredPage(saved, doc.pdfDoc.numPages);
    if (page && page !== doc.currentPage) {
      await io.goToPage(page);
      if (!io.isActive()) return false;
    }
    if (saved.scale > 0) {
      await io.setZoom(saved.scale);
      if (!io.isActive()) return false;
    }
    // Switched off while the jump was under way: nothing left to apply.
    if (!doc._readerRestore) return false;
    const top = restoredScrollTop(saved, doc.viewMode, io.scrollHeight());
    if (top !== null) io.setScrollTop(top);
    doc._readerRestore = null;
    return true;
  } finally {
    doc._readerRestoring = false;
  }
}
