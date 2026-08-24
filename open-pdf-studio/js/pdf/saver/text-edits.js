import { getActiveDocument } from '../../core/state.js';
import { StandardFonts, rgb, degrees } from 'pdf-lib';
import { hexToRgb } from './utils.js';
import {
  sanitizeWinAnsiText,
  textEditLineAnchor,
  resolveTextEditLineStyle,
} from '../../text/text-edit-appearance.js';

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
    // Eén corrupte/onencodeerbare edit mag NOOIT de hele save laten falen:
    // alle andere wijzigingen (annotaties, andere edits) moeten doorgaan.
    try {
      await saveOneTextEdit(pdfDocLib, pages, edit, getEditFont);
    } catch (editErr) {
      console.warn(
        `[text-edits] Edit ${edit?.id ?? '?'} (pagina ${edit?.page ?? '?'}) ` +
        'overgeslagen bij opslaan:', editErr,
      );
    }
  }
}

async function saveOneTextEdit(pdfDocLib, pages, edit, getEditFont) {
  const pageIndex = edit.page - 1;
  if (pageIndex < 0 || pageIndex >= pages.length) return;

  const page = pages[pageIndex];
  const fontSize = edit.fontSize;
  const ls = edit.lineSpacing || fontSize * 1.2;
  const numOrig = edit.numOriginalLines || 1;
  // Richting van de originele tekstrun (graden, CCW in PDF-user-space).
  // 0 voor gewone horizontale tekst; 90/180/270 voor tekst die authored is
  // voor een /Rotate-pagina of intrinsiek geroteerde labels. pdfX/pdfY staan
  // al in user-space, dus alleen de glyph-richting en de regel-richting
  // moeten meedraaien.
  const angle = Number(edit.textAngle) || 0;
  const rad = angle * Math.PI / 180;
  const readDir = { x: Math.cos(rad), y: Math.sin(rad) };   // leesrichting
  const ascDir = { x: -Math.sin(rad), y: Math.cos(rad) };   // ascender-richting

  // Cover rectangle spanning all original lines (skip for newly added text)
  if (edit.originalText) {
    const origLines = edit.originalText.split('\n');
    const maxOrigLen = Math.max(...origLines.map(l => l.length));
    const coverWidth = Math.max(edit.pdfWidth, fontSize * 0.6 * maxOrigLen) + fontSize * 0.5;
    const rectHeight = (numOrig - 1) * ls + fontSize * 1.3;
    // Rechthoek-oorsprong in het lokale tekstframe: v0 onder de laatste
    // baseline; naar user-space via de ascender-richting zodat de cover bij
    // geroteerde tekst om de gedraaide run ligt.
    const v0 = -((numOrig - 1) * ls + fontSize * 0.3);

    page.drawRectangle({
      x: edit.pdfX + ascDir.x * v0,
      y: edit.pdfY + ascDir.y * v0,
      width: coverWidth,
      height: rectHeight,
      rotate: degrees(angle),
      color: rgb(1, 1, 1),
      borderWidth: 0
    });
  }

  // Draw new text line by line (stijl per regel, met record-brede fallback)
  const newLines = edit.newText.split('\n');
  for (let i = 0; i < newLines.length; i++) {
    if (!newLines[i]) continue;
    const lineStyle = resolveTextEditLineStyle(edit, i);
    const lineFontSize = lineStyle.fontSize || fontSize;
    const [r, g, b] = hexToRgb(lineStyle.color || '#000000');
    const lineColor = rgb(r, g, b);
    const editFont = await getEditFont(lineStyle.fontFamily);

    // WinAnsi-sanering: Standard-14-fonts kunnen geen tekens buiten cp1252
    // aan; vervang per teken (≤ → <=, ligaturen, anders '?') i.p.v. de save
    // te laten crashen.
    const { text: safeText, replaced } = sanitizeWinAnsiText(newLines[i]);
    if (replaced.length > 0) {
      console.warn(
        `[text-edits] Edit ${edit.id ?? '?'} regel ${i + 1}: niet-WinAnsi-tekens ` +
        `vervangen bij opslaan: ${replaced.join(' ')}`,
      );
    }
    if (!safeText) continue;

    const anchor = textEditLineAnchor(edit.pdfX, edit.pdfY, i, ls, angle);
    page.drawText(safeText, {
      x: anchor.x,
      y: anchor.y,
      size: lineFontSize,
      font: editFont,
      rotate: degrees(angle),
      color: lineColor
    });

    if (edit.fontUnderline || edit.fontStrikethrough) {
      const textWidth = editFont.widthOfTextAtSize(safeText, lineFontSize);
      const thickness = Math.max(0.5, lineFontSize * 0.06);
      const lineAt = (v) => ({
        start: {
          x: anchor.x + ascDir.x * v,
          y: anchor.y + ascDir.y * v,
        },
        end: {
          x: anchor.x + ascDir.x * v + readDir.x * textWidth,
          y: anchor.y + ascDir.y * v + readDir.y * textWidth,
        },
      });
      if (edit.fontUnderline) {
        const { start, end } = lineAt(-lineFontSize * 0.1);
        page.drawLine({ start, end, thickness, color: lineColor });
      }
      if (edit.fontStrikethrough) {
        const { start, end } = lineAt(lineFontSize * 0.3);
        page.drawLine({ start, end, thickness, color: lineColor });
      }
    }
  }
}
