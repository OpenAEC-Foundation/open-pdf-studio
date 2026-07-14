import { getActiveDocument } from "../core/state.js";
import { getCachedPdfBytes } from "./loader.js";
import { getCacheKey, reloadFromBytes } from "./page-manager.js";
import { parsePageRange } from "./exporter.js";
import { recordPageStructure } from "../core/undo-manager.js";
import { showLoading, hideLoading } from "../ui/chrome/dialogs.js";
import { cloneAnnotation } from "../annotations/factory.js";
import { PDFDocument } from "pdf-lib";

const MM_TO_POINTS = 72 / 25.4;

/**
 * Translate an annotation in place by (dx, dy) in visual PDF points.
 * Mirrors the position models used across the annotation types so that,
 * when a page is recentred, every part of the annotation moves with the
 * content it belongs to.
 */
function translateAnnotation(ann, dx, dy) {
  if (dx === 0 && dy === 0) return;
  if (ann.x !== undefined) ann.x += dx;
  if (ann.y !== undefined) ann.y += dy;
  if (ann.startX !== undefined) { ann.startX += dx; ann.startY += dy; }
  if (ann.endX !== undefined) { ann.endX += dx; ann.endY += dy; }
  if (ann.arrowX !== undefined) { ann.arrowX += dx; ann.arrowY += dy; }
  if (ann.kneeX !== undefined) { ann.kneeX += dx; ann.kneeY += dy; }
  if (Array.isArray(ann.path)) ann.path.forEach((p) => { p.x += dx; p.y += dy; });
  if (Array.isArray(ann.points)) ann.points.forEach((p) => { p.x += dx; p.y += dy; });
  if (Array.isArray(ann.rects)) ann.rects.forEach((r) => { r.x += dx; r.y += dy; });
}

/**
 * Resize the media/document size of pages WITHOUT scaling their content.
 * The MediaBox and CropBox are both set to the requested size and the
 * existing content is centred inside the new box; annotations shift with it.
 *
 * @param {'current' | 'all' | 'range'} applyTo - Which pages to resize
 * @param {string} rangeStr - Page range string (only used when applyTo is 'range')
 * @param {number} widthMm - Target visual width in millimetres
 * @param {number} heightMm - Target visual height in millimetres
 * @returns {Promise<{resized: number}>}
 */
export async function resizePages(applyTo, rangeStr, widthMm, heightMm) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return { resized: 0 };
  if (!(widthMm > 0) || !(heightMm > 0)) return { resized: 0 };

  const cacheKey = getCacheKey();
  const currentBytes = getCachedPdfBytes(cacheKey);
  if (!currentBytes) return { resized: 0 };

  const targetWpt = widthMm * MM_TO_POINTS;
  const targetHpt = heightMm * MM_TO_POINTS;

  const oldAnnotations = doc.annotations.map((a) => cloneAnnotation(a));
  const oldRotations = { ...doc.pageRotations };
  const oldPage = doc.currentPage;

  const totalPages = doc.pdfDoc.numPages;
  let pageNumbers;
  if (applyTo === "current") {
    pageNumbers = [doc.currentPage];
  } else if (applyTo === "all") {
    pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1);
  } else {
    pageNumbers = parsePageRange(rangeStr, totalPages);
  }
  if (pageNumbers.length === 0) return { resized: 0 };
  const targetPages = new Set(pageNumbers);

  showLoading("Resizing pages...");
  try {
    const pdfDoc = await PDFDocument.load(currentBytes, { ignoreEncryption: true });
    const pages = pdfDoc.getPages();

    // Work on a copy of the annotations so we can shift the ones on resized pages.
    const newAnnotations = doc.annotations.map((a) => cloneAnnotation(a));
    // Per-page visual offset applied to content, keyed by 1-based page number.
    const pageOffsets = new Map();

    for (const pageNum of targetPages) {
      const pdfPage = pages[pageNum - 1];
      if (!pdfPage) continue;

      const crop = pdfPage.getCropBox();
      // Total displayed rotation = native /Rotate + any in-app rotation.
      const nativeRot = pdfPage.getRotation().angle % 360;
      const appRot = (oldRotations[pageNum] || 0) % 360;
      const rot = (((nativeRot + appRot) % 360) + 360) % 360;
      const rotated = rot === 90 || rot === 270;

      // Visual (as-displayed) dimensions of the current page.
      const visualOldW = rotated ? crop.height : crop.width;
      const visualOldH = rotated ? crop.width : crop.height;

      // New box in unrotated PDF space (swap dims for quarter-turn pages so
      // the *visual* result matches what the user typed).
      const unrotW = rotated ? targetHpt : targetWpt;
      const unrotH = rotated ? targetWpt : targetHpt;

      // Centre the new box on the current content centre.
      const centerX = crop.x + crop.width / 2;
      const centerY = crop.y + crop.height / 2;
      const newX = centerX - unrotW / 2;
      const newY = centerY - unrotH / 2;

      pdfPage.setMediaBox(newX, newY, unrotW, unrotH);
      pdfPage.setCropBox(newX, newY, unrotW, unrotH);

      // Content moved by half the size delta (in visual space); annotations follow.
      pageOffsets.set(pageNum, {
        dx: (targetWpt - visualOldW) / 2,
        dy: (targetHpt - visualOldH) / 2,
      });
    }

    if (pageOffsets.size === 0) return { resized: 0 };

    for (const ann of newAnnotations) {
      const off = pageOffsets.get(ann.page);
      if (off) translateAnnotation(ann, off.dx, off.dy);
    }

    const newBytes = new Uint8Array(await pdfDoc.save());
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

    return { resized: pageOffsets.size };
  } finally {
    hideLoading();
  }
}
