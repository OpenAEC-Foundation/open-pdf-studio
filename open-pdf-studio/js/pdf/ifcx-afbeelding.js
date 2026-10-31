// PDF to IFCX (#876): turns an image XObject into a file a reader can show —
// JPEG and JPEG 2000 pass through unchanged, decodable samples become a PNG.
// Pure (pdf-lib + CompressionStream), so it runs under node --test.
//
// What does not convert (CCITT, JBIG2, 16-bit samples, a TIFF predictor, an
// unknown colour space) keeps its placement but gets `data: null` and a
// reason, so the sheet still shows where the image was.

import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFStream, decodePDFRawStream } from 'pdf-lib';

/** Decoded samples above this are not converted (memory). */
export const MAX_BEELD_PIXELS = 40_000_000;

const nameStr = (o) => (o ? String(o).replace(/^\//, '') : '');

function getal(context, obj, standaard) {
  const v = context.lookup(obj);
  return v instanceof PDFNumber ? v.asNumber() : standaard;
}

function filters(dict) {
  const f = dict.lookup(PDFName.of('Filter'));
  if (f instanceof PDFName) return [nameStr(f)];
  if (f instanceof PDFArray) return Array.from({ length: f.size() }, (_, i) => nameStr(f.lookup(i)));
  return [];
}

function parms(dict, context, index) {
  const p = dict.lookup(PDFName.of('DecodeParms'));
  if (p instanceof PDFDict) return p;
  if (p instanceof PDFArray) {
    const el = context.lookup(p.get(index));
    return el instanceof PDFDict ? el : null;
  }
  return null;
}

/**
 * The colour space of an image: { soort: 'gray'|'rgb'|'cmyk'|'indexed', palet? }
 * or null when it is not supported.
 */
function kleurruimte(context, obj) {
  const cs = context.lookup(obj);
  if (cs instanceof PDFName) {
    const n = nameStr(cs);
    if (n === 'DeviceGray' || n === 'CalGray') return { soort: 'gray', kanalen: 1 };
    if (n === 'DeviceRGB' || n === 'CalRGB') return { soort: 'rgb', kanalen: 3 };
    if (n === 'DeviceCMYK') return { soort: 'cmyk', kanalen: 4 };
    return null;
  }
  if (cs instanceof PDFArray && cs.size() > 0) {
    const n = nameStr(context.lookup(cs.get(0)));
    if (n === 'CalGray') return { soort: 'gray', kanalen: 1 };
    if (n === 'CalRGB') return { soort: 'rgb', kanalen: 3 };
    if (n === 'ICCBased') {
      const s = context.lookup(cs.get(1));
      const k = s instanceof PDFStream ? getal(context, s.dict.get(PDFName.of('N')), 0) : 0;
      return k === 1 ? { soort: 'gray', kanalen: 1 } : k === 3 ? { soort: 'rgb', kanalen: 3 } : k === 4 ? { soort: 'cmyk', kanalen: 4 } : null;
    }
    if (n === 'Indexed' || n === 'I') {
      const basis = kleurruimte(context, cs.get(1));
      if (!basis || basis.soort === 'indexed') return null;
      // hival is 0-255 (PDF 32000, 8.6.6.3); a PNG palette holds at most 256
      // entries. A larger value in a damaged file would give an invalid PNG
      // and a needlessly large allocation.
      const hival = Math.min(255, Math.max(0, Math.floor(getal(context, cs.get(2), 0)) || 0));
      const tabel = context.lookup(cs.get(3));
      let bytes = null;
      if (tabel instanceof PDFRawStream) bytes = decodePDFRawStream(tabel).decode();
      else if (tabel && typeof tabel.asBytes === 'function') bytes = tabel.asBytes();
      if (!bytes) return null;
      const palet = new Uint8Array((hival + 1) * 3);
      for (let i = 0; i <= hival; i++) {
        const o = i * basis.kanalen;
        let rgb;
        if (basis.soort === 'gray') rgb = [bytes[o], bytes[o], bytes[o]];
        else if (basis.soort === 'rgb') rgb = [bytes[o], bytes[o + 1], bytes[o + 2]];
        else {
          const [c, m, y, k] = [bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]].map((v) => (v || 0) / 255);
          rgb = [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)].map((v) => Math.round(v * 255));
        }
        palet.set(rgb.map((v) => v || 0), i * 3);
      }
      return { soort: 'indexed', kanalen: 1, palet };
    }
  }
  return null;
}

