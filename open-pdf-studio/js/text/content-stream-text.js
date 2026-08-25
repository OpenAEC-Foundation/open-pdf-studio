// ── Content-stream-tekstbewerking (pure helpers) ──
//
// Gereedschap om show-text-operatoren (Tj/TJ/'/") in PDF-content-streams te
// lokaliseren, te decoderen naar Unicode en veilig te verwijderen/vervangen.
// Dit is de kern van het échte in-place tekstbewerken: de saver gebruikt deze
// helpers om de originele tekstruns van een edit uit de content stream te
// knippen in plaats van ze met een wit vlak af te dekken.
//
// Alles hier is puur (geen pdf-lib, geen DOM) zodat het unit-testbaar is.
// Content-stream-bytes worden als latin1-string doorgegeven (1 char == 1 byte).

// ── Tokenizer ──

const WHITESPACE = new Set(['\0', '\t', '\n', '\f', '\r', ' ']);
const DELIMITERS = new Set(['(', ')', '<', '>', '[', ']', '{', '}', '/', '%']);

function isRegular(ch) {
  return !WHITESPACE.has(ch) && !DELIMITERS.has(ch);
}

// Tokeniseert een content stream (latin1-string) naar tokens met byte-
// offsets. Stringtokens bewaren hun RUWE bytewaarden (na escape-decodering)
// als array van getallen — de fontcodering bepaalt pas later de betekenis.
export function tokenizeContentStream(src) {
  const tokens = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const ch = src[i];
    if (WHITESPACE.has(ch)) { i++; continue; }
    if (ch === '%') { // commentaar tot regel-einde
      while (i < n && src[i] !== '\n' && src[i] !== '\r') i++;
      continue;
    }
    const start = i;
    if (ch === '(') { // literal string
      const bytes = [];
      let depth = 1;
      i++;
      while (i < n && depth > 0) {
        const c = src[i];
        if (c === '\\') {
          const e = src[i + 1];
          if (e === 'n') { bytes.push(10); i += 2; }
          else if (e === 'r') { bytes.push(13); i += 2; }
          else if (e === 't') { bytes.push(9); i += 2; }
          else if (e === 'b') { bytes.push(8); i += 2; }
          else if (e === 'f') { bytes.push(12); i += 2; }
          else if (e === '(' || e === ')' || e === '\\') { bytes.push(e.charCodeAt(0)); i += 2; }
          else if (e >= '0' && e <= '7') { // octaal, 1-3 cijfers
            let oct = e; i += 2;
            for (let k = 0; k < 2 && i < n && src[i] >= '0' && src[i] <= '7'; k++) { oct += src[i]; i++; }
            bytes.push(parseInt(oct, 8) & 0xFF);
          } else if (e === '\r') { i += 2; if (src[i] === '\n') i++; } // regelvervolg
          else if (e === '\n') { i += 2; }
          else { bytes.push(e ? e.charCodeAt(0) : 0); i += 2; } // \x → x
        } else if (c === '(') { depth++; bytes.push(40); i++; }
        else if (c === ')') { depth--; if (depth > 0) bytes.push(41); i++; }
        else { bytes.push(c.charCodeAt(0)); i++; }
      }
      tokens.push({ t: 'str', v: bytes, s: start, e: i });
      continue;
    }
    if (ch === '<') {
      if (src[i + 1] === '<') { tokens.push({ t: 'dict<<', s: i, e: i + 2 }); i += 2; continue; }
      // hex string
      i++;
      let hex = '';
      while (i < n && src[i] !== '>') {
        if (!WHITESPACE.has(src[i])) hex += src[i];
        i++;
      }
      i++; // '>'
      if (hex.length % 2 === 1) hex += '0';
      const bytes = [];
      for (let k = 0; k < hex.length; k += 2) bytes.push(parseInt(hex.slice(k, k + 2), 16) & 0xFF);
      tokens.push({ t: 'str', v: bytes, s: start, e: i });
      continue;
    }
    if (ch === '>') {
      if (src[i + 1] === '>') { tokens.push({ t: 'dict>>', s: i, e: i + 2 }); i += 2; continue; }
      i++; continue; // losstaand '>' — ongeldig, overslaan
    }
    if (ch === '[') { tokens.push({ t: 'arr[', s: i, e: i + 1 }); i++; continue; }
    if (ch === ']') { tokens.push({ t: 'arr]', s: i, e: i + 1 }); i++; continue; }
    if (ch === '{') { tokens.push({ t: 'proc{', s: i, e: i + 1 }); i++; continue; }
    if (ch === '}') { tokens.push({ t: 'proc}', s: i, e: i + 1 }); i++; continue; }
    if (ch === '/') { // naam
      i++;
      let name = '';
      while (i < n && isRegular(src[i])) {
        if (src[i] === '#' && /^[0-9a-fA-F]{2}$/.test(src.slice(i + 1, i + 3))) {
          name += String.fromCharCode(parseInt(src.slice(i + 1, i + 3), 16));
          i += 3;
        } else { name += src[i]; i++; }
      }
      tokens.push({ t: 'name', v: name, s: start, e: i });
      continue;
    }
    if (/[0-9+\-.]/.test(ch)) { // getal
      i++;
      while (i < n && /[0-9.]/.test(src[i])) i++;
      const raw = src.slice(start, i);
      const num = parseFloat(raw);
      if (Number.isFinite(num)) { tokens.push({ t: 'num', v: num, s: start, e: i }); continue; }
      // geen geldig getal (bv. losse '-'): als operator-achtig token behandelen
      tokens.push({ t: 'op', v: raw, s: start, e: i });
      continue;
    }
    // bareword: operator of true/false/null
    i++;
    while (i < n && isRegular(src[i])) i++;
    const word = src.slice(start, i);
    if (word === 'true' || word === 'false') tokens.push({ t: 'bool', v: word === 'true', s: start, e: i });
    else if (word === 'null') tokens.push({ t: 'null', v: null, s: start, e: i });
    else if (word === 'BI') {
      // Inline image: dict-tokens tot 'ID', daarna binaire data tot 'EI'.
      // De binaire data mag niet door de tokenizer — zoek het einde ruw op.
      let j = i;
      // zoek 'ID' als los token
      while (j < n) {
        if (src[j] === 'I' && src[j + 1] === 'D'
            && (j === 0 || !isRegular(src[j - 1]))
            && (j + 2 >= n || !isRegular(src[j + 2]))) { j += 2; break; }
        j++;
      }
      // sla binaire data over tot whitespace-'EI'-(whitespace|einde)
      while (j < n) {
        if (src[j] === 'E' && src[j + 1] === 'I'
            && WHITESPACE.has(src[j - 1] || ' ')
            && (j + 2 >= n || WHITESPACE.has(src[j + 2]) || DELIMITERS.has(src[j + 2]))) {
          j += 2; break;
        }
        j++;
      }
      tokens.push({ t: 'op', v: 'BI..EI', s: start, e: j });
      i = j;
    }
    else tokens.push({ t: 'op', v: word, s: start, e: i });
  }
  return tokens;
}

