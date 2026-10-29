import { Font } from '@pdf-lib/standard-fonts';

export function watermarkFont(family) {
  const name = String(family || '').toLowerCase();
  return name.includes('courier') ? 'Courier' : name.includes('times') ? 'Times-Roman' : 'Helvetica';
}

// Use the same alphabetic baseline in Canvas and PDF, rather than rotating
// the PDF text's left edge around the center of a centered Canvas preview.
export function watermarkBaseline(family, size) {
  const font = Font.load(watermarkFont(family));
  return ((font.Ascender + font.Descender) / 2000) * size;
}

export function watermarkPosition(wm, pageWidth, pageHeight, width = 0, height = 0) {
  switch (wm.position) {
    case 'top-left': return { x: width / 2 + 40, y: height / 2 + 40 };
    case 'top-right': return { x: pageWidth - width / 2 - 40, y: height / 2 + 40 };
    case 'bottom-left': return { x: width / 2 + 40, y: pageHeight - height / 2 - 40 };
    case 'bottom-right': return { x: pageWidth - width / 2 - 40, y: pageHeight - height / 2 - 40 };
    case 'custom': return { x: wm.customX ?? pageWidth / 2, y: wm.customY ?? pageHeight / 2 };
    default: return { x: pageWidth / 2, y: pageHeight / 2 };
  }
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
