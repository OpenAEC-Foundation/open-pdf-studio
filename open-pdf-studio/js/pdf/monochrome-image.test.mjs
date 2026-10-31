import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from 'node:zlib';
import { PDFDocument, PDFName, PDFRawStream, StandardFonts, rgb, PDFHexString, setTextRenderingMode, TextRenderingMode } from 'pdf-lib';
import * as mupdf from 'mupdf';
import { optimizeMonochromeImage, MONOCHROME_LIMITS } from './monochrome-image.js';

async function image({ width = 128, height = 128, bits = 1, values = {}, data = null, flate = false } = {}) {
  const doc = await PDFDocument.create();
  const bytes = data ?? new Uint8Array(Math.ceil(width * bits / 8) * height).fill(255);
  const dictionary = doc.context.obj({ Type: 'XObject', Subtype: 'Image', Width: width, Height: height, BitsPerComponent: bits, ColorSpace: 'DeviceGray', ...values });
  if (flate) dictionary.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
  return { doc, stream: PDFRawStream.of(dictionary, flate ? deflateSync(bytes, { level: 0 }) : bytes), bytes };
}
const contents = stream => Uint8Array.from(inflateSync(stream.getContents()));
const unchanged = stream => ({ dict: stream.dict.toString(), data: Uint8Array.from(stream.getContents()) });

test('one-bit samples, padding, Decode and mask/profile references survive recompression', async () => {
  const { doc, stream, bytes } = await image({ width: 127, values: { Decode: [1, 0] } });
  const mask = doc.context.register(doc.context.obj([0, 0]));
  const profile = doc.context.register(doc.context.stream('profile bytes', { N: 1 }));
  stream.dict.set(PDFName.of('Mask'), mask);
  stream.dict.set(PDFName.of('ColorSpace'), doc.context.obj(['ICCBased', profile]));
  const before = unchanged(stream);
  const result = await optimizeMonochromeImage(stream);
  assert.ok(result.replacement && result.after < result.before);
  assert.deepEqual(contents(result.replacement), bytes);
  assert.equal(result.replacement.dict.get(PDFName.of('Mask')), mask);
  assert.equal(result.replacement.dict.get(PDFName.of('ColorSpace')), stream.dict.get(PDFName.of('ColorSpace')));
  assert.equal(result.replacement.dict.get(PDFName.of('Decode')), stream.dict.get(PDFName.of('Decode')));
  assert.deepEqual(unchanged(stream), before, 'source dictionary including Length is never modified');
});

test('indirect Filter and DecodeParms arrays resolve without changing their objects', async () => {
  const { doc, stream, bytes } = await image({ flate: true });
  const params = doc.context.register(doc.context.obj({ Predictor: 1 }));
  stream.dict.set(PDFName.of('Filter'), doc.context.register(doc.context.obj([doc.context.register(PDFName.of('FlateDecode'))])));
  stream.dict.set(PDFName.of('DecodeParms'), doc.context.register(doc.context.obj([params])));
  const before = unchanged(stream);
  const result = await optimizeMonochromeImage(stream);
  assert.ok(result.replacement);
  assert.deepEqual(contents(result.replacement), bytes);
  assert.equal(result.replacement.dict.get(PDFName.of('DecodeParms')), undefined);
  assert.deepEqual(unchanged(stream), before);
  assert.equal(doc.context.lookup(params).toString(), '<<\n/Predictor 1\n>>');
});

test('pure eight-bit gray packs each odd-width row independently and preserves inverted Decode', async () => {
  const bytes = Uint8Array.from({ length: 13 * 200 }, (_, i) => i % 13 === 0 ? 0 : 255);
  const { stream } = await image({ width: 13, height: 200, bits: 8, data: bytes, values: { Decode: [1, 0] } });
  const { replacement } = await optimizeMonochromeImage(stream);
  assert.ok(replacement);
  const packed = contents(replacement);
  assert.equal(packed.length, 2 * 200);
  for (let y = 0; y < 200; y++) for (let x = 0; x < 13; x++) {
    assert.equal((packed[y * 2 + (x >> 3)] >> (7 - (x & 7))) & 1, bytes[y * 13 + x] / 255);
  }
  assert.equal(replacement.dict.get(PDFName.of('BitsPerComponent')).asNumber(), 1);
  assert.equal(replacement.dict.get(PDFName.of('Decode')).toString(), '[ 1 0 ]');
});

