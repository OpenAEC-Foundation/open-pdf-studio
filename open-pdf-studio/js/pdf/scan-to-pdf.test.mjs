// Scan to searchable PDF (#382): page sizes from the image resolution, the
// PDF assembly and the OCR hand-off (stubbed OCR), in one step.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { PDFDocument, PDFName, PDFArray, PDFBool } from 'pdf-lib';
import {
  pngInfo, isPng, isJpeg, effectiveDpi, pageSizePt, imagesToPdf, scanToSearchablePdf, scanDocumentName,
} from './scan-to-pdf.js';

const FONT = readFileSync(new URL('../../public/pdfjs/web/standard_fonts/LiberationSans-Regular.ttf', import.meta.url));
const loadFontBytes = async () => new Uint8Array(FONT);

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)])), 8 + data.length);
  return out;
}
/** A white greyscale PNG of `w`×`h` pixels, with a pHYs chunk when `dpi` is given. */
function png(w, h, dpi = null) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  const rows = Buffer.alloc((w + 1) * h, 0xff);
  for (let y = 0; y < h; y++) rows[y * (w + 1)] = 0; // filter byte
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr)];
  if (dpi) {
    const phys = Buffer.alloc(9);
    const ppm = Math.round(dpi / 0.0254);
    phys.writeUInt32BE(ppm, 0);
    phys.writeUInt32BE(ppm, 4);
    phys[8] = 1;
    parts.push(chunk('pHYs', phys));
  }
  parts.push(chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0)));
  return new Uint8Array(Buffer.concat(parts));
}

test('PNG size and resolution are read from IHDR and pHYs', () => {
  const info = pngInfo(png(850, 1100, 100));
  assert.equal(info.width, 850);
  assert.equal(info.height, 1100);
  assert.ok(Math.abs(info.dpiX - 100) < 0.1 && Math.abs(info.dpiY - 100) < 0.1);
  assert.deepEqual(pngInfo(png(10, 20)), { width: 10, height: 20, dpiX: null, dpiY: null });
  assert.equal(pngInfo(new Uint8Array([1, 2, 3])), null);
  assert.ok(isPng(png(1, 1)) && !isJpeg(png(1, 1)));
  assert.ok(isJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])));
});

test('page size follows from pixels and DPI', () => {
  // A4 at 300 dpi: 2480 × 3508 px → 595.2 × 841.9 pt.
  const a4 = pageSizePt(2480, 3508, 300);
  assert.ok(Math.abs(a4.width - 595.2) < 0.01 && Math.abs(a4.height - 841.92) < 0.01);
  assert.deepEqual(pageSizePt(600, 300, { x: 200, y: 100 }), { width: 216, height: 216 });
  // The file's own resolution wins when plausible, else the requested one.
  assert.deepEqual(effectiveDpi({ dpiX: 150, dpiY: 150 }, 300), { x: 150, y: 150 });
  assert.deepEqual(effectiveDpi({ dpiX: 2.8, dpiY: 2.8 }, 300), { x: 300, y: 300 }, 'a bogus pHYs is ignored');
  assert.deepEqual(effectiveDpi(null, 0), { x: 300, y: 300 });
});

test('images become one page each, sized by resolution', async () => {
  const bytes = await imagesToPdf([
    { bytes: png(850, 1100), dpi: 100 }, // 8.5 × 11 in = Letter
    { bytes: png(300, 150, 150), dpi: 600 }, // pHYs 150 dpi wins over the requested 600
  ], { title: 'Scan test' });
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 2);
  const [p1, p2] = pdf.getPages().map((p) => p.getSize());
  assert.ok(Math.abs(p1.width - 612) < 0.01 && Math.abs(p1.height - 792) < 0.01);
  assert.ok(Math.abs(p2.width - 144) < 0.01 && Math.abs(p2.height - 72) < 0.01);
  assert.equal(pdf.getTitle(), 'Scan test');
  await assert.rejects(imagesToPdf([]), /SCAN_NO_PAGES/);
  await assert.rejects(imagesToPdf([{ bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]) }]), /SCAN_BAD_IMAGE/);
});

