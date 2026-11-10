// Gemaakte PDF's voor de zoektekst-meting (10-zoektekst.mjs): tekst in alle
// vormen die het zoeken moet aankunnen, met de hand opgebouwd zodat elke
// operator vastligt (Tj/TJ met kerning, Tc/Tw, Ts, lettergrootte-wissels,
// gedraaide tekst, formulieren, CropBox, onzichtbare tekst) en fonts die
// niets hoeven in te bedden: standaardfonts (eigen metriek van beide
// tekstlezers) en CID-fonts met /W en /ToUnicode (ligaturen, Arabisch,
// Hebreeuws, CJK).

import { deflateSync } from 'node:zlib';

// ── Opbouw ──────────────────────────────────────────────────────────────────
class Bouwer {
  constructor() { this.objecten = []; }
  nieuw(inhoud = null) { this.objecten.push(inhoud); return this.objecten.length; }
  zet(nr, inhoud) { this.objecten[nr - 1] = inhoud; }
  stream(dict, data, comprimeer = false) {
    const ruw = Buffer.isBuffer(data) ? data : Buffer.from(data, 'latin1');
    const body = comprimeer ? deflateSync(ruw) : ruw;
    return this.nieuw(Buffer.concat([
      Buffer.from(`<< ${dict}${comprimeer ? ' /Filter /FlateDecode' : ''} /Length ${body.length} >>\nstream\n`, 'latin1'),
      body,
      Buffer.from('\nendstream', 'latin1'),
    ]));
  }
  pdf(root) {
    const delen = [Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    let lengte = delen[0].length;
    const offsets = [];
    this.objecten.forEach((o, i) => {
      offsets.push(lengte);
      const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), Buffer.isBuffer(o) ? o : Buffer.from(o, 'latin1'), Buffer.from('\nendobj\n', 'latin1')]);
      delen.push(b);
      lengte += b.length;
    });
    let xref = `xref\n0 ${this.objecten.length + 1}\n0000000000 65535 f\r\n`;
    for (const o of offsets) xref += `${String(o).padStart(10, '0')} 00000 n\r\n`;
    xref += `trailer\n<< /Size ${this.objecten.length + 1} /Root ${root} 0 R >>\nstartxref\n${lengte}\n%%EOF\n`;
    delen.push(Buffer.from(xref, 'latin1'));
    return Buffer.concat(delen);
  }
}

const hex4 = (n) => n.toString(16).padStart(4, '0').toUpperCase();
const utf16hex = (s) => [...s].map((c) => {
  const cp = c.codePointAt(0);
  if (cp < 0x10000) return hex4(cp);
  const v = cp - 0x10000;
  return hex4(0xd800 + (v >> 10)) + hex4(0xdc00 + (v & 0x3ff));
}).join('');

/**
 * CID-font (Type0, Identity-H/-V, niet ingebed). `glyphs`: [{ u, w }] —
 * `u` is de Unicode-tekst van de glyph (één of meer tekens, of een
 * presentatievorm), `w` de breedte in 1/1000 em. Geeft { naam-ref, enc }:
 * enc(sleutels) maakt een hex-string van glyph-sleutels.
 */
