// Font metrics for secure redaction (#762): how a shown string splits into
// glyph codes, and the advance and box of each glyph in text space.
//
// Supported: simple fonts (Type1, MMType1, TrueType with /Widths, and the
// standard 14 without /Widths), Type3 (FontMatrix, Widths, FontBBox) and
// Type0/CID fonts with Identity-H/V or an embedded CMap (codespace ranges,
// cidrange/cidchar), /W, /DW, /W2, /DW2. Anything else yields glyphs with
// `known: false`; the content rewriter then treats their extent as an upper
// bound and refuses the redaction if that bound reaches a redaction area.

import { Font as StdFont, Encodings } from '@pdf-lib/standard-fonts';
import { PDFDict, PDFArray, PDFStream, get, nameOf, numOf, numbers, resolve, toJs, streamBytes } from './pdf-values.js';

const STD_ALIASES = {
  Arial: 'Helvetica', 'Arial,Bold': 'Helvetica-Bold', 'Arial,Italic': 'Helvetica-Oblique', 'Arial,BoldItalic': 'Helvetica-BoldOblique',
  ArialMT: 'Helvetica', 'Arial-BoldMT': 'Helvetica-Bold', 'Arial-ItalicMT': 'Helvetica-Oblique', 'Arial-BoldItalicMT': 'Helvetica-BoldOblique',
  TimesNewRoman: 'Times-Roman', 'TimesNewRoman,Bold': 'Times-Bold', 'TimesNewRoman,Italic': 'Times-Italic', 'TimesNewRoman,BoldItalic': 'Times-BoldItalic',
  TimesNewRomanPSMT: 'Times-Roman', 'TimesNewRomanPS-BoldMT': 'Times-Bold', 'TimesNewRomanPS-ItalicMT': 'Times-Italic', 'TimesNewRomanPS-BoldItalicMT': 'Times-BoldItalic',
  CourierNew: 'Courier', 'CourierNew,Bold': 'Courier-Bold', 'CourierNew,Italic': 'Courier-Oblique', 'CourierNew,BoldItalic': 'Courier-BoldOblique',
  CourierNewPSMT: 'Courier', Symbol: 'Symbol', ZapfDingbats: 'ZapfDingbats',
  'Helvetica,Bold': 'Helvetica-Bold', 'Helvetica,Italic': 'Helvetica-Oblique', 'Helvetica,BoldItalic': 'Helvetica-BoldOblique',
};
const STD_NAMES = new Set(['Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique', 'Helvetica', 'Helvetica-Bold',
  'Helvetica-Oblique', 'Helvetica-BoldOblique', 'Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic', 'Symbol', 'ZapfDingbats']);

function stdFontName(baseFont) {
  if (!baseFont) return null;
  const plain = baseFont.replace(/^[A-Z]{6}\+/, '');
  if (STD_NAMES.has(plain)) return plain;
  return STD_ALIASES[plain] || null;
}

// StandardEncoding (the codes that differ from plain ASCII names or lie above 127).
const ASCII_NAMES = ['space', 'exclam', 'quotedbl', 'numbersign', 'dollar', 'percent', 'ampersand', 'quoteright', 'parenleft', 'parenright',
  'asterisk', 'plus', 'comma', 'hyphen', 'period', 'slash', 'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'colon', 'semicolon', 'less', 'equal', 'greater', 'question', 'at', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'bracketleft', 'backslash',
  'bracketright', 'asciicircum', 'underscore', 'quoteleft', ...'abcdefghijklmnopqrstuvwxyz', 'braceleft', 'bar', 'braceright', 'asciitilde'];
