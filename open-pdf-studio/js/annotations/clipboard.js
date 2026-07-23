import { state, getActiveDocument, imageCache } from '../core/state.js';
import { cloneAnnotation } from './factory.js';
import { cloneAnnotationsInPlace } from './paste-in-place.js';
import { generateImageId } from '../utils/helpers.js';
import { updateStatusMessage } from '../ui/chrome/status-bar.js';
import { showProperties, showMultiSelectionProperties } from '../ui/panels/properties-panel.js';
import { redrawAnnotations, redrawContinuous } from './rendering.js';
import { annotationCanvas, pdfContainer } from '../ui/dom-elements.js';
import { recordAdd, recordBulkAdd } from '../core/undo-manager.js';

// Copy annotation to internal clipboard
export function copyAnnotation(annotation) {
  state.clipboardAnnotation = cloneAnnotation(annotation);
  state.clipboardAnnotations = null;
  // Reset the paste cascade so the first paste lands at source+20 and each
  // subsequent paste steps a further +20 (instead of every paste stacking on
  // the exact same spot, which made repeated Ctrl+V look like it did nothing).
  state._pasteSeq = 0;

  // Also copy image data to system clipboard so other apps can paste it
  if ((annotation.type === 'image' || annotation.type === 'signature' || annotation.type === 'stamp') && annotation.imageData) {
    try {
      const img = imageCache.get(annotation.imageId);
      if (img && img.complete) {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || annotation.width;
        canvas.height = img.naturalHeight || annotation.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (blob) {
            navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).catch(() => {});
          }
        }, 'image/png');
      }
    } catch (_) {}
  }

  updateStatusMessage('Annotation copied');
}

// Paste from clipboard (handles both images and annotations)
// Triggers a native paste so the 'paste' event handler in keyboard-handlers.js
// can read clipboardData without requiring the async Clipboard API permission.
export function pasteFromClipboard() {
  if (!getActiveDocument()?.pdfDoc) return;

  // Try triggering a native paste event which the handlePaste listener will pick up.
  // This avoids navigator.clipboard.read() which requires explicit browser permission.
  const didPaste = document.execCommand('paste');

  if (!didPaste) {
    // execCommand('paste') not supported — fall back to internal clipboard
    if (state.clipboardAnnotations && state.clipboardAnnotations.length > 1) {
      pasteAnnotations();
    } else if (state.clipboardAnnotation) {
      pasteAnnotation();
    }
  }
}

// Middelpunt van het ZICHTBARE deel van een pagina, in app-annotatie-
// coördinaten (scale = 1, oorsprong linksboven op die pagina).
//
// Plakken rekende voorheen met `pdfContainer.scrollTop/scrollLeft` opgeteld bij
// de canvas-rect. In de doorlopende weergave is die scroll document-breed: op
// pagina 5 leverde dat een y van duizenden punten op, ver buiten een pagina van
// ~842 pt — de geplakte afbeelding landde onzichtbaar naast het papier. Ook in
// enkelpagina-weergave klopte het niet bij zoom ≠ 100%, omdat CSS-pixels niet
// door de schaal werden gedeeld. Positioneren t.o.v. de pagina zelf lost beide
// op en houdt het plakken per pagina correct.
function visibleCenterOnPage(pageNum) {
  const doc = getActiveDocument();
  const scale = doc?.scale || 1;
  let canvas = annotationCanvas;
  if (doc?.viewMode === 'continuous') {
    canvas = document.querySelector(`.page-wrapper[data-page="${pageNum}"] .annotation-canvas`) || canvas;
  }
  if (!canvas?.getBoundingClientRect || !pdfContainer?.getBoundingClientRect) return null;
  const cr = canvas.getBoundingClientRect();
  const vr = pdfContainer.getBoundingClientRect();
  // Doorsnede van pagina en kijkvenster; valt de pagina buiten beeld, dan het
  // midden van de pagina zelf.
  const left = Math.max(cr.left, vr.left);
  const right = Math.min(cr.right, vr.right);
  const top = Math.max(cr.top, vr.top);
  const bottom = Math.min(cr.bottom, vr.bottom);
  const cx = right > left ? (left + right) / 2 : (cr.left + cr.right) / 2;
  const cy = bottom > top ? (top + bottom) / 2 : (cr.top + cr.bottom) / 2;
  return { x: (cx - cr.left) / scale, y: (cy - cr.top) / scale };
}

