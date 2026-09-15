/**
 * Vector renderer: plays back binary draw commands on Canvas2D.
 * Commands are produced by open-pdf-render (Rust) and transferred as a Uint8Array.
 *
 * Binary format (all values little-endian):
 *   Header: f32 pageWidth, f32 pageHeight (8 bytes)
 *   Then a sequence of commands, each starting with a u8 opcode:
 *     0  MoveTo(f32 x, f32 y)
 *     1  LineTo(f32 x, f32 y)
 *     2  CubicTo(f32 x1, y1, x2, y2, x3, y3)
 *     3  Rect(f32 x, y, w, h)
 *     4  ClosePath
 *     5  SetStroke(u32 rgba, f32 width)
 *     6  SetFill(u32 rgba)
 *     7  Stroke
 *     8  Fill
 *     9  FillEvenOdd
 *    10  Save
 *    11  Restore
 *    12  Transform(f32 a, b, c, d, e, f)
 *    13  SetLineCap(u8)
 *    14  SetLineJoin(u8)
 *    15  SetMiterLimit(f32)
 *    16  SetDash(u8 count, count*f32, f32 phase)
 *    17  BeginPath
 *    18  TextAt(f32 x, f32 y, f32 fontSize, u32 rgba, u8 len, UTF-8 bytes)
 */

// Cache: Map<"filePath:pageNum:rotation", { bytes: Uint8Array, w, h, x0, y0 }>
// Rotation is part of the key so a page rotated 90° coexists with the same
// page un-rotated, without invalidating either when the user toggles back.
const _cache = new Map();

function _key(filePath, pageNum, rotation) {
  return filePath + ':' + pageNum + ':' + ((rotation || 0) % 360);
}

export function clearVectorCache() {
  _cache.clear();
}

/// Drop ALL cached entries for a specific (filePath, pageNum), regardless
/// of rotation. Use this when the page content changes (e.g. after save).
export function invalidatePageCache(filePath, pageNum) {
  _dropByPrefix(filePath + ':' + pageNum + ':');
}

/// Alles van één document weg (tabblad gesloten): de commandobuffers én de
/// gedecodeerde afbeeldingen van al zijn pagina's. Bij openen worden alle
/// pagina's voorverwarmd, dus zonder dit bleef per zware tekening honderden
/// MB staan tot de app afsloot.
export function invalidateDocumentCache(filePath) {
  _dropByPrefix(filePath + ':');
}

function _dropByPrefix(prefix) {
  for (const k of Array.from(_cache.keys())) {
    if (k.startsWith(prefix)) _cache.delete(k);
  }
  for (const k of Array.from(_imageCache.keys())) {
    if (!k.startsWith(prefix)) continue;
    try { _imageCache.get(k)?.close?.(); } catch {}
    _imageCache.delete(k);
  }
}

export function cacheCommands(filePath, pageNum, rawBytes, rotation) {
  const bytes = rawBytes instanceof Uint8Array ? rawBytes : new Uint8Array(rawBytes);
  if (bytes.length < 16) return;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // 16-byte header: x0, y0, width, height (all f32 LE)
  const x0 = dv.getFloat32(0, true);
  const y0 = dv.getFloat32(4, true);
  const w = dv.getFloat32(8, true);
  const h = dv.getFloat32(12, true);
  _cache.set(_key(filePath, pageNum, rotation), { bytes, x0, y0, w, h });
}

export function hasCachedCommands(filePath, pageNum, rotation) {
  return _cache.has(_key(filePath, pageNum, rotation));
}

export function getCachedPageDimensions(filePath, pageNum, rotation) {
  const entry = _cache.get(_key(filePath, pageNum, rotation));
  if (!entry) return null;
  return { x0: entry.x0, y0: entry.y0, w: entry.w, h: entry.h };
}

function _rgbaToCSS(rgba) {
  const r = (rgba >>> 24) & 0xFF;
  const g = (rgba >>> 16) & 0xFF;
  const b = (rgba >>> 8) & 0xFF;
  const a = (rgba & 0xFF) / 255;
  return `rgba(${r},${g},${b},${a})`;
}