const STANDARD_HIGH = {
  161: 'exclamdown', 162: 'cent', 163: 'sterling', 164: 'fraction', 165: 'yen', 166: 'florin', 167: 'section', 168: 'currency',
  169: 'quotesingle', 170: 'quotedblleft', 171: 'guillemotleft', 172: 'guilsinglleft', 173: 'guilsinglright', 174: 'fi', 175: 'fl',
  177: 'endash', 178: 'dagger', 179: 'daggerdbl', 180: 'periodcentered', 182: 'paragraph', 183: 'bullet', 184: 'quotesinglbase',
  185: 'quotedblbase', 186: 'quotedblright', 187: 'guillemotright', 188: 'ellipsis', 189: 'perthousand', 191: 'questiondown',
  193: 'grave', 194: 'acute', 195: 'circumflex', 196: 'tilde', 197: 'macron', 198: 'breve', 199: 'dotaccent', 200: 'dieresis',
  202: 'ring', 203: 'cedilla', 205: 'hungarumlaut', 206: 'ogonek', 207: 'caron', 208: 'emdash', 225: 'AE', 227: 'ordfeminine',
  232: 'Lslash', 233: 'Oslash', 234: 'OE', 235: 'ordmasculine', 241: 'ae', 245: 'dotlessi', 248: 'lslash', 249: 'oslash',
  250: 'oe', 251: 'germandbls',
};
let _standard = null, _winAnsi = null;
function standardEncoding() {
  if (_standard) return _standard;
  _standard = new Map();
  ASCII_NAMES.forEach((n, i) => _standard.set(32 + i, n));
  for (const [c, n] of Object.entries(STANDARD_HIGH)) _standard.set(Number(c), n);
  return _standard;
}
function encodingTable(enc) {
  const m = new Map();
  const maps = enc?.unicodeMappings;
  if (maps) for (const v of Object.values(maps)) if (Array.isArray(v)) m.set(v[0], v[1]);
  return m;
}
function winAnsiEncoding() {
  if (!_winAnsi) {
    _winAnsi = encodingTable(Encodings.WinAnsi);
    // ASCII names WinAnsi shares with StandardEncoding, except the quotes.
    ASCII_NAMES.forEach((n, i) => { if (!_winAnsi.has(32 + i)) _winAnsi.set(32 + i, n); });
    _winAnsi.set(39, 'quotesingle'); _winAnsi.set(96, 'grave');
  }
  return _winAnsi;
}

/** Text-space vertical extent from a descriptor/bbox (glyph units /1000 already applied by caller). */
function extentFrom(context, descriptor, bbox, scale) {
  let asc = numOf(get(context, descriptor, 'Ascent'));
  let desc = numOf(get(context, descriptor, 'Descent'));
  if (asc !== null) asc *= scale; if (desc !== null) desc *= scale;
  if (!(asc > 0) && bbox) asc = bbox[3] * scale;
  if ((desc === null || desc > 0) && bbox) desc = bbox[1] * scale;
  if (!(asc > 0)) asc = 0.9;
  if (desc === null || !Number.isFinite(desc) || desc > 0) desc = -0.25;
  // Accents and tall glyphs exceed the ascent a little; be generous.
  const capped = Math.max(asc, 0.75);
  return { ascent: capped, descent: Math.min(desc, -0.15) };
}

