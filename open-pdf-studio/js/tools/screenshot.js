import { state, getActiveDocument, imageCache } from '../core/state.js';
import { updateStatusMessage } from '../ui/chrome/status-bar.js';
import { isTauri, heeftRustRenderer, saveFileDialog, writeBinaryFile } from '../core/platform.js';
import { render } from 'solid-js/web';
import ScreenshotOverlay from '../solid/components/ScreenshotOverlay.jsx';
import { startScreenshot, endScreenshot } from '../bridge.js';
import { setLastCaptureAvailable } from '../solid/stores/screenshotStore.js';
import { openDialog } from '../solid/stores/dialogStore.js';
import { redrawAnnotations, redrawContinuous } from '../annotations/rendering.js';
import { generateImageId } from '../utils/helpers.js';
import { recordAdd } from '../core/undo-manager.js';
import { showProperties } from '../ui/panels/properties-panel.js';
import { layerForNewAnnotation } from '../annotations/annotatie-lagen.js';
import { viewportGeometrie, rectNaarPagina, normaliseerRotatie, isKwartslag } from '../pdf/weergave-rotatie.js';
import {
  paginaMaat, weergaveRotatie, weergaveRectNaarPagina,
  paginaRectNaarClient, clientRectNaarPagina, paginaOorsprong,
} from '../pdf/weergave-ruimte.js';
import i18next from '../i18n/config.js';
import { kiesPagina, schermDpi, uitvoerMaat, tegelRaster, bestandsnaam } from './screenshot-keuze.js';

