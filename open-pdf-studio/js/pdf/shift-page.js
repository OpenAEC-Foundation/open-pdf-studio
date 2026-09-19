// Shift Page: nudge a page's content left/right/up/down by an exact amount —
// for a scan whose content drifted off-center (e.g. copied/scanned slightly
// shifted to one side). This is a plain translation, which the PDF spec CAN
// express directly via a `cm` transform, so the page keeps its own object
// and only its content is wrapped in that transform (shift-page-content.js)
// — nothing is rasterized and nothing on the page dictionary is lost.
import { getActiveDocument } from "../core/state.js";
import { getCachedPdfBytes } from "./loader.js";
import { getCacheKey, reloadFromBytes } from "./page-manager.js";
import { recordPageStructure } from "../core/undo-manager.js";
import { showLoading, hideLoading } from "../ui/chrome/dialogs.js";
import { cloneAnnotation } from "../annotations/factory.js";
import { translateAnnotation } from "./resize-pages.js";
import { MM_TO_POINTS, resolveTargetPages, visualToContentOffset } from "./shift-page-geometry.js";
import { assertShiftable, shiftPageContent, shiftPageAnnotations } from "./shift-page-content.js";
import { PDFDocument } from "pdf-lib";

export { resolveTargetPages };

/**
 * Shift the targeted page(s) by a fixed offset, given the way the page is
 * DISPLAYED (so including its /Rotate and any in-app rotation) — the same
 * space the dialog preview and the app's annotations live in.
 * @param {number} dxMm - horizontal shift in mm; positive = right on screen.
 * @param {number} dyMm - vertical shift in mm; positive = up on screen.
 * @param {'current' | 'all' | 'even' | 'odd'} applyTo
 * @param {number} [fromPage=1] - first page number eligible, for 'all' /
 *   'even' / 'odd' (ignored for 'current').
 * @returns {Promise<{shifted: number}>}
 */
export async function shiftPages(dxMm, dyMm, applyTo, fromPage = 1) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return { shifted: 0 };

  // Visual offset in points: x to the right, y DOWN (app space is Y-down).
  const dx = (dxMm || 0) * MM_TO_POINTS;
  const dy = -(dyMm || 0) * MM_TO_POINTS;
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
    assertShiftable(pdfDoc);
    const pages = pdfDoc.getPages();

    const newAnnotations = doc.annotations.map((a) => cloneAnnotation(a));
    const shiftedPages = new Set();
    const movedFileAnnotations = new Set();

    for (const pageNum of targetPages) {
      const page = pages[pageNum - 1];
      if (!page) continue;
      // The content lives in the page's own unrotated space: turn the visual
      // offset through the total displayed rotation (native /Rotate, own or
      // inherited, plus the in-app rotation) so the content goes where the
      // preview showed it and where the annotations go.
      const rotation = page.getRotation().angle + (oldRotations[pageNum] || 0);
      const { cx, cy } = visualToContentOffset(dx, dy, rotation);

      // A page without content (an inserted blank page) has no content to
      // wrap; whatever is annotated on it still moves.
      const contentMoved = shiftPageContent(pdfDoc, page, cx, cy);
      // Links, form fields and other annotations stored in the file are in
      // content space as well; the app's own annotations follow below.
      let moved = shiftPageAnnotations(pdfDoc, page, cx, cy, movedFileAnnotations);

      // The app's annotations are stored in visual space.
      for (const ann of newAnnotations) {
        if (ann.page !== pageNum) continue;
        translateAnnotation(ann, dx, dy);
        moved++;
      }
      if (contentMoved || moved > 0) shiftedPages.add(pageNum);
    }
    if (shiftedPages.size === 0) return { shifted: 0 };

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

    return { shifted: shiftedPages.size };
  } finally {
    hideLoading();
  }
}