function cidFont(b, { baseFont, glyphs, vertical = false, dw = 1000 }) {
  const cmapRegels = glyphs.map((g, i) => `<${hex4(i + 1)}> <${utf16hex(g.u)}>`);
  const blokken = [];
  for (let i = 0; i < cmapRegels.length; i += 100) {
    const deel = cmapRegels.slice(i, i + 100);
    blokken.push(`${deel.length} beginbfchar\n${deel.join('\n')}\nendbfchar`);
  }
  const cmap = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (OPDS) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /OPDS-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${blokken.join('\n')}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
  const toUni = b.stream('', cmap);
  const w = `[1 [${glyphs.map((g) => g.w).join(' ')}]]`;
  const desc = b.nieuw(`<< /Type /FontDescriptor /FontName /${baseFont} /Flags 32 /FontBBox [-200 -300 1200 1000] /ItalicAngle 0 /Ascent 900 /Descent -250 /CapHeight 700 /StemV 80 >>`);
  const cid = b.nieuw(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${baseFont} /CIDSystemInfo << /Registry (OPDS) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${desc} 0 R /DW ${dw} /W ${w}${vertical ? ' /DW2 [880 -1000]' : ''} /CIDToGIDMap /Identity >>`);
  const font = b.nieuw(`<< /Type /Font /Subtype /Type0 /BaseFont /${baseFont} /Encoding /Identity-${vertical ? 'V' : 'H'} /DescendantFonts [${cid} 0 R] /ToUnicode ${toUni} 0 R >>`);
  const index = new Map(glyphs.map((g, i) => [g.u, i + 1]));
  const sleutels = [...index.keys()].sort((a, c) => c.length - a.length);
  // Tekst → hex van CID's, langste sleutel eerst (zodat "ffi" één glyph is).
  const enc = (tekst) => {
    let uit = '';
    for (let i = 0; i < tekst.length;) {
      const s = sleutels.find((k) => tekst.startsWith(k, i));
      if (!s) throw new Error(`geen glyph voor ${JSON.stringify(tekst.slice(i, i + 3))} in ${baseFont}`);
      uit += hex4(index.get(s));
      i += s.length;
    }
    return `<${uit}>`;
  };
  return { ref: font, enc };
}

// PDF-string met WinAnsi-codes (octale escapes voor alles buiten ASCII).
const winAnsi = new Map([['€', 0x80], ['‚', 0x82], ['œ', 0x9c], ['Œ', 0x8c], ['–', 0x96], ['—', 0x97], ['‘', 0x91], ['’', 0x92], ['“', 0x93], ['”', 0x94]]);
export function pdfStr(s) {
  let uit = '(';
  for (const c of s) {
    let code = winAnsi.get(c) ?? c.codePointAt(0);
    if (code > 255) throw new Error(`niet in WinAnsi: ${c}`);
    if (c === '(' || c === ')' || c === '\\') uit += `\\${c}`;
    else if (code < 32 || code > 126) uit += `\\${code.toString(8).padStart(3, '0')}`;
    else uit += c;
  }
  return `${uit})`;
}

const LATIJN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,-';

// ── Het pariteitsdocument ──────────────────────────────────────────────────
/**
 * Meerdere pagina's met elk één soort tekst. Geeft { pdf, paginas: [naam] }.
 */
export function maakPariteitsPdf() {
  const b = new Bouwer();
  const catalogus = b.nieuw();
  const paginasNr = b.nieuw();

  const helv = b.nieuw('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const helvB = b.nieuw('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const times = b.nieuw('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding << /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [1 /fi /fl] >> >>');
  const cour = b.nieuw('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>');

  // Ligaturen via ToUnicode: één glyph → meerdere tekens, en één glyph → U+FB01.
  const lig = cidFont(b, {
    baseFont: 'OPDSLigatures',
    glyphs: [...[...LATIJN].map((u) => ({ u, w: u === ' ' ? 250 : 520 })), { u: 'ffi', w: 820 }, { u: 'ff', w: 600 }, { u: 'ﬁ', w: 560 }, { u: 'ﬂ', w: 560 }, { u: 'st', w: 600 }],
  });
  // Arabisch: presentatievormen (zoals veel PDF-makers ze in /ToUnicode zetten)
  // en basisletters, beide in beeldvolgorde getekend.
  const arabischeTekens = ['ﻡ', 'ﻼ', 'ﺳ', 'ﺍ', 'ﻟ', 'ﻌ', 'ﺮ', 'ﺑ', 'ﻳ', 'ﺔ',
    'م', 'ا', 'ل', 'س', 'ع', 'ر', 'ب', 'ي', 'ة', 'ك', 'ت', 'ش', 'ף', 'ו', 'ל', 'ש', 'ם', 'ע', 'ב', 'ר', 'י', 'ת',
    '٠', '١', '٢', '٣', ' ', '1', '2', '3', '4', 'A', 'r', 'a', 'b', 'i', 'c', 'H', 'e', 'w', 'o', 'n', 't', 'x', '.', ':'];
  const arab = cidFont(b, { baseFont: 'OPDSArabic', glyphs: arabischeTekens.map((u) => ({ u, w: u === ' ' ? 260 : 480 })) });
  // CJK: Chinees, Japans (kana + kanji), Koreaans, en Latijn in dezelfde font.
  const cjkTekst = '日本語のテキスト検索中文搜索测试简体字한국어검색문서。、PDF文書ABCdef 123';
  const cjk = cidFont(b, { baseFont: 'OPDSCJK', glyphs: [...new Set([...cjkTekst])].map((u) => ({ u, w: /[\x20-\x7e]/.test(u) ? 500 : 1000 })) });
  const cjkV = cidFont(b, { baseFont: 'OPDSCJKV', glyphs: [...new Set([...cjkTekst])].map((u) => ({ u, w: 1000 })), vertical: true });

  const fonts = `/F1 ${helv} 0 R /F2 ${times} 0 R /F3 ${helvB} 0 R /F4 ${cour} 0 R /L1 ${lig.ref} 0 R /A1 ${arab.ref} 0 R /C1 ${cjk.ref} 0 R /C2 ${cjkV.ref} 0 R`;

  const paginaRefs = [];
  const namen = [];
  const pagina = (naam, inhoud, { mediabox = [0, 0, 612, 792], extra = '', xobjecten = '' } = {}) => {
    const s = b.stream('', inhoud);
    const p = b.nieuw(`<< /Type /Page /Parent ${paginasNr} 0 R /MediaBox [${mediabox.join(' ')}] /Contents ${s} 0 R /Resources << /Font << ${fonts} >>${xobjecten ? ` /XObject << ${xobjecten} >>` : ''} >> ${extra} >>`);
    paginaRefs.push(p);
    namen.push(naam);
  };
  const T = pdfStr;

  // 1. Latijn: spaties, kerning, Tc/Tw, diakrieten, afbreking, Ts, lettergroottes.
  pagina('latijn', [
    'BT /F1 12 Tf 72 740 Td',
    `${T('Hello world, this is a plain line of text.')} Tj`,
    `0 -18 Td ${T('Multiple   spaces   here and a trailing space ')} Tj`,
    `0 -18 Td [${T('Kerned')}-250${T('words')}-250${T('without')}-300${T('space')}-260${T('glyphs')}] TJ`,
    `0 -18 Td [${T('Tight')}-60${T('kern')} 40${T('ing')}] TJ`,
    `0 -18 Td [${T('Wide')}-2500${T('gap')}-900${T('here')}] TJ`,
    `0 -18 Td 2 Tc ${T('Char spaced text')} Tj 0 Tc`,
    `0 -18 Td 6 Tw ${T('Word spaced text here')} Tj 0 Tw`,
    `0 -18 Td ${T('Café Müller señor naïve Ångström façade œuvre Zürich')} Tj`,
    `0 -18 Td ${T('A long hyphen-')} Tj`,
    `0 -18 Td ${T('ated word and an en–dash and “quotes”')} Tj`,
    `0 -18 Td ${T('E = mc')} Tj 5 Ts /F1 8 Tf ${T('2')} Tj 0 Ts /F1 12 Tf ${T(' squared, H')} Tj -3 Ts /F1 8 Tf ${T('2')} Tj 0 Ts /F1 12 Tf ${T('O water')} Tj`,
    `0 -18 Td ${T('Mixed ')} Tj /F3 18 Tf ${T('Bold Sizes')} Tj /F1 12 Tf ${T(' on one line')} Tj`,
    `0 -18 Td ${T('Word words sword WORD Words')} Tj`,
    `0 -18 Td /F4 10 Tf ${T('Courier 2026-11-10 v1.2.3 a+b=c (x) [y]')} Tj`,
    'ET',
    `BT /F1 12 Tf 72 470 Td ${T('Two')} Tj ET BT /F1 12 Tf 98 470 Td ${T('separate')} Tj ET BT /F1 12 Tf 160 470 Td ${T('blocks')} Tj ET`,
    `BT /F1 12 Tf 72 450 Td ${T('Right column')} Tj 300 0 Td ${T('far away')} Tj ET`,
    `BT /F1 12 Tf 72 430 Td ${T('Backwards')} Tj -60 -1 Td ${T('overlap')} Tj ET`,
    `BT /F1 10 Tf 72 400 Td 14 TL ${T('Line one with leading')} Tj T* ${T('line two with leading')} Tj (line three via quote) ' ET`,
    `BT /F1 12 Tf 1.5 0 0 1.5 72 350 Tm ${T('Scaled text matrix')} Tj ET`,
    `q 0.5 0 0 0.5 0 0 cm BT /F1 24 Tf 144 640 Td ${T('Half scale ctm')} Tj ET Q`,
    `BT /F1 12 Tf 72 300 Td 150 Tz ${T('Horizontally scaled words')} Tj 0 -16 Td 70 Tz ${T('Condensed words here')} Tj 100 Tz ET`,
  ].join('\n'));

  // 2. Ligaturen.
  pagina('ligaturen', [
    `BT /F2 16 Tf 72 740 Td (\\001nal \\002ow of o\\001ce in\\002uence) Tj ET`,
    `BT /L1 16 Tf 72 710 Td ${lig.enc('o')}Tj ${lig.enc('ffi')}Tj ${lig.enc('ce st')}Tj ${lig.enc('a')}Tj ${lig.enc('ff')} Tj ${lig.enc(' and ')} Tj ${lig.enc('ﬁ')} Tj ${lig.enc('ne ')} Tj ${lig.enc('ﬂ')} Tj ${lig.enc('at')} Tj ET`,
    `BT /L1 16 Tf 72 680 Td ${lig.enc('Coffee affinity first flight')} Tj ET`,
  ].join('\n'));

  // 3. Rechts naar links: Arabisch (presentatievormen en basisletters),
  // Hebreeuws, gemengd met cijfers en Latijn. In beeldvolgorde getekend.
  const beeld = (s) => [...s].reverse().join('');
  pagina('rtl', [
    `BT /A1 18 Tf 72 740 Td ${arab.enc('ﻡﻼﺳ')} Tj ET`,
    `BT /A1 18 Tf 72 710 Td ${arab.enc(beeld('سلام عربي'))} Tj ET`,
    `BT /A1 18 Tf 72 680 Td ${arab.enc(beeld('شلام'))} Tj ${arab.enc(' ')} Tj ${arab.enc(beeld('كتاب'))} Tj ET`,
    `BT /A1 18 Tf 72 650 Td ${arab.enc(beeld('שלום עולם'))} Tj ET`,
    `BT /A1 18 Tf 72 620 Td ${arab.enc('Arabic ')} Tj ${arab.enc(beeld('عربي'))} Tj ${arab.enc(' 1234 text')} Tj ET`,
    `BT /A1 18 Tf 72 590 Td ${arab.enc(beeld('سلام') + ' ١٢٣ ' + beeld('عربي'))} Tj ET`,
    `BT /A1 18 Tf 72 560 Td [${arab.enc(beeld('سلام'))} -400 ${arab.enc(beeld('عربي'))}] TJ ET`,
  ].join('\n'));

  // 4. CJK horizontaal; daarna een pagina met ook verticaal schrift (Identity-V).
  pagina('cjk', [
    `BT /C1 14 Tf 72 740 Td ${cjk.enc('日本語のテキスト検索')} Tj ET`,
    `BT /C1 14 Tf 72 715 Td ${cjk.enc('中文搜索测试简体字')} Tj ET`,
    `BT /C1 14 Tf 72 690 Td ${cjk.enc('한국어 검색 문서')} Tj ET`,
    `BT /C1 14 Tf 72 665 Td ${cjk.enc('PDF文書ABCdef 123。')} Tj ET`,
    `BT /C1 14 Tf 72 640 Td [${cjk.enc('日本語')} -1000 ${cjk.enc('検索')}] TJ ET`,
  ].join('\n'));
  pagina('cjk-verticaal', [
    `BT /C1 14 Tf 72 740 Td ${cjk.enc('日本語のテキスト')} Tj ET`,
    `BT /C2 14 Tf 400 740 Td ${cjk.enc('日本語のテキスト')} Tj ET`,
  ].join('\n'));

  // 5. Gedraaide tekst.
  const c45 = Math.SQRT1_2.toFixed(6);
  pagina('gedraaid', [
    `BT /F1 12 Tf 0 1 -1 0 300 300 Tm ${T('Rotated ninety degrees')} Tj ET`,
    `BT /F1 12 Tf -1 0 0 -1 500 700 Tm ${T('Upside down text')} Tj ET`,
    `BT /F1 12 Tf 0 -1 1 0 400 600 Tm ${T('Rotated two seventy')} Tj ET`,
    `BT /F1 12 Tf ${c45} ${c45} -${c45} ${c45} 100 100 Tm ${T('Diagonal forty five')} Tj ET`,
    `BT /F1 12 Tf 1 0 0.3 1 100 500 Tm ${T('Skewed italic look')} Tj ET`,
    `BT /F1 12 Tf 0 1 -1 0 250 300 Tm [${T('Vertical')}-300${T('kerned')}] TJ ET`,
  ].join('\n'));

  // 6. Pagina met /Rotate 90.
  pagina('paginarotatie', [
    `BT /F1 14 Tf 72 700 Td ${T('Text on a rotated page')} Tj 0 -20 Td ${T('second line here')} Tj ET`,
  ].join('\n'), { extra: '/Rotate 90' });

  // 7. Tekst in formulieren (Form XObjects), ook genest en tweemaal gebruikt.
  const fm1 = b.stream(`/Type /XObject /Subtype /Form /BBox [0 0 600 100] /Resources << /Font << ${fonts} >> >>`, `BT /F1 12 Tf 0 0 Td ${T('inside form one')} Tj ET`);
  const fm2 = b.stream(`/Type /XObject /Subtype /Form /BBox [0 0 600 200] /Matrix [1 0 0 1 20 0] /Resources << /Font << ${fonts} >> /XObject << /Fm1 ${fm1} 0 R >> >>`, `BT /F1 12 Tf 0 30 Td ${T('outer form text')} Tj ET q 1 0 0 1 0 0 cm /Fm1 Do Q`);
  const fm3 = b.stream(`/Type /XObject /Subtype /Form /BBox [0 0 600 200] /Matrix [0 1 -1 0 0 0] /Resources << /Font << ${fonts} >> >>`, `BT /F1 10 Tf 0 0 Td ${T('rotated form label')} Tj ET`);
  const leeg = b.stream('/Type /XObject /Subtype /Form /BBox [0 0 10 10]', '0 0 m 10 10 l S');
  pagina('formulieren', [
    `BT /F1 12 Tf 72 740 Td ${T('Before form')} Tj ET q 1 0 0 1 150 740 cm /Fm1 Do Q BT /F1 12 Tf 250 740 Td ${T('after form')} Tj ET`,
    `q 1 0 0 1 72 650 cm /Fm2 Do Q`,
    `q 1 0 0 1 72 560 cm /Fm1 Do Q q 2 0 0 2 72 520 cm /Fm1 Do Q`,
    `q 1 0 0 1 500 300 cm /Fm3 Do Q`,
    `BT /F1 12 Tf 72 400 Td ${T('Line with')} Tj ET q /Leeg Do Q BT /F1 12 Tf 130 400 Td ${T('a drawing form between')} Tj ET`,
  ].join('\n'), { xobjecten: `/Fm1 ${fm1} 0 R /Fm2 ${fm2} 0 R /Fm3 ${fm3} 0 R /Leeg ${leeg} 0 R` });

  // 8. CropBox met verschoven oorsprong, tekst buiten de box, onzichtbare tekst.
  pagina('cropbox', [
    `BT /F1 12 Tf 80 700 Td ${T('Inside the crop box')} Tj ET`,
    `BT /F1 12 Tf 10 650 Td ${T('Starts outside the crop box')} Tj ET`,
    `BT /F1 12 Tf 80 20 Td ${T('Below the crop box')} Tj ET`,
    `BT 3 Tr /F1 12 Tf 80 600 Td ${T('hidden ocr layer words')} Tj ET`,
    `BT 0 Tr /F1 12 Tf 80 580 Td ${T('visible again')} Tj ET`,
  ].join('\n'), { extra: '/CropBox [50 50 562 742]' });

  // 9. Type3-font (zoals TeX-bitmapfonts): eigen FontMatrix, Tf 1 en de
  // grootte in Tm. pdf.js past dan de hoogte aan (fontSize <= 1).
  const glyph = (w) => b.stream('', `${w} 0 0 0 ${w} 700 d1 0 0 ${w} 700 re f`);
  const t3namen = ['T', 'y', 'p', 'e', 'three', 'space', 'x'];
  const t3procs = t3namen.map((n) => `/${n} ${glyph(n === 'space' ? 250 : 500)} 0 R`).join(' ');
  const t3 = b.nieuw(`<< /Type /Font /Subtype /Type3 /FontBBox [0 0 1000 1000] /FontMatrix [0.001 0 0 0.001 0 0] /CharProcs << ${t3procs} >> /Encoding << /Type /Encoding /Differences [65 /T /y /p /e /three /space /x] >> /FirstChar 65 /LastChar 71 /Widths [500 500 500 500 500 250 500] >>`);
  const t3b = b.nieuw(`<< /Type /Font /Subtype /Type3 /FontBBox [0 0 100 100] /FontMatrix [0.01 0 0 0.01 0 0] /CharProcs << ${t3procs} >> /Encoding << /Type /Encoding /Differences [65 /T /y /p /e /three /space /x] >> /FirstChar 65 /LastChar 71 /Widths [50 50 50 50 50 25 50] >>`);
  // Met /ToUnicode, zoals de meeste makers van Type3-fonts doen.
  const t3uni = b.stream('', '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CMapName /OPDS-T3 def\n/CMapType 2 def\n1 begincodespacerange\n<00> <FF>\nendcodespacerange\n7 beginbfchar\n<41> <0054>\n<42> <0079>\n<43> <0070>\n<44> <0065>\n<45> <0033>\n<46> <0020>\n<47> <0078>\nendbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend');
  const t3c = b.nieuw(`<< /Type /Font /Subtype /Type3 /FontBBox [0 0 1000 1000] /FontMatrix [0.001 0 0 0.001 0 0] /CharProcs << ${t3procs} >> /Encoding << /Type /Encoding /Differences [65 /T /y /p /e /three /space /x] >> /FirstChar 65 /LastChar 71 /Widths [500 500 500 500 500 250 500] /ToUnicode ${t3uni} 0 R >>`);
  const t3d = b.nieuw(`<< /Type /Font /Subtype /Type3 /FontBBox [0 -10 100 70] /FontMatrix [0.01 0 0 0.01 0 0] /CharProcs << ${t3procs} >> /Encoding << /Type /Encoding /Differences [65 /T /y /p /e /three /space /x] >> /FirstChar 65 /LastChar 71 /Widths [50 50 50 50 50 25 50] /ToUnicode ${t3uni} 0 R >>`);
  {
    const s = b.stream('', [
      'BT /T3 12 Tf 72 700 Td (ABCDEFG) Tj ET',
      'BT /T4 1 Tf 12 0 0 12 72 650 Tm (ABCDEFDG) Tj ET',
      'BT /F1 12 Tf 72 600 Td (after type3) Tj ET',
    ].join('\n'));
    const p = b.nieuw(`<< /Type /Page /Parent ${paginasNr} 0 R /MediaBox [0 0 612 792] /Contents ${s} 0 R /Resources << /Font << ${fonts} /T3 ${t3} 0 R /T4 ${t3b} 0 R >> >> >>`);
    paginaRefs.push(p);
    namen.push('type3');
    const s2 = b.stream('', [
      'BT /T5 12 Tf 72 700 Td (ABCDFEG) Tj 0 -14 Td (ADBC) Tj ET',
      'BT /F1 12 Tf 72 600 Td (after type3) Tj ET',
    ].join('\n'));
    const p2 = b.nieuw(`<< /Type /Page /Parent ${paginasNr} 0 R /MediaBox [0 0 612 792] /Contents ${s2} 0 R /Resources << /Font << ${fonts} /T5 ${t3c} 0 R >> >> >>`);
    paginaRefs.push(p2);
    namen.push('type3-unicode');
    const s3 = b.stream('', 'BT /T6 1 Tf 12 0 0 12 72 650 Tm (ABCDFE) Tj 0 -1.2 Td (DG) Tj ET');
    const p3 = b.nieuw(`<< /Type /Page /Parent ${paginasNr} 0 R /MediaBox [0 0 612 792] /Contents ${s3} 0 R /Resources << /Font << ${fonts} /T6 ${t3d} 0 R >> >> >>`);
    paginaRefs.push(p3);
    namen.push('type3-klein');
  }

  // 10. Lege pagina en een pagina met alleen spaties.
  pagina('leeg', 'q 0 0 m 100 100 l S Q');
  pagina('spaties', `BT /F1 12 Tf 72 700 Td ${T('     ')} Tj ET`);

  b.zet(paginasNr, `<< /Type /Pages /Kids [${paginaRefs.map((r) => `${r} 0 R`).join(' ')}] /Count ${paginaRefs.length} >>`);
  b.zet(catalogus, `<< /Type /Catalog /Pages ${paginasNr} 0 R >>`);
  return { pdf: b.pdf(catalogus), paginas: namen };
}

