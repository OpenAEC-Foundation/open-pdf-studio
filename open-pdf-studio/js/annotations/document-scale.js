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
// A number followed by an inch mark is never a ratio: `1/8"` is an inch
// fraction (paper inches per real foot, #999), not 1:8.
const NIET_INCH = String.raw`(?!\d)(?!\s*(?:["″”]|''|in\b|inch))`;
const SCALE_PATTERNS = [
  new RegExp(String.raw`(?:schaal|scale|maatstaf|maßstab|ma(?:ss|ß)stab|échelle|escala|scala|m)\s*[:=.]?\s*1\s*[:/]\s*(\d+)` + NIET_INCH, 'i'),
  new RegExp(String.raw`\b1\s*[:/]\s*(\d+)\b` + NIET_INCH, 'i'),
];

// Imperiale notatie (#999): architectural `1/8" = 1'-0"`, `1 1/2" = 1'-0"`,
// `3" = 1'-0"` en engineering `1" = 20'`, `1"=50'-0"`. Verhouding = echte
// inches / papierinches; 1/8" per voet is 1:96, 1" per 20 voet is 1:240.
const INCH = String.raw`(?:["″”]|''|\s*in\b\.?|\s*inch(?:es)?\b)`;
const VOET = String.raw`(?:['′’]|\s*ft\b\.?|\s*feet\b|\s*foot\b)`;
const GETAL = String.raw`\d+(?:\.\d+)?`;
// Papierinches: "1/8", "1 1/2", "1-1/2", "3", "1.5".
const PAPIER = String.raw`(?<![\d/.])(?:(${GETAL})(?:[\s-]+(\d+)\s*\/\s*(\d+))?|(\d+)\s*\/\s*(\d+))`;
// Echte maat: "1'-0"", "1'", "20' 0"", "1 ft", "1'-6 1/2"".
const ECHT = String.raw`(${GETAL})${VOET}(?:\s*-?\s*(${GETAL})(?:[\s-]+(\d+)\s*\/\s*(\d+))?${INCH})?`;
const IMPERIAAL = new RegExp(PAPIER + INCH + String.raw`\s*=\s*` + ECHT, 'i');
const VOL_FORMAAT = /(?:scale)\s*[:=.]?\s*(full|half)\s*(?:size|scale)\b/i;
// "SCALE: 1/8"" (of een andere inchmaat) die niet als schaal te lezen is:
// dan liever geen schaal dan een verkeerde (#999).
const ONLEESBARE_INCHSCHAAL = new RegExp(String.raw`(?:scale)\s*[:=.]?\s*\d[\d\s\/.-]*` + INCH, 'i');
// Voet-inchmaten in de tekst: dan is "1/50" geen metrische verhouding.
const VOET_INCH_TEKST = /\d\s*['′’]\s*-?\s*\d+(?:\s+\d+\/\d+)?\s*(?:["″”]|'')|\d\s*ft\b/i;

const MAX_IMPERIAAL = 24000;

const breuk = (heel, teller, noemer) => {
  const h = heel != null ? parseFloat(heel) : 0;
  if (teller == null) return h;
  const n = parseInt(noemer, 10);
  return n > 0 ? h + parseInt(teller, 10) / n : NaN;
};

const rondRatio = (r) => {
  const heel = Math.round(r);
  return Math.abs(r - heel) < 1e-6 ? heel : Number(r.toPrecision(6));
};

/**
 * Een imperiale schaal in een tekst: { ratio, unit, scaleText } of null.
 * unit is 'ft', behalve bij ware grootte (1:1, dan 'in').
 * @param {string} text
 */
export function matchImperialScale(text) {
  const str = String(text || '');
  const m = str.match(IMPERIAAL);
  if (m) {
    const papier = m[4] != null ? breuk(null, m[4], m[5]) : breuk(m[1], m[2], m[3]);
    const voet = parseFloat(m[6]);
    const inch = m[7] != null ? breuk(m[7], m[8], m[9]) : 0;
    const echt = voet * 12 + inch;
    if (papier > 0 && echt > 0 && Number.isFinite(papier) && Number.isFinite(echt)) {
      const ratio = rondRatio(echt / papier);
      if (ratio >= 1 && ratio <= MAX_IMPERIAAL) {
        return { ratio, unit: ratio === 1 ? 'in' : 'ft', scaleText: m[0].trim() };
      }
    }
  }
  const vol = str.match(VOL_FORMAAT);
  if (vol) {
    return { ratio: vol[1].toLowerCase() === 'full' ? 1 : 2, unit: 'in', scaleText: vol[0].trim() };
  }
  return null;
}

function matchScale(text, voetInch = VOET_INCH_TEKST.test(text)) {
  const imperiaal = matchImperialScale(text);
  if (imperiaal) return imperiaal;
  if (ONLEESBARE_INCHSCHAAL.test(text)) return { geen: true };
  for (const pattern of SCALE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      // In een tekst met voet-inchmaten is "1/50" geen verhouding.
      if (voetInch && match[0].includes('/')) continue;
      const ratio = parseInt(match[1], 10);
      if (ratio > 0 && ratio <= 10000) {
        return { ratio, scaleText: match[0].trim() };
      }
    }
  }
  return null;
}

/**
 * Find a drawing scale such as "1:100", "SCHAAL 1:50", "SCALE: 1:200",
 * "M 1:500" or an imperial `1/8" = 1'-0"` (#999) in the text items of a page.
 * An inch scale that cannot be read gives null, never a wrong 1:N.
 * @param {Array<{str: string}>} items - PDF.js text content items
 * @returns {{ ratio: number, scaleText: string, unit?: 'ft'|'in' } | null}
 *   unit: only for an imperial scale; a ratio without it is in millimetres.
 */
export function findScaleInText(items) {
  const list = Array.isArray(items) ? items : [];

  // First pass: check the concatenated text of all items
  const alles = list.map(item => item.str).join(' ');
  const found = matchScale(alles);
  if (found) return found.geen ? null : found;
  // Voet-inchmaten ergens op het blad: dan is een losse "1/50" geen verhouding.
  const voetInch = VOET_INCH_TEKST.test(alles);

  // Second pass: check individual text items for better accuracy
  // (sometimes the scale sits in a single text element in the title block)
  for (const item of list) {
    const str = (item.str || '').trim();
    if (!str) continue;
    const single = matchScale(str, voetInch);
    if (single) return single.geen ? null : single;
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
 * millimetres (or in feet/inches for an imperial scale, #999), in page units
 * of the page it was found on.
 * @param {{ ratio: number, unit?: string, userUnit?: number }} found
 */
export function measureScaleFromTitleBlock(found) {
  const unit = found.unit === 'ft' || found.unit === 'in' ? found.unit : 'mm';
  return {
    pixelsPerUnit: pixelsPerUnitFor(`1:${found.ratio}`, unit, found.userUnit),
    unit,
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
