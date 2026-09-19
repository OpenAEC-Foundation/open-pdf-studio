// Pure page-selection and geometry logic for Shift Page — no imports, so it's
// testable under plain `node --test` without resolving core/state.ts.

export const MM_TO_POINTS = 72 / 25.4;

// Largest offset accepted, in mm. 5080 mm (200 in) is the largest page
// dimension the PDF format allows, so a bigger shift can never be useful; the
// bound also keeps exponent input (1e308) from ever reaching a content stream.
export const MAX_SHIFT_MM = 5080;

/**
 * Which page numbers `applyTo` + `fromPage` select, out of `totalPages`.
 * @param {'current' | 'all' | 'even' | 'odd'} applyTo
 * @param {number} fromPage - first eligible page number for 'all'/'even'/'odd'
 * @param {number} currentPage
 * @param {number} totalPages
 * @returns {number[]}
 */
export function resolveTargetPages(applyTo, fromPage, currentPage, totalPages) {
  const total = Math.floor(Number(totalPages));
  if (!(total >= 1)) return [];
  if (applyTo === "current") {
    const current = Math.floor(Number(currentPage));
    return current >= 1 && current <= total ? [current] : [];
  }
  // An unknown selection selects nothing, rather than silently meaning "all".
  if (applyTo !== "all" && applyTo !== "even" && applyTo !== "odd") return [];
  // Whole page numbers only: a fractional start would yield 2.5, 3.5, ...
  const requested = Math.floor(Number(fromPage));
  const from = Math.max(1, Math.min(Number.isFinite(requested) ? requested : 1, total));
  const pages = [];
  for (let p = from; p <= total; p++) {
    if (applyTo === "even" && p % 2 !== 0) continue;
    if (applyTo === "odd" && p % 2 !== 1) continue;
    pages.push(p);
  }
  return pages;
}

/** A page rotation in degrees, normalised to 0, 90, 180 or 270. */
export function normalizeRotation(degrees) {
  const quarterTurns = Math.round((Number(degrees) || 0) / 90);
  return (((quarterTurns % 4) + 4) % 4) * 90;
}

/**
 * Map a shift in VISUAL space (as the page is displayed: x to the right,
 * y DOWN) to the translation in the page's own unrotated content space
 * (PDF user space, y UP) that produces it.
 *
 * `rotation` is the total displayed rotation, clockwise: the page's /Rotate
 * plus any in-app rotation. The dialog preview, the drag and the app's
 * annotations all live in visual space; on a turned page the content axes
 * point elsewhere, so a plain (dx, -dy) would move the content in another
 * direction than the preview showed and than the annotations move.
 *
 * @returns {{cx: number, cy: number}}
 */
export function visualToContentOffset(vx, vyDown, rotation) {
  switch (normalizeRotation(rotation)) {
    case 90:
      return { cx: vyDown, cy: vx };
    case 180:
      return { cx: -vx, cy: vyDown };
    case 270:
      return { cx: -vyDown, cy: -vx };
    default:
      return { cx: vx, cy: -vyDown };
  }
}

/**
 * Move one annotation rigidly with the page content it belongs to.
 * `moveGeneric` is the app's single move primitive (applyMoveGeneric in
 * annotations/transforms.js), injected so this module stays import-free.
 * That primitive deliberately leaves a callout's arrow tip and knee alone
 * (an interactive move keeps the tip anchored); when the whole page moves,
 * the content under the tip moves too, so those two follow here.
 */
export function shiftAnnotation(ann, dx, dy, moveGeneric) {
  if (!ann || (dx === 0 && dy === 0)) return;
  moveGeneric(ann, dx, dy);
  for (const [kx, ky] of [["arrowX", "arrowY"], ["kneeX", "kneeY"]]) {
    if (typeof ann[kx] === "number") ann[kx] += dx;
    if (typeof ann[ky] === "number") ann[ky] += dy;
  }
}

/**
 * OCR word boxes (left/top/width/height in page points, top-left origin —
 * the same visual space as annotations) moved by a visual offset. Returns a
 * new array.
 */
