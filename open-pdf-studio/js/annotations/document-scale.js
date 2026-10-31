// Document-level measure scale without any app state: every function here
// works on the document it is handed, never on "the active document".
//
// loadPDF uses these for documents that finish loading in a background tab
// (multi-file open, session restore behind a document the user just opened).
// There the tab in front is a different PDF: reading ITS title block, or
// writing the scale to IT, gives wrong lengths and areas in both files
// without any visible sign.

import { pixelsPerUnitFor, geldigeUserUnit } from './scale-region-scale.js';

// Patterns ordered from most specific (labelled) to least specific (bare 1:N).
// The labelled pattern avoids false positives from dimensions like "2:3".
const SCALE_PATTERNS = [
  /(?:schaal|scale|maatstaf|maßstab|ma(?:ss|ß)stab|échelle|escala|scala|m)\s*[:=.]?\s*1\s*[:/]\s*(\d+)/i,
  /\b1\s*[:/]\s*(\d+)\b/i,
];

function matchScale(text) {
  for (const pattern of SCALE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const ratio = parseInt(match[1], 10);
      if (ratio > 0 && ratio <= 10000) {
        return { ratio, scaleText: match[0].trim() };
      }
    }
  }
  return null;
}

/**
 * Find a drawing scale such as "1:100", "SCHAAL 1:50", "SCALE: 1:200" or
 * "M 1:500" in the text items of a page.
 * @param {Array<{str: string}>} items - PDF.js text content items
 * @returns {{ ratio: number, scaleText: string } | null}
 */
export function findScaleInText(items) {
  const list = Array.isArray(items) ? items : [];

  // First pass: check the concatenated text of all items
  const found = matchScale(list.map(item => item.str).join(' '));
  if (found) return found;

  // Second pass: check individual text items for better accuracy
  // (sometimes the scale sits in a single text element in the title block)
  for (const item of list) {
    const str = (item.str || '').trim();
    if (!str) continue;
    const single = matchScale(str);
    if (single) return single;
  }

  return null;
}

/**
 * Detect the scale from the text of a page of THIS document.
 * @param {object} doc - the document to read (needs doc.pdfDoc)
 * @param {number} [pageNum] - page to read; defaults to doc.currentPage
 * @returns {Promise<{ ratio: number, scaleText: string, userUnit: number } | null>}
 *   userUnit: the page's /UserUnit (1 when absent), so the caller can turn
 *   1:N into page units of THIS page (pixelsPerUnitFor, #884).
 */
export async function detectScaleInDocument(doc, pageNum) {
  if (!doc?.pdfDoc) return null;

  const page = await doc.pdfDoc.getPage(pageNum || doc.currentPage);
  const textContent = await page.getTextContent();
  const found = findScaleInText(textContent.items);
  return found ? { ...found, userUnit: geldigeUserUnit(page.userUnit) } : null;
}

/**
 * The document measure scale for a scale found in the title block: 1:N in
 * millimetres, in page units of the page it was found on.
 * @param {{ ratio: number, userUnit?: number }} found
 */
export function measureScaleFromTitleBlock(found) {
  return {
    pixelsPerUnit: pixelsPerUnitFor(`1:${found.ratio}`, 'mm', found.userUnit),
    unit: 'mm',
    method: 'auto-detect',
    scaleRatio: `1:${found.ratio}`,
  };
}

/**
 * The document-level measureScale that belongs to a scaleBar annotation,
 * or null when the scale bar carries no usable calibration.
 */
export function scaleFromScaleBar(scaleBar) {
  if (!scaleBar) return null;
  if (!scaleBar.pixelsPerUnit || scaleBar.pixelsPerUnit <= 0) return null;
  return {
    pixelsPerUnit: scaleBar.pixelsPerUnit,
    unit: scaleBar.unit || 'mm',
    method: 'scaleBar',
    scaleRatio: 0,
  };
}
