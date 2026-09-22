// Straighten (deskew) a scanned page: the user draws a line along a feature
// that SHOULD be perfectly horizontal or vertical (a ruled line, a table
// edge, the page border), and every targeted page is rotated by the small
// correction angle needed to make that line level.
//
// Unlike page rotation (90°-multiple only, via the PDF /Rotate key), this
// needs an ARBITRARY angle, which the PDF spec has no page-level property
// for — so the page's own content is re-embedded as a form XObject
// (pdfDoc.embedPage) and redrawn onto a fresh replacement page with a
// rotation transform. This preserves vector content losslessly (text stays
// real text) and works identically for a scanned page (content is just one
// big image either way).
import { getActiveDocument } from "../core/state.js";
import { getCachedPdfBytes } from "./loader.js";
import { getCacheKey, reloadFromBytes } from "./page-manager.js";
import { parsePageRange } from "./exporter.js";
import { recordPageStructure } from "../core/undo-manager.js";
import { showLoading, hideLoading } from "../ui/chrome/dialogs.js";
import { cloneAnnotation } from "../annotations/factory.js";
import { PDFDocument, degrees } from "pdf-lib";

/**
 * The correction angle (in degrees, PDF/math convention: positive =
 * counterclockwise) needed to make a user-drawn line level, from its two
 * endpoints in APP space (top-left origin, Y grows downward — see
 * CLAUDE.md's coordinate-systems note).
 *
 * Snaps to whichever the line is closer to — horizontal or vertical — so
 * the same tool handles both a line drawn along a horizontal ruling and one
 * drawn along a vertical table edge. Returns a small angle (±45°): this is
 * a fine correction for a "bit rotated" scan, not a general free rotation.
 *
 * @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2
 * @returns {number} degrees, counterclockwise-positive, PDF/content space
 */
export function computeStraightenAngle(x1, y1, x2, y2) {
  // App space is Y-down; PDF content space (where the rotation is actually
  // applied) is Y-up, so the drawn line's angle sign flips between them.
  const dx = x2 - x1;
  const dyAppSpace = y2 - y1;
  const angleAppSpace = Math.atan2(dyAppSpace, dx); // radians, Y-down convention
  const angleContentSpace = -angleAppSpace; // flip to Y-up (PDF) convention

  // Normalize to (-90°, 90°], then decide: closer to the X axis (line meant
  // to be horizontal) or the Y axis (line meant to be vertical)?
  let deg = (angleContentSpace * 180) / Math.PI;
  while (deg > 90) deg -= 180;
  while (deg <= -90) deg += 180;

  if (Math.abs(deg) <= 45) {
    // Meant to be horizontal (0°): correction is simply -deg.
    return -deg;
  }
  // Meant to be vertical (90°): correction brings it to 90° (or -90°,
  // whichever is nearer), i.e. rotate by (target - deg).
  const target = deg > 0 ? 90 : -90;
  return target - deg;
}

/**
 * Rotate one annotation's geometry in place around (cx, cy) by `angleDeg`
 * (counterclockwise-positive, PDF convention) — mirrored into APP space
 * (Y-down), matching how computeStraightenAngle above flips the sign.
 * Mirrors resize-pages.js's translateAnnotation for the same set of
 * position-bearing fields, but rotating instead of shifting.
 */
