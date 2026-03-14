import { PDFDocument, PDFName, PDFArray, PDFDict, PDFStream } from 'pdf-lib';

/**
 * Content Stream Editor
 *
 * Manipulates PDF content streams via pdf-lib to delete or modify
 * discrete objects (images, text, vectors) from PDF pages.
 *
 * Strategy:
 * - Parse content stream into tokens
 * - Identify target operators by matching signatures
 * - Remove or replace targeted operator sequences
 * - Rebuild the content stream
 */

/**
 * Delete an image from a PDF page by removing its Do operator and optionally
 * the surrounding q...Q (save/restore) wrapper.
 *
 * @param {Uint8Array} pdfBytes - Original PDF bytes
 * @param {number} pageIndex - Zero-based page index
 * @param {string} imageRef - XObject name (e.g. "img_p0_1")
 * @returns {Promise<Uint8Array>} New PDF bytes with image removed
 */
export async function deleteImageFromPage(pdfBytes, pageIndex, imageRef) {
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const page = pdfDoc.getPage(pageIndex);

  const contentStreams = getPageContentStreams(page);
  let modified = false;

  for (const { stream, ref } of contentStreams) {
    const bytes = getStreamBytes(stream);
    if (!bytes || bytes.length === 0) continue;

    const text = new TextDecoder('latin1').decode(bytes);
    const tokens = tokenizeContentStream(text);

    // Find and remove the image reference: /<imageRef> Do
    // Also try to remove the surrounding q...Q scope if it only contains this image
    const newTokens = removeImageFromTokens(tokens, imageRef);

    if (newTokens.length !== tokens.length) {
      const newText = newTokens.join(' ');
      const newBytes = new TextEncoder().encode(newText);
      setStreamBytes(stream, pdfDoc, newBytes);
      modified = true;
    }
  }

  // Also remove the XObject resource entry
  if (modified) {
    removeXObjectResource(page, imageRef);
  }

  return pdfDoc.save();
}

/**
 * Delete text from a PDF page by finding and emptying matching BT...ET blocks.
 *
 * @param {Uint8Array} pdfBytes - Original PDF bytes
 * @param {number} pageIndex - Zero-based page index
 * @param {object} textSignature - { text: string, fontName?: string }
 * @returns {Promise<Uint8Array>} New PDF bytes with text removed
 */
export async function deleteTextFromPage(pdfBytes, pageIndex, textSignature) {
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const page = pdfDoc.getPage(pageIndex);

  const contentStreams = getPageContentStreams(page);

  for (const { stream } of contentStreams) {
    const bytes = getStreamBytes(stream);
    if (!bytes || bytes.length === 0) continue;

    const text = new TextDecoder('latin1').decode(bytes);

    // Find BT...ET blocks and check if they contain matching text
    const newText = removeTextBlocksMatching(text, textSignature.text);

    if (newText !== text) {
      const newBytes = new TextEncoder().encode(newText);
      setStreamBytes(stream, pdfDoc, newBytes);
    }
  }

  return pdfDoc.save();
}

/**
 * Delete a vector shape from a PDF page by removing the save/path/paint/restore
 * sequence at the given operator indices.
 *
 * @param {Uint8Array} pdfBytes - Original PDF bytes
 * @param {number} pageIndex - Zero-based page index
 * @param {object} pathSignature - { startIndex: number, endIndex: number }
 * @returns {Promise<Uint8Array>} New PDF bytes with vector removed
 */
export async function deleteVectorFromPage(pdfBytes, pageIndex, pathSignature) {
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const page = pdfDoc.getPage(pageIndex);

  const contentStreams = getPageContentStreams(page);

  for (const { stream } of contentStreams) {
    const bytes = getStreamBytes(stream);
    if (!bytes || bytes.length === 0) continue;

    const text = new TextDecoder('latin1').decode(bytes);
    const tokens = tokenizeContentStream(text);

    // Find q...Q blocks and try to match by position/content
    const newTokens = removeQBlockAtApproxPosition(tokens, pathSignature);

    if (newTokens.length !== tokens.length) {
      const newText = newTokens.join(' ');
      const newBytes = new TextEncoder().encode(newText);
      setStreamBytes(stream, pdfDoc, newBytes);
    }
  }

  return pdfDoc.save();
}

