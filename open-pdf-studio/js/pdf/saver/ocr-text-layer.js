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
  PDFOperator, PDFOperatorNames, PDFNumber, PDFContentStream, PDFBool,
  pushGraphicsState, popGraphicsState, beginText, endText,
  setFontAndSize, setTextMatrix, showText,
} from 'pdf-lib';
import { metCffHerstel } from './cff-subset-herstel.js';
import { withUnicodeLayoutGuard } from './unicode-layout-guard.js';
import {
  removeOwnedOcrLayer, removeOcrReview, writeOcrReview, usableOcrWords, unencodableCharacters,
} from '../ocr-review.js';

const INVISIBLE_RENDER_MODE = 3;
const characterSets = new WeakMap();

function setTextRenderingMode(mode) {
  return PDFOperator.of(PDFOperatorNames.SetTextRenderingMode, [PDFNumber.of(mode)]);
}

function setHorizontalScaling(percent) {
  return PDFOperator.of(PDFOperatorNames.SetTextHorizontalScaling, [PDFNumber.of(percent)]);
}

function tauri() {
  return window.__TAURI__ || {};
}

const fontBytesPromises = new Map();

// Bundled in src-tauri/resources/fonts/ (see scripts/ocr-runtime.mjs +
// tauri.conf.json's bundle.resources). Kept separate from embedOcrFont so
// the actual writing logic stays Tauri-agnostic and directly testable (a
// test script can pass its own fontBytes straight to embedOcrFont without
// going through this). Only a successful read stays cached: a missing file
// rejects, and the next save tries again.
export function loadBundledFontBytes(fileName) {
  if (fontBytesPromises.has(fileName)) return fontBytesPromises.get(fileName);
  const promise = (async () => {
    const t = tauri();
    // Tauri's own join() picks the right separator per OS — a hardcoded
    // '\\' (the pattern js/pdf/frames.js uses for kaders/) produced a
    // literal backslash INSIDE the path on macOS/Linux (e.g.
    // ".../resources\fonts\NotoSansTC-Regular.ttf"), which the fs plugin's
    // scope check then rejected outright as a forbidden path — OCR ran
    // fine, but every save silently failed to write the text layer.
    const fontPath = await t.path.join(await t.path.resourceDir(), 'fonts', fileName);
    // The fs plugin's static capability scope doesn't cover the resource
    // dir by default — js/pdf/frames.js grants it the same way for kaders/
    // (allow_fs_scope registers the FILE's parent directory), otherwise
    // readFile rejects even a correctly-joined path as "forbidden".
    try { await t.core.invoke('allow_fs_scope', { path: fontPath }); } catch { /* best-effort */ }
    return await t.fs.readFile(fontPath);
  })();
  fontBytesPromises.set(fileName, promise);
  promise.catch(() => fontBytesPromises.delete(fileName));
  return promise;
}

/** The OCR layer's font: Noto Sans TC (Traditional Chinese + Latin). */
export function loadDefaultOcrFontBytes() {
  return loadBundledFontBytes('NotoSansTC-Regular.ttf');
}

let fontkitPromise = null;