// ── Matrix-hulpen (rij-vector-conventie: punt · M) ──

const IDENTITY = [1, 0, 0, 1, 0, 0];

// A daarna B toepassen: resultaat = A·B.
function matMul(A, B) {
  return [
    A[0] * B[0] + A[1] * B[2],
    A[0] * B[1] + A[1] * B[3],
    A[2] * B[0] + A[3] * B[2],
    A[2] * B[1] + A[3] * B[3],
    A[4] * B[0] + A[5] * B[2] + B[4],
    A[4] * B[1] + A[5] * B[3] + B[5],
  ];
}

// ── Interpreter ──
//
// Loopt door één of meer content streams (in documentvolgorde; lexicale
// tokens kunnen niet over streamgrenzen heen lopen) en levert per show-text-
// operator een record op:
//   { si, s, e, op, font, x, y, angle, sizeEff, posExact, chain, strings,
//     sideEffect }
// - si/s/e: streamindex + byte-range van de VOLLEDIGE operator (operanden
//   t/m operatornaam) — het bereik dat een splice mag vervangen.
// - x/y: user-space-positie van de tekstoorsprong bij de start van de op.
//   posExact=false betekent: de op volgt op een eerdere show-op zonder
//   herpositionering; de langs-baseline-positie is dan onbekend (x/y zijn
//   die van de laatste herpositionering), maar de baseline zelf klopt nog.
// - chain: id van de reeks show-ops sinds de laatste herpositionering.
//   Binnen één chain hangt elke volgende op af van de advance van de vorige.
// - strings: array van byte-arrays (Tj: één; TJ: alle strings uit de array).
// - sideEffect: voor ' → 'T*'; voor " → { aw, ac } (die de splice moet
//   behouden).
//
// Het resultaat-array draagt daarnaast een `xobjects`-eigenschap:
// [{ si, name, ctm }] voor elke Do-operator, met de CTM op dat moment. De
// aanroeper kan hiermee bepalen of een afbeelding (bv. een scan-achtergrond)
// onder een tekstrun ligt — dan moet het afdekvlak blijven, ook al is de
// vector-tekst geknipt.
export function interpretContentStreams(streams) {
  const ops = [];
  const xobjects = [];
  let ctm = IDENTITY.slice();
  const ctmStack = [];
  let tm = null;
  let lm = null;
  let font = null;
  let size = 0;
  let tl = 0;
  let tc = 0;   // Tc: character spacing (pt, ongescaled tekstruimte)
  let tw = 0;   // Tw: word spacing (pt)
  let tz = 100; // Tz: horizontale schaal (%)
  let chain = 0;
  let chainHasShow = false;

  const newChain = () => { chain++; chainHasShow = false; };
  const doTd = (tx, ty) => {
    if (!lm) lm = IDENTITY.slice();
    lm = matMul([1, 0, 0, 1, tx, ty], lm);
    tm = lm.slice();
    newChain();
  };

  const record = (si, operands, opTok, opName, strings, sideEffect) => {
    const cur = tm || IDENTITY;
    const trm = matMul(cur, ctm);
    ops.push({
      si,
      s: operands.length ? operands[0].s : opTok.s,
      e: opTok.e,
      op: opName,
      font,
      x: trm[4],
      y: trm[5],
      angle: ((Math.atan2(trm[1], trm[0]) * 180 / Math.PI) % 360 + 360) % 360,
      sizeEff: Math.abs(size) * Math.hypot(trm[2], trm[3]),
      posExact: !chainHasShow,
      chain,
      strings,
      sideEffect: sideEffect || null,
      tc,
      tw,
      tz,
    });
    chainHasShow = true;
  };

  for (let si = 0; si < streams.length; si++) {
    const tokens = tokenizeContentStream(streams[si]);
    let operands = [];
    for (const tok of tokens) {
      if (tok.t !== 'op') { operands.push(tok); continue; }
      const opName = tok.v;
      const nums = operands.filter(t => t.t === 'num').map(t => t.v);
      const strs = operands.filter(t => t.t === 'str');
      switch (opName) {
        case 'q': ctmStack.push(ctm.slice()); break;
        case 'Q': if (ctmStack.length) ctm = ctmStack.pop(); break;
        case 'cm':
          if (nums.length >= 6) ctm = matMul(nums.slice(-6), ctm);
          break;
        case 'BT': tm = IDENTITY.slice(); lm = IDENTITY.slice(); newChain(); break;
        case 'ET': tm = null; lm = null; break;
        case 'Tf': {
          const nameTok = operands.filter(t => t.t === 'name').pop();
          if (nameTok) font = nameTok.v;
          if (nums.length) size = nums[nums.length - 1];
          break;
        }
        case 'Td': if (nums.length >= 2) doTd(nums[nums.length - 2], nums[nums.length - 1]); break;
        case 'TD':
          if (nums.length >= 2) { tl = -nums[nums.length - 1]; doTd(nums[nums.length - 2], nums[nums.length - 1]); }
          break;
        case 'Tm':
          if (nums.length >= 6) { lm = nums.slice(-6); tm = lm.slice(); newChain(); }
          break;
        case 'T*': doTd(0, -tl); break;
        case 'TL': if (nums.length) tl = nums[nums.length - 1]; break;
        case 'Tc': if (nums.length) tc = nums[nums.length - 1]; break;
        case 'Tw': if (nums.length) tw = nums[nums.length - 1]; break;
        case 'Tz': if (nums.length) tz = nums[nums.length - 1]; break;
        case 'Tj':
          record(si, operands, tok, 'Tj', strs.length ? [strs[strs.length - 1].v] : []);
          break;
        case 'TJ':
          record(si, operands, tok, 'TJ', strs.map(t => t.v));
          break;
        case "'":
          doTd(0, -tl);
          record(si, operands, tok, "'", strs.length ? [strs[strs.length - 1].v] : [], 'T*');
          break;
        case '"': {
          const aw = nums.length >= 2 ? nums[nums.length - 2] : 0;
          const ac = nums.length >= 1 ? nums[nums.length - 1] : 0;
          tw = aw; // " zet eerst Tw en Tc, en toont daarna
          tc = ac;
          doTd(0, -tl);
          record(si, operands, tok, '"', strs.length ? [strs[strs.length - 1].v] : [], { aw, ac });
          break;
        }
        case 'Do': {
          const nameTok = operands.filter(t => t.t === 'name').pop();
          if (nameTok) xobjects.push({ si, name: nameTok.v, ctm: ctm.slice() });
          break;
        }
        default: break; // overige operatoren: geen tekst-state-effect dat wij volgen
      }
      operands = [];
    }
  }
  ops.xobjects = xobjects;
  return ops;
}