export function shiftOcrWords(words, dx, dy) {
  if (!Array.isArray(words)) return words;
  return words.map((word) => ({
    ...word,
    left: typeof word.left === "number" ? word.left + dx : word.left,
    top: typeof word.top === "number" ? word.top + dy : word.top,
  }));
}

/**
 * Apply (direction 1) or take back (direction -1) a page shift on the
 * document's pending OCR results. The saver writes those word boxes as the
 * invisible text layer, so they have to follow the content they describe —
 * and go back with it on undo. Stored as an offset rather than a snapshot,
 * so OCR runs made after the shift survive an undo.
 *
 * @param {Record<number, object[]>} ocrResults - doc.ocrResults, changed in place
 * @param {{pages: number[], dx: number, dy: number} | undefined} ocrShift
 */
export function applyOcrShift(ocrResults, ocrShift, direction = 1) {
  if (!ocrResults || !ocrShift || !Array.isArray(ocrShift.pages)) return;
  for (const pageNum of ocrShift.pages) {
    const words = ocrResults[pageNum];
    if (Array.isArray(words) && words.length > 0) {
      ocrResults[pageNum] = shiftOcrWords(words, ocrShift.dx * direction, ocrShift.dy * direction);
    }
  }
}

/**
 * The requested shift as a visual offset in points (x right, y DOWN), or
 * null when there is nothing to do: no offset, or not a number at all.
 * `dyMm` follows the dialog: positive = up on screen.
 * @returns {{dx: number, dy: number} | null}
 */
export function shiftOffsetPoints(dxMm, dyMm) {
  const clamp = (mm) => {
    const value = Number(mm) || 0;
    if (!Number.isFinite(value)) return NaN;
    return Math.max(-MAX_SHIFT_MM, Math.min(MAX_SHIFT_MM, value));
  };
  const dx = clamp(dxMm) * MM_TO_POINTS;
  const dy = -clamp(dyMm) * MM_TO_POINTS;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  if (!(Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001)) return null;
  return { dx: dx === 0 ? 0 : dx, dy: dy === 0 ? 0 : dy }; // no negative zero
}

/**
 * The number a millimetre field holds while the user types. A number input
 * reports an empty value for text that is not a number YET ("-", "", "1e"):
 * that reads as 0 here, and the caller must not write it back into the field
 * — doing so wipes the minus sign, and the digits typed next then give the
 * positive number. Always finite and within ±MAX_SHIFT_MM.
 */
export function parseShiftInput(text) {
  const value = parseFloat(String(text ?? "").trim().replace(",", "."));
  if (Number.isNaN(value)) return 0;
  return Math.max(-MAX_SHIFT_MM, Math.min(MAX_SHIFT_MM, value));
}

/**
 * The start page a field holds while the user types, or null when the text
 * is not a page number yet (empty while replacing "3" by "5") — the caller
 * then keeps the previous value instead of rewriting the field.
 */
export function parseFromPageInput(text, totalPages) {
  const value = parseInt(String(text ?? "").trim(), 10);
  if (!Number.isFinite(value)) return null;
  return Math.max(1, Math.min(value, Math.max(1, Math.floor(Number(totalPages)) || 1)));
}

/**
 * Size of the dialog preview and the scale to render it at: the page fitted
 * into `maxWidth` x `maxHeight` CSS pixels (never enlarged), rendered with
 * just enough pixels for that box. A fixed render scale turns a large-format
 * sheet into a bitmap of tens of megapixels for a 260 px wide preview.
 *
 * @returns {{width: number, height: number, scale: number}} CSS pixel size
 *   of the preview and the render scale (canvas pixels per PDF point)
 */
export function previewLayout(pageWidthPt, pageHeightPt, maxWidth, maxHeight, devicePixelRatio = 1) {
  const w = Number(pageWidthPt);
  const h = Number(pageHeightPt);
  if (!(w > 0) || !(h > 0)) return { width: maxWidth, height: maxHeight, scale: 1 };
  const fit = Math.min(1, maxWidth / w, maxHeight / h);
  const dpr = Math.max(1, Math.min(Number(devicePixelRatio) || 1, 3));
  return {
    width: Math.max(1, Math.round(w * fit)),
    height: Math.max(1, Math.round(h * fit)),
    scale: fit * dpr,
  };
}