function rotateAnnotationAround(ann, cx, cy, angleDeg) {
  if (!angleDeg) return;
  // App space is Y-down, so a counterclockwise PDF-space rotation is a
  // CLOCKWISE rotation in app space — negate the angle for this transform.
  const rad = (-angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rot = (x, y) => ({
    x: cx + (x - cx) * cos - (y - cy) * sin,
    y: cy + (x - cx) * sin + (y - cy) * cos,
  });
  const rotXY = (obj, xKey, yKey) => {
    if (obj[xKey] === undefined) return;
    const p = rot(obj[xKey], obj[yKey]);
    obj[xKey] = p.x;
    obj[yKey] = p.y;
  };
  rotXY(ann, "x", "y");
  rotXY(ann, "startX", "startY");
  rotXY(ann, "endX", "endY");
  rotXY(ann, "arrowX", "arrowY");
  rotXY(ann, "kneeX", "kneeY");
  if (Array.isArray(ann.path)) {
    ann.path = ann.path.map((p) => rot(p.x, p.y));
  }
  if (Array.isArray(ann.points)) {
    ann.points = ann.points.map((p) => rot(p.x, p.y));
  }
  // A box-shaped annotation (x/y/width/height) also needs its own visual
  // rotation applied so its edges stay aligned with the now-rotated page
  // content, not just its anchor point moved.
  if (ann.width !== undefined && ann.height !== undefined) {
    ann.rotation = ((ann.rotation || 0) + angleDeg) % 360;
  }
}

/**
 * Rotate `angleDeg` worth of correction into a single PDF page's content,
 * in place at the same page-tree position — see the module doc comment for
 * why this needs a re-embed rather than a simple /Rotate change.
 */
function straightenOnePage(pdfDoc, pages, pageIndex, angleDeg) {
  const oldPage = pages[pageIndex];
  const { width, height } = oldPage.getSize();
  const embedded = pdfDoc.embedPage(oldPage);
  return embedded.then((embeddedPage) => {
    // A FRESH page: nothing of the old page dictionary comes along. That is
    // deliberate for the measure viewports the PDF may carry (/VP, from CAD
    // plots and the DWG/DXF import): a small rotation cannot be expressed in
    // their axis-aligned /BBox, so rather no scale from the file (the
    // document scale applies; the export reports NO_MODEL_SPACE) than one
    // that quietly sits next to the turned drawing (#400).
    const newPage = pdfDoc.insertPage(pageIndex, [width, height]);
    pdfDoc.removePage(pageIndex + 1);

    // Rotate the embedded page (drawn at its own original width/height)
    // around the PAGE's center. drawPage's (x, y) anchor is BOTH the
    // rotation pivot and, after rotation, the position of the content's own
    // bottom-left corner — so the anchor has to be offset from the page
    // center by the (rotated) vector from that corner to the center.
    const rad = (angleDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const cx = width / 2;
    const cy = height / 2;
    const anchorX = cx - (cx * cos - cy * sin);
    const anchorY = cy - (cx * sin + cy * cos);

    newPage.drawPage(embeddedPage, {
      x: anchorX,
      y: anchorY,
      width,
      height,
      rotate: degrees(angleDeg),
    });
    return newPage;
  });
}

/**
 * Straighten pages by the correction angle for a user-drawn guide line.
 * @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2
 *   Guide-line endpoints in APP space (see computeStraightenAngle) — always
 *   on `doc.currentPage`, which also determines the correction angle
 *   applied to every targeted page (a whole batch scanned on the same
 *   crooked feeder is skewed by the same amount throughout).
 * @param {'current' | 'all' | 'range'} applyTo
 * @param {string} rangeStr - only used when applyTo is 'range'
 * @returns {Promise<{straightened: number, angleDeg: number}>}
 */
export async function straightenPages(x1, y1, x2, y2, applyTo, rangeStr) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return { straightened: 0, angleDeg: 0 };

  const angleDeg = computeStraightenAngle(x1, y1, x2, y2);
  if (!(Math.abs(angleDeg) > 0.01)) return { straightened: 0, angleDeg };

  const cacheKey = getCacheKey();
  const currentBytes = getCachedPdfBytes(cacheKey);
  if (!currentBytes) return { straightened: 0, angleDeg };

  const oldAnnotations = doc.annotations.map((a) => cloneAnnotation(a));
  const oldRotations = { ...doc.pageRotations };
  const oldPage = doc.currentPage;

  const totalPages = doc.pdfDoc.numPages;
  let pageNumbers;
  if (applyTo === "all") {
    pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1);
  } else if (applyTo === "range") {
    pageNumbers = parsePageRange(rangeStr, totalPages);
  } else {
    pageNumbers = [doc.currentPage];
  }
  if (pageNumbers.length === 0) return { straightened: 0, angleDeg };
  const targetPages = new Set(pageNumbers);

  showLoading("Straightening page...");
  try {
    const pdfDoc = await PDFDocument.load(currentBytes, { ignoreEncryption: true });
    const pages = pdfDoc.getPages();

    // Pivot for annotation rotation = each target page's own center, in APP
    // space (top-left origin) — same size as the PDF page (deskew never
    // changes page dimensions).
    const newAnnotations = doc.annotations.map((a) => cloneAnnotation(a));

    for (const pageNum of targetPages) {
      const pageIndex = pageNum - 1;
      if (!pages[pageIndex]) continue;
      const { width, height } = pages[pageIndex].getSize();
      await straightenOnePage(pdfDoc, pages, pageIndex, angleDeg);
      // pdfDoc.getPages() is stale after insertPage/removePage — re-fetch
      // so the NEXT iteration's embedPage call sees the current page tree.
      pages.length = 0;
      pages.push(...pdfDoc.getPages());

      const cx = width / 2;
      const cy = height / 2;
      for (const ann of newAnnotations) {
        if (ann.page === pageNum) rotateAnnotationAround(ann, cx, cy, angleDeg);
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

    return { straightened: targetPages.size, angleDeg };
  } finally {
    hideLoading();
  }
}