// User-space-bounding-box van het eenheidsvierkant onder een CTM — het
// gebied dat een ge-Do'de afbeelding beslaat.
export function xobjectBBox(ctm) {
  const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [
    x * ctm[0] + y * ctm[2] + ctm[4],
    x * ctm[1] + y * ctm[3] + ctm[5],
  ]);
  return {
    minX: Math.min(...pts.map(p => p[0])),
    minY: Math.min(...pts.map(p => p[1])),
    maxX: Math.max(...pts.map(p => p[0])),
    maxY: Math.max(...pts.map(p => p[1])),
  };
}

// ── Codering: code → Unicode en terug ──

// WinAnsiEncoding (cp1252 met de PDF-specifieke invullingen).
export function winAnsiMap() {
  const m = new Map();
  for (let c = 0x20; c <= 0x7E; c++) m.set(c, String.fromCharCode(c));
  for (let c = 0xA0; c <= 0xFF; c++) m.set(c, String.fromCharCode(c));
  const extra = {
    0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E, 0x85: 0x2026,
    0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02C6, 0x89: 0x2030, 0x8A: 0x0160,
    0x8B: 0x2039, 0x8C: 0x0152, 0x8E: 0x017D, 0x91: 0x2018, 0x92: 0x2019,
    0x93: 0x201C, 0x94: 0x201D, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
    0x98: 0x02DC, 0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A, 0x9C: 0x0153,
    0x9E: 0x017E, 0x9F: 0x0178,
  };
  for (const [c, u] of Object.entries(extra)) m.set(Number(c), String.fromCodePoint(u));
  return m;
}

