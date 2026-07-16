import { PDFName, PDFArray } from 'pdf-lib';
import { pdfNum, inflateBytes } from './pdf-helpers.js';
import { findImageAnnotationSources, findImageForAnnotation } from './annotation-image-sources.mjs';

// Hybrid stamp image extraction. Tries to extract each stamp via pdf-lib's
// XObject reader first (clean — never bakes in overlapping annotations),
// and falls back to the PDF.js render+crop method ONLY for stamps the
// pdf-lib path couldn't decode (e.g. stamps whose appearance stream is
// drawn content rather than a wrapped image XObject).
//
// This restores the fix from commit 178cf51 ("stamp ghost on load") for the
// common case while preserving the PDF.js fallback for complex stamps.
//
// Symptom of NOT using this hybrid: when you move a Stamp annotation that
// has any other annotation (highlight, draw, note) overlapping its bounds,
// the overlapping annotation's pixels appear glued to the stamp and travel
// with it. The bake-in happens because page.render() with annotationMode:1
// rasterizes ALL annotations onto the temp canvas before cropping.
export async function extractStampImagesHybrid(page, viewport, stampAnnots, pageNum, pdfLibDoc) {
  if (stampAnnots.length === 0 && !pdfLibDoc) return new Map();

  // First pass: pdf-lib extraction (clean, no bake-in)
  let imageMap = new Map();
  if (pdfLibDoc) {
    try {
      imageMap = await extractStampImages(pageNum, pdfLibDoc);
    } catch (e) {
      console.warn('[image-extraction] pdf-lib extraction failed:', e);
      imageMap = new Map();
    }
  }

  // Identify stamps the pdf-lib path couldn't handle (key = rect string)
  const missing = stampAnnots.filter(s => {
    const rect = s.rect;
    if (!rect) return false;
    return !findImageForAnnotation(imageMap, s, 'stamp');
  });

  // Second pass: PDF.js render+crop for the leftovers (still bakes in
  // overlapping annotations for these specific stamps — known limitation
  // for stamps with drawn appearance content).
  if (missing.length > 0) {
    try {
      const fallbackMap = await extractStampImagesViaPdfJs(page, viewport, missing);
      for (const [k, v] of fallbackMap) {
        imageMap.set(k, v);
      }
    } catch (e) {
      console.warn('[image-extraction] PDF.js fallback failed:', e);
    }
  }

  return imageMap;
}

