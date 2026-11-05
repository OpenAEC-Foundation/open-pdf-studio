import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from 'node:zlib';
import {
  PDFDocument, PDFName, PDFRawStream, PDFArray, PDFRef, StandardFonts, rgb,
  setTextRenderingMode, TextRenderingMode,
} from 'pdf-lib';
import * as mupdf from 'mupdf';
import { optimizeMonochromeDocument } from './monochrome-document.js';
import { losslessReport } from './monochrome-rapport.js';

const W = 200, H = 160;
// Zwart/wit patroon dat niet triviaal comprimeert, maar wel herhaalt.
const bw = (x, y) => ((x * 7 + y * 3) % 23 < 9 ? 0 : 255);

function oneBitSamples() {
  const stride = Math.ceil(W / 8), out = new Uint8Array(stride * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (bw(x, y)) out[y * stride + (x >> 3)] |= 128 >> (x & 7);
  return out;
}
const graySamples = () => Uint8Array.from({ length: W * H }, (_, i) => (i % W) % 256);
function rgbSamples() {
  const out = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out.fill(bw(x, y), (y * W + x) * 3, (y * W + x) * 3 + 3);
  return out;
}

// Ongecomprimeerd of met Flate niveau 0 opgeslagen, zoals sommige scanners
// doen: herschrijven moet dan winst geven.
function imageStream(doc, { bits, colorSpace = 'DeviceGray', data, extra = {} }) {
  const dict = doc.context.obj({ Type: 'XObject', Subtype: 'Image', Width: W, Height: H, BitsPerComponent: bits, ColorSpace: colorSpace, Filter: 'FlateDecode', ...extra });
  return doc.context.register(PDFRawStream.of(dict, deflateSync(data, { level: 0 })));
}

async function mixedPdf({ outputIntent = false, signed = false } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const scan = imageStream(doc, { bits: 1, data: oneBitSamples(), extra: { Decode: [1, 0] } });
  const gray = imageStream(doc, { bits: 8, data: graySamples() });
  const smask = imageStream(doc, { bits: 8, data: new Uint8Array(W * H).fill(255) });
  const rgbScan = imageStream(doc, { bits: 8, colorSpace: 'DeviceRGB', data: rgbSamples(), extra: { SMask: smask } });
  for (let n = 0; n < 2; n++) {
    const page = doc.addPage([420, 300]);
    page.drawText(`Searchable text ${n}`, { x: 20, y: 270, size: 12, font });
    page.pushOperators(setTextRenderingMode(TextRenderingMode.Invisible));
    page.drawText(`OCR hidden ${n}`, { x: 20, y: 255, size: 10, font });
    page.pushOperators(setTextRenderingMode(TextRenderingMode.Fill));
    page.drawLine({ start: { x: 15, y: 245 }, end: { x: 400, y: 240 }, color: rgb(1, 0, 0), thickness: 2 });
    page.drawRectangle({ x: 300, y: 200, width: 60, height: 30, borderColor: rgb(0, 0, 1), borderWidth: 1 });
    page.node.setXObject(PDFName.of('Scan'), scan);
    page.node.setXObject(PDFName.of('Gray'), gray);
    page.node.setXObject(PDFName.of('Rgb'), rgbScan);
    page.node.addContentStream(doc.context.register(doc.context.flateStream(
      'q 100 0 0 80 10 10 cm /Scan Do Q q 100 0 0 80 120 10 cm /Gray Do Q q 100 0 0 80 230 10 cm /Rgb Do Q')));
    doc.getForm().createTextField(`field${n}`).addToPage(page, { x: 300, y: 120, width: 100, height: 20 });
    doc.getForm().getTextField(`field${n}`).setText('Preserved');
  }
  if (outputIntent) {
    const profile = doc.context.register(doc.context.stream('profile', { N: 3 }));
    doc.catalog.set(PDFName.of('OutputIntents'), doc.context.obj([{ Type: 'OutputIntent', S: 'GTS_PDFA1', DestOutputProfile: profile }]));
  }
  if (signed) {
    const sig = doc.context.register(doc.context.obj({ Type: 'Sig', Filter: 'Test.Handler', ByteRange: [0, 0, 0, 0] }));
    doc.catalog.set(PDFName.of('SigHolder'), sig);
  }
  return { bytes: await doc.save({ useObjectStreams: false }), refs: { scan, gray, smask, rgbScan } };
}

function render(bytes) {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  try {
    return Array.from({ length: doc.countPages() }, (_, n) => {
      const page = doc.loadPage(n);
      const pix = page.toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false, true);
      try { return Uint8Array.from(pix.getPixels()); } finally { pix.destroy(); page.destroy(); }
    });
  } finally { doc.destroy(); }
}

