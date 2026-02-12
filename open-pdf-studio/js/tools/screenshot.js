import { state } from '../core/state.js';
import { updateStatusMessage } from '../ui/chrome/status-bar.js';
import { isTauri, saveFileDialog, writeBinaryFile } from '../core/platform.js';

function mergeCanvases(pdfCanvasEl, annotationCanvasEl) {
  const merged = document.createElement('canvas');
  merged.width = pdfCanvasEl.width;
  merged.height = pdfCanvasEl.height;
  const ctx = merged.getContext('2d');
  // Fill with white first — canvas is transparent by default, which renders as black in PNG viewers
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, merged.width, merged.height);
  ctx.drawImage(pdfCanvasEl, 0, 0);
  ctx.drawImage(annotationCanvasEl, 0, 0);
  return merged;
}

function canvasToBlob(canvas, mimeType = 'image/png') {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType);
  });
}

function getCurrentCanvases() {
  if (state.viewMode === 'continuous') {
    const wrapper = document.querySelector(`.page-wrapper[data-page="${state.currentPage}"]`);
    if (!wrapper) return null;
    const pdfEl = wrapper.querySelector('.pdf-canvas');
    const annEl = wrapper.querySelector('.annotation-canvas');
    if (!pdfEl || !annEl) return null;
    return { pdfCanvas: pdfEl, annotationCanvas: annEl, container: wrapper.querySelector('.canvas-container') || wrapper };
  }
  const pdfEl = document.getElementById('pdf-canvas');
  const annEl = document.getElementById('annotation-canvas');
  const container = document.getElementById('canvas-container');
  if (!pdfEl || !annEl) return null;
  return { pdfCanvas: pdfEl, annotationCanvas: annEl, container };
}

async function copyAndSave(canvas) {
  const blob = await canvasToBlob(canvas, 'image/png');

  try {
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': blob })
    ]);
    updateStatusMessage('Screenshot copied to clipboard');
  } catch (e) {
    console.error('Failed to copy to clipboard:', e);
    updateStatusMessage('Failed to copy to clipboard');
  }

  if (isTauri()) {
    try {
      const savePath = await saveFileDialog(
        `screenshot-page${state.currentPage}.png`,
        [
          { name: 'PNG Image', extensions: ['png'] },
          { name: 'JPEG Image', extensions: ['jpg', 'jpeg'] }
        ]
      );

      if (savePath) {
        const ext = savePath.toLowerCase();
        const isJpeg = ext.endsWith('.jpg') || ext.endsWith('.jpeg');
        const mimeType = isJpeg ? 'image/jpeg' : 'image/png';
        const saveBlob = isJpeg ? await canvasToBlob(canvas, mimeType) : blob;
        const arrayBuffer = await saveBlob.arrayBuffer();
        await writeBinaryFile(savePath, new Uint8Array(arrayBuffer));
        updateStatusMessage(`Screenshot saved to ${savePath}`);
      }
    } catch (e) {
      console.error('Failed to save screenshot:', e);
      updateStatusMessage('Failed to save screenshot');
    }
  }
}

export async function screenshotFullPage() {
  const canvases = getCurrentCanvases();
  if (!canvases) {
    updateStatusMessage('No PDF page to capture');
    return;
  }

  const merged = mergeCanvases(canvases.pdfCanvas, canvases.annotationCanvas);
  await copyAndSave(merged);
}

function removeRegionOverlay() {
  const overlay = document.getElementById('screenshot-region-overlay');
  if (overlay) overlay.remove();
}

export function startRegionScreenshot() {
  const canvases = getCurrentCanvases();
  if (!canvases) {
    updateStatusMessage('No PDF page to capture');
    return;
  }

  removeRegionOverlay();

  const container = canvases.container;
  const overlay = document.createElement('div');
  overlay.id = 'screenshot-region-overlay';
  overlay.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 500;
    cursor: crosshair;
  `;

  const instruction = document.createElement('div');
  instruction.style.cssText = `
    position: absolute;
    top: 8px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.75);
    color: white;
    padding: 6px 14px;
    font-size: 12px;
    z-index: 501;
    pointer-events: none;
    white-space: nowrap;
  `;
  instruction.textContent = 'Click and drag to select region. Press Esc to cancel.';
  overlay.appendChild(instruction);

  const selectionRect = document.createElement('div');
  selectionRect.style.cssText = `
    position: absolute;
    border: 2px dashed #0078d7;
    background: rgba(0, 120, 215, 0.1);
    display: none;
    pointer-events: none;
  `;
  overlay.appendChild(selectionRect);

  let startX = 0, startY = 0;
  let isDragging = false;

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      cleanup();
      updateStatusMessage('Region screenshot cancelled');
    }
  }

  function cleanup() {
    removeRegionOverlay();
    document.removeEventListener('keydown', onKeyDown);
  }

  overlay.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const rect = overlay.getBoundingClientRect();
    startX = e.clientX - rect.left;
    startY = e.clientY - rect.top;
    isDragging = true;
    selectionRect.style.display = 'block';
    selectionRect.style.left = startX + 'px';
    selectionRect.style.top = startY + 'px';
    selectionRect.style.width = '0px';
    selectionRect.style.height = '0px';
  });

  overlay.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const rect = overlay.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;

    const x = Math.min(startX, currentX);
    const y = Math.min(startY, currentY);
    const w = Math.abs(currentX - startX);
    const h = Math.abs(currentY - startY);

    selectionRect.style.left = x + 'px';
    selectionRect.style.top = y + 'px';
    selectionRect.style.width = w + 'px';
    selectionRect.style.height = h + 'px';
  });

  overlay.addEventListener('mouseup', async (e) => {
    if (!isDragging) return;
    isDragging = false;

    const rect = overlay.getBoundingClientRect();
    const endX = e.clientX - rect.left;
    const endY = e.clientY - rect.top;

    const x = Math.min(startX, endX);
    const y = Math.min(startY, endY);
    const w = Math.abs(endX - startX);
    const h = Math.abs(endY - startY);

    cleanup();

    if (w < 5 || h < 5) {
      updateStatusMessage('Selection too small');
      return;
    }

    const merged = mergeCanvases(canvases.pdfCanvas, canvases.annotationCanvas);

    const scaleX = merged.width / container.offsetWidth;
    const scaleY = merged.height / container.offsetHeight;

    const cropX = Math.round(x * scaleX);
    const cropY = Math.round(y * scaleY);
    const cropW = Math.round(w * scaleX);
    const cropH = Math.round(h * scaleY);

    const cropped = document.createElement('canvas');
    cropped.width = cropW;
    cropped.height = cropH;
    const ctx = cropped.getContext('2d');
    ctx.drawImage(merged, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    await copyAndSave(cropped);
  });

  document.addEventListener('keydown', onKeyDown);
  container.style.position = container.style.position || 'relative';
  container.appendChild(overlay);
}
