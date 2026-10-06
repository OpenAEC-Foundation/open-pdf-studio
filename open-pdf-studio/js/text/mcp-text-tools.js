import { OPS } from 'pdfjs-dist';
import { PDFDocument } from 'pdf-lib';
import { state, getActiveDocument } from '../core/state.js';
import { applyInPlaceTextEdits } from '../pdf/saver/text-edit-inplace.js';
import { pageTextSpans } from './mcp-page-text.js';
import { textItemColors } from './mcp-text-color.js';
import { embedMcpTextFont } from './mcp-text-font.js';

const failure = error => ({ ok: false, error });
const sourceCurrent = (doc, pdf, path) => state.documents.includes(doc) && doc.pdfDoc === pdf && doc.filePath === path;

export async function getPageTextForMcp({ page } = {}) {
  const doc = getActiveDocument();
  const pdf = doc?.pdfDoc, path = doc?.filePath;
  if (!pdf) return failure('no active PDF document');
  const pageNumber = page == null ? doc.currentPage : Number(page);
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf.numPages) return failure('invalid page number');
  const sourcePage = await pdf.getPage(pageNumber);
  const text = await sourcePage.getTextContent();
  const operators = await sourcePage.getOperatorList();
  if (!sourceCurrent(doc, pdf, path) || getActiveDocument() !== doc) {
    return failure('active document changed during text extraction');
  }
  const viewport = sourcePage.getViewport({ scale: 1 });
  const colors = textItemColors(text.items, operators, OPS);
  return {
    ok: true, documentId: String(doc.id), filePath: path, page: pageNumber,
    pageWidth: viewport.width, pageHeight: viewport.height,
    spans: pageTextSpans(text.items, text.styles, viewport, String(doc.id), pageNumber, colors),
  };
}

function fallbackFamily(span) {
  const name = `${span.fontFamily} ${span.fontName}`.toLowerCase();
  const base = /courier|mono|consolas/.test(name) ? 'Courier'
    : /times|serif|garamond|georgia|palatino/.test(name) ? 'TimesRoman' : 'Helvetica';
  const bold = /bold|black|heavy/.test(name), italic = /italic|oblique/.test(name);
  if (base === 'Courier') return `${base}${bold ? '-Bold' : ''}${italic ? (bold ? 'Oblique' : '-Oblique') : ''}`;
  if (base === 'TimesRoman') return `${base}${bold ? '-Bold' : ''}${italic ? (bold ? 'Italic' : '-Italic') : ''}`;
  return `${base}${bold ? '-Bold' : ''}${italic ? (bold ? 'Oblique' : '-Oblique') : ''}`;
}

