import { state } from '../core/state.js';
import { updateStatusMessage } from '../ui/chrome/status-bar.js';
import { isTauri, saveFileDialog, writeBinaryFile } from '../core/platform.js';
import { render } from 'solid-js/web';
import ScreenshotOverlay from '../solid/components/ScreenshotOverlay.jsx';
import { startScreenshot, endScreenshot } from '../solid/stores/screenshotStore.js';

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

let disposeSolidOverlay = null;

function ensureOverlayMounted(container) {
  const mountId = 'screenshot-overlay-root';
  let mountEl = container.querySelector('#' + mountId);
  if (!mountEl) {
    // Dispose any previous Solid render
    if (disposeSolidOverlay) {
      disposeSolidOverlay();
      disposeSolidOverlay = null;
    }
    mountEl = document.createElement('div');
    mountEl.id = mountId;
    mountEl.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:500;';
    container.appendChild(mountEl);
    disposeSolidOverlay = render(() => ScreenshotOverlay(), mountEl);
  }
  // The overlay itself handles pointer-events via its own styles when active
  return mountEl;
}

function cleanupOverlayMount() {
  if (disposeSolidOverlay) {
    disposeSolidOverlay();
    disposeSolidOverlay = null;
  }
  const mountEl = document.getElementById('screenshot-overlay-root');
  if (mountEl) mountEl.remove();
}

export function startRegionScreenshot() {
  const canvases = getCurrentCanvases();
  if (!canvases) {
    updateStatusMessage('No PDF page to capture');
    return;
  }

  const container = canvases.container;
  container.style.position = container.style.position || 'relative';

  // Clean up any previous overlay mount in a different container
  cleanupOverlayMount();
  endScreenshot();

  ensureOverlayMounted(container);

  startScreenshot(
    container,
    async (sel) => {
      // Selection complete - crop and save
      const { left: x, top: y, width: w, height: h } = sel;

      if (w < 5 || h < 5) {
        updateStatusMessage('Selection too small');
        cleanupOverlayMount();
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

      cleanupOverlayMount();
      await copyAndSave(cropped);
    },
    () => {
      // Cancelled
      updateStatusMessage('Region screenshot cancelled');
      cleanupOverlayMount();
    }
  );
}