// Paste image from blob
export async function pasteImageFromBlob(blob) {
  const imageId = generateImageId();
  const url = URL.createObjectURL(blob);

  // Create image element and wait for it to load
  const img = new Image();
  img.src = url;

  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
  });

  // Convert blob URL to data URL for serialization/saving
  const dataUrl = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });

  // Store in cache
  imageCache.set(imageId, img);

  // Default annotation size — only cap when the image is REALLY huge so
  // the user isn't surprised by a paste covering the entire page. The old
  // 400px cap aggressively downscaled even modest screenshots (e.g. a
  // Revit detail at 1200×900 → 400×300), which combined with canvas
  // image-smoothing made every paste look blurry. Use 1500px instead and
  // rely on `image-smoothing-quality: 'high'` (set in rendering.js) for
  // the remaining downscale.
  let width = img.naturalWidth;
  let height = img.naturalHeight;
  const maxSize = 1500;

  if (width > maxSize || height > maxSize) {
    const ratio = Math.min(maxSize / width, maxSize / height);
    width *= ratio;
    height *= ratio;
  }

  // Plaats op de pagina die de gebruiker op dat moment bekijkt.
  const targetPage = getActiveDocument()?.currentPage || 1;
  const center = visibleCenterOnPage(targetPage);
  const x = center ? center.x - (width / 2) : 10;
  const y = center ? center.y - (height / 2) : 10;

  // Create image annotation
  const annotation = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 9),
    type: 'image',
    page: targetPage,
    x: Math.max(10, x),
    y: Math.max(10, y),
    width: width,
    height: height,
    rotation: 0,
    imageId: imageId,
    imageData: dataUrl, // data:image/... URL for PDF embedding
    originalWidth: img.naturalWidth,
    originalHeight: img.naturalHeight,
    lockAspectRatio: true, // images keep their original w:h on resize by default
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

  const _pasteDoc1 = getActiveDocument();
  if (_pasteDoc1) _pasteDoc1.annotations.push(annotation);
  recordAdd(annotation);
  if (_pasteDoc1) { _pasteDoc1.selectedAnnotation = annotation; _pasteDoc1.selectedAnnotations = [annotation]; }
  showProperties(annotation);

  if (getActiveDocument()?.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }

  updateStatusMessage('Image pasted');
}

// Paste annotation from internal clipboard
export function pasteAnnotation() {
  if (!state.clipboardAnnotation || !getActiveDocument()?.pdfDoc) return;

  const newAnnotation = cloneAnnotation(state.clipboardAnnotation);

  // Cascade each paste by an extra +20 so repeated Ctrl+V steps down-right
  // instead of stacking every copy on the same spot.
  state._pasteSeq = (state._pasteSeq || 0) + 1;
  const off = 20 * state._pasteSeq;
  if (newAnnotation.x !== undefined) newAnnotation.x += off;
  if (newAnnotation.y !== undefined) newAnnotation.y += off;
  if (newAnnotation.startX !== undefined) newAnnotation.startX += off;
  if (newAnnotation.startY !== undefined) newAnnotation.startY += off;
  if (newAnnotation.endX !== undefined) newAnnotation.endX += off;
  if (newAnnotation.endY !== undefined) newAnnotation.endY += off;
  if (newAnnotation.centerX !== undefined) newAnnotation.centerX += off;
  if (newAnnotation.centerY !== undefined) newAnnotation.centerY += off;
  if (newAnnotation.path) {
    newAnnotation.path = newAnnotation.path.map(p => ({ x: p.x + off, y: p.y + off }));
  }

  // Update page, id, and timestamps
  newAnnotation.id = Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  newAnnotation.page = getActiveDocument()?.currentPage || 1;
  newAnnotation.createdAt = new Date().toISOString();
  newAnnotation.modifiedAt = new Date().toISOString();

  // For images/signatures, need to copy the cached image
  if (newAnnotation.type === 'image' || newAnnotation.type === 'signature') {
    const newImageId = generateImageId();
    const originalImg = imageCache.get(state.clipboardAnnotation.imageId);
    if (originalImg) {
      imageCache.set(newImageId, originalImg);
    }
    newAnnotation.imageId = newImageId;
  }

  const _pasteDoc2 = getActiveDocument();
  if (_pasteDoc2) _pasteDoc2.annotations.push(newAnnotation);
  recordAdd(newAnnotation);
  if (_pasteDoc2) { _pasteDoc2.selectedAnnotation = newAnnotation; _pasteDoc2.selectedAnnotations = [newAnnotation]; }
  showProperties(newAnnotation);

  if (getActiveDocument()?.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }

  updateStatusMessage('Annotation pasted');
}

// Duplicate selected annotation
export function duplicateAnnotation() {
  const _dupDoc = getActiveDocument();
  if (!_dupDoc?.selectedAnnotation) return;

  copyAnnotation(_dupDoc.selectedAnnotation);
  pasteAnnotation();
}

// Copy multiple annotations to internal clipboard
export function copyAnnotations(annotations) {
  if (!annotations || annotations.length === 0) return;
  state.clipboardAnnotations = annotations.map(a => cloneAnnotation(a));
  state.clipboardAnnotation = state.clipboardAnnotations[0]; // backward compat
  state._pasteSeq = 0; // reset paste cascade (see copyAnnotation)
  updateStatusMessage(`${annotations.length} annotations copied`);
}

