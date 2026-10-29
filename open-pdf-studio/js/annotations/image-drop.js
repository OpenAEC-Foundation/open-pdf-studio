import { state, getActiveDocument, imageCache } from '../core/state.js';
import { generateImageId } from '../utils/helpers.js';
import { recordAdd } from '../core/undo-manager.js';
import { showProperties } from '../ui/panels/properties-panel.js';
import { redrawAnnotations, redrawContinuous } from './rendering.js';
import { updateStatusMessage } from '../ui/chrome/status-bar.js';
import { visibleCenterOnPage } from './clipboard.js';
import { readBinaryFile } from '../core/platform.js';
import i18next from '../i18n/config.js';
import { layerForNewAnnotation } from './annotatie-lagen.js';
import { laadAfbeeldingBytes, AFBEELDING_EXTENSIES } from './afbeelding-bron.js';

// (Re)load the bitmap for an image annotation from a file path into the
// image cache. Used by linked images: at link-time, on demand ("Vernieuwen")
// and after document open, so the annotation always shows the CURRENT file.
// Also used by the custom stamp from an image (stamps.js, #749).
export async function laadAfbeeldingUitPad(filePath) {
  // Paths restored from a saved PDF are outside the fs-plugin scope until
  // granted (same mechanism the MCP bridge uses for arbitrary paths).
  try { await window.__TAURI__?.core?.invoke('allow_fs_scope', { path: filePath }); } catch { /* best-effort */ }
  const data = await readBinaryFile(filePath);
  if (!data) throw new Error('image file could not be read');
  // imageData moet een data:-URL zijn: de saver leest daar de bytes uit om de
  // afbeelding in de PDF te embedden (#352), en hij is PNG of JPEG, want
  // alleen die kan pdf-lib insluiten (#749). De bitmap komt uit diezelfde
  // data:-URL: een ingetrokken blob:-URL liet in WebKit alleen het kader
  // zonder afbeelding staan (#711).
  return laadAfbeeldingBytes(data, filePath);
}

/**
 * Refresh a LINKED image annotation from its file (annotation.linkedPath).
 * Silent failure leaves the embedded/cached bitmap in place (e.g. when the
 * linked file moved) — the annotation stays visible.
 */
export async function refreshLinkedImage(annotation, { silent = false } = {}) {
  if (!annotation?.linkedPath) return false;
  try {
    const { img, dataUrl } = await laadAfbeeldingUitPad(annotation.linkedPath);
    if (!annotation.imageId) annotation.imageId = generateImageId();
    imageCache.set(annotation.imageId, img);
    annotation.imageData = dataUrl;
    annotation.originalWidth = img.naturalWidth;
    annotation.originalHeight = img.naturalHeight;
    if (getActiveDocument()?.viewMode === 'continuous') redrawContinuous();
    else redrawAnnotations();
    if (!silent) updateStatusMessage(i18next.t('linkedImage.refreshed', { filename: annotation.linkedPath.split(/[\\/]/).pop() }));
    return true;
  } catch (e) {
    if (!silent) updateStatusMessage(i18next.t('linkedImage.unreadable'));
    console.warn('[linked-image] refresh failed:', annotation.linkedPath, e);
    return false;
  }
}

/** Refresh every linked image on a document (fire-and-forget after load). */
export async function refreshAllLinkedImages(doc) {
  for (const ann of doc?.annotations || []) {
    if ((ann.type === 'image' || ann.type === 'stamp') && ann.linkedPath) {
      await refreshLinkedImage(ann, { silent: true });
    }
  }
}

/**
 * Zet een geladen afbeelding als afbeeldingsannotatie in het actieve document:
 * in de lijst, in de ongedaan-maken-geschiedenis, geselecteerd en getekend.
 * Eén plek voor alles wat een afbeelding vanuit een bestand of een omzetting
 * plaatst (afbeelding invoegen, de CAD-import "als afbeelding" #400).
 * @param {HTMLImageElement} img  geladen afbeelding
 * @param {string} dataUrl        data:-URL; de saver leest daar de bytes uit
 * @param {{page:number, x:number, y:number, width:number, height:number, imageId?:string,
 *   opacity?:number, linkedPath?:string, subject?:string}} plek
 * @returns {object|null} de nieuwe annotatie
 */
