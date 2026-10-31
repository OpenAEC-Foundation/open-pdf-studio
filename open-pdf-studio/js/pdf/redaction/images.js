// Image pixels under a redaction area (#762).
//
// The samples of every pixel whose square touches a redaction area are
// overwritten with the fill colour, expressed in the image's own colour space
// (through its /Decode array), and the image is encoded again. Image masks
// (stencils) get the "not painted" value; soft masks and explicit masks are
// redacted with the same pixel mask. Flate, LZW, ASCIIHex, ASCII85 and
// RunLength data (with PNG/TIFF predictors) is decoded here; DCT, JPX, JBIG2
// and CCITT data is decoded with MuPDF (already a dependency of the app). A
// JPEG is written as a JPEG again, everything else as Flate. An image that
// cannot be decoded throws REDACTION_UNSUPPORTED_IMAGE: the caller refuses the
// redaction instead of leaving the pixels in the file.

import { decodePDFRawStream } from 'pdf-lib';
import {
  N, PDFArray, PDFDict, PDFName, PDFRawStream, PDFStream, PDFRef, get, nameOf, numOf, numbers, resolve, applyPredictor,
} from './pdf-values.js';
import { mul, invert, clipHalfPlane, bboxOf, normaliseConvex } from './geometry.js';

const SIMPLE_FILTERS = new Set(['FlateDecode', 'LZWDecode', 'ASCIIHexDecode', 'ASCII85Decode', 'RunLengthDecode']);
const MUPDF_FILTERS = new Set(['DCTDecode', 'JPXDecode', 'JBIG2Decode', 'CCITTFaxDecode']);

const unsupported = (detail) => Object.assign(new Error('REDACTION_UNSUPPORTED_IMAGE'), { code: 'REDACTION_UNSUPPORTED_IMAGE', detail });

let _mupdf = null;
async function mupdfModule() {
  if (!_mupdf) _mupdf = import('mupdf');
  return _mupdf;
}

/**
 * Pixel mask (1 = covered) of a W×H image drawn under `ctm` for convex
 * page-space regions. Null when no pixel is covered.
 */
export function coveredPixels(W, H, ctm, regions) {
  // Page → image pixel space (x right, y down from the top row).
  const toUnit = invert(ctm);
  if (!toUnit) return null;
  const M = mul(toUnit, [W, 0, 0, -H, 0, H]);
  let mask = null;
  let count = 0;
  for (const region of regions) {
    const poly = normaliseConvex(region.map(([x, y]) => [x * M[0] + y * M[2] + M[4], x * M[1] + y * M[3] + M[5]]));
    if (!poly) continue;
    const [, y0, , y1] = bboxOf(poly);
    const jStart = Math.max(0, Math.floor(y0)), jEnd = Math.min(H - 1, Math.ceil(y1) - 1);
    for (let j = jStart; j <= jEnd; j++) {
      // The part of the polygon inside the row strip j ≤ y ≤ j+1.
      let strip = clipHalfPlane(poly, 0, 1, -j);
      strip = clipHalfPlane(strip, 0, -1, j + 1);
      if (!strip.length) continue;
      const [sx0, , sx1] = bboxOf(strip);
      const iStart = Math.max(0, Math.floor(sx0)), iEnd = Math.min(W - 1, Math.max(Math.ceil(sx1) - 1, Math.floor(sx0)));
      for (let i = iStart; i <= iEnd; i++) {
        if (!mask) mask = new Uint8Array(W * H);
        if (!mask[j * W + i]) { mask[j * W + i] = 1; count++; }
      }
    }
  }
  return count ? mask : null;
}

