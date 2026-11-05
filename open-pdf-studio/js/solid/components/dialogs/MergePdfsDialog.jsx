import { createSignal, For, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog, openDialog, showMessage } from '../../stores/dialogStore.js';
import { mergeFiles } from '../../../pdf/page-manager.js';
import { bereikTekst, leesBereik } from '../../../pdf/bron-paginas-kiezen.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function MergePdfsDialog() {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');

  const [position, setPosition] = createSignal('end');
  const [fileList, setFileList] = createSignal([]);
  const [selectedIndex, setSelectedIndex] = createSignal(-1);

  const close = () => closeDialog('merge-pdfs');

  async function addFiles() {
    const { isTauri } = await import('../../../core/platform.js');
    if (!isTauri() || !window.__TAURI__?.dialog) return;

    try {
      const result = await window.__TAURI__.dialog.open({
        multiple: true,
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
      });

      if (!result) return;
      const paths = Array.isArray(result) ? result : [result];

      const newFiles = [...fileList()];
      for (const filePath of paths) {
        if (newFiles.some(f => f.path === filePath)) continue;
        const fileName = filePath.split(/[\\/]/).pop();

        let pageCount = null;
        let signed = false;
        try {
          const { readBinaryFile } = await import('../../../core/platform.js');
          const { PDFDocument } = await import('pdf-lib');
          const data = await readBinaryFile(filePath);
          const doc = await PDFDocument.load(new Uint8Array(data), { ignoreEncryption: true });
          pageCount = doc.getPageCount();
          // Een ondertekend bestand is na samenvoegen niet meer ondertekend.
          const { telHandtekeningen } = await import('../../../pdf/samenvoegen.js');
          signed = telHandtekeningen(doc) > 0;
        } catch (e) {
          console.warn('Could not read page count for:', fileName, e);
        }

        // range: welke pagina's mee moeten ("1-3, 5"); leeg = alle (#963).
        newFiles.push({ path: filePath, name: fileName, pages: pageCount, signed, range: '' });
      }
      setFileList(newFiles);
    } catch (e) {
      console.error('Error opening file dialog:', e);
    }
  }

  function removeFile() {
    const idx = selectedIndex();
    if (idx < 0 || idx >= fileList().length) return;
    const newFiles = [...fileList()];
    newFiles.splice(idx, 1);
    setFileList(newFiles);
    if (newFiles.length === 0) {
      setSelectedIndex(-1);
    } else if (idx >= newFiles.length) {
      setSelectedIndex(newFiles.length - 1);
    }
  }

  function moveUp() {
    const idx = selectedIndex();
    if (idx <= 0) return;
    const newFiles = [...fileList()];
    [newFiles[idx - 1], newFiles[idx]] = [newFiles[idx], newFiles[idx - 1]];
    setFileList(newFiles);
    setSelectedIndex(idx - 1);
  }

  function moveDown() {
    const idx = selectedIndex();
    if (idx < 0 || idx >= fileList().length - 1) return;
    const newFiles = [...fileList()];
    [newFiles[idx], newFiles[idx + 1]] = [newFiles[idx + 1], newFiles[idx]];
    setFileList(newFiles);
    setSelectedIndex(idx + 1);
  }

  // De gekozen pagina's van een bestand (1-based), null = alle; undefined = ongeldig.
  function gekozenVan(file) {
    if (!String(file.range || '').trim() || !file.pages) return null;
    const paginas = leesBereik(file.range, file.pages);
    return paginas && paginas.length ? paginas : undefined;
  }

  function setRange(idx, range) {
    const newFiles = [...fileList()];
    if (!newFiles[idx]) return;
    newFiles[idx] = { ...newFiles[idx], range };
    setFileList(newFiles);
  }

  // Pagina's kiezen met miniaturen, in het venster van Invoegen uit bestand.
  async function choosePages(idx) {
    const file = fileList()[idx];
    if (!file?.pages) return;
    try {
      const { readBinaryFile } = await import('../../../core/platform.js');
      const bytes = new Uint8Array(await readBinaryFile(file.path));
      const huidig = gekozenVan(file);
      const paginas = await new Promise((resolve) => {
        openDialog('choose-pages', {
          bytes, naam: file.name, aantal: file.pages, doel: 'merge',
          gekozen: Array.isArray(huidig) ? huidig : null,
          onDone: resolve,
        });
      });
      if (!Array.isArray(paginas) || !paginas.length) return;
      const i = fileList().findIndex((f) => f.path === file.path);
      if (i < 0) return;
      setRange(i, paginas.length === file.pages ? '' : bereikTekst(paginas));
    } catch (e) {
      console.warn('Could not open the page chooser for:', file.name, e);
    }
  }

  function handleMerge() {
    if (fileList().length === 0) {
      showMessage(t('mergePdfs.addAtLeastOne'));
      return;
    }
    if (fileList().some((f) => gekozenVan(f) === undefined)) {
      showMessage(tCommon('invalidPageRange'));
      return;
    }
    const entries = fileList().map((f) => {
      const paginas = gekozenVan(f);
      return paginas ? { path: f.path, pages: paginas.map((p) => p - 1) } : f.path;
    });
    const pos = position();
    close();
    mergeFiles(entries, pos);
  }

  const fileCountText = () => {
    const files = fileList();
    const totalPages = files.reduce((sum, f) => {
      const paginas = gekozenVan(f);
      return sum + (Array.isArray(paginas) ? paginas.length : (f.pages || 0));
    }, 0);
    return t('mergePdfs.filesAndPages', { files: files.length, pages: totalPages });
  };

  const footer = (
    <>
      <div class="merge-pdfs-file-count">{fileCountText()}</div>
      <div class="merge-pdfs-footer-right">
        <button class="pref-btn pref-btn-primary" onClick={handleMerge}>{tCommon('merge')}</button>
        <button class="pref-btn pref-btn-secondary" onClick={close}>{tCommon('cancel')}</button>
      </div>
    </>
  );

  return (
    <Dialog
      title={t('mergePdfs.title')}
      overlayClass="merge-pdfs-overlay"
      dialogClass="merge-pdfs-dialog"
      headerClass="merge-pdfs-header"
      bodyClass="merge-pdfs-content"
      footerClass="merge-pdfs-footer"
      onClose={close}
      footer={footer}
    >
      <div class="merge-pdfs-form">
        <div class="merge-pdfs-row">
          <label class="merge-pdfs-label">{t('mergePdfs.insertAt')}</label>
          <select
            class="merge-pdfs-select"
            value={position()}
            onChange={(e) => setPosition(e.target.value)}
          >
            <option value="end">{t('mergePdfs.endOfDocument')}</option>
            <option value="after">{t('mergePdfs.afterCurrentPage')}</option>
            <option value="start">{t('mergePdfs.beginningOfDocument')}</option>
          </select>
        </div>
        <div class="merge-pdfs-file-section">
          <div class="merge-pdfs-file-toolbar">
            <span class="merge-pdfs-file-toolbar-label">{t('mergePdfs.filesToMerge')}</span>
            <div class="merge-pdfs-file-toolbar-btns">
              <button class="merge-pdfs-toolbar-btn" title={t('mergePdfs.addFiles')} onClick={addFiles}>
                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
              </button>
              <button class="merge-pdfs-toolbar-btn" title={t('mergePdfs.removeSelected')} onClick={removeFile}>
                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"/></svg>
              </button>
              <button class="merge-pdfs-toolbar-btn" title={t('mergePdfs.moveUp')} onClick={moveUp}>
                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/></svg>
              </button>
              <button class="merge-pdfs-toolbar-btn" title={t('mergePdfs.moveDown')} onClick={moveDown}>
                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
              </button>
            </div>
          </div>
          <div class="merge-pdfs-file-list">
            <Show
              when={fileList().length > 0}
              fallback={<div class="merge-pdfs-empty">{t('mergePdfs.clickToAdd')}</div>}
            >
              <For each={fileList()}>
                {(file, idx) => (
                  <div
                    class={`merge-pdfs-file-item${idx() === selectedIndex() ? ' selected' : ''}`}
                    onClick={() => setSelectedIndex(idx())}
                  >
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>
                    <span class="merge-pdfs-file-name" title={file.path}>{file.name}</span>
                    <span class="merge-pdfs-file-pages">{file.pages != null ? `${file.pages} ${t('mergePdfs.pg')}` : ''}</span>
                    <Show when={file.pages > 1}>
                      <input
                        type="text"
                        class="merge-pdfs-range"
                        classList={{ 'merge-pdfs-range-fout': gekozenVan(file) === undefined }}
                        placeholder={t('mergePdfs.allPages')}
                        title={t('mergePdfs.pageRangeTip')}
                        value={file.range || ''}
                        onClick={(e) => e.stopPropagation()}
                        onFocus={() => setSelectedIndex(idx())}
                        onChange={(e) => setRange(idx(), e.target.value)}
                      />
                      <button
                        class="merge-pdfs-range-btn"
                        title={t('mergePdfs.choosePages')}
                        onClick={(e) => { e.stopPropagation(); setSelectedIndex(idx()); choosePages(idx()); }}
                      >...</button>
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </div>
          <Show when={fileList().some(f => f.signed)}>
            <div class="merge-pdfs-warning" role="note">{t('mergePdfs.signedWarning')}</div>
          </Show>
        </div>
      </div>
    </Dialog>
  );
}
