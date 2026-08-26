import { getActiveDocument } from '../../core/state.js';
import {
  StandardFonts, rgb, degrees, PDFHexString,
  pushGraphicsState, popGraphicsState, beginText, endText,
  setFontAndSize, setTextMatrix, setFillingRgbColor, showText,
  setCharacterSpacing, setWordSpacing, setCharacterSqueeze,
} from 'pdf-lib';
import { hexToRgb } from './utils.js';
import {
  sanitizeWinAnsiText,
  standardFontVariant,
  textEditLineAnchor,
  resolveTextEditLineStyle,
} from '../../text/text-edit-appearance.js';
import { applyInPlaceTextEdits } from './text-edit-inplace.js';

// Save text edits into PDF pages.
//
// Voorkeursroute (fase A van het échte bewerken): de originele show-text-
// operatoren worden in-place uit de content stream geknipt en de nieuwe
// tekst wordt op hetzelfde anker teruggeschreven — waar de encoding het
// toelaat in het originele font, anders via het Standard-14-pad. Alleen als
// de originele run niet eenduidig te lokaliseren is, valt een edit terug op
// het oude afdekken-en-overheen-tekenen (wit vlak + nieuwe tekst).
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

  const pending = doc.textEdits.filter(e => e && !e.baked);
  if (pending.length === 0) return;

  // In-place-analyse: knipt originele runs waar dat eenduidig en veilig kan.
  let inplaceResults = new Map();
  try {
    inplaceResults = applyInPlaceTextEdits(pdfDocLib, pages, pending);
  } catch (err) {
    console.warn('[text-edits] In-place bewerking uitgevallen; terugval op afdekvlak:', err);
  }

  for (const edit of pending) {
    // Eén corrupte/onencodeerbare edit mag NOOIT de hele save laten falen:
    // alle andere wijzigingen (annotaties, andere edits) moeten doorgaan.
    try {
      await saveOneTextEdit(pdfDocLib, pages, edit, getEditFont, inplaceResults.get(edit) || null);
    } catch (editErr) {
      console.warn(
        `[text-edits] Edit ${edit?.id ?? '?'} (pagina ${edit?.page ?? '?'}) ` +
        'overgeslagen bij opslaan:', editErr,
      );
    }
  }
}

// Tekent één run in het originele paginafont via rauwe operatoren op het
// gegeven anker (user-space). De ops zijn zelfstandig (q…Q) zodat er geen
// tekst-state weglekt naar de rest van de pagina. Tc/Tw/Tz van de originele
// run worden gereproduceerd zodat de visuele breedte overeenkomt.
function drawOriginalFontRun(page, enc, sizePt, colorRgb, angleDeg, x, y) {
  const rad = angleDeg * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const opsList = [
    pushGraphicsState(),
    beginText(),
    setFontAndSize(enc.fontKey, sizePt),
    setFillingRgbColor(colorRgb.red ?? 0, colorRgb.green ?? 0, colorRgb.blue ?? 0),
  ];
  if (enc.tc) opsList.push(setCharacterSpacing(enc.tc));
  if (enc.tw) opsList.push(setWordSpacing(enc.tw));
  if (enc.tz !== undefined && enc.tz !== 100) opsList.push(setCharacterSqueeze(enc.tz));
  opsList.push(
    setTextMatrix(cos, sin, -sin, cos, x, y),
    showText(PDFHexString.of(enc.hex)),
    endText(),
    popGraphicsState(),
  );
  page.pushOperators(...opsList);
}

