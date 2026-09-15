// Shift Page: nudge a page's content left/right/up/down by an exact amount —
// for a scan whose content drifted off-center (e.g. copied/scanned slightly
// shifted to one side). This is a plain translation, which the PDF spec CAN
// express directly via a `cm` transform, so — like
// Straighten (deskew.js) — the page's content is re-embedded as a form
// XObject and redrawn at an offset, rather than rasterized.
import { getActiveDocument } from "../core/state.js";
import { getCachedPdfBytes } from "./loader.js";
import { getCacheKey, reloadFromBytes } from "./page-manager.js";
import { recordPageStructure } from "../core/undo-manager.js";
import { showLoading, hideLoading } from "../ui/chrome/dialogs.js";
import { cloneAnnotation } from "../annotations/factory.js";
import { translateAnnotation } from "./resize-pages.js";
import { resolveTargetPages } from "./shift-page-geometry.js";
import { PDFDocument } from "pdf-lib";

const MM_TO_POINTS = 72 / 25.4;

export { resolveTargetPages };

/**
 * Re-embed a single page's content, redrawn at an (dx, dy) offset in place
 * at the same page-tree position. Mirrors deskew.js's straightenOnePage, but
 * a translation instead of a rotation.
 */
function shiftOnePage(pdfDoc, pages, pageIndex, dx, dy) {
  const oldPage = pages[pageIndex];
  const { width, height } = oldPage.getSize();
  const embedded = pdfDoc.embedPage(oldPage);
  return embedded.then((embeddedPage) => {
    const newPage = pdfDoc.insertPage(pageIndex, [width, height]);
    pdfDoc.removePage(pageIndex + 1);
    newPage.drawPage(embeddedPage, { x: dx, y: dy, width, height });
    return newPage;
  });
}

/**
 * Shift the targeted page(s) by a fixed offset.
 * @param {number} dxMm - horizontal shift in mm; positive = right.
 * @param {number} dyMm - vertical shift in mm; positive = up (PDF/content
 *   space convention — same sign as the page's own Y axis).
 * @param {'current' | 'all' | 'even' | 'odd'} applyTo
 * @param {number} [fromPage=1] - first page number eligible, for 'all' /
 *   'even' / 'odd' (ignored for 'current').
 * @returns {Promise<{shifted: number}>}
 */
export async function shiftPages(dxMm, dyMm, applyTo, fromPage = 1) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return { shifted: 0 };

  const dx = (dxMm || 0) * MM_TO_POINTS;
  const dy = (dyMm || 0) * MM_TO_POINTS;
  if (!(Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001)) return { shifted: 0 };

  const cacheKey = getCacheKey();
  const currentBytes = getCachedPdfBytes(cacheKey);
  if (!currentBytes) return { shifted: 0 };

  const oldAnnotations = doc.annotations.map((a) => cloneAnnotation(a));
  const oldRotations = { ...doc.pageRotations };
  const oldPage = doc.currentPage;

  const totalPages = doc.pdfDoc.numPages;
  const pageNumbers = resolveTargetPages(applyTo, fromPage, doc.currentPage, totalPages);
  if (pageNumbers.length === 0) return { shifted: 0 };
  const targetPages = new Set(pageNumbers);

  showLoading("Shifting page...");
  try {
    const pdfDoc = await PDFDocument.load(currentBytes, { ignoreEncryption: true });
    const pages = pdfDoc.getPages();

    const newAnnotations = doc.annotations.map((a) => cloneAnnotation(a));

    for (const pageNum of targetPages) {
      const pageIndex = pageNum - 1;
      if (!pages[pageIndex]) continue;
      await shiftOnePage(pdfDoc, pages, pageIndex, dx, dy);
      // pdfDoc.getPages() is stale after insertPage/removePage — re-fetch so
      // the NEXT iteration's embedPage call sees the current page tree.
      pages.length = 0;
      pages.push(...pdfDoc.getPages());

      // App space is Y-down; content/PDF space (dy above) is Y-up, so an
      // annotation's on-screen offset is (dx, -dy).
      for (const ann of newAnnotations) {
        if (ann.page === pageNum) translateAnnotation(ann, dx, -dy);
      }
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

    return { shifted: targetPages.size };
  } finally {
    hideLoading();
  }
}
