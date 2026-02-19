import { createSignal } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { parsePageRange } from '../../../pdf/exporter.js';
import { extractPages } from '../../../pdf/page-manager.js';

export default function ExtractPagesDialog(props) {
  const currentPage = props.data?.currentPage || 1;
  const totalPages = props.data?.totalPages || 1;

  const [pageRange, setPageRange] = createSignal(String(currentPage));
  const [deleteAfter, setDeleteAfter] = createSignal(false);

  const close = () => closeDialog('extract-pages');

  const handleExtract = () => {
    const pages = parsePageRange(pageRange(), totalPages);
    if (pages.length === 0) {
      alert('Invalid page range. Please enter valid page numbers.');
      return;
    }
    close();
    extractPages(pages, deleteAfter());
  };

  const footer = (
    <>
      <div></div>
      <div class="extract-pages-footer-right">
        <button class="pref-btn pref-btn-primary" onClick={handleExtract}>Extract</button>
        <button class="pref-btn pref-btn-secondary" onClick={close}>Cancel</button>
      </div>
    </>
  );

  return (
    <Dialog
      title="Extract Pages"
      overlayClass="extract-pages-overlay"
      dialogClass="extract-pages-dialog"
      headerClass="extract-pages-header"
      bodyClass="extract-pages-content"
      footerClass="extract-pages-footer"
      onClose={close}
      footer={footer}
    >
      <div class="extract-pages-form">
        <div class="extract-pages-row">
          <label class="extract-pages-label">Page Range:</label>
          <input
            type="text"
            class="extract-pages-input-wide"
            placeholder="e.g. 1-3, 5, 8-10"
            value={pageRange()}
            onInput={(e) => setPageRange(e.target.value)}
          />
        </div>
        <div class="extract-pages-row extract-pages-info">
          {`Document has ${totalPages} pages.`}
        </div>
        <div class="extract-pages-row extract-pages-checkbox-row">
          <label class="extract-pages-checkbox-label">
            <input
              type="checkbox"
              checked={deleteAfter()}
              onChange={(e) => setDeleteAfter(e.target.checked)}
            /> Delete pages from source after extraction
          </label>
        </div>
      </div>
    </Dialog>
  );
}
