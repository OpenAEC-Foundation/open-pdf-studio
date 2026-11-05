// Content-stream lexer for secure redaction (#762).
//
// Splits a PDF content stream into operations: operands (parsed into nested
// values) plus the operator, with the byte range of the whole operation, so an
// unchanged operation can be copied byte for byte. Inline images (BI … ID
// data EI) become one operation that carries the parsed image dictionary and
// the raw image data. Comments are dropped (they are not page content and can
// carry text). Pure: no pdf-lib, no DOM.

const WS = new Uint8Array(256);
for (const c of [0, 9, 10, 12, 13, 32]) WS[c] = 1;
const DELIM = new Uint8Array(256);
for (const c of '()<>[]{}/%') DELIM[c.charCodeAt(0)] = 1;
const regular = (b) => !WS[b] && !DELIM[b];

export class Name { constructor(v) { this.v = v; } }
export class Str { constructor(bytes, hex = false) { this.bytes = bytes; this.hex = hex; } }
export class Op { constructor(v) { this.v = v; } }

const latin1 = (bytes, a, b) => {
  let s = '';
  for (let i = a; i < b; i++) s += String.fromCharCode(bytes[i]);
  return s;
};

/** Abbreviations allowed in inline image dictionaries. */
const INLINE_KEYS = {
  BPC: 'BitsPerComponent', CS: 'ColorSpace', D: 'Decode', DP: 'DecodeParms', F: 'Filter',
  H: 'Height', IM: 'ImageMask', I: 'Interpolate', W: 'Width', L: 'Length',
};
const INLINE_NAMES = {
  G: 'DeviceGray', RGB: 'DeviceRGB', CMYK: 'DeviceCMYK', I: 'Indexed',
  AHx: 'ASCIIHexDecode', A85: 'ASCII85Decode', LZW: 'LZWDecode', Fl: 'FlateDecode',
  RL: 'RunLengthDecode', CCF: 'CCITTFaxDecode', DCT: 'DCTDecode',
};
export const expandInlineKey = (k) => INLINE_KEYS[k] || k;
export const expandInlineName = (n) => INLINE_NAMES[n] || n;

