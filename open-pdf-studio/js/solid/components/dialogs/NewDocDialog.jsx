import { createSignal, createMemo, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { createBlankPDF } from '../../../pdf/loader.js';

const PAPER_SIZES = {
  a0:      { width: 2384, height: 3370, label: 'A0', widthMm: 841, heightMm: 1189 },
  a1:      { width: 1684, height: 2384, label: 'A1', widthMm: 594, heightMm: 841 },
  a2:      { width: 1191, height: 1684, label: 'A2', widthMm: 420, heightMm: 594 },
  a3:      { width: 842,  height: 1191, label: 'A3', widthMm: 297, heightMm: 420 },
  a4:      { width: 595,  height: 842,  label: 'A4', widthMm: 210, heightMm: 297 },
  a5:      { width: 420,  height: 595,  label: 'A5', widthMm: 148, heightMm: 210 },
  a6:      { width: 298,  height: 420,  label: 'A6', widthMm: 105, heightMm: 148 },
  b3:      { width: 1001, height: 1417, label: 'B3', widthMm: 353, heightMm: 500 },
  b4:      { width: 709,  height: 1001, label: 'B4', widthMm: 250, heightMm: 353 },
  b5:      { width: 499,  height: 709,  label: 'B5', widthMm: 176, heightMm: 250 },
  letter:  { width: 612,  height: 792,  label: 'Letter', widthMm: 216, heightMm: 279 },
  legal:   { width: 612,  height: 1008, label: 'Legal', widthMm: 216, heightMm: 356 },
  tabloid: { width: 792,  height: 1224, label: 'Tabloid', widthMm: 279, heightMm: 432 },
  ledger:  { width: 1224, height: 792,  label: 'Ledger', widthMm: 432, heightMm: 279 },
};

export { PAPER_SIZES };

export default function NewDocDialog() {
  const [paperSize, setPaperSize] = createSignal('a4');
  const [orientation, setOrientation] = createSignal('portrait');
  const [numPages, setNumPages] = createSignal(1);
  const [customWidth, setCustomWidth] = createSignal(210);
  const [customHeight, setCustomHeight] = createSignal(297);

  const getDimensions = createMemo(() => {
    const size = paperSize();

    if (size === 'custom') {
      const wMm = customWidth();
      const hMm = customHeight();
      const wPt = Math.round((wMm / 25.4) * 72);
      const hPt = Math.round((hMm / 25.4) * 72);
      if (orientation() === 'landscape') {
        return { widthPt: hPt, heightPt: wPt, widthMm: hMm, heightMm: wMm, label: 'Custom' };
      }
      return { widthPt: wPt, heightPt: hPt, widthMm: wMm, heightMm: hMm, label: 'Custom' };
    }

    const info = PAPER_SIZES[size];
    if (orientation() === 'landscape') {
      return {
        widthPt: info.height,
        heightPt: info.width,
        widthMm: info.heightMm,
        heightMm: info.widthMm,
        label: info.label,
      };
    }
    return {
      widthPt: info.width,
      heightPt: info.height,
      widthMm: info.widthMm,
      heightMm: info.heightMm,
      label: info.label,
    };
  });

  const previewStyle = createMemo(() => {
    const dims = getDimensions();
    const maxW = 100;
    const maxH = 130;
    const aspect = dims.widthPt / dims.heightPt;
    let w, h;
    if (aspect > maxW / maxH) {
      w = maxW;
      h = maxW / aspect;
    } else {
      h = maxH;
      w = maxH * aspect;
    }
    return { width: Math.round(w) + 'px', height: Math.round(h) + 'px' };
  });

  const previewText = createMemo(() => {
    const dims = getDimensions();
    return `${dims.widthMm} x ${dims.heightMm} mm (${dims.label})`;
  });

  const close = () => closeDialog('new-doc');

  const handleOk = () => {
    const dims = getDimensions();
    createBlankPDF(dims.widthPt, dims.heightPt, numPages());
    close();
  };

  const footer = (
    <div>
      <div></div>
      <div class="new-doc-footer-right">
        <button class="pref-btn pref-btn-primary" onClick={handleOk}>OK</button>
        <button class="pref-btn pref-btn-secondary" onClick={close}>Cancel</button>
      </div>
    </div>
  );

  return (
    <Dialog
      title="New Document"
      overlayClass="new-doc-overlay"
      dialogClass="new-doc-dialog"
      headerClass="new-doc-header"
      bodyClass="new-doc-content"
      footerClass="new-doc-footer"
      onClose={close}
      footer={footer}
    >
      <div class="new-doc-form">
        <div class="new-doc-row">
          <label class="new-doc-label">Paper Size:</label>
          <select
            class="new-doc-select"
            value={paperSize()}
            onChange={(e) => setPaperSize(e.target.value)}
          >
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
            <optgroup label="Other">
              <option value="custom">Custom...</option>
            </optgroup>
          </select>
        </div>
        <Show when={paperSize() === 'custom'}>
          <div class="new-doc-row new-doc-custom-row">
            <label class="new-doc-label">Width (mm):</label>
            <input
              type="number"
              class="new-doc-input"
              value={customWidth()}
              min="10"
              max="5000"
              step="1"
              onInput={(e) => setCustomWidth(parseInt(e.target.value) || 10)}
            />
            <label class="new-doc-label new-doc-label-inline">Height (mm):</label>
            <input
              type="number"
              class="new-doc-input"
              value={customHeight()}
              min="10"
              max="5000"
              step="1"
              onInput={(e) => setCustomHeight(parseInt(e.target.value) || 10)}
            />
          </div>
        </Show>
        <div class="new-doc-row">
          <label class="new-doc-label">Orientation:</label>
          <div class="new-doc-radio-group">
            <label class="new-doc-radio-label">
              <input
                type="radio"
                name="new-doc-orientation"
                value="portrait"
                checked={orientation() === 'portrait'}
                onChange={() => setOrientation('portrait')}
              /> Portrait
            </label>
            <label class="new-doc-radio-label">
              <input
                type="radio"
                name="new-doc-orientation"
                value="landscape"
                checked={orientation() === 'landscape'}
                onChange={() => setOrientation('landscape')}
              /> Landscape
            </label>
          </div>
        </div>
        <div class="new-doc-row">
          <label class="new-doc-label">Pages:</label>
          <input
            type="number"
            class="new-doc-input"
            value={numPages()}
            min="1"
            max="999"
            step="1"
            onInput={(e) => setNumPages(Math.max(1, parseInt(e.target.value) || 1))}
          />
        </div>
      </div>
      <div class="new-doc-preview-area">
        <div class="new-doc-preview-box">
          <div class="new-doc-preview-page" style={previewStyle()}></div>
        </div>
        <div class="new-doc-preview-text">{previewText()}</div>
      </div>
    </Dialog>
  );
}
