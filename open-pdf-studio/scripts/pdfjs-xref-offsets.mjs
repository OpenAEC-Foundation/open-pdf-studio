// Narrow backport of Mozilla PDF.js #22172, Apache-2.0.
// The XRef stream reader below is derived from PDF.js, Copyright Mozilla Foundation.
// Licensed under the Apache License, Version 2.0: https://www.apache.org/licenses/LICENSE-2.0
// Remove this backport only after qualifying a pdfjs-dist release containing the fix.
//
// #638: PDF.js 6.4.299 decodes XRef stream object offsets with `offset << 8 |
// byte`, i.e. signed 32-bit integers. An offset of 2^31..2^32-1 turns negative
// and one of 2^32 or more wraps (2^32 + 10 -> 10), so a PDF larger than 2 GiB
// that uses an XRef stream fails to load or falls back to a full reindex.
// Plain arithmetic is exact up to Number.MAX_SAFE_INTEGER. Type and generation
// fields stay bitwise, exactly as upstream: their values are always small.
//
// What this does NOT cover (still open in #638):
// - No real multi-GB XRef-stream PDF has been loaded through the application
//   loader; the tests decode synthetic XRef streams with 5- and 8-byte offset
//   fields instead of multi-gigabyte fixtures.
// - Large-file support in general: the loader still holds the whole file in
//   memory and copies it (.slice() before PDF.js, originalBytesCache, IPC), so
//   platform allocation and ArrayBuffer limits apply separately (see #102).
// - Classic textual `xref` tables were never affected (offsets parsed as text).

const BEFORE = String.raw`        for (let j = 0; j < offsetFieldWidth; ++j) {
          const offsetByte = stream.getByte();
          if (offsetByte === -1) {
            throw new FormatError("Invalid XRef byteWidths 'offset'.");
          }
          offset = offset << 8 | offsetByte;
        }
`;
const AFTER = String.raw`        for (let j = 0; j < offsetFieldWidth; ++j) {
          const offsetByte = stream.getByte();
          if (offsetByte === -1) {
            throw new FormatError("Invalid XRef byteWidths 'offset'.");
          }
          // Not using bitwise operations, since offsets can exceed 2^31 bytes.
          offset = offset * 256 + offsetByte;
        }
`;

export function patchXrefStreamOffsets(source) {
  // Fail closed on dependency drift instead of silently shipping an unpatched worker.
  if (source.split(AFTER).length === 2 && !source.includes(BEFORE)) return source;
  if (source.split(BEFORE).length !== 2) {
    throw new Error('PDF.js XRef stream offset backport no longer matches; qualify the worker before updating PDF.js (#638).');
  }
  return source.replace(BEFORE, AFTER);
}
