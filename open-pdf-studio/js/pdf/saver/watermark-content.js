// Ordinary watermarks have identifiable streams and editable definitions,
// just like header/footer content. Never remove unmarked document content.
import {
  PDFName, PDFArray, PDFDict, PDFStream, PDFRef, PDFString, PDFHexString,
  degrees, rgb, drawText, drawImage, pushGraphicsState, popGraphicsState,
  concatTransformationMatrix, pdfDocEncodingDecode, encodeToBase64,
} from 'pdf-lib';
import { embedPngSnel } from '../embed-png-rust.js';
import { bytesUitBase64 } from '../../annotations/afbeelding-bron.js';
import { watermarkFont, watermarkPosition, watermarkTextPlacement, watermarkPageMatrix } from '../../watermark/watermark-layout.js';
import { vasteResourceSleutel, zetPaginaResource, deelResourcesWeer } from './gedeelde-resources.js';

import { verwijderOnbereikbareSelectie } from './objecten-opruimen.js';

const IMAGE_REFS = PDFName.of('OPS_WatermarkImages');
const imageKey = id => PDFName.of(PDFHexString.fromText(id).asString());
const KEY = 'OPS_Watermark';
const RESOURCES = 'OPS_WatermarkResources';
const FIELDS = ['id', 'type', 'text', 'fontFamily', 'fontSize', 'autoFit', 'color', 'imageData', 'width', 'height',
  'scale', 'opacity', 'rotation', 'position', 'customX', 'customY', 'layer', 'pageRange', 'customPages', 'enabled'];
const supported = w => w && ['textWatermark', 'imageWatermark'].includes(w.type) && typeof w.id === 'string' && w.id;
function textOf(x) {
  if (!(x instanceof PDFString || x instanceof PDFHexString)) return null;
  const bytes = x.asBytes();
  // pdf-lib's decodeText spreads every code point into one function call.
  // Image definitions can exceed that engine/platform-dependent argument limit.
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    text += pdfDocEncodingDecode(bytes.subarray(offset, offset + 8192));
  }
  return text;
}
function contents(page) {
  const value = page.node.context.lookup(page.node.get(PDFName.of('Contents')));
  return value instanceof PDFArray ? value : null;
}
function idOf(pdf, ref) {
  const stream = pdf.context.lookup(ref);
  return stream instanceof PDFStream ? textOf(stream.dict.lookup(PDFName.of(KEY))) : null;
}
export function watermarkIds(pdf) {
  const ids = new Set();
  for (const page of pdf.getPages()) {
    const list = contents(page);
    for (let i = 0; list && i < list.size(); i++) { const id = idOf(pdf, list.get(i)); if (id) ids.add(id); }
  }
  return ids;
}
export function readWatermarkDefinitions(pdf) {
  try {
    const list = JSON.parse(textOf(pdf.catalog.lookup(PDFName.of(KEY))) || '[]');
    if (!Array.isArray(list)) return [];
    const images = pdf.catalog.lookup(IMAGE_REFS);
    const encoded = new Map();
    return list.filter(supported).map(w => {
      const definition = Object.fromEntries(FIELDS.filter(k => w[k] !== undefined).map(k => [k, w[k]]));
      if (images instanceof PDFDict && /^data:image\/jpe?g;base64,$/i.test(definition.imageData)) {
        const stream = images.lookup(imageKey(w.id));
        if (stream instanceof PDFStream && stream.dict.get(PDFName.of('Filter')) === PDFName.of('DCTDecode')) {
          if (!encoded.has(stream)) encoded.set(stream, encodeToBase64(stream.getContents()));
          definition.imageData += encoded.get(stream);
        }
      }
      return definition;
    });
  } catch { return []; }
}
export function removeWatermarkStreams(pdf, ids = null, onImage = null) {
  let removed = 0;
  const refs = new Set();
  for (const page of pdf.getPages()) {
    const list = contents(page);
    for (let i = (list?.size() || 0) - 1; i >= 0; i--) {
      const ref = list.get(i), id = idOf(pdf, ref);
      if (!id || (ids && !ids.has(id))) continue;
      const resources = pdf.context.lookup(page.node.getInheritableAttribute(PDFName.of('Resources')));
      const keys = pdf.context.lookup(ref).dict.lookup(PDFName.of(RESOURCES));
      if (keys instanceof PDFDict && resources instanceof PDFDict) {
        for (const [category, key] of keys.entries()) {
          const dict = resources.lookup(category);
          if (dict instanceof PDFDict) {
            if (onImage && category === PDFName.of('XObject')) onImage(id, dict.get(key));
            dict.delete(key);
          }
        }
      }
      list.remove(i); removed++;
      if (ref instanceof PDFRef) refs.add(ref);
    }
  }
  for (const ref of refs) pdf.context.delete(ref);
  return removed;
}