function simpleFont(context, dict, subtype) {
  const first = numOf(get(context, dict, 'FirstChar'), 0);
  const widths = numbers(context, dict.get(PDFName_('Widths')));
  const descriptor = get(context, dict, 'FontDescriptor');
  const missing = numOf(get(context, descriptor, 'MissingWidth'), 0);
  const bbox = numbers(context, get(context, descriptor, 'FontBBox'));
  let widthOf = null;
  let std = null;
  let maxW = 0;
  if (widths) {
    for (const w of widths) if (w > maxW) maxW = w;
    if (missing > maxW) maxW = missing;
    widthOf = (code) => {
      const i = code - first;
      return i >= 0 && i < widths.length ? widths[i] : missing;
    };
  } else {
    const stdName = stdFontName(nameOf(get(context, dict, 'BaseFont')));
    if (stdName) {
      std = StdFont.load(stdName);
      const enc = get(context, dict, 'Encoding');
      let base = null;
      let diffs = null;
      if (enc instanceof PDFDict) {
        base = nameOf(get(context, enc, 'BaseEncoding'));
        diffs = toJs(context, get(context, enc, 'Differences'));
      } else base = nameOf(enc);
      let table;
      if (stdName === 'Symbol') table = encodingTable(Encodings.Symbol);
      else if (stdName === 'ZapfDingbats') table = encodingTable(Encodings.ZapfDingbats);
      else table = base === 'WinAnsiEncoding' ? winAnsiEncoding() : standardEncoding();
      table = new Map(table);
      if (Array.isArray(diffs)) {
        let code = 0;
        for (const x of diffs) { if (typeof x === 'number') code = x; else if (typeof x === 'string') table.set(code++, x); }
      }
      const certain = !base || base === 'WinAnsiEncoding' || base === 'StandardEncoding' || stdName === 'Symbol' || stdName === 'ZapfDingbats';
      for (const m of std.CharMetrics) if (m.WX > maxW) maxW = m.WX;
      widthOf = (code) => {
        if (!certain && code > 127) return undefined;
        const name = table.get(code);
        if (!name) return undefined;
        const w = std.getWidthOfGlyph(name);
        return typeof w === 'number' ? w : undefined;
      };
    }
  }
  const stdBox = std ? std.FontBBox : null;
  const ext = extentFrom(context, descriptor, bbox || stdBox, 1 / 1000);
  if (std && !descriptor) { ext.ascent = Math.max(0.75, (std.Ascender || 750) / 1000); ext.descent = Math.min(-0.15, (std.Descender || -250) / 1000); }
  const bboxW = (bbox || stdBox) ? ((bbox || stdBox)[2] - Math.min(0, (bbox || stdBox)[0])) : 1000;
  const maxAdvance = Math.max(maxW, bboxW, 1000) / 1000;
  return {
    kind: 'simple', vertical: false, ...ext, maxAdvance,
    glyphs(bytes) {
      const out = [];
      for (let i = 0; i < bytes.length; i++) {
        const w = widthOf ? widthOf(bytes[i]) : undefined;
        out.push({ start: i, len: 1, code: bytes[i], w: w === undefined ? maxAdvance : w / 1000, known: w !== undefined, space: bytes[i] === 32 });
      }
      return out;
    },
  };
}

function type3Font(context, dict) {
  const fm = numbers(context, get(context, dict, 'FontMatrix')) || [0.001, 0, 0, 0.001, 0, 0];
  const first = numOf(get(context, dict, 'FirstChar'), 0);
  const widths = numbers(context, dict.get(PDFName_('Widths'))) || [];
  const bbox = numbers(context, get(context, dict, 'FontBBox'));
  let ascent = 0.9, descent = -0.25;
  if (bbox && (bbox[3] - bbox[1]) > 0) {
    const ys = [[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[0], bbox[3]], [bbox[2], bbox[3]]].map(([x, y]) => x * fm[1] + y * fm[3] + fm[5]);
    ascent = Math.max(...ys); descent = Math.min(...ys);
    if (!(ascent > descent)) { ascent = 0.9; descent = -0.25; }
  }
  let maxW = 0;
  for (const w of widths) { const a = Math.abs(w * fm[0]); if (a > maxW) maxW = a; }
  if (bbox) maxW = Math.max(maxW, Math.abs((bbox[2] - bbox[0]) * fm[0]));
  const maxAdvance = Math.max(maxW, 0.001);
  return {
    kind: 'type3', vertical: false, ascent, descent, maxAdvance,
    glyphs(bytes) {
      const out = [];
      for (let i = 0; i < bytes.length; i++) {
        const k = bytes[i] - first;
        const known = k >= 0 && k < widths.length;
        out.push({ start: i, len: 1, code: bytes[i], w: known ? widths[k] * fm[0] : maxAdvance, known, space: bytes[i] === 32 });
      }
      return out;
    },
  };
}

// ── CMaps ──