// Compacte AGL-subset: glyfnaam → Unicode. Voldoende voor Differences-arrays
// van Latijnse tekst; onbekende namen leveren undefined (→ niet decodeerbaar).
const GLYPH_NAMES = {
  space: 0x20, exclam: 0x21, quotedbl: 0x22, numbersign: 0x23, dollar: 0x24,
  percent: 0x25, ampersand: 0x26, quotesingle: 0x27, parenleft: 0x28,
  parenright: 0x29, asterisk: 0x2A, plus: 0x2B, comma: 0x2C, hyphen: 0x2D,
  period: 0x2E, slash: 0x2F, zero: 0x30, one: 0x31, two: 0x32, three: 0x33,
  four: 0x34, five: 0x35, six: 0x36, seven: 0x37, eight: 0x38, nine: 0x39,
  colon: 0x3A, semicolon: 0x3B, less: 0x3C, equal: 0x3D, greater: 0x3E,
  question: 0x3F, at: 0x40, bracketleft: 0x5B, backslash: 0x5C,
  bracketright: 0x5D, asciicircum: 0x5E, underscore: 0x5F, grave: 0x60,
  braceleft: 0x7B, bar: 0x7C, braceright: 0x7D, asciitilde: 0x7E,
  exclamdown: 0xA1, cent: 0xA2, sterling: 0xA3, currency: 0xA4, yen: 0xA5,
  brokenbar: 0xA6, section: 0xA7, dieresis: 0xA8, copyright: 0xA9,
  ordfeminine: 0xAA, guillemotleft: 0xAB, logicalnot: 0xAC, registered: 0xAE,
  macron: 0xAF, degree: 0xB0, plusminus: 0xB1, twosuperior: 0xB2,
  threesuperior: 0xB3, acute: 0xB4, mu: 0xB5, micro: 0xB5, paragraph: 0xB6,
  periodcentered: 0xB7, cedilla: 0xB8, onesuperior: 0xB9, ordmasculine: 0xBA,
  guillemotright: 0xBB, onequarter: 0xBC, onehalf: 0xBD, threequarters: 0xBE,
  questiondown: 0xBF, multiply: 0xD7, divide: 0xF7,
  Agrave: 0xC0, Aacute: 0xC1, Acircumflex: 0xC2, Atilde: 0xC3, Adieresis: 0xC4,
  Aring: 0xC5, AE: 0xC6, Ccedilla: 0xC7, Egrave: 0xC8, Eacute: 0xC9,
  Ecircumflex: 0xCA, Edieresis: 0xCB, Igrave: 0xCC, Iacute: 0xCD,
  Icircumflex: 0xCE, Idieresis: 0xCF, Eth: 0xD0, Ntilde: 0xD1, Ograve: 0xD2,
  Oacute: 0xD3, Ocircumflex: 0xD4, Otilde: 0xD5, Odieresis: 0xD6, Oslash: 0xD8,
  Ugrave: 0xD9, Uacute: 0xDA, Ucircumflex: 0xDB, Udieresis: 0xDC, Yacute: 0xDD,
  Thorn: 0xDE, germandbls: 0xDF,
  agrave: 0xE0, aacute: 0xE1, acircumflex: 0xE2, atilde: 0xE3, adieresis: 0xE4,
  aring: 0xE5, ae: 0xE6, ccedilla: 0xE7, egrave: 0xE8, eacute: 0xE9,
  ecircumflex: 0xEA, edieresis: 0xEB, igrave: 0xEC, iacute: 0xED,
  icircumflex: 0xEE, idieresis: 0xEF, eth: 0xF0, ntilde: 0xF1, ograve: 0xF2,
  oacute: 0xF3, ocircumflex: 0xF4, otilde: 0xF5, odieresis: 0xF6, oslash: 0xF8,
  ugrave: 0xF9, uacute: 0xFA, ucircumflex: 0xFB, udieresis: 0xFC, yacute: 0xFD,
  thorn: 0xFE, ydieresis: 0xFF,
  quoteleft: 0x2018, quoteright: 0x2019, quotedblleft: 0x201C,
  quotedblright: 0x201D, quotesinglbase: 0x201A, quotedblbase: 0x201E,
  bullet: 0x2022, endash: 0x2013, emdash: 0x2014, ellipsis: 0x2026,
  dagger: 0x2020, daggerdbl: 0x2021, guilsinglleft: 0x2039,
  guilsinglright: 0x203A, perthousand: 0x2030, trademark: 0x2122,
  florin: 0x0192, fraction: 0x2044, Euro: 0x20AC, minus: 0x2212,
  Scaron: 0x0160, scaron: 0x0161, Zcaron: 0x017D, zcaron: 0x017E,
  OE: 0x0152, oe: 0x0153, Ydieresis: 0x0178, dotlessi: 0x0131,
  circumflex: 0x02C6, tilde: 0x02DC, breve: 0x02D8, dotaccent: 0x02D9,
  ring: 0x02DA, ogonek: 0x02DB, hungarumlaut: 0x02DD, caron: 0x02C7,
  softhyphen: 0xAD, nbspace: 0xA0,
};

