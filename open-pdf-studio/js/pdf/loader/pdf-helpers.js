// Map PDF internal font name to CSS font family, and extract bold/italic style info
// Returns { family, bold, italic } or null
export function mapPdfFontName(pdfName) {
  if (!pdfName) return null;
  // Remove leading slash if present
  const name = pdfName.replace(/^\//, '');

  // Skip pure reference names like "F1", "F8", "Ff12" - these are not real font names
  if (/^[Ff]\d+$/.test(name)) return null;

  // Common PDF standard font mappings
  const fontMap = {
    'Helv': { family: 'Helvetica' },
    'HeBo': { family: 'Helvetica', bold: true },
    'Helvetica': { family: 'Helvetica' },
    'Helvetica-Bold': { family: 'Helvetica', bold: true },
    'Helvetica-Oblique': { family: 'Helvetica', italic: true },
    'Helvetica-BoldOblique': { family: 'Helvetica', bold: true, italic: true },
    'Cour': { family: 'Courier New' },
    'Courier': { family: 'Courier New' },
    'Courier-Bold': { family: 'Courier New', bold: true },
    'Courier-Oblique': { family: 'Courier New', italic: true },
    'Courier-BoldOblique': { family: 'Courier New', bold: true, italic: true },
    'TiRo': { family: 'Times New Roman' },
    'Times': { family: 'Times New Roman' },
    'Times-Roman': { family: 'Times New Roman' },
    'Times-Bold': { family: 'Times New Roman', bold: true },
    'Times-Italic': { family: 'Times New Roman', italic: true },
    'Times-BoldItalic': { family: 'Times New Roman', bold: true, italic: true },
    'Symbol': { family: 'Symbol' },
    'ZapfDingbats': { family: 'ZapfDingbats' },
    'ZaDb': { family: 'ZapfDingbats' },
    'Arial': { family: 'Arial' },
    'ArialMT': { family: 'Arial' },
    'Arial-BoldMT': { family: 'Arial', bold: true },
    'Arial-ItalicMT': { family: 'Arial', italic: true },
    'Arial-BoldItalicMT': { family: 'Arial', bold: true, italic: true },
  };

  if (fontMap[name]) return fontMap[name];

  // Try to extract base font family from composite names like "SegoeUI-Bold", "ABCDEF+SegoeUI"
  let cleaned = name;
  // Remove subset prefix (e.g., "ABCDEF+")
  cleaned = cleaned.replace(/^[A-Z]{6}\+/, '');

  // Detect bold/italic from style suffixes before removing them
  const stylePart = cleaned.match(/[-,](Bold|Italic|Regular|Light|Medium|Semibold|SemiBold|Thin|ExtraBold|Black|Oblique|BoldItalic|BoldOblique|It)+$/i);
  let bold = false, italic = false;
  if (stylePart) {
    const s = stylePart[0].toLowerCase();
    bold = /bold|black|extrabold/i.test(s);
    italic = /italic|oblique|(?:^|-)it$/i.test(s);
  }

  // Remove style suffixes
  cleaned = cleaned.replace(/[-,](Bold|Italic|Regular|Light|Medium|Semibold|SemiBold|Thin|ExtraBold|Black|Oblique|BoldItalic|BoldOblique|It)+$/i, '');

  // Insert spaces before capitals for CamelCase names (e.g., "SegoeUI" -> "Segoe UI")
  const spaced = cleaned.replace(/([a-z])([A-Z])/g, '$1 $2');

  return spaced ? { family: spaced, bold, italic } : null;
}

// Helper to map PDF.js borderStyle.style to our border style string
// PDF.js values: 1=SOLID, 2=DASHED, 3=BEVELED, 4=INSET, 5=UNDERLINE
export function mapBorderStyle(annot) {
  const style = annot.borderStyle?.style;
  if (style === 2) return 'dashed';
  if (style === 3 || style === 4) return 'dotted';
  return 'solid';
}

// Helper to get number from pdf-lib PDFNumber
export function pdfNum(obj) {
  if (!obj) return null;
  if (typeof obj === 'number') return obj;
  if (typeof obj.numberValue === 'number') return obj.numberValue;
  if (typeof obj.asNumber === 'function') return obj.asNumber();
  return null;
}

// Decompress zlib/deflate data using Web Streams API
export async function inflateBytes(compressed) {
  try {
    const ds = new DecompressionStream('deflate');
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();
    writer.write(compressed);
    writer.close();
    const chunks = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    let total = 0;
    for (const c of chunks) total += c.length;
    const result = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { result.set(c, offset); offset += c.length; }
    return result;
  } catch (e) {
    // Try raw deflate (no zlib header)
    try {
      const ds = new DecompressionStream('raw');
      const writer = ds.writable.getWriter();
      const reader = ds.readable.getReader();
      writer.write(compressed);
      writer.close();
      const chunks = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      let total = 0;
      for (const c of chunks) total += c.length;
      const result = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) { result.set(c, offset); offset += c.length; }
      return result;
    } catch (e2) {
      return null;
    }
  }
}

// Convert pdf-lib color array to hex
export function pdfColorToHex(colorArray, context) {
  if (!colorArray || typeof colorArray.size !== 'function' || colorArray.size() < 3) return null;
  const r = pdfNum(colorArray.get(0)), g = pdfNum(colorArray.get(1)), b = pdfNum(colorArray.get(2));
  if (r === null || g === null || b === null) return null;
  return `#${Math.round(r * 255).toString(16).padStart(2, '0')}${Math.round(g * 255).toString(16).padStart(2, '0')}${Math.round(b * 255).toString(16).padStart(2, '0')}`;
}
