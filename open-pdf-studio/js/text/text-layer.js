import { state, getActiveDocument } from '../core/state.js';
import * as pdfjsLib from 'pdfjs-dist';

/**
 * Text Layer Management Module
 * Uses PDF.js built-in TextLayer class for accurate text selection positioning
 */

// Store references to text layers for cleanup
const textLayers = new Map();

/**
 * Strip subset prefix from PDF font name (e.g., "NDPKKA+TimesNewRomanPSMT" → "TimesNewRomanPSMT")
 */
function stripSubsetPrefix(fontName) {
  if (!fontName) return '';
  const plusIdx = fontName.indexOf('+');
  if (plusIdx >= 0 && plusIdx <= 6) {
    return fontName.substring(plusIdx + 1);
  }
  return fontName;
}

/**
 * Parse bold/italic from PDF font name suffix
 * Common patterns: -Bold, -Italic, -BoldItalic, -BoldOblique, -Medium, -Book, -Regular
 */
function parseFontWeight(cleanFontName) {
  const name = (cleanFontName || '').toLowerCase();
  const bold = name.includes('bold') || name.includes(',bold') || name.endsWith('-bd');
  const italic = name.includes('italic') || name.includes('oblique')
    || name.includes(',italic') || name.endsWith('-it');
  return { bold, italic };
}

/**
 * Build font info cache from page.commonObjs for actual font name detection
 */
function buildFontInfoCache(textContent, page) {
  const fontInfoCache = {};
  if (!page?.commonObjs) return fontInfoCache;

  for (const item of textContent.items) {
    const fontName = item.fontName;
    if (fontName && !fontInfoCache[fontName]) {
      try {
        const fontObj = page.commonObjs.get(fontName);
        if (fontObj && fontObj.name) {
          const cleanName = stripSubsetPrefix(fontObj.name);
          const weight = parseFontWeight(cleanName);
          const isFontAvailable = document.fonts.check(`12px "${fontName}"`);
          fontInfoCache[fontName] = {
            name: cleanName,
            bold: weight.bold,
            italic: weight.italic,
            loadedName: isFontAvailable ? fontName : '',
          };
        }
      } catch (e) {
        // Font not yet available in commonObjs
      }
    }
  }
  return fontInfoCache;
}

/**
 * Map a PDF font name to a CSS font-family string
 * Uses actual font name from commonObjs to detect serif/sans-serif/monospace
 */
export function mapPdfFontToCss(actualFontName, fallbackFamily) {
  const name = (actualFontName || '').toLowerCase();

  if (name.includes('courier') || name.includes('consolas') || name.includes('mono')
      || fallbackFamily === 'monospace') {
    return '"Courier New", Courier, monospace';
  }

  if (name.includes('times') || name.includes('garamond') || name.includes('georgia')
      || name.includes('palatino') || name.includes('cambria') || name.includes('bookman')
      || (fallbackFamily === 'serif')) {
    return '"Times New Roman", Times, serif';
  }

  if (name.includes('arial') || name.includes('helvetica') || name.includes('calibri')
      || name.includes('verdana') || name.includes('tahoma') || name.includes('trebuchet')
      || name.includes('segoe') || fallbackFamily === 'sans-serif') {
    return 'Helvetica, Arial, sans-serif';
  }

  if (fallbackFamily && fallbackFamily !== 'sans-serif') {
    return fallbackFamily;
  }
  return 'Helvetica, Arial, sans-serif';
}

/**
 * Insert <br> elements between consecutive text spans that have a large horizontal gap
 * on the same baseline. This prevents the browser from merging columns during text selection.
 */
function insertColumnBreaks(textItems, textDivs) {
  let prevItem = null;
  let prevDiv = null;
  let breaksInserted = 0;

  for (let i = 0; i < textItems.length && i < textDivs.length; i++) {
    const item = textItems[i];
    const div = textDivs[i];

    // Skip items without visible text (not appended to DOM by TextLayer)
    if (!item.str) {
      prevItem = null;
      prevDiv = null;
      continue;
    }

    if (prevItem && prevDiv && div.parentNode) {
      const prevTx = prevItem.transform;
      const currTx = item.transform;

      const prevFontHeight = Math.hypot(prevTx[2], prevTx[3]);
      const currFontHeight = Math.hypot(currTx[2], currTx[3]);
      const avgFontHeight = (prevFontHeight + currFontHeight) / 2;

      const yDiff = Math.abs(prevTx[5] - currTx[5]);
      const sameBaseline = yDiff <= avgFontHeight * 0.5;

      if (sameBaseline) {
        // Same baseline — check horizontal gap
        const prevRight = prevTx[4] + (prevItem.width || 0);
        const currLeft = currTx[4];
        const gap = currLeft - prevRight;

        // Gap larger than 3x font size indicates a column boundary
        if (gap > avgFontHeight * 3) {
          const br = document.createElement('br');
          br.setAttribute('role', 'presentation');
          div.parentNode.insertBefore(br, div);
          breaksInserted++;
        }
      }
    }

    // Reset tracking after end-of-line items (TextLayer already inserts <br> for those)
    prevItem = item.hasEOL ? null : item;
    prevDiv = item.hasEOL ? null : div;
  }

}