function hasOcrLayer(pdf, index) {
  const contents = pdf.getPage(index).node.Contents();
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  return refs.some((ref) => pdf.context.lookup(ref)?.dict?.get(PDFName.of('OPS_OCRLayer')) === PDFBool.True);
}

test('scan → PDF → OCR in one step: every page recognised from one temporary file', async () => {
  const calls = [];
  const deps = {
    writeTemp: async (bytes) => { calls.push(['writeTemp', bytes.length > 0]); return '/cache/scan-1.pdf'; },
    removeTemp: async (path) => calls.push(['removeTemp', path]),
    ocrPage: async (path, pageIndex, lang) => {
      calls.push(['ocr', path, pageIndex, lang]);
      return [{ text: `word${pageIndex}`, left: 10, top: 10, width: 30, height: 10, confidence: 95 }];
    },
    release: async () => calls.push(['release']),
    loadFontBytes,
    onProgress: (p) => calls.push(['progress', p.phase, p.page ?? null]),
  };
  const result = await scanToSearchablePdf([{ bytes: png(200, 200), dpi: 100 }, { bytes: png(200, 200), dpi: 100 }],
    { ocr: true, lang: 'eng' }, deps);
  assert.equal(result.pages, 2);
  assert.equal(result.words, 2);
  assert.deepEqual(calls.filter((c) => c[0] === 'ocr'), [['ocr', '/cache/scan-1.pdf', 0, 'eng'], ['ocr', '/cache/scan-1.pdf', 1, 'eng']]);
  assert.deepEqual(calls.slice(-2), [['release'], ['removeTemp', '/cache/scan-1.pdf']], 'cleanup after OCR');
  assert.ok(calls.some((c) => c[0] === 'progress' && c[1] === 'recognizing' && c[2] === 2));
  const pdf = await PDFDocument.load(result.bytes);
  assert.ok(hasOcrLayer(pdf, 0) && hasOcrLayer(pdf, 1), 'searchable on every page');
});

test('without OCR no temporary file and no recognition', async () => {
  let touched = false;
  const deps = { writeTemp: async () => { touched = true; }, ocrPage: async () => { touched = true; }, loadFontBytes };
  const result = await scanToSearchablePdf([{ bytes: png(50, 50), dpi: 100 }], { ocr: false }, deps);
  assert.equal(touched, false);
  assert.equal((await PDFDocument.load(result.bytes)).getPageCount(), 1);
});

test('OCR hand-off: a failure or cancel still cleans up the temporary file', async () => {
  const calls = [];
  const base = {
    writeTemp: async () => '/cache/t.pdf',
    removeTemp: async (p) => calls.push(['removeTemp', p]),
    release: async () => calls.push(['release']),
    loadFontBytes,
  };
  await assert.rejects(scanToSearchablePdf([{ bytes: png(20, 20) }], { ocr: true },
    { ...base, ocrPage: async () => { throw new Error('Tesseract init failed'); } }), /Tesseract/);
  let n = 0;
  await assert.rejects(scanToSearchablePdf([{ bytes: png(20, 20) }, { bytes: png(20, 20) }], { ocr: true },
    { ...base, ocrPage: async () => { n++; return []; }, isCancelled: () => n >= 1 }), /SCAN_CANCELLED/);
  assert.equal(n, 1);
  assert.deepEqual(calls, [['release'], ['removeTemp', '/cache/t.pdf'], ['release'], ['removeTemp', '/cache/t.pdf']]);
});

test('scan document name', () => {
  assert.equal(scanDocumentName(new Date(2026, 9, 28, 14, 5)), 'Scan 2026-10-28 14.05.pdf');
});