/** Colour space description: components and how to express the fill colour. */
function colourSpace(context, cs, resources, depth = 0) {
  cs = resolve(context, cs);
  if (depth > 6) return null;
  if (cs instanceof PDFName) {
    const n = cs.decodeText();
    if (n === 'DeviceGray' || n === 'CalGray' || n === 'G') return { n: 1, kind: 'gray' };
    if (n === 'DeviceRGB' || n === 'CalRGB' || n === 'RGB') return { n: 3, kind: 'rgb' };
    if (n === 'DeviceCMYK' || n === 'CMYK') return { n: 4, kind: 'cmyk' };
    // Named resource (inline images).
    const named = resources ? get(context, get(context, resources, 'ColorSpace'), n) : undefined;
    if (named !== undefined) return colourSpace(context, named, null, depth + 1);
    return null;
  }
  if (cs instanceof PDFArray) {
    const fam = nameOf(resolve(context, cs.get(0)));
    if (fam === 'CalGray') return { n: 1, kind: 'gray' };
    if (fam === 'CalRGB') return { n: 3, kind: 'rgb' };
    if (fam === 'Lab') return { n: 3, kind: 'lab' };
    if (fam === 'ICCBased') {
      const s = resolve(context, cs.get(1));
      const nComp = numOf(get(context, s, 'N'));
      if (nComp === 1) return { n: 1, kind: 'gray' };
      if (nComp === 3) return { n: 3, kind: 'rgb' };
      if (nComp === 4) return { n: 4, kind: 'cmyk' };
      return nComp ? { n: nComp, kind: 'other' } : null;
    }
    if (fam === 'Indexed' || fam === 'I') {
      const base = colourSpace(context, cs.get(1), resources, depth + 1);
      const hival = numOf(resolve(context, cs.get(2)), 0);
      let lookup = resolve(context, cs.get(3));
      let table = null;
      if (lookup instanceof PDFStream) { try { table = streamBytesOf(lookup); } catch { table = null; } }
      else if (lookup && typeof lookup.asBytes === 'function') table = lookup.asBytes();
      return { n: 1, kind: 'indexed', base, hival, table };
    }
    if (fam === 'Separation') return { n: 1, kind: 'tint' };
    if (fam === 'DeviceN') { const names = resolve(context, cs.get(1)); return { n: names instanceof PDFArray ? names.size() : 1, kind: 'tint' }; }
    if (fam === 'DeviceGray' || fam === 'DeviceRGB' || fam === 'DeviceCMYK') return colourSpace(context, cs.get(0), resources, depth + 1);
  }
  return null;
}

function streamBytesOf(stream) {
  if (stream instanceof PDFRawStream) return applyPredictor(decodePDFRawStream(stream).decode(), stream.dict.get(N('DecodeParms')), stream.dict.context);
  return stream.getUnencodedContents();
}

/** The fill colour as decoded component values (0..1, or an index) in a colour space. */
function fillComponents(cs, rgb) {
  const [r, g, b] = rgb;
  const lum = 0.3 * r + 0.59 * g + 0.11 * b;
  switch (cs.kind) {
    case 'gray': return [lum];
    case 'rgb': return [r, g, b];
    case 'cmyk': { const k = 1 - Math.max(r, g, b); const d = 1 - k || 1; return [(1 - r - k) / d, (1 - g - k) / d, (1 - b - k) / d, k]; }
    case 'lab': return [lum * 100, 0, 0];
    case 'tint': return new Array(cs.n).fill(1 - lum);
    case 'indexed': {
      // Nearest palette entry (by its base colour when that is known).
      let best = 0, bestD = Infinity;
      const bn = cs.base?.n || 0;
      if (cs.table && bn) {
        const want = fillComponents(cs.base, rgb);
        for (let i = 0; i <= cs.hival; i++) {
          let dd = 0;
          for (let k = 0; k < bn; k++) { const v = (cs.table[i * bn + k] ?? 0) / 255 - want[k]; dd += v * v; }
          if (dd < bestD) { bestD = dd; best = i; }
        }
      }
      return [best];
    }
    default: return new Array(cs.n).fill(0);
  }
}