/**
 * Creates a text layer for a PDF page using PDF.js built-in TextLayer
 * @param {Object} page - PDF.js page object
 * @param {Object} viewport - PDF.js viewport
 * @param {HTMLElement} container - Container element to append text layer to
 * @param {number} pageNum - Page number for tracking
 * @returns {Promise<HTMLElement>} The created text layer element
 */
export async function createTextLayer(page, viewport, container, pageNum) {
  const textContent = await page.getTextContent();

  const textLayerDiv = document.createElement('div');
  textLayerDiv.className = 'textLayer';
  textLayerDiv.dataset.page = pageNum;

  // Ensure --total-scale-factor is set (renderer usually sets this on parent)
  if (container) {
    container.style.setProperty('--total-scale-factor', viewport.scale);
  }

  container.appendChild(textLayerDiv);

  // Use PDF.js built-in TextLayer for accurate positioning
  let textLayer;
  try {
    textLayer = new pdfjsLib.TextLayer({
      textContentSource: textContent,
      container: textLayerDiv,
      viewport
    });
    await textLayer.render();
  } catch (err) {
    // Fallback: don't create text layer if TextLayer fails
    return textLayerDiv;
  }

  // Build font info cache from page.commonObjs
  const fontInfoCache = buildFontInfoCache(textContent, page);
  const styles = textContent.styles || {};

  // Filter text items (those with str property, matching textDivs order)
  const textItems = textContent.items.filter(item => item.str !== undefined);
  const textDivs = textLayer.textDivs;

  // Add custom data attributes to rendered spans for the edit text tool
  for (let i = 0; i < textDivs.length && i < textItems.length; i++) {
    const span = textDivs[i];
    const item = textItems[i];

    const fontName = item.fontName || '';
    const fontInfo = fontInfoCache[fontName];
    const itemStyle = fontName ? styles[fontName] : null;

    const actualFontName = fontInfo?.name || '';
    const pdfFontFamily = itemStyle?.fontFamily || 'sans-serif';
    const isBold = fontInfo?.bold || false;
    const isItalic = fontInfo?.italic || false;
    const loadedFontName = fontInfo?.loadedName || '';

    span.dataset.pdfTransform = JSON.stringify(item.transform);
    span.dataset.pdfWidth = item.width || 0;
    span.dataset.itemIndex = i;
    span.dataset.pdfFontFamily = pdfFontFamily;
    span.dataset.pdfFontName = fontName;
    span.dataset.pdfActualFontName = actualFontName;
    span.dataset.pdfLoadedFontName = loadedFontName;
    span.dataset.pdfBold = isBold;
    span.dataset.pdfItalic = isItalic;
  }

  textLayers.set(pageNum, { element: textLayerDiv, textLayer });

  // Enable text selection when select or editText tool is active
  const needsTextAccess = state.currentTool === 'select' || state.currentTool === 'editText';
  if (needsTextAccess) {
    textLayerDiv.style.pointerEvents = 'auto';
  }
  const spans = textLayerDiv.querySelectorAll('span:not(.markedContent)');
  spans.forEach(span => {
    span.style.pointerEvents = needsTextAccess ? 'auto' : 'none';
    span.style.cursor = needsTextAccess ? 'text' : 'default';
  });

  // Inject synthetic spans for text added via "Add Text"
  const unscaledWidth = viewport.width / viewport.scale;
  const unscaledHeight = viewport.height / viewport.scale;
  injectSyntheticTextSpans(textLayerDiv, pageNum, unscaledWidth, unscaledHeight);

  return textLayerDiv;
}

/**
 * Injects synthetic text layer spans for added text (textEdits with empty originalText).
 * These spans make added text selectable and editable like native PDF text.
 * @param {HTMLElement} textLayerDiv - The .textLayer element
 * @param {number} pageNum - Page number
 * @param {number} pageWidth - Unscaled page width in PDF points
 * @param {number} pageHeight - Unscaled page height in PDF points
 */
