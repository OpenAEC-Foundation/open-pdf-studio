// Pure geometry for "Resize Pages" with margins (#1291): where the content of a
// page ends up on the new page size, given a margin on each side. No app
// imports (only the pure fit helper), so it runs under plain `node --test`.
//
// Margins are given the way the page is DISPLAYED (left/right/top/bottom as
// the user sees them, so including /Rotate and any in-app rotation). The
// content itself lives in the unrotated space of the page; the margins are
// turned into that space first.
//
// With all margins zero the result is exactly what Resize Pages did before
// margins existed: the same numbers, not merely close ones.

import { schaalVoorPassen } from './page-scale-geometry.js';

export const MM_TO_POINTS = 72 / 25.4;

// The area between the margins must leave at least this much room, per
// direction. Less would give a scale factor too small to write to a page.
export const MIN_CONTENT_AREA_MM = 1;

const SIDES = ['left', 'right', 'top', 'bottom'];

/** A margin set with every side a number (a missing or unreadable side is 0). */
export function normalizeMargins(margins) {
  const out = {};
  for (const side of SIDES) {
    const value = Number(margins?.[side]);
    out[side] = Number.isFinite(value) ? value : 0;
  }
  return out;
}

/** True when at least one side of the set is not zero. */
export function hasMargins(margins) {
  const m = normalizeMargins(margins);
  return SIDES.some((side) => m[side] !== 0);
}

/**
 * The margin set for a page. `margins` is `{ odd, even }`: odd pages (1, 3, 5,
 * ... by 1-based page number in the document) take `odd`; even pages take
 * `even` when it is given, and `odd` otherwise (one set for all pages).
 */
export function marginsForPage(pageNum, margins) {
  if (!margins) return normalizeMargins(null);
  const even = pageNum % 2 === 0;
  return normalizeMargins(even && margins.even ? margins.even : margins.odd);
}

function validateSet(set, widthMm, heightMm, pages) {
  if (!set) return null;
  for (const side of SIDES) {
    const value = Number(set[side] ?? 0);
    if (!Number.isFinite(value) || value < 0) return { code: 'negative', pages };
  }
  const m = normalizeMargins(set);
  // No margins: nothing to check (an unusable page size is not a margin problem).
  if (!hasMargins(m)) return null;
  if (m.left + m.right > widthMm - MIN_CONTENT_AREA_MM) return { code: 'too-wide', pages };
  if (m.top + m.bottom > heightMm - MIN_CONTENT_AREA_MM) return { code: 'too-high', pages };
  return null;
}

/**
 * Check the margins against the new page size (all in mm, as displayed).
 * @param {number} widthMm
 * @param {number} heightMm
 * @param {{odd?: object, even?: object} | null} margins
 * @returns {null | {code: 'negative' | 'too-wide' | 'too-high', pages: 'odd' | 'even'}}
 *   null when the margins can be used; otherwise what is wrong and in which set.
 */
export function validateResizeMargins(widthMm, heightMm, margins) {
  if (!margins) return null;
  return validateSet(margins.odd, widthMm, heightMm, 'odd')
    || validateSet(margins.even, widthMm, heightMm, 'even');
}

/** A total displayed rotation in degrees, as 0, 90, 180 or 270 (anything else counts as 0). */
function quarterTurn(rotation) {
  const r = (((Number(rotation) || 0) % 360) + 360) % 360;
  return r === 90 || r === 180 || r === 270 ? r : 0;
}

/**
 * Turn margins given as displayed into margins on the sides of the unrotated
 * space of the page. `rotation` is the total displayed rotation, clockwise: on
 * a page turned 90 degrees the unrotated left edge is shown at the top, and so on.
 */
export function unrotatedMargins(margins, rotation) {
  const { left, right, top, bottom } = normalizeMargins(margins);
  switch (quarterTurn(rotation)) {
    case 90:
      return { left: top, bottom: left, right: bottom, top: right };
    case 180:
      return { left: right, right: left, top: bottom, bottom: top };
    case 270:
      return { left: bottom, top: left, right: top, bottom: right };
    default:
      return { left, right, top, bottom };
  }
}