// Noto Sans TC/SC are CID-keyed CFF fonts; fontkit's CFF subsetter writes an
// invalid header for them and mixes up their Font DICTs. metCffHerstel()
// corrects that without touching node_modules (see cff-subset-herstel.js).
export function laadFontkit() {
  if (!fontkitPromise) fontkitPromise = import('@pdf-lib/fontkit').then((m) => metCffHerstel(m.default));
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
export async function embedOcrFont(pdfDocLib, fontBytes, { unicodeGuard = false } = {}) {
  // fontkit hoort bij het PDFDocument, niet bij de module: registreer hem bij
  // elk document. Alleen het laden van de module wordt gedeeld; anders mislukt
  // elke volgende opslag in dezelfde sessie met "no fontkit instance was found".
  // De Unicode-bewaking (#678) alleen op verzoek: de OCR-laag slaat zo een
  // woord over dat het font niet terug naar Unicode kan brengen. Zichtbare
  // tekst (CJK-tekstvakken, MCP-tekst) houdt zijn lege vakjes voor tekens die
  // geen font heeft; een fout daar zou de hele opslag laten mislukken.
  const fontkit = await laadFontkit();
  pdfDocLib.registerFontkit(unicodeGuard ? withUnicodeLayoutGuard(fontkit) : fontkit);
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
 *
 * strictReviews (default): a reviewed word the font cannot encode throws
 * OCR_REVIEW_TEXT_NOT_ENCODABLE before the page changes. Off (crash-recovery
 * snapshot): the word is left out of the layer with a warning; the correction
 * stays in the review metadata.
 */
export function writeOcrTextLayer(page, words, font, { pageNum, strictReviews = true } = {}) {
  if (!Array.isArray(words)) return;
  const where = Number.isInteger(pageNum) ? ` on page ${pageNum}` : '';
  const { words: usable, skipped } = usableOcrWords(words);
  if (skipped) console.warn(`[save] OCR: skipped ${skipped} invalid word(s)${where}`);

  const cropBox = page.getCropBox();
  const viewLeft = cropBox.x;
  const viewTop = cropBox.y + cropBox.height;
  const convertX = (x) => x + viewLeft;
  const convertY = (y) => viewTop - y;

  const fontName = page.node.newFontDictionary(font.name, font.ref);
  const ops = [pushGraphicsState(), setTextRenderingMode(INVISIBLE_RENDER_MODE)];
  let notEncodable = 0;

  for (const word of usable) {
    const wordOps = wordOperators(word, word.text, font, fontName, convertX, convertY, !!word.review);
    // Het font kan dit woord niet (terug)coderen, bv. een teken zonder glyph
    // of een gevormde glyph zonder Unicode (UnicodeLayoutError). Een nagekeken
    // woord mag niet stil verdwijnen (#657): de opslag weigert, nog voordat de
    // pagina verandert. Een ongecontroleerd woord slaan we over en de rest van
    // de laag blijft. Een herstelmomentopname mag nooit mislukken: daar valt
    // ook het nagekeken woord weg, met een waarschuwing.
    if (wordOps === undefined && word.review) {
      if (strictReviews) throw new Error('OCR_REVIEW_TEXT_NOT_ENCODABLE');
      notEncodable++;
    }
    if (wordOps) ops.push(...wordOps);
  }
  if (notEncodable) {
    console.warn(`[save] OCR: ${notEncodable} reviewed word(s)${where} cannot be shown by the OCR font; left out of this snapshot`);
  }

  ops.push(popGraphicsState());
  // Build the replacement before unlinking the old owned layer.
  const stream = PDFContentStream.of(page.doc.context.obj({ OPS_OCRLayer: PDFBool.True }), ops);
  const ref = page.doc.context.register(stream);
  removeOwnedOcrLayer(page);
  page.node.addContentStream(ref);
  writeOcrReview(page, usable);
}

function fontCovers(font, text) {
  if (typeof font.getCharacterSet !== 'function') return true;
  if (!characterSets.has(font)) characterSets.set(font, new Set(font.getCharacterSet()));
  return unencodableCharacters(text, characterSets.get(font)).length === 0;
}

/**
 * The operators that place one word, null for a word without text, or
 * undefined when the font cannot encode it. `checkCoverage` also rejects text
 * with characters outside the font (they would silently become .notdef).
 */
function wordOperators(word, rawText, font, fontName, convertX, convertY, checkCoverage) {
  const text = (rawText || '').trim();
  if (!text) return null;
  if (checkCoverage && !fontCovers(font, text)) return undefined;

  // Font size ~= the OCR box height so the invisible selection rectangle
  // a PDF viewer draws roughly matches the word's real footprint.
  const fontSize = Math.max(1, word.height);
  let naturalWidth;
  let hexText;
  try {
    naturalWidth = font.widthOfTextAtSize(text, fontSize);
    hexText = font.encodeText(text);
  } catch {
    return undefined;
  }
  if (!(naturalWidth > 0)) return undefined;

  // Stretch/compress horizontally so the glyphs' total advance matches the
  // OCR-measured word width exactly, regardless of how the CJK font's
  // natural metrics compare to what Tesseract measured.
  const scalePercent = Math.max(1, Math.min(500, (word.width / naturalWidth) * 100));
  const x = convertX(word.left);
  const y = convertY(word.top + word.height); // anchor at box bottom, Y-flipped

  return [
    beginText(),
    setFontAndSize(fontName, fontSize),
    setHorizontalScaling(scalePercent),
    setTextMatrix(1, 0, 0, 1, x, y),
    showText(hexText),
    endText(),
  ];
}

/**
 * A short fingerprint of a document's OCR results: equal fingerprints mean
 * the saver writes the same OCR layers and review metadata.
 */
export function ocrSignature(results) {
  const text = JSON.stringify(results || {});
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${text.length}:${(h2 >>> 0).toString(16)}${(h1 >>> 0).toString(16)}`;
}

/**
 * Write the OCR layers of a document into `pages` (one save).
 *
 * - A page with words gets a fresh own layer plus its review metadata.
 * - A page with an empty word list (an undone OCR run) loses the own layer
 *   and review metadata that an earlier save of this session wrote
 *   (`doc.ocrLayerPages`); a layer from before this session stays.
 * - Without the OCR font nothing is written and the save goes on, unless
 *   reviewed words exist (they must not silently disappear, #657) and
 *   `strictReviews` is on.
 *
 * Returns null when nothing was written, else `{ signature, layerPages }`:
 * the fingerprint of the written results and the pages that now carry an own
 * layer. Invalid and unencodable unreviewed words are skipped; a reviewed
 * word the font cannot encode fails the save (OCR_REVIEW_TEXT_NOT_ENCODABLE).
 * `strictReviews: false` (crash-recovery snapshot) never fails over OCR.
 * `annulering` (saver/opslag-annuleren.js): checked before every page.
 */
export async function writeOcrLayers(pdfDocLib, pages, doc, { loadFontBytes = loadDefaultOcrFontBytes, strictReviews = true, annulering = null } = {}) {
  const results = doc?.ocrResults;
  if (!results || !Object.keys(results).length) return null;
  const hasWords = Object.values(results).some((words) => Array.isArray(words) && words.length > 0);
  let font = null;
  if (hasWords) {
    try {
      font = await embedOcrFont(pdfDocLib, await loadFontBytes(), { unicodeGuard: true });
    } catch (err) {
      // Zonder font geen laag, maar wel een geslaagde opslag; behalve als er
      // nagekeken woorden zijn: die mogen niet stil verdwijnen (#657).
      if (strictReviews && Object.values(results).some((words) => Array.isArray(words) && words.some((word) => word?.review))) throw err;
      console.warn(`[save] OCR text layer skipped: font not available (${err?.message || err})`);
      return null;
    }
  }
  const layerPages = new Set(Array.isArray(doc.ocrLayerPages) ? doc.ocrLayerPages : []);
  for (const [pageNumStr, words] of Object.entries(results)) {
    // Een save kan per pagina geannuleerd worden (#766, saver/opslag-annuleren.js).
    if (annulering) await annulering.punt();
    const pageNum = parseInt(pageNumStr, 10);
    const page = pages[pageNum - 1];
    if (!page) continue;
    if (Array.isArray(words) && words.length > 0) {
      writeOcrTextLayer(page, words, font, { pageNum, strictReviews });
      layerPages.add(pageNum);
    } else if (layerPages.has(pageNum)) {
      removeOwnedOcrLayer(page);
      removeOcrReview(page);
      layerPages.delete(pageNum);
    }
  }
  return { signature: ocrSignature(results), layerPages: [...layerPages].sort((a, b) => a - b) };
}
