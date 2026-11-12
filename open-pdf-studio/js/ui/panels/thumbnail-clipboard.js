import { paginaToetsVoorInvoer } from '../../pdf/pagina-sneltoets.js';

// Called by a native listener on the thumbnail container, before the global
// annotation shortcuts. Returning false leaves unrelated keys untouched.
export function createThumbnailClipboardHandler({ getDocument, getSelection, loadManager, isReadOnly, shortcutEnabled }) {
  let busy = false;
  return function handle(e) {
    if (e.defaultPrevented || e.isComposing || paginaToetsVoorInvoer(e.target)
        || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return false;
    const key = (e.key || '').toLowerCase();
    if (key !== 'c' && key !== 'v') return false;
    const copy = key === 'c';
    if (shortcutEnabled(copy ? 'edit.copy' : 'edit.paste', copy ? 'Ctrl+C' : 'Ctrl+V') === false) return false;
    const doc = getDocument();
    if (!doc?.pdfDoc) return false;

    // Consume even an empty clipboard or blocked paste: it must never fall
    // through to pasting an unrelated annotation onto the PDF.
    e.preventDefault();
    e.stopPropagation();
    if (busy || e.repeat || (!copy && isReadOnly())) return Promise.resolve();
    const selected = [...getSelection()];
    const afterPage = selected.length ? Math.max(...selected) : doc.currentPage;
    busy = true;
    return (async () => {
      try {
        const manager = await loadManager();
        if (getDocument() !== doc || !doc.pdfDoc) return;
        if (copy) {
          if (selected.length) await manager.copyPages(selected);
        } else if (!isReadOnly() && manager.getPageClipboard()) {
          await manager.pastePage(afterPage);
        }
      } finally {
        busy = false;
      }
    })();
  };
}
