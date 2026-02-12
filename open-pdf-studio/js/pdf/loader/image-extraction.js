import { PDFName, PDFArray } from 'pdf-lib';
import { pdfNum, inflateBytes } from './pdf-helpers.js';

// Extract stamp images by rendering the page with annotations via PDF.js,
// then cropping each stamp's region from the rendered result.
// Uses a high-resolution render (3x) for sharp images at all zoom levels.
export async function extractStampImagesViaPdfJs(page, viewport, stampAnnots) {
  const imageMap = new Map();
  if (stampAnnots.length === 0) return imageMap;

  try {
    const hiResScale = 3;
    const hiResViewport = page.getViewport({ scale: hiResScale });

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = hiResViewport.width;
    tempCanvas.height = hiResViewport.height;

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
        const key = `${rect[0]},${rect[1]},${rect[2]},${rect[3]}`;
        imageMap.set(key, dataUrl);
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
    const page = pdfDoc.getPages()[pageNum - 1];
    if (!page) return imageMap;

    const context = pdfDoc.context;
    const annotsRaw = page.node.get(PDFName.of('Annots'));
    if (!annotsRaw) return imageMap;
    const annots = context.lookup(annotsRaw);
    if (!annots) return imageMap;

    for (let i = 0; i < annots.size(); i++) {
      const annotDict = context.lookup(annots.get(i));
      if (!annotDict) continue;

      const subtype = annotDict.get(PDFName.of('Subtype'));
      if (!subtype || subtype.toString() !== '/Stamp') continue;

      // Get appearance: /AP -> /N
      const apRaw = annotDict.get(PDFName.of('AP'));
      if (!apRaw) { console.warn('Stamp has no /AP'); continue; }
      const apDict = context.lookup(apRaw);
      if (!apDict) continue;

      const normalRaw = apDict.get(PDFName.of('N'));
      if (!normalRaw) { console.warn('Stamp has no /AP/N'); continue; }
      const normalStream = context.lookup(normalRaw);
      if (!normalStream) continue;

      // Extract image from the Form XObject
      const dataUrl = await extractImageFromFormXObject(context, normalStream);
      if (dataUrl) {
        // Build rect key for matching with pdf.js annotations
        const rectArr = annotDict.get(PDFName.of('Rect'));
        if (rectArr) {
          const r0 = pdfNum(context.lookup(rectArr.get(0)) || rectArr.get(0));
          const r1 = pdfNum(context.lookup(rectArr.get(1)) || rectArr.get(1));
          const r2 = pdfNum(context.lookup(rectArr.get(2)) || rectArr.get(2));
          const r3 = pdfNum(context.lookup(rectArr.get(3)) || rectArr.get(3));
          imageMap.set(`${r0},${r1},${r2},${r3}`, dataUrl);
        }
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
export function parseColorSpace(context, csRaw) {
  if (!csRaw) return { type: 'rgb', numComponents: 3 };

  const cs = context.lookup(csRaw) || csRaw;
  const csStr = cs.toString();

  // Simple named color spaces
  if (csStr.includes('DeviceGray') || csStr.includes('CalGray')) {
    return { type: 'gray', numComponents: 1 };
  }
  if (csStr.includes('DeviceCMYK')) {
    return { type: 'cmyk', numComponents: 4 };
  }
  if (csStr.includes('DeviceRGB') || csStr.includes('CalRGB')) {
    return { type: 'rgb', numComponents: 3 };
  }

  // Array-based color spaces: [/Name, ...params]
  if (cs instanceof PDFArray || (cs.size && typeof cs.get === 'function')) {
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
      const baseCS = parseColorSpace(context, cs.get(1));
      const hival = pdfNum(context.lookup(cs.get(2)) || cs.get(2)) || 255;
      let lookupData = null;
      const lookupRaw = cs.get(3);
      const lookupObj = context.lookup(lookupRaw) || lookupRaw;
      if (lookupObj && lookupObj.contents) {
        // It's a stream
        lookupData = lookupObj.contents;
        const lFilter = lookupObj.dict?.get(PDFName.of('Filter'))?.toString();
        if (lFilter === '/FlateDecode') {
          // Will be decompressed synchronously below if needed
          lookupData = lookupObj.contents;
        }
      } else if (lookupObj && typeof lookupObj.toString === 'function') {
        // Raw bytes encoded as string
        const str = lookupObj.toString();
        if (str.startsWith('<')) {
          // Hex string
          const hex = str.slice(1, -1);
          lookupData = new Uint8Array(hex.length / 2);
          for (let i = 0; i < hex.length; i += 2) {
            lookupData[i / 2] = parseInt(hex.substring(i, i + 2), 16);
          }
        } else {
          lookupData = new Uint8Array([...str].map(c => c.charCodeAt(0)));
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
    const csInfo = parseColorSpace(context, dict.get(PDFName.of('ColorSpace')));

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