/**
 * Where the content of a page goes when the page gets a new size with margins.
 *
 * @param {object} input
 * @param {{x: number, y: number, width: number, height: number}} input.crop -
 *   the current CropBox of the page (unrotated PDF space, points, y up)
 * @param {number} input.rotation - total displayed rotation, clockwise
 * @param {number} input.targetW - new width as displayed, in points
 * @param {number} input.targetH - new height as displayed, in points
 * @param {object} [input.margins] - left/right/top/bottom as displayed, in points
 * @param {boolean} [input.scaleContent] - true: scale the content to fit
 *   between the margins (one factor, centred there); false: keep its size,
 *   centre it between the margins and crop it to that area
 * @returns {{
 *   box: {x: number, y: number, width: number, height: number},
 *   content: {s: number, tx: number, ty: number} | null,
 *   visual: {s: number, dx: number, dy: number},
 *   clip: {x: number, y: number, width: number, height: number} | null,
 * }}
 *   - `box`: the new MediaBox/CropBox, in unrotated space.
 *   - `content`: the transform for the content stream (x' = s*x + tx,
 *     y' = s*y + ty); null when the content stays where it is and only the box
 *     moves around it (keep size).
 *   - `visual`: the same placement for what the app holds in displayed space
 *     (top-left origin, y down): x' = s*x + dx, y' = s*y + dy.
 *   - `clip`: the part of the content that stays visible, in the old
 *     coordinates of the content; null without margins, when nothing is clipped.
 */
export function resizeGeometry({ crop, rotation, targetW, targetH, margins, scaleContent = false }) {
  const rot = quarterTurn(rotation);
  const rotated = rot === 90 || rot === 270;
  const shown = normalizeMargins(margins);
  const own = unrotatedMargins(shown, rot);
  const withMargins = hasMargins(shown);

  // Displayed size of the page as it is now.
  const visualOldW = rotated ? crop.height : crop.width;
  const visualOldH = rotated ? crop.width : crop.height;

  // New box in unrotated space (dimensions swapped on a quarter-turned page,
  // so the displayed result has the size that was asked for).
  const unrotW = rotated ? targetH : targetW;
  const unrotH = rotated ? targetW : targetH;

  // The area between the margins: in unrotated space, and as displayed.
  const areaW = unrotW - own.left - own.right;
  const areaH = unrotH - own.bottom - own.top;
  const visualAreaW = targetW - shown.left - shown.right;
  const visualAreaH = targetH - shown.top - shown.bottom;

  if (scaleContent) {
    // A new page at the origin; the content shrinks or grows by one factor and
    // is centred between the margins.
    const fit = schaalVoorPassen(crop.width, crop.height, areaW, areaH);
    const placedX = own.left + fit.dx;
    const placedY = own.bottom + fit.dy;
    const seen = schaalVoorPassen(visualOldW, visualOldH, visualAreaW, visualAreaH);
    return {
      box: { x: 0, y: 0, width: unrotW, height: unrotH },
      content: { s: fit.s, tx: placedX - fit.s * crop.x, ty: placedY - fit.s * crop.y },
      visual: { s: seen.s, dx: shown.left + seen.dx, dy: shown.top + seen.dy },
      // The whole old page fits between the margins; the clip only keeps what
      // was drawn outside the old CropBox from showing up in the margins.
      clip: withMargins ? { x: crop.x, y: crop.y, width: crop.width, height: crop.height } : null,
    };
  }

  // Keep size: the content stays where it is and the new box is laid around
  // it, so that the centre of the old page is the centre of the margin area.
  const box = {
    x: crop.x + crop.width / 2 - (own.left + areaW / 2),
    y: crop.y + crop.height / 2 - (own.bottom + areaH / 2),
    width: unrotW,
    height: unrotH,
  };
  let clip = null;
  if (withMargins) {
    // What stays visible: the old page, as far as it lies between the margins.
    const x0 = Math.max(crop.x, box.x + own.left);
    const y0 = Math.max(crop.y, box.y + own.bottom);
    const x1 = Math.min(crop.x + crop.width, box.x + unrotW - own.right);
    const y1 = Math.min(crop.y + crop.height, box.y + unrotH - own.top);
    clip = { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
  }
  return {
    box,
    content: null,
    visual: {
      s: 1,
      dx: shown.left + (visualAreaW - visualOldW) / 2,
      dy: shown.top + (visualAreaH - visualOldH) / 2,
    },
    clip,
  };
}