function lexer(bytes) {
  const n = bytes.length;
  let pos = 0;
  function skip() {
    for (;;) {
      while (pos < n && WS[bytes[pos]]) pos++;
      if (pos < n && bytes[pos] === 37) { // %
        while (pos < n && bytes[pos] !== 10 && bytes[pos] !== 13) pos++;
        continue;
      }
      return;
    }
  }
  function literal() {
    const out = [];
    let depth = 1;
    pos++;
    while (pos < n) {
      const c = bytes[pos++];
      if (c === 92) { // backslash
        const e = bytes[pos++];
        if (e === 110) out.push(10); else if (e === 114) out.push(13);
        else if (e === 116) out.push(9); else if (e === 98) out.push(8);
        else if (e === 102) out.push(12);
        else if (e >= 48 && e <= 55) {
          let v = e - 48;
          for (let k = 0; k < 2 && pos < n && bytes[pos] >= 48 && bytes[pos] <= 55; k++) v = v * 8 + bytes[pos++] - 48;
          out.push(v & 255);
        } else if (e === 13) { if (bytes[pos] === 10) pos++; }
        else if (e === 10) { /* line continuation */ }
        else if (e !== undefined) out.push(e);
        continue;
      }
      if (c === 40) depth++;
      else if (c === 41 && --depth === 0) break;
      out.push(c);
    }
    return new Str(Uint8Array.from(out), false);
  }
  function hexString() {
    pos++;
    const digits = [];
    while (pos < n && bytes[pos] !== 62) {
      const c = bytes[pos++];
      const v = c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1;
      if (v >= 0) digits.push(v);
    }
    pos++;
    if (digits.length % 2) digits.push(0);
    const out = new Uint8Array(digits.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = digits[2 * i] * 16 + digits[2 * i + 1];
    return new Str(out, true);
  }
  function name() {
    const start = ++pos;
    while (pos < n && regular(bytes[pos])) pos++;
    return new Name(latin1(bytes, start, pos).replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))));
  }
  /** Next token: a value, '[' ']' '<<' '>>' '{' '}', an Op, or null at the end. */
  function token() {
    skip();
    if (pos >= n) return null;
    const c = bytes[pos];
    if (c === 40) return literal();
    if (c === 60) {
      if (bytes[pos + 1] === 60) { pos += 2; return '<<'; }
      return hexString();
    }
    if (c === 62) {
      if (bytes[pos + 1] === 62) { pos += 2; return '>>'; }
      pos++; return token();
    }
    if (c === 91) { pos++; return '['; }
    if (c === 93) { pos++; return ']'; }
    if (c === 123) { pos++; return '{'; }
    if (c === 125) { pos++; return '}'; }
    if (c === 41) { pos++; return token(); } // stray ')'
    if (c === 47) return name();
    const start = pos;
    while (pos < n && regular(bytes[pos])) pos++;
    const word = latin1(bytes, start, pos);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return Number(word);
    if (/^[+-]?\d*\.?\d*$/.test(word) && /\d/.test(word)) return parseFloat(word) || 0;
    if (word === 'true') return true;
    if (word === 'false') return false;
    if (word === 'null') return new Op('null');
    return new Op(word);
  }
  /** A full value from a first token (arrays and dicts nest). */
  function value(t) {
    if (t === '[') {
      const arr = [];
      for (;;) {
        const x = token();
        if (x === null || x === ']') return arr;
        if (x instanceof Op) { if (x.v === 'null') { arr.push(null); continue; } arr.push(x); continue; }
        arr.push(value(x));
      }
    }
    if (t === '<<') {
      const map = new Map();
      for (;;) {
        const k = token();
        if (k === null || k === '>>') return map;
        if (!(k instanceof Name)) continue;
        const v = token();
        if (v === null || v === '>>') { map.set(k.v, null); if (v === '>>') return map; return map; }
        map.set(k.v, v instanceof Op ? (v.v === 'null' ? null : v) : value(v));
      }
    }
    if (t === '{') { // PostScript calculator braces never belong in content; skip
      let depth = 1;
      while (depth && pos < n) { const x = token(); if (x === '{') depth++; else if (x === '}') depth--; else if (x === null) break; }
      return null;
    }
    return t;
  }
  return {
    get pos() { return pos; }, set pos(v) { pos = v; },
    skip, token, value, n,
  };
}

/** Components per pixel of an inline-image colour space (null when it is a resource name). */
function inlineComponents(cs) {
  const v = cs instanceof Name ? expandInlineName(cs.v) : Array.isArray(cs) && cs[0] instanceof Name ? expandInlineName(cs[0].v) : null;
  if (v === 'DeviceGray' || v === 'CalGray' || v === 'Indexed') return 1;
  if (v === 'DeviceRGB' || v === 'CalRGB' || v === 'Lab') return 3;
  if (v === 'DeviceCMYK') return 4;
  return null;
}

/** Find the end of inline image data: the 'EI' after the data. Returns [dataEnd, opEnd]. */
function findInlineEnd(bytes, dataStart, dict) {
  const n = bytes.length;
  const num = (k) => { const v = dict.get(k); return typeof v === 'number' ? v : null; };
  const filter = dict.get('Filter');
  const w = num('Width'), h = num('Height');
  const mask = dict.get('ImageMask') === true;
  const bpc = mask ? 1 : num('BitsPerComponent');
  const comps = mask ? 1 : inlineComponents(dict.get('ColorSpace'));
  const len = num('Length');
  // Unfiltered data has a known length; trust it when EI follows.
  let guess = null;
  if ((filter === undefined || (Array.isArray(filter) && !filter.length)) && w && h && bpc && comps) {
    guess = dataStart + Math.ceil(w * comps * bpc / 8) * h;
  } else if (len !== null && len >= 0) guess = dataStart + len;
  const isEI = (i) => bytes[i] === 69 && bytes[i + 1] === 73 && (i + 2 >= n || WS[bytes[i + 2]] || DELIM[bytes[i + 2]]);
  if (guess !== null) {
    let i = guess;
    while (i < n && WS[bytes[i]]) i++;
    if (isEI(i)) return [guess, i + 2];
  }
  // Search for whitespace EI whitespace followed by plausible content tokens.
  for (let i = dataStart; i < n - 1; i++) {
    if (!isEI(i) || !WS[bytes[i - 1]]) continue;
    // The next bytes must look like content (printable ASCII) or be the end.
    let ok = true;
    for (let j = i + 2, k = 0; j < n && k < 64; j++, k++) {
      const b = bytes[j];
      if (b > 127 || (b < 32 && !WS[b])) { ok = false; break; }
    }
    if (ok) {
      let end = i - 1;
      return [end, i + 2];
    }
  }
  return [n, n];
}

