import { state, getActiveDocument, getPageRotation, imageCache } from '../core/state.js';
import { updateStatusMessage } from '../ui/chrome/status-bar.js';
import { isTauri, invoke, saveFileDialog, writeBinaryFile } from '../core/platform.js';
import { render } from 'solid-js/web';
import ScreenshotOverlay from '../solid/components/ScreenshotOverlay.jsx';
import { startScreenshot, endScreenshot } from '../bridge.js';
import { setLastCaptureAvailable } from '../solid/stores/screenshotStore.js';
import { renderAnnotationsForPage, redrawAnnotations, redrawContinuous } from '../annotations/rendering.js';
import { generateImageId } from '../utils/helpers.js';
import { recordAdd } from '../core/undo-manager.js';
import { showProperties } from '../ui/panels/properties-panel.js';

function mergeCanvases(pdfCanvasEl, annotationCanvasEl) {
  const merged = document.createElement('canvas');
  merged.width = pdfCanvasEl.width;
  merged.height = pdfCanvasEl.height;
  const ctx = merged.getContext('2d');
  // Fill with white first — canvas is transparent by default, which renders as black in PNG viewers
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, merged.width, merged.height);
  ctx.drawImage(pdfCanvasEl, 0, 0);
  // Doorlopende weergave: het annotatiecanvas is een viewport-uitsnede van de
  // pagina (clipX/clipY in CSS-px, backing op volle resolutie) — teken hem op
  // zijn eigen plek, geschaald naar de backing-resolutie van het paginacanvas.
  const clipX = parseFloat(annotationCanvasEl.dataset?.clipX) || 0;
  const clipY = parseFloat(annotationCanvasEl.dataset?.clipY) || 0;
  const pdfCssW = parseFloat(pdfCanvasEl.style.width) || pdfCanvasEl.width;
  const pdfCssH = parseFloat(pdfCanvasEl.style.height) || pdfCanvasEl.height;
  const annCssW = parseFloat(annotationCanvasEl.style.width) || annotationCanvasEl.width;
  const annCssH = parseFloat(annotationCanvasEl.style.height) || annotationCanvasEl.height;
  const sx = merged.width / pdfCssW;
  const sy = merged.height / pdfCssH;
  ctx.drawImage(annotationCanvasEl, clipX * sx, clipY * sy, annCssW * sx, annCssH * sy);
  return merged;
}

function canvasToBlob(canvas, mimeType = 'image/png') {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType);
  });
}

function getCurrentCanvases() {
  if (getActiveDocument()?.viewMode === 'continuous') {
    const doc = getActiveDocument();
    const wrapper = document.querySelector(`.page-wrapper[data-page="${doc ? doc.currentPage : 1}"]`);
    if (!wrapper) return null;
    const pdfEl = wrapper.querySelector('.pdf-canvas');
    const annEl = wrapper.querySelector('.annotation-canvas');
    if (!pdfEl || !annEl) return null;
    // Prefer the page's own canvas container (continuous mode uses
    // `.canvas-container-cont`). Falling back to the wrapper would offset
    // the selection by the page-number label above the canvases.
    const contContainer = wrapper.querySelector('.canvas-container-cont')
      || wrapper.querySelector('.canvas-container')
      || wrapper;
    return { pdfCanvas: pdfEl, annotationCanvas: annEl, container: contContainer };
  }
  const pdfEl = document.getElementById('pdf-canvas');
  const annEl = document.getElementById('annotation-canvas');
  const container = document.getElementById('canvas-container');
  if (!pdfEl || !annEl) return null;
  return { pdfCanvas: pdfEl, annotationCanvas: annEl, container };
}

// ─── High-resolution capture ────────────────────────────────────────────────
// The legacy path cropped the on-screen canvas, so capture quality was capped
// at the current zoom level (a zoomed-out floor plan yields a handful of
// blurry pixels). Instead, re-render ONLY the selected region through the
// existing region renderer (`render_pdf_page_region`, the same command the
// high-zoom tile path uses) at a guaranteed minimum scale, then draw the
// page's annotations on top at that same scale. The on-screen crop remains as
// fallback for in-memory documents (no backing file) or when the region
// render fails.