export function glyphNameToUnicode(name) {
  if (!name) return undefined;
  if (name.length === 1) return name; // AGL: 'A' → 'A'
  if (Object.prototype.hasOwnProperty.call(GLYPH_NAMES, name)) {
    return String.fromCodePoint(GLYPH_NAMES[name]);
  }
  let m = /^uni([0-9A-Fa-f]{4})$/.exec(name);
  if (m) return String.fromCharCode(parseInt(m[1], 16));
  m = /^u([0-9A-Fa-f]{4,6})$/.exec(name);
  if (m) {
    const cp = parseInt(m[1], 16);
    if (cp <= 0x10FFFF) return String.fromCodePoint(cp);
  }
  return undefined;
}

// Bouwt een code→Unicode-map voor een simpel font uit een basiscodering plus
// een /Differences-array ([num, naam, naam, ..., num, naam, ...]).
// baseName: 'WinAnsiEncoding' | 'MacRomanEncoding' | 'StandardEncoding' | ''.
// Alleen WinAnsi wordt volledig ondersteund; andere basen vallen terug op
// WinAnsi voor het ASCII-bereik (voldoende voor match-doeleinden is dat NIET
// altijd — de aanroeper mag het resultaat als 'onzeker' behandelen).
export function buildSimpleEncodingMap(baseName, differences) {
  const m = winAnsiMap();
  const certain = !baseName || baseName === 'WinAnsiEncoding';
  if (Array.isArray(differences)) {
    let code = 0;
    for (const item of differences) {
      if (typeof item === 'number') { code = item; continue; }
      const u = glyphNameToUnicode(String(item));
      if (u !== undefined) m.set(code, u);
      else m.delete(code); // onbekende glyfnaam → code niet decodeerbaar
      code++;
    }
  }
  return { map: m, certain };
}