/**
 * Lex a content stream into operations.
 * @param {Uint8Array} bytes
 * @returns {{op:string, operands:any[], s:number, e:number, inline?:{dict:Map, data:Uint8Array}}[]}
 */
export function lexContent(bytes) {
  const lex = lexer(bytes);
  const ops = [];
  let operands = [];
  let start = -1;
  for (;;) {
    lex.skip();
    const at = lex.pos;
    const t = lex.token();
    if (t === null) break;
    if (start < 0) start = at;
    if (t instanceof Op && t.v !== 'null') {
      if (t.v === 'BI') {
        const dict = new Map();
        for (;;) {
          const k = lex.token();
          if (k === null) break;
          if (k instanceof Op && k.v === 'ID') break;
          if (!(k instanceof Name)) continue;
          const v = lex.token();
          if (v === null) break;
          const key = expandInlineKey(k.v);
          let val = v instanceof Op ? null : lex.value(v);
          if (val instanceof Name) val = new Name(expandInlineName(val.v));
          if (Array.isArray(val)) val = val.map((x) => (x instanceof Name ? new Name(expandInlineName(x.v)) : x));
          dict.set(key, val);
        }
        let dataStart = lex.pos;
        if (WS[bytes[dataStart]]) dataStart++;
        const [dataEnd, opEnd] = findInlineEnd(bytes, dataStart, dict);
        ops.push({ op: 'BI', operands: [], s: start, e: opEnd, inline: { dict, data: bytes.slice(dataStart, dataEnd) } });
        lex.pos = opEnd;
      } else {
        ops.push({ op: t.v, operands, s: start, e: lex.pos });
      }
      operands = [];
      start = -1;
      continue;
    }
    operands.push(t instanceof Op ? null : lex.value(t));
  }
  return ops;
}

// ── Serialisation ──

const fmt = (x) => {
  if (!Number.isFinite(x)) return '0';
  if (Number.isInteger(x)) return String(x);
  let s = x.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  if (s === '-0') s = '0';
  return s;
};
export const fmtNum = fmt;

const hex = (bytes) => {
  let s = '<';
  for (const b of bytes) s += (b < 16 ? '0' : '') + b.toString(16);
  return s + '>';
};
const nameStr = (v) => '/' + String(v).replace(/[^!-~]|[()<>[\]{}/%#]/g, (c) => '#' + c.charCodeAt(0).toString(16).padStart(2, '0'));

/** Serialise a lexer value back to content-stream syntax (latin1 string). */
export function ser(v) {
  if (typeof v === 'number') return fmt(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v === null || v === undefined) return 'null';
  if (v instanceof Name) return nameStr(v.v);
  if (v instanceof Str) return hex(v.bytes);
  if (v instanceof Uint8Array) return hex(v);
  if (Array.isArray(v)) return '[' + v.map(ser).join(' ') + ']';
  if (v instanceof Map) {
    let s = '<<';
    for (const [k, x] of v) s += nameStr(k) + ' ' + ser(x) + ' ';
    return s + '>>';
  }
  if (v instanceof Op) return v.v;
  return 'null';
}

/** latin1 string → bytes */
export function bytesOf(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 255;
  return out;
}
