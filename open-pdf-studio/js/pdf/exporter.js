import { state } from '../core/state.js';
import { showLoading, hideLoading } from '../ui/chrome/dialogs.js';
import { isTauri, writeBinaryFile, saveFileDialog, openFolderDialog } from '../core/platform.js';
import { renderAnnotationsForPage } from '../annotations/rendering.js';
import { getPageRotation } from '../core/state.js';
import { PDFDocument } from 'pdf-lib';

/**
 * Parse a page range string like "1-5, 8, 11-13" into an array of page numbers.
 * @param {string} rangeStr - The range string
 * @param {number} totalPages - Total number of pages in the document
 * @returns {number[]} Array of 1-based page numbers, sorted and deduplicated
 */
export function parsePageRange(rangeStr, totalPages) {
  const pages = new Set();
  const parts = rangeStr.split(',');

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const rangeParts = trimmed.split('-');
    if (rangeParts.length === 2) {
      const start = parseInt(rangeParts[0].trim(), 10);
      const end = parseInt(rangeParts[1].trim(), 10);
      if (isNaN(start) || isNaN(end)) continue;
      const lo = Math.max(1, Math.min(start, end));
      const hi = Math.min(totalPages, Math.max(start, end));
      for (let i = lo; i <= hi; i++) {
        pages.add(i);
      }
    } else {
      const num = parseInt(trimmed, 10);
      if (!isNaN(num) && num >= 1 && num <= totalPages) {
        pages.add(num);
      }
    }
  }

  return Array.from(pages).sort((a, b) => a - b);
}

/**
 * Render a single PDF page + annotations to an off-screen canvas.
 * @param {number} pageNum - 1-based page number
 * @param {number} exportScale - Scale factor (e.g. 300/72 for 300 DPI)
 * @returns {Promise<HTMLCanvasElement>} The rendered canvas
 */
export async function renderPageOffscreen(pageNum, exportScale) {
  const page = await state.pdfDoc.getPage(pageNum);
  const extraRotation = getPageRotation(pageNum);
  const viewportOpts = { scale: exportScale };
  if (extraRotation) {
    viewportOpts.rotation = (page.rotate + extraRotation) % 360;
  }
  const viewport = page.getViewport(viewportOpts);

  // Create off-screen canvas for PDF content
  const pdfCanvas = document.createElement('canvas');
  pdfCanvas.width = viewport.width;
  pdfCanvas.height = viewport.height;
  const pdfCtx = pdfCanvas.getContext('2d');

  // Render PDF page
  const renderContext = {
    canvasContext: pdfCtx,
    viewport: viewport,
    annotationMode: 0
  };

  const renderTask = page.render(renderContext);
  await renderTask.promise;

  // Create annotation canvas and render annotations
  const annCanvas = document.createElement('canvas');
  annCanvas.width = viewport.width;
  annCanvas.height = viewport.height;
  const annCtx = annCanvas.getContext('2d');

  // Temporarily override state.scale so renderAnnotationsForPage uses export scale
  const savedScale = state.documents[state.activeDocumentIndex].scale;
  state.documents[state.activeDocumentIndex].scale = exportScale;

  renderAnnotationsForPage(annCtx, pageNum, annCanvas.width, annCanvas.height);

  // Restore original scale
  state.documents[state.activeDocumentIndex].scale = savedScale;

  // Composite: draw annotations on top of PDF
  pdfCtx.drawImage(annCanvas, 0, 0);

  return pdfCanvas;
}

/**
 * Convert a canvas to a blob of the specified format.
 * @param {HTMLCanvasElement} canvas
 * @param {string} format - 'png' or 'jpeg'
 * @param {number} quality - JPEG quality (0-1)
 * @returns {Promise<Uint8Array>}
 */
export function canvasToBytes(canvas, format, quality) {
  return new Promise((resolve, reject) => {
    const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Failed to convert canvas to blob'));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(new Uint8Array(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(blob);
      },
      mimeType,
      format === 'jpeg' ? quality : undefined
    );
  });
}

/**
 * Get the base name of the current PDF (without extension).
 */