// Extract stamp images by rendering the page with annotations via PDF.js,
// then cropping each stamp's region from the rendered result.
// Uses a high-resolution render (3x) for sharp images at all zoom levels.
//
// WARNING: this method bakes in any annotation that overlaps a stamp's
// bounding box because PDF.js renders all annotations together. Prefer
// extractStampImagesHybrid() which uses pdf-lib first and falls back here
// only when pdf-lib can't decode a stamp's appearance.
export async function extractStampImagesViaPdfJs(page, viewport, stampAnnots) {
  const imageMap = new Map();
  if (stampAnnots.length === 0) return imageMap;

  try {
    // Render at up to 2x for quality, but cap total pixels so a very large
    // sheet (A0/A1 bouwtekening) doesn't allocate a multi-hundred-MB canvas
    // just to crop a few stamp thumbnails. Same guard philosophy as the
    // MAX_PIXELS cap in crop-margins.js. The cropping loop below uses
    // hiResViewport.convertToViewportPoint(), so it adapts to whatever scale
    // we end up rendering at — crop coordinates stay correct at any scale.
    //
    // CRITICAL: the canvas pixel dimensions must exactly match the viewport
    // dimensions — do NOT apply additional DPR scaling, otherwise crop
    // coordinates will be wrong (causing tiled/repeated images).
    const MAX_PIXELS = 20_000_000; // ~20 MP, matches crop-margins.js
    const baseViewport = page.getViewport({ scale: 1 });
    const basePixels = baseViewport.width * baseViewport.height;
    let hiResScale = 2;
    if (basePixels > 0 && basePixels * hiResScale * hiResScale > MAX_PIXELS) {
      hiResScale = Math.max(1, Math.sqrt(MAX_PIXELS / basePixels));
    }
    const hiResViewport = page.getViewport({ scale: hiResScale });

    // Canvas pixel size must EXACTLY match viewport dimensions.
    // Do NOT apply DPR scaling — it causes crop coordinate mismatch (tiled images).
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = Math.floor(hiResViewport.width);
    tempCanvas.height = Math.floor(hiResViewport.height);

    await page.render({
      canvasContext: tempCanvas.getContext('2d'),
      viewport: hiResViewport,
      annotationMode: 1,
    }).promise;

    // Crop each stamp's region from the high-res rendered canvas
    for (const stamp of stampAnnots) {
      const rect = stamp.rect; // PDF coordinates [x1, y1, x2, y2]
      // Convert PDF coordinates to high-res canvas pixel coordinates
      const [vx1, vy1] = hiResViewport.convertToViewportPoint(rect[0], rect[1]);
      const [vx2, vy2] = hiResViewport.convertToViewportPoint(rect[2], rect[3]);

      const cropX = Math.round(Math.min(vx1, vx2));
      const cropY = Math.round(Math.min(vy1, vy2));
      const cropW = Math.round(Math.abs(vx2 - vx1));
      const cropH = Math.round(Math.abs(vy2 - vy1));

      if (cropW > 0 && cropH > 0) {
        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = cropW;
        cropCanvas.height = cropH;
        const cropCtx = cropCanvas.getContext('2d');
        cropCtx.drawImage(tempCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

        const dataUrl = cropCanvas.toDataURL('image/png');
        const key = stamp.id
          ? `id:${stamp.id}`
          : `rect:${rect[0]},${rect[1]},${rect[2]},${rect[3]}`;
        imageMap.set(key, { kind: 'stamp', dataUrl });
      }
    }
  } catch (e) {
    console.warn('Failed to extract stamp images via PDF.js:', e);
  }

  return imageMap;
}

// Extract stamp images from PDF using pdf-lib (fallback)
export async function extractStampImages(pageNum, pdfDoc) {
  const imageMap = new Map();

  try {
    const context = pdfDoc.context;
    for (const source of findImageAnnotationSources(pageNum, pdfDoc)) {
      const dataUrl = await extractImageFromFormXObject(context, source.stream);
      if (dataUrl) {
        const key = source.annotationId
          ? `id:${source.annotationId}`
          : `rect:${source.rectKey}`;
        imageMap.set(key, { kind: source.kind, dataUrl });
      }
    }
  } catch (e) {
    console.warn('Failed to extract stamp images:', e);
  }

  return imageMap;
}

// Extract the first image from a Form XObject's resources
export async function extractImageFromFormXObject(context, formStream) {
  try {
    const dict = formStream.dict || formStream;

    // Check if this IS an image directly
    const subtype = dict.get(PDFName.of('Subtype'));
    if (subtype && subtype.toString() === '/Image') {
      return await decodeImageStream(context, formStream);
    }

    // It's a Form XObject - dig into Resources/XObject to find images
    const resRaw = dict.get(PDFName.of('Resources'));
    if (!resRaw) { console.warn('Form XObject has no /Resources'); return null; }
    const resDict = context.lookup(resRaw);
    if (!resDict) return null;

    const xobjRaw = resDict.get(PDFName.of('XObject'));
    if (!xobjRaw) { console.warn('Resources has no /XObject'); return null; }
    const xobjDict = context.lookup(xobjRaw);
    if (!xobjDict) return null;

    // Iterate XObject entries looking for images
    const entries = xobjDict.entries();
    for (const [name, ref] of entries) {
      const obj = context.lookup(ref);
      if (!obj) continue;
      const innerDict = obj.dict || obj;
      const innerSubtype = innerDict.get(PDFName.of('Subtype'));
      if (innerSubtype && innerSubtype.toString() === '/Image') {
        const result = await decodeImageStream(context, obj);
        if (result) return result;
      }
      // Could be a nested Form XObject containing an image
      if (innerSubtype && innerSubtype.toString() === '/Form') {
        const result = await extractImageFromFormXObject(context, obj);
        if (result) return result;
      }
    }
  } catch (e) {
    console.warn('extractImageFromFormXObject error:', e);
  }
  return null;
}

// Parse a PDF color space and return { type, numComponents, palette, baseComponents }
// Async because Indexed palette streams may be FlateDecoded.
export async function parseColorSpace(context, csRaw) {
  if (!csRaw) return { type: 'rgb', numComponents: 3 };

  const cs = context.lookup(csRaw) || csRaw;
  const csStr = cs.toString();
  const isArray = cs instanceof PDFArray || (cs.size && typeof cs.get === 'function' && !(cs instanceof PDFName));

  // Array-based color spaces: [/Name, ...params] — must be checked BEFORE simple-name fallback.
  // Otherwise [/Indexed /DeviceRGB ...] is misclassified as RGB and 1-byte indexed pixels
  // are decoded as 3-byte RGB triples, producing a "3 horizontal tiles" rendering artifact.
  if (isArray) {
    const nameObj = cs.get(0);
    const name = nameObj ? (context.lookup(nameObj) || nameObj).toString() : '';

    // ICCBased [/ICCBased, streamRef] - check N for component count
    if (name.includes('ICCBased') && cs.size() >= 2) {
      const profileStream = context.lookup(cs.get(1));
      const n = pdfNum(profileStream?.dict?.get(PDFName.of('N')));
      if (n === 1) return { type: 'gray', numComponents: 1 };
      if (n === 4) return { type: 'cmyk', numComponents: 4 };
      return { type: 'rgb', numComponents: n || 3 };
    }

    // Indexed [/Indexed, baseCS, hival, lookupData]
    if (name.includes('Indexed') && cs.size() >= 4) {
      const baseCS = await parseColorSpace(context, cs.get(1));
      const hival = pdfNum(context.lookup(cs.get(2)) || cs.get(2)) || 255;
      let lookupData = null;
      const lookupRaw = cs.get(3);
      const lookupObj = context.lookup(lookupRaw) || lookupRaw;
      if (lookupObj && lookupObj.contents) {
        // It's a stream — decompress if FlateDecoded so the palette is raw RGB triples.
        // Without this, indexed colors map to garbage (compressed bytes).
        lookupData = lookupObj.contents;
        const lFilter = lookupObj.dict?.get(PDFName.of('Filter'))?.toString();
        if (lFilter === '/FlateDecode') {
          const inflated = await inflateBytes(lookupData);
          if (inflated) lookupData = inflated;
        }
      } else if (lookupObj && typeof lookupObj.toString === 'function') {
        // Raw bytes encoded as string. Prefer pdf-lib's structured accessors
        // (asBytes / value) so PDF escape sequences are properly decoded.
        if (typeof lookupObj.asBytes === 'function') {
          // PDFHexString
          lookupData = lookupObj.asBytes();
        } else if (lookupObj.value instanceof Uint8Array) {
          // PDFString.value (newer pdf-lib)
          lookupData = lookupObj.value;
        } else if (typeof lookupObj.value === 'string') {
          // PDFString.value as string — already unescaped by pdf-lib
          const s = lookupObj.value;
          lookupData = new Uint8Array(s.length);
          for (let i = 0; i < s.length; i++) lookupData[i] = s.charCodeAt(i) & 0xff;
        } else {
          // Fallback: parse the string repr
          const str = lookupObj.toString();
          if (str.startsWith('<')) {
            // Hex string e.g. <DEADBEEF>
            const hex = str.slice(1, -1).replace(/\s/g, '');
            lookupData = new Uint8Array(hex.length / 2);
            for (let i = 0; i < hex.length; i += 2) {
              lookupData[i / 2] = parseInt(hex.substring(i, i + 2), 16);
            }
          } else if (str.startsWith('(')) {
            // Literal string (...) — unescape PDF escape sequences
            const inner = str.slice(1, -1);
            const bytes = [];
            let i = 0;
            while (i < inner.length) {
              const c = inner.charCodeAt(i);
              if (c === 0x5C && i + 1 < inner.length) { // backslash escape
                const n = inner[i + 1];
                if (n === 'n') { bytes.push(10); i += 2; }
                else if (n === 'r') { bytes.push(13); i += 2; }
                else if (n === 't') { bytes.push(9); i += 2; }
                else if (n === 'b') { bytes.push(8); i += 2; }
                else if (n === 'f') { bytes.push(12); i += 2; }
                else if (n === '(' || n === ')' || n === '\\') { bytes.push(n.charCodeAt(0)); i += 2; }
                else if (/[0-7]/.test(n)) {
                  // Octal escape \nnn (1-3 digits)
                  let oct = '';
                  let j = i + 1;
                  while (j < inner.length && oct.length < 3 && /[0-7]/.test(inner[j])) {
                    oct += inner[j]; j++;
                  }
                  bytes.push(parseInt(oct, 8) & 0xff);
                  i = j;
                } else { bytes.push(n.charCodeAt(0) & 0xff); i += 2; }
              } else {
                bytes.push(c & 0xff); i++;
              }
            }
            lookupData = new Uint8Array(bytes);
          } else {
            lookupData = new Uint8Array([...str].map(c => c.charCodeAt(0) & 0xff));
          }
        }
      }
      return {
        type: 'indexed',
        numComponents: 1,
        baseComponents: baseCS.numComponents,
        baseType: baseCS.type,
        palette: lookupData,
        hival,
      };
    }

    // Separation [/Separation, name, alternateCS, tintTransform]
    // DeviceN [/DeviceN, names, alternateCS, tintTransform]
    if (name.includes('Separation')) {
      return { type: 'gray', numComponents: 1 };
    }
    if (name.includes('DeviceN') && cs.size() >= 3) {
      const namesArr = context.lookup(cs.get(1)) || cs.get(1);
      const n = namesArr && namesArr.size ? namesArr.size() : 4;
      return { type: 'devicen', numComponents: n };
    }
  }

  // Simple named color spaces (only after array detection, since array stringifies
  // as e.g. "[/Indexed /DeviceRGB ...]" which contains "DeviceRGB" as substring).
  if (csStr.includes('DeviceGray') || csStr.includes('CalGray')) {
    return { type: 'gray', numComponents: 1 };
  }
  if (csStr.includes('DeviceCMYK')) {
    return { type: 'cmyk', numComponents: 4 };
  }
  if (csStr.includes('DeviceRGB') || csStr.includes('CalRGB')) {
    return { type: 'rgb', numComponents: 3 };
  }

  // Fallback: check string for known patterns
  if (csStr.includes('ICCBased')) return { type: 'rgb', numComponents: 3 };
  if (csStr.includes('Indexed')) return { type: 'rgb', numComponents: 3 };

  return { type: 'rgb', numComponents: 3 };
}

// Unpack pixel bytes when BitsPerComponent < 8
export function unpackBits(imageBytes, bpc, totalSamples) {
  if (bpc === 8) return imageBytes;
  const out = new Uint8Array(totalSamples);
  const maxVal = (1 << bpc) - 1;
  let bitPos = 0;
  for (let i = 0; i < totalSamples; i++) {
    const byteIdx = bitPos >> 3;
    const bitOffset = 8 - bpc - (bitPos & 7);
    if (byteIdx < imageBytes.length) {
      const raw = (imageBytes[byteIdx] >> bitOffset) & maxVal;
      out[i] = Math.round((raw / maxVal) * 255);
    }
    bitPos += bpc;
  }
  return out;
}

// Decode an image stream to a data URL
export async function decodeImageStream(context, streamObj) {
  try {
    const dict = streamObj.dict || streamObj;
    const width = pdfNum(dict.get(PDFName.of('Width')));
    const height = pdfNum(dict.get(PDFName.of('Height')));
    if (!width || !height) { console.warn('Image has no width/height', width, height); return null; }
    const bpc = pdfNum(dict.get(PDFName.of('BitsPerComponent'))) || 8;

    // Get filter
    let filterRaw = dict.get(PDFName.of('Filter'));
    if (filterRaw) filterRaw = context.lookup(filterRaw) || filterRaw;
    let filter = '';
    if (filterRaw) {
      if (typeof filterRaw.toString === 'function') {
        const s = filterRaw.toString();
        if (s.startsWith('/')) {
          filter = s;
        } else if (s.startsWith('[')) {
          const match = s.match(/\/(\w+)/g);
          if (match && match.length > 0) filter = match[match.length - 1];
        }
      }
    }

    // Get raw stream bytes
    const rawBytes = streamObj.contents;
    if (!rawBytes || rawBytes.length === 0) { console.warn('Image stream is empty'); return null; }

    // Check for SMask (transparency mask)
    const sMaskRef = dict.get(PDFName.of('SMask'));
    let sMaskBytes = null;
    if (sMaskRef) {
      try {
        const sMaskStream = context.lookup(sMaskRef);
        if (sMaskStream && sMaskStream.contents) {
          sMaskBytes = sMaskStream.contents;
          const sMaskFilter = sMaskStream.dict?.get(PDFName.of('Filter'))?.toString();
          if (sMaskFilter === '/FlateDecode') {
            sMaskBytes = await inflateBytes(sMaskBytes) || sMaskBytes;
          }
        }
      } catch (e) { /* ignore smask errors */ }
    }

    // Parse color space
    const csInfo = await parseColorSpace(context, dict.get(PDFName.of('ColorSpace')));

    // Parse Decode array for value remapping
    let decodeArray = null;
    const decodeRaw = dict.get(PDFName.of('Decode'));
    if (decodeRaw) {
      const decodeObj = context.lookup(decodeRaw) || decodeRaw;
      if (decodeObj && decodeObj.size && typeof decodeObj.get === 'function') {
        decodeArray = [];
        for (let i = 0; i < decodeObj.size(); i++) {
          decodeArray.push(pdfNum(context.lookup(decodeObj.get(i)) || decodeObj.get(i)));
        }
      }
    }

    // JPEG - browser handles decoding natively
    if (filter === '/DCTDecode') {
      const blob = new Blob([rawBytes], { type: 'image/jpeg' });
      const jpegUrl = await blobToDataUrl(blob);
      if (!sMaskBytes) return jpegUrl;

      const jpegImg = await loadImage(jpegUrl);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(jpegImg, 0, 0, width, height);
      const imgData = ctx.getImageData(0, 0, width, height);
      const px = imgData.data;
      for (let i = 0, j = 3; i < sMaskBytes.length && j < px.length; i++, j += 4) {
        px[j] = sMaskBytes[i];
      }
      ctx.putImageData(imgData, 0, 0);
      return canvas.toDataURL('image/png');
    }

    // JPEG2000
    if (filter === '/JPXDecode') {
      const blob = new Blob([rawBytes], { type: 'image/jp2' });
      if (!sMaskBytes) return await blobToDataUrl(blob);

      const jp2Url = await blobToDataUrl(blob);
      const jp2Img = await loadImage(jp2Url);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(jp2Img, 0, 0, width, height);
      const imgData = ctx.getImageData(0, 0, width, height);
      const px = imgData.data;
      for (let i = 0, j = 3; i < sMaskBytes.length && j < px.length; i++, j += 4) {
        px[j] = sMaskBytes[i];
      }
      ctx.putImageData(imgData, 0, 0);
      return canvas.toDataURL('image/png');
    }

    // FlateDecode - decompress
    let imageBytes = rawBytes;
    if (filter === '/FlateDecode') {
      const decompressed = await inflateBytes(rawBytes);
      if (!decompressed) { console.warn('Failed to decompress FlateDecode stream'); return null; }
      imageBytes = decompressed;
    }

    // Unpack bits if BPC < 8
    const numComponents = csInfo.type === 'indexed' ? 1 : csInfo.numComponents;
    const totalSamples = width * height * numComponents;
    if (bpc < 8) {
      imageBytes = unpackBits(imageBytes, bpc, totalSamples);
    }

    // Decode raw pixels to canvas
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(width, height);
    const px = imgData.data;

    if (csInfo.type === 'indexed' && csInfo.palette) {
      // Indexed: look up each pixel in the palette
      const bc = csInfo.baseComponents;
      const pal = csInfo.palette;
      for (let i = 0, j = 0; i < width * height && j < px.length; i++, j += 4) {
        const idx = imageBytes[i] || 0;
        const palOff = idx * bc;
        if (csInfo.baseType === 'cmyk' && bc === 4) {
          const c = pal[palOff] / 255, m = pal[palOff + 1] / 255, y = pal[palOff + 2] / 255, k = pal[palOff + 3] / 255;
          px[j] = 255 * (1 - c) * (1 - k);
          px[j + 1] = 255 * (1 - m) * (1 - k);
          px[j + 2] = 255 * (1 - y) * (1 - k);
        } else if (csInfo.baseType === 'gray' && bc === 1) {
          px[j] = px[j + 1] = px[j + 2] = pal[palOff] || 0;
        } else {
          // RGB or other 3-component
          px[j] = pal[palOff] || 0;
          px[j + 1] = pal[palOff + 1] || 0;
          px[j + 2] = pal[palOff + 2] || 0;
        }
        px[j + 3] = 255;
      }
    } else if (csInfo.type === 'gray') {
      for (let i = 0, j = 0; i < imageBytes.length && j < px.length; i++, j += 4) {
        let v = imageBytes[i];
        if (decodeArray && decodeArray.length >= 2) {
          v = Math.round(decodeArray[0] + (v / 255) * (decodeArray[1] - decodeArray[0]));
          v = Math.max(0, Math.min(255, v * 255));
        }
        px[j] = px[j + 1] = px[j + 2] = v;
        px[j + 3] = 255;
      }
    } else if (csInfo.type === 'cmyk') {
      for (let i = 0, j = 0; i < imageBytes.length - 3 && j < px.length; i += 4, j += 4) {
        const c = imageBytes[i] / 255, m = imageBytes[i + 1] / 255, y = imageBytes[i + 2] / 255, k = imageBytes[i + 3] / 255;
        px[j] = 255 * (1 - c) * (1 - k);
        px[j + 1] = 255 * (1 - m) * (1 - k);
        px[j + 2] = 255 * (1 - y) * (1 - k);
        px[j + 3] = 255;
      }
    } else {
      // Default: RGB (also handles CalRGB, DeviceN approximation)
      const nc = csInfo.numComponents;
      if (nc === 3) {
        for (let i = 0, j = 0; i < imageBytes.length - 2 && j < px.length; i += 3, j += 4) {
          px[j] = imageBytes[i]; px[j + 1] = imageBytes[i + 1]; px[j + 2] = imageBytes[i + 2]; px[j + 3] = 255;
        }
      } else if (nc === 1) {
        for (let i = 0, j = 0; i < imageBytes.length && j < px.length; i++, j += 4) {
          px[j] = px[j + 1] = px[j + 2] = imageBytes[i]; px[j + 3] = 255;
        }
      } else if (nc === 4) {
        // Treat as CMYK
        for (let i = 0, j = 0; i < imageBytes.length - 3 && j < px.length; i += 4, j += 4) {
          const c = imageBytes[i] / 255, m = imageBytes[i + 1] / 255, y = imageBytes[i + 2] / 255, k = imageBytes[i + 3] / 255;
          px[j] = 255 * (1 - c) * (1 - k);
          px[j + 1] = 255 * (1 - m) * (1 - k);
          px[j + 2] = 255 * (1 - y) * (1 - k);
          px[j + 3] = 255;
        }
      }
    }

    // Apply SMask (transparency) if present
    if (sMaskBytes) {
      for (let i = 0, j = 3; i < sMaskBytes.length && j < px.length; i++, j += 4) {
        px[j] = sMaskBytes[i];
      }
    }

    ctx.putImageData(imgData, 0, 0);
    return canvas.toDataURL('image/png');
  } catch (e) {
    console.warn('decodeImageStream error:', e);
    return null;
  }
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
