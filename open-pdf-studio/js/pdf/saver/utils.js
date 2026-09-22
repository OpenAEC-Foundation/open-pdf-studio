import { PDFName } from 'pdf-lib';
import { kruisEindpuntenEllips } from '../../annotations/kruis-geometrie.js';
import { hasFill, hasStroke, colorWithoutStroke, kanZonderRand } from '../../annotations/fill-utils.js';

// Convert hex color to RGB values (0-1 range)
export function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [0, 0, 0];
  return [
    parseInt(result[1], 16) / 255,
    parseInt(result[2], 16) / 255,
    parseInt(result[3], 16) / 255
  ];
}

// Dash arrays per border style, mirroring rendering/decorations.js
// applyBorderStyle so a saved /BS /D pattern matches the on-screen look.
// Solid → null (no /D; style stays 'S'). Extended (dash-dot) styles used to
// fall through to solid, making dash-dot / long-dash lines render as plain
// solid lines in other PDF viewers (issue #256).
const BORDER_DASH_ARRAYS = {
  'dashed': [8, 4],
  'dotted': [2, 2],
  'dash-dot': [10, 8, 2, 8],
  'dash-dot-dot': [10, 8, 2, 8, 2, 8],
  'long-dash': [20, 10],
  'long-dash-dot': [20, 10, 2, 10],
  'long-dash-dot-dot': [20, 10, 2, 10, 2, 10],
};

// Build a BS (Border Style) dictionary
export function buildBorderStyle(context, width, borderStyle) {
  const dash = BORDER_DASH_ARRAYS[borderStyle] || null;
  const bs = { Type: 'Border', W: width, S: dash ? 'D' : 'S' };
  if (dash) bs.D = dash;
  return context.obj(bs);
}

// Vormen waarvan de rand via "geen rand" (strokeColor 'none') weg kan — de
// soorten waarvoor rendering.js de omtrek met hasStroke() overslaat. De waarde
// is de sleutel van de randkleur in het annotatie-woordenboek: /C, behalve bij
// FreeText, waar /C de vulling is en /IC de rand (zie saver.js en de loader).
const RANDSLEUTEL = {
  box: 'C', circle: 'C', polygon: 'C', cloud: 'C', filledArea: 'C', measureArea: 'C',
  textbox: 'IC', callout: 'IC',
};

// Sleutel van de randkleur als deze annotatie zonder rand opgeslagen moet
// worden, anders null (vorm mét rand, of een soort zonder weglaatbare rand).
export function randSleutelZonderRand(ann) {
  if (!ann || hasStroke(ann.strokeColor) || !kanZonderRand(ann.type)) return null;
  return RANDSLEUTEL[ann.type] || null;
}

// Vorm zonder rand in het annotatie-woordenboek (#431). Elke lezer moet hem
// zonder omtrek tonen: de randkleur gaat eruit en /BS krijgt /W 0 (de lijnstijl
// /S en /D blijven). Wat de app nodig heeft voor een exacte rondgang staat in
// de eigen sleutel /OPS_NoStroke << /W lijndikte /C kleur >>: de lijndikte-
// instelling (de /W die er met rand had gestaan) en de eigen kleur van de
// annotatie, waarin kruis, aanhaallijn en maatlabel getekend worden.
export function markeerZonderRand(context, annotDict, ann, randSleutel) {
  const bewaard = {};
  const bsRaw = annotDict.get(PDFName.of('BS'));
  const bs = bsRaw ? context.lookup(bsRaw) : null;
  const w = bs ? context.lookup(bs.get(PDFName.of('W'))) : null;
  if (w && typeof w.asNumber === 'function') bewaard.W = w.asNumber();
  if (bs) bs.set(PDFName.of('W'), context.obj(0));
  else annotDict.set(PDFName.of('BS'), buildBorderStyle(context, 0, ann.borderStyle));
  annotDict.delete(PDFName.of(randSleutel));
  if (hasFill(ann.color)) bewaard.C = hexToRgb(ann.color);
  annotDict.set(PDFName.of('OPS_NoStroke'), context.obj(bewaard));
}