async function embedImage(pdf, imageData) {
  try {
    const bytes = bytesUitBase64(imageData.split(',')[1]);
    return /^data:image\/jpe?g/i.test(imageData) ? await pdf.embedJpg(bytes) : await embedPngSnel(pdf, bytes);
  } catch (e) {
    console.warn('Failed to embed watermark image:', e);
    return null;
  }
}

export async function writeWatermarkContent(pdf, watermarks, { known = [], pageRange, annulering = null } = {}) {
  const current = watermarks.filter(supported);
  const replace = new Set([...known, ...current.map(w => w.id)]);
  const previous = readWatermarkDefinitions(pdf);
  const unknown = previous.filter(w => !replace.has(w.id));
  const previousData = new Map(previous.map(w => [w.id, w.imageData]));
  const images = new Map(), candidates = new Set();
  function markImage(ref, keep) {
    const stream = pdf.context.lookup(ref);
    if (!(stream instanceof PDFStream) || stream.dict.get(PDFName.of('Subtype')) !== PDFName.of('Image')) return false;
    for (const item of [ref, stream.dict.get(PDFName.of('SMask')), stream.dict.get(PDFName.of('Mask'))]) {
      if (!(item instanceof PDFRef)) continue;
      if (keep) candidates.delete(item);
      else candidates.add(item);
    }
    return true;
  }
  const remember = (id, ref) => {
    if (!(ref instanceof PDFRef) || !markImage(ref, false)) return;
    const data = previousData.get(id);
    if (data) images.set(data, { ref });
  };
  const oldImages = pdf.catalog.lookup(IMAGE_REFS);
  if (oldImages instanceof PDFDict) {
    for (const w of previous) remember(w.id, oldImages.get(imageKey(w.id)));
  }
  removeWatermarkStreams(pdf, replace, remember);
  const pages = pdf.getPages(), written = new Set(), fonts = new Map();
  // Both layers are above PDF page content in the existing viewer.
  // Keep their existing order: behind overlays first, then front overlays.
  const ordered = [...current.filter(w => (w.layer || 'behind') === 'behind'),
    ...current.filter(w => w.layer === 'infront')];
  for (const wm of ordered) {
    if (!wm.enabled) continue;
    let font, img;
    if (wm.type === 'textWatermark') {
      const name = watermarkFont(wm.fontFamily);
      if (!fonts.has(name)) fonts.set(name, await pdf.embedFont(name));
      font = fonts.get(name);
    } else if (wm.imageData) {
      if (!images.has(wm.imageData)) {
        const embedded = await embedImage(pdf, wm.imageData);
        if (embedded) await embedded.embed();
        images.set(wm.imageData, embedded);
      }
      img = images.get(wm.imageData);
      // An image that cannot be embedded is skipped; its definition stays editable.
      if (!img) continue;
    } else continue;
    // One graphics state and fixed resource names per watermark: pages that
    // share one /Resources dictionary (drawing sets) get each name once
    // instead of a new random one per page, which grew the file quadratically.
    const gsRef = pdf.context.register(pdf.context.obj({ Type: 'ExtGState', ca: wm.opacity ?? (img ? 0.2 : 0.3) }));
    const gsKey = vasteResourceSleutel('OPSWMGS', wm.id);
    const contentKey = vasteResourceSleutel(font ? 'OPSWMF' : 'OPSWMX', wm.id);
    const chosen = wm.pageRange === 'first' ? [1] : wm.pageRange === 'custom' && wm.customPages
      ? pageRange(wm.customPages, pages.length) : pages.map((_, i) => i + 1);
    for (const number of chosen) {
      if (annulering) await annulering.punt();
      const page = pages[number - 1]; if (!page) continue;
      const crop = page.getCropBox(), rotation = ((page.getRotation().angle % 360) + 360) % 360;
      const quarter = rotation === 90 || rotation === 270;
      const pw = quarter ? crop.height : crop.width, ph = quarter ? crop.width : crop.height;
      const width = img ? (wm.width || 200) * (wm.scale ?? 1) : 0;
      const height = img ? (wm.height || 200) * (wm.scale ?? 1) : 0;
      const placed = font ? watermarkTextPlacement(wm, pw, ph) : null;
      const pos = placed || watermarkPosition(wm, pw, ph, width, height);
      const radians = -(wm.rotation || 0) * Math.PI / 180;
      const ops = [pushGraphicsState(), concatTransformationMatrix(...watermarkPageMatrix(rotation, crop)),
        concatTransformationMatrix(Math.cos(radians), Math.sin(radians), -Math.sin(radians), Math.cos(radians), pos.x, ph - pos.y)];
      const keys = {};
      const gs = zetPaginaResource(page, 'ExtGState', gsKey, gsRef);
      keys.ExtGState = gs;
      if (font) {
        const color = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(wm.color || '#ff0000');
        keys.Font = zetPaginaResource(page, 'Font', contentKey, font.ref);
        // The unkerned advance: a plain Tj does not kern (watermark-layout.js).
        ops.push(...drawText(font.encodeText(placed.text), { font: keys.Font, size: placed.size, color: color ? rgb(...color.slice(1).map(v => parseInt(v, 16) / 255)) : rgb(0, 0, 0),
          x: -placed.width / 2, y: -placed.baseline,
          rotate: degrees(0), xSkew: degrees(0), ySkew: degrees(0), graphicsState: gs }));
      } else {
        keys.XObject = zetPaginaResource(page, 'XObject', contentKey, img.ref);
        ops.push(...drawImage(keys.XObject, { x: -width / 2, y: -height / 2, width, height,
          rotate: degrees(0), xSkew: degrees(0), ySkew: degrees(0), graphicsState: gs }));
      }
      ops.push(popGraphicsState());
      const ref = pdf.context.register(pdf.context.contentStream(ops, { [KEY]: PDFHexString.fromText(wm.id), [RESOURCES]: keys }));
      // Normalize/wrap original content before attaching independent streams.
      page.node.normalize();
      page.node.addContentStream(ref);
      written.add(wm.id);
    }
  }
  // normalize() put shared /Resources on every page as a copy.
  deelResourcesWeer(pdf);
  const definitions = [...unknown, ...current].map(w => Object.fromEntries(FIELDS.filter(k => w[k] !== undefined).map(k => [k, w[k]])));
  const imageRefs = pdf.context.obj({});
  for (const w of definitions) {
    const ref = w.type === 'imageWatermark' && images.get(w.imageData)?.ref;
    if (!ref) continue;
    imageRefs.set(imageKey(w.id), ref);
    markImage(ref, true);
    // JPEG XObjects preserve the exact file bytes. PNG XObjects contain decoded pixels.
    if (/^data:image\/jpe?g;base64,/i.test(w.imageData)) w.imageData = w.imageData.slice(0, w.imageData.indexOf(',') + 1);
  }
  if (imageRefs.keys().length) pdf.catalog.set(IMAGE_REFS, imageRefs);
  else pdf.catalog.delete(IMAGE_REFS);
  if (definitions.length) pdf.catalog.set(PDFName.of(KEY), PDFHexString.fromText(JSON.stringify(definitions)));
  else pdf.catalog.delete(PDFName.of(KEY));
  verwijderOnbereikbareSelectie(pdf.context, candidates);
  return [...written];
}
