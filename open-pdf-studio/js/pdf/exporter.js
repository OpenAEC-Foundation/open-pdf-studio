import { state, getActiveDocument, getAnnotationBounds } from '../core/state.js';
import { showLoading, hideLoading } from '../ui/chrome/dialogs.js';
import { isTauri, writeBinaryFile, saveFileDialog, openFolderDialog } from '../core/platform.js';
import { renderAnnotationsForPage, drawAnnotation } from '../annotations/rendering.js';
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
 * @param {{ deel?: {x:number, y:number, breedte:number, hoogte:number}|null,
 *           markeringen?: boolean }} [opties]
 *   deel: render only this part of the page, in whole pixels of the page
 *   rendered at `exportScale` (the print dialog renders just what lands on
 *   the sheet, see print-plaatsing.js renderDeel); markeringen: false = the
 *   document without the annotation layer ("Print: Document") — watermarks
 *   and text edits stay, they are document content.
 *
 * This is output, not screen: the annotation layer is drawn without editing
 * state — no selection frame or handles, no 2D cursor, rubber band, alignment
 * guides or crop overlay — and with the real line weights instead of the
 * screen's minimum-one-pixel rule (annotations/rendering/uitvoer-lagen.js).
 * @returns {Promise<HTMLCanvasElement>} The rendered canvas
 */
export async function renderPageOffscreen(pageNum, exportScale, { deel = null, markeringen = true } = {}) {
  const page = await getActiveDocument().pdfDoc.getPage(pageNum);
  const extraRotation = getPageRotation(pageNum);
  const viewportOpts = { scale: exportScale };
  if (extraRotation) {
    viewportOpts.rotation = (page.rotate + extraRotation) % 360;
  }
  const viewport = page.getViewport(viewportOpts);
  const breedte = deel ? deel.breedte : viewport.width;
  const hoogte = deel ? deel.hoogte : viewport.height;

  // Create off-screen canvas for PDF content
  const pdfCanvas = document.createElement('canvas');
  pdfCanvas.width = breedte;
  pdfCanvas.height = hoogte;
  const pdfCtx = pdfCanvas.getContext('2d');

  // Render PDF page
  const renderContext = {
    canvasContext: pdfCtx,
    viewport: viewport,
    annotationMode: 0
  };
  // Part of the page: shifted so the part starts at pixel (0,0); the canvas
  // clips the rest.
  if (deel) renderContext.transform = [1, 0, 0, 1, -deel.x, -deel.y];

  const renderTask = page.render(renderContext);
  await renderTask.promise;

  // Annotation layer on its own canvas, composited on top of the PDF below.
  const annCanvas = renderMarkeringenOffscreen(pageNum, exportScale, viewport, { deel, markeringen });

  // Composite: draw annotations on top of PDF
  pdfCtx.drawImage(annCanvas, 0, 0);

  return pdfCanvas;
}

/**
 * The annotation layer of a page on a transparent canvas, without the PDF
 * page itself: markups (unless `markeringen` is false), watermarks and text
 * edits, as output (no editing state, real line weights). Same `deel` as
 * renderPageOffscreen. Used on its own by "Save as PDF" in the print dialog,
 * where the page stays vector and only this layer becomes an image.
 * @param {number} pageNum - 1-based page number
 * @param {number} exportScale
 * @param {{width:number, height:number}} viewport  the page at `exportScale`
 * @returns {HTMLCanvasElement}
 */
export function renderMarkeringenOffscreen(pageNum, exportScale, viewport, { deel = null, markeringen = true } = {}) {
  const annCanvas = document.createElement('canvas');
  annCanvas.width = deel ? deel.breedte : viewport.width;
  annCanvas.height = deel ? deel.hoogte : viewport.height;
  const annCtx = annCanvas.getContext('2d');

  // Temporarily override state.scale so renderAnnotationsForPage uses export scale
  const doc = state.documents[state.activeDocumentIndex];
  const savedScale = doc.scale;
  doc.scale = exportScale;
  try {
    const lagen = { uitvoer: true, markeringen };
    if (deel) {
      // The same shift in page coordinates (scale 1); watermarks keep the whole page.
      renderAnnotationsForPage(annCtx, pageNum, annCanvas.width, annCanvas.height, 1,
        { x: deel.x / exportScale, y: deel.y / exportScale },
        { w: viewport.width / exportScale, h: viewport.height / exportScale }, lagen);
    } else {
      renderAnnotationsForPage(annCtx, pageNum, annCanvas.width, annCanvas.height, 1,
        undefined, undefined, lagen);
    }
  } finally {
    // Restore original scale
    doc.scale = savedScale;
  }
  return annCanvas;
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
  if (!getActiveDocument()?.pdfDoc || !isTauri()) return;

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
  if (!getActiveDocument()?.pdfDoc || !isTauri()) return;

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
      const origPage = await getActiveDocument().pdfDoc.getPage(pageNum);
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

    // Open the rasterised result in a new tab. Each page is now a flat image,
    // so it renders identically in every viewer/printer — the reliable way to
    // share/print annotated drawings without appearance-stream mismatches.
    try {
      const { createTab } = await import('../ui/chrome/tabs.js');
      const { loadPDF } = await import('./loader.js');
      const { index } = createTab(outputPath);
      await loadPDF(outputPath, index);
    } catch (e) {
      console.error('Could not open raster PDF in a new tab:', e);
    }
  } finally {
    hideLoading();
  }
  return outputPath;
}

/**
 * Export a single annotation as a PNG image.
 * @param {Object} annotation - The annotation object to export
 */
export async function exportAnnotationAsImage(annotation) {
  if (!annotation || !isTauri()) return;

  const bounds = getAnnotationBounds(annotation);
  if (!bounds) return;

  const exportScale = 3; // 3x for high-res output
  const padding = 10; // padding in annotation units

  const x = bounds.x - padding;
  const y = bounds.y - padding;
  const w = bounds.width + padding * 2;
  const h = bounds.height + padding * 2;

  // Account for line width so strokes aren't clipped
  const lw = annotation.lineWidth ?? 3;
  const extra = lw / 2;

  const canvasW = Math.ceil((w + extra * 2) * exportScale);
  const canvasH = Math.ceil((h + extra * 2) * exportScale);

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');

  // Transparent background
  ctx.clearRect(0, 0, canvasW, canvasH);

  // Scale and translate so the annotation draws at the correct position
  ctx.save();
  ctx.scale(exportScale, exportScale);
  ctx.translate(-(x - extra), -(y - extra));

  drawAnnotation(ctx, annotation);

  ctx.restore();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  const baseName = getPdfBaseName();
  const defaultName = `${baseName}_annotation.png`;

  const outputPath = await saveFileDialog(defaultName, [
    { name: 'PNG Images', extensions: ['png'] }
  ]);
  if (!outputPath) return;

  const bytes = await canvasToBytes(canvas, 'png');
  await writeBinaryFile(outputPath, bytes);
}