const CAPTURE_MIN_SCALE = 3;        // ≥3× (≈216 DPI) even when zoomed out
const CAPTURE_MAX_AXIS_PX = 4096;   // same safety cap as the render pipeline

function _currentViewScale(doc) {
  const vp = window.__pdfViewport;
  if (vp && vp.active && doc?.filePath) return vp.zoom || 1;
  return doc?.scale || 1.5;
}

// Page number whose pixels are currently on screen (viewport mode can lag
// doc.currentPage while a new page is still being extracted).
function _capturePageNum(doc) {
  const vp = window.__pdfViewport;
  if (doc?.viewMode !== 'continuous' && vp && vp.active && doc?.filePath && vp.pageNum) {
    return vp.pageNum;
  }
  return doc?.currentPage || 1;
}

// Map a selection rect (CSS px relative to `container`) to app-space
// (page points, top-left origin — the space annotations live in).
// Returns null when there is no document.
function _selectionToAppRect(sel, container) {
  const doc = getActiveDocument();
  if (!doc) return null;
  const vp = window.__pdfViewport;
  if (doc.viewMode !== 'continuous' && vp && vp.active && doc.filePath) {
    return {
      x: (sel.left - vp.offsetX) / vp.zoom,
      y: (sel.top - vp.offsetY) / vp.zoom,
      w: sel.width / vp.zoom,
      h: sel.height / vp.zoom,
      pageW: vp.pageW,
      pageH: vp.pageH,
    };
  }
  // Continuous mode / legacy: the container maps 1:1 onto the page at doc.scale.
  const s = doc.scale || 1.5;
  return {
    x: sel.left / s,
    y: sel.top / s,
    w: sel.width / s,
    h: sel.height / s,
    pageW: container.offsetWidth / s,
    pageH: container.offsetHeight / s,
  };
}

// Clamp an app-space rect to the page bounds; null when nothing remains.
function _clampAppRect(r) {
  if (!r || !(r.pageW > 0) || !(r.pageH > 0)) return null;
  const x = Math.max(0, Math.min(r.x, r.pageW));
  const y = Math.max(0, Math.min(r.y, r.pageH));
  const w = Math.min(r.w - (x - r.x), r.pageW - x);
  const h = Math.min(r.h - (y - r.y), r.pageH - y);
  if (!(w >= 1) || !(h >= 1)) return null;
  return { x, y, w, h, pageW: r.pageW, pageH: r.pageH };
}

// App-space rect covering the whole current page.
function _fullPageAppRect(container) {
  const doc = getActiveDocument();
  if (!doc) return null;
  const vp = window.__pdfViewport;
  if (doc.viewMode !== 'continuous' && vp && vp.active && doc.filePath && vp.pageW > 0 && vp.pageH > 0) {
    return { x: 0, y: 0, w: vp.pageW, h: vp.pageH, pageW: vp.pageW, pageH: vp.pageH };
  }
  const s = doc.scale || 1.5;
  const w = container.offsetWidth / s;
  const h = container.offsetHeight / s;
  if (!(w >= 1) || !(h >= 1)) return null;
  return { x: 0, y: 0, w, h, pageW: w, pageH: h };
}