// Paste multiple annotations from internal clipboard
export function pasteAnnotations() {
  if (!state.clipboardAnnotations || state.clipboardAnnotations.length === 0) {
    if (state.clipboardAnnotation) {
      pasteAnnotation();
      return;
    }
    return;
  }

  // Cascade each paste batch by an extra +20 (see pasteAnnotation).
  state._pasteSeq = (state._pasteSeq || 0) + 1;
  const off = 20 * state._pasteSeq;
  const newAnnotations = [];
  for (const source of state.clipboardAnnotations) {
    const newAnn = cloneAnnotation(source);

    // Offset position
    if (newAnn.x !== undefined) newAnn.x += off;
    if (newAnn.y !== undefined) newAnn.y += off;
    if (newAnn.startX !== undefined) newAnn.startX += off;
    if (newAnn.startY !== undefined) newAnn.startY += off;
    if (newAnn.endX !== undefined) newAnn.endX += off;
    if (newAnn.endY !== undefined) newAnn.endY += off;
    if (newAnn.centerX !== undefined) newAnn.centerX += off;
    if (newAnn.centerY !== undefined) newAnn.centerY += off;
    if (newAnn.path) {
      newAnn.path = newAnn.path.map(p => ({ x: p.x + off, y: p.y + off }));
    }

    newAnn.id = Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    newAnn.page = getActiveDocument()?.currentPage || 1;
    newAnn.createdAt = new Date().toISOString();
    newAnn.modifiedAt = new Date().toISOString();

    if (newAnn.type === 'image' || newAnn.type === 'signature') {
      const newImageId = generateImageId();
      const originalImg = imageCache.get(source.imageId);
      if (originalImg) imageCache.set(newImageId, originalImg);
      newAnn.imageId = newImageId;
    }

    const _pasteDoc3 = getActiveDocument();
    if (_pasteDoc3) _pasteDoc3.annotations.push(newAnn);
    newAnnotations.push(newAnn);
  }

  recordBulkAdd(newAnnotations);
  const _pasteDoc3 = getActiveDocument();
  if (_pasteDoc3) {
    _pasteDoc3.selectedAnnotations = newAnnotations;
    _pasteDoc3.selectedAnnotation = newAnnotations.length > 0 ? newAnnotations[0] : null;
  }

  if (newAnnotations.length === 1) {
    showProperties(newAnnotations[0]);
  } else {
    showMultiSelectionProperties();
  }

  if (getActiveDocument()?.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }

  updateStatusMessage(`${newAnnotations.length} annotations pasted`);
}

// "Plakken op plaats" (paste in place) — GitHub issue #269.
// Plakt het interne clipboard op de HUIDIGE pagina op exact dezelfde
// coördinaten (positie, afmetingen, rotatie) als het origineel — handig om
// markeringen van de ene verdiepings-pagina op de volgende te stempelen.
// Herhaalbaar: navigeer naar de volgende pagina en plak opnieuw. De gewone
// Plakken (Ctrl+V, met +20-cascade) blijft onaangetast.
export function pasteAnnotationsInPlace() {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return;

  const sources = (state.clipboardAnnotations && state.clipboardAnnotations.length > 0)
    ? state.clipboardAnnotations
    : (state.clipboardAnnotation ? [state.clipboardAnnotation] : []);
  if (sources.length === 0) return;

  // Pure kloon-logica (testbaar in Node): nieuwe id's + huidige pagina,
  // posities exact behouden.
  const newAnnotations = cloneAnnotationsInPlace(sources, doc.currentPage || 1);

  for (let i = 0; i < newAnnotations.length; i++) {
    const newAnn = newAnnotations[i];
    // Afbeeldingen/handtekeningen refereren de gedeelde image-cache —
    // registreer per kloon een vers image-id (zelfde patroon als
    // pasteAnnotation/pasteAnnotations hierboven).
    if (newAnn.type === 'image' || newAnn.type === 'signature') {
      const newImageId = generateImageId();
      const originalImg = imageCache.get(sources[i].imageId);
      if (originalImg) imageCache.set(newImageId, originalImg);
      newAnn.imageId = newImageId;
    }
    doc.annotations.push(newAnn);
  }

  // Ongedaan maken via het bestaande undo-command-pad.
  if (newAnnotations.length === 1) {
    recordAdd(newAnnotations[0]);
  } else {
    recordBulkAdd(newAnnotations);
  }

  doc.selectedAnnotations = newAnnotations;
  doc.selectedAnnotation = newAnnotations[0];
  if (newAnnotations.length === 1) {
    showProperties(newAnnotations[0]);
  } else {
    showMultiSelectionProperties();
  }

  if (doc.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }

  updateStatusMessage(newAnnotations.length === 1
    ? 'Annotation pasted in place'
    : `${newAnnotations.length} annotations pasted in place`);
}