// Parseert een ToUnicode-CMap (latin1-string) naar { map, codeBytes }.
// map: code(int) → Unicode-string; codeBytes: bytes per code (1 of 2),
// afgeleid uit de codespacerange of de bfchar/bfrange-bronlengtes.
export function parseToUnicodeCMap(src) {
  const map = new Map();
  let codeBytes = 0;
  const hexRe = /<([0-9A-Fa-f]*)>/g;

  const hexToInt = (h) => parseInt(h, 16);
  const hexToUnicode = (h) => {
    // UTF-16BE-hex → string
    let out = '';
    const units = [];
    for (let i = 0; i + 4 <= h.length; i += 4) units.push(parseInt(h.slice(i, i + 4), 16));
    for (let i = 0; i < units.length; i++) {
      out += String.fromCharCode(units[i]);
    }
    return out;
  };
  const noteLen = (h) => {
    const b = Math.max(1, Math.ceil(h.length / 2));
    if (!codeBytes) codeBytes = b;
  };

  // codespacerange bepaalt de codebytes het meest betrouwbaar
  const csr = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(src);
  if (csr) {
    const h = /<([0-9A-Fa-f]*)>/.exec(csr[1]);
    if (h) codeBytes = Math.max(1, Math.ceil(h[1].length / 2));
  }

  const charBlocks = src.split('beginbfchar');
  for (let bi = 1; bi < charBlocks.length; bi++) {
    const body = charBlocks[bi].split('endbfchar')[0];
    hexRe.lastIndex = 0;
    const hexes = [];
    let m;
    while ((m = hexRe.exec(body))) hexes.push(m[1]);
    for (let k = 0; k + 1 < hexes.length; k += 2) {
      noteLen(hexes[k]);
      map.set(hexToInt(hexes[k]), hexToUnicode(hexes[k + 1]));
    }
  }

  const rangeBlocks = src.split('beginbfrange');
  for (let bi = 1; bi < rangeBlocks.length; bi++) {
    const body = rangeBlocks[bi].split('endbfrange')[0];
    // twee vormen: <lo> <hi> <dst>  en  <lo> <hi> [ <d1> <d2> ... ]
    const re = /<([0-9A-Fa-f]*)>\s*<([0-9A-Fa-f]*)>\s*(\[([^\]]*)\]|<([0-9A-Fa-f]*)>)/g;
    let m;
    while ((m = re.exec(body))) {
      const lo = hexToInt(m[1]);
      const hi = hexToInt(m[2]);
      noteLen(m[1]);
      if (m[4] !== undefined) { // arrayvorm
        const dsts = [];
        const r2 = /<([0-9A-Fa-f]*)>/g;
        let m2;
        while ((m2 = r2.exec(m[4]))) dsts.push(m2[1]);
        for (let c = lo, k = 0; c <= hi && k < dsts.length; c++, k++) {
          map.set(c, hexToUnicode(dsts[k]));
        }
      } else {
        const base = m[5];
        // oplopende bestemming: laatste 16-bit-eenheid telt op
        const prefix = base.slice(0, Math.max(0, base.length - 4));
        const last = parseInt(base.slice(-4) || '0', 16);
        for (let c = lo; c <= hi && c - lo <= 0xFFFF; c++) {
          map.set(c, hexToUnicode(prefix + (last + (c - lo)).toString(16).padStart(4, '0')));
        }
      }
    }
  }
  return { map, codeBytes: codeBytes || 1 };
}

// Keert een code→Unicode-map om naar Unicode→code. Alleen 1-teken-waarden;
// bij dubbelen wint de laagste code (stabiel en meestal de 'gewone' glyf).
export function invertUnicodeMap(map) {
  const inv = new Map();
  for (const [code, u] of map) {
    if (typeof u !== 'string' || [...u].length !== 1) continue;
    const cur = inv.get(u);
    if (cur === undefined || code < cur) inv.set(u, code);
  }
  return inv;
}

// Decodeert de strings van een show-op naar Unicode-tekst.
// fontInfo: { bytesPerCode, map } — map: code → Unicode-string.
// Retour: { text, codes, ok } — ok=false zodra een code geen mapping heeft.
export function decodeShowOpText(op, fontInfo) {
  if (!fontInfo || !fontInfo.map) return { text: '', codes: [], ok: false };
  const { bytesPerCode, map } = fontInfo;
  let text = '';
  const codes = [];
  let ok = true;
  for (const bytes of op.strings) {
    if (bytesPerCode === 2) {
      for (let i = 0; i + 1 < bytes.length; i += 2) {
        const code = (bytes[i] << 8) | bytes[i + 1];
        codes.push(code);
        const u = map.get(code);
        if (u === undefined) { ok = false; text += '�'; }
        else text += u;
      }
      if (bytes.length % 2 === 1) ok = false;
    } else {
      for (const b of bytes) {
        codes.push(b);
        const u = map.get(b);
        if (u === undefined) { ok = false; text += '�'; }
        else text += u;
      }
    }
  }
  return { text, codes, ok };
}

// ── Matching ──

const stripWs = (s) => String(s || '').replace(/\s+/g, '');

function angleClose(a, b, tol = 2.5) {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d <= tol;
}

