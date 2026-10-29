// Layout of the Edit Pages grid (#764): zoom levels and the virtualised
// window. Only the rows in view (plus a few above and below) are in the DOM,
// so a document of hundreds of pages stays responsive; tiles are placed by
// this arithmetic, not by the browser's grid layout. Pure, no DOM.
//
// Every cell is a gutter followed by a square tile frame and a label line:
//
//   | gutter | frame |  | gutter | frame |  …
//
// The gutter in front of tile i is gap i: it holds the insert (+) and split
// (scissors) controls and the drop indicator. Gap `count` (after the last
// tile) sits in the gutter of the next, empty cell.

/** Tile frame sizes in CSS pixels, smallest to largest. */
export const ZOOM_LEVELS = Object.freeze([72, 96, 120, 150, 190, 240, 300, 380]);
export const DEFAULT_ZOOM_INDEX = 2;

export const GUTTER = 26;   // room for the + and scissors controls
export const ROW_GAP = 10;
export const PADDING = 8;
export const LABEL_HEIGHT = 20;

export function clampZoomIndex(i) {
  const n = Math.round(Number(i));
  if (!Number.isFinite(n)) return DEFAULT_ZOOM_INDEX;
  return Math.max(0, Math.min(ZOOM_LEVELS.length - 1, n));
}

/** One step in or out (Ctrl+wheel: deltaY < 0 zooms in). */
export function zoomStep(index, direction) {
  return clampZoomIndex(clampZoomIndex(index) + (direction > 0 ? 1 : direction < 0 ? -1 : 0));
}

/**
 * The grid for `count` tiles of frame size `tile` in a scroll area `width`
 * pixels wide.
 */
export function gridLayout({ width, tile, count }) {
  const t = Math.max(16, Number(tile) || ZOOM_LEVELS[DEFAULT_ZOOM_INDEX]);
  const cellW = GUTTER + t;
  const inner = Math.max(0, (Number(width) || 0) - 2 * PADDING);
  // The gap after the last tile of a row needs its own gutter at the end.
  const columns = Math.max(1, Math.floor((inner - GUTTER) / cellW));
  const rowH = t + LABEL_HEIGHT + ROW_GAP;
  const n = Math.max(0, count | 0);
  // The end gap may start a row of its own.
  const rows = Math.ceil((n + 1) / columns);
  return {
    tile: t, cellW, columns, rowH, count: n, rows,
    totalHeight: 2 * PADDING + rows * rowH - ROW_GAP,
    totalWidth: 2 * PADDING + columns * cellW + GUTTER,
  };
}

/** Top-left of the cell of index `i` (its gutter), in content coordinates. */
export function cellPosition(layout, i) {
  const row = Math.floor(i / layout.columns);
  const col = i % layout.columns;
  return { left: PADDING + col * layout.cellW, top: PADDING + row * layout.rowH, row, col };
}

/** Top-left of the frame of tile `i`. */
export function tilePosition(layout, i) {
  const c = cellPosition(layout, i);
  return { left: c.left + GUTTER, top: c.top };
}

/**
 * The tiles to put in the DOM for a scroll position: whole rows from a little
 * above to a little below the visible part.
 * @returns {{start: number, end: number}} indices, end exclusive
 */
export function visibleRange(layout, scrollTop, viewportHeight, overscanRows = 2) {
  if (!layout.count) return { start: 0, end: 0 };
  const top = Math.max(0, (Number(scrollTop) || 0) - PADDING);
  const firstRow = Math.max(0, Math.floor(top / layout.rowH) - overscanRows);
  const lastRow = Math.floor((top + Math.max(0, Number(viewportHeight) || 0)) / layout.rowH) + overscanRows;
  const start = Math.min(layout.count, firstRow * layout.columns);
  const end = Math.min(layout.count, (lastRow + 1) * layout.columns);
  return { start, end };
}

/**
 * The gap under a point (content coordinates): the row first, then the cell;
 * the gutter and the left half of a tile are the gap in front of it, the
 * right half the gap after it. Past the last tile: the end gap.
 */
export function gapAtPoint(layout, x, y) {
  if (!layout.count) return 0;
  const lastRow = Math.floor(layout.count / layout.columns);
  const row = Math.max(0, Math.min(lastRow, Math.floor(((Number(y) || 0) - PADDING) / layout.rowH)));
  const rel = (Number(x) || 0) - PADDING;
  const col = Math.max(0, Math.min(layout.columns - 1, Math.floor(rel / layout.cellW)));
  const index = row * layout.columns + col;
  if (index >= layout.count) return layout.count;
  const within = rel - col * layout.cellW;
  return within < GUTTER + layout.tile / 2 ? index : index + 1;
}

/** Scroll position that brings tile `i` into view (or null when it is). */
export function scrollTopFor(layout, i, scrollTop, viewportHeight) {
  const { top } = tilePosition(layout, i);
  const bottom = top + layout.tile + LABEL_HEIGHT;
  if (top < scrollTop) return Math.max(0, top - PADDING);
  if (bottom > scrollTop + viewportHeight) return Math.max(0, bottom - viewportHeight + PADDING);
  return null;
}