/**
 * Extract image data from a PDF page's XObject resources.
 *
 * @param {Uint8Array} pdfBytes - PDF bytes
 * @param {number} pageIndex - Zero-based page index
 * @param {string} imageRef - XObject name
 * @returns {Promise<string|null>} Data URL (base64) or null
 */
export async function extractImageData(pdfBytes, pageIndex, imageRef) {
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const page = pdfDoc.getPage(pageIndex);

  const resources = page.node.get(PDFName.of('Resources'));
  if (!resources) return null;

  const xObjects = resources instanceof PDFDict
    ? resources.get(PDFName.of('XObject'))
    : null;
  if (!xObjects || !(xObjects instanceof PDFDict)) return null;

  const imgRef = xObjects.get(PDFName.of(imageRef));
  if (!imgRef) return null;

  // Resolve indirect reference
  const imgStream = pdfDoc.context.lookup(imgRef);
  if (!imgStream) return null;

  // Try to get the decoded image bytes
  try {
    const imgBytes = getStreamBytes(imgStream);
    if (!imgBytes || imgBytes.length === 0) return null;

    // Check subtype for image format
    const subtype = imgStream.dict?.get?.(PDFName.of('Subtype'))?.toString();
    const filter = imgStream.dict?.get?.(PDFName.of('Filter'))?.toString();

    let mimeType = 'image/png';
    if (filter?.includes('DCTDecode')) mimeType = 'image/jpeg';
    else if (filter?.includes('JPXDecode')) mimeType = 'image/jp2';

    // Convert to base64 data URL
    const base64 = uint8ArrayToBase64(imgBytes);
    return `data:${mimeType};base64,${base64}`;
  } catch {
    return null;
  }
}

// ─── Content stream parsing ─────────────────────────────────────────

/**
 * Get all content streams from a page (handles both single and array content).
 */
function getPageContentStreams(page) {
  const results = [];
  const contentsEntry = page.node.get(PDFName.of('Contents'));
  if (!contentsEntry) return results;

  const resolved = page.doc.context.lookup(contentsEntry);

  if (resolved instanceof PDFArray) {
    for (let i = 0; i < resolved.size(); i++) {
      const ref = resolved.get(i);
      const stream = page.doc.context.lookup(ref);
      if (stream) {
        results.push({ stream, ref });
      }
    }
  } else if (resolved) {
    results.push({ stream: resolved, ref: contentsEntry });
  }

  return results;
}

/**
 * Get decoded bytes from a PDF stream object.
 */
function getStreamBytes(stream) {
  if (typeof stream.getContents === 'function') {
    return stream.getContents();
  }
  if (stream.contents) {
    return stream.contents instanceof Uint8Array
      ? stream.contents
      : new Uint8Array(stream.contents);
  }
  return null;
}

/**
 * Set new bytes on a PDF stream object.
 */
function setStreamBytes(stream, pdfDoc, newBytes) {
  if (typeof stream.setContents === 'function') {
    stream.setContents(newBytes);
  } else {
    // Fallback: create new stream with same dict entries
    const newStream = pdfDoc.context.flateStream(newBytes);
    if (stream.dict) {
      for (const [key, value] of stream.dict.entries()) {
        if (key.toString() !== '/Length' && key.toString() !== '/Filter') {
          newStream.dict.set(key, value);
        }
      }
    }
  }
}

/**
 * Tokenize a content stream into an array of tokens (operators + operands).
 * This is a simplified tokenizer that handles the most common cases.
 */