// Compute annotation flags (F entry) from annotation properties
export function computeAnnotFlags(ann) {
  let flags = 0;
  if (ann.printable !== false) flags |= 4;   // Bit 3: Print (default on)
  if (ann.readOnly) flags |= 64;              // Bit 7: ReadOnly
  if (ann.locked) flags |= 128;               // Bit 8: Locked
  return flags;
}

// Map CSS font family + bold/italic to PDF standard font name for DA string
export function mapFontToPdfName(fontFamily, bold, italic) {
  const f = (fontFamily || '').toLowerCase();

  // Map well-known CSS fonts to PDF standard 14 font names
  if (f.includes('courier') || f === 'mono' || f === 'monospace') {
    if (bold && italic) return 'Courier-BoldOblique';
    if (bold) return 'Courier-Bold';
    if (italic) return 'Courier-Oblique';
    return 'Courier';
  }
  if (f.includes('times') || (f.includes('serif') && !f.includes('sans'))) {
    if (bold && italic) return 'Times-BoldItalic';
    if (bold) return 'Times-Bold';
    if (italic) return 'Times-Italic';
    return 'Times-Roman';
  }
  if (f === 'helvetica' || f === 'arial' || f === 'sans-serif') {
    if (bold && italic) return 'Helvetica-BoldOblique';
    if (bold) return 'Helvetica-Bold';
    if (italic) return 'Helvetica-Oblique';
    return 'Helvetica';
  }

  // For non-standard fonts, preserve the actual name as CamelCase (no spaces)
  // The loader's mapPdfFontName re-inserts spaces from CamelCase (e.g. "SegoeUI" → "Segoe UI")
  let baseName = (fontFamily || 'Helvetica').replace(/\s+/g, '');
  let suffix = '';
  if (bold && italic) suffix = '-BoldItalic';
  else if (bold) suffix = '-Bold';
  else if (italic) suffix = '-Italic';
  return baseName + suffix;
}

// Ensure AcroForm Default Resources contain fonts used by FreeText annotations
// so DA strings can reference them (e.g. /Helv, /Courier, /SegoeUI)
export function ensureAcroFormFonts(pdfDoc, context, usedFonts) {
  const catalog = context.lookup(context.trailerInfo.Root);
  if (!catalog) return;

  // Get or create AcroForm dictionary
  let acroFormRef = catalog.get(PDFName.of('AcroForm'));
  let acroForm;
  if (acroFormRef) {
    acroForm = context.lookup(acroFormRef);
  }
  if (!acroForm) {
    acroForm = context.obj({ Fields: [] });
    acroFormRef = context.register(acroForm);
    catalog.set(PDFName.of('AcroForm'), acroFormRef);
  }

  // Get or create DR (Default Resources) dictionary
  let drRef = acroForm.get(PDFName.of('DR'));
  let dr;
  if (drRef) {
    dr = context.lookup(drRef);
  }
  if (!dr) {
    dr = context.obj({});
    acroForm.set(PDFName.of('DR'), dr);
  }

  // Get or create Font dictionary within DR
  let fontDictRef = dr.get(PDFName.of('Font'));
  let fontDict;
  if (fontDictRef) {
    fontDict = context.lookup(fontDictRef);
  }
  if (!fontDict) {
    fontDict = context.obj({});
    dr.set(PDFName.of('Font'), fontDict);
  }

  // Add standard 14 fonts
  const standardFonts = [
    'Helv', 'Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique',
    'Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique',
    'Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic'
  ];
  const baseFontMap = { 'Helv': 'Helvetica' };

  for (const fontName of standardFonts) {
    if (!fontDict.get(PDFName.of(fontName))) {
      const baseFont = baseFontMap[fontName] || fontName;
      fontDict.set(PDFName.of(fontName), context.obj({
        Type: 'Font',
        Subtype: 'Type1',
        BaseFont: baseFont,
        Encoding: 'WinAnsiEncoding'
      }));
    }
  }

  // Also register any non-standard fonts actually used by annotations
  // (e.g. "SegoeUI", "SegoeUI-Bold") so viewers can resolve the DA font reference
  if (usedFonts) {
    for (const fontName of usedFonts) {
      if (!fontDict.get(PDFName.of(fontName))) {
        fontDict.set(PDFName.of(fontName), context.obj({
          Type: 'Font',
          Subtype: 'TrueType',
          BaseFont: fontName,
          Encoding: 'WinAnsiEncoding'
        }));
      }
    }
  }
}

