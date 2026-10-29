// Page setup of new blank pages in Edit Pages (#846).
//
// A blank page gets its size the moment it is inserted, so the thumbnail and
// the page that Apply writes have exactly the same dimensions. By default it
// takes the size and orientation of the adjacent page (the one to its left,
// or to its right at the start), as that page shows; the setup can also be a
// paper size with an orientation, or a custom width and height in mm or
// inches. Sizes are in PDF points.
//
// No app imports and no DOM: tested on its own.

import { normRotation, shownSize, A4 } from './page-edit-plan.js';

const PT_PER_IN = 72;
const MM_PER_IN = 25.4;

/** Smallest and largest page side a PDF allows, in points. */
export const MIN_SIDE = 3;
export const MAX_SIDE = 14400;

/** Paper sizes, portrait, in their own unit. */
export const BLANK_PRESETS = Object.freeze({
  a4: { width: 210, height: 297, unit: 'mm', label: 'A4' },
  a3: { width: 297, height: 420, unit: 'mm', label: 'A3' },
  a2: { width: 420, height: 594, unit: 'mm', label: 'A2' },
  a1: { width: 594, height: 841, unit: 'mm', label: 'A1' },
  a0: { width: 841, height: 1189, unit: 'mm', label: 'A0' },
  letter: { width: 8.5, height: 11, unit: 'in', label: 'Letter' },
  legal: { width: 8.5, height: 14, unit: 'in', label: 'Legal' },
});

export const BLANK_MODES = Object.freeze(['adjacent', 'preset', 'custom']);
export const BLANK_UNITS = Object.freeze(['mm', 'in']);

export const DEFAULT_BLANK_SETUP = Object.freeze({
  mode: 'adjacent', preset: 'a4', orientation: 'portrait', width: 210, height: 297, unit: 'mm',
});

const round2 = (n) => Math.round(n * 100) / 100;
const clampSide = (pt) => Math.min(MAX_SIDE, Math.max(MIN_SIDE, pt));
const positive = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;

/** A length in `unit` ('mm' or 'in') in points, to 0.01 pt. */
export function toPoints(value, unit) {
  const inches = unit === 'in' ? value : value / MM_PER_IN;
  return round2(inches * PT_PER_IN);
}

/** Points in `unit` ('mm' or 'in'), to 0.01. */
export function fromPoints(pt, unit) {
  const inches = pt / PT_PER_IN;
  return round2(unit === 'in' ? inches : inches * MM_PER_IN);
}

export function convertLength(value, from, to) {
  if (from === to) return value;
  const inches = from === 'in' ? value : value / MM_PER_IN;
  return round2(to === 'in' ? inches : inches * MM_PER_IN);
}

/** Size of a paper size in points, portrait. */
export function presetSize(preset) {
  const p = BLANK_PRESETS[preset] || BLANK_PRESETS.a4;
  return { width: toPoints(p.width, p.unit), height: toPoints(p.height, p.unit) };
}

/** A setup as stored in the preferences, with anything invalid replaced by the default. */
export function normalizeBlankSetup(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_BLANK_SETUP;
  return {
    mode: BLANK_MODES.includes(s.mode) ? s.mode : d.mode,
    preset: Object.hasOwn(BLANK_PRESETS, s.preset) ? s.preset : d.preset,
    orientation: s.orientation === 'landscape' || s.orientation === 'portrait' ? s.orientation : d.orientation,
    width: positive(s.width) ? s.width : d.width,
    height: positive(s.height) ? s.height : d.height,
    unit: BLANK_UNITS.includes(s.unit) ? s.unit : d.unit,
  };
}

function orient({ width, height }, orientation) {
  const landscape = width > height;
  return (orientation === 'landscape') === landscape || width === height ? { width, height } : { width: height, height: width };
}

/**
 * Size in points of a new blank page with this setup. `adjacent` is the size
 * the adjacent page shows (see shownEntrySize); "same as adjacent" without
 * one gives A4.
 */
export function blankSizeFromSetup(setup, adjacent = null) {
  const s = normalizeBlankSetup(setup);
  if (s.mode === 'adjacent') {
    return adjacent && positive(adjacent.width) && positive(adjacent.height)
      ? { width: adjacent.width, height: adjacent.height }
      : { ...A4 };
  }
  if (s.mode === 'preset') return orient(presetSize(s.preset), s.orientation);
  return { width: clampSide(toPoints(s.width, s.unit)), height: clampSide(toPoints(s.height, s.unit)) };
}

/** The orientation the setup makes; null for "same as adjacent". */
export function setupOrientation(setup) {
  const s = normalizeBlankSetup(setup);
  if (s.mode === 'adjacent') return null;
  if (s.mode === 'preset') return s.orientation;
  return s.width > s.height ? 'landscape' : 'portrait';
}

/** The setup turned to `orientation`; a custom size swaps its width and height. */
export function withOrientation(setup, orientation) {
  if (setupOrientation(setup) === orientation && setup.orientation === orientation) return setup;
  if (setup.mode === 'custom' && setupOrientation(setup) !== orientation) {
    return { ...setup, orientation, width: setup.height, height: setup.width };
  }
  return { ...setup, orientation };
}

/** The setup with its custom size in another unit. */
export function withUnit(setup, unit) {
  if (setup.unit === unit) return setup;
  return { ...setup, unit, width: convertLength(setup.width, setup.unit, unit), height: convertLength(setup.height, setup.unit, unit) };
}

/**
 * The setup in another mode. Going to custom starts from the paper size and
 * orientation that were chosen, so the fields show something sensible.
 */
export function withMode(setup, mode) {
  if (setup.mode === mode) return setup;
  if (mode === 'custom' && setup.mode === 'preset') {
    const p = BLANK_PRESETS[setup.preset] || BLANK_PRESETS.a4;
    const native = orient({ width: p.width, height: p.height }, setup.orientation);
    const width = convertLength(native.width, p.unit, setup.unit);
    const height = convertLength(native.height, p.unit, setup.unit);
    return { ...setup, mode, width, height };
  }
  return { ...setup, mode };
}

/** Width and height of a pdf.js page view [x1, y1, x2, y2], or null. */
export function viewSize(view) {
  if (!Array.isArray(view) || view.length < 4) return null;
  const width = Math.abs(view[2] - view[0]);
  const height = Math.abs(view[3] - view[1]);
  return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * The size an organizer entry shows, in points. For a page of the document
 * or of an added PDF `measured` is { view, rotate, appRotation }: the
 * effective page box (pdf.js view: the CropBox within the MediaBox), its
 * /Rotate and the app rotation; the pending turn of the entry comes on top.
 * A blank entry shows its own size turned by its pending turn.
 */
export function shownEntrySize(entry, measured = null) {
  if (!entry) return null;
  if (entry.kind === 'blank') {
    if (!positive(entry.width) || !positive(entry.height)) return null;
    return shownSize(entry.width, entry.height, entry.rotation);
  }
  const box = viewSize(measured?.view);
  if (!box) return null;
  const turn = normRotation((measured.rotate || 0) + (measured.appRotation || 0) + (entry.rotation || 0));
  return shownSize(box.width, box.height, turn);
}

/** Pixel box of a blank thumbnail in a square tile of `tile` px, before its pending turn. */
export function thumbBox(size, tile) {
  if (!size || !positive(size.width) || !positive(size.height)) return null;
  const max = tile * 0.92;
  const scale = max / Math.max(size.width, size.height);
  return { width: Math.round(size.width * scale), height: Math.round(size.height * scale) };
}
