import fontkit from '@pdf-lib/fontkit';
import { embedOcrFont, loadDefaultOcrFontBytes } from '../pdf/saver/ocr-text-layer.js';

const latinFonts = {
  regular: 'LiberationSans-Regular.ttf',
  bold: 'LiberationSans-Bold.ttf',
  italic: 'LiberationSans-Italic.ttf',
  boldItalic: 'LiberationSans-BoldItalic.ttf',
};
const fontBytes = new Map();
const embeddedFonts = new WeakMap();

async function liberationBytes(variant) {
  if (!fontBytes.has(variant)) {
    fontBytes.set(variant, fetch(`/pdfjs/web/standard_fonts/${latinFonts[variant]}`)
      .then(response => {
        if (!response.ok) throw new Error(`Could not load ${latinFonts[variant]}`);
        return response.arrayBuffer();
      }).then(buffer => new Uint8Array(buffer)));
  }
  return fontBytes.get(variant);
}

function covers(font, text) {
  return [...text].every(char => font.hasGlyphForCodePoint(char.codePointAt(0)));
}

/** Choose a bundled full font that really has every requested glyph. */
export async function embedMcpTextFont(pdfDocLib, text, { bold = false, italic = false } = {}) {
  const variant = bold && italic ? 'boldItalic' : bold ? 'bold' : italic ? 'italic' : 'regular';
  let embedded = embeddedFonts.get(pdfDocLib);
  if (!embedded) { embedded = new Map(); embeddedFonts.set(pdfDocLib, embedded); }
  const latin = await liberationBytes(variant);
  if (covers(fontkit.create(latin), text)) {
    const name = latinFonts[variant].replace(/\.ttf$/, '');
    if (!embedded.has(name)) embedded.set(name, await embedOcrFont(pdfDocLib, latin));
    return { font: embedded.get(name), name, fallback: true };
  }
  const cjk = await loadDefaultOcrFontBytes();
  if (covers(fontkit.create(cjk), text)) {
    const name = 'NotoSansTC-Regular';
    if (!embedded.has(name)) embedded.set(name, await embedOcrFont(pdfDocLib, cjk));
    return { font: embedded.get(name), name, fallback: true };
  }
  throw new Error('No bundled font contains every replacement glyph; the PDF was not changed');
}
