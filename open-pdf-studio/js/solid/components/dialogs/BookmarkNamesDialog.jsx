import { createSignal, createMemo, Index, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { getActiveDocument } from '../../../core/state.js';
import { isPdfAReadOnly } from '../../../pdf/loader.js';
import { previewBookmarkNames, bookmarksFromNames, labelsFromNames, nameSourceSnapshot } from '../../../pdf/bookmark-page-labels.js';
import { zetPaginaLabels } from '../../../pdf/pagina-labels-app.js';
import { updateBookmarksList } from '../../../ui/panels/bookmarks.js';
import { recordBookmarksChange } from '../../../core/undo-manager.js';
import { markDocumentModified } from '../../../ui/chrome/tabs.js';

export default function BookmarkNamesDialog(props) {
  const { t } = useTranslation('dialogs');
  const { t: tc } = useTranslation('common');
  const { t: tp } = useTranslation('properties');
  const doc = getActiveDocument();
  const pdf = doc?.pdfDoc;
  const source = nameSourceSnapshot(doc);
  const direction = props.data?.direction === 'bookmarks' ? 'bookmarks' : 'labels';
  const original = (doc?.bookmarks || []).map(b => ({ ...b }));
  const labels = doc?.pageLabels ? [...doc.pageLabels] : null;
  const [rows, setRows] = createSignal(previewBookmarkNames(original, labels, pdf?.numPages || 0, direction));
  const [replace, setReplace] = createSignal(false);
  const valid = createMemo(() => !!pdf && getActiveDocument() === doc && doc.pdfDoc === pdf && !isPdfAReadOnly() && nameSourceSnapshot(doc) === source);
  const title = () => direction === 'bookmarks'
    ? `${t('pageLabels.title')} → ${tp('leftPanel.bookmarks')}`
    : `${tp('leftPanel.bookmarks')} → ${t('pageLabels.title')}`;
  const close = () => closeDialog('bookmark-names');
  function apply() {
    if (!valid() || !rows().length || rows().some(row => !row.title.trim())) return;
    if (direction === 'bookmarks') {
      const next = bookmarksFromNames(original, rows(), { replace: replace() });
      if (JSON.stringify(next) !== JSON.stringify(original)) {
        doc.bookmarks = next;
        recordBookmarksChange(original, next);
        markDocumentModified(doc);
        updateBookmarksList();
      }
    } else {
      const next = labelsFromNames(labels, rows(), pdf.numPages);
      if (JSON.stringify(next) !== JSON.stringify(labels)) zetPaginaLabels(doc, next);
    }
    close();
  }
  return (
    <Dialog title={title()} dialogClass="page-labels-dialog bookmark-names-dialog" onClose={close}
      footer={<><button class="pref-btn" onClick={close}>{tc('cancel')}</button><button class="pref-btn pref-btn-primary" disabled={!valid() || !rows().length || rows().some(row => !row.title.trim())} onClick={apply}>{tc('apply')}</button></>}>
      <Show when={direction === 'bookmarks'}>
        <label class="page-labels-check"><input type="checkbox" checked={replace()} onChange={e => setReplace(e.currentTarget.checked)} />{t('bookmark.replaceAll')}</label>
      </Show>
      <Show when={!valid()}><p role="alert">{t('portfolio.errors.DOCUMENT_CHANGED')}</p></Show>
      <Show when={rows().length} fallback={<p>{tc('none')}</p>}>
        <div class="page-labels-table-wrap">
          <table class="page-labels-table">
            <thead><tr><th class="page-labels-col-page">{tc('page')}</th><th>{t('bookmark.titleLabel')}</th></tr></thead>
            <tbody><Index each={rows()}>{(row, index) => <tr>
              <td class="page-labels-col-page">{row().page}</td>
              <td><input aria-label={`${tc('page')} ${row().page}`} value={row().title} onInput={e => {
                const title = e.currentTarget.value;
                setRows(list => list.map((item, i) => i === index ? { ...item, title } : item));
              }} /></td>
            </tr>}</Index></tbody>
          </table>
        </div>
      </Show>
    </Dialog>
  );
}