async function pdfjsText(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 });
  const doc = await task.promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) out.push((await (await doc.getPage(i)).getTextContent()).items.map((it) => it.str).join('|'));
  await task.destroy();
  return out;
}

async function contentStreams(bytes) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const contents = page.node.get(PDFName.of('Contents'));
    const refs = contents instanceof PDFRef ? [contents] : doc.context.lookup(contents, PDFArray).asArray();
    return refs.map((ref) => Buffer.from(doc.context.lookup(ref).getContents()).toString('base64'));
  });
}

async function stream(bytes, ref) {
  const doc = await PDFDocument.load(bytes);
  return doc.context.lookup(ref);
}

test('lossless mode keeps text, OCR, vectors and forms; re-encodes only black/white images', async (t) => {
  const { bytes, refs } = await mixedPdf();
  const start = performance.now();
  const result = await optimizeMonochromeDocument(bytes);
  assert.equal(result.reason, null);
  assert.ok(result.bytes && result.newSize < result.origSize);
  t.diagnostic(`PDF ${result.origSize} -> ${result.newSize} bytes in ${Math.round(performance.now() - start)} ms`);

  // Per beeld een grootte of een reden.
  const byRef = Object.fromEntries(result.images.map((img) => [img.ref, img]));
  const scan = byRef[refs.scan.toString()], gray = byRef[refs.gray.toString()], rgbScan = byRef[refs.rgbScan.toString()];
  assert.ok(scan.after < scan.before, 'one-bit scan re-encoded smaller');
  assert.ok(rgbScan.after < rgbScan.before, 'pure black/white RGB packed to one bit');
  assert.equal(gray.after, null);
  assert.equal(gray.reason, 'not-black-and-white');
  assert.equal(result.replaced, 3, 'scan, RGB scan and its all-white soft mask');

  // Tekst blijft extraheerbaar (pdf.js), inclusief de onzichtbare OCR-laag.
  const [textBefore, textAfter] = [await pdfjsText(bytes), await pdfjsText(result.bytes)];
  assert.deepEqual(textAfter, textBefore);
  assert.match(textAfter[1], /Searchable text 1/);
  assert.match(textAfter[1], /OCR hidden 1/);

  // Inhoudsstreams (vectoren, tekst, beeldplaatsing) bytegelijk.
  assert.deepEqual(await contentStreams(result.bytes), await contentStreams(bytes));

  // Het grijsbeeld met tussentinten is onaangeroerd: dictionary en data.
  const [g0, g1] = [await stream(bytes, refs.gray), await stream(result.bytes, refs.gray)];
  assert.equal(g1.dict.toString(), g0.dict.toString());
  assert.deepEqual(Buffer.from(g1.getContents()), Buffer.from(g0.getContents()));

  // Eén-bit beeld: identieke samples, Decode behouden, nu Flate-gecomprimeerd.
  const s1 = await stream(result.bytes, refs.scan);
  assert.deepEqual(Uint8Array.from(inflateSync(s1.getContents())), oneBitSamples());
  assert.equal(s1.dict.get(PDFName.of('Decode')).toString(), '[ 1 0 ]');
  // RGB-beeld: één grijsbit, /SMask onder dezelfde referentie.
  const r1 = await stream(result.bytes, refs.rgbScan);
  assert.equal(r1.dict.get(PDFName.of('ColorSpace')).toString(), '/DeviceGray');
  assert.equal(r1.dict.get(PDFName.of('BitsPerComponent')).toString(), '1');
  assert.equal(r1.dict.get(PDFName.of('SMask')).toString(), refs.smask.toString());

  // Pixelgelijke weergave (MuPDF) op beide pagina's van het gedeelde beeld.
  const [a, b] = [render(bytes), render(result.bytes)];
  assert.equal(b.length, 2);
  for (let n = 0; n < 2; n++) {
    assert.equal(b[n].length, a[n].length);
    assert.equal(b[n].reduce((sum, v, i) => sum + (v !== a[n][i]), 0), 0, `page ${n + 1} pixel-identical`);
  }
  const reopened = await PDFDocument.load(result.bytes);
  assert.equal(reopened.getForm().getTextField('field1').getText(), 'Preserved');
});

