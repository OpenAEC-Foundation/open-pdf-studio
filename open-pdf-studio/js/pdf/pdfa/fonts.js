// Fonts voor PDF/A (#379): is een font ingebed, kloppen zijn /Widths met het
// fontprogramma, en een niet-ingebed simpel font vervangen door een ingebed
// TrueType-font.
//
// Inbedden gebeurt met Liberation Sans (SIL Open Font License), dat met
// PDF.js wordt meegeleverd in pdfjs/web/standard_fonts/. Het is
// maatvast met Helvetica en Arial: tekst in die fonts houdt dezelfde
// breedte. Andere niet-ingebedde fonts (Times, Courier, systeemfonts) krijgen
// hetzelfde font met de breedtes van Liberation Sans; de conversie meldt dat
// als vervanging. Symbool-fonts (Symbol, ZapfDingbats) en samengestelde
// fonts zonder programma zijn zo niet te redden: die pagina's gaan naar de
// rasterstap van de conversie.

import { PDFName, PDFDict, PDFArray, PDFNumber, PDFStream } from 'pdf-lib';
import { Encodings } from '@pdf-lib/standard-fonts';
import { glyphNameToUnicode, parseWArray } from '../../text/content-stream-text.js';
import { N, zoek, haal, naam, getal, decodeer } from './doorloop.js';

// ── Coderingen: code → glyfnaam ───────────────────────────────────────────

let winAnsi = null;
/** WinAnsiEncoding: code → glyfnaam. */
export function winAnsiNamen() {
  if (!winAnsi) {
    winAnsi = new Map();
    const m = Encodings.WinAnsi.unicodeMappings;
    for (const cp of Object.keys(m)) {
      const [code, nm] = m[cp];
      if (!winAnsi.has(code)) winAnsi.set(code, nm);
    }
  }
  return winAnsi;
}

const STANDAARD_HOOG = {
  161: 'exclamdown', 162: 'cent', 163: 'sterling', 164: 'fraction', 165: 'yen', 166: 'florin',
  167: 'section', 168: 'currency', 169: 'quotesingle', 170: 'quotedblleft', 171: 'guillemotleft',
  172: 'guilsinglleft', 173: 'guilsinglright', 174: 'fi', 175: 'fl', 177: 'endash', 178: 'dagger',
  179: 'daggerdbl', 180: 'periodcentered', 182: 'paragraph', 183: 'bullet', 184: 'quotesinglbase',
  185: 'quotedblbase', 186: 'quotedblright', 187: 'guillemotright', 188: 'ellipsis', 189: 'perthousand',
  191: 'questiondown', 193: 'grave', 194: 'acute', 195: 'circumflex', 196: 'tilde', 197: 'macron',
  198: 'breve', 199: 'dotaccent', 200: 'dieresis', 202: 'ring', 203: 'cedilla', 205: 'hungarumlaut',
  206: 'ogonek', 207: 'caron', 208: 'emdash', 225: 'AE', 227: 'ordfeminine', 232: 'Lslash',
  233: 'Oslash', 234: 'OE', 235: 'ordmasculine', 241: 'ae', 245: 'dotlessi', 248: 'lslash',
  249: 'oslash', 250: 'oe', 251: 'germandbls',
};

let standaard = null;
/** StandardEncoding (de ingebouwde codering van de Latijnse standaardfonts). */
export function standaardNamen() {
  if (!standaard) {
    standaard = new Map();
    const w = winAnsiNamen();
    for (let c = 32; c <= 126; c++) standaard.set(c, w.get(c));
    standaard.set(39, 'quoteright');
    standaard.set(96, 'quoteleft');
    for (const [c, nm] of Object.entries(STANDAARD_HOOG)) standaard.set(Number(c), nm);
  }
  return standaard;
}

const EXTRA_UNICODE = { fi: 0xFB01, fl: 0xFB02, Lslash: 0x141, lslash: 0x142, quotesingle: 0x27, grave: 0x60 };

/** Glyfnaam → Unicode-codepunt (of undefined). */
export function unicodeVanNaam(nm) {
  if (Object.prototype.hasOwnProperty.call(EXTRA_UNICODE, nm)) return EXTRA_UNICODE[nm];
  const u = glyphNameToUnicode(nm);
  return u === undefined ? undefined : u.codePointAt(0);
}

/**
 * De codering van een simpel font: code → glyfnaam.
 * @returns {{ namen: Map<number,string>, basis: string, zeker: boolean }}
 *   basis: de basiscodering ('WinAnsiEncoding', 'MacRomanEncoding',
 *   'StandardEncoding' of '' = ingebouwd); zeker = false als de basis niet
 *   volledig bekend is (MacRoman boven ASCII).
 */
