// Pure page-selection logic for Shift Page — no imports, so it's testable
// under plain `node --test` without resolving core/state.ts.

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
