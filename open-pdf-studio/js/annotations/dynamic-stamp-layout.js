// Layout of a dynamic stamp (#629), shared by the canvas drawing and the PDF
// appearance so both show the same thing. Pure: text widths come from the
// Helvetica metrics in pdf-lib (the font the appearance uses; Arial on screen
// has the same widths).
//
// Coordinates: the stamp's natural size in points, origin top-left, y down.
// fitLayout() scales that uniformly into the annotation box.

import { StandardFontEmbedder, StandardFonts } from 'pdf-lib';
import { resolveLines } from './dynamic-stamp.js';

let embedders = null;
const widthCache = new Map();

function embedder(bold) {
  if (!embedders) {
    embedders = {
      regular: StandardFontEmbedder.for(StandardFonts.Helvetica),
      bold: StandardFontEmbedder.for(StandardFonts.HelveticaBold),
    };
  }
  return bold ? embedders.bold : embedders.regular;
}

// Width of one character at size 1000; characters outside WinAnsi (they are
// replaced in the PDF) get a typical width: wide for CJK, else average.
function charWidth(ch, bold) {
  const k = (bold ? 'b' : 'r') + ch;
  let w = widthCache.get(k);
  if (w === undefined) {
    try {
      w = embedder(bold).widthOfTextAtSize(ch, 1000);
    } catch (_) {
      const cp = ch.codePointAt(0);
      w = cp >= 0x2e80 ? 1000 : 600;
    }
    widthCache.set(k, w);
  }
  return w;
}

/** Width of a text in points at the given font size. */
export function measureStampText(text, fontSize, bold = false) {
  let w = 0;
  for (const ch of String(text ?? '')) w += charWidth(ch, bold);
  return (w * fontSize) / 1000;
}

const LINE_HEIGHT = 1.2;

/**
 * @param {object} template  normalised template
 * @param {object} values    field values
 * @param {(text:string, size:number, bold:boolean)=>number} [measure]
 * @returns {{width:number, height:number, lines:Array<{text:string,x:number,baseline:number,fontSize:number,bold:boolean,width:number}>,
 *   image:null|{x:number,y:number,width:number,height:number}, borderWidth:number, border:string, radius:number}}
 */
export function layoutDynamicStamp(template, values, measure = measureStampText) {
  const resolved = resolveLines(template, values);
  const maxFont = resolved.reduce((m, l) => Math.max(m, l.fontSize), 8);
  const bw = template.border === 'none' ? 0 : (template.borderWidth || 0);
  const pad = Math.max(4, Math.round(maxFont * 0.35)) + bw;
  const measured = resolved.map((l) => ({ ...l, width: measure(l.text, l.fontSize, l.bold), height: l.fontSize * LINE_HEIGHT }));
  const blockW = Math.max(20, ...measured.map((l) => l.width));
  const blockH = measured.reduce((s, l) => s + l.height, 0);

  let image = null;
  let textX = pad;
  let contentH = blockH;
  if (template.image && template.image.width > 0 && template.image.height > 0) {
    const ih = Math.max(blockH, 24);
    const iw = ih * (template.image.width / template.image.height);
    image = { x: pad, y: pad, width: iw, height: ih };
    textX = pad + iw + pad * 0.6;
    contentH = Math.max(blockH, ih);
  }
  const width = textX + blockW + pad;
  const height = contentH + pad * 2;

  let y = pad + (contentH - blockH) / 2;
  const lines = measured.map((l) => {
    let x = textX;
    if (l.align === 'center') x = textX + (blockW - l.width) / 2;
    else if (l.align === 'right') x = textX + blockW - l.width;
    // Baseline: the cap height (≈0.72 em) centred in the line box.
    const baseline = y + l.height / 2 + l.fontSize * 0.36;
    y += l.height;
    return { text: l.text, x, baseline, fontSize: l.fontSize, bold: l.bold, width: l.width };
  });
  const radius = template.border === 'rounded' ? Math.min(width, height) * 0.12 : 0;
  return { width, height, lines, image, borderWidth: bw, border: template.border, radius };
}

/**
 * Uniform scale + offset that fits the natural layout into a box of w × h.
 * The border always follows the full box (see the drawing code).
 */
export function fitLayout(layout, w, h) {
  const scale = Math.min(w / layout.width, h / layout.height);
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return { scale: s, dx: (w - layout.width * s) / 2, dy: (h - layout.height * s) / 2 };
}

/**
 * Natural size of a stamp, for placing: the layout size in points.
 */
export function naturalStampSize(template, values) {
  const l = layoutDynamicStamp(template, values);
  return { width: l.width, height: l.height };
}

/**
 * After a field edit: give the box the size of the new content at the scale
 * the stamp had, around the same centre, so a longer value does not shrink
 * the text. `before` is the dynamicStamp before the edit.
 */
export function refitAfterEdit(ann, before) {
  if (!ann?.dynamicStamp || !before?.template) return false;
  const oud = layoutDynamicStamp(before.template, before.values || {});
  const nieuw = layoutDynamicStamp(ann.dynamicStamp.template, ann.dynamicStamp.values || {});
  const { scale } = fitLayout(oud, ann.width, ann.height);
  const w = nieuw.width * scale, h = nieuw.height * scale;
  if (Math.abs(w - ann.width) < 0.01 && Math.abs(h - ann.height) < 0.01) return false;
  const cx = ann.x + ann.width / 2, cy = ann.y + ann.height / 2;
  ann.width = w;
  ann.height = h;
  ann.x = cx - w / 2;
  ann.y = cy - h / 2;
  return true;
}