const LINE_CAP = ['butt', 'round', 'square'];
const LINE_JOIN = ['miter', 'round', 'bevel'];

// Image cache: key = "<filePath>:<pageNum>:<rotation>:<byte offset>" → ImageBitmap.
// Het pad/de pagina zit in de sleutel: alleen de byte-offset botste tussen
// pagina's en documenten (verkeerde afbeelding) en was per document niet op
// te ruimen.
const _imageCache = new Map();

function _imageKey(filePath, pageNum, rotation, imgPos) {
  return _key(filePath, pageNum, rotation) + ':' + imgPos;
}
let _imagePreparing = false;

/// Pre-decode all images in the command buffer before rendering.
/// Returns a promise that resolves when all images are ready.
export async function prepareImages(filePath, pageNum, rotation) {
  const entry = _cache.get(_key(filePath, pageNum, rotation));
  if (!entry) return;

  const { bytes } = entry;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 16; // skip header

  const promises = [];

  while (pos < bytes.length) {
    const op = bytes[pos++];
    switch (op) {
      case 0: pos += 8; break;  // MoveTo
      case 1: pos += 8; break;  // LineTo
      case 2: pos += 24; break; // CubicTo
      case 3: pos += 16; break; // Rect
      case 4: break;            // ClosePath
      case 5: pos += 8; break;  // SetStroke
      case 6: pos += 4; break;  // SetFill
      case 7: break;            // Stroke
      case 8: break;            // Fill
      case 9: break;            // FillEvenOdd
      case 10: break;           // Save
      case 11: break;           // Restore
      case 12: pos += 24; break; // Transform
      case 13: pos += 1; break; // SetLineCap
      case 14: pos += 1; break; // SetLineJoin
      case 15: pos += 4; break; // SetMiterLimit
      case 16: {                // SetDash
        const count = bytes[pos++];
        pos += count * 4 + 4;
        break;
      }
      case 17: break;           // BeginPath
      case 20: break;           // Clip
      case 21: break;           // ClipEvenOdd
      case 18: {                // TextAt
        pos += 16; // x + y + fontSize + rgba
        const len = bytes[pos++];
        pos += len;
        break;
      }
      case 19: {                // DrawImage
        const imgPos = pos - 1; // position of the opcode
        const w = dv.getUint16(pos, true); pos += 2;
        const h = dv.getUint16(pos, true); pos += 2;
        const dataLen = dv.getUint32(pos, true); pos += 4;
        const imgStart = pos;
        pos += dataLen;

        const imgKey = _imageKey(filePath, pageNum, rotation, imgPos);
        if (!_imageCache.has(imgKey)) {
          const imgBytes = bytes.slice(imgStart, imgStart + dataLen);
          promises.push(_decodeImage(imgKey, w, h, imgBytes));
        }
        break;
      }
      default:
        return; // unknown opcode, stop scanning
    }
  }

  if (promises.length > 0) {
    _imagePreparing = true;
    await Promise.all(promises);
    _imagePreparing = false;
  }
}

async function _decodeImage(cacheKey, w, h, imgBytes) {
  try {
    // Check for RGBA raw format (header: "RGBA" + u16 w + u16 h + pixels)
    if (imgBytes.length > 8 &&
        imgBytes[0] === 0x52 && imgBytes[1] === 0x47 &&
        imgBytes[2] === 0x42 && imgBytes[3] === 0x41) {
      // Raw RGBA pixels
      const pixelData = imgBytes.slice(8);
      const imageData = new ImageData(new Uint8ClampedArray(pixelData), w, h);
      const bitmap = await createImageBitmap(imageData);
      _imageCache.set(cacheKey, bitmap);
      return;
    }

    // Check for JPEG (starts with FF D8)
    if (imgBytes[0] === 0xFF && imgBytes[1] === 0xD8) {
      const blob = new Blob([imgBytes], { type: 'image/jpeg' });
      const bitmap = await createImageBitmap(blob);
      _imageCache.set(cacheKey, bitmap);
      return;
    }

    // Check for PNG (starts with 89 50 4E 47)
    if (imgBytes[0] === 0x89 && imgBytes[1] === 0x50) {
      const blob = new Blob([imgBytes], { type: 'image/png' });
      const bitmap = await createImageBitmap(blob);
      _imageCache.set(cacheKey, bitmap);
      return;
    }

    // Unknown format — try as generic image blob
    const blob = new Blob([imgBytes]);
    const bitmap = await createImageBitmap(blob);
    _imageCache.set(cacheKey, bitmap);
  } catch (e) {
    console.warn(`[vector-renderer] Failed to decode image at offset ${cacheKey}:`, e);
  }
}