test('one-bit indexed and stencil samples are recompressed without a color conversion', async () => {
  for (const values of [{ ColorSpace: ['Indexed', 'DeviceRGB', 1, PDFHexString.of('000000FFFFFF')] }, { ImageMask: true, Decode: [1, 0] }]) {
    const { stream, bytes } = await image({ values });
    const result = await optimizeMonochromeImage(stream);
    assert.ok(result.replacement);
    assert.deepEqual(contents(result.replacement), bytes);
    assert.equal(result.replacement.dict.get(PDFName.of('ColorSpace')), stream.dict.get(PDFName.of('ColorSpace')));
  }
});

for (const [label, opts, reason] of [
  ['gray samples', { bits: 8, data: new Uint8Array(16384).fill(127) }, 'not-black-and-white'],
  ['RGB needs resource/color qualification', { bits: 8, values: { ColorSpace: 'DeviceRGB' } }, 'color-profile-or-space'],
  ['eight-bit indexed', { bits: 8, values: { ColorSpace: ['Indexed', 'DeviceRGB', 1, PDFHexString.of('000000FFFFFF')] } }, 'color-profile-or-space'],
  ['eight-bit mask', { bits: 8, values: { Mask: [0, 0] } }, 'masked-eight-bit'],
  ['eight-bit profile', { bits: 8, values: { ColorSpace: ['ICCBased', 'profile'] } }, 'color-profile-or-space'],
  ['CCITT stays original', { values: { Filter: 'CCITTFaxDecode' } }, 'unsupported-filter'],
  ['DCT stays original', { values: { Filter: 'DCTDecode' } }, 'unsupported-filter'],
  ['multiple filters', { values: { Filter: ['ASCIIHexDecode', 'FlateDecode'] } }, 'unsupported-filter'],
  ['predictor', { flate: true, values: { DecodeParms: { Predictor: 12 } } }, 'unsupported-predictor'],
  ['invalid predictor', { flate: true, values: { DecodeParms: { Predictor: 'bad' } } }, 'unsupported-predictor'],
  ['custom Decode', { bits: 8, values: { Decode: [0, 0.5] } }, 'unsupported-decode'],
  ['missing sample bytes', { data: new Uint8Array(1) }, 'invalid-sample-length'],
  ['external stream', { values: { F: 'outside.tif' } }, 'external-image'],
]) test(`declines ${label} with a reason and leaves input unchanged`, async () => {
  const { stream } = await image(opts);
  const before = unchanged(stream);
  assert.deepEqual(await optimizeMonochromeImage(stream), { replacement: null, reason });
  assert.deepEqual(unchanged(stream), before);
});

test('serialized dictionary overhead can outweigh a smaller compressed payload', async () => {
  const { stream } = await image({ width: 16, height: 8 });
  assert.ok(deflateSync(stream.getContents()).length < stream.getContents().length);
  assert.equal((await optimizeMonochromeImage(stream)).reason, 'not-smaller');
});

test('decode bomb, corrupt data, dimensions and working-buffer limits decline safely', async () => {
  const { stream } = await image({ width: 8, height: 1, values: { Filter: 'FlateDecode' }, data: deflateSync(new Uint8Array(100000)) });
  assert.equal((await optimizeMonochromeImage(stream)).reason, 'decoded-or-output-limit');
  const corrupt = (await image({ values: { Filter: 'FlateDecode' }, data: Uint8Array.of(1, 2, 3) })).stream;
  assert.equal((await optimizeMonochromeImage(corrupt)).reason, 'invalid-image-data');
  const huge = (await image({ data: new Uint8Array(0), values: { Width: 1e12, Height: 1e12 } })).stream;
  assert.equal((await optimizeMonochromeImage(huge)).reason, 'decoded-or-output-limit');
  const small = (await image()).stream;
  assert.equal((await optimizeMonochromeImage(small, { limits: { ...MONOCHROME_LIMITS, workingBytes: 1 } })).reason, 'working-buffer-limit');
});