// Weergave draaien (#200): een schermafdruk hoort eruit te zien zoals de
// gebruiker de pagina ziet. De scherpe render gebeurt in de paginaruimte;
// draai hem daarna over de weergaverotatie (rechtsom).
function draaiCanvas(canvas, rotatie) {
  const r = normaliseerRotatie(rotatie);
  if (!r || !canvas) return canvas;
  const uit = document.createElement('canvas');
  uit.width = isKwartslag(r) ? canvas.height : canvas.width;
  uit.height = isKwartslag(r) ? canvas.width : canvas.height;
  const ctx = uit.getContext('2d');
  ctx.translate(uit.width / 2, uit.height / 2);
  ctx.rotate((r * Math.PI) / 180);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return uit;
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
// Returns null when there is no document. Een gedraaide weergave (#200) wordt
// teruggedraaid: het resultaat staat altijd in de paginaruimte.
function _selectionToAppRect(sel, container) {
  const doc = getActiveDocument();
  if (!doc) return null;
  const vp = window.__pdfViewport;
  if (doc.viewMode !== 'continuous' && vp && vp.active && doc.filePath) {
    const g = viewportGeometrie(vp);
    const r = rectNaarPagina({
      x: (sel.left - vp.offsetX) / vp.zoom,
      y: (sel.top - vp.offsetY) / vp.zoom,
      width: sel.width / vp.zoom,
      height: sel.height / vp.zoom,
    }, g.paginaBreedte, g.paginaHoogte, g.rotatie);
    return { x: r.x, y: r.y, w: r.width, h: r.height, pageW: g.paginaBreedte, pageH: g.paginaHoogte };
  }
  // Continuous mode / legacy: the container maps 1:1 onto the (possibly
  // rotated) page at doc.scale.
  const s = doc.scale || 1.5;
  const pagina = _capturePageNum(doc);
  const r = weergaveRectNaarPagina(pagina, { x: sel.left / s, y: sel.top / s, width: sel.width / s, height: sel.height / s }, doc);
  const maat = paginaMaat(pagina, doc);
  const draai = isKwartslag(weergaveRotatie(doc));
  return {
    x: r.x,
    y: r.y,
    w: r.width,
    h: r.height,
    pageW: maat ? maat.breedte : (draai ? container.offsetHeight : container.offsetWidth) / s,
    pageH: maat ? maat.hoogte : (draai ? container.offsetWidth : container.offsetHeight) / s,
  };
}

// ─── Screenshot: select an area, render it again from the page ───────────────
// Home → Screenshot: drag a rectangle over the document view; the dialog
// (solid/components/dialogs/ScreenshotDialog.jsx) then renders that area again
// FROM THE PAGE at the chosen resolution — never by enlarging screen pixels —
// with the annotations as output (no selection frames or handles), and copies
// it to the clipboard or saves it as PNG/JPEG.
//
// One capture = one piece of one page. A selection over two pages (continuous
// view) is clipped to the page it overlaps most: every pixel then has one
// paper resolution, and the gap between the pages is not document content.
// The rules (dpi, size limits, page choice, file name) are in screenshot-keuze.js.

const TEGEL_PX = 2048; // region tiles stay well under the render worker's shared memory

/** Page rectangles on screen (client coordinates) that may hold the selection. */
function _paginasOpScherm(doc) {
  if (!doc) return [];
  const volledig = (pageNum) => {
    const m = paginaMaat(pageNum, doc);
    if (!m) return null;
    const r = paginaRectNaarClient(pageNum, { x: 0, y: 0, width: m.breedte, height: m.hoogte }, doc);
    return r && r.width > 0 && r.height > 0 ? { pageNum, rect: r } : null;
  };
  if (doc.viewMode === 'continuous') {
    const uit = [];
    for (const w of document.querySelectorAll('#continuous-container .page-wrapper[data-page]')) {
      const n = Number(w.dataset.page);
      const p = n > 0 ? volledig(n) : null;
      if (p) uit.push(p);
    }
    return uit;
  }
  const p = volledig(_capturePageNum(doc));
  return p ? [p] : [];
}

/**
 * The page area behind a selection in client coordinates, or null when the
 * selection is not on a page.
 * @returns {{doc, pageNum:number, rect:{x,y,width,height}, pageW:number, pageH:number,
 *            schermDpi:number, afgesneden:boolean} | null}  rect in page space (points)
 */
export function gebiedVanSelectie(selectie, doc = getActiveDocument()) {
  const keuze = kiesPagina(selectie, _paginasOpScherm(doc));
  if (!keuze) return null;
  const rect = clientRectNaarPagina(keuze.pageNum, keuze.rect, doc);
  const m = paginaMaat(keuze.pageNum, doc);
  if (!rect || !m || !(rect.width > 0) || !(rect.height > 0)) return null;
  const o = paginaOorsprong(keuze.pageNum, doc);
  return {
    doc,
    pageNum: keuze.pageNum,
    rect,
    pageW: m.breedte,
    pageH: m.hoogte,
    schermDpi: schermDpi(o?.schaal || 1, window.devicePixelRatio || 1),
    afgesneden: keuze.afgesneden,
  };
}

/** The whole page `pageNum` (default: the current page) as a capture area. */
export function gebiedVanPagina(doc = getActiveDocument(), pageNum = _capturePageNum(doc)) {
  const m = doc ? paginaMaat(pageNum, doc) : null;
  if (!m) return null;
  const o = paginaOorsprong(pageNum, doc);
  return {
    doc,
    pageNum,
    rect: { x: 0, y: 0, width: m.breedte, height: m.hoogte },
    pageW: m.breedte,
    pageH: m.hoogte,
    schermDpi: schermDpi(o?.schaal || _currentViewScale(doc), window.devicePixelRatio || 1),
    afgesneden: false,
  };
}

function _leesRegio(res) {
  const bytes = res instanceof Uint8Array ? res : new Uint8Array(res);
  if (!bytes || bytes.length <= 8) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, 8);
  const w = dv.getUint32(0, true);
  const h = dv.getUint32(4, true);
  if (!(w > 0) || !(h > 0) || w * h * 4 !== bytes.length - 8) return null;
  return new ImageData(new Uint8ClampedArray(bytes.buffer, bytes.byteOffset + 8, w * h * 4), w, h);
}

// The page pixels through the same region renderer as the screen (PDFium
// worker pool, or the scene engine for heavy sheets), tile by tile. Only for
// a page without a page rotation of the document: the region renderer knows
// no rotation (the PDF's own /Rotate it does handle).
async function _paginaPixelsViaRegio(gebied, schaal, breedte, hoogte) {
  const { doc, pageNum, rect } = gebied;
  if (!heeftRustRenderer() || !doc?.filePath || (Number(doc.pageRotations?.[pageNum]) || 0) !== 0) return null;
  const { invokeTileRegion } = await import('../pdf/progressive-render.js');
  const uit = document.createElement('canvas');
  uit.width = breedte;
  uit.height = hoogte;
  const ctx = uit.getContext('2d');
  const tegels = tegelRaster(breedte, hoogte, TEGEL_PX);
  for (let i = 0; i < tegels.length; i += 4) {
    await Promise.all(tegels.slice(i, i + 4).map(async (t) => {
      const beeld = _leesRegio(await invokeTileRegion({
        path: doc.filePath,
        pageIndex: pageNum - 1,
        scale: schaal,
        rotation: 0,
        regionXPt: rect.x + t.x / schaal,
        regionYPt: rect.y + t.y / schaal,
        regionWPt: t.breedte / schaal,
        regionHPt: t.hoogte / schaal,
      }, { keepWhenHidden: true }));
      if (!beeld) throw new Error('region render returned no image');
      // The renderer rounds up; keep exactly this tile's pixels.
      ctx.putImageData(beeld, t.x, t.y, 0, 0, Math.min(t.breedte, beeld.width), Math.min(t.hoogte, beeld.height));
    }));
  }
  return uit;
}