export function renderVectorPage(ctx, filePath, pageNum, transform, rotation) {
  const entry = _cache.get(_key(filePath, pageNum, rotation));
  if (!entry) return;
  import('../solid/stores/engineStatusStore.js')
    .then((m) => m.reportActiveEngine('vector', filePath, pageNum))
    .catch(() => {});

  const { bytes, x0, y0, h: pageH } = entry;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 16; // skip 16-byte header (x0, y0, w, h)

  // Apply caller transform, then Y-flip, then translate to MediaBox origin.
  // PDF content is drawn in MediaBox coordinates (which can start at -846, -595
  // etc.) for AutoCAD/Revit/Vectorworks-exported PDFs with centered coordinate
  // systems. After the Y-flip we need to translate by `+y0` (not `-y0`) to
  // map PDF bottom-left (x0,y0) onto canvas (0, pageH). The old `-y0` happened
  // to work when y0 == 0 (standard PDFs) but pushed content 2*|y0| points
  // off-canvas for AutoCAD PDFs — visible as "dark stripes" because only the
  // small portion still inside the viewport got drawn. See:
  // Zware vector PDF p18 regression (29% diff before fix).
  ctx.setTransform(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f);
  ctx.transform(1, 0, 0, -1, 0, pageH);   // Y-flip
  ctx.translate(-x0, y0);                  // Shift to MediaBox origin

  while (pos < bytes.length) {
    const op = bytes[pos++];
    switch (op) {
      case 0: { // MoveTo
        const x = dv.getFloat32(pos, true); pos += 4;
        const y = dv.getFloat32(pos, true); pos += 4;
        ctx.moveTo(x, y);
        break;
      }
      case 1: { // LineTo
        const x = dv.getFloat32(pos, true); pos += 4;
        const y = dv.getFloat32(pos, true); pos += 4;
        ctx.lineTo(x, y);
        break;
      }
      case 2: { // CubicTo
        const x1 = dv.getFloat32(pos, true); pos += 4;
        const y1 = dv.getFloat32(pos, true); pos += 4;
        const x2 = dv.getFloat32(pos, true); pos += 4;
        const y2 = dv.getFloat32(pos, true); pos += 4;
        const x3 = dv.getFloat32(pos, true); pos += 4;
        const y3 = dv.getFloat32(pos, true); pos += 4;
        ctx.bezierCurveTo(x1, y1, x2, y2, x3, y3);
        break;
      }
      case 3: { // Rect
        const x = dv.getFloat32(pos, true); pos += 4;
        const y = dv.getFloat32(pos, true); pos += 4;
        const w = dv.getFloat32(pos, true); pos += 4;
        const h = dv.getFloat32(pos, true); pos += 4;
        ctx.rect(x, y, w, h);
        break;
      }
      case 4: // ClosePath
        ctx.closePath();
        break;
      case 5: { // SetStroke(rgba, width)
        const rgba = dv.getUint32(pos, true); pos += 4;
        const w = dv.getFloat32(pos, true); pos += 4;
        ctx.strokeStyle = _rgbaToCSS(rgba);
        ctx.lineWidth = w;
        break;
      }
      case 6: { // SetFill(rgba)
        const rgba = dv.getUint32(pos, true); pos += 4;
        ctx.fillStyle = _rgbaToCSS(rgba);
        break;
      }
      case 7: // Stroke
        ctx.stroke();
        break;
      case 8: // Fill
        ctx.fill('nonzero');
        break;
      case 9: // FillEvenOdd
        ctx.fill('evenodd');
        break;
      case 10: // Save
        ctx.save();
        break;
      case 11: // Restore
        ctx.restore();
        break;
      case 12: { // Transform
        const a = dv.getFloat32(pos, true); pos += 4;
        const b = dv.getFloat32(pos, true); pos += 4;
        const c = dv.getFloat32(pos, true); pos += 4;
        const d = dv.getFloat32(pos, true); pos += 4;
        const e = dv.getFloat32(pos, true); pos += 4;
        const f = dv.getFloat32(pos, true); pos += 4;
        ctx.transform(a, b, c, d, e, f);
        break;
      }
      case 13: { // SetLineCap
        const cap = bytes[pos++];
        ctx.lineCap = LINE_CAP[cap] || 'butt';
        break;
      }
      case 14: { // SetLineJoin
        const join = bytes[pos++];
        ctx.lineJoin = LINE_JOIN[join] || 'miter';
        break;
      }
      case 15: { // SetMiterLimit
        const limit = dv.getFloat32(pos, true); pos += 4;
        ctx.miterLimit = limit;
        break;
      }
      case 16: { // SetDash
        const count = bytes[pos++];
        const pattern = [];
        for (let i = 0; i < count; i++) {
          pattern.push(dv.getFloat32(pos, true)); pos += 4;
        }
        const phase = dv.getFloat32(pos, true); pos += 4;
        ctx.setLineDash(pattern);
        ctx.lineDashOffset = phase;
        break;
      }
      case 17: // BeginPath
        ctx.beginPath();
        break;
      case 18: { // TextAt (legacy fallback, mostly unused now)
        const x = dv.getFloat32(pos, true); pos += 4;
        const y = dv.getFloat32(pos, true); pos += 4;
        const fontSize = dv.getFloat32(pos, true); pos += 4;
        const rgba = dv.getUint32(pos, true); pos += 4;
        const len = bytes[pos++];
        const text = new TextDecoder().decode(bytes.slice(pos, pos + len));
        pos += len;
        ctx.save();
        ctx.scale(1, -1);
        ctx.font = `${fontSize}px sans-serif`;
        ctx.fillStyle = _rgbaToCSS(rgba);
        ctx.fillText(text, x, -y);
        ctx.restore();
        break;
      }
      case 20: // Clip (nonzero winding)
        ctx.clip('nonzero');
        break;
      case 21: // ClipEvenOdd
        ctx.clip('evenodd');
        break;
      case 19: { // DrawImage(w, h, dataLen, imageBytes)
        const imgPos = pos - 1; // cache key = opcode position
        const imgW = dv.getUint16(pos, true); pos += 2;
        const imgH = dv.getUint16(pos, true); pos += 2;
        const dataLen = dv.getUint32(pos, true); pos += 4;
        pos += dataLen; // skip image data (already decoded in cache)

        const bitmap = _imageCache.get(_imageKey(filePath, pageNum, rotation, imgPos));
        if (bitmap) {
          // High-quality bilinear/bicubic interpolation for embedded raster images
          const prevSmoothing = ctx.imageSmoothingEnabled;
          const prevQuality = ctx.imageSmoothingQuality;
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          // Draw image in the 1×1 PDF unit square (CTM maps to correct page position)
          ctx.drawImage(bitmap, 0, 0, 1, 1);
          ctx.imageSmoothingEnabled = prevSmoothing;
          ctx.imageSmoothingQuality = prevQuality;
        }
        break;
      }
      default:
        console.warn(`[vector-renderer] Unknown opcode ${op} at position ${pos - 1}`);
        return; // bail out on unknown command
    }
  }
}
