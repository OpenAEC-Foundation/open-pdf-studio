// Reader Mode: is the position of a closing tab worth remembering?
//
// closeTab() writes page/zoom/scroll to a sidecar next to the PDF, and the next
// open restores it - but only for a document that loads in the tab in FRONT
// (loadPDF applies it inside its "active document" block). Every other tab
// keeps the defaults of a fresh document: page 1, default zoom, scroll 0.
// Writing those on close replaces the real reading position with "page 1":
//   - a tab that was closed while its load still waited in the queue;
//   - a tab that loaded in the background (multi-file open, session restore
//     behind a document the user just opened) and was never read. Closing the
//     window closes the tabs one by one, which brings each of them to the
//     front for a moment - being shown is therefore no proof of being read.
//
// Pure: no app state in here.

/**
 * @param {object} doc - the document that is being closed
 * @returns {boolean} true when closeTab() may store its reading position
 */
export function shouldSaveReaderPosition(doc) {
  if (!doc || !doc.filePath || doc.isUntitled) return false;
  // Never loaded: there is no reading position, only the defaults.
  if (!doc.pdfDoc) return false;
  // Loaded in front: the saved position was applied (or there was none), so
  // wherever the document is now is where the user left it - page 1 included.
  if (doc._readerPositionApplied) return true;
  // Loaded behind another tab: the saved position was never applied. Only a
  // page the user moved to is newer than what the sidecar holds.
  return (doc.currentPage || 1) > 1;
}