// Zoekt per edit-regel het unieke venster van show-ops dat die regel vormt.
//
// ops: interpretatie-resultaat, verrijkt met .text (Unicode) en .ok per op.
// lines: [{ x, y, text, fontSize, angle }] — verwachte regels (user-space-
//        anker = start van de baseline, tekst = ruwe regeltekst).
// Retour: { ok, lineMatches } — lineMatches[i] = array van op-indices of
//         null; ok=true alleen als ALLE niet-lege regels uniek matchen.
export function matchEditLines(ops, lines, opts = {}) {
  const lineMatches = [];
  let allOk = true;

  for (const line of lines) {
    const target = stripWs(line.text);
    if (!target) { lineMatches.push([]); continue; }
    const fs = Number(line.fontSize) > 0 ? Number(line.fontSize) : 10;
    const rad = ((Number(line.angle) || 0) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const u = (p) => p.x * cos + p.y * sin;
    const v = (p) => -p.x * sin + p.y * cos;
    const lineU = u(line);
    const lineV = v(line);
    const perpTol = opts.perpTol ?? Math.max(1.5, fs * 0.45);
    const uTol = opts.uTol ?? Math.max(2.5, fs * 1.6);

    // kandidaten op dezelfde baseline, in streamvolgorde (== leesvolgorde)
    const cands = [];
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      if (!Number.isFinite(op.x) || !Number.isFinite(op.y)) continue;
      if (!angleClose(op.angle, Number(line.angle) || 0)) continue;
      if (Math.abs(v(op) - lineV) > perpTol) continue;
      cands.push(i);
    }
    cands.sort((a, b) => (ops[a].si - ops[b].si) || (ops[a].s - ops[b].s));

    // vensters zoeken: aaneengesloten kandidaten waarvan de tekst exact de
    // regeltekst vormt (witruimte-ongevoelig), beginnend op het regel-anker
    const windows = [];
    for (let i = 0; i < cands.length; i++) {
      const first = ops[cands[i]];
      if (!first.posExact) continue;
      if (Math.abs(u(first) - lineU) > uTol) continue;
      let acc = '';
      const win = [];
      let valid = true;
      for (let j = i; j < cands.length; j++) {
        const op = ops[cands[j]];
        if (!op.ok && stripWs(op.text) !== '') { valid = false; break; }
        acc += stripWs(op.text);
        win.push(cands[j]);
        if (!target.startsWith(acc)) { valid = false; break; }
        if (acc === target) break;
      }
      if (valid && acc === target) windows.push(win);
    }

    // identieke vensters ontdubbelen (kan niet ontstaan door posExact-eis,
    // maar wees defensief), daarna uniciteit eisen
    const uniq = [];
    for (const w of windows) {
      if (!uniq.some(w2 => w2.length === w.length && w2.every((x, k) => x === w[k]))) uniq.push(w);
    }
    if (uniq.length === 1) {
      lineMatches.push(uniq[0]);
    } else {
      lineMatches.push(null);
      allOk = false;
    }
  }
  return { ok: allOk, lineMatches };
}

// ── Veiligheid: chain-regel ──
// Binnen één chain (reeks show-ops zonder herpositionering ertussen) hangt
// elke op af van de advance van zijn voorgangers. Verwijderen is alleen
// veilig als na de eerste verwijderde op van een chain ook ALLE volgende ops
// van die chain verwijderd worden.
export function checkChainSafety(ops, removeSet) {
  const byChain = new Map();
  for (let i = 0; i < ops.length; i++) {
    const c = ops[i].chain;
    if (!byChain.has(c)) byChain.set(c, []);
    byChain.get(c).push(i);
  }
  for (const members of byChain.values()) {
    members.sort((a, b) => (ops[a].si - ops[b].si) || (ops[a].s - ops[b].s));
    let removing = false;
    for (const i of members) {
      if (removeSet.has(i)) removing = true;
      else if (removing) return { safe: false, offending: i };
    }
  }
  return { safe: true, offending: -1 };
}

// ── Splices ──

const fmtNum = (n) => {
  const r = Math.round(n * 10000) / 10000;
  return Number.isInteger(r) ? String(r) : String(r);
};

// Bouwt vervang-instructies voor de te verwijderen ops. De neveneffecten van
// ' (T*) en " (Tw/Tc/T*) blijven behouden zodat de tekst-state voor de rest
// van het blok intact blijft.
export function planSplices(ops, removeIndices) {
  return [...removeIndices].map(i => {
    const o = ops[i];
    let replacement = ' ';
    if (o.op === "'") replacement = ' T* ';
    else if (o.op === '"') {
      replacement = ` ${fmtNum(o.sideEffect?.aw ?? 0)} Tw ${fmtNum(o.sideEffect?.ac ?? 0)} Tc T* `;
    }
    return { si: o.si, start: o.s, end: o.e, replacement };
  });
}

// Past splices toe op één stream (latin1-string). Splices mogen niet
// overlappen; ze worden aflopend gesorteerd toegepast.
export function applySplices(src, splices) {
  const sorted = [...splices].sort((a, b) => b.start - a.start);
  let out = src;
  let prevStart = Infinity;
  for (const sp of sorted) {
    if (sp.end > prevStart) throw new Error('overlappende splices');
    out = out.slice(0, sp.start) + sp.replacement + out.slice(sp.end);
    prevStart = sp.start;
  }
  return out;
}