// Render `appRect` of `pageNum` at high resolution: PDF pixels via the Rust
// region renderer, annotations via the shared annotation renderer at the same
// scale. Returns a canvas, or null when high-res capture is unavailable.
async function _renderRegionHighRes(pageNum, appRect) {
  const doc = getActiveDocument();
  if (!isTauri() || !doc?.filePath) return null;

  const dpr = window.devicePixelRatio || 1;
  // Never render BELOW what is on screen; guarantee a minimum for zoomed-out
  // views; stay under the canvas-axis safety cap for large selections.
  let scale = Math.max(CAPTURE_MIN_SCALE, _currentViewScale(doc) * dpr);
  scale = Math.min(scale, CAPTURE_MAX_AXIS_PX / Math.max(appRect.w, appRect.h));
  if (!isFinite(scale) || scale <= 0) return null;

  const rotation = getPageRotation(pageNum) || 0;
  const rgbaData = await invoke('render_pdf_page_region', {
    path: doc.filePath,
    pageIndex: pageNum - 1,
    scale,
    rotation,
    regionXPt: appRect.x,
    regionYPt: appRect.y,
    regionWPt: appRect.w,
    regionHPt: appRect.h,
  });
  const bytes = rgbaData instanceof Uint8Array ? rgbaData : new Uint8Array(rgbaData);
  if (!bytes || bytes.length <= 8) return null;
  const header = new DataView(bytes.buffer, bytes.byteOffset, 8);
  const w = header.getUint32(0, true);
  const h = header.getUint32(4, true);
  if (!(w > 0) || !(h > 0) || w * h * 4 !== bytes.length - 8) return null;
  const rgba = new Uint8ClampedArray(bytes.buffer, bytes.byteOffset + 8, bytes.length - 8);

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  ctx.putImageData(new ImageData(rgba, w, h), 0, 0);

  // Annotations on their own layer at the same pixel scale (the shared
  // renderer clears its target, so it cannot draw straight onto the PDF
  // pixels above). Derive the exact pixel scale from the returned bitmap —
  // the renderer may round the requested scale slightly.
  try {
    const pxScale = w / appRect.w;
    const annCanvas = document.createElement('canvas');
    annCanvas.width = w;
    annCanvas.height = h;
    const annCtx = annCanvas.getContext('2d');
    annCtx.save();
    // Shift page-origin so the crop region lands at (0,0), then let the
    // shared renderer apply its own `doc.scale × overrideDpr` transform.
    annCtx.translate(-appRect.x * pxScale, -appRect.y * pxScale);
    renderAnnotationsForPage(
      annCtx, pageNum,
      appRect.pageW * pxScale, appRect.pageH * pxScale,
      pxScale / (doc.scale || 1)
    );
    annCtx.restore();
    ctx.drawImage(annCanvas, 0, 0);
  } catch (e) {
    console.warn('[screenshot] annotation overlay failed (PDF-only capture):', e);
  }
  return out;
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
        `screenshot-page${getActiveDocument()?.currentPage || 1}.png`,
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

  // High-res render of the WHOLE page (independent of zoom level and of
  // which part happens to be visible on screen). Fallback: legacy on-screen
  // canvas merge (in-memory docs, or region render failure).
  let out = null;
  const doc = getActiveDocument();
  const pageRect = _fullPageAppRect(canvases.container);
  try {
    if (doc && pageRect) {
      out = await _renderRegionHighRes(_capturePageNum(doc), pageRect);
    }
  } catch (e) {
    console.warn('[screenshot] high-res page capture failed, using screen crop:', e);
  }
  if (!out) out = mergeCanvases(canvases.pdfCanvas, canvases.annotationCanvas);
  // A full-page capture can be overlaid on another page too (whole-floor compare).
  _storeLastCapture(out, pageRect, _capturePageNum(doc));
  await copyAndSave(out);
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

  const mountEl = ensureOverlayMounted(container);
  mountEl.style.pointerEvents = 'auto';

  startScreenshot(
    container,
    async (sel) => {
      // Selection complete - render high-res (or crop as fallback) and save
      const { left: x, top: y, width: w, height: h } = sel;

      if (w < 5 || h < 5) {
        updateStatusMessage('Selection too small');
        cleanupOverlayMount();
        return;
      }

      // Preferred path: re-render the selected region at high resolution.
      let cropped = null;
      const captureDoc = getActiveDocument();
      const capturePage = _capturePageNum(captureDoc);
      const appRect = _clampAppRect(_selectionToAppRect(sel, container));
      try {
        if (captureDoc && appRect) {
          cropped = await _renderRegionHighRes(capturePage, appRect);
        }
      } catch (e) {
        console.warn('[screenshot] high-res region capture failed, using screen crop:', e);
      }

      // Fallback: crop the on-screen pixels (in-memory docs, render failure).
      if (!cropped) {
        const merged = mergeCanvases(canvases.pdfCanvas, canvases.annotationCanvas);

        const scaleX = merged.width / container.offsetWidth;
        const scaleY = merged.height / container.offsetHeight;

        const cropX = Math.round(x * scaleX);
        const cropY = Math.round(y * scaleY);
        const cropW = Math.round(w * scaleX);
        const cropH = Math.round(h * scaleY);

        cropped = document.createElement('canvas');
        cropped.width = cropW;
        cropped.height = cropH;
        const ctx = cropped.getContext('2d');
        ctx.drawImage(merged, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
      }

      // Keep the capture around so it can be placed as an overlay
      // annotation on another page ("verdiepingen vergelijken").
      _storeLastCapture(cropped, appRect, capturePage);

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

// ─── Region capture → overlay annotation ───────────────────────────────────
// After a region screenshot the capture is kept here (bitmap + page-space
// position), so the user can navigate to ANOTHER page and stamp the capture
// there as a semi-transparent image annotation. Placed at the SAME page
// coordinates as the source selection: identical floor-plan sheets then line
// up 1:1, which is exactly the compare use-case. Opacity/tint are adjustable
// afterwards in the properties panel; placement is undoable via recordAdd.
let _lastCapture = null; // { dataUrl, pxW, pxH, x, y, w, h, pageNum }

function _storeLastCapture(canvas, appRect, pageNum) {
  try {
    _lastCapture = {
      dataUrl: canvas.toDataURL('image/png'),
      pxW: canvas.width,
      pxH: canvas.height,
      x: appRect?.x,
      y: appRect?.y,
      w: appRect?.w,
      h: appRect?.h,
      pageNum,
    };
    setLastCaptureAvailable(true);
  } catch (e) {
    console.warn('[screenshot] could not keep capture for overlay placement:', e);
  }
}

export function hasLastCapture() {
  return !!_lastCapture;
}

export async function placeLastScreenshotAsOverlay() {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) {
    updateStatusMessage('Open a PDF first to place an overlay');
    return;
  }
  if (!_lastCapture) {
    updateStatusMessage('Take a region screenshot first');
    return;
  }

  try {
    const img = new Image();
    img.src = _lastCapture.dataUrl;
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });

    const imageId = generateImageId();
    imageCache.set(imageId, img);

    // Same page-space rect as the source selection; fallback for captures
    // without position info (legacy screen-crop on in-memory docs).
    let { x, y, w, h } = _lastCapture;
    if (!(w > 0) || !(h > 0)) {
      const s = _currentViewScale(doc) * (window.devicePixelRatio || 1);
      w = _lastCapture.pxW / s;
      h = _lastCapture.pxH / s;
      x = 20;
      y = 20;
    }

    const annotation = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 9),
      type: 'image',
      page: doc.currentPage || 1,
      x,
      y,
      width: w,
      height: h,
      rotation: 0,
      imageId,
      imageData: _lastCapture.dataUrl,
      originalWidth: img.naturalWidth,
      originalHeight: img.naturalHeight,
      lockAspectRatio: true,
      // Semi-transparent by default so differences with the page underneath
      // are immediately visible; adjustable in the properties panel.
      opacity: 0.5,
      locked: false,
      printable: true,
      author: state.defaultAuthor,
      subject: '',
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    };

    doc.annotations.push(annotation);
    recordAdd(annotation);
    doc.selectedAnnotation = annotation;
    doc.selectedAnnotations = [annotation];
    showProperties(annotation);

    if (doc.viewMode === 'continuous') redrawContinuous();
    else redrawAnnotations();

    updateStatusMessage('Screenshot placed as overlay — adjust opacity and tint in the properties panel');
  } catch (e) {
    console.error('[screenshot] overlay placement failed:', e);
    updateStatusMessage('Failed to place overlay');
  }
}
