const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngPhysicalSize(dpi) {
  const chunk = new Uint8Array(21);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, 9);
  chunk.set([112, 72, 89, 115], 4); // pHYs
  const pixelsPerMeter = Math.round(dpi / 0.0254);
  view.setUint32(8, pixelsPerMeter);
  view.setUint32(12, pixelsPerMeter);
  chunk[16] = 1; // metres
  view.setUint32(17, crc32(chunk.subarray(4, 17)));
  return chunk;
}

function pngWithDpi(bytes, dpi) {
  if (bytes.length < 20 || !PNG_SIGNATURE.every((byte, i) => bytes[i] === byte)) {
    throw new Error('Invalid PNG image');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks = [bytes.subarray(0, 8)];
  const physicalSize = pngPhysicalSize(dpi);
  let offset = 8, first = true, ended = false;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) throw new Error('Invalid PNG chunk');
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (first && type !== 'IHDR') throw new Error('Invalid PNG header');
    if (type !== 'pHYs') chunks.push(bytes.subarray(offset, end));
    if (first) chunks.push(physicalSize);
    first = false;
    offset = end;
    if (type === 'IEND') { ended = true; break; }
  }
  if (!ended || offset !== bytes.length) throw new Error('Incomplete PNG image');
  const output = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) { output.set(chunk, at); at += chunk.length; }
  return output;
}

function jpegWithDpi(bytes, dpi) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('Invalid JPEG image');
  let offset = 2;
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) break; // compressed scan or end
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    const end = offset + 2 + length;
    if (length < 2 || end > bytes.length) throw new Error('Invalid JPEG segment');
    if (marker === 0xe0 && length >= 16 &&
      bytes[offset + 4] === 74 && bytes[offset + 5] === 70 && bytes[offset + 6] === 73 &&
      bytes[offset + 7] === 70 && bytes[offset + 8] === 0) {
      const output = bytes.slice();
      output[offset + 11] = 1; // density unit: inches
      output[offset + 12] = dpi >>> 8; output[offset + 13] = dpi & 255;
      output[offset + 14] = dpi >>> 8; output[offset + 15] = dpi & 255;
      return output;
    }
    offset = end;
  }
  // Canvas JPEGs normally carry JFIF. Add one for encoders that omit it.
  const header = new Uint8Array([0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 2, 1,
    dpi >>> 8, dpi & 255, dpi >>> 8, dpi & 255, 0, 0]);
  const output = new Uint8Array(bytes.length + header.length);
  output.set(bytes.subarray(0, 2));
  output.set(header, 2);
  output.set(bytes.subarray(2), 2 + header.length);
  return output;
}

/** Preserve image pixels while recording the selected physical resolution. */
export function imageWithDpi(bytes, format, dpi) {
  if (!(bytes instanceof Uint8Array) || !Number.isSafeInteger(dpi) || dpi < 1 || dpi > 65535) {
    throw new Error('Invalid image resolution');
  }
  if (format === 'png') return pngWithDpi(bytes, dpi);
  if (format === 'jpeg') return jpegWithDpi(bytes, dpi);
  throw new Error(`Unsupported image format: ${format}`);
}