export function codering(pdf, fontDict, ingebouwd = 'StandardEncoding') {
  const enc = haal(pdf, fontDict, 'Encoding');
  let basis = '';
  let verschillen = null;
  if (enc instanceof PDFName) basis = naam(enc);
  else if (enc instanceof PDFDict) {
    basis = naam(haal(pdf, enc, 'BaseEncoding'));
    const d = haal(pdf, enc, 'Differences');
    if (d instanceof PDFArray) verschillen = d.asArray().map((x) => zoek(pdf, x));
  }
  const gekozen = basis || ingebouwd;
  let namen;
  let zeker = true;
  if (gekozen === 'WinAnsiEncoding') namen = new Map(winAnsiNamen());
  else if (gekozen === 'MacRomanEncoding') {
    namen = new Map();
    const w = winAnsiNamen();
    for (let c = 32; c <= 126; c++) namen.set(c, w.get(c));
    zeker = false;
  } else namen = new Map(standaardNamen());
  if (verschillen) {
    let code = 0;
    for (const x of verschillen) {
      if (x instanceof PDFNumber) code = x.asNumber();
      else if (x instanceof PDFName) { namen.set(code, naam(x)); code++; }
    }
  }
  return { namen, basis, zeker };
}

// ── Fontinformatie ────────────────────────────────────────────────────────

const PROGRAMMA_SLEUTELS = ['FontFile', 'FontFile2', 'FontFile3'];

/**
 * @returns {{ subtype: string, baseFont: string, samengesteld: boolean, descendant: PDFDict|null,
 *   descriptor: PDFDict|null, programma: { sleutel: string, stream: PDFStream, subtype: string }|null }}
 */
export function fontInfo(pdf, fontDict) {
  const subtype = naam(haal(pdf, fontDict, 'Subtype'));
  const samengesteld = subtype === 'Type0';
  let descendant = null;
  if (samengesteld) {
    const d = haal(pdf, fontDict, 'DescendantFonts');
    const x = d instanceof PDFArray ? zoek(pdf, d.get(0)) : null;
    descendant = x instanceof PDFDict ? x : null;
  }
  const bron = descendant || fontDict;
  const descriptor = haal(pdf, bron, 'FontDescriptor');
  let programma = null;
  if (descriptor instanceof PDFDict) {
    for (const k of PROGRAMMA_SLEUTELS) {
      const s = haal(pdf, descriptor, k);
      if (s instanceof PDFStream) { programma = { sleutel: k, stream: s, subtype: naam(haal(pdf, s, 'Subtype')) }; break; }
    }
  }
  return {
    subtype,
    baseFont: naam(haal(pdf, fontDict, 'BaseFont')),
    samengesteld,
    descendant,
    descriptor: descriptor instanceof PDFDict ? descriptor : null,
    programma,
  };
}

/** Zit het fontprogramma in het bestand? Type3-fonts hebben er geen nodig. */
export function isIngebed(pdf, fontDict) {
  const info = fontInfo(pdf, fontDict);
  return info.subtype === 'Type3' || !!info.programma;
}

/** Codes uit getoonde strings: één byte, of twee bij Identity-H/V. null = onbekende CMap. */
export function codesUit(pdf, fontDict, strings) {
  const info = fontInfo(pdf, fontDict);
  const codes = new Set();
  if (!info.samengesteld) {
    for (const s of strings) for (const b of s) codes.add(b);
    return codes;
  }
  const enc = naam(haal(pdf, fontDict, 'Encoding'));
  if (enc !== 'Identity-H' && enc !== 'Identity-V') return null;
  for (const s of strings) for (let i = 0; i + 1 < s.length; i += 2) codes.add((s[i] << 8) | s[i + 1]);
  return codes;
}

/** Fontkit-font uit een ingebed TrueType/OpenType-programma, of null. */
function parseProgramma(fontkit, info) {
  if (!info.programma) return null;
  const { sleutel, subtype } = info.programma;
  if (sleutel !== 'FontFile2' && !(sleutel === 'FontFile3' && subtype === 'OpenType')) return null;
  const bytes = decodeer(info.programma.stream);
  if (!bytes) return null;
  try {
    const f = fontkit.create(bytes);
    return f && f.unitsPerEm ? f : null;
  } catch { return null; }
}

const isSymbolisch = (pdf, info) => ((getal(haal(pdf, info.descriptor, 'Flags')) || 0) & 4) !== 0;

