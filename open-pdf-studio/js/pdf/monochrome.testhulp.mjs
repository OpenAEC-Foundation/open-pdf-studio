// Testhulp voor de monochroommodus (#902), alleen voor tests:
//  - scanBitmap(): een scanachtig één-bit beeld. Een A4-pagina met tekst wordt
//    met MuPDF gerasterd, met wat ruis rond de drempel gedrempeld en licht
//    bespikkeld, zoals een zwart-witscan van een getypt document.
//  - decodeCcittWithMupdf() / imageSamples(): samples terug uit een beeld-
//    stream met een onafhankelijke decoder (MuPDF voor CCITT, zlib voor Flate).
//  - withoutPadding(): wist de opvulbits achter de laatste kolom, die bij
//    CCITT niet bewaard worden en geen beeldinhoud zijn.
import { inflateSync } from 'node:zlib';
import { PDFDocument, PDFName, PDFDict, PDFBool, StandardFonts } from 'pdf-lib';
import * as mupdf from 'mupdf';

/** Decodeert CCITT-data met MuPDF via een /CCITTFaxDecode-stream. */
export function decodeCcittWithMupdf(encoded, params) {
  const doc = new mupdf.PDFDocument();
  try {
    const dict = doc.newDictionary();
    dict.put('Filter', doc.newName('CCITTFaxDecode'));
    const decodeParms = doc.newDictionary();
    for (const [key, value] of Object.entries(params)) decodeParms.put(key, value);
    dict.put('DecodeParms', decodeParms);
    const ref = doc.addRawStream(encoded, dict);
    const buffer = ref.readStream();
    try { return Uint8Array.from(buffer.asUint8Array()); } finally { buffer.destroy(); }
  } finally { doc.destroy(); }
}

/** Gedecodeerde samples van een pdf-lib-beeldstream met Flate of CCITT. */
export function imageSamples(stream) {
  const filter = stream.dict.get(PDFName.of('Filter'))?.toString();
  if (filter === '/FlateDecode') return Uint8Array.from(inflateSync(stream.getContents()));
  if (filter !== '/CCITTFaxDecode') throw new Error(`unexpected filter ${filter}`);
  const parms = stream.dict.get(PDFName.of('DecodeParms'));
  if (!(parms instanceof PDFDict)) throw new Error('missing DecodeParms');
  const params = {};
  for (const [key, value] of parms.entries()) {
    params[key.decodeText()] = value instanceof PDFBool ? value.asBoolean() : value.asNumber();
  }
  return decodeCcittWithMupdf(stream.getContents(), params);
}

/** Kopie zonder opvulbits (op 0) achter de laatste kolom van elke rij. */
export function withoutPadding(samples, width, height) {
  const stride = Math.ceil(width / 8), out = Uint8Array.from(samples.subarray(0, stride * height));
  const tail = width & 7 ? (0xff << (8 - (width & 7))) & 0xff : 0xff;
  for (let y = 0; y < height; y++) out[y * stride + stride - 1] &= tail;
  return out;
}

const WORDS = 'the of and to in is that for on with as by this be are from at or an it which not have but all were when we there can more if will one each about how up out them then she many some so these would other into has her two like him see time could no make than first been its who now people my made over did down only way find use may water long little very after words called just where most know'.split(' ');

/**
 * @param {{dpi?: number, lines?: number, seed?: number, speckle?: number, jitter?: number}} [options]
 * @returns {Promise<{width: number, height: number, samples: Uint8Array}>}
 *          Gepakte samples, rij per rij op een byte, bit 1 = wit (DeviceGray).
 */
export async function scanBitmap({ dpi = 200, lines = 52, seed = 5, speckle = 0.0005, jitter = 96 } = {}) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const page = doc.addPage([595, 842]);
  for (let i = 0; i < lines; i++) {
    const words = [];
    while (words.join(' ').length < 95) words.push(WORDS[Math.floor(rnd() * WORDS.length)]);
    page.drawText(words.join(' '), { x: 56, y: 790 - i * 14, size: 10.5, font });
  }
  const bytes = await doc.save();
  const pdf = mupdf.Document.openDocument(bytes, 'application/pdf');
  try {
    const p = pdf.loadPage(0);
    const pix = p.toPixmap(mupdf.Matrix.scale(dpi / 72, dpi / 72), mupdf.ColorSpace.DeviceGray, false, true);
    try {
      const width = pix.getWidth(), height = pix.getHeight(), gray = pix.getPixels();
      const stride = Math.ceil(width / 8), samples = new Uint8Array(stride * height);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        let white = gray[y * width + x] >= 128 + (jitter ? Math.round((rnd() - 0.5) * jitter) : 0);
        if (rnd() < speckle) white = !white; // scanstof
        if (white) samples[y * stride + (x >> 3)] |= 128 >> (x & 7);
      }
      return { width, height, samples };
    } finally { pix.destroy(); p.destroy(); }
  } finally { pdf.destroy(); }
}
