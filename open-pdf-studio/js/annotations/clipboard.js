import { state } from '../core/state.js';
import { cloneAnnotation } from './factory.js';
import { generateImageId } from '../utils/helpers.js';
import { updateStatusMessage } from '../ui/status-bar.js';
import { showProperties, showMultiSelectionProperties } from '../ui/properties-panel.js';
import { redrawAnnotations, redrawContinuous } from './rendering.js';
import { annotationCanvas, pdfContainer } from '../ui/dom-elements.js';
import { recordAdd, recordBulkAdd } from '../core/undo-manager.js';

// Copy annotation to internal clipboard
export function copyAnnotation(annotation) {
  state.clipboardAnnotation = cloneAnnotation(annotation);
  updateStatusMessage('Annotation copied');
}

// Paste from clipboard (handles both images and annotations)
export async function pasteFromClipboard() {
  if (!state.pdfDoc) return;

  try {
    // Try to read from system clipboard
    const clipboardItems = await navigator.clipboard.read();

    for (const item of clipboardItems) {
      // Check for image types
      const imageTypes = item.types.filter(type => type.startsWith('image/'));

      if (imageTypes.length > 0) {
        const imageType = imageTypes[0];
        const blob = await item.getType(imageType);
        await pasteImageFromBlob(blob);
        return;
      }
    }
  } catch (err) {
    // Clipboard API failed, check internal clipboard
  }

  // Fallback to internal clipboard for annotations
  if (state.clipboardAnnotations && state.clipboardAnnotations.length > 1) {
    pasteAnnotations();
  } else if (state.clipboardAnnotation) {
    pasteAnnotation();
  }
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

  // Store in cache
  state.imageCache.set(imageId, img);

  // Calculate position (center of visible area)
  const rect = annotationCanvas.getBoundingClientRect();
  const scrollX = pdfContainer.scrollLeft;
  const scrollY = pdfContainer.scrollTop;

  // Default size (max 400px, maintain aspect ratio)
  let width = img.naturalWidth;
  let height = img.naturalHeight;
  const maxSize = 400;

  if (width > maxSize || height > maxSize) {
    const ratio = Math.min(maxSize / width, maxSize / height);
    width *= ratio;
    height *= ratio;
  }

  const x = scrollX + (rect.width / 2) - (width / 2);
  const y = scrollY + (rect.height / 2) - (height / 2);

  // Create image annotation
  const annotation = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 9),
    type: 'image',
    page: state.currentPage,
    x: Math.max(10, x),
    y: Math.max(10, y),
    width: width,
    height: height,
    rotation: 0,
    imageId: imageId,
    imageData: url, // Keep URL for potential serialization
    originalWidth: img.naturalWidth,
    originalHeight: img.naturalHeight,
    opacity: 1,
    locked: false,
    printable: true,
    author: state.defaultAuthor,
    subject: '',
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString()
  };

  state.annotations.push(annotation);
  recordAdd(annotation);
  state.selectedAnnotation = annotation;
  showProperties(annotation);

  if (state.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }

  updateStatusMessage('Image pasted');
}

// Paste annotation from internal clipboard
export function pasteAnnotation() {
  if (!state.clipboardAnnotation || !state.pdfDoc) return;

  const newAnnotation = cloneAnnotation(state.clipboardAnnotation);

  // Offset position slightly so it's visible
  if (newAnnotation.x !== undefined) newAnnotation.x += 20;
  if (newAnnotation.y !== undefined) newAnnotation.y += 20;
  if (newAnnotation.startX !== undefined) newAnnotation.startX += 20;
  if (newAnnotation.startY !== undefined) newAnnotation.startY += 20;
  if (newAnnotation.endX !== undefined) newAnnotation.endX += 20;
  if (newAnnotation.endY !== undefined) newAnnotation.endY += 20;
  if (newAnnotation.centerX !== undefined) newAnnotation.centerX += 20;
  if (newAnnotation.centerY !== undefined) newAnnotation.centerY += 20;
  if (newAnnotation.path) {
    newAnnotation.path = newAnnotation.path.map(p => ({ x: p.x + 20, y: p.y + 20 }));
  }

  // Update page, id, and timestamps
  newAnnotation.id = Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  newAnnotation.page = state.currentPage;
  newAnnotation.createdAt = new Date().toISOString();
  newAnnotation.modifiedAt = new Date().toISOString();

  // For images, need to copy the cached image
  if (newAnnotation.type === 'image') {
    const newImageId = generateImageId();
    const originalImg = state.imageCache.get(state.clipboardAnnotation.imageId);
    if (originalImg) {
      state.imageCache.set(newImageId, originalImg);
    }
    newAnnotation.imageId = newImageId;
  }

  state.annotations.push(newAnnotation);
  recordAdd(newAnnotation);
  state.selectedAnnotation = newAnnotation;
  showProperties(newAnnotation);

  if (state.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }

  updateStatusMessage('Annotation pasted');
}

// Duplicate selected annotation
export function duplicateAnnotation() {
  if (!state.selectedAnnotation) return;

  copyAnnotation(state.selectedAnnotation);
  pasteAnnotation();
}

// Copy multiple annotations to internal clipboard
export function copyAnnotations(annotations) {
  if (!annotations || annotations.length === 0) return;
  state.clipboardAnnotations = annotations.map(a => cloneAnnotation(a));
  state.clipboardAnnotation = state.clipboardAnnotations[0]; // backward compat
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

  const newAnnotations = [];
  for (const source of state.clipboardAnnotations) {
    const newAnn = cloneAnnotation(source);

    // Offset position
    if (newAnn.x !== undefined) newAnn.x += 20;
    if (newAnn.y !== undefined) newAnn.y += 20;
    if (newAnn.startX !== undefined) newAnn.startX += 20;
    if (newAnn.startY !== undefined) newAnn.startY += 20;
    if (newAnn.endX !== undefined) newAnn.endX += 20;
    if (newAnn.endY !== undefined) newAnn.endY += 20;
    if (newAnn.centerX !== undefined) newAnn.centerX += 20;
    if (newAnn.centerY !== undefined) newAnn.centerY += 20;
    if (newAnn.path) {
      newAnn.path = newAnn.path.map(p => ({ x: p.x + 20, y: p.y + 20 }));
    }

    newAnn.id = Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    newAnn.page = state.currentPage;
    newAnn.createdAt = new Date().toISOString();
    newAnn.modifiedAt = new Date().toISOString();

    if (newAnn.type === 'image') {
      const newImageId = generateImageId();
      const originalImg = state.imageCache.get(source.imageId);
      if (originalImg) state.imageCache.set(newImageId, originalImg);
      newAnn.imageId = newImageId;
    }

    state.annotations.push(newAnn);
    newAnnotations.push(newAnn);
  }

  recordBulkAdd(newAnnotations);
  state.selectedAnnotations = newAnnotations;

  if (newAnnotations.length === 1) {
    showProperties(newAnnotations[0]);
  } else {
    showMultiSelectionProperties();
  }

  if (state.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }

  updateStatusMessage(`${newAnnotations.length} annotations pasted`);
}
