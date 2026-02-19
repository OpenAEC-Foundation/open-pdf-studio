import { createSignal } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { PAPER_SIZES } from './NewDocDialog.jsx';
import { state } from '../../../core/state.js';
import { insertBlankPages } from '../../../pdf/page-manager.js';

export default function InsertPageDialog() {
  const [position, setPosition] = createSignal('after');
  const [count, setCount] = createSignal(1);
  const [paperSize, setPaperSize] = createSignal('current');

  async function getDimensions() {
    const size = paperSize();

    if (size === 'current') {
      const page = await state.pdfDoc.getPage(state.currentPage);
      const viewport = page.getViewport({ scale: 1 });
      return { widthPt: viewport.width, heightPt: viewport.height };
    }

    const info = PAPER_SIZES[size];
    return { widthPt: info.width, heightPt: info.height };
  }

  const close = () => closeDialog('insert-page');

  const handleOk = async () => {
    const { widthPt, heightPt } = await getDimensions();
    await insertBlankPages(position(), state.currentPage, count(), widthPt, heightPt);
    close();
  };

  const footer = (
    <div>
      <div></div>
      <div class="insert-page-footer-right">
        <button class="pref-btn pref-btn-primary" onClick={handleOk}>OK</button>
        <button class="pref-btn pref-btn-secondary" onClick={close}>Cancel</button>
      </div>
    </div>
  );

  return (
    <Dialog
      title="Insert Pages"
      overlayClass="insert-page-overlay"
      dialogClass="insert-page-dialog"
      headerClass="insert-page-header"
      bodyClass="insert-page-content"
      footerClass="insert-page-footer"
      onClose={close}
      footer={footer}
    >
      <div class="insert-page-form">
        <div class="insert-page-row">
          <label class="insert-page-label">Position:</label>
          <select
            class="insert-page-select"
            value={position()}
            onChange={(e) => setPosition(e.target.value)}
          >
            <option value="after">After current page</option>
            <option value="before">Before current page</option>
            <option value="start">At the beginning</option>
            <option value="end">At the end</option>
          </select>
        </div>
        <div class="insert-page-row">
          <label class="insert-page-label">Count:</label>
          <input
            type="number"
            class="insert-page-input"
            value={count()}
            min="1"
            max="100"
            step="1"
            onInput={(e) => setCount(Math.max(1, parseInt(e.target.value) || 1))}
          />
        </div>
        <div class="insert-page-row">
          <label class="insert-page-label">Paper Size:</label>
          <select
            class="insert-page-select"
            value={paperSize()}
            onChange={(e) => setPaperSize(e.target.value)}
          >
            <option value="current">Same as current page</option>
            <optgroup label="ISO A Series">
              <option value="a0">A0 (841 x 1189 mm)</option>
              <option value="a1">A1 (594 x 841 mm)</option>
              <option value="a2">A2 (420 x 594 mm)</option>
              <option value="a3">A3 (297 x 420 mm)</option>
              <option value="a4">A4 (210 x 297 mm)</option>
              <option value="a5">A5 (148 x 210 mm)</option>
              <option value="a6">A6 (105 x 148 mm)</option>
            </optgroup>
            <optgroup label="ISO B Series">
              <option value="b3">B3 (353 x 500 mm)</option>
              <option value="b4">B4 (250 x 353 mm)</option>
              <option value="b5">B5 (176 x 250 mm)</option>
            </optgroup>
            <optgroup label="North American">
              <option value="letter">Letter (8.5 x 11 in)</option>
              <option value="legal">Legal (8.5 x 14 in)</option>
              <option value="tabloid">Tabloid (11 x 17 in)</option>
              <option value="ledger">Ledger (17 x 11 in)</option>
            </optgroup>
          </select>
        </div>
      </div>
    </Dialog>
  );
}