/** Raw sample values per component, through the /Decode array. */
function sampleValues(comps, decode, bpc, cs) {
  const max = 2 ** bpc - 1;
  return comps.map((c, k) => {
    let dmin = 0, dmax = cs.kind === 'indexed' ? max : 1;
    if (cs.kind === 'lab' && !decode) { dmin = k === 0 ? 0 : -100; dmax = 100; }
    if (decode && decode.length >= 2 * (k + 1)) { dmin = decode[2 * k]; dmax = decode[2 * k + 1]; }
    if (dmax === dmin) return 0;
    const s = Math.round((c - dmin) / (dmax - dmin) * max);
    return Math.max(0, Math.min(max, s));
  });
}

/** Overwrite the covered samples of packed rows. */
function paintSamples(data, W, H, nComp, bpc, mask, values) {
  const rowBytes = Math.ceil(W * nComp * bpc / 8);
  const out = data.length >= rowBytes * H ? data.slice(0, rowBytes * H) : (() => { const o = new Uint8Array(rowBytes * H); o.set(data); return o; })();
  for (let j = 0; j < H; j++) {
    const row = j * rowBytes;
    for (let i = 0; i < W; i++) {
      if (!mask[j * W + i]) continue;
      for (let k = 0; k < nComp; k++) {
        const v = values[k];
        if (bpc === 8) out[row + i * nComp + k] = v;
        else if (bpc === 16) { const at = row + (i * nComp + k) * 2; out[at] = v >> 8; out[at + 1] = v & 255; }
        else {
          const bit = (i * nComp + k) * bpc;
          const at = row + (bit >> 3), shift = 8 - bpc - (bit & 7);
          const m = ((1 << bpc) - 1) << shift;
          out[at] = (out[at] & ~m) | ((v << shift) & m);
        }
      }
    }
  }
  return out;
}

function filtersOf(context, dict) {
  const f = resolve(context, dict instanceof Map ? null : dict.get(N('Filter')));
  if (!f) return [];
  if (f instanceof PDFName) return [f.decodeText()];
  if (f instanceof PDFArray) return f.asArray().map((x) => nameOf(resolve(context, x))).filter(Boolean);
  return [];
}

/** Decode image data to raw packed samples. Returns {data, bpc, nComp?, jpeg?, jpx?} */
async function decodeImage(context, stream, W, H, bpc, nComp) {
  const filters = filtersOf(context, stream.dict);
  if (filters.every((f) => SIMPLE_FILTERS.has(f))) {
    return { data: streamBytesOf(stream), bpc };
  }
  const last = filters[filters.length - 1];
  if (!MUPDF_FILTERS.has(last) || !filters.slice(0, -1).every((f) => SIMPLE_FILTERS.has(f))) throw unsupported(`filters ${filters.join(', ')}`);
  let mupdf;
  try { mupdf = await mupdfModule(); } catch (e) { throw unsupported(`${last} needs the MuPDF decoder (${e?.message || e})`); }
  const doc = new mupdf.PDFDocument();
  try {
    const d = doc.newDictionary();
    const arr = doc.newArray();
    for (const f of filters) arr.push(doc.newName(f));
    d.put('Filter', arr);
    d.put('Width', W); d.put('Height', H);
    d.put('BitsPerComponent', bpc || 8);
    d.put('ColorSpace', doc.newName(nComp === 4 ? 'DeviceCMYK' : nComp === 3 ? 'DeviceRGB' : 'DeviceGray'));
    const parms = resolve(context, stream.dict.get(N('DecodeParms')));
    const parmObj = (p) => {
      p = resolve(context, p);
      if (!(p instanceof PDFDict)) return doc.newNull();
      const o = doc.newDictionary();
      for (const [k, v0] of p.entries()) {
        const v = resolve(context, v0);
        const key = k.decodeText();
        if (typeof v?.asNumber === 'function') o.put(key, v.asNumber());
        else if (typeof v?.asBoolean === 'function') o.put(key, v.asBoolean());
        else if (v instanceof PDFName) o.put(key, doc.newName(v.decodeText()));
        else if (v instanceof PDFStream && key === 'JBIG2Globals') o.put(key, doc.addStream(streamBytesOf(v), doc.newDictionary()));
      }
      return o;
    };
    if (parms instanceof PDFArray) { const pa = doc.newArray(); for (const p of parms.asArray()) pa.push(parmObj(p)); d.put('DecodeParms', pa); }
    else if (parms instanceof PDFDict) { const pa = doc.newArray(); for (let i = 0; i < filters.length - 1; i++) pa.push(doc.newNull()); pa.push(parmObj(parms)); d.put('DecodeParms', filters.length === 1 ? parmObj(parms) : pa); }
    const obj = doc.addRawStream(stream.contents, d);
    if (last === 'JPXDecode') {
      const pix = doc.loadImage(obj).toPixmap();
      const n = pix.getNumberOfComponents();
      const alpha = pix.getAlpha();
      const stride = n + (alpha ? 1 : 0);
      const px = pix.getPixels();
      const data = new Uint8Array(W * H * n);
      for (let p = 0, q = 0; p < W * H; p++) for (let k = 0; k < n; k++) data[q++] = px[p * stride + k];
      return { data, bpc: 8, nComp: n, jpx: true };
    }
    const data = obj.readStream().asUint8Array().slice();
    return { data, bpc: last === 'DCTDecode' ? 8 : bpc, jpeg: last === 'DCTDecode' };
  } finally {
    try { doc.destroy(); } catch { /* ignore */ }
  }
}