/** De glyf van een code in een simpel TrueType-font (of null als hij niet te vinden is). */
function glyfVoorCode(f, code, cod, symbolisch) {
  const probeer = (cp) => {
    try {
      const g = f.glyphForCodePoint(cp);
      return g && g.id ? g : null;
    } catch { return null; }
  };
  if (symbolisch && !cod.basis) return probeer(0xF000 + code) || probeer(code);
  const nm = cod.namen.get(code);
  const u = nm ? unicodeVanNaam(nm) : undefined;
  return u !== undefined ? probeer(u) : null;
}

const breedteVan = (f, g) => (g.advanceWidth * 1000) / f.unitsPerEm;

/**
 * Codes waarvan de breedte in de fontdictionary afwijkt van het ingebedde
 * programma (meer dan 1 eenheid, zoals PDF/A-validators toestaan).
 * @param {Set<number>|null} codes de gebruikte codes; null = alle
 * @returns {null | Array<{ code: number, pdf: number, programma: number }>}
 *   null als het niet te controleren is (Type1/CFF-programma, onbekende codering)
 */
export function breedteAfwijkingen(pdf, fontDict, fontkit, codes = null) {
  const info = fontInfo(pdf, fontDict);
  const f = parseProgramma(fontkit, info);
  if (!f) return null;
  const uit = [];
  if (!info.samengesteld) {
    if (info.subtype !== 'TrueType') return null;
    const eerste = getal(haal(pdf, fontDict, 'FirstChar'));
    const breedtes = haal(pdf, fontDict, 'Widths');
    if (!(breedtes instanceof PDFArray) || eerste === undefined) return null;
    const cod = codering(pdf, fontDict, '');
    const symbolisch = isSymbolisch(pdf, info);
    const lijst = codes ? [...codes] : breedtes.asArray().map((_, i) => eerste + i);
    for (const code of lijst) {
      const i = code - eerste;
      if (i < 0 || i >= breedtes.size()) continue;
      if (!cod.zeker && code > 126) continue;
      const g = glyfVoorCode(f, code, cod, symbolisch);
      if (!g) continue;
      const w = getal(zoek(pdf, breedtes.get(i))) ?? 0;
      const p = breedteVan(f, g);
      if (Math.abs(w - p) > 1) uit.push({ code, pdf: w, programma: Math.round(p) });
    }
    return uit;
  }
  if (naam(haal(pdf, info.descendant, 'Subtype')) !== 'CIDFontType2') return null;
  const map = haal(pdf, info.descendant, 'CIDToGIDMap');
  let cidNaarGid = (cid) => cid;
  if (map instanceof PDFStream) {
    const b = decodeer(map);
    if (!b) return null;
    cidNaarGid = (cid) => (cid * 2 + 1 < b.length ? (b[cid * 2] << 8) | b[cid * 2 + 1] : 0);
  } else if (naam(map) !== 'Identity') return null;
  const dw = getal(haal(pdf, info.descendant, 'DW')) ?? 1000;
  const w = haal(pdf, info.descendant, 'W');
  const breedtes = parseWArray(w instanceof PDFArray ? naarJs(pdf, w) : []);
  const lijst = codes ? [...codes] : [...breedtes.keys()];
  for (const cid of lijst) {
    const gid = cidNaarGid(cid);
    if (!gid || gid >= f.numGlyphs) continue;
    let g;
    try { g = f.getGlyph(gid); } catch { continue; }
    const p = breedteVan(f, g);
    const v = breedtes.has(cid) ? breedtes.get(cid) : dw;
    if (Math.abs(v - p) > 1) uit.push({ code: cid, pdf: v, programma: Math.round(p) });
  }
  return uit;
}

function naarJs(pdf, arr) {
  return arr.asArray().map((x) => {
    const v = zoek(pdf, x);
    if (v instanceof PDFNumber) return v.asNumber();
    if (v instanceof PDFArray) return naarJs(pdf, v);
    return null;
  });
}

/**
 * Zet /Widths (simpel TrueType) of /W (CIDFontType2) gelijk aan het
 * ingebedde programma. Geeft true als er iets veranderde.
 */
export function herstelBreedtes(pdf, fontDict, fontkit) {
  const afwijkend = breedteAfwijkingen(pdf, fontDict, fontkit, null);
  if (!afwijkend || !afwijkend.length) {
    // Een CID-font kan gebruikte CIDs zonder W-regel hebben (DW geldt dan);
    // die vangt de tweede ronde hieronder niet. Zie schrijfCidBreedtes.
    return false;
  }
  const info = fontInfo(pdf, fontDict);
  if (!info.samengesteld) {
    const eerste = getal(haal(pdf, fontDict, 'FirstChar'));
    const breedtes = haal(pdf, fontDict, 'Widths');
    for (const a of afwijkend) breedtes.set(a.code - eerste, PDFNumber.of(a.programma));
    return true;
  }
  return schrijfCidBreedtes(pdf, fontDict, fontkit);
}