function newRecord(span, page, newText, color) {
  const fontSize = span.fontSize;
  const x = span.pdfAnchor.x, y = span.pdfAnchor.y;
  return {
    id: `mcp-text-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    mcpStrict: true, mcpSpanId: span.id,
    page, originalText: span.text, newText,
    pdfX: x, pdfY: y, pdfWidth: span.pdfWidth,
    fontSize, lineSpacing: fontSize * 1.2, numOriginalLines: 1,
    fontFamily: fallbackFamily(span), loadedFontName: span.fontName,
    pdfFontName: span.fontName, color, textAngle: span.rotation,
    originalLineInfo: [{ x, y, width: span.pdfWidth, fontSize, angle: span.rotation, text: span.text }],
    originalSpanTexts: [[span.text]],
  };
}

export async function replaceTextForMcp({ spanId, expectedText, newText, color } = {}) {
  if (typeof spanId !== 'string' || !spanId || typeof expectedText !== 'string' || typeof newText !== 'string') {
    return failure('spanId, expectedText and newText are required strings');
  }
  if (newText.includes('\n') || newText.includes('\r')) return failure('replace one line at a time; newText cannot contain line breaks');
  const match = /^(.+):p(\d+):i(\d+)-(\d+)$/.exec(spanId);
  if (!match) return failure('invalid spanId');
  const page = Number(match[2]);
  const read = await getPageTextForMcp({ page });
  if (!read.ok) return read;
  if (read.documentId !== match[1]) return failure('spanId belongs to a different document');
  const span = read.spans.find(entry => entry.id === spanId);
  if (!span || span.text !== expectedText) return failure('span changed; call app_get_page_text again');
  if (newText === expectedText) return { ok: true, changed: false, spanId };
  const doc = getActiveDocument();
  if (!doc || String(doc.id) !== read.documentId) return failure('active document changed; call app_get_page_text again');
  const pdf = doc.pdfDoc, path = doc.filePath;
  if (!span.color && !color) return failure('source text colour could not be determined; provide color as #RRGGBB');
  const textColor = color || span.color;
  if (!/^#[0-9a-f]{6}$/i.test(textColor)) return failure('color must be #RRGGBB');
  if ((doc.textEdits || []).some(edit => !edit.baked && edit.page === page
      && (edit.mcpSpanId === spanId || (Math.abs((edit.pdfX || 0) - span.pdfAnchor.x) < span.fontSize
        && Math.abs((edit.pdfY || 0) - span.pdfAnchor.y) < span.fontSize)))) {
    return failure('this source span already has an unsaved text edit');
  }

  const record = newRecord(span, page, newText, textColor);
  // Preflight on a throwaway PDF copy. A conservative in-place match is
  // mandatory: a white cover rectangle would damage images/vector artwork.
  const { getCachedPdfBytes } = await import('../pdf/loader.js');
  const sourceBytes = getCachedPdfBytes(path);
  if (!sourceBytes) return failure('source PDF bytes unavailable');
  const copy = await PDFDocument.load(sourceBytes.slice(), { ignoreEncryption: true });
  const inPlace = applyInPlaceTextEdits(copy, copy.getPages(), [record]).get(record);
  if (!inPlace) return failure('source text cannot be removed safely in place');

  let fontUsed = span.fontName, fontFallback = false;
  const originalSize = record.fontSize;
  let naturalWidth = 0;
  if (newText) {
    const bold = /bold/i.test(record.fontFamily), italic = /italic|oblique/i.test(record.fontFamily);
    const encoded = inPlace.encodeRun(newText, 0, originalSize, { bold, italic, baseBold: bold, baseItalic: italic });
    if (encoded) naturalWidth = encoded.width;
    else {
      const picked = await embedMcpTextFont(copy, newText, { bold, italic });
      naturalWidth = picked.font.widthOfTextAtSize(newText, originalSize);
      fontUsed = picked.name; fontFallback = true;
    }
    if (!(naturalWidth > 0) || !(span.pdfWidth > 0)) return failure('replacement width cannot be measured');
    const fitted = originalSize * Math.min(1, span.pdfWidth * 0.98 / naturalWidth);
    if (fitted < Math.max(3, originalSize * 0.25)) return failure('replacement does not fit the original text box legibly');
    record.fontSize = fitted;
  }
  const { execute } = await import('../core/undo-manager.js');
  const { markDocumentModified } = await import('../ui/chrome/tabs.js');
  if (!sourceCurrent(doc, pdf, path) || getActiveDocument() !== doc) {
    return failure('active document changed during text replacement');
  }
  doc.textEdits.push(record);
  execute({ type: 'addTextEdit', textEdit: { ...record } });
  markDocumentModified(doc);
  if (getActiveDocument() === doc && doc.currentPage === page) {
    try {
      const { renderPage } = await import('../pdf/renderer.js');
      if (getActiveDocument() === doc && doc.currentPage === page) await renderPage(page);
    }
    catch (error) { console.warn('[mcp-text] preview refresh failed:', error); }
  }
  return { ok: true, changed: true, saved: false, spanId, editId: record.id,
    originalText: span.text, newText, fontUsed, fontFallback, fontSize: record.fontSize,
    color: textColor, bbox: span.bbox,
    ...(inPlace.needsCover ? { rasterBackgroundOverlap: true,
      warning: 'An image overlaps this text. The vector glyphs will be removed without covering the image; text already baked into image pixels may remain visible.' } : {}) };
}
