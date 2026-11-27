import { state, getActiveDocument } from "../core/state.js";
import { getCachedPdfBytes } from "./loader.js";
import { getCacheKey, reloadFromBytes } from "./page-manager.js";
import { renderPageOffscreen, parsePageRange } from "./exporter.js";
import { recordPageStructure } from "../core/undo-manager.js";
import { showLoading, hideLoading } from "../ui/chrome/dialogs.js";
import { PDFDocument } from "pdf-lib";
import { cropBoxFromPixels, cropOriginShift } from './crop-margins-geometrie.js';
import { cloneAnnotation } from '../annotations/factory.js';
import { applyMoveRigid } from '../annotations/transforms.js';

const ALPHA_THRESHOLD = 10;
const MAX_PIXELS = 20_000_000;
const MM_TO_POINTS = 72 / 25.4;

/**
 * Detect the content bounds of a rendered page by edge-inward pixel scanning.
 * @param {number} pageNum - 1-based page number
 * @param {number} threshold - Whiteness threshold (0-255), pixels brighter are "white"
 * @returns {Promise<object | null>} Pixel bounds and the viewport used to render them.
 */
async function detectContentBounds(pageNum, threshold) {
  // Determine render scale — reduce for very large pages
  const page = await getActiveDocument().pdfDoc.getPage(pageNum);
  const vp = page.getViewport({ scale: 1 });
  const basePixels = vp.width * vp.height;
  let scale = 1;
  if (basePixels > MAX_PIXELS) {
    scale = Math.sqrt(MAX_PIXELS / basePixels);
  } else if (basePixels * 4 <= MAX_PIXELS) {
    // Use scale 2 for small pages to get better accuracy
    scale = 2;
  }

  // Zelfde rotatie als renderPageOffscreen; PDF.js rekent vanuit het zichtbare
  // CropBox en verwerkt ook /UserUnit in de transformatie.
  const viewport = page.getViewport({ scale,
    rotation: (page.rotate + (getActiveDocument().pageRotations?.[pageNum] || 0)) % 360 });
  const canvas = await renderPageOffscreen(pageNum, scale);
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  canvas.width = 0; canvas.height = 0;

  /**
   * Check if a pixel at (x, y) is "content" (non-white).
   */
  function isContent(x, y) {
    const idx = (y * width + x) * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const a = data[idx + 3];
    return a >= ALPHA_THRESHOLD && (r < threshold || g < threshold || b < threshold);
  }

  // Scan rows from top to find first content row
  let minY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isContent(x, y)) {
        minY = y;
        break;
      }
    }
    if (minY !== -1) break;
  }

  // Fully white page
  if (minY === -1) return null;

  // Scan rows from bottom to find last content row
  let maxY = minY;
  for (let y = height - 1; y > minY; y--) {
    let found = false;
    for (let x = 0; x < width; x++) {
      if (isContent(x, y)) {
        maxY = y;
        found = true;
        break;
      }
    }
    if (found) break;
  }

  // Scan columns from left (only between minY..maxY)
  let minX = width;
  for (let x = 0; x < width; x++) {
    let found = false;
    for (let y = minY; y <= maxY; y++) {
      if (isContent(x, y)) {
        minX = x;
        found = true;
        break;
      }
    }
    if (found) break;
  }

  // Scan columns from right (only between minY..maxY)
  let maxX = minX;
  for (let x = width - 1; x > minX; x--) {
    let found = false;
    for (let y = minY; y <= maxY; y++) {
      if (isContent(x, y)) {
        maxX = x;
        found = true;
        break;
      }
    }
    if (found) break;
  }

  return { minX, minY, maxX, maxY, viewport };
}

/**
 * Crop margins from pages in the current document.
 * @param {'current' | 'all' | 'range'} applyTo - Which pages to crop
 * @param {string} rangeStr - Page range string (only used when applyTo is 'range')
 * @param {number} paddingMm - Padding around content in mm
 * @param {number} threshold - Whiteness threshold (200-255)
 * @returns {Promise<{cropped: number, skipped: number}>}
 */
export async function cropMargins(applyTo, rangeStr, paddingMm, threshold) {
  if (!getActiveDocument()?.pdfDoc) return { cropped: 0, skipped: 0 };

  const cacheKey = getCacheKey();
  const currentBytes = getCachedPdfBytes(cacheKey);
  if (!currentBytes) return { cropped: 0, skipped: 0 };

  const doc = getActiveDocument();
  const oldAnnotations = doc.annotations.map(cloneAnnotation);
  const oldRotations = { ...doc.pageRotations };
  const oldPage = doc.currentPage;

  // Determine which pages to process
  const totalPages = doc.pdfDoc.numPages;
  let pageNumbers;
  if (applyTo === "current") {
    pageNumbers = [doc.currentPage];
  } else if (applyTo === "all") {
    pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1);
  } else {
    pageNumbers = parsePageRange(rangeStr, totalPages);
  }

  if (pageNumbers.length === 0) return { cropped: 0, skipped: 0 };

  const paddingPt = paddingMm * MM_TO_POINTS;

  showLoading("Detecting content bounds...");
  try {
    // First pass: detect bounds for all pages
    const boundsMap = new Map();
    for (const pageNum of pageNumbers) {
      showLoading(`Analyzing page ${pageNum} of ${totalPages}...`);
      const bounds = await detectContentBounds(pageNum, threshold);
      if (bounds) {
        boundsMap.set(pageNum, bounds);
      }
    }

    if (boundsMap.size === 0) {
      return { cropped: 0, skipped: pageNumbers.length };
    }

    // Second pass: apply CropBox via pdf-lib
    showLoading("Applying crop...");
    const pdfDoc = await PDFDocument.load(currentBytes, {
      ignoreEncryption: true,
    });
    const pages = pdfDoc.getPages();

    const newAnnotations = oldAnnotations.map(cloneAnnotation);
    for (const [pageNum, bounds] of boundsMap) {
      const pdfPage = pages[pageNum - 1];
      const crop = cropBoxFromPixels(bounds, bounds.viewport, pdfPage.getMediaBox(), paddingPt);
      pdfPage.setCropBox(crop.x, crop.y, crop.width, crop.height);
      const { dx, dy } = cropOriginShift(crop, bounds.viewport);
      for (const annotation of newAnnotations) {
        if (annotation.page === pageNum) applyMoveRigid(annotation, dx, dy);
      }
    }

    const newBytes = new Uint8Array(await pdfDoc.save());

    // Alleen de oorsprong van de annotaties verandert, niet hun grootte.
    const newRotations = { ...oldRotations };
    const targetPage = doc.currentPage;

    await reloadFromBytes(newBytes, newAnnotations, newRotations, targetPage);
    recordPageStructure(
      currentBytes,
      oldAnnotations,
      oldRotations,
      oldPage,
      newBytes,
      newAnnotations,
      newRotations,
      targetPage
    );

    return {
      cropped: boundsMap.size,
      skipped: pageNumbers.length - boundsMap.size,
    };
  } finally {
    hideLoading();
  }
}
