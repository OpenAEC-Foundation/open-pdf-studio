// Conservative image-XObject building block for #902. No document parsing,
// UI, file writes or mutation: a caller must qualify those budgets separately.
import { PDFArray, PDFDict, PDFName, PDFNumber, PDFNull, PDFBool, PDFRef, PDFRawStream } from 'pdf-lib';

export const MONOCHROME_LIMITS = Object.freeze({ decodedBytes: 32 * 1024 * 1024, encodedBytes: 32 * 1024 * 1024, workingBytes: 96 * 1024 * 1024 });
class SkipImage extends Error {}
const skip = reason => { throw new SkipImage(reason); };
const checkAbort = signal => { if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError'); };
const name = value => value instanceof PDFName ? value.decodeText() : null;
const number = value => value instanceof PDFNumber ? value.asNumber() : null;
function resolve(context, value) {
  const seen = new Set();
  while (value instanceof PDFRef) {
    const key = value.toString();
    if (seen.has(key) || seen.size >= 16) skip('invalid-reference');
    seen.add(key);
    value = context.lookup(value);
    if (!value) skip('invalid-reference');
  }
  return value;
}

// Native streaming Flate with bounded input chunks and a fixed output buffer.
// The limit bounds buffers retained here, not native codec or PDF-parser RSS.
async function transform(bytes, codec, limit, signal) {
  let offset = 0;
  const source = new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      const end = Math.min(offset + 65536, bytes.length);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    },
  });
  const reader = source.pipeThrough(codec).getReader();
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  const result = new Uint8Array(limit);
  let used = 0;
  try {
    checkAbort(signal);
    for (;;) {
      const { done, value } = await reader.read();
      checkAbort(signal);
      if (done) break;
      if (value.length > limit - used) skip('decoded-or-output-limit');
      result.set(value, used);
      used += value.length;
    }
    return result.subarray(0, used);
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/**
 * Returns a smaller replacement stream, or a stable skip reason. The source
 * stream/dictionary, indirect resources and document are never modified.
 * Supports raw/Flate one-bit gray, stencil, indexed and single-channel ICC
 * samples, plus exactly black/white eight-bit DeviceGray samples. RGB packing is deliberately unsupported: a
 * conversion to gray needs all shared-use default color spaces/output intents.
 * Other filters/profiles/predictors remain untouched with an explicit reason.
 */
export async function optimizeMonochromeImage(stream, { signal, limits = MONOCHROME_LIMITS, checkpoint = () => new Promise(r => setTimeout(r, 0)) } = {}) {
  checkAbort(signal);
  if (!(stream instanceof PDFRawStream)) return { replacement: null, reason: 'not-image' };
  const context = stream.dict.context;
  const get = key => resolve(context, stream.dict.get(PDFName.of(key)));
  try {
    if (name(get('Subtype')) !== 'Image') skip('not-image');
    for (const key of ['decodedBytes', 'encodedBytes', 'workingBytes']) {
      if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > MONOCHROME_LIMITS[key]) throw new RangeError(`Invalid ${key}`);
    }
    if (get('F')) skip('external-image');
    const width = number(get('Width')), height = number(get('Height'));
    if (![width, height].every(n => Number.isSafeInteger(n) && n > 0)) skip('invalid-dimensions');
    const stencil = get('ImageMask') === PDFBool.True;
    const bits = number(get('BitsPerComponent')) ?? (stencil ? 1 : null);
    if (bits !== 1 && bits !== 8) skip('unsupported-samples');
    const color = get('ColorSpace');
    const channels = 1;
    if (bits === 8) {
      if (stencil || get('Mask') || get('SMask') || (number(get('SMaskInData')) ?? 0) !== 0) skip('masked-eight-bit');
      if (name(color) !== 'DeviceGray') skip('color-profile-or-space');
    } else if (!stencil && name(color) !== 'DeviceGray') {
      if (!(color instanceof PDFArray)) skip('color-profile-or-space');
      const kind = name(resolve(context, color.get(0)));
      if (kind !== 'Indexed') {
        const profile = kind === 'ICCBased' ? resolve(context, color.get(1)) : null;
        if (!(profile instanceof PDFRawStream) || number(resolve(context, profile.dict.get(PDFName.of('N')))) !== 1) skip('color-profile-or-space');
      }
    }
    const rowBytes = Math.ceil(width * channels * bits / 8);
    const decodedSize = rowBytes * height;
    const packedSize = Math.ceil(width / 8) * height;
    if (!Number.isSafeInteger(decodedSize) || decodedSize > limits.decodedBytes) skip('decoded-or-output-limit');
    const input = stream.getContents();
    if (input.length > limits.encodedBytes) skip('encoded-limit');
    // Worst retained buffers: input, decoded input, packed samples, compressed
    // output and its final compact copy. This is NOT a total-process RSS cap.
    const outputCap = Math.min(limits.encodedBytes, input.length + 1024);
    const working = input.length + decodedSize + (bits === 8 ? packedSize : 0) + outputCap * 2;
    if (working > limits.workingBytes) skip('working-buffer-limit');

    let filter = get('Filter'), params = get('DecodeParms');
    if (filter instanceof PDFArray) {
      if (filter.size() !== 1) skip('unsupported-filter');
      filter = resolve(context, filter.get(0));
      if (params instanceof PDFArray) {
        if (params.size() !== 1) skip('unsupported-predictor');
        params = resolve(context, params.get(0));
      } else if (params && params !== PDFNull) skip('unsupported-predictor');
    } else if (params instanceof PDFArray) skip('unsupported-predictor');
    if (filter && filter !== PDFNull && name(filter) !== 'FlateDecode') skip('unsupported-filter');
    if (params && params !== PDFNull) {
      if (!(params instanceof PDFDict)) skip('unsupported-predictor');
      const predictor = resolve(context, params.get(PDFName.of('Predictor')));
      if (predictor && number(predictor) !== 1) skip('unsupported-predictor');
    }
    if (typeof CompressionStream !== 'function' || typeof DecompressionStream !== 'function') skip('codec-unavailable');
    const samples = name(filter) === 'FlateDecode'
      ? await transform(input, new DecompressionStream('deflate'), decodedSize, signal)
      : input;
    if (samples.length !== decodedSize) skip('invalid-sample-length');
    let packed = samples;
    let decode = null;
    if (bits === 8) {
      const d = get('Decode');
      if (d && d !== PDFNull) {
        if (!(d instanceof PDFArray) || d.size() !== channels * 2) skip('unsupported-decode');
        const values = d.asArray().map(v => number(resolve(context, v)));
        if (!((values[0] === 0 && values[1] === 1) || (values[0] === 1 && values[1] === 0))
          || values.some((v, i) => v !== values[i % 2])) skip('unsupported-decode');
        decode = values.slice(0, 2);
      }
      packed = new Uint8Array(packedSize);
      const stride = Math.ceil(width / 8);
      for (let y = 0; y < height; y++) {
        if (y % 32 === 0) { await checkpoint(); checkAbort(signal); }
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * channels;
          const value = samples[i];
          if ((value !== 0 && value !== 255)) skip('not-black-and-white');
          if (value === 255) packed[y * stride + (x >> 3)] |= 128 >> (x & 7);
        }
      }
    }
    checkAbort(signal);
    const compressed = await transform(packed, new CompressionStream('deflate'), outputCap, signal);
    checkAbort(signal);
    const dictionary = stream.dict.clone(context);
    dictionary.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
    dictionary.delete(PDFName.of('DecodeParms'));
    dictionary.set(PDFName.of('Length'), PDFNumber.of(compressed.length));
    if (bits === 8) {
      dictionary.set(PDFName.of('BitsPerComponent'), PDFNumber.of(1));
      dictionary.set(PDFName.of('ColorSpace'), PDFName.of('DeviceGray'));
      if (decode) dictionary.set(PDFName.of('Decode'), context.obj(decode));
    }
    // Compare COMPLETE serialized stream objects (dictionary + data). Masks
    // and profiles retain the same references/content, so their cost cancels.
    const original = PDFRawStream.of(stream.dict.clone(context), input);
    const candidate = PDFRawStream.of(dictionary, compressed);
    const before = original.sizeInBytes(), after = candidate.sizeInBytes();
    if (after >= before) skip('not-smaller');
    return { replacement: PDFRawStream.of(dictionary, compressed.slice()), reason: null, before, after, decodedBytes: decodedSize, workingBufferBytes: working };
  } catch (error) {
    checkAbort(signal);
    if (error instanceof SkipImage) return { replacement: null, reason: error.message };
    if (error instanceof RangeError) throw error;
    return { replacement: null, reason: 'invalid-image-data' };
  }
}