export function injectSyntheticTextSpans(textLayerDiv, pageNum, pageWidth, pageHeight) {
  const doc = getActiveDocument();
  if (!doc || !doc.textEdits || doc.textEdits.length === 0) return;

  // Remove previously injected synthetic spans
  textLayerDiv.querySelectorAll('span[data-synthetic]').forEach(s => s.remove());

  const addedEdits = doc.textEdits.filter(e => e.page === pageNum && e.originalText === '');
  if (addedEdits.length === 0) return;

  // Create a temporary canvas for text measurement (--scale-x computation)
  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d');
  const scale = state.scale * (window.devicePixelRatio || 1);

  const ascentRatio = 0.8;

  for (const edit of addedEdits) {
    const fontSize = edit.fontSize;
    const ls = edit.lineSpacing || fontSize * 1.2;
    const lines = edit.newText.split('\n');

    // Map fontFamily to CSS font
    const ff = (edit.fontFamily || 'Helvetica').toLowerCase();
    let cssFontFamily;
    if (ff.includes('courier')) {
      cssFontFamily = '"Courier New", Courier, monospace';
    } else if (ff.includes('times')) {
      cssFontFamily = '"Times New Roman", Times, serif';
    } else {
      cssFontFamily = 'Helvetica, Arial, sans-serif';
    }

    const isBold = ff.includes('bold');
    const isItalic = ff.includes('italic') || ff.includes('oblique');
    const fontWeight = isBold ? 'bold ' : '';
    const fontStyle = isItalic ? 'italic ' : '';

    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i];
      if (!lineText) continue;

      // PDF coordinates for this line
      const linePdfX = edit.pdfX;
      const linePdfY = edit.pdfY - i * ls;

      // Convert to text layer positioning (percentages of unscaled page)
      // left = pdfX (assuming pageX = 0)
      // top = (pageHeight - pdfY) - fontSize * ascentRatio
      const left = linePdfX;
      const top = (pageHeight - linePdfY) - fontSize * ascentRatio;

      const leftPct = (100 * left / pageWidth).toFixed(2);
      const topPct = (100 * top / pageHeight).toFixed(2);

      // Create span
      const span = document.createElement('span');
      span.textContent = lineText;
      span.setAttribute('role', 'presentation');
      span.setAttribute('dir', 'ltr');

      // Inline styles
      span.style.left = `${leftPct}%`;
      span.style.top = `${topPct}%`;
      span.style.fontFamily = cssFontFamily;
      span.style.setProperty('--font-height', `${fontSize.toFixed(2)}px`);

      // Compute --scale-x
      measureCtx.font = `${fontStyle}${fontWeight}${fontSize * scale}px ${cssFontFamily}`;
      const measuredWidth = measureCtx.measureText(lineText).width;
      if (measuredWidth > 0) {
        // Estimate PDF text width: fontSize * 0.6 * numChars (approximate)
        const pdfTextWidth = fontSize * 0.6 * lineText.length;
        const scaleX = pdfTextWidth * scale / measuredWidth;
        span.style.setProperty('--scale-x', `${scaleX}`);
      }

      // Data attributes for the edit text tool
      const transform = [fontSize, 0, 0, fontSize, linePdfX, linePdfY];
      span.dataset.pdfTransform = JSON.stringify(transform);
      span.dataset.pdfWidth = String(fontSize * 0.6 * lineText.length);
      span.dataset.pdfFontFamily = cssFontFamily;
      span.dataset.pdfFontName = '';
      span.dataset.pdfActualFontName = edit.fontFamily || 'Helvetica';
      span.dataset.pdfLoadedFontName = '';
      span.dataset.pdfBold = String(isBold);
      span.dataset.pdfItalic = String(isItalic);
      span.dataset.synthetic = 'true';

      textLayerDiv.appendChild(span);
    }
  }
}

/**
 * Creates text layer for single page mode
 * @param {Object} page - PDF.js page object
 * @param {Object} viewport - PDF.js viewport
 */
export async function createSinglePageTextLayer(page, viewport) {
  const container = document.getElementById('canvas-container');
  if (!container) return;

  // Remove existing text layer for current page
  clearSinglePageTextLayer();

  await createTextLayer(page, viewport, container, state.currentPage);
}

/**
 * Clears text layer for single page mode
 */
export function clearSinglePageTextLayer() {
  const container = document.getElementById('canvas-container');
  if (!container) return;

  const existingLayer = container.querySelector('.textLayer');
  if (existingLayer) {
    existingLayer.remove();
  }

  // Clear from tracking map
  textLayers.delete(state.currentPage);
}

/**
 * Clears all text layers (for re-render or cleanup)
 */
export function clearTextLayers() {
  document.querySelectorAll('.textLayer').forEach(layer => {
    layer.remove();
  });

  textLayers.clear();
}

/**
 * Gets the text layer for a specific page
 * @param {number} pageNum - Page number
 * @returns {HTMLElement|null} The text layer element or null
 */
export function getTextLayer(pageNum) {
  const entry = textLayers.get(pageNum);
  return entry ? entry.element : null;
}