async function encodeJpeg(data, W, H, nComp) {
  const mupdf = await mupdfModule();
  const cs = nComp === 1 ? mupdf.ColorSpace.DeviceGray : mupdf.ColorSpace.DeviceRGB;
  const pix = new mupdf.Pixmap(cs, [0, 0, W, H], false);
  try {
    pix.getPixels().set(data.subarray(0, W * H * nComp));
    return pix.asJPEG(95).slice();
  } finally { try { pix.destroy(); } catch { /* ignore */ } }
}

/**
 * Redact an image XObject (or an inline image converted to a stream).
 * @returns {Promise<null | {drop:true} | {stream: PDFRawStream-like dict+data}>}
 *   null = untouched; {drop:true} = the image lies entirely in a region.
 */
export async function redactImageStream(context, stream, ctm, regions, fillRgb, { resources = null, covered = null } = {}) {
  const dict = stream.dict;
  const W = numOf(get(context, dict, 'Width')), H = numOf(get(context, dict, 'Height'));
  if (!(W > 0) || !(H > 0)) throw unsupported('image without width/height');
  const mask = covered || coveredPixels(W, H, ctm, regions);
  if (!mask) return null;
  if (mask.every((v) => v === 1)) return { drop: true };
  const isMask = get(context, dict, 'ImageMask');
  const imageMask = !!(isMask && typeof isMask.asBoolean === 'function' && isMask.asBoolean());
  let bpc = imageMask ? 1 : numOf(get(context, dict, 'BitsPerComponent'), 8);
  let cs = imageMask ? { n: 1, kind: 'mask' } : colourSpace(context, dict.get(N('ColorSpace')), resources);
  if (!cs) throw unsupported('unknown colour space');
  let decode = numbers(context, get(context, dict, 'Decode'));
  const decoded = await decodeImage(context, stream, W, H, bpc, cs.n);
  let data = decoded.data;
  const changes = {};
  if (decoded.jpx) {
    // MuPDF delivered the final colours: write them as a plain device image.
    bpc = 8; decode = null;
    cs = decoded.nComp === 1 ? { n: 1, kind: 'gray' } : decoded.nComp === 4 ? { n: 4, kind: 'cmyk' } : { n: 3, kind: 'rgb' };
    changes.ColorSpace = N(cs.kind === 'gray' ? 'DeviceGray' : cs.kind === 'cmyk' ? 'DeviceCMYK' : 'DeviceRGB');
    changes.Decode = null; changes.SMaskInData = null;
  }
  if (decoded.bpc !== bpc) { bpc = decoded.bpc; changes.BitsPerComponent = bpc; }
  let values;
  if (cs.kind === 'mask') {
    // Stencil: Decode [0 1] (default) paints where the sample is 0.
    const inverted = decode && decode[0] === 1;
    values = [inverted ? 0 : 1];
  } else {
    values = sampleValues(fillComponents(cs, fillRgb), decode, bpc, cs);
  }
  data = paintSamples(data, W, H, cs.n, bpc, mask, values);

  // Soft mask / explicit mask: same pixels, opaque (so the image shows the fill colour there).
  for (const key of ['SMask', 'Mask']) {
    const m = resolve(context, dict.get(N(key)));
    if (!(m instanceof PDFStream)) continue;
    const mw = numOf(get(context, m, 'Width')), mh = numOf(get(context, m, 'Height'));
    if (!(mw > 0 && mh > 0)) continue;
    const mMask = mw === W && mh === H ? mask : coveredPixels(mw, mh, ctm, regions);
    if (!mMask) continue;
    const red = await redactMaskStream(context, m, mw, mh, mMask, key === 'SMask');
    if (red) changes[key] = context.register(red);
  }

  let out;
  if (decoded.jpeg && bpc === 8 && (cs.n === 1 || cs.n === 3) && !decode) {
    try {
      const jpg = await encodeJpeg(data, W, H, cs.n);
      out = makeStream(context, dict, jpg, { ...changes, Filter: N('DCTDecode'), DecodeParms: null });
    } catch { out = null; }
  }
  if (!out) out = makeStream(context, dict, data, { ...changes, Filter: 'flate', DecodeParms: null });
  return { stream: out };
}

