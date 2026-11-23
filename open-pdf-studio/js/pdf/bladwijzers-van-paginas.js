// Bookmarks for the selected pages, named after the page (#1243).
//
// One bookmark per page, in page order, at the end of the list. The name is
// the page label when the page has one of its own, otherwise the word for
// "Page" with the page number. A page that already has a bookmark with that
// name is left alone, so doing it twice does not double the list.

import { heeftEigenLabel, labelVan } from './pagina-labels.js';
import { bookmarksFromNames } from './bookmark-page-labels.js';

/** The name a page goes by: its own label, or "<pagina> <number>". */
export function paginaNaam(labels, page, woord = 'Page') {
  const eigen = heeftEigenLabel(labels, page) ? String(labelVan(labels, page) ?? '').replace(/\s+/g, ' ').trim() : '';
  return eigen || `${woord} ${page}`;
}

/**
 * @param {object[]} bookmarks  the bookmarks of the document
 * @param {number[]} paginas    the page numbers (from 1), in any order
 * @param {{ labels?: any, aantal: number, woord?: string }} o
 * @returns {{ bookmarks: object[], toegevoegd: number }}  a new list; `bookmarks` itself is not changed
 */
export function bladwijzersVanPaginas(bookmarks, paginas, { labels = null, aantal, woord = 'Page' } = {}) {
  const lijst = Array.isArray(bookmarks) ? bookmarks : [];
  const geldig = [...new Set(paginas || [])]
    .filter((p) => Number.isInteger(p) && p >= 1 && p <= aantal)
    .sort((a, b) => a - b);
  const heeftAl = (page, title) => lijst.some((b) => b.page === page && String(b.title ?? '').trim() === title);
  const rows = geldig
    .map((page) => ({ page, title: paginaNaam(labels, page, woord), bookmarkId: null }))
    .filter((r) => !heeftAl(r.page, r.title));
  if (!rows.length) return { bookmarks: lijst, toegevoegd: 0 };
  return { bookmarks: bookmarksFromNames(lijst, rows), toegevoegd: rows.length };
}

/**
 * Add the bookmarks to the active document, as one undo step.
 * @param {number[]} paginas
 * @returns {Promise<number>} how many bookmarks were added
 */
export async function voegBladwijzersVanPaginasToe(paginas) {
  const [{ getActiveDocument }, undo, tabs, paneel, loader, i18n] = await Promise.all([
    import('../core/state.js'),
    import('../core/undo-manager.js'),
    import('../ui/chrome/tabs.js'),
    import('../ui/panels/bookmarks.js'),
    import('./loader.js'),
    import('i18next'),
  ]);
  const doc = getActiveDocument();
  if (!doc?.pdfDoc || loader.isPdfAReadOnly()) return 0;
  const t = (i18n.default || i18n).t;
  const oud = doc.bookmarks || [];
  const uit = bladwijzersVanPaginas(oud, paginas, {
    labels: doc.pageLabels || null, aantal: doc.pdfDoc.numPages, woord: t('statusbar:page', 'Page'),
  });
  if (!uit.toegevoegd) return 0;
  doc.bookmarks = uit.bookmarks;
  undo.recordBookmarksChange(oud, uit.bookmarks);
  tabs.markDocumentModified(doc);
  paneel.updateBookmarksList();
  return uit.toegevoegd;
}