// Strip PDF/A conformance from XMP metadata so the saved file
// is not falsely reported as PDF/A after modifications.
export function stripPdfAMetadata(pdfDocLib) {
  try {
    const catalog = pdfDocLib.catalog;
    const metadataRef = catalog.get(PDFName.of('Metadata'));
    if (!metadataRef) return;

    const metadataObj = pdfDocLib.context.lookup(metadataRef);
    if (!metadataObj || typeof metadataObj.getContents !== 'function') return;

    const xmlBytes = metadataObj.getContents();
    let xml = new TextDecoder().decode(xmlBytes);

    // Remove pdfaid:part and pdfaid:conformance elements
    xml = xml.replace(/<pdfaid:part>[^<]*<\/pdfaid:part>/g, '');
    xml = xml.replace(/<pdfaid:conformance>[^<]*<\/pdfaid:conformance>/g, '');

    // Remove empty pdfaid Description blocks left behind
    xml = xml.replace(/<rdf:Description[^>]*xmlns:pdfaid[^>]*>\s*<\/rdf:Description>/g, '');

    const newBytes = new TextEncoder().encode(xml);
    metadataObj.setContents(newBytes);
  } catch (e) {
    console.warn('Failed to strip PDF/A metadata:', e);
  }
}

// Generate a PDF appearance stream (Form XObject) for an annotation
export function generateAppearanceStream(context, ann, convertY) {
  try {
    let streamContent = '';
    let bbox;

    switch (ann.type) {
      case 'mask': // wipeout — white-filled rect appearance, same path as box
      case 'box': {
        const w = ann.width;
        const h = ann.height;
        bbox = [0, 0, w, h];
        const lw = ann.lineWidth ?? 2;
        // Geen rand (#431): alleen de vulling. Het kruis blijft, in de kleur
        // waarin het scherm het tekent.
        if (randSleutelZonderRand(ann)) {
          if (hasFill(ann.fillColor)) {
            const [fr, fg, fb] = hexToRgb(ann.fillColor);
            streamContent += `${fr} ${fg} ${fb} rg\n0 0 ${w} ${h} re f\n`;
          }
          if (ann.cross) {
            const [kr, kg, kb] = hexToRgb(colorWithoutStroke(ann));
            streamContent += `${lw} w\n${kr} ${kg} ${kb} RG\n0 0 m ${w} ${h} l ${w} 0 m 0 ${h} l S\n`;
          }
          break;
        }
        const [r, g, b] = hexToRgb(ann.strokeColor || ann.color || '#000000');
        streamContent = `${lw} w\n${r} ${g} ${b} RG\n`;
        if (ann.fillColor) {
          const [fr, fg, fb] = hexToRgb(ann.fillColor);
          streamContent += `${fr} ${fg} ${fb} rg\n0 0 ${w} ${h} re B\n`;
        } else {
          streamContent += `0 0 ${w} ${h} re S\n`;
        }
        if (ann.type === 'box' && ann.cross) {
          streamContent += `0 0 m ${w} ${h} l ${w} 0 m 0 ${h} l S\n`;
        }
        break;
      }
      case 'circle': {
        const w = ann.width || ann.radius * 2;
        const h = ann.height || ann.radius * 2;
        bbox = [0, 0, w, h];
        const cx = w / 2, cy = h / 2;
        const rx = w / 2, ry = h / 2;
        const k = 0.5522847498; // Bezier approximation of circle
        const lw = ann.lineWidth ?? 2;
        // Ellipse via Bezier curves
        const ellips = `${cx} ${cy + ry} m\n`
          + `${cx + k*rx} ${cy + ry} ${cx + rx} ${cy + k*ry} ${cx + rx} ${cy} c\n`
          + `${cx + rx} ${cy - k*ry} ${cx + k*rx} ${cy - ry} ${cx} ${cy - ry} c\n`
          + `${cx - k*rx} ${cy - ry} ${cx - rx} ${cy - k*ry} ${cx - rx} ${cy} c\n`
          + `${cx - rx} ${cy + k*ry} ${cx - k*rx} ${cy + ry} ${cx} ${cy + ry} c\n`;
        // Kruis (rond gat / sparing): ±45° door het middelpunt tot de omtrek.
        let kruis = '';
        if (ann.cross) {
          for (const l of kruisEindpuntenEllips(cx, cy, rx, ry)) {
            kruis += `${l.x1} ${l.y1} m ${l.x2} ${l.y2} l\n`;
          }
          kruis += 'S\n';
        }
        // Geen rand (#431): alleen de vulling; het kruis blijft, in de kleur
        // waarin het scherm het tekent.
        if (randSleutelZonderRand(ann)) {
          if (hasFill(ann.fillColor)) {
            const [fr, fg, fb] = hexToRgb(ann.fillColor);
            streamContent += `${fr} ${fg} ${fb} rg\n${ellips}f\n`;
          }
          if (kruis) {
            const [kr, kg, kb] = hexToRgb(colorWithoutStroke(ann));
            streamContent += `${lw} w\n${kr} ${kg} ${kb} RG\n${kruis}`;
          }
          break;
        }
        const [r, g, b] = hexToRgb(ann.strokeColor || ann.color || '#000000');
        streamContent = `${lw} w\n${r} ${g} ${b} RG\n`;
        if (ann.fillColor) {
          const [fr, fg, fb] = hexToRgb(ann.fillColor);
          streamContent += `${fr} ${fg} ${fb} rg\n`;
        }
        streamContent += ellips;
        streamContent += ann.fillColor ? 'B\n' : 'S\n';
        streamContent += kruis;
        break;
      }
      case 'line': {
        // Skip AP stream for lines and arrows - let PDF viewers render natively
        // from /L, /LE, and /BS entries. Custom AP streams cause coordinate
        // mismatches between BBox and Rect, and override native arrowhead rendering.
        return null;
      }
      case 'draw': {
        if (!ann.path || ann.path.length < 2) return null;
        const xs = ann.path.map(p => p.x);
        const ys = ann.path.map(p => p.y);
        const minX = Math.min(...xs) - 2;
        const minY = Math.min(...ys) - 2;
        const maxX = Math.max(...xs) + 2;
        const maxY = Math.max(...ys) + 2;
        bbox = [0, 0, maxX - minX, maxY - minY];
        const [r, g, b] = hexToRgb(ann.strokeColor || ann.color || '#000000');
        const lw = ann.lineWidth ?? 2;
        streamContent = `${lw} w\n${r} ${g} ${b} RG\n`;
        streamContent += `${ann.path[0].x - minX} ${maxY - ann.path[0].y} m\n`;
        for (let i = 1; i < ann.path.length; i++) {
          streamContent += `${ann.path[i].x - minX} ${maxY - ann.path[i].y} l\n`;
        }
        streamContent += 'S\n';
        break;
      }
      case 'text':
      case 'textbox':
      case 'callout': {
        // Skip AP stream for FreeText - let PDF viewers render from Contents + DA
        // natively, which properly displays text. AP stream only draws shapes,
        // causing text to disappear in viewers that use AP over DA.
        return null;
      }
      default:
        return null;
    }

    if (!streamContent || !bbox) return null;

    const streamDict = {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: bbox
    };

    // Add rotation Matrix for rotated annotations (negate: canvas Y-down → PDF Y-up)
    if (ann.rotation && (ann.type === 'box' || ann.type === 'circle')) {
      const rad = -ann.rotation * Math.PI / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      streamDict.Matrix = [
        parseFloat(cos.toFixed(6)),
        parseFloat(sin.toFixed(6)),
        parseFloat((-sin).toFixed(6)),
        parseFloat(cos.toFixed(6)),
        0, 0
      ];
    }

    return context.stream(streamContent, streamDict);
  } catch (e) {
    console.warn('Failed to generate appearance stream for', ann.type, e);
    return null;
  }
}