/**
 * Render a capture area at `schaal` pixels per point into a canvas of
 * `breedte` × `hoogte`, in page space (the view rotation is NOT applied).
 * Page pixels from the region renderer (desktop) or PDF.js (browser, page
 * rotated in the document, region render failed); annotations, watermarks
 * and text edits on top as output.
 */
export async function renderGebied(gebied, schaal, breedte, hoogte) {
  const { doc, pageNum, rect } = gebied;
  if (getActiveDocument() !== doc) throw new Error(i18next.t('dialogs:screenshot.documentChanged'));
  const { renderPageOffscreen, renderMarkeringenOffscreen } = await import('../pdf/exporter.js');
  const deel = { x: rect.x * schaal, y: rect.y * schaal, breedte, hoogte };

  let canvas = null;
  try {
    const pixels = await _paginaPixelsViaRegio(gebied, schaal, breedte, hoogte);
    if (pixels) {
      const ann = await renderMarkeringenOffscreen(pageNum, schaal,
        { width: gebied.pageW * schaal, height: gebied.pageH * schaal }, { deel });
      pixels.getContext('2d').drawImage(ann, 0, 0);
      canvas = pixels;
    }
  } catch (e) {
    console.warn('[screenshot] region render failed, rendering with PDF.js:', e);
    canvas = null;
  }
  if (!canvas) canvas = await renderPageOffscreen(pageNum, schaal, { deel });

  // White under everything: a transparent pixel reads as black in many viewers
  // and JPEG has no transparency.
  const uit = document.createElement('canvas');
  uit.width = canvas.width;
  uit.height = canvas.height;
  const ctx = uit.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, uit.width, uit.height);
  ctx.drawImage(canvas, 0, 0);
  return uit;
}

/**
 * Render a capture area at `dpi` as the user sees it (view rotation applied).
 * @returns {Promise<{canvas: HTMLCanvasElement, paginaCanvas: HTMLCanvasElement,
 *                    maat: ReturnType<typeof uitvoerMaat>}>}
 */
export async function renderSchermafbeelding(gebied, dpi) {
  const maat = uitvoerMaat(gebied.rect.width, gebied.rect.height, dpi);
  if (!maat) throw new Error('empty capture area');
  const paginaCanvas = await renderGebied(gebied, maat.schaal, maat.breedte, maat.hoogte);
  return { canvas: draaiCanvas(paginaCanvas, weergaveRotatie(gebied.doc)), paginaCanvas, maat };
}

/** Keep the capture for "Place as overlay" (page space, see below). */
function _bewaarVoorOverlay(gebied, paginaCanvas) {
  const r = gebied.rect;
  _storeLastCapture(paginaCanvas, { x: r.x, y: r.y, w: r.width, h: r.height }, gebied.pageNum);
}

function _blob(canvas, type, kwaliteit) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('image encoding failed'))), type, kwaliteit);
  });
}

/**
 * Copy a capture to the clipboard. Always PNG: the clipboard takes a bitmap,
 * the format choice is for files.
 */
export async function kopieerSchermafbeelding(gebied, dpi) {
  const { canvas, paginaCanvas, maat } = await renderSchermafbeelding(gebied, dpi);
  const blob = await _blob(canvas, 'image/png');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  _bewaarVoorOverlay(gebied, paginaCanvas);
  updateStatusMessage(i18next.t('dialogs:screenshot.copied', { width: maat.breedte, height: maat.hoogte, dpi: maat.dpi }));
  return maat;
}

/** Suggested save path: the document's folder (desktop) plus the file name. */
function _voorstelPad(doc, naam) {
  const pad = isTauri() ? doc?.filePath : null;
  const knip = pad ? Math.max(pad.lastIndexOf('\\'), pad.lastIndexOf('/')) : -1;
  return knip > 0 ? pad.slice(0, knip + 1) + naam : naam;
}

/**
 * Save a capture through the native save dialog. A typed extension (.png,
 * .jpg) wins over the format choice. Resolves to the path, or null when the
 * dialog was cancelled.
 */
