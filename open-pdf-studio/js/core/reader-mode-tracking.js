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