/** Herschrijft /W van een CIDFontType2 met Identity-mapping uit het programma. */
export function schrijfCidBreedtes(pdf, fontDict, fontkit, codes = null) {
  const info = fontInfo(pdf, fontDict);
  const f = parseProgramma(fontkit, info);
  if (!f || !info.descendant) return false;
  const map = haal(pdf, info.descendant, 'CIDToGIDMap');
  if (map instanceof PDFStream || (map !== undefined && naam(map) !== 'Identity')) return false;
  const oud = haal(pdf, info.descendant, 'W');
  const bekend = parseWArray(oud instanceof PDFArray ? naarJs(pdf, oud) : []);
  const cids = new Set([...bekend.keys(), ...(codes || [])]);
  const lijst = [...cids].filter((c) => c > 0 && c < f.numGlyphs).sort((a, b) => a - b);
  const items = [];
  for (const cid of lijst) {
    let p = 0;
    try { p = Math.round(breedteVan(f, f.getGlyph(cid))); } catch { /* lege glyf */ }
    items.push(cid, [p]);
  }
  info.descendant.set(N('W'), pdf.context.obj(items));
  if (map === undefined) info.descendant.set(N('CIDToGIDMap'), N('Identity'));
  return true;
}

// ── Vervangen door Liberation Sans ─────────────────────────────────────────

/** De Liberation-variant voor een fontnaam en descriptorvlaggen. */
export function variantVoor(baseFont, vlaggen = 0, gewicht = 0) {
  const n = String(baseFont || '').replace(/^[A-Z]{6}\+/, '');
  const vet = /bold|black|heavy|semibold|demi/i.test(n) || gewicht >= 600;
  const cursief = /italic|oblique|kursiv/i.test(n) || (vlaggen & 64) !== 0;
  return vet && cursief ? 'BoldItalic' : vet ? 'Bold' : cursief ? 'Italic' : 'Regular';
}

/** Bestandsnaam van de variant in pdfjs/web/standard_fonts/. */
export const LIBERATION_BESTAND = Object.freeze({
  Regular: 'LiberationSans-Regular.ttf',
  Bold: 'LiberationSans-Bold.ttf',
  Italic: 'LiberationSans-Italic.ttf',
  BoldItalic: 'LiberationSans-BoldItalic.ttf',
});

/** Is Liberation Sans voor dit font maatvast (Helvetica/Arial-familie)? */
export function isMaatvast(baseFont) {
  return /helvetica|arial|liberation ?sans|nimbus ?sans|arimo/i.test(String(baseFont || ''));
}

/** Kan dit niet-ingebedde font vervangen worden? (simpel, niet-symbolisch) */
export function isVervangbaar(pdf, fontDict) {
  const info = fontInfo(pdf, fontDict);
  if (info.samengesteld || info.subtype === 'Type3' || info.programma) return false;
  if (!['Type1', 'TrueType', 'MMType1'].includes(info.subtype)) return false;
  const n = info.baseFont.replace(/^[A-Z]{6}\+/, '');
  if (/^(Symbol|ZapfDingbats|Wingdings|Webdings|Dingbats)/i.test(n)) return false;
  // Symbolisch zonder eigen codering: de codes betekenen alleen iets voor
  // dat ene fontprogramma.
  const symbolisch = info.descriptor && ((getal(haal(pdf, info.descriptor, 'Flags')) || 0) & 4) !== 0;
  if (symbolisch && !haal(pdf, fontDict, 'Encoding')) return false;
  return true;
}

/**
 * Herschrijft een niet-ingebed simpel font tot een ingebed TrueType-font met
 * Liberation Sans. De dict blijft hetzelfde object, zodat elke verwijzing
 * ernaar meegaat.
 * @param {(variant: string) => Promise<Uint8Array>} laadFont
 * @returns {Promise<{ variant: string, maatvast: boolean }>}
 */
