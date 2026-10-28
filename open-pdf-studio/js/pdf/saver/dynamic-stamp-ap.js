// PDF appearance + app keys of a dynamic stamp (#629).
//
// The appearance shows the resolved text, so every reader sees the filled-in
// stamp. The template and the field values go in /OPS_DynStamp (a Flate
// stream with JSON), so the app can make the stamp editable again after
// reopening (pdf/loader/dynamic-stamp-load.js). /OPS_StampText carries the
// text as well: an older app version reads it back as a plain text stamp.
//
// Structure of the content: the same placement prefix and first clip
// rectangle as a plain text stamp (saver/stempel-draaiing.js), so the loader
// recovers box and rotation the same way (loader/stempel-geometrie.js).
//
// Only pdf-lib: testable in node.

import { PDFName, PDFHexString, PDFBool } from 'pdf-lib';
import { layoutDynamicStamp, fitLayout } from '../../annotations/dynamic-stamp-layout.js';
import { dynamicStampText } from '../../annotations/dynamic-stamp.js';
import { winAnsiLiteral } from './pdf-text.js';

export const DYN_STAMP_KEY = 'OPS_DynStamp';
export const DYN_STAMP_LOCKED_KEY = 'OPS_StampLocked';

const f = (n) => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

function rgb(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
  if (!m) return [0.75, 0, 0];
  return [1, 2, 3].map((i) => Math.round((parseInt(m[i], 16) / 255) * 1000) / 1000);
}

function boxOps(x, y, w, h, r) {
  if (!(r > 0)) return `${f(x)} ${f(y)} ${f(w)} ${f(h)} re\n`;
  const k = 0.5522847498 * r;
  const x2 = x + w, y2 = y + h;
  return `${f(x + r)} ${f(y)} m ${f(x2 - r)} ${f(y)} l ${f(x2 - r + k)} ${f(y)} ${f(x2)} ${f(y + r - k)} ${f(x2)} ${f(y + r)} c\n`
    + `${f(x2)} ${f(y2 - r)} l ${f(x2)} ${f(y2 - r + k)} ${f(x2 - r + k)} ${f(y2)} ${f(x2 - r)} ${f(y2)} c\n`
    + `${f(x + r)} ${f(y2)} l ${f(x + r - k)} ${f(y2)} ${f(x)} ${f(y2 - r + k)} ${f(x)} ${f(y2 - r)} c\n`
    + `${f(x)} ${f(y + r)} l ${f(x)} ${f(y + r - k)} ${f(x + r - k)} ${f(y)} ${f(x + r)} ${f(y)} c h\n`;
}

/**
 * Content stream of the appearance (pure; for tests too).
 * @param {object} ds         ann.dynamicStamp
 * @param {{prefix:string, visW:number, visH:number}} placement  from stempelAppearance()
 * @param {{image?: boolean}} [opts]  image: an /Im XObject is available
 * @returns {string}
 */
export function dynamicStampContent(ds, placement, { image = false } = {}) {
  const t = ds.template;
  const { prefix = '', visW, visH } = placement;
  const layout = layoutDynamicStamp(t, ds.values || {});
  const { scale, dx, dy } = fitLayout(layout, visW, visH);
  const [r, g, b] = rgb(t.color);
  const bw = layout.borderWidth * scale;
  const rad = layout.radius * scale;
  let s = `q\n${prefix}0 0 ${f(visW)} ${f(visH)} re W n\n`;
  if (t.fillColor) {
    const [fr, fg, fb] = rgb(t.fillColor);
    s += `${fr} ${fg} ${fb} rg\n${boxOps(bw / 2, bw / 2, visW - bw, visH - bw, rad)}f\n`;
  }
  if (bw > 0) s += `${f(bw)} w ${r} ${g} ${b} RG\n${boxOps(bw / 2, bw / 2, visW - bw, visH - bw, rad)}S\n`;
  if (image && layout.image) {
    const im = layout.image;
    const x0 = dx + im.x * scale;
    const y0 = visH - (dy + (im.y + im.height) * scale);
    s += `q\n${f(im.width * scale)} 0 0 ${f(im.height * scale)} ${f(x0)} ${f(y0)} cm\n/Im Do\nQ\n`;
  }
  const lines = layout.lines.filter((l) => l.text);
  if (lines.length) {
    s += `${r} ${g} ${b} rg\nBT\n`;
    for (const l of lines) {
      const x = dx + l.x * scale;
      const y = visH - (dy + l.baseline * scale);
      s += `/${l.bold ? 'F2' : 'F1'} ${f(l.fontSize * scale)} Tf\n1 0 0 1 ${f(x)} ${f(y)} Tm\n(${winAnsiLiteral(l.text)}) Tj\n`;
    }
    s += 'ET\n';
  }
  return s + 'Q\n';
}

/**
 * Write the appearance and the app keys of a dynamic stamp on `annotDict`.
 * @param {{context:any, annotDict:any, ds:object, placement:object, embedImage?:(dataUrl:string)=>Promise<any>}} args
 *   embedImage: embeds the template image, resolves to its PDFRef (or null)
 */
export async function writeDynamicStamp({ context, annotDict, ds, placement, embedImage }) {
  let imageRef = null;
  if (ds.template.image?.dataUrl && embedImage) {
    try { imageRef = await embedImage(ds.template.image.dataUrl); } catch (_) { imageRef = null; }
  }
  const content = dynamicStampContent(ds, placement, { image: !!imageRef });
  const font = (base) => context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: base, Encoding: 'WinAnsiEncoding' });
  const resources = { Font: context.obj({ F1: font('Helvetica'), F2: font('Helvetica-Bold') }) };
  if (imageRef) resources.XObject = context.obj({ Im: imageRef });
  const ap = context.stream(content, {
    Type: 'XObject', Subtype: 'Form', BBox: [0, 0, placement.bboxW, placement.bboxH],
    Resources: context.obj(resources),
  });
  annotDict.set(PDFName.of('AP'), context.obj({ N: context.register(ap) }));

  const text = dynamicStampText(ds) || ds.template.name;
  annotDict.set(PDFName.of('OPS_StampText'), PDFHexString.fromText(text));
  const json = JSON.stringify({
    v: ds.v, template: ds.template, values: ds.values, placedAt: ds.placedAt, locked: !!ds.locked,
  });
  const data = context.flateStream(new TextEncoder().encode(json), {});
  annotDict.set(PDFName.of(DYN_STAMP_KEY), context.register(data));
  if (ds.locked) annotDict.set(PDFName.of(DYN_STAMP_LOCKED_KEY), PDFBool.True);
}