function tokenizeContentStream(text) {
  const tokens = [];
  let i = 0;
  const len = text.length;

  while (i < len) {
    // Skip whitespace
    while (i < len && /\s/.test(text[i])) i++;
    if (i >= len) break;

    const ch = text[i];

    // Comment
    if (ch === '%') {
      const start = i;
      while (i < len && text[i] !== '\n' && text[i] !== '\r') i++;
      tokens.push(text.slice(start, i));
      continue;
    }

    // String literal (...)
    if (ch === '(') {
      const start = i;
      let depth = 1;
      i++;
      while (i < len && depth > 0) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i] === '(') depth++;
        if (text[i] === ')') depth--;
        i++;
      }
      tokens.push(text.slice(start, i));
      continue;
    }

    // Hex string <...>
    if (ch === '<' && i + 1 < len && text[i + 1] !== '<') {
      const start = i;
      i++;
      while (i < len && text[i] !== '>') i++;
      if (i < len) i++;
      tokens.push(text.slice(start, i));
      continue;
    }

    // Dict <<...>>
    if (ch === '<' && i + 1 < len && text[i + 1] === '<') {
      const start = i;
      let depth = 1;
      i += 2;
      while (i < len - 1 && depth > 0) {
        if (text[i] === '<' && text[i + 1] === '<') { depth++; i += 2; continue; }
        if (text[i] === '>' && text[i + 1] === '>') { depth--; i += 2; continue; }
        i++;
      }
      tokens.push(text.slice(start, i));
      continue;
    }

    // Array [...]
    if (ch === '[') {
      const start = i;
      let depth = 1;
      i++;
      while (i < len && depth > 0) {
        if (text[i] === '[') depth++;
        if (text[i] === ']') depth--;
        i++;
      }
      tokens.push(text.slice(start, i));
      continue;
    }

    // Name /...
    if (ch === '/') {
      const start = i;
      i++;
      while (i < len && !/[\s/<>[\](){}%]/.test(text[i])) i++;
      tokens.push(text.slice(start, i));
      continue;
    }

    // Regular token (number, operator, etc.)
    const start = i;
    while (i < len && !/[\s/<>[\](){}%]/.test(text[i])) i++;
    if (i > start) {
      tokens.push(text.slice(start, i));
    }
  }

  return tokens;
}

/**
 * Remove image Do operator and its surrounding q/Q scope from tokens.
 */
function removeImageFromTokens(tokens, imageRef) {
  const nameToken = `/${imageRef}`;
  const result = [];

  // First try to find q ... /imageRef Do ... Q scope and remove it
  let i = 0;
  while (i < tokens.length) {
    if (tokens[i] === 'q') {
      // Scan ahead for matching Q, check if scope only has this image
      const scopeStart = i;
      let depth = 1;
      let j = i + 1;
      let hasTargetImage = false;
      let hasOtherContent = false;

      while (j < tokens.length && depth > 0) {
        if (tokens[j] === 'q') depth++;
        else if (tokens[j] === 'Q') {
          depth--;
          if (depth === 0) break;
        }
        // Check for our target image
        if (tokens[j] === nameToken && j + 1 < tokens.length && tokens[j + 1] === 'Do') {
          hasTargetImage = true;
        }
        // Check for other Do operators (other images)
        else if (tokens[j] === 'Do' && j > 0 && tokens[j - 1] !== nameToken) {
          hasOtherContent = true;
        }
        // Check for other paint operators
        else if (['S', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'n'].includes(tokens[j])) {
          hasOtherContent = true;
        }
        // Check for BT (text)
        else if (tokens[j] === 'BT') {
          hasOtherContent = true;
        }
        j++;
      }

      if (hasTargetImage && !hasOtherContent && depth === 0) {
        // Remove entire q...Q scope
        i = j + 1;
        continue;
      }
    }

    result.push(tokens[i]);
    i++;
  }

  // If the scope removal didn't work, fall back to removing just /name Do
  if (result.length === tokens.length) {
    const fallback = [];
    for (let k = 0; k < tokens.length; k++) {
      if (tokens[k] === nameToken && k + 1 < tokens.length && tokens[k + 1] === 'Do') {
        k++; // Skip both /name and Do
        continue;
      }
      fallback.push(tokens[k]);
    }
    return fallback;
  }

  return result;
}

/**
 * Remove BT...ET blocks that contain matching text.
 * Uses simple string matching on the text content within the block.
 */