test('cancellation before work and at packing checkpoints never exposes a candidate', async () => {
  const { stream } = await image({ bits: 8 });
  const controller = new AbortController();
  const before = unchanged(stream);
  await assert.rejects(optimizeMonochromeImage(stream, { signal: controller.signal, checkpoint: () => controller.abort() }), { name: 'AbortError' });
  await assert.rejects(optimizeMonochromeImage(stream, { signal: controller.signal }), { name: 'AbortError' });
  assert.deepEqual(unchanged(stream), before);
});

function rendering(bytes) {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  try { return Array.from({ length: doc.countPages() }, (_, n) => {
    const page = doc.loadPage(n), pix = page.toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false, true), text = page.toStructuredText();
    try { return { pixels: Uint8Array.from(pix.getPixels()), text: text.asText() }; }
    finally { text.destroy(); pix.destroy(); page.destroy(); }
  }); } finally { doc.destroy(); }
}

test('shared images retain page pixels, search text, vectors, forms, annotations and geometry', async t => {
  const data = Uint8Array.from({ length: 127 * 128 }, (_, i) =>
    ((i % 127) + Math.floor(i / 127)) % 17 < 5 ? 0 : 255);
  const { doc, stream } = await image({ width: 127, bits: 8, data, values: { Decode: [1, 0] } });
  const ref = doc.context.register(stream);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let n = 0; n < 2; n++) {
    const page = doc.addPage([320, 240]);
    page.setCropBox(10, 10, 300, 220);
    page.drawText(`Searchable text ${n}`, { x: 20, y: 200, size: 12, font });
    page.pushOperators(setTextRenderingMode(TextRenderingMode.Invisible));
    page.drawText(`OCR hidden ${n}`, { x: 20, y: 185, size: 10, font });
    page.pushOperators(setTextRenderingMode(TextRenderingMode.Fill));
    page.drawLine({ start: { x: 15, y: 160 }, end: { x: 300, y: 170 }, color: rgb(1, 0, 0) });
    page.node.setXObject(PDFName.of('Scan'), ref);
    page.node.addContentStream(doc.context.register(doc.context.flateStream('q 128 0 0 128 40 20 cm /Scan Do Q')));
    const field = doc.getForm().createTextField(`field${n}`);
    field.setText('Preserved');
    field.addToPage(page, { x: 150, y: 30, width: 100, height: 20 });
  }
  const original = await doc.save({ useObjectStreams: false });
  const start = performance.now();
  const result = await optimizeMonochromeImage(stream);
  assert.ok(result.replacement);
  doc.context.assign(ref, result.replacement);
  const optimized = await doc.save({ useObjectStreams: false });
  assert.ok(optimized.length < original.length);
  const a = rendering(original), b = rendering(optimized);
  for (let n = 0; n < 2; n++) {
    assert.match(b[n].text, /Searchable text/);
    assert.match(b[n].text, /OCR hidden/);
    assert.equal(b[n].text, a[n].text);
    assert.equal(b[n].pixels.length, a[n].pixels.length);
    assert.equal(b[n].pixels.reduce((sum, v, i) => sum + (v !== a[n].pixels[i]), 0), 0);
  }
  const reopened = await PDFDocument.load(optimized);
  assert.equal(reopened.getForm().getTextField('field0').getText(), 'Preserved');
  assert.deepEqual(reopened.getPage(0).getCropBox(), { x: 10, y: 10, width: 300, height: 220 });
  t.diagnostic(`PDF ${original.length} -> ${optimized.length} bytes; ${Math.round(performance.now() - start)} ms including independent rendering; modeled buffers ${result.workingBufferBytes} bytes; process maxRSS ${process.resourceUsage().maxRSS} KiB`);
});
