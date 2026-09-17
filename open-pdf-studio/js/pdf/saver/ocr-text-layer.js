// Writes OCR'd words into a page's content stream as an INVISIBLE text
// layer (PDF text-rendering-mode 3 — "add to path for clipping" is also
// disabled, i.e. never painted) positioned over the scanned-image page, so
// the page becomes searchable/selectable/copyable without changing how it
// looks. Coordinates coming in are in the app's usual "top-left origin,
// scale=1" space (see ocr.rs) — converted here to PDF space (bottom-left
// origin) the same way every other saver/* module does.
//
// The embedded font is a bundled CJK-capable TTF (Noto Sans TC) rather than
// one of pdf-lib's 14 Standard fonts, because Standard fonts can only encode
// WinAnsi/Latin text — OCR output for Chinese pages needs real Unicode
// glyph coverage. Glyph shapes are irrelevant here (the text is invisible),
// only the font's Unicode coverage/encoding matters for correct copy/search.
import {
  PDFOperator, PDFOperatorNames, PDFNumber,
  pushGraphicsState, popGraphicsState, beginText, endText,
  setFontAndSize, setTextMatrix, showText,
} from 'pdf-lib';

const INVISIBLE_RENDER_MODE = 3;

function setTextRenderingMode(mode) {
  return PDFOperator.of(PDFOperatorNames.SetTextRenderingMode, [PDFNumber.of(mode)]);
}

function setHorizontalScaling(percent) {
  return PDFOperator.of(PDFOperatorNames.SetTextHorizontalScaling, [PDFNumber.of(percent)]);
}

function tauri() {
  return window.__TAURI__ || {};
}

let cjkFontBytesPromise = null;

// Bundled at src-tauri/resources/fonts/NotoSansTC-Regular.ttf (see
// scripts/ocr-runtime.mjs + tauri.conf.json's bundle.resources). Kept
// separate from embedOcrFont so the actual writing logic stays
// Tauri-agnostic and directly testable (a test script can pass its own
// fontBytes straight to embedOcrFont without going through this).
export async function loadDefaultOcrFontBytes() {
  if (cjkFontBytesPromise) return cjkFontBytesPromise;
  cjkFontBytesPromise = (async () => {
    const t = tauri();
    // Tauri's own join() picks the right separator per OS — a hardcoded
    // '\\' (the pattern js/pdf/frames.js uses for kaders/) produced a
    // literal backslash INSIDE the path on macOS/Linux (e.g.
    // ".../resources\fonts\NotoSansTC-Regular.ttf"), which the fs plugin's
    // scope check then rejected outright as a forbidden path — OCR ran
    // fine, but every save silently failed to write the text layer.
    const fontPath = await t.path.join(await t.path.resourceDir(), 'fonts', 'NotoSansTC-Regular.ttf');
    // The fs plugin's static capability scope doesn't cover the resource
    // dir by default — js/pdf/frames.js grants it the same way for kaders/
    // (allow_fs_scope registers the FILE's parent directory), otherwise
    // readFile rejects even a correctly-joined path as "forbidden".
    try { await t.core.invoke('allow_fs_scope', { path: fontPath }); } catch { /* best-effort */ }
    return await t.fs.readFile(fontPath);
  })();
  return cjkFontBytesPromise;
}

let fontkitPromise = null;

function laadFontkit() {
  if (!fontkitPromise) fontkitPromise = import('@pdf-lib/fontkit').then((m) => m.default);
  return fontkitPromise;
}

/**
 * Embed the CJK font into `pdfDocLib` and return the pdf-lib PDFFont, ready
 * to pass into writeOcrTextLayer for every page. Call once per save (fonts
 * are embedded per-document, not per-page). `fontBytes` is Tauri-agnostic —
 * the caller resolves the bundled font file however fits its environment
 * (ocr.js does it via resourceDir()/fs.readFile(); a test script can just
 * pass fs.readFileSync(...) bytes directly).
 */
export async function embedOcrFont(pdfDocLib, fontBytes) {
  // fontkit hoort bij het PDFDocument, niet bij de module: registreer hem bij
  // elk document. Alleen het laden van de module wordt gedeeld; anders mislukt
  // elke volgende opslag in dezelfde sessie met "no fontkit instance was found".
  pdfDocLib.registerFontkit(await laadFontkit());
  return pdfDocLib.embedFont(fontBytes, { subset: true });
}

/**
 * Append an invisible, searchable text layer to `page` for the given OCR
 * words, using an already-embedded `font` (see embedOcrFont). Coordinates
 * are converted the same way every other saver/* module converts app
 * (top-left-origin) coordinates to PDF space — against the page's CropBox,
 * per CLAUDE.md's "ALWAYS use CropBox... NEVER forget the Y-axis flip" rule
 * (see the convertX/convertY helpers in saver.js).
 *
 * The embedded font is a bundled CJK-capable TTF (Noto Sans TC) rather than
 * one of pdf-lib's 14 Standard fonts, because Standard fonts can only encode
 * WinAnsi/Latin text — OCR output for Chinese pages needs real Unicode
 * glyph coverage. Glyph shapes are irrelevant here (the text is invisible),
 * only the font's Unicode coverage/encoding matters for correct copy/search.
 *
 * words: [{ text, left, top, width, height, confidence }] in PDF points,
 * top-left origin (as returned by the ocr_pdf_page Tauri command — the same
 * space render_page_to_rgba/app annotation coordinates already use).
 */
export function writeOcrTextLayer(page, words, font) {
  if (!words || words.length === 0) return;

  const cropBox = page.getCropBox();
  const viewLeft = cropBox.x;
  const viewTop = cropBox.y + cropBox.height;
  const convertX = (x) => x + viewLeft;
  const convertY = (y) => viewTop - y;

  const fontName = page.node.newFontDictionary(font.name, font.ref);

  const ops = [pushGraphicsState(), setTextRenderingMode(INVISIBLE_RENDER_MODE)];

  for (const word of words) {
    const text = (word.text || '').trim();
    if (!text) continue;

    // Font size ~= the OCR box height so the invisible selection rectangle
    // a PDF viewer draws roughly matches the word's real footprint.
    const fontSize = Math.max(1, word.height);
    let naturalWidth;
    try {
      naturalWidth = font.widthOfTextAtSize(text, fontSize);
    } catch {
      continue; // font can't encode this text (e.g. a stray glyph) — skip the word, keep the rest
    }
    if (!(naturalWidth > 0)) continue;

    // Stretch/compress horizontally so the glyphs' total advance matches the
    // OCR-measured word width exactly, regardless of how the CJK font's
    // natural metrics compare to what Tesseract measured.
    const scalePercent = Math.max(1, Math.min(500, (word.width / naturalWidth) * 100));

    const x = convertX(word.left);
    const y = convertY(word.top + word.height); // anchor at box bottom, Y-flipped

    let hexText;
    try {
      hexText = font.encodeText(text);
    } catch {
      continue;
    }

    ops.push(
      beginText(),
      setFontAndSize(fontName, fontSize),
      setHorizontalScaling(scalePercent),
      setTextMatrix(1, 0, 0, 1, x, y),
      showText(hexText),
      endText(),
    );
  }

  ops.push(popGraphicsState());
  page.pushOperators(...ops);
}
