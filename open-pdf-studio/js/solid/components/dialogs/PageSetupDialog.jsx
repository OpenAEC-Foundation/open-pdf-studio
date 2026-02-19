import { createSignal, createEffect, onMount } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';

const PAGE_SETUP_SIZES = {
  a3:      { width: 297, height: 420, label: 'A3' },
  a4:      { width: 210, height: 297, label: 'A4' },
  a5:      { width: 148, height: 210, label: 'A5' },
  letter:  { width: 216, height: 279, label: 'Letter' },
  legal:   { width: 216, height: 356, label: 'Legal' },
  tabloid: { width: 279, height: 432, label: 'Tabloid' },
};

export let pageSetupSettings = {
  size: 'a4',
  source: 'auto',
  orientation: 'portrait',
  marginLeft: 25,
  marginRight: 25,
  marginTop: 25,
  marginBottom: 25,
};

export function getPageSetupSettings() {
  return { ...pageSetupSettings };
}

export default function PageSetupDialog() {
  const [size, setSize] = createSignal(pageSetupSettings.size);
  const [source, setSource] = createSignal(pageSetupSettings.source);
  const [orientation, setOrientation] = createSignal(pageSetupSettings.orientation);
  const [marginLeft, setMarginLeft] = createSignal(pageSetupSettings.marginLeft);
  const [marginRight, setMarginRight] = createSignal(pageSetupSettings.marginRight);
  const [marginTop, setMarginTop] = createSignal(pageSetupSettings.marginTop);
  const [marginBottom, setMarginBottom] = createSignal(pageSetupSettings.marginBottom);

  let canvasRef;

  function updatePreview() {
    if (!canvasRef) return;
    const ctx = canvasRef.getContext('2d');
    const sizeKey = size();
    const orient = orientation();
    const sizeData = PAGE_SETUP_SIZES[sizeKey] || PAGE_SETUP_SIZES.a4;

    let paperW = sizeData.width;
    let paperH = sizeData.height;
    if (orient === 'landscape') [paperW, paperH] = [paperH, paperW];

    const mL = parseInt(marginLeft()) || 0;
    const mR = parseInt(marginRight()) || 0;
    const mT = parseInt(marginTop()) || 0;
    const mB = parseInt(marginBottom()) || 0;

    const maxW = 160, maxH = 200;
    const scale = Math.min(maxW / paperW, maxH / paperH) * 0.85;
    const drawW = paperW * scale;
    const drawH = paperH * scale;

    canvasRef.width = maxW;
    canvasRef.height = maxH;
    ctx.clearRect(0, 0, maxW, maxH);

    const offsetX = (maxW - drawW) / 2;
    const offsetY = (maxH - drawH) / 2;

    ctx.fillStyle = '#888';
    ctx.fillRect(offsetX + 2, offsetY + 2, drawW, drawH);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(offsetX, offsetY, drawW, drawH);
    ctx.strokeStyle = '#999';
    ctx.lineWidth = 1;
    ctx.strokeRect(offsetX, offsetY, drawW, drawH);

    const cL = mL * scale, cR = mR * scale, cT = mT * scale, cB = mB * scale;
    const contentX = offsetX + cL;
    const contentY = offsetY + cT;
    const contentW = drawW - cL - cR;
    const contentH = drawH - cT - cB;

    if (contentW > 5 && contentH > 5) {
      ctx.fillStyle = '#ccc';
      const lineH = 4, lineGap = 3;
      let y = contentY + 2;
      while (y + lineH < contentY + contentH - 2) {
        const lineW = contentW * (0.6 + Math.random() * 0.35);
        ctx.fillRect(contentX + 2, y, Math.min(lineW, contentW - 4), lineH);
        y += lineH + lineGap;
      }

      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = '#bbb';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(contentX, contentY, contentW, contentH);
      ctx.setLineDash([]);
    }
  }

  onMount(() => {
    updatePreview();
  });

  createEffect(() => {
    size();
    source();
    orientation();
    marginLeft();
    marginRight();
    marginTop();
    marginBottom();
    updatePreview();
  });

  const close = () => closeDialog('page-setup');

  const applyPageSetup = () => {
    pageSetupSettings.size = size();
    pageSetupSettings.source = source();
    pageSetupSettings.orientation = orientation();
    pageSetupSettings.marginLeft = parseInt(marginLeft()) || 0;
    pageSetupSettings.marginRight = parseInt(marginRight()) || 0;
    pageSetupSettings.marginTop = parseInt(marginTop()) || 0;
    pageSetupSettings.marginBottom = parseInt(marginBottom()) || 0;
    close();
  };

  const footer = (
    <div>
      <div></div>
      <div class="page-setup-footer-right">
        <button class="pref-btn pref-btn-primary" onClick={applyPageSetup}>OK</button>
        <button class="pref-btn pref-btn-secondary" onClick={close}>Cancel</button>
      </div>
    </div>
  );

  return (
    <Dialog
      title="Page Setup"
      overlayClass="page-setup-overlay"
      dialogClass="page-setup-dialog"
      headerClass="page-setup-header"
      bodyClass="page-setup-content"
      footerClass="page-setup-footer"
      onClose={close}
      footer={footer}
    >
      <div class="page-setup-preview-box">
        <canvas ref={canvasRef} width="160" height="200"></canvas>
      </div>
      <fieldset class="page-setup-group">
        <legend>Paper</legend>
        <div class="page-setup-row">
          <label class="page-setup-label">Size:</label>
          <select
            class="page-setup-select"
            value={size()}
            onChange={(e) => setSize(e.target.value)}
          >
            <option value="a3">A3 (297 x 420 mm)</option>
            <option value="a4">A4 (210 x 297 mm)</option>
            <option value="a5">A5 (148 x 210 mm)</option>
            <option value="letter">Letter (216 x 279 mm)</option>
            <option value="legal">Legal (216 x 356 mm)</option>
            <option value="tabloid">Tabloid (279 x 432 mm)</option>
          </select>
        </div>
        <div class="page-setup-row">
          <label class="page-setup-label">Source:</label>
          <select
            class="page-setup-select"
            value={source()}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="auto">Automatically Select</option>
            <option value="tray1">Tray 1</option>
            <option value="tray2">Tray 2</option>
            <option value="manual">Manual Feed</option>
          </select>
        </div>
      </fieldset>
      <div class="page-setup-bottom">
        <fieldset class="page-setup-group page-setup-orientation-group">
          <legend>Orientation</legend>
          <label class="page-setup-radio-label">
            <input
              type="radio"
              name="page-setup-orient"
              value="portrait"
              checked={orientation() === 'portrait'}
              onChange={() => setOrientation('portrait')}
            /> Portrait
          </label>
          <label class="page-setup-radio-label">
            <input
              type="radio"
              name="page-setup-orient"
              value="landscape"
              checked={orientation() === 'landscape'}
              onChange={() => setOrientation('landscape')}
            /> Landscape
          </label>
        </fieldset>
        <fieldset class="page-setup-group page-setup-margins-group">
          <legend>Margins (millimeters)</legend>
          <div class="page-setup-margins-grid">
            <label class="page-setup-margin-label">Left:</label>
            <input
              type="number"
              class="page-setup-margin-input"
              value={marginLeft()}
              min="0"
              max="200"
              onInput={(e) => setMarginLeft(e.target.value)}
            />
            <label class="page-setup-margin-label">Right:</label>
            <input
              type="number"
              class="page-setup-margin-input"
              value={marginRight()}
              min="0"
              max="200"
              onInput={(e) => setMarginRight(e.target.value)}
            />
            <label class="page-setup-margin-label">Top:</label>
            <input
              type="number"
              class="page-setup-margin-input"
              value={marginTop()}
              min="0"
              max="200"
              onInput={(e) => setMarginTop(e.target.value)}
            />
            <label class="page-setup-margin-label">Bottom:</label>
            <input
              type="number"
              class="page-setup-margin-input"
              value={marginBottom()}
              min="0"
              max="200"
              onInput={(e) => setMarginBottom(e.target.value)}
            />
          </div>
        </fieldset>
      </div>
    </Dialog>
  );
}
