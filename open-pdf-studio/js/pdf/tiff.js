/** Encode a canvas as an uncompressed, baseline RGB TIFF. */
export function canvasToTiffBytes(canvas, dpi = 150) {
  const width = canvas.width;
  const height = canvas.height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new Error('Invalid TIFF dimensions');
  }
  if (!Number.isInteger(dpi) || dpi < 1 || dpi > 65535) {
    throw new Error('Invalid TIFF resolution');
  }

  const entryCount = 13;
  const bitsOffset = 8 + 2 + entryCount * 12 + 4;
  const xResolutionOffset = bitsOffset + 6;
  const yResolutionOffset = xResolutionOffset + 8;
  const pixelsOffset = yResolutionOffset + 8;
  const byteCount = width * height * 3;
  if (!Number.isSafeInteger(byteCount) || pixelsOffset + byteCount > 0xffffffff) {
    throw new Error('TIFF image exceeds the 4 GB format limit');
  }

  const bytes = new Uint8Array(pixelsOffset + byteCount);
  const view = new DataView(bytes.buffer);
  bytes[0] = 0x49; bytes[1] = 0x49; // little endian
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  view.setUint16(8, entryCount, true);

  let entryOffset = 10;
  const entry = (tag, type, count, value) => {
    view.setUint16(entryOffset, tag, true);
    view.setUint16(entryOffset + 2, type, true);
    view.setUint32(entryOffset + 4, count, true);
    if (type === 3 && count === 1) view.setUint16(entryOffset + 8, value, true);
    else view.setUint32(entryOffset + 8, value, true);
    entryOffset += 12;
  };
  entry(256, 4, 1, width); // ImageWidth
  entry(257, 4, 1, height); // ImageLength
  entry(258, 3, 3, bitsOffset); // BitsPerSample
  entry(259, 3, 1, 1); // Compression: none
  entry(262, 3, 1, 2); // PhotometricInterpretation: RGB
  entry(273, 4, 1, pixelsOffset); // StripOffsets
  entry(277, 3, 1, 3); // SamplesPerPixel
  entry(278, 4, 1, height); // RowsPerStrip
  entry(279, 4, 1, byteCount); // StripByteCounts
  entry(282, 5, 1, xResolutionOffset); // XResolution
  entry(283, 5, 1, yResolutionOffset); // YResolution
  entry(284, 3, 1, 1); // PlanarConfiguration: chunky
  entry(296, 3, 1, 2); // ResolutionUnit: inches
  view.setUint32(entryOffset, 0, true); // next IFD
  for (let channel = 0; channel < 3; channel++) view.setUint16(bitsOffset + channel * 2, 8, true);
  view.setUint32(xResolutionOffset, dpi, true); view.setUint32(xResolutionOffset + 4, 1, true);
  view.setUint32(yResolutionOffset, dpi, true); view.setUint32(yResolutionOffset + 4, 1, true);

  const rgba = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  for (let src = 0, dst = pixelsOffset; src < rgba.length; src += 4, dst += 3) {
    const alpha = rgba[src + 3] / 255;
    for (let channel = 0; channel < 3; channel++) {
      bytes[dst + channel] = Math.round(rgba[src + channel] * alpha + 255 * (1 - alpha));
    }
  }
  return bytes;
}
