import { getActiveDocument } from "../core/state.js";
import { getCachedPdfBytes } from "./loader.js";
import { getCacheKey, reloadFromBytes } from "./page-manager.js";
import { parsePageRange } from "./exporter.js";
import { recordPageStructure } from "../core/undo-manager.js";
import { showLoading, hideLoading } from "../ui/chrome/dialogs.js";
import { cloneAnnotation } from "../annotations/factory.js";
import { applyMoveGeneric } from "../annotations/transforms.js";
import { shiftAnnotation } from "./shift-page-geometry.js";
import { scaleAnnotationGeometry } from "./page-scale-geometry.js";
import { MM_TO_POINTS, marginsForPage, validateResizeMargins } from "./resize-margins-geometry.js";
import { resizePdfPage } from "./resize-page-content.js";
import { PDFDocument } from "pdf-lib";

/**
 * Translate an annotation in place by (dx, dy) in visual PDF points, so
 * that every part of it moves with the page content it belongs to.
 * Goes through the app's single move primitive (applyMoveGeneric), which
 * knows every position-bearing field — leader lines, angle vertices, spline
 * control points, hole contours, text-markup quads, textbox leaders — so no
 * annotation type is left behind or torn apart.
 */
export function translateAnnotation(ann, dx, dy) {
  shiftAnnotation(ann, dx, dy, applyMoveGeneric);
}

/**
 * Resize the media/document size of pages WITHOUT scaling their content.
 * The MediaBox and CropBox are both set to the requested size and the
 * existing content is centred inside the new box; annotations shift with it.
 *
 * With margins, the content goes into the area between the margins of the
 * new page instead of the whole page: scaled to fit there (scaleContent), or
 * at its own size, centred there and cropped to that area.
 *
 * @param {'current' | 'all' | 'range'} applyTo - Which pages to resize
 * @param {string} rangeStr - Page range string (only used when applyTo is 'range')
 * @param {number} widthMm - Target visual width in millimetres
 * @param {number} heightMm - Target visual height in millimetres
 * @param {boolean} [scaleContent=false] - Shrink or grow the content to fit the new size
 *   (one factor, centred) instead of keeping its size. Annotations scale with it.
 * @param {{odd?: object, even?: object} | null} [margins] - margins in millimetres, as
 *   the page is displayed: `odd` and `even` each hold left/right/top/bottom. Odd pages
 *   (by 1-based page number) take `odd`; even pages take `even` when it is given and
 *   `odd` otherwise. Without margins (or with all of them 0) nothing changes.
 * @returns {Promise<{resized: number, reason?: 'margins'}>} `reason` is 'margins'
 *   when the margins leave no room on the new page size; nothing is changed then.
 */
export async function resizePages(applyTo, rangeStr, widthMm, heightMm, scaleContent = false, margins = null) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return { resized: 0 };
  if (!(widthMm > 0) || !(heightMm > 0)) return { resized: 0 };
  if (validateResizeMargins(widthMm, heightMm, margins)) return { resized: 0, reason: "margins" };

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
    const pageScales = new Map();
    const geziene = new Set();

    for (const pageNum of targetPages) {
      const pdfPage = pages[pageNum - 1];
      if (!pdfPage) continue;

      // The new box and the place of the content on it; odd and even page
      // numbers can have their own margins.
      const placed = resizePdfPage(pdfDoc, pdfPage, {
        targetW: targetWpt,
        targetH: targetHpt,
        appRotation: oldRotations[pageNum] || 0,
        scaleContent,
        marginsMm: marginsForPage(pageNum, margins),
      }, geziene);
      if (!placed) continue;

      // The content moved (and with scaleContent: scaled) in visual space; annotations follow.
      if (placed.scaled) pageScales.set(pageNum, placed.visual);
      pageOffsets.set(pageNum, { dx: placed.visual.dx, dy: placed.visual.dy });
    }

    if (pageOffsets.size === 0) return { resized: 0 };

    for (const ann of newAnnotations) {
      const off = pageOffsets.get(ann.page);
      const sc = pageScales.get(ann.page);
      if (sc) scaleAnnotationGeometry(ann, sc.s, sc.dx, sc.dy);
      else if (off) translateAnnotation(ann, off.dx, off.dy);
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