// ── Her-encodering (nieuwe tekst in het originele font) ──

// Codeert tekst naar font-codes via de omgekeerde Unicode-map.
// subset-fonts (BaseFont 'ABCDEF+…') mogen alleen codes gebruiken die al in
// het document voorkwamen (usedCodes) — een subset mist de overige glyfen.
// Retour: array van codes of null wanneer een teken niet codeerbaar is.
export function encodeTextToCodes(text, inverse, { subset = false, usedCodes = null } = {}) {
  const codes = [];
  for (const ch of String(text ?? '')) {
    let c = inverse.get(ch);
    if (c === undefined && ch === ' ') c = inverse.get(' ');
    if (c === undefined && ch === '\t') c = inverse.get(' ');
    if (c === undefined) return null;
    if (subset && usedCodes && !usedCodes.has(c)) return null;
    codes.push(c);
  }
  return codes;
}

export function codesToHexString(codes, bytesPerCode) {
  const width = bytesPerCode === 2 ? 4 : 2;
  return codes.map(c => c.toString(16).toUpperCase().padStart(width, '0')).join('');
}

// Herkent subset-fontnamen ('ABCDEF+Naam').
export function isSubsetFontName(baseFont) {
  return /^[A-Z]{6}\+/.test(String(baseFont || '').replace(/^\//, ''));
}

// ── Fontfamilie-analyse (fase B: opmaak in originele families) ──

// Leidt uit een BaseFont-naam de familie plus vet/cursief-vlaggen af.
// 'BCDEEE+Calibri-Light' → { family: 'calibri', bold: false, italic: false }
// 'Arial-BoldMT'         → { family: 'arial',   bold: true,  italic: false }
// De familie is genormaliseerd (kleine letters, zonder gewicht/stijl/suffix)
// zodat varianten van dezelfde familie op elkaar matchen.
export function fontVariantFromBaseName(baseFont) {
  let n = String(baseFont || '').replace(/^\//, '').replace(/^[A-Z]{6}\+/, '');
  // Producenten plakken soms een '*' of numeriek subset-id aan de naam.
  n = n.replace(/^\*/, '').replace(/-\d+$/, '');
  const lower = n.toLowerCase();
  const bold = /bold|black|heavy/.test(lower);
  const italic = /italic|oblique/.test(lower);
  const family = lower
    .replace(/(bold|black|heavy|italic|oblique|regular|roman|light|medium|semibold|demibold|condensed|narrow|book)/g, '')
    .replace(/[^a-z0-9]/g, '')
    .replace(/(mt|ps|std|pro)+$/, '');
  return { family, bold, italic };
}

// ── Breedtes (fase B: breedte-bewuste plaatsing) ──

// Parseert een /W-array van een CIDFont (als geneste JS-array van getallen
// en arrays) naar Map<cid, width>. Twee vormen:
//   c [w1 w2 ...]  — vanaf cid c de opeenvolgende breedtes
//   c1 c2 w        — alle cids in [c1..c2] krijgen breedte w
export function parseWArray(arr) {
  const m = new Map();
  if (!Array.isArray(arr)) return m;
  let i = 0;
  while (i < arr.length) {
    const a = arr[i];
    if (typeof a !== 'number') { i++; continue; }
    const b = arr[i + 1];
    if (Array.isArray(b)) {
      for (let k = 0; k < b.length; k++) {
        if (typeof b[k] === 'number') m.set(a + k, b[k]);
      }
      i += 2;
    } else if (typeof b === 'number' && typeof arr[i + 2] === 'number') {
      for (let c = a; c <= b && c - a <= 0xFFFF; c++) m.set(c, arr[i + 2]);
      i += 3;
    } else {
      i += 2;
    }
  }
  return m;
}

// Breedte (pt) van een reeks codes in de tekst-state van de originele run.
// widthOf(code) geeft de glyfbreedte in 1000-units (of undefined);
// missing wordt gebruikt voor codes zonder breedte. Tw geldt volgens de
// spec alleen voor byte 32 in 1-byte-coderingen.
export function computeRunWidth(codes, widthOf, {
  size = 12, tc = 0, tw = 0, tz = 100, bytesPerCode = 1, missing = 500,
} = {}) {
  let total = 0;
  for (const code of codes) {
    const w = widthOf ? widthOf(code) : undefined;
    total += ((w === undefined ? missing : w) / 1000) * size + tc;
    if (bytesPerCode === 1 && code === 32) total += tw;
  }
  return total * (tz / 100);
}
