// Pure page-selection and geometry logic for Shift Page — no imports, so it's
// testable under plain `node --test` without resolving core/state.ts.

export const MM_TO_POINTS = 72 / 25.4;

/**
 * Which page numbers `applyTo` + `fromPage` select, out of `totalPages`.
 * @param {'current' | 'all' | 'even' | 'odd'} applyTo
 * @param {number} fromPage - first eligible page number for 'all'/'even'/'odd'
 * @param {number} currentPage
 * @param {number} totalPages
 * @returns {number[]}
 */
export function resolveTargetPages(applyTo, fromPage, currentPage, totalPages) {
  if (applyTo === "current") return [currentPage];
  const from = Math.max(1, Math.min(fromPage || 1, totalPages));
  const pages = [];
  for (let p = from; p <= totalPages; p++) {
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