export async function bewaarSchermafbeelding(gebied, dpi, formaat = 'png', kwaliteit = 90) {
  const doc = gebied.doc;
  const effectief = uitvoerMaat(gebied.rect.width, gebied.rect.height, dpi)?.dpi || dpi;
  const naam = bestandsnaam(doc?.fileName || doc?.filePath, gebied.pageNum, effectief, formaat);
  const t = (k) => i18next.t(`dialogs:screenshot.${k}`);
  const png = { name: t('pngFiles'), extensions: ['png'] };
  const jpg = { name: t('jpegFiles'), extensions: ['jpg', 'jpeg'] };
  let pad = await saveFileDialog(_voorstelPad(doc, naam), formaat === 'jpeg' ? [jpg, png] : [png, jpg]);
  if (!pad) return null;
  const ext = (pad.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') formaat = 'jpeg';
  else if (ext === 'png') formaat = 'png';
  else pad += formaat === 'jpeg' ? '.jpg' : '.png';

  const { canvas, paginaCanvas, maat } = await renderSchermafbeelding(gebied, dpi);
  const { canvasToBytes } = await import('../pdf/exporter.js');
  const { imageWithDpi } = await import('../pdf/image-dpi.js');
  const ruw = await canvasToBytes(canvas, formaat, Math.max(0.01, Math.min(1, kwaliteit / 100)));
  await writeBinaryFile(pad, imageWithDpi(ruw, formaat, Math.max(1, Math.min(65535, maat.dpi))));
  _bewaarVoorOverlay(gebied, paginaCanvas);
  updateStatusMessage(i18next.t('dialogs:screenshot.saved', { path: pad }));
  return pad;
}

let _overlayMount = null;
let _disposeOverlay = null;

function _ruimOverlayOp() {
  endScreenshot();
  if (_disposeOverlay) { _disposeOverlay(); _disposeOverlay = null; }
  if (_overlayMount) { _overlayMount.remove(); _overlayMount = null; }
}

/**
 * Start the area selection over the document view (#pdf-container) — the
 * whole view in every view mode, so a selection can start on any visible page.
 * @param {{ snelKopieren?: boolean }} [opties]
 *   snelKopieren: copy at screen resolution straight away, without the dialog.
 */
export function startRegionScreenshot({ snelKopieren = false } = {}) {
  const doc = getActiveDocument();
  const kader = document.getElementById('pdf-container');
  if (!doc?.pdfDoc || !kader) {
    updateStatusMessage(i18next.t('dialogs:screenshot.noPage'));
    return;
  }
  _ruimOverlayOp();
  const r = kader.getBoundingClientRect();
  const mount = document.createElement('div');
  mount.id = 'screenshot-overlay-root';
  mount.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;z-index:500;`;
  document.body.appendChild(mount);
  _overlayMount = mount;
  _disposeOverlay = render(() => ScreenshotOverlay(), mount);

  startScreenshot(
    mount,
    async (sel) => {
      const selectie = { left: sel.left + r.left, top: sel.top + r.top, width: sel.width, height: sel.height };
      _ruimOverlayOp();
      const gebied = gebiedVanSelectie(selectie, doc);
      if (!gebied) {
        updateStatusMessage(i18next.t('dialogs:screenshot.notOnPage'));
        return;
      }
      if (snelKopieren) {
        try {
          await kopieerSchermafbeelding(gebied, gebied.schermDpi);
        } catch (e) {
          console.error('[screenshot] copy failed:', e);
          updateStatusMessage(i18next.t('dialogs:screenshot.copyFailed'));
        }
        return;
      }
      openDialog('screenshot', { gebied });
    },
    () => {
      _ruimOverlayOp();
      updateStatusMessage(i18next.t('dialogs:screenshot.cancelled'));
    },
  );
}

/** The whole current page in the screenshot dialog. */
export function screenshotFullPage() {
  const gebied = gebiedVanPagina();
  if (!gebied) {
    updateStatusMessage(i18next.t('dialogs:screenshot.noPage'));
    return;
  }
  openDialog('screenshot', { gebied });
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
    // Een nieuwe markering landt op de huidige laag (#468), zoals via createAnnotation.
    const laag = layerForNewAnnotation(doc);
    if (laag) annotation.layer = laag;

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

// Shared with the Straighten Page tool (tools/straighten-select.js): the same
// canvas lookup and selection-to-page mapping the screenshot tool uses.
export { getCurrentCanvases, _selectionToAppRect as selectionToAppRect };