function getPdfBaseName() {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc) return 'document';
  const fileName = doc.fileName || 'document';
  return fileName.replace(/\.pdf$/i, '');
}

/**
 * Export pages as image files (PNG or JPEG).
 * @param {Object} options
 * @param {string} options.format - 'png' or 'jpeg'
 * @param {number} options.quality - JPEG quality (0-1), default 0.92
 * @param {number} options.dpi - Export resolution, default 150
 * @param {number[]} options.pages - Array of 1-based page numbers
 */
export async function exportAsImages({ format = 'png', quality = 0.92, dpi = 150, pages }) {
  if (!state.pdfDoc || !isTauri()) return;

  const ext = format === 'jpeg' ? 'jpg' : 'png';
  const exportScale = dpi / 72;
  const baseName = getPdfBaseName();

  let outputPath = null;
  let folderPath = null;

  if (pages.length === 1) {
    // Single page: save file dialog
    const defaultName = `${baseName}_page${String(pages[0]).padStart(4, '0')}.${ext}`;
    const filters = format === 'jpeg'
      ? [{ name: 'JPEG Images', extensions: ['jpg', 'jpeg'] }]
      : [{ name: 'PNG Images', extensions: ['png'] }];
    outputPath = await saveFileDialog(defaultName, filters);
    if (!outputPath) return;
  } else {
    // Multiple pages: folder dialog
    folderPath = await openFolderDialog('Select output folder for exported images');
    if (!folderPath) return;
  }

  showLoading('Exporting images...');

  try {
    for (let i = 0; i < pages.length; i++) {
      const pageNum = pages[i];
      showLoading(`Exporting page ${pageNum} of ${pages[pages.length - 1]}...`);

      const canvas = await renderPageOffscreen(pageNum, exportScale);
      const bytes = await canvasToBytes(canvas, format, quality);

      let filePath;
      if (pages.length === 1) {
        filePath = outputPath;
      } else {
        const fileName = `${baseName}_page${String(pageNum).padStart(4, '0')}.${ext}`;
        filePath = `${folderPath}\\${fileName}`;
      }

      await writeBinaryFile(filePath, bytes);
    }
  } finally {
    hideLoading();
  }
}

/**
 * Export pages as a rasterized PDF (each page is a JPEG image).
 * @param {Object} options
 * @param {number} options.dpi - Export resolution, default 300
 * @param {number[]} options.pages - Array of 1-based page numbers
 */
export async function exportAsRasterPdf({ dpi = 300, pages }) {
  if (!state.pdfDoc || !isTauri()) return;

  const baseName = getPdfBaseName();
  const defaultName = `${baseName}_raster.pdf`;

  const outputPath = await saveFileDialog(defaultName, [
    { name: 'PDF Files', extensions: ['pdf'] }
  ]);
  if (!outputPath) return;

  showLoading('Exporting raster PDF...');

  try {
    const exportScale = dpi / 72;
    const newPdf = await PDFDocument.create();

    for (let i = 0; i < pages.length; i++) {
      const pageNum = pages[i];
      showLoading(`Rasterizing page ${pageNum} of ${pages[pages.length - 1]}...`);

      const canvas = await renderPageOffscreen(pageNum, exportScale);
      const jpegBytes = await canvasToBytes(canvas, 'jpeg', 0.92);

      const jpegImage = await newPdf.embedJpg(jpegBytes);

      // Get original page dimensions (in PDF points)
      const origPage = await state.pdfDoc.getPage(pageNum);
      const extraRotation = getPageRotation(pageNum);
      const origViewportOpts = { scale: 1 };
      if (extraRotation) {
        origViewportOpts.rotation = (origPage.rotate + extraRotation) % 360;
      }
      const origViewport = origPage.getViewport(origViewportOpts);

      const page = newPdf.addPage([origViewport.width, origViewport.height]);
      page.drawImage(jpegImage, {
        x: 0,
        y: 0,
        width: origViewport.width,
        height: origViewport.height,
      });
    }

    const pdfBytes = await newPdf.save();
    await writeBinaryFile(outputPath, pdfBytes);
  } finally {
    hideLoading();
  }
}
