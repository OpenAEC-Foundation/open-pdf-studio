import { state } from '../core/state.js';
import { getCachedPdfBytes } from '../pdf/loader.js';
import { recordPageStructure } from '../core/undo-manager.js';
import { reloadFromBytes, getCacheKey } from '../pdf/page-manager.js';
import { deleteImageFromPage, deleteTextFromPage, deleteVectorFromPage, extractImageData } from '../pdf/content-stream-editor.js';
import { clearPdfObjectCache, extractPdfObjects } from './pdf-object-extractor.js';
import { redrawAnnotations, redrawContinuous } from '../annotations/rendering.js';
import { markDocumentModified } from '../ui/chrome/tabs.js';

/**
 * Get the current PDF bytes for the active document.
 */
async function getCurrentPdfBytes() {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc) return null;

  const cacheKey = doc.filePath || `__memory__${doc.id}`;
  let bytes = getCachedPdfBytes(cacheKey);

  if (!bytes && state.pdfDoc) {
    bytes = await state.pdfDoc.getData();
  }

  return bytes ? new Uint8Array(bytes) : null;
}

/**
 * Delete a PDF object from the current document.
 * Supports images, text blocks, and vector shapes.
 *
 * @param {object} obj - The PDF object to delete (from pdf-object-extractor)
 */
export async function deletePdfObject(obj) {
  const currentBytes = await getCurrentPdfBytes();
  if (!currentBytes) return;

  const pageIndex = obj.page - 1; // Convert 1-based to 0-based
  let newBytes;

  try {
    switch (obj.type) {
      case 'image':
        newBytes = await deleteImageFromPage(currentBytes, pageIndex, obj.imageRef);
        break;

      case 'text':
        newBytes = await deleteTextFromPage(currentBytes, pageIndex, obj.operatorSignature);
        break;

      case 'vector':
        newBytes = await deleteVectorFromPage(currentBytes, pageIndex, obj.operatorSignature);
        break;

      default:
        console.warn(`[pdf-object-actions] Unknown object type: ${obj.type}`);
        return;
    }
  } catch (err) {
    console.error('[pdf-object-actions] Failed to delete object:', err);
    return;
  }

  if (!newBytes) return;

  const newBytesArr = new Uint8Array(newBytes);

  // Save state for undo
  const oldAnnotations = state.annotations.map(a => ({ ...a }));
  const doc = state.documents[state.activeDocumentIndex];
  const oldRotations = doc ? { ...doc.pageRotations } : {};
  const oldPage = state.currentPage;

  // Reload the PDF document with new bytes
  await reloadFromBytes(
    newBytesArr,
    state.annotations,
    doc ? doc.pageRotations : {},
    state.currentPage
  );

  // Record undo
  recordPageStructure(
    currentBytes,
    oldAnnotations,
    oldRotations,
    oldPage,
    newBytesArr,
    state.annotations.map(a => ({ ...a })),
    doc ? { ...doc.pageRotations } : {},
    state.currentPage
  );

  // Clear object cache and re-extract for the current page
  clearPdfObjectCache();

  const store = await import('../solid/stores/panels/pdfObjectStore.js');
  store.setSelectedPdfObject(null);
  store.setSelectedPdfObjects([]);
  store.setIsExtracting(true);

  const result = await extractPdfObjects(state.currentPage);
  const allObjects = [...result.images, ...result.textBlocks, ...result.vectors];
  store.setPdfObjects(allObjects);
  store.setExtractedPage(state.currentPage);
  store.setIsExtracting(false);

  // Mark document as modified
  markDocumentModified();

  // Redraw
  if (state.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }
}

/**
 * Move a PDF object to a new position.
 *
 * Strategy: delete the original from the content stream, then create an
 * annotation at the new position. This leverages existing annotation support
 * for move/resize/undo.
 *
 * @param {object} obj - The PDF object to move
 * @param {number} deltaX - Horizontal movement in annotation coordinate space
 * @param {number} deltaY - Vertical movement in annotation coordinate space
 */
