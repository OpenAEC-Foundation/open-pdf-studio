// Geometry of the compare panes (#1149): where a page lies in its scroll
// pane, how far the pane scrolls, where the scroll position goes when the
// zoom changes around a point, and how large the page bitmap may become.
//
// The view lays a page out as a box of (page size x zoom) inside a scroll
// pane with a fixed padding. The box is centred while it is narrower than
// the pane and starts at the padding once it is wider. That second half is
// what the layout used to get wrong: a centred flex item that is wider than
// its scroll container sticks out equally on both sides, and the part left of
// the container cannot be scrolled to. On a very wide window the page also
// starts far from the pane edge when it is fitted, and the zoom arithmetic
// ignored that distance.
//
// Pure module: numbers in CSS pixels, one axis at a time. Unit tested in
// pane-geometry.test.mjs.

/** Padding around the page inside a scroll pane, CSS px. */
export const PANE_PADDING = 14;
/** Bitmap pixels per PDF point at zoom 1. */
export const BASE_SCALE = 1.5;
/** Zoom range of the compare view. */
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
/**
 * Limits of one page bitmap. Web views refuse a canvas beyond roughly 16 000
 * to 32 000 px on an edge or 268 Mpx in area (it then stays blank), and four
 * bytes per pixel add up long before that. Above these limits the bitmap
 * keeps its size and is scaled on screen instead.
 */
export const MAX_BITMAP_EDGE = 16384;
export const MAX_BITMAP_PX = 100_000_000;

export function clampZoom(z) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
}

/**
 * One axis of a pane.
 * @param {number} pane client size of the scroll pane
 * @param {number} content size of the page box (page size x zoom)
 * @param {{pad?:number, centre?:boolean}} [o] centre: centred while it fits
 *   (the horizontal axis); otherwise it starts at the padding (vertical)
 * @returns {{offset:number, max:number}} offset: where the content starts in
 *   scroll coordinates; max: the largest scroll position
 */
export function axisLayout(pane, content, o = {}) {
  const pad = o.pad ?? PANE_PADDING;
  const free = pane - 2 * pad - content;
  return {
    offset: pad + (o.centre && free > 0 ? free / 2 : 0),
    max: Math.max(0, content + 2 * pad - pane),
  };
}

/**
 * Where the content started with the former layout (always centred, also
 * when wider than the pane). Negative = that many pixels of the page lie
 * left of the scroll area and cannot be reached. Kept for the test that
 * documents the fault.
 */
export function legacyCentredOffset(pane, content, pad = PANE_PADDING) {
  return pad + (pane - 2 * pad - content) / 2;
}

/**
 * Scroll position after a zoom that keeps the content point under `anchor`
 * (a distance from the pane edge, e.g. the cursor) in place.
 * @param {{scroll:number, anchor:number, pane:number, content0:number, content1:number, pad?:number, centre?:boolean}} a
 *   content0/content1: content size before and after the zoom
 */
export function anchoredScroll(a) {
  const l1 = axisLayout(a.pane, a.content1, a);
  if (!(a.content0 > 0)) return Math.max(0, Math.min(l1.max, a.scroll || 0));
  const l0 = axisLayout(a.pane, a.content0, a);
  // The point under the anchor as a fraction of the content (outside 0..1
  // when the anchor is beside the page).
  const u = (a.scroll + a.anchor - l0.offset) / a.content0;
  const s = u * a.content1 + l1.offset - a.anchor;
  return Math.max(0, Math.min(l1.max, s));
}

/** Content point (fraction 0..1 of the page) shown at `anchor`. */
export function contentFractionAt(scroll, anchor, pane, content, o = {}) {
  return (scroll + anchor - axisLayout(pane, content, o).offset) / content;
}

/**
 * Scroll position of the other pane in side-by-side: the same fraction of
 * its scroll range, so both show the same part also when the pages differ in
 * size. A pane that does not scroll passes its position on unchanged.
 */
export function mirrorScroll(srcScroll, srcMax, dstMax) {
  if (srcMax > 0) return (srcScroll / srcMax) * dstMax;
  return Math.max(0, Math.min(Math.max(0, dstMax), srcScroll));
}

/**
 * Render scale for the page bitmaps: the wanted scale, lowered until every
 * page stays within the bitmap limits.
 * @param {number} scale wanted bitmap px per point
 * @param {Array<{width:number,height:number}>} sizes page sizes in points
 * @returns {{scale:number, capped:boolean}}
 */
export function cappedRenderScale(scale, sizes, o = {}) {
  const maxEdge = o.maxEdge > 0 ? o.maxEdge : MAX_BITMAP_EDGE;
  const maxPx = o.maxPx > 0 ? o.maxPx : MAX_BITMAP_PX;
  let limit = Infinity;
  for (const s of sizes || []) {
    if (!s || !(s.width > 0) || !(s.height > 0)) continue;
    // One pixel of slack: the canvas size is rounded up.
    limit = Math.min(limit, (maxEdge - 1) / Math.max(s.width, s.height), Math.sqrt(maxPx / (s.width * s.height)));
  }
  if (!(scale > limit)) return { scale, capped: false };
  return { scale: limit, capped: true };
}