export function plaatsAfbeeldingAnnotatie(img, dataUrl, plek) {
  const doc = getActiveDocument();
  if (!doc) return null;
  const imageId = plek.imageId || generateImageId();
  imageCache.set(imageId, img);
  const annotation = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 9),
    type: 'image',
    page: plek.page || doc.currentPage || 1,
    x: plek.x,
    y: plek.y,
    width: plek.width,
    height: plek.height,
    rotation: 0,
    imageId,
    imageData: dataUrl,
    linkedPath: plek.linkedPath,
    originalWidth: img.naturalWidth,
    originalHeight: img.naturalHeight,
    lockAspectRatio: true,
    // Crop (bijsnijden) fractions per side, 0 = no crop. Present from the
    // start so property-change undo snapshots always contain the keys.
    cropLeft: 0, cropTop: 0, cropRight: 0, cropBottom: 0,
    opacity: Number.isFinite(plek.opacity) ? plek.opacity : 1,
    locked: false,
    printable: true,
    author: state.defaultAuthor,
    subject: plek.subject || '',
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString()
  };
  // Een nieuwe markering landt op de huidige laag (#468), zoals via createAnnotation.
  const laag = layerForNewAnnotation(doc);
  if (laag) annotation.layer = laag;

  doc.annotations.push(annotation);
  recordAdd(annotation);
  doc.selectedAnnotation = annotation;
  doc.selectedAnnotations = [annotation];
  showProperties(annotation);

  if (doc.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }
  return annotation;
}

// Add an image file as an annotation on the current page (Tauri: reads by
// path). opts.linked: store the file PATH on the annotation so it refreshes
// from disk (gelinkte afbeelding) instead of being a one-time embed.
export async function addImageFromFile(filePath, opts = {}) {
  if (!getActiveDocument()?.pdfDoc) {
    updateStatusMessage('Open a PDF first to add images');
    return;
  }

  try {
    const { img, dataUrl } = await laadAfbeeldingUitPad(filePath);

    const imageId = generateImageId();
    imageCache.set(imageId, img);

    let width = img.naturalWidth;
    let height = img.naturalHeight;
    const maxSize = 400;
    if (width > maxSize || height > maxSize) {
      const ratio = Math.min(maxSize / width, maxSize / height);
      width *= ratio;
      height *= ratio;
    }

    // Midden van het zichtbare deel van de HUIDIGE pagina, in app-coördinaten.
    // De oude formule (scrollTop + canvas-rect van het enkelpagina-canvas)
    // rekende in de doorlopende weergave met een document-brede scroll en een
    // 0×0-canvas: de afbeelding landde duizenden punten onder de pagina,
    // onzichtbaar. Zelfde patroon-fix als plakken (clipboard.js).
    const pageNum = getActiveDocument()?.currentPage || 1;
    const center = visibleCenterOnPage(pageNum);
    const x = center ? center.x - width / 2 : 10;
    const y = center ? center.y - height / 2 : 10;

    plaatsAfbeeldingAnnotatie(img, dataUrl, {
      imageId,
      page: getActiveDocument()?.currentPage || 1,
      x: Math.max(10, x),
      y: Math.max(10, y),
      width,
      height,
      linkedPath: opts.linked ? filePath : undefined,
    });

    const fileName = filePath.split(/[\\/]/).pop();
    updateStatusMessage(`Image added: ${fileName}`);
  } catch (e) {
    console.error('Failed to add image from file:', e);
    updateStatusMessage('Failed to add image');
  }
}

/**
 * The "Image" button (Drawing tab) and "Add Image..." in the page context
 * menu: pick a file and place it on the current page, the same path as
 * dropping an image on the page. Both used to call setTool('image'), but no
 * tool named 'image' exists, so the click did nothing (#749, #711).
 */
export async function kiesEnPlaatsAfbeelding() {
  if (!getActiveDocument()?.pdfDoc) {
    updateStatusMessage('Open a PDF first to add images');
    return;
  }
  const { openFileDialog } = await import('../core/platform.js');
  const pad = await openFileDialog(AFBEELDING_EXTENSIES);
  if (!pad || typeof pad !== 'string') return;
  await addImageFromFile(pad);
}