async function saveOneTextEdit(pdfDocLib, pages, edit, getEditFont, inplace) {
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

  // Een VERPLAATST blok mag alleen doorgaan als de originele runs eenduidig
  // geknipt konden worden: een afdekvlak-surrogaat zou de tekst op de oude
  // plek onder een wit vlak laten staan (dubbel in extractie, half verplaatst
  // in beeld). Liever weigeren met een duidelijke melding.
  if (edit.moved && edit.originalText && !inplace) {
    console.warn(
      `[text-edits] Edit ${edit.id ?? '?'} (pagina ${edit.page}): verplaatsing ` +
      'kon niet veilig in-place worden uitgevoerd; de verplaatsing is NIET ' +
      'toegepast in het bestand.',
    );
    delete edit._pendingBakeInfo;
    return;
  }

  // Anker van het afdekvlak: de ORIGINELE positie van de tekst (bij een
  // verplaatst blok wijkt die af van het tekst-anker pdfX/pdfY). Prioriteit:
  // wat er nu in het bestand staat (inplaceBaked van een eerdere save),
  // anders de vastgelegde originele regelpositie, anders het record-anker.
  const orig0 = (Array.isArray(edit.inplaceBaked?.lines) && edit.inplaceBaked.lines[0])
    || (Array.isArray(edit.originalLineInfo) && edit.originalLineInfo[0]) || null;
  const coverX = orig0 && Number.isFinite(Number(orig0.x)) ? Number(orig0.x) : edit.pdfX;
  const coverY = orig0 && Number.isFinite(Number(orig0.y)) ? Number(orig0.y) : edit.pdfY;

  // Afdekvlak over alle originele regels — op het terugval-pad, én wanneer
  // er een afbeelding (scan-achtergrond) onder de run ligt: de geknipte
  // vector-tekst staat dan ook als pixels in de afbeelding en die dekt
  // alleen het witte vlak af. Bij een geslaagde knip zonder onderliggende
  // afbeelding is er niets meer om af te dekken. (Nieuw toegevoegde tekst
  // heeft sowieso geen origineel.)
  if (edit.originalText && (!inplace || inplace.needsCover)) {
    // Bij een her-bewerking van een eerder ingebakken edit moet het vlak ook
    // de eerder weggeschreven (mogelijk langere) nieuwe tekst afdekken.
    const coverSources = [edit.originalText];
    if (edit.bakedNewText) coverSources.push(edit.bakedNewText);
    const coverLines = coverSources.flatMap(t => String(t).split('\n'));
    const numCover = Math.max(numOrig, ...coverSources.map(t => String(t).split('\n').length));
    const maxOrigLen = Math.max(...coverLines.map(l => l.length));
    // Kolom-segmenten en de werkelijke uitgestrektheid van de originele runs
    // meenemen: de tekenaantal-schatting telt kolom-gaten NIET mee, waardoor
    // het vlak vóór de laatste kolom kon eindigen en (bij een scan-onderlaag)
    // het slotcijfer van een buurgetal zichtbaar bleef.
    const segExtent = Math.max(0, ...((Array.isArray(edit.lineSegments) ? edit.lineSegments : [])
      .flatMap(segs => (Array.isArray(segs) ? segs : []).map(sg =>
        (Number(sg.dx) || 0) + String(sg.text ?? '').length * fontSize * 0.6))));
    const coverWidth = Math.max(
      edit.pdfWidth,
      fontSize * 0.6 * maxOrigLen,
      segExtent,
      Number(inplace?.coverExtent) || 0,
    ) + fontSize * 0.5;
    const rectHeight = (numCover - 1) * ls + fontSize * 1.3;
    // Rechthoek-oorsprong in het lokale tekstframe: v0 onder de laatste
    // baseline; naar user-space via de ascender-richting zodat de cover bij
    // geroteerde tekst om de gedraaide run ligt.
    const v0 = -((numCover - 1) * ls + fontSize * 0.3);

    page.drawRectangle({
      x: coverX + ascDir.x * v0,
      y: coverY + ascDir.y * v0,
      width: coverWidth,
      height: rectHeight,
      rotate: degrees(angle),
      color: rgb(1, 1, 1),
      borderWidth: 0
    });
  }

  // Draw new text line by line (stijl per regel, met record-brede fallback)
  const newLines = edit.newText.split('\n');
  // Voor her-bewerken na een in-place-save: leg vast wat er per regel op welk
  // anker in het bestand komt te staan, zodat de volgende save deze tekst
  // opnieuw kan lokaliseren en knippen.
  const bakeLines = [];
  for (let i = 0; i < newLines.length; i++) {
    const lineStyle = resolveTextEditLineStyle(edit, i);
    const lineFontSize = lineStyle.fontSize || fontSize;
    const anchor = textEditLineAnchor(edit.pdfX, edit.pdfY, i, ls, angle);
    const bakeLine = { x: anchor.x, y: anchor.y, text: '', fontSize: lineFontSize, angle };
    bakeLines.push(bakeLine);
    // C3: een regel die tekstueel gelijk bleef aan het origineel wordt op het
    // pure in-place-pad niet geknipt en dus ook niet hertekend — de originele
    // operatoren (incl. exacte uitvulling/woordposities) blijven staan. De
    // bake-administratie krijgt de ORIGINELE tekst en het originele anker,
    // zodat een latere her-bewerking de regel opnieuw kan vinden.
    if (inplace && !inplace.needsCover
        && Array.isArray(edit.unchangedLines) && edit.unchangedLines[i] === true) {
      const oli = Array.isArray(edit.originalLineInfo) ? edit.originalLineInfo[i] : null;
      bakeLine.text = Array.isArray(edit.originalSpanTexts?.[i])
        ? edit.originalSpanTexts[i].join('')
        : (String(edit.originalText || '').split('\n')[i] ?? '');
      if (oli) {
        bakeLine.x = Number(oli.x) || bakeLine.x;
        bakeLine.y = Number(oli.y) || bakeLine.y;
        bakeLine.fontSize = Number(oli.fontSize) > 0 ? Number(oli.fontSize) : bakeLine.fontSize;
        bakeLine.angle = Number(oli.angle) || 0;
      }
      continue;
    }
    if (!newLines[i]) continue;
    const [r, g, b] = hexToRgb(lineStyle.color || '#000000');
    const lineColor = rgb(r, g, b);
    const baseBold = /bold/i.test(lineStyle.fontFamily || '');
    const baseItalic = /oblique|italic/i.test(lineStyle.fontFamily || '');

    // Mag deze regel in het originele font teruggeschreven worden? Alleen op
    // de in-place-route en zolang de gebruiker het font niet verving
    // (loadedFontName leeg = fontkeuze gewijzigd → Standard-14). Decoraties
    // kunnen mee: de echte glyfbreedtes uit het bestand leveren het bereik.
    const lineMayUseOriginalFont = !!inplace && !!lineStyle.loadedFontName;

    // Onder-/doorstreping over een bereik langs de baseline (in punten
    // vanaf het regel-anker).
    const decorate = (fromX, toX) => {
      if (!(edit.fontUnderline || edit.fontStrikethrough) || toX <= fromX) return;
      const thickness = Math.max(0.5, lineFontSize * 0.06);
      const lineAt = (v) => ({
        start: {
          x: anchor.x + ascDir.x * v + readDir.x * fromX,
          y: anchor.y + ascDir.y * v + readDir.y * fromX,
        },
        end: {
          x: anchor.x + ascDir.x * v + readDir.x * toX,
          y: anchor.y + ascDir.y * v + readDir.y * toX,
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
    };

    // Eén tekst-run tekenen op offset penX langs de baseline; retourneert de
    // opgeschoven penpositie.
    const drawRun = async (text, bold, italic, penX, runColor) => {
      const cleaned = String(text ?? '').replace(/\t/g, ' ').replace(/\r/g, '');
      const { text: safe, replaced } = sanitizeWinAnsiText(cleaned);
      if (replaced.length > 0) {
        console.warn(
          `[text-edits] Edit ${edit.id ?? '?'} regel ${i + 1}: niet-WinAnsi-tekens ` +
          `vervangen bij opslaan: ${replaced.join(' ')}`,
        );
      }
      if (!safe) return penX;
      const variant = standardFontVariant(lineStyle.fontFamily, bold, italic);
      const font = await getEditFont(variant);
      let color = lineColor;
      if (runColor) {
        const [rr, rg, rb] = hexToRgb(runColor);
        color = rgb(rr, rg, rb);
      }
      page.drawText(safe, {
        x: anchor.x + readDir.x * penX,
        y: anchor.y + readDir.y * penX,
        size: lineFontSize,
        font,
        rotate: degrees(angle),
        color
      });
      bakeLine.text += safe;
      return penX + font.widthOfTextAtSize(safe, lineFontSize);
    };

    // Uniforme run-lus: kolom-segmenten op hun eigen dx langs de baseline;
    // binnen een segment per run het originele font (of een vet/cursief-
    // variant uit dezelfde familie) proberen, met terugval op Standard-14
    // voor precies die run (bv. glyf niet in de subset). De pen schuift op
    // met de ECHTE glyfbreedtes uit het bestand (incl. Tc/Tw/Tz) zodat
    // decoraties en vervolg-runs op de juiste plek landen.
    const segs = Array.isArray(edit.lineSegments) ? edit.lineSegments[i] : null;
    const effSegs = (segs && segs.length) ? segs : [{ text: newLines[i], dx: 0 }];
    for (let s = 0; s < effSegs.length; s++) {
      const sg = effSegs[s];
      let penX = Number(sg.dx) || 0;
      const segStart = penX;
      const chunks = (Array.isArray(sg.runs) && sg.runs.length)
        ? sg.runs
        : [{ text: sg.text, bold: baseBold, italic: baseItalic }];
      for (const run of chunks) {
        const cleanedRun = String(run.text ?? '').replace(/\t/g, ' ').replace(/\r/g, '');
        let enc = null;
        if (lineMayUseOriginalFont && cleanedRun) {
          enc = inplace.encodeRun(cleanedRun, i, lineFontSize, {
            bold: !!run.bold,
            italic: !!run.italic,
            baseBold,
            baseItalic,
          });
        }
        // Uitgevulde regel: verdeel de ontbrekende breedte over de
        // woordspaties (native via Tw). Alleen voor 1-byte-fonts; bij een
        // Standard-14-terugval of 2-byte-font blijft de regel links
        // uitgelijnd (met waarschuwing).
        const jtw = Array.isArray(edit.lineJustifyTw) ? edit.lineJustifyTw[i] : null;
        if (enc && jtw != null && enc.bytesPerCode === 1 && Number(edit.justifyWidth) > 0) {
          const spaties = (cleanedRun.match(/ /g) || []).length;
          if (spaties > 0 && Number(edit.justifyWidth) > enc.width) {
            const extra = (Number(edit.justifyWidth) - enc.width) / spaties;
            if (extra > 0 && extra < lineFontSize * 2) {
              enc.tw = (enc.tw || 0) + extra;
              enc.width = Number(edit.justifyWidth);
            }
          }
        } else if (!enc && jtw != null && Number(edit.justifyWidth) > 0
            && cleanedRun.includes(' ')) {
          // Uitvulling op het Standard-14-pad: woord voor woord tekenen en de
          // ontbrekende breedte gelijkmatig over de woordspaties verdelen.
          const variant = standardFontVariant(lineStyle.fontFamily, !!run.bold, !!run.italic);
          const jFont = await getEditFont(variant);
          const { text: safeLine } = sanitizeWinAnsiText(cleanedRun);
          const natural = jFont.widthOfTextAtSize(safeLine, lineFontSize);
          const words = cleanedRun.split(' ').filter(w => w !== '');
          const spaces = Math.max(1, words.length - 1);
          const spaceW = jFont.widthOfTextAtSize(' ', lineFontSize);
          const extra = (Number(edit.justifyWidth) - natural) / spaces;
          if (extra > 0 && extra < lineFontSize * 2) {
            for (const w of words) {
              penX = await drawRun(w, !!run.bold, !!run.italic, penX, run.color || null);
              penX += spaceW + extra;
            }
            penX -= spaceW + extra; // laatste woord heeft geen spatie erna
            continue;
          }
        }
        if (enc) {
          let color = lineColor;
          if (run.color) {
            const [rr, rg, rb] = hexToRgb(run.color);
            color = rgb(rr, rg, rb);
          }
          drawOriginalFontRun(
            page, enc, lineFontSize, color, angle,
            anchor.x + readDir.x * penX, anchor.y + readDir.y * penX,
          );
          bakeLine.text += cleanedRun;
          penX += enc.width;
        } else {
          penX = await drawRun(run.text, !!run.bold, !!run.italic, penX, run.color || null);
        }
      }
      decorate(segStart, penX);
      // Kolom-bewaking: een te breed geworden segment mag de volgende kolom
      // niet inlopen — niet stilletjes; de gebruiker moet het kunnen zien.
      const next = effSegs[s + 1];
      if (next && penX > (Number(next.dx) || 0) + 0.5) {
        console.warn(
          `[text-edits] Edit ${edit.id ?? '?'} regel ${i + 1}: tekst van kolom ` +
          `${s + 1} (${(penX - segStart).toFixed(1)}pt breed) loopt de volgende ` +
          'kolom in.',
        );
      }
    }
  }

  // Bake-administratie: pas definitief maken als de save daadwerkelijk
  // geslaagd is (saver.js promoveert _pendingBakeInfo samen met `baked`).
  edit._pendingBakeInfo = {
    bakedNewText: edit.newText,
    inplaceBaked: inplace ? { lines: bakeLines } : null,
  };
}