export async function vervangDoorLiberation(pdf, fontDict, fontkit, laadFont, cache = new Map()) {
  const info = fontInfo(pdf, fontDict);
  const vlaggen = getal(haal(pdf, info.descriptor, 'Flags')) || 0;
  const gewicht = getal(haal(pdf, info.descriptor, 'FontWeight')) || 0;
  const variant = variantVoor(info.baseFont, vlaggen, gewicht);
  if (!cache.has(variant)) {
    cache.set(variant, (async () => {
      const bytes = await laadFont(variant);
      const f = fontkit.create(bytes);
      const stream = pdf.context.flateStream(bytes, { Length1: bytes.length });
      return { f, ref: pdf.context.register(stream) };
    })());
  }
  const { f, ref } = await cache.get(variant);

  // Codering: een Standard- of ingebouwde basis wordt WinAnsi plus de codes
  // waarin ze verschillen; WinAnsi/MacRoman blijven, Differences ook.
  const cod = codering(pdf, fontDict, 'StandardEncoding');
  const basis = cod.basis === 'MacRomanEncoding' ? 'MacRomanEncoding' : 'WinAnsiEncoding';
  const basisNamen = basis === 'WinAnsiEncoding' ? winAnsiNamen() : null;
  const verschillen = [];
  let laatste = -2;
  const codes = [...cod.namen.keys()].sort((a, b) => a - b);
  for (const code of codes) {
    const nm = cod.namen.get(code);
    if (basisNamen && basisNamen.get(code) === nm) continue;
    if (!basisNamen && code <= 126) continue;
    if (code !== laatste + 1) verschillen.push(code);
    verschillen.push(N(nm));
    laatste = code;
  }
  const encoding = verschillen.length
    ? pdf.context.obj({ Type: 'Encoding', BaseEncoding: basis, Differences: verschillen })
    : N(basis);

  const eerste = codes.length ? Math.min(...codes) : 32;
  const laatsteCode = codes.length ? Math.max(...codes) : 32;
  const breedtes = [];
  for (let c = eerste; c <= laatsteCode; c++) {
    const nm = cod.namen.get(c);
    const u = nm ? unicodeVanNaam(nm) : undefined;
    let g = null;
    try { g = u !== undefined ? f.glyphForCodePoint(u) : null; } catch { g = null; }
    breedtes.push(g && g.id ? Math.round(breedteVan(f, g)) : 0);
  }

  const schaal = 1000 / f.unitsPerEm;
  const vlaggenNieuw = 32 | (variant.includes('Italic') ? 64 : 0);
  const naamPs = f.postscriptName || `LiberationSans-${variant}`;
  const descriptor = pdf.context.obj({
    Type: 'FontDescriptor',
    FontName: naamPs,
    Flags: vlaggenNieuw,
    FontBBox: [f.bbox.minX, f.bbox.minY, f.bbox.maxX, f.bbox.maxY].map((v) => Math.round(v * schaal)),
    ItalicAngle: f.italicAngle || 0,
    Ascent: Math.round(f.ascent * schaal),
    Descent: Math.round(f.descent * schaal),
    CapHeight: Math.round((f.capHeight || f.ascent) * schaal),
    StemV: variant.includes('Bold') ? 140 : 80,
    FontFile2: ref,
  });

  for (const k of fontDict.keys()) fontDict.delete(k);
  fontDict.set(N('Type'), N('Font'));
  fontDict.set(N('Subtype'), N('TrueType'));
  fontDict.set(N('BaseFont'), N(naamPs));
  fontDict.set(N('FirstChar'), PDFNumber.of(eerste));
  fontDict.set(N('LastChar'), PDFNumber.of(laatsteCode));
  fontDict.set(N('Widths'), pdf.context.obj(breedtes));
  fontDict.set(N('Encoding'), encoding);
  fontDict.set(N('FontDescriptor'), pdf.context.register(descriptor));
  return { variant, maatvast: isMaatvast(info.baseFont) };
}

/** Is de codering van een niet-symbolisch TrueType-font toegestaan (WinAnsi/MacRoman)? */
export function trueTypeCoderingOk(pdf, fontDict) {
  const info = fontInfo(pdf, fontDict);
  if (info.subtype !== 'TrueType' || !info.programma) return true;
  if (isSymbolisch(pdf, info)) return true;
  const enc = haal(pdf, fontDict, 'Encoding');
  const basis = enc instanceof PDFName ? naam(enc) : enc instanceof PDFDict ? naam(haal(pdf, enc, 'BaseEncoding')) : '';
  return basis === 'WinAnsiEncoding' || basis === 'MacRomanEncoding';
}

/** Geeft een niet-symbolisch TrueType-font zonder geldige basiscodering WinAnsi. */
export function herstelTrueTypeCodering(pdf, fontDict) {
  const enc = haal(pdf, fontDict, 'Encoding');
  if (enc instanceof PDFDict) enc.set(N('BaseEncoding'), N('WinAnsiEncoding'));
  else fontDict.set(N('Encoding'), N('WinAnsiEncoding'));
}

