import { state } from '../core/state.js';
import { cloneAnnotation } from './factory.js';
import { generateImageId } from '../utils/helpers.js';
import { updateStatusMessage } from '../ui/status-bar.js';
import { showProperties } from '../ui/properties-panel.js';
import { redrawAnnotations, redrawContinuous } from './rendering.js';
import { annotationCanvas, pdfContainer } from '../ui/dom-elements.js';

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
  if (state.clipboardAnnotation) {
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

  // Update page and timestamps
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
