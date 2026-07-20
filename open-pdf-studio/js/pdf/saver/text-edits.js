import { getActiveDocument } from '../../core/state.js';
import { StandardFonts, rgb } from 'pdf-lib';
import { hexToRgb } from './utils.js';

// Save text edits into PDF pages (cover-and-replace approach)
export async function saveTextEditsToPages(pdfDocLib, pages) {
  const doc = getActiveDocument();
  if (!doc || !doc.textEdits || doc.textEdits.length === 0) return;

  const fontCache = {};
  async function getEditFont(fontFamily) {
    if (fontCache[fontFamily]) return fontCache[fontFamily];
    // Map font family string (may include bold/italic variant) to StandardFonts
    const fontMap = {
      'Courier': StandardFonts.Courier,
      'Courier-Bold': StandardFonts.CourierBold,
      'Courier-Oblique': StandardFonts.CourierOblique,
      'Courier-BoldOblique': StandardFonts.CourierBoldOblique,
      'TimesRoman': StandardFonts.TimesRoman,
      'TimesRoman-Bold': StandardFonts.TimesRomanBold,
      'TimesRoman-Italic': StandardFonts.TimesRomanItalic,
      'TimesRoman-BoldItalic': StandardFonts.TimesRomanBoldItalic,
      'Helvetica': StandardFonts.Helvetica,
      'Helvetica-Bold': StandardFonts.HelveticaBold,
      'Helvetica-Oblique': StandardFonts.HelveticaOblique,
      'Helvetica-BoldOblique': StandardFonts.HelveticaBoldOblique,
    };
    const stdFont = fontMap[fontFamily] || StandardFonts.Helvetica;
    const font = await pdfDocLib.embedFont(stdFont);
    fontCache[fontFamily] = font;
    return font;
  }

  for (const edit of doc.textEdits) {
    const pageIndex = edit.page - 1;
    if (pageIndex < 0 || pageIndex >= pages.length) continue;

    const page = pages[pageIndex];
    const fontSize = edit.fontSize;
    const ls = edit.lineSpacing || fontSize * 1.2;
    const numOrig = edit.numOriginalLines || 1;
    const [r, g, b] = hexToRgb(edit.color || '#000000');
    const editColor = rgb(r, g, b);

    // Cover rectangle spanning all original lines (skip for newly added text)
    if (edit.originalText) {
      const origLines = edit.originalText.split('\n');
      const maxOrigLen = Math.max(...origLines.map(l => l.length));
      const coverWidth = Math.max(edit.pdfWidth, fontSize * 0.6 * maxOrigLen) + fontSize * 0.5;
      const rectBottom = edit.pdfY - (numOrig - 1) * ls - fontSize * 0.3;
      const rectHeight = (numOrig - 1) * ls + fontSize * 1.3;

      page.drawRectangle({
        x: edit.pdfX,
        y: rectBottom,
        width: coverWidth,
        height: rectHeight,
        color: rgb(1, 1, 1),
        borderWidth: 0
      });
    }

    // Draw new text line by line
    const editFont = await getEditFont(edit.fontFamily);
    const newLines = edit.newText.split('\n');
    for (let i = 0; i < newLines.length; i++) {
      if (!newLines[i]) continue;
      page.drawText(newLines[i], {
        x: edit.pdfX,
        y: edit.pdfY - i * ls,
        size: fontSize,
        font: editFont,
        color: editColor
      });

      if (edit.fontUnderline || edit.fontStrikethrough) {
        const textWidth = editFont.widthOfTextAtSize(newLines[i], fontSize);
        const thickness = Math.max(0.5, fontSize * 0.06);
        const baselineY = edit.pdfY - i * ls;
        if (edit.fontUnderline) {
          const underlineY = baselineY - fontSize * 0.1;
          page.drawLine({
            start: { x: edit.pdfX, y: underlineY },
            end: { x: edit.pdfX + textWidth, y: underlineY },
            thickness,
            color: editColor,
          });
        }
        if (edit.fontStrikethrough) {
          const strikeY = baselineY + fontSize * 0.3;
          page.drawLine({
            start: { x: edit.pdfX, y: strikeY },
            end: { x: edit.pdfX + textWidth, y: strikeY },
            thickness,
            color: editColor,
          });
        }
      }
    }
  }
}