test('an output intent blocks RGB packing with a reason; gray and one-bit still go', async () => {
  const { bytes, refs } = await mixedPdf({ outputIntent: true });
  const result = await optimizeMonochromeDocument(bytes);
  const rgbScan = result.images.find((img) => img.ref === refs.rgbScan.toString());
  assert.equal(rgbScan.reason, 'output-intent');
  assert.ok(result.bytes);
  const r1 = await stream(result.bytes, refs.rgbScan);
  assert.equal(r1.dict.get(PDFName.of('ColorSpace')).toString(), '/DeviceRGB');
});

test('signed documents are refused untouched', async () => {
  const { bytes } = await mixedPdf({ signed: true });
  const result = await optimizeMonochromeDocument(bytes);
  assert.equal(result.bytes, null);
  assert.equal(result.reason, 'signed');
});

test('a document without eligible images yields no bytes and every image keeps a reason', async () => {
  const doc = await PDFDocument.create();
  const gray = imageStream(doc, { bits: 8, data: graySamples() });
  const page = doc.addPage([200, 200]);
  page.node.setXObject(PDFName.of('Gray'), gray);
  page.node.addContentStream(doc.context.register(doc.context.flateStream('q 100 0 0 80 10 10 cm /Gray Do Q')));
  const bytes = await doc.save({ useObjectStreams: false });
  const copy = bytes.slice();
  const result = await optimizeMonochromeDocument(bytes);
  assert.equal(result.bytes, null);
  assert.equal(result.reason, 'no-eligible-images');
  assert.deepEqual(result.images.map((img) => img.reason), ['not-black-and-white']);
  assert.deepEqual(bytes, copy, 'source bytes never modified');
  const none = await optimizeMonochromeDocument(await (await PDFDocument.create()).save());
  assert.equal(none.reason, 'no-images');
});

test('cancellation stops with an AbortError and never returns bytes', async () => {
  const { bytes } = await mixedPdf();
  const controller = new AbortController();
  await assert.rejects(optimizeMonochromeDocument(bytes, {
    signal: controller.signal,
    onProgress: ({ done }) => { if (done === 1) controller.abort(); },
  }), { name: 'AbortError' });
});

test('the report lists sizes per image and translated skip reasons', async () => {
  const { bytes } = await mixedPdf();
  const result = await optimizeMonochromeDocument(bytes);
  const t = (key, opts = {}) => `${key}${Object.keys(opts).filter((k) => k !== 'defaultValue' && k !== 'ns').map((k) => `[${k}=${opts[k]}]`).join('')}`;
  const text = losslessReport(result, t, (n) => `${n}B`);
  assert.match(text, /compress\.losslessDone/);
  assert.match(text, /compress\.losslessImage\[ref=\d+\]\[width=200\]\[height=160\]\[before=\d+B\]\[after=\d+B\]/);
  assert.match(text, /compress\.losslessImageKept.*\[reason=compress\.reason\.not-black-and-white\]/);
  const many = { ...result, images: Array.from({ length: 30 }, (_, i) => ({ ref: `${i} 0 R`, width: 1, height: 1, before: 10, after: null, reason: 'not-smaller' })) };
  assert.match(losslessReport(many, t, String), /compress\.losslessMore\[count=\d+\]/);
});
