// Page order model for the page organizer (#763) and the thumbnail panel.
//
// An order is an array of the document's current page numbers (1-based) in
// their new sequence: order[i] is the page that becomes page i + 1. This is
// the same permutation reorderPages() in page-manager.js takes. No app
// imports, no DOM: the reorder logic is tested on its own.

/** The order of a document with `count` pages as it is now: [1, 2, …, count]. */
export function identityOrder(count) {
  return Array.from({ length: Math.max(0, count | 0) }, (_, i) => i + 1);
}

/** True when the order leaves every page where it is. */
export function isIdentityOrder(order) {
  return Array.isArray(order) && order.every((p, i) => p === i + 1);
}

/** True when `order` holds each page number 1..count exactly once. */
export function isPageOrder(order, count) {
  if (!Array.isArray(order) || order.length !== count) return false;
  const seen = new Set();
  for (const p of order) {
    if (!Number.isInteger(p) || p < 1 || p > count || seen.has(p)) return false;
    seen.add(p);
  }
  return true;
}

/**
 * Moves the selected pages, as one group in their current relative order, to
 * a gap in the order. Gap g lies in front of order[g]; gap order.length is
 * after the last page. The gap is counted in the order BEFORE the move, the
 * way a drop indicator between two thumbnails shows it.
 * @param {number[]} order
 * @param {Iterable<number>} selected page numbers to move
 * @param {number} gap 0..order.length
 * @returns {number[]} the new order (a new array; the input is not changed)
 */
export function moveGroupToGap(order, selected, gap) {
  const sel = new Set(selected);
  const moving = order.filter((p) => sel.has(p));
  if (moving.length === 0) return [...order];
  const g = Math.max(0, Math.min(order.length, Math.round(Number(gap) || 0)));
  const rest = order.filter((p) => !sel.has(p));
  // Selected pages in front of the gap leave it: the gap shifts left by them.
  let before = 0;
  for (let i = 0; i < g; i++) if (sel.has(order[i])) before++;
  const at = g - before;
  return [...rest.slice(0, at), ...moving, ...rest.slice(at)];
}

/**
 * The gap a drop on a thumbnail lands in: in front of it or after it.
 * @param {number[]} order
 * @param {number} targetPage the page under the pointer
 * @param {'before'|'after'} side
 * @returns {number} gap index, or -1 when the page is not in the order
 */
export function gapForDrop(order, targetPage, side) {
  const i = order.indexOf(targetPage);
  if (i < 0) return -1;
  return side === 'after' ? i + 1 : i;
}

/**
 * True when dropping the selection in this gap would change nothing (the gap
 * lies inside or right next to a contiguous selection).
 */
export function isNoOpGap(order, selected, gap) {
  const next = moveGroupToGap(order, selected, gap);
  return next.every((p, i) => p === order[i]);
}

/**
 * Keyboard move: every selected page steps one place left (delta -1) or
 * right (delta +1) past its unselected neighbour. A selected block moves as
 * a whole; a page already at the edge stays there, and so do the selected
 * pages packed against it.
 * @returns {number[]} the new order
 */
export function moveSelectionBy(order, selected, delta) {
  const sel = new Set(selected);
  const next = [...order];
  if (delta < 0) {
    for (let i = 1; i < next.length; i++) {
      if (sel.has(next[i]) && !sel.has(next[i - 1])) [next[i - 1], next[i]] = [next[i], next[i - 1]];
    }
  } else if (delta > 0) {
    for (let i = next.length - 2; i >= 0; i--) {
      if (sel.has(next[i]) && !sel.has(next[i + 1])) [next[i], next[i + 1]] = [next[i + 1], next[i]];
    }
  }
  return next;
}

/** Moves the selection to the very start (edge 'start') or end ('end'). */
export function moveSelectionToEdge(order, selected, edge) {
  return moveGroupToGap(order, selected, edge === 'start' ? 0 : order.length);
}

/**
 * Pages selected from `anchor` to `page` in the order as shown (Shift+click).
 * @returns {number[]}
 */
export function rangeInOrder(order, anchor, page) {
  const a = order.indexOf(anchor);
  const b = order.indexOf(page);
  if (b < 0) return [];
  if (a < 0) return [page];
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return order.slice(lo, hi + 1);
}

/** Old page number -> new page number, the mapping page-manager.js uses. */
export function pageMappingForOrder(order) {
  const mapping = {};
  order.forEach((oldPage, i) => { mapping[oldPage] = i + 1; });
  return mapping;
}

/**
 * Bookmarks follow their page. The model (doc.bookmarks) is a flat list with
 * `page`; the tree (parentId, sortOrder) stays as it is.
 */
export function remapBookmarkPages(bookmarks, mapping) {
  if (!Array.isArray(bookmarks)) return bookmarks;
  return bookmarks.map((b) => {
    const to = mapping[b.page];
    return to == null ? { ...b } : { ...b, page: to };
  });
}

/**
 * The gap under the pointer in a grid of thumbnails (rows wrap). The row
 * comes first: the tile nearest in height, then the nearest in that row; the
 * left half of a tile is the gap in front of it, the right half the gap after
 * it. Space after the last tile is the gap at the end.
 * @param {{left:number, top:number, right:number, bottom:number}[]} rects
 *   tile rectangles in display order
 * @returns {number} gap index 0..rects.length
 */
export function gapFromRects(rects, x, y) {
  if (!rects || rects.length === 0) return 0;
  let best = -1;
  let bestDy = Infinity;
  let bestDx = Infinity;
  rects.forEach((r, i) => {
    const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    if (dy < bestDy || (dy === bestDy && dx < bestDx)) {
      best = i; bestDy = dy; bestDx = dx;
    }
  });
  const r = rects[best];
  return x < (r.left + r.right) / 2 ? best : best + 1;
}

/**
 * The index of the tile one row up (delta -1) or down (+1) from `index`, in
 * a grid with `columns` tiles per row; clamped to the first/last tile.
 */
export function stepRow(index, count, columns, delta) {
  const c = Math.max(1, columns | 0);
  const next = index + delta * c;
  return Math.max(0, Math.min(count - 1, next));
}