function parseCMapStream(src) {
  const ranges = []; // {lo, hi, len}
  const cids = []; // {lo, hi, cid}
  let useCMap = null;
  let wmode = 0;
  const hexes = (s) => [...s.matchAll(/<([0-9a-fA-F\s]*)>|(\d+)/g)].map((m) => (m[1] !== undefined ? { hex: m[1].replace(/\s/g, '') } : { n: Number(m[2]) }));
  for (const block of src.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g)) {
    const t = hexes(block[1]);
    for (let i = 0; i + 1 < t.length; i += 2) {
      if (t[i].hex === undefined || t[i + 1].hex === undefined) continue;
      ranges.push({ lo: parseInt(t[i].hex || '0', 16), hi: parseInt(t[i + 1].hex || '0', 16), len: Math.max(1, Math.ceil(t[i].hex.length / 2)) });
    }
  }
  for (const block of src.matchAll(/begincidrange([\s\S]*?)endcidrange/g)) {
    const t = hexes(block[1]);
    for (let i = 0; i + 2 < t.length; i += 3) {
      if (t[i].hex === undefined || t[i + 1].hex === undefined || t[i + 2].n === undefined) continue;
      cids.push({ lo: parseInt(t[i].hex, 16), hi: parseInt(t[i + 1].hex, 16), cid: t[i + 2].n, len: Math.ceil(t[i].hex.length / 2) });
    }
  }
  for (const block of src.matchAll(/begincidchar([\s\S]*?)endcidchar/g)) {
    const t = hexes(block[1]);
    for (let i = 0; i + 1 < t.length; i += 2) {
      if (t[i].hex === undefined || t[i + 1].n === undefined) continue;
      const c = parseInt(t[i].hex, 16);
      cids.push({ lo: c, hi: c, cid: t[i + 1].n, len: Math.ceil(t[i].hex.length / 2) });
    }
  }
  const u = /\/([^\s/]+)\s+usecmap/.exec(src);
  if (u) useCMap = u[1];
  const w = /\/WMode\s+(\d)/.exec(src);
  if (w) wmode = Number(w[1]);
  return { ranges, cids, useCMap, wmode };
}

function cmapFor(context, enc) {
  const name = nameOf(enc);
  if (name === 'Identity-H' || name === 'Identity-V') {
    return { identity: true, vertical: name === 'Identity-V', ranges: [{ lo: 0, hi: 0xffff, len: 2 }], cids: [], known: true };
  }
  if (enc instanceof PDFStream) {
    let src = '';
    try { const b = streamBytes(enc); for (const x of b) src += String.fromCharCode(x); } catch { return { known: false }; }
    const parsed = parseCMapStream(src);
    let vertical = parsed.wmode === 1 || numOf(get(context, enc, 'WMode'), 0) === 1;
    let base = null;
    const use = get(context, enc, 'UseCMap');
    if (use || parsed.useCMap) base = cmapFor(context, use || PDFName_(parsed.useCMap));
    if (base && !base.known) return { known: false };
    const ranges = parsed.ranges.length ? parsed.ranges : base?.ranges || [];
    if (!ranges.length) return { known: false };
    if (base?.vertical) vertical = true;
    return { identity: false, vertical, ranges, cids: parsed.cids, base, known: true };
  }
  return { known: false, vertical: /-V$/.test(name || '') };
}

function cidOf(cmap, code, len) {
  for (const r of cmap.cids) if (r.len === len && code >= r.lo && code <= r.hi) return r.cid + (code - r.lo);
  if (cmap.base) return cidOf(cmap.base, code, len);
  if (cmap.identity) return code;
  return 0; // unmapped codes show CID 0 (notdef)
}

function parseW(arr) {
  const m = new Map();
  if (!Array.isArray(arr)) return m;
  for (let i = 0; i < arr.length;) {
    const a = arr[i], b = arr[i + 1];
    if (typeof a !== 'number') { i++; continue; }
    if (Array.isArray(b)) { b.forEach((w, k) => { if (typeof w === 'number') m.set(a + k, w); }); i += 2; }
    else if (typeof b === 'number' && typeof arr[i + 2] === 'number') { for (let c = a; c <= b && c - a < 0x10000; c++) m.set(c, arr[i + 2]); i += 3; }
    else i += 2;
  }
  return m;
}
function parseW2(arr) {
  const m = new Map();
  if (!Array.isArray(arr)) return m;
  for (let i = 0; i < arr.length;) {
    const a = arr[i], b = arr[i + 1];
    if (typeof a !== 'number') { i++; continue; }
    if (Array.isArray(b)) { for (let k = 0; k + 2 < b.length + 1; k += 3) m.set(a + k / 3, [b[k], b[k + 1], b[k + 2]]); i += 2; }
    else if (typeof b === 'number' && arr.length > i + 4) { for (let c = a; c <= b && c - a < 0x10000; c++) m.set(c, [arr[i + 2], arr[i + 3], arr[i + 4]]); i += 5; }
    else i += 2;
  }
  return m;
}

