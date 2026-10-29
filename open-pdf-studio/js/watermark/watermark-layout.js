// Placement of text and image watermarks, shared by the screen
// (watermark-renderer.js) and the saved file (pdf/saver/watermark-content.js),
// so both always put a watermark in the same place (#847).
//
// Coordinates are display space: points from the top-left corner of the page
// as it is shown (after CropBox and /Rotate), y downwards. A position is the
// centre of the watermark; it rotates around that centre.

import { StandardFontEmbedder } from 'pdf-lib';
import { toWinAnsiText } from '../pdf/saver/pdf-text.js';

/** Distance between a corner watermark and the page edges. */
export const WATERMARK_MARGIN = 40;

export function watermarkFont(family) {
  const name = String(family || '').toLowerCase();
  return name.includes('courier') ? 'Courier' : name.includes('times') ? 'Times-Roman' : 'Helvetica';
}

const embedders = new Map();
function metricsOf(family) {
  const name = watermarkFont(family);
  if (!embedders.has(name)) embedders.set(name, StandardFontEmbedder.for(name));
  return embedders.get(name);
}

/** The text as the standard font can draw it (WinAnsi, one line). */
export function watermarkText(wm) {
  return toWinAnsiText(wm?.text || '', { newlines: 'space' });
}

/**
 * Width of the text as a plain Tj draws it: the sum of the glyph advances,
 * without kerning (the PDF does not kern, and the screen draws without it).
 */
export function watermarkTextWidth(family, text, size) {
  const embedder = metricsOf(family);
  let units = 0;
  for (const glyph of embedder.encodeTextAsGlyphs(text)) units += embedder.widthOfGlyph(glyph.name);
  return (units / 1000) * size;
}

// Use the same alphabetic baseline in Canvas and PDF: the box between
// ascender and descender is centred on the watermark position.
export function watermarkBaseline(family, size) {
  const { Ascender, Descender } = metricsOf(family).font;
  return ((Ascender + Descender) / 2000) * size;
}

/** Width and height (ascender to descender) of a text watermark at `size`. */
export function watermarkTextBox(wm, size = wm?.fontSize || 72) {
  const { Ascender, Descender } = metricsOf(wm?.fontFamily).font;
  return {
    width: watermarkTextWidth(wm?.fontFamily, watermarkText(wm), size),
    height: ((Ascender - Descender) / 1000) * size,
  };
}

/**
 * Centre of a watermark of `width` x `height`. Corner positions keep the
 * rotated box WATERMARK_MARGIN away from both page edges.
 */
export function watermarkPosition(wm, pageWidth, pageHeight, width = 0, height = 0) {
  const a = ((wm?.rotation || 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(a)), sin = Math.abs(Math.sin(a));
  const hx = (cos * width + sin * height) / 2 + WATERMARK_MARGIN;
  const hy = (sin * width + cos * height) / 2 + WATERMARK_MARGIN;
  switch (wm?.position) {
    case 'top-left': return { x: hx, y: hy };
    case 'top-right': return { x: pageWidth - hx, y: hy };
    case 'bottom-left': return { x: hx, y: pageHeight - hy };
    case 'bottom-right': return { x: pageWidth - hx, y: pageHeight - hy };
    case 'custom': return { x: wm.customX ?? pageWidth / 2, y: wm.customY ?? pageHeight / 2 };
    default: return { x: pageWidth / 2, y: pageHeight / 2 };
  }
}

/**
 * Everything needed to draw a text watermark on a page of this display size:
 * the text, its size and width, the centre and the baseline offset below it.
 */
export function watermarkTextPlacement(wm, pageWidth, pageHeight) {
  const size = wm?.fontSize || 72;
  const text = watermarkText(wm);
  const box = watermarkTextBox(wm, size);
  return {
    text, size, width: box.width,
    baseline: watermarkBaseline(wm?.fontFamily, size),
    ...watermarkPosition(wm, pageWidth, pageHeight, box.width, box.height),
  };
}

/**
 * A Custom X/Y field: blank or nonsense is "not set" (the page centre), 0 is
 * a real position.
 */
export function parseCustomCoordinate(value) {
  if (value === null || value === undefined || String(value).trim() === '') return undefined;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Where a watermark is now, as Custom X/Y (0.1 pt): switching to Custom then
 * keeps it in place instead of jumping to the top-left corner.
 */
export function watermarkCustomPosition(wm, pageWidth, pageHeight) {
  let pos;
  if (wm?.type === 'imageWatermark') {
    const scale = wm.scale ?? 1;
    pos = watermarkPosition(wm, pageWidth, pageHeight, (wm.width || 200) * scale, (wm.height || 200) * scale);
  } else {
    pos = watermarkTextPlacement(wm, pageWidth, pageHeight);
  }
  const round = (v) => Math.round(v * 10) / 10;
  return { x: round(pos.x), y: round(pos.y) };
}

// Display coordinates, bottom-left origin, to PDF user space (CropBox/Rotate).
export function watermarkPageMatrix(rotation, { x, y, width, height }) {
  switch (((rotation % 360) + 360) % 360) {
    case 90: return [0, 1, -1, 0, x + width, y];
    case 180: return [-1, 0, 0, -1, x + width, y + height];
    case 270: return [0, -1, 1, 0, x, y + height];
    default: return [1, 0, 0, 1, x, y];
  }
}
