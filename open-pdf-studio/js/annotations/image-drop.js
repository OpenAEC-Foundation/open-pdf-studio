import { state, getActiveDocument, imageCache } from '../core/state.js';
import { generateImageId } from '../utils/helpers.js';
import { recordAdd } from '../core/undo-manager.js';
import { showProperties } from '../ui/panels/properties-panel.js';
import { redrawAnnotations, redrawContinuous } from './rendering.js';
import { updateStatusMessage } from '../ui/chrome/status-bar.js';
import { visibleCenterOnPage } from './clipboard.js';
import { readBinaryFile } from '../core/platform.js';
import i18next from '../i18n/config.js';

const MIME_BY_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml',
};

// (Re)load the bitmap for an image annotation from a file path into the
// image cache. Used by linked images: at link-time, on demand ("Vernieuwen")
// and after document open, so the annotation always shows the CURRENT file.
async function _loadImageFromPath(filePath) {
  // Paths restored from a saved PDF are outside the fs-plugin scope until
  // granted (same mechanism the MCP bridge uses for arbitrary paths).
  try { await window.__TAURI__?.core?.invoke('allow_fs_scope', { path: filePath }); } catch { /* best-effort */ }
  const data = await readBinaryFile(filePath);
  const ext = filePath.split('.').pop().toLowerCase();
  const blob = new Blob([data], { type: MIME_BY_EXT[ext] || 'image/png' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });
  return { img, url };
}

/**
 * Refresh a LINKED image annotation from its file (annotation.linkedPath).
 * Silent failure leaves the embedded/cached bitmap in place (e.g. when the
 * linked file moved) — the annotation stays visible.
 */
export async function refreshLinkedImage(annotation, { silent = false } = {}) {
  if (!annotation?.linkedPath) return false;
  try {
    const { img, url } = await _loadImageFromPath(annotation.linkedPath);
    if (!annotation.imageId) annotation.imageId = generateImageId();
    imageCache.set(annotation.imageId, img);
    annotation.imageData = url;
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

// Add an image file as an annotation on the current page (Tauri: reads by
// path). opts.linked: store the file PATH on the annotation so it refreshes
// from disk (gelinkte afbeelding) instead of being a one-time embed.
export async function addImageFromFile(filePath, opts = {}) {
  if (!getActiveDocument()?.pdfDoc) {
    updateStatusMessage('Open a PDF first to add images');
    return;
  }

  try {
    const { img, url } = await _loadImageFromPath(filePath);

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

    const annotation = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 9),
      type: 'image',
      page: getActiveDocument()?.currentPage || 1,
      x: Math.max(10, x),
      y: Math.max(10, y),
      width,
      height,
      rotation: 0,
      imageId,
      imageData: url,
      linkedPath: opts.linked ? filePath : undefined,
      originalWidth: img.naturalWidth,
      originalHeight: img.naturalHeight,
      lockAspectRatio: true,
      // Crop (bijsnijden) fractions per side, 0 = no crop. Present from the
      // start so property-change undo snapshots always contain the keys.
      cropLeft: 0, cropTop: 0, cropRight: 0, cropBottom: 0,
      opacity: 1,
      locked: false,
      printable: true,
      author: state.defaultAuthor,
      subject: '',
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString()
    };

    const doc = getActiveDocument();
    if (doc) doc.annotations.push(annotation);
    recordAdd(annotation);
    if (doc) { doc.selectedAnnotation = annotation; doc.selectedAnnotations = [annotation]; }
    showProperties(annotation);

    if (doc?.viewMode === 'continuous') {
      redrawContinuous();
    } else {
      redrawAnnotations();
    }

    const fileName = filePath.split(/[\\/]/).pop();
    updateStatusMessage(`Image added: ${fileName}`);
  } catch (e) {
    console.error('Failed to add image from file:', e);
    updateStatusMessage('Failed to add image');
  }
}
