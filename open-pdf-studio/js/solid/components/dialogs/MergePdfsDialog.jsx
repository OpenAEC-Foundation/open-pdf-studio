import { createSignal, For, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { mergeFiles } from '../../../pdf/page-manager.js';

export default function MergePdfsDialog() {
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
        try {
          const { readBinaryFile } = await import('../../../core/platform.js');
          const { PDFDocument } = await import('pdf-lib');
          const data = await readBinaryFile(filePath);
          const doc = await PDFDocument.load(new Uint8Array(data), { ignoreEncryption: true });
          pageCount = doc.getPageCount();
        } catch (e) {
          console.warn('Could not read page count for:', fileName, e);
        }

        newFiles.push({ path: filePath, name: fileName, pages: pageCount });
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

  function handleMerge() {
    if (fileList().length === 0) {
      alert('Please add at least one PDF file to merge.');
      return;
    }
    const paths = fileList().map(f => f.path);
    const pos = position();
    close();
    mergeFiles(paths, pos);
  }

  const fileCountText = () => {
    const files = fileList();
    const totalPages = files.reduce((sum, f) => sum + (f.pages || 0), 0);
    return `${files.length} file(s), ${totalPages} total pages`;
  };

  const footer = (
    <>
      <div class="merge-pdfs-file-count">{fileCountText()}</div>
      <div class="merge-pdfs-footer-right">
        <button class="pref-btn pref-btn-primary" onClick={handleMerge}>Merge</button>
        <button class="pref-btn pref-btn-secondary" onClick={close}>Cancel</button>
      </div>
    </>
  );

  return (
    <Dialog
      title="Merge PDFs"
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
          <label class="merge-pdfs-label">Insert at:</label>
          <select
            class="merge-pdfs-select"
            value={position()}
            onChange={(e) => setPosition(e.target.value)}
          >
            <option value="end">End of document</option>
            <option value="after">After current page</option>
            <option value="start">Beginning of document</option>
          </select>
        </div>
        <div class="merge-pdfs-file-section">
          <div class="merge-pdfs-file-toolbar">
            <span class="merge-pdfs-file-toolbar-label">Files to merge:</span>
            <div class="merge-pdfs-file-toolbar-btns">
              <button class="merge-pdfs-toolbar-btn" title="Add files" onClick={addFiles}>
                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
              </button>
              <button class="merge-pdfs-toolbar-btn" title="Remove selected" onClick={removeFile}>
                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"/></svg>
              </button>
              <button class="merge-pdfs-toolbar-btn" title="Move up" onClick={moveUp}>
                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/></svg>
              </button>
              <button class="merge-pdfs-toolbar-btn" title="Move down" onClick={moveDown}>
                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
              </button>
            </div>
          </div>
          <div class="merge-pdfs-file-list">
            <Show
              when={fileList().length > 0}
              fallback={<div class="merge-pdfs-empty">Click + to add PDF files</div>}
            >
              <For each={fileList()}>
                {(file, idx) => (
                  <div
                    class={`merge-pdfs-file-item${idx() === selectedIndex() ? ' selected' : ''}`}
                    onClick={() => setSelectedIndex(idx())}
                  >
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>
                    <span class="merge-pdfs-file-name" title={file.path}>{file.name}</span>
                    <span class="merge-pdfs-file-pages">{file.pages != null ? `${file.pages} pg` : ''}</span>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