function type0Font(context, dict) {
  const descs = get(context, dict, 'DescendantFonts');
  const cid = descs instanceof PDFArray ? resolve(context, descs.get(0)) : null;
  const descriptor = get(context, cid, 'FontDescriptor');
  const bbox = numbers(context, get(context, descriptor, 'FontBBox'));
  const dw = numOf(get(context, cid, 'DW'), 1000);
  const W = parseW(toJs(context, get(context, cid, 'W')));
  const dw2 = numbers(context, get(context, cid, 'DW2')) || [880, -1000];
  const W2 = parseW2(toJs(context, get(context, cid, 'W2')));
  const cmap = cmapFor(context, get(context, dict, 'Encoding'));
  const ext = extentFrom(context, descriptor, bbox, 1 / 1000);
  let maxW = dw;
  for (const w of W.values()) if (w > maxW) maxW = w;
  const bboxW = bbox ? bbox[2] - Math.min(0, bbox[0]) : 1000;
  const maxAdvance = Math.max(maxW, bboxW, 1000, Math.abs(dw2[1])) / 1000;
  const vertical = !!cmap.vertical;
  const known = !!cmap.known && !!cid;
  return {
    kind: 'type0', vertical, ...ext, maxAdvance,
    glyphs(bytes) {
      const out = [];
      if (!known) {
        // Unknown code lengths: one entry per byte with an upper-bound advance.
        for (let i = 0; i < bytes.length; i++) out.push({ start: i, len: 1, code: bytes[i], w: maxAdvance, w1: -maxAdvance, known: false, space: false });
        return out;
      }
      for (let i = 0; i < bytes.length;) {
        let len = 0, code = 0;
        for (let l = 1; l <= 4 && i + l <= bytes.length && !len; l++) {
          let c = 0;
          for (let k = 0; k < l; k++) c = c * 256 + bytes[i + k];
          if (cmap.ranges.some((r) => r.len === l && c >= r.lo && c <= r.hi)) { len = l; code = c; }
        }
        if (!len) { // not in any codespace: consume the shortest range length
          len = Math.max(1, Math.min(...cmap.ranges.map((r) => r.len), bytes.length - i));
          for (let k = 0; k < len; k++) code = code * 256 + bytes[i + k];
        }
        const c = cidOf(cmap, code, len);
        const w0 = (W.has(c) ? W.get(c) : dw) / 1000;
        const v = W2.get(c);
        const w1 = (v ? v[0] : dw2[1]) / 1000;
        out.push({ start: i, len, code, w: w0, w1, known: true, space: len === 1 && code === 32 });
        i += len;
      }
      return out;
    },
  };
}

// PDFName without importing pdf-lib twice in hot paths.
import { PDFName } from 'pdf-lib';
const PDFName_ = (s) => PDFName.of(s);

/** Font metrics for a font dictionary; unknown/invalid fonts give `known:false` glyphs. */
export function loadFont(context, fontDict) {
  const dict = resolve(context, fontDict);
  if (!(dict instanceof PDFDict)) return unknownFont();
  const subtype = nameOf(get(context, dict, 'Subtype'));
  try {
    if (subtype === 'Type0') return type0Font(context, dict);
    if (subtype === 'Type3') return type3Font(context, dict);
    return simpleFont(context, dict, subtype);
  } catch {
    return unknownFont();
  }
}

export function unknownFont() {
  return {
    kind: 'unknown', vertical: false, ascent: 1, descent: -0.3, maxAdvance: 1.5,
    glyphs(bytes) { return Array.from(bytes, (b, i) => ({ start: i, len: 1, code: b, w: 1.5, w1: -1.5, known: false, space: false })); },
  };
}