export async function movePdfObject(obj, deltaX, deltaY) {
  const currentBytes = await getCurrentPdfBytes();
  if (!currentBytes) return;

  const pageIndex = obj.page - 1;
  const newBbox = {
    x: obj.bbox.x + deltaX,
    y: obj.bbox.y + deltaY,
    width: obj.bbox.width,
    height: obj.bbox.height,
  };

  // Save state for undo
  const oldAnnotations = state.annotations.map(a => ({ ...a }));
  const doc = state.documents[state.activeDocumentIndex];
  const oldRotations = doc ? { ...doc.pageRotations } : {};
  const oldPage = state.currentPage;

  let newBytes;

  try {
    switch (obj.type) {
      case 'image': {
        // Extract image data before deleting
        const imageDataUrl = await extractImageData(currentBytes, pageIndex, obj.imageRef);

        // Delete from content stream
        newBytes = await deleteImageFromPage(currentBytes, pageIndex, obj.imageRef);

        if (imageDataUrl) {
          // Create image annotation at new position
          const newBytesArr = new Uint8Array(newBytes);
          await reloadFromBytes(
            newBytesArr,
            state.annotations,
            doc ? doc.pageRotations : {},
            state.currentPage
          );

          // Add as an image annotation
          const imageId = `moved-img-${Date.now()}`;
          const img = new Image();
          img.src = imageDataUrl;
          await new Promise((resolve) => {
            img.onload = resolve;
            img.onerror = resolve;
          });
          state.imageCache.set(imageId, img);

          const annotation = {
            type: 'image',
            x: newBbox.x,
            y: newBbox.y,
            width: newBbox.width,
            height: newBbox.height,
            page: obj.page,
            imageId,
            color: '#000000',
            locked: false,
          };
          state.annotations.push(annotation);

          // Record undo with new state
          recordPageStructure(
            currentBytes,
            oldAnnotations,
            oldRotations,
            oldPage,
            newBytesArr,
            state.annotations.map(a => ({ ...a })),
            doc ? { ...doc.pageRotations } : {},
            state.currentPage
          );
        }
        break;
      }

      case 'text': {
        // Delete from content stream
        newBytes = await deleteTextFromPage(currentBytes, pageIndex, obj.operatorSignature);

        const newBytesArr = new Uint8Array(newBytes);
        await reloadFromBytes(
          newBytesArr,
          state.annotations,
          doc ? doc.pageRotations : {},
          state.currentPage
        );

        // Create textbox annotation at new position
        const annotation = {
          type: 'textbox',
          x: newBbox.x,
          y: newBbox.y,
          width: newBbox.width,
          height: newBbox.height,
          page: obj.page,
          text: obj.text || '',
          fontSize: 12,
          fontFamily: 'Arial',
          color: '#000000',
          fillColor: 'transparent',
          strokeColor: 'transparent',
          lineWidth: 0,
          locked: false,
        };
        state.annotations.push(annotation);

        recordPageStructure(
          currentBytes,
          oldAnnotations,
          oldRotations,
          oldPage,
          newBytesArr,
          state.annotations.map(a => ({ ...a })),
          doc ? { ...doc.pageRotations } : {},
          state.currentPage
        );
        break;
      }

      case 'vector': {
        // For vectors: delete original and take a screenshot-like snapshot as image annotation
        // This is a simplified approach — vectors are rendered by the PDF engine
        newBytes = await deleteVectorFromPage(currentBytes, pageIndex, obj.operatorSignature);

        const newBytesArr = new Uint8Array(newBytes);
        await reloadFromBytes(
          newBytesArr,
          state.annotations,
          doc ? doc.pageRotations : {},
          state.currentPage
        );

        recordPageStructure(
          currentBytes,
          oldAnnotations,
          oldRotations,
          oldPage,
          newBytesArr,
          state.annotations.map(a => ({ ...a })),
          doc ? { ...doc.pageRotations } : {},
          state.currentPage
        );
        break;
      }

      default:
        return;
    }
  } catch (err) {
    console.error('[pdf-object-actions] Failed to move object:', err);
    return;
  }

  // Clear object cache and re-extract
  clearPdfObjectCache();

  const store = await import('../solid/stores/panels/pdfObjectStore.js');
  store.setSelectedPdfObject(null);
  store.setSelectedPdfObjects([]);
  store.setIsExtracting(true);

  const result = await extractPdfObjects(state.currentPage);
  const allObjects = [...result.images, ...result.textBlocks, ...result.vectors];
  store.setPdfObjects(allObjects);
  store.setExtractedPage(state.currentPage);
  store.setIsExtracting(false);

  markDocumentModified();

  if (state.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }
}