function removeTextBlocksMatching(streamText, targetText) {
  // Normalize target text for matching
  const normalizedTarget = targetText.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!normalizedTarget) return streamText;

  // Find BT...ET blocks
  const btRegex = /BT\b/g;
  const etRegex = /\bET\b/g;
  const blocks = [];

  let btMatch;
  while ((btMatch = btRegex.exec(streamText)) !== null) {
    etRegex.lastIndex = btMatch.index;
    const etMatch = etRegex.exec(streamText);
    if (etMatch) {
      blocks.push({ start: btMatch.index, end: etMatch.index + 2 });
    }
  }

  // Check each block for matching text content
  let result = streamText;
  // Process blocks in reverse to maintain indices
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    const blockContent = streamText.slice(block.start, block.end);

    // Extract text strings from the block (both literal and hex strings)
    const extractedText = extractTextFromBlock(blockContent).toLowerCase();

    // Check if this block contains (part of) the target text
    if (extractedText && normalizedTarget.includes(extractedText.trim())) {
      // Replace with empty BT ET
      result = result.slice(0, block.start) + 'BT ET' + result.slice(block.end);
    }
  }

  return result;
}

/**
 * Extract readable text from a BT...ET block.
 */
function extractTextFromBlock(blockContent) {
  const parts = [];

  // Match literal strings (text)
  const literalRegex = /\(([^)]*)\)/g;
  let match;
  while ((match = literalRegex.exec(blockContent)) !== null) {
    parts.push(match[1]);
  }

  // Match hex strings
  const hexRegex = /<([0-9A-Fa-f]+)>/g;
  while ((match = hexRegex.exec(blockContent)) !== null) {
    // Try to decode hex as text
    const hex = match[1];
    let text = '';
    for (let i = 0; i < hex.length; i += 2) {
      const charCode = parseInt(hex.slice(i, i + 2), 16);
      if (charCode >= 32 && charCode < 127) text += String.fromCharCode(charCode);
    }
    if (text) parts.push(text);
  }

  return parts.join('');
}

/**
 * Remove a q...Q block at approximately the given operator position range.
 * This is a heuristic match since pdf.js operator indices don't map 1:1 to content stream tokens.
 */
function removeQBlockAtApproxPosition(tokens, pathSignature) {
  // Find all q...Q blocks and try to match by relative position
  const qBlocks = [];
  const stack = [];

  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === 'q') {
      stack.push(i);
    } else if (tokens[i] === 'Q' && stack.length > 0) {
      const start = stack.pop();
      qBlocks.push({ start, end: i });
    }
  }

  if (qBlocks.length === 0) return tokens;

  // For now, try to match based on the relative position in the stream
  // The startIndex/endIndex from the extractor are operator indices, not token indices.
  // We use a proportional mapping as a heuristic.
  const totalOps = tokens.length;
  const targetRatio = pathSignature.startIndex / Math.max(totalOps, 1);

  // Find the closest q...Q block by proportional position
  let bestBlock = null;
  let bestDist = Infinity;

  for (const block of qBlocks) {
    const blockRatio = block.start / totalOps;
    const dist = Math.abs(blockRatio - targetRatio);
    if (dist < bestDist) {
      bestDist = dist;
      bestBlock = block;
    }
  }

  if (!bestBlock || bestDist > 0.1) return tokens;

  // Remove this block
  return [...tokens.slice(0, bestBlock.start), ...tokens.slice(bestBlock.end + 1)];
}

/**
 * Remove an XObject resource entry from a page.
 */
function removeXObjectResource(page, imageRef) {
  try {
    const resources = page.node.get(PDFName.of('Resources'));
    if (!resources) return;

    const resolved = resources instanceof PDFDict
      ? resources
      : page.doc.context.lookup(resources);
    if (!(resolved instanceof PDFDict)) return;

    const xObjects = resolved.get(PDFName.of('XObject'));
    if (!xObjects) return;

    const resolvedXObj = xObjects instanceof PDFDict
      ? xObjects
      : page.doc.context.lookup(xObjects);
    if (resolvedXObj instanceof PDFDict) {
      resolvedXObj.delete(PDFName.of(imageRef));
    }
  } catch {
    // Non-critical: resource cleanup is best-effort
  }
}

/**
 * Convert Uint8Array to base64 string.
 */
function uint8ArrayToBase64(uint8Array) {
  let binary = '';
  for (let i = 0; i < uint8Array.length; i++) {
    binary += String.fromCharCode(uint8Array[i]);
  }
  return btoa(binary);
}