async function redactMaskStream(context, m, W, H, mask, soft) {
  const dict = m.dict;
  const isMask = get(context, dict, 'ImageMask');
  const stencil = !!(isMask && typeof isMask.asBoolean === 'function' && isMask.asBoolean());
  let bpc = stencil ? 1 : numOf(get(context, dict, 'BitsPerComponent'), 8);
  const decode = numbers(context, get(context, dict, 'Decode'));
  const decoded = await decodeImage(context, m, W, H, bpc, 1);
  bpc = decoded.bpc;
  const max = 2 ** bpc - 1;
  let v;
  if (stencil) v = decode && decode[0] === 1 ? 0 : 1; // not painted: the explicit mask hides the image there
  else v = decode && decode[0] === 1 ? 0 : max; // soft mask: opaque
  if (!soft && !stencil) v = max;
  const data = paintSamples(decoded.data, W, H, 1, bpc, mask, [v]);
  const changes = { Filter: 'flate', DecodeParms: null };
  if (decoded.bpc !== numOf(get(context, dict, 'BitsPerComponent'), bpc) && !stencil) changes.BitsPerComponent = decoded.bpc;
  return makeStream(context, dict, data, changes);
}

/** New stream: the dict copied (minus encoding keys), with new data. */
function makeStream(context, dict, data, changes) {
  const entries = {};
  for (const [k, v] of dict.entries()) {
    const key = k.decodeText();
    if (key === 'Length' || key === 'Filter' || key === 'DecodeParms' || key === 'DL') continue;
    entries[key] = v;
  }
  let flate = false;
  for (const [k, v] of Object.entries(changes)) {
    if (k === 'Filter' && v === 'flate') { flate = true; continue; }
    if (v === null) delete entries[k]; else entries[k] = typeof v === 'number' ? context.obj(v) : v;
  }
  if (flate) return context.flateStream(data, entries);
  return context.stream(data, entries);
}

/**
 * Inline image (BI … ID … EI) as a temporary stream, so the same code can
 * redact it. Returns {stream, toInline(newStream)}.
 */
export function inlineAsStream(context, inline, toPdfValue) {
  const entries = {};
  for (const [k, v] of inline.dict) entries[k] = toPdfValue(v);
  const s = context.stream(inline.data, entries);
  return s;
}

export { PDFRef };
