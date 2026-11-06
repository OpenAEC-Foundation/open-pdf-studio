// Small pdf-lib value helpers shared by the redaction modules (#762).

import {
  PDFName, PDFNumber, PDFArray, PDFDict, PDFRef, PDFRawStream, PDFStream, PDFString, PDFHexString,
  PDFBool, PDFNull, decodePDFRawStream,
} from 'pdf-lib';

export const N = (s) => PDFName.of(s);

export function resolve(context, v) {
  let guard = 0;
  while (v instanceof PDFRef && guard++ < 32) v = context.lookup(v);
  return v;
}

export const dictOf = (v) => (v instanceof PDFDict ? v : v instanceof PDFStream ? v.dict : null);

export function get(context, dict, key) {
  const d = dictOf(dict);
  if (!d) return undefined;
  return resolve(context, d.get(N(key)));
}

export function nameOf(v) {
  return v instanceof PDFName ? v.decodeText() : null;
}

export function numOf(v, fallback = null) {
  return v instanceof PDFNumber ? v.asNumber() : fallback;
}

/** PDF value → plain JS (numbers, strings for names, arrays, Maps for dicts). Shallow on refs. */
export function toJs(context, v, depth = 0) {
  v = resolve(context, v);
  if (v instanceof PDFNumber) return v.asNumber();
  if (v instanceof PDFName) return v.decodeText();
  if (v instanceof PDFBool) return v.asBoolean();
  if (v instanceof PDFArray) return depth > 8 ? [] : v.asArray().map((x) => toJs(context, x, depth + 1));
  if (v instanceof PDFString || v instanceof PDFHexString) return v.asBytes ? v.asBytes() : v.decodeText();
  if (v === PDFNull || v === undefined || v === null) return null;
  return v;
}

export function numbers(context, v) {
  const a = resolve(context, v);
  if (!(a instanceof PDFArray)) return null;
  const out = [];
  for (const x of a.asArray()) {
    const n = numOf(resolve(context, x));
    if (n === null) return null;
    out.push(n);
  }
  return out;
}

/** Decoded bytes of a stream (all standard non-image filters, plus PNG/TIFF predictors). */
export function streamBytes(stream) {
  if (stream instanceof PDFRawStream) {
    const raw = decodePDFRawStream(stream).decode();
    return applyPredictor(raw, stream.dict.get(N('DecodeParms')), stream.dict.context);
  }
  if (stream instanceof PDFStream && typeof stream.getUnencodedContents === 'function') return stream.getUnencodedContents();
  return new Uint8Array(0);
}

/** PNG (10–15) and TIFF (2) predictors from DecodeParms (single filter). */
export function applyPredictor(bytes, parms, context) {
  parms = context ? resolve(context, parms) : parms;
  if (parms instanceof PDFArray) parms = parms.asArray().map((p) => (context ? resolve(context, p) : p)).find((p) => p instanceof PDFDict);
  if (!(parms instanceof PDFDict)) return bytes;
  const n = (k, d) => { const v = context ? resolve(context, parms.get(N(k))) : parms.get(N(k)); return v instanceof PDFNumber ? v.asNumber() : d; };
  const pred = n('Predictor', 1);
  if (pred <= 1) return bytes;
  const colors = n('Colors', 1), bpc = n('BitsPerComponent', 8), columns = n('Columns', 1);
  const bpp = Math.max(1, Math.ceil(colors * bpc / 8));
  const rowLen = Math.ceil(colors * bpc * columns / 8);
  if (pred === 2) {
    const out = bytes.slice();
    if (bpc === 8) {
      for (let r = 0; r + rowLen <= out.length; r += rowLen) for (let i = bpp; i < rowLen; i++) out[r + i] = (out[r + i] + out[r + i - bpp]) & 255;
    } else if (bpc === 16) {
      for (let r = 0; r + rowLen <= out.length; r += rowLen) {
        for (let i = 2 * colors; i + 1 < rowLen; i += 2) {
          const v = ((out[r + i] << 8 | out[r + i + 1]) + (out[r + i - 2 * colors] << 8 | out[r + i + 1 - 2 * colors])) & 0xffff;
          out[r + i] = v >> 8; out[r + i + 1] = v & 255;
        }
      }
    } else {
      throw Object.assign(new Error('REDACTION_UNSUPPORTED_PREDICTOR'), { detail: `TIFF predictor with ${bpc} bits` });
    }
    return out;
  }
  const rows = Math.floor(bytes.length / (rowLen + 1));
  const out = new Uint8Array(rows * rowLen);
  let prev = new Uint8Array(rowLen);
  for (let r = 0; r < rows; r++) {
    const base = r * (rowLen + 1), type = bytes[base];
    const dst = out.subarray(r * rowLen, (r + 1) * rowLen);
    for (let i = 0; i < rowLen; i++) {
      const raw = bytes[base + 1 + i];
      const a = i >= bpp ? dst[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v;
      switch (type) {
        case 1: v = raw + a; break;
        case 2: v = raw + b; break;
        case 3: v = raw + ((a + b) >> 1); break;
        case 4: { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break; }
        default: v = raw;
      }
      dst[i] = v & 255;
    }
    prev = dst;
  }
  return out;
}

export { PDFName, PDFNumber, PDFArray, PDFDict, PDFRef, PDFRawStream, PDFStream, PDFString, PDFHexString, PDFBool, PDFNull };
