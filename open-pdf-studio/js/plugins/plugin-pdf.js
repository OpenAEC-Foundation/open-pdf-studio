import { PDFName, PDFString } from 'pdf-lib';
import { pdfTextString, decodePdfTextObject } from '../pdf/saver/pdf-text.js';

const MAX_METADATA_LENGTH = 2_000_000;

/** Rasterize the plugin's normal renderer for a PDF /AP image. */
export function renderPluginAnnotationPng(annotation, handler, pageRotation = 0, createCanvas = () => document.createElement('canvas')) {
  if (typeof handler?.render !== 'function') throw new Error('Persistent plugin annotation needs a render handler');
  const bounds = handler.getBounds?.(annotation) || annotation;
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
      bounds.width <= 0 || bounds.height <= 0) throw new RangeError('Plugin annotation needs finite bounds');
  const scale = Math.min(4, 2048 / Math.max(bounds.width, bounds.height));
  const canvas = createCanvas();
  canvas.width = Math.max(1, Math.ceil(bounds.width * scale));
  canvas.height = Math.max(1, Math.ceil(bounds.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Cannot render plugin appearance');
  ctx.setTransform(scale, 0, 0, scale, -bounds.x * scale, -bounds.y * scale);
  handler.render(ctx, annotation);
  const rotation = ((pageRotation % 360) + 360) % 360;
  let output = canvas;
  if (rotation) {
    if (![90, 180, 270].includes(rotation)) throw new RangeError('Unsupported page rotation');
    output = createCanvas();
    output.width = rotation === 180 ? canvas.width : canvas.height;
    output.height = rotation === 180 ? canvas.height : canvas.width;
    const rotated = output.getContext('2d');
    if (!rotated) throw new Error('Cannot rotate plugin appearance');
    if (rotation === 90) { rotated.translate(0, output.height); rotated.rotate(-Math.PI / 2); }
    else if (rotation === 180) { rotated.translate(output.width, output.height); rotated.rotate(Math.PI); }
    else { rotated.translate(output.width, 0); rotated.rotate(Math.PI / 2); }
    rotated.drawImage(canvas, 0, 0);
  }
  const encoded = output.toDataURL('image/png').split(',')[1];
  return Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
}

/** Build a standard visible PDF annotation with private editable metadata. */
export async function createPluginPdfAnnotation(pdfDoc, annotation, rect, pngBytes) {
  if (![...rect].every(Number.isFinite) || rect[2] <= rect[0] || rect[3] <= rect[1]) {
    throw new RangeError('Plugin annotation requires a positive PDF rectangle');
  }
  const data = JSON.stringify(annotation);
  if (!data || data.length > MAX_METADATA_LENGTH) throw new RangeError('Plugin annotation metadata is too large');
  const context = pdfDoc.context;
  const dict = context.obj({
    Type: 'Annot', Subtype: 'Square', Rect: rect,
    F: annotation.printable === false ? 0 : 4,
    NM: pdfTextString(annotation.id),
    Contents: pdfTextString(annotation.subject || ''),
    OPS_Subtype: PDFString.of('plugin'),
    OPS_PluginData: pdfTextString(data),
  });
  const image = await pdfDoc.embedPng(pngBytes);
  const width = rect[2] - rect[0];
  const height = rect[3] - rect[1];
  const stream = context.stream(`q\n${width} 0 0 ${height} 0 0 cm\n/Img Do\nQ\n`, {
    Type: 'XObject', Subtype: 'Form', BBox: [0, 0, width, height],
    Resources: context.obj({ XObject: context.obj({ Img: image.ref }) }),
  });
  dict.set(PDFName.of('AP'), context.obj({ N: context.register(stream) }));
  return dict;
}

/** Return only annotations written by the plugin persistence contract. */
export function readPluginPdfAnnotation(dict, context) {
  const subtype = dict.get(PDFName.of('OPS_Subtype'));
  if (decodePdfTextObject(context.lookup(subtype) || subtype) !== 'plugin') return null;
  const raw = dict.get(PDFName.of('OPS_PluginData'));
  const data = decodePdfTextObject(context.lookup(raw) || raw);
  if (!data || data.length > MAX_METADATA_LENGTH) return null;
  try {
    const annotation = JSON.parse(data);
    if (!annotation || typeof annotation !== 'object' || Array.isArray(annotation) ||
        typeof annotation.id !== 'string' || typeof annotation.type !== 'string') return null;
    return annotation;
  } catch {
    return null;
  }
}