/** Undoes the PNG predictors (Predictor >= 10) of a Flate/LZW stream. */
export function ontPredictor(data, kolommen, kleuren, bpc) {
  const bpp = Math.max(1, Math.ceil(kleuren * bpc / 8));
  const rij = Math.ceil(kolommen * kleuren * bpc / 8);
  const rijen = Math.floor(data.length / (rij + 1));
  const uit = new Uint8Array(rijen * rij);
  let vorige = new Uint8Array(rij);
  for (let r = 0; r < rijen; r++) {
    const type = data[r * (rij + 1)];
    const bron = data.subarray(r * (rij + 1) + 1, (r + 1) * (rij + 1));
    const cur = uit.subarray(r * rij, (r + 1) * rij);
    for (let i = 0; i < rij; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = vorige[i];
      const c = i >= bpp ? vorige[i - bpp] : 0;
      let v = bron[i];
      if (type === 1) v += a;
      else if (type === 2) v += b;
      else if (type === 3) v += (a + b) >> 1;
      else if (type === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 0xff;
    }
    vorige = cur;
  }
  return uit;
}

// ── PNG writer ──

const CRC_TABEL = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes, crc = 0xffffffff) {
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABEL[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return crc;
}

function adler32(bytes) {
  let a = 1, b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** zlib without compression (stored blocks): the fallback without CompressionStream. */
function zlibOpgeslagen(data) {
  const blokken = Math.max(1, Math.ceil(data.length / 65535));
  const uit = new Uint8Array(2 + data.length + blokken * 5 + 4);
  uit[0] = 0x78; uit[1] = 0x01;
  let o = 2;
  for (let i = 0; i < blokken; i++) {
    const stuk = data.subarray(i * 65535, Math.min(data.length, (i + 1) * 65535));
    uit[o++] = i === blokken - 1 ? 1 : 0;
    uit[o++] = stuk.length & 0xff; uit[o++] = stuk.length >> 8;
    uit[o++] = ~stuk.length & 0xff; uit[o++] = (~stuk.length >> 8) & 0xff;
    uit.set(stuk, o); o += stuk.length;
  }
  const ad = adler32(data);
  uit[o++] = ad >>> 24; uit[o++] = (ad >>> 16) & 0xff; uit[o++] = (ad >>> 8) & 0xff; uit[o++] = ad & 0xff;
  return uit;
}

async function zlib(data) {
  if (typeof CompressionStream === 'function') {
    try {
      const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch { /* fall back to stored blocks */ }
  }
  return zlibOpgeslagen(data);
}

function chunk(type, data) {
  const uit = new Uint8Array(12 + data.length);
  const dv = new DataView(uit.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) uit[4 + i] = type.charCodeAt(i);
  uit.set(data, 8);
  dv.setUint32(8 + data.length, (crc32(uit.subarray(4, 8 + data.length)) ^ 0xffffffff) >>> 0);
  return uit;
}

/**
 * Writes a PNG from rows of samples in PDF layout (each row padded to a byte),
 * which is also the PNG layout: only a filter byte per row is added.
 * @param {{breedte:number, hoogte:number, bpc:number, kleurType:0|2|3, palet?:Uint8Array, rijen:Uint8Array}} b
 */
export async function maakPng({ breedte, hoogte, bpc, kleurType, palet = null, rijen }) {
  const kanalen = kleurType === 2 ? 3 : 1;
  const rij = Math.ceil(breedte * kanalen * bpc / 8);
  const ruw = new Uint8Array(hoogte * (rij + 1));
  for (let r = 0; r < hoogte; r++) ruw.set(rijen.subarray(r * rij, (r + 1) * rij), r * (rij + 1) + 1);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, breedte); dv.setUint32(4, hoogte);
  ihdr[8] = bpc; ihdr[9] = kleurType; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const delen = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
  ];
  if (kleurType === 3 && palet) delen.push(chunk('PLTE', palet));
  delen.push(chunk('IDAT', await zlib(ruw)), chunk('IEND', new Uint8Array(0)));
  const totaal = delen.reduce((s, d) => s + d.length, 0);
  const uit = new Uint8Array(totaal);
  let o = 0;
  for (const d of delen) { uit.set(d, o); o += d.length; }
  return uit;
}

/**
 * Converts an image XObject.
 * @returns {Promise<{mimeType:string|null, breedte:number, hoogte:number, bytes:Uint8Array|null, reden:string|null}>}
 *   reden: why there is no data (unsupportedFilter, unsupportedColorSpace,
 *   unsupportedDepth, stencilMask, tooLarge, decodeFailed)
 */
export async function zetAfbeeldingOm(context, stream, { maxPixels = MAX_BEELD_PIXELS } = {}) {
  const dict = stream.dict;
  const breedte = getal(context, dict.get(PDFName.of('Width')), 0);
  const hoogte = getal(context, dict.get(PDFName.of('Height')), 0);
  const basis = { mimeType: null, breedte, hoogte, bytes: null, reden: null };
  if (!(breedte > 0 && hoogte > 0)) return { ...basis, reden: 'decodeFailed' };
  if (breedte * hoogte > maxPixels) return { ...basis, reden: 'tooLarge' };

  const f = filters(dict);
  const laatste = f[f.length - 1];
  const ruweBytes = () => (stream instanceof PDFRawStream ? stream.contents : stream.getContents());

  if (laatste === 'DCTDecode' || laatste === 'JPXDecode') {
    if (f.length !== 1) return { ...basis, reden: 'unsupportedFilter' };
    return { ...basis, mimeType: laatste === 'DCTDecode' ? 'image/jpeg' : 'image/jp2', bytes: ruweBytes().slice() };
  }
  if (f.some((n) => ['CCITTFaxDecode', 'JBIG2Decode', 'Crypt'].includes(n))) return { ...basis, reden: 'unsupportedFilter' };

  const masker = context.lookup(dict.get(PDFName.of('ImageMask')));
  if (masker && String(masker) === 'true') return { ...basis, reden: 'stencilMask' };

  const cs = kleurruimte(context, dict.get(PDFName.of('ColorSpace')));
  if (!cs) return { ...basis, reden: 'unsupportedColorSpace' };
  const bpc = getal(context, dict.get(PDFName.of('BitsPerComponent')), 8);
  if (cs.soort === 'rgb' || cs.soort === 'cmyk' ? bpc !== 8 : ![1, 2, 4, 8].includes(bpc)) {
    return { ...basis, reden: 'unsupportedDepth' };
  }

  let data;
  try {
    data = stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : stream.getContents();
  } catch {
    return { ...basis, reden: 'decodeFailed' };
  }
  // Predictors belong to the last Flate/LZW filter.
  const p = parms(dict, context, f.length - 1);
  const predictor = p ? getal(context, p.get(PDFName.of('Predictor')), 1) : 1;
  if (predictor === 2) return { ...basis, reden: 'unsupportedFilter' };
  if (predictor >= 10) data = ontPredictor(data, breedte, cs.kanalen, bpc);

  const rij = Math.ceil(breedte * cs.kanalen * bpc / 8);
  if (data.length < rij * hoogte) return { ...basis, reden: 'decodeFailed' };

  let rijen = data.subarray(0, rij * hoogte);
  let kleurType = cs.soort === 'indexed' ? 3 : cs.soort === 'gray' ? 0 : 2;
  if (cs.soort === 'cmyk') {
    const rgb = new Uint8Array(breedte * hoogte * 3);
    for (let i = 0, o = 0; o < rgb.length; i += 4, o += 3) {
      const k = 1 - rijen[i + 3] / 255;
      rgb[o] = Math.round((255 - rijen[i]) * k);
      rgb[o + 1] = Math.round((255 - rijen[i + 1]) * k);
      rgb[o + 2] = Math.round((255 - rijen[i + 2]) * k);
    }
    rijen = rgb;
    kleurType = 2;
  }
  // /Decode [1 0] on a grey image inverts it.
  const decode = dict.lookup(PDFName.of('Decode'));
  if (cs.soort === 'gray' && decode instanceof PDFArray && decode.size() >= 2
    && getal(context, decode.get(0), 0) === 1 && getal(context, decode.get(1), 1) === 0) {
    rijen = rijen.map((v) => 255 - v);
  }
  const bytes = await maakPng({ breedte, hoogte, bpc: cs.soort === 'cmyk' ? 8 : bpc, kleurType, palet: cs.palet || null, rijen });
  return { ...basis, mimeType: 'image/png', bytes };
}
