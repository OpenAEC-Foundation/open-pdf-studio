// Scan to searchable PDF (#382): scanned page images → a PDF whose page size
// follows from the image resolution, then the same OCR hand-off as batch OCR
// (one temporary file, every page recognised, the invisible text layer
// written by saver/ocr-text-layer.js). No Tauri or DOM here: the app passes
// its commands in `deps` (scanner.js); tests pass a stubbed OCR.

import { PDFDocument } from 'pdf-lib';
import { applyOcrLayer } from './batch-ocr-runner.js';

/** Resolutions outside this range in an image file are not believed. */
const MIN_FILE_DPI = 50;
const MAX_FILE_DPI = 2400;
const INCH_PER_METRE = 39.3700787;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** pHYs stores whole pixels per metre: 300 dpi comes back as 299.9994. */
function snap(dpi) {
  return Math.abs(dpi - Math.round(dpi)) < 0.1 ? Math.round(dpi) : dpi;
}

function u32(b, o) {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

export function isPng(bytes) {
  return !!bytes && bytes.length > 8 && PNG_SIGNATURE.every((v, i) => bytes[i] === v);
}

export function isJpeg(bytes) {
  return !!bytes && bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/**
 * Size and resolution of a PNG: IHDR, and pHYs when its unit is the metre.
 * @returns {{width:number, height:number, dpiX:number|null, dpiY:number|null}|null}
 */
export function pngInfo(bytes) {
  if (!isPng(bytes)) return null;
  let width = 0;
  let height = 0;
  let dpiX = null;
  let dpiY = null;
  for (let o = 8; o + 8 <= bytes.length;) {
    const len = u32(bytes, o);
    const type = String.fromCharCode(bytes[o + 4], bytes[o + 5], bytes[o + 6], bytes[o + 7]);
    const data = o + 8;
    if (data + len > bytes.length) break;
    if (type === 'IHDR' && len >= 8) {
      width = u32(bytes, data);
      height = u32(bytes, data + 4);
    } else if (type === 'pHYs' && len >= 9 && bytes[data + 8] === 1) {
      dpiX = snap(u32(bytes, data) / INCH_PER_METRE);
      dpiY = snap(u32(bytes, data + 4) / INCH_PER_METRE);
    } else if (type === 'IDAT' || type === 'IEND') {
      break; // pHYs must come before the image data
    }
    o = data + len + 4; // + CRC
  }
  return width > 0 && height > 0 ? { width, height, dpiX, dpiY } : null;
}

/**
 * Resolution to size a page with: the one stored in the image when plausible
 * (the device may not honour the requested one), else the requested one.
 */
export function effectiveDpi(info, requestedDpi) {
  const ok = (v) => Number.isFinite(v) && v >= MIN_FILE_DPI && v <= MAX_FILE_DPI;
  const fallback = ok(requestedDpi) ? requestedDpi : 300;
  return {
    x: ok(info?.dpiX) ? info.dpiX : fallback,
    y: ok(info?.dpiY) ? info.dpiY : fallback,
  };
}

/** Page size in points for an image of `widthPx` × `heightPx` at `dpi`. */
export function pageSizePt(widthPx, heightPx, dpi) {
  const dx = typeof dpi === 'number' ? dpi : dpi.x;
  const dy = typeof dpi === 'number' ? dpi : dpi.y;
  return { width: (widthPx * 72) / dx, height: (heightPx * 72) / dy };
}

/**
 * Build a PDF with one page per image, each page exactly the size of the
 * scanned area.
 * @param {Array<{bytes:Uint8Array, dpi?:number}>} images  PNG or JPEG
 * @param {{title?:string, now?:Date}} meta
 * @returns {Promise<Uint8Array>}
 */
export async function imagesToPdf(images, meta = {}) {
  if (!Array.isArray(images) || images.length === 0) throw new Error('SCAN_NO_PAGES');
  const pdf = await PDFDocument.create();
  for (const image of images) {
    const bytes = image.bytes instanceof Uint8Array ? image.bytes : new Uint8Array(image.bytes);
    let embedded;
    let info = null;
    if (isPng(bytes)) {
      info = pngInfo(bytes);
      embedded = await pdf.embedPng(bytes);
    } else if (isJpeg(bytes)) {
      embedded = await pdf.embedJpg(bytes);
    } else {
      throw new Error('SCAN_BAD_IMAGE');
    }
    const size = pageSizePt(embedded.width, embedded.height, effectiveDpi(info, image.dpi));
    const page = pdf.addPage([size.width, size.height]);
    page.drawImage(embedded, { x: 0, y: 0, width: size.width, height: size.height });
  }
  if (meta.title) pdf.setTitle(meta.title);
  const now = meta.now || new Date();
  pdf.setCreationDate(now);
  pdf.setModificationDate(now);
  return new Uint8Array(await pdf.save());
}

/**
 * Images → PDF → (optionally) OCR, in one step.
 *
 * @param {Array<{bytes:Uint8Array, dpi?:number}>} images
 * @param {{ocr?:boolean, lang?:string, title?:string}} options
 * @param {{
 *   writeTemp: (bytes:Uint8Array) => Promise<string>,
 *   removeTemp?: (path:string) => Promise<any>,
 *   ocrPage: (path:string, pageIndex:number, lang:string) => Promise<object[]>,
 *   release?: () => Promise<any>,
 *   loadFontBytes: () => Promise<Uint8Array>,
 *   onProgress?: (p:{phase:string, page?:number, pages?:number}) => void,
 *   isCancelled?: () => boolean,
 * }} deps
 * @returns {Promise<{bytes:Uint8Array, pages:number, words:number}>}
 */
export async function scanToSearchablePdf(images, options = {}, deps = {}) {
  const progress = deps.onProgress || (() => {});
  progress({ phase: 'building' });
  const bytes = await imagesToPdf(images, { title: options.title });
  if (!options.ocr) return { bytes, pages: images.length, words: 0 };

  const temp = await deps.writeTemp(bytes);
  try {
    const results = {};
    let words = 0;
    for (let i = 0; i < images.length; i++) {
      if (deps.isCancelled?.()) throw new Error('SCAN_CANCELLED');
      progress({ phase: 'recognizing', page: i + 1, pages: images.length });
      const found = await deps.ocrPage(temp, i, options.lang || 'auto');
      results[i + 1] = Array.isArray(found) ? found : [];
      words += results[i + 1].length;
    }
    const searchable = await applyOcrLayer(bytes, results, deps.loadFontBytes);
    return { bytes: searchable, pages: images.length, words };
  } finally {
    try { await deps.release?.(); } catch { /* nothing held */ }
    try { await deps.removeTemp?.(temp); } catch { /* cleaned up later */ }
  }
}

/** Default document name for a scan: "Scan 2026-10-28 14.05.pdf". */
export function scanDocumentName(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `Scan ${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}.${p(date.getMinutes())}.pdf`;
}
