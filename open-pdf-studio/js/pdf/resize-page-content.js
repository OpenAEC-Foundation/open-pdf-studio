// PDF-side half of Resize Pages for ONE page: gives the page its new size and
// puts the content where the geometry says (resize-margins-geometry.js).
// Imports pdf-lib helpers only, so it runs under plain `node --test`.
import { shiftPageContent, shiftPageAnnotations } from "./shift-page-content.js";
import { MM_TO_POINTS, hasMargins, normalizeMargins, resizeGeometry } from "./resize-margins-geometry.js";

/**
 * Resize one page in place.
 *
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @param {import('pdf-lib').PDFPage} pdfPage
 * @param {object} options
 * @param {number} options.targetW - new width as displayed, in points
 * @param {number} options.targetH - new height as displayed, in points
 * @param {number} [options.appRotation] - in-app rotation on top of the page's /Rotate
 * @param {boolean} [options.scaleContent] - scale the content to fit instead of keeping its size
 * @param {object} [options.marginsMm] - left/right/top/bottom as displayed, in millimetres
 * @param {Set<object>} [seen] - annotation dictionaries already scaled in this
 *   run; pass one set for all pages so a shared dictionary is scaled once
 * @returns {{visual: {s: number, dx: number, dy: number}, scaled: boolean} | null}
 *   How the app's own annotations on this page follow (displayed space,
 *   x' = s*x + dx, y' = s*y + dy) and whether the content was scaled; null
 *   when the page was left alone (scaling a page that has no content).
 */
export function resizePdfPage(pdfDoc, pdfPage, { targetW, targetH, appRotation = 0, scaleContent = false, marginsMm = null }, seen = new Set()) {
  const crop = pdfPage.getCropBox();
  // Total displayed rotation = native /Rotate + any in-app rotation.
  const nativeRot = pdfPage.getRotation().angle % 360;
  const appRot = (appRotation || 0) % 360;
  const rot = (((nativeRot + appRot) % 360) + 360) % 360;

  // The margins of this page, as displayed, in points.
  const mm = normalizeMargins(marginsMm);
  const margins = hasMargins(mm)
    ? {
      left: mm.left * MM_TO_POINTS,
      right: mm.right * MM_TO_POINTS,
      top: mm.top * MM_TO_POINTS,
      bottom: mm.bottom * MM_TO_POINTS,
    }
    : null;

  // Where the content goes: the new box in unrotated PDF space (dims swapped
  // for quarter-turn pages so the *visual* result matches what the user
  // typed), the transform for the content and the one for the annotations.
  const geo = resizeGeometry({ crop, rotation: rot, targetW, targetH, margins, scaleContent });
  // With margins the content is cut off at the margin area. The streams of an
  // encrypted file cannot take the extra clip (it would be written
  // unencrypted and read back as garbage), so such a file keeps its content uncut.
  const clip = geo.clip && geo.clip.width > 0 && geo.clip.height > 0 && !pdfDoc.isEncrypted ? geo.clip : null;

  if (geo.content) {
    // Een nieuwe pagina op de oorsprong; de inhoud krimpt (of groeit) met één factor
    // en staat gecentreerd. De schaal geldt in de ongedraaide ruimte van de pagina.
    const { s, tx, ty } = geo.content;
    if (!shiftPageContent(pdfDoc, pdfPage, tx, ty, s, clip)) return null;
    shiftPageAnnotations(pdfDoc, pdfPage, tx, ty, seen, s);
  } else if (clip) {
    // Keep size: the content stays where it is and the box moves around it;
    // only the part between the margins stays visible.
    shiftPageContent(pdfDoc, pdfPage, 0, 0, 1, clip);
  }

  pdfPage.setMediaBox(geo.box.x, geo.box.y, geo.box.width, geo.box.height);
  pdfPage.setCropBox(geo.box.x, geo.box.y, geo.box.width, geo.box.height);
  return { visual: geo.visual, scaled: !!geo.content };
}