// ── Het meetdocument: veel pagina's lopende tekst ──────────────────────────
const WOORDEN = ('lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua '
  + 'constructie fundering wapening beton staal hout gevel kozijn dakgoot balklaag kolom ligger vloer trap bouwbesluit '
  + 'café müller façade naïve ångström search text find replace highlight').split(' ');

function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `paginas` pagina's A4 met elk ~50 regels van ~90 tekens, afwisselend Tj
 * met spaties en TJ met kerning; inhoud gecomprimeerd zoals echte PDF's.
 */
export function maakTekstDocument(paginas = 500, { seed = 7 } = {}) {
  const b = new Bouwer();
  const catalogus = b.nieuw();
  const paginasNr = b.nieuw();
  const helv = b.nieuw('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const times = b.nieuw('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>');
  const r = prng(seed);
  const refs = [];
  for (let p = 0; p < paginas; p++) {
    const regels = [`BT /F1 16 Tf 56 790 Td ${pdfStr(`Hoofdstuk ${p + 1} search benchmark`)} Tj ET`, 'BT /F2 10 Tf 56 760 Td 13 TL'];
    for (let l = 0; l < 52; l++) {
      const woorden = [];
      let lengte = 0;
      while (lengte < 88) {
        const w = WOORDEN[Math.floor(r() * WOORDEN.length)];
        woorden.push(w);
        lengte += w.length + 1;
      }
      if (l % 3 === 1) {
        // TJ met kerning tussen de woorden, zonder spatieglyphs.
        regels.push(`[${woorden.map((w) => pdfStr(w)).join('-280')}] TJ T*`);
      } else {
        regels.push(`${pdfStr(woorden.join(' '))} Tj T*`);
      }
    }
    regels.push('ET');
    regels.push(`BT /F1 8 Tf 290 30 Td ${pdfStr(`${p + 1}`)} Tj ET`);
    const s = b.stream('', regels.join('\n'), true);
    refs.push(b.nieuw(`<< /Type /Page /Parent ${paginasNr} 0 R /MediaBox [0 0 595 842] /Contents ${s} 0 R /Resources << /Font << /F1 ${helv} 0 R /F2 ${times} 0 R >> >> >>`));
  }
  b.zet(paginasNr, `<< /Type /Pages /Kids [${refs.map((x) => `${x} 0 R`).join(' ')}] /Count ${refs.length} >>`);
  b.zet(catalogus, `<< /Type /Catalog /Pages ${paginasNr} 0 R >>`);
  return b.pdf(catalogus);
}
