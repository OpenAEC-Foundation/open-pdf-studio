// Unit-tests voor de content-stream-tekst-helpers (in-place tekstbewerking).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  tokenizeContentStream,
  interpretContentStreams,
  winAnsiMap,
  buildSimpleEncodingMap,
  glyphNameToUnicode,
  parseToUnicodeCMap,
  invertUnicodeMap,
  decodeShowOpText,
  matchEditLines,
  checkChainSafety,
  planSplices,
  applySplices,
  encodeTextToCodes,
  codesToHexString,
  isSubsetFontName,
} from './content-stream-text.js';

// ── Tokenizer ──

test('tokenizer: getallen, namen, operatoren', () => {
  const toks = tokenizeContentStream('1 0 0 1 72.5 -720 cm /F1 12 Tf BT ET');
  assert.deepEqual(toks.map(t => t.t), [
    'num', 'num', 'num', 'num', 'num', 'num', 'op', 'name', 'num', 'op', 'op', 'op',
  ]);
  assert.equal(toks[4].v, 72.5);
  assert.equal(toks[5].v, -720);
  assert.equal(toks[7].v, 'F1');
});

test('tokenizer: literal string met escapes en geneste haken', () => {
  const toks = tokenizeContentStream('(a\\(b\\)c (d) \\\\ \\101) Tj');
  assert.equal(toks[0].t, 'str');
  const s = String.fromCharCode(...toks[0].v);
  assert.equal(s, 'a(b)c (d) \\ A');
  assert.equal(toks[0].s, 0);
  assert.equal(toks[1].v, 'Tj');
});

test('tokenizer: octale escapes en regelvervolg', () => {
  const toks = tokenizeContentStream('(\\110\\145\\154lo\\\n wereld) Tj');
  assert.equal(String.fromCharCode(...toks[0].v), 'Hello wereld');
});

test('tokenizer: hex-string met witruimte en oneven aantal', () => {
  const toks = tokenizeContentStream('<48 65 6C6C 6F> Tj <414> Tj');
  assert.equal(String.fromCharCode(...toks[0].v), 'Hello');
  assert.deepEqual(toks[2].v, [0x41, 0x40]);
});

test('tokenizer: array- en dict-tokens', () => {
  const toks = tokenizeContentStream('[(A) -120 (B)] TJ << /Type /Page >>');
  assert.equal(toks[0].t, 'arr[');
  assert.equal(toks[1].t, 'str');
  assert.equal(toks[2].v, -120);
  assert.equal(toks[4].t, 'arr]');
  assert.equal(toks[5].v, 'TJ');
  assert.equal(toks[6].t, 'dict<<');
});

test('tokenizer: inline image wordt overgeslagen', () => {
  const toks = tokenizeContentStream('q BI /W 2 /H 2 ID \x00\xFF(\x89 EI Q (na) Tj');
  const ops = toks.filter(t => t.t === 'op').map(t => t.v);
  assert.deepEqual(ops, ['q', 'BI..EI', 'Q', 'Tj']);
  const str = toks.find(t => t.t === 'str');
  assert.equal(String.fromCharCode(...str.v), 'na');
});

// ── Interpreter ──

test('interpreter: Tm/Td-posities en byte-ranges', () => {
  const src = 'BT /F1 12 Tf 1 0 0 1 100 700 Tm (Hallo) Tj 0 -14 Td (Wereld) Tj ET';
  const ops = interpretContentStreams([src]);
  assert.equal(ops.length, 2);
  assert.equal(ops[0].font, 'F1');
  assert.equal(ops[0].x, 100);
  assert.equal(ops[0].y, 700);
  assert.equal(ops[0].sizeEff, 12);
  assert.equal(ops[0].posExact, true);
  assert.equal(ops[1].x, 100);
  assert.equal(ops[1].y, 686);
  // byte-range dekt operand + operator
  assert.equal(src.slice(ops[0].s, ops[0].e), '(Hallo) Tj');
  assert.equal(src.slice(ops[1].s, ops[1].e), '(Wereld) Tj');
});

test('interpreter: cm-CTM werkt door in posities', () => {
  const src = 'q 2 0 0 2 10 20 cm BT 1 0 0 1 5 7 Tm (x) Tj ET Q';
  const ops = interpretContentStreams([src]);
  assert.equal(ops[0].x, 20); // 5*2+10
  assert.equal(ops[0].y, 34); // 7*2+20
  assert.equal(ops[0].sizeEff, 0); // geen Tf gezien
});

test('interpreter: opeenvolgende Tj in één chain: posExact vervalt', () => {
  const src = 'BT /F1 10 Tf 10 10 Td (a) Tj (b) Tj 0 -12 Td (c) Tj ET';
  const ops = interpretContentStreams([src]);
  assert.equal(ops[0].posExact, true);
  assert.equal(ops[1].posExact, false);
  assert.equal(ops[0].chain, ops[1].chain);
  assert.equal(ops[2].posExact, true);
  assert.notEqual(ops[2].chain, ops[1].chain);
});

test("interpreter: ' en \" doen T* en beginnen een nieuwe chain", () => {
  const src = "BT /F1 10 Tf 14 TL 10 100 Td (a) Tj (b) ' 2 1 (c) \" ET";
  const ops = interpretContentStreams([src]);
  assert.equal(ops.length, 3);
  assert.equal(ops[1].op, "'");
  assert.equal(ops[1].y, 86);
  assert.equal(ops[1].posExact, true);
  assert.equal(ops[1].sideEffect, 'T*');
  assert.equal(ops[2].op, '"');
  assert.equal(ops[2].y, 72);
  assert.deepEqual(ops[2].sideEffect, { aw: 2, ac: 1 });
});

test('interpreter: TJ verzamelt alle strings', () => {
  const src = 'BT /F1 10 Tf 0 0 Td [(Ha) -20 (llo)] TJ ET';
  const ops = interpretContentStreams([src]);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].strings.length, 2);
  assert.equal(String.fromCharCode(...ops[0].strings[0]), 'Ha');
});

test('interpreter: geroteerde Tm geeft hoek', () => {
  const src = 'BT /F1 10 Tf 0 1 -1 0 50 60 Tm (v) Tj ET';
  const ops = interpretContentStreams([src]);
  assert.equal(Math.round(ops[0].angle), 90);
});

test('interpreter: tokens verdeeld over meerdere streams', () => {
  const ops = interpretContentStreams(['BT /F1 9 Tf 3 4 Td', '(x) Tj ET']);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].si, 1);
  assert.equal(ops[0].x, 3);
});

test('interpreter: Do-operatoren met CTM en xobjectBBox', async () => {
  const { xobjectBBox } = await import('./content-stream-text.js');
  const src = 'q 500 0 0 700 50 60 cm /Im1 Do Q BT /F1 10 Tf 100 200 Td (x) Tj ET';
  const ops = interpretContentStreams([src]);
  assert.equal(ops.length, 1);
  assert.equal(ops.xobjects.length, 1);
  assert.equal(ops.xobjects[0].name, 'Im1');
  const bb = xobjectBBox(ops.xobjects[0].ctm);
  assert.deepEqual(bb, { minX: 50, minY: 60, maxX: 550, maxY: 760 });
});

// ── Codering ──

test('winAnsiMap: ASCII en cp1252-extra', () => {
  const m = winAnsiMap();
  assert.equal(m.get(0x41), 'A');
  assert.equal(m.get(0x80), '€');
  assert.equal(m.get(0x92), '’');
  assert.equal(m.get(0xE9), 'é');
  assert.equal(m.has(0x81), false);
});

test('buildSimpleEncodingMap: Differences overschrijven de basis', () => {
  const { map, certain } = buildSimpleEncodingMap('WinAnsiEncoding', [65, 'eacute', 'bullet']);
  assert.equal(certain, true);
  assert.equal(map.get(65), 'é');
  assert.equal(map.get(66), '•');
  assert.equal(map.get(67), 'C');
});

test('glyphNameToUnicode: agl, uniXXXX en 1-teken-namen', () => {
  assert.equal(glyphNameToUnicode('eacute'), 'é');
  assert.equal(glyphNameToUnicode('uni20AC'), '€');
  assert.equal(glyphNameToUnicode('A'), 'A');
  assert.equal(glyphNameToUnicode('blafblaf'), undefined);
});

test('parseToUnicodeCMap: bfchar en bfrange', () => {
  const cmap = `
/CIDInit /ProcSet findresource begin
begincodespacerange <0000> <FFFF> endcodespacerange
2 beginbfchar
<0003> <0041>
<0010> <00660066>
endbfchar
1 beginbfrange
<0020> <0022> <0061>
endbfrange
1 beginbfrange
<0030> <0031> [<0058> <0059>]
endbfrange
end`;
  const { map, codeBytes } = parseToUnicodeCMap(cmap);
  assert.equal(codeBytes, 2);
  assert.equal(map.get(3), 'A');
  assert.equal(map.get(0x10), 'ff'); // ligatuur naar 2 tekens
  assert.equal(map.get(0x20), 'a');
  assert.equal(map.get(0x22), 'c');
  assert.equal(map.get(0x30), 'X');
  assert.equal(map.get(0x31), 'Y');
});

test('decodeShowOpText: 1-byte en 2-byte codes', () => {
  const w = { bytesPerCode: 1, map: winAnsiMap() };
  const r1 = decodeShowOpText({ strings: [[72, 97, 108, 108, 111]] }, w);
  assert.equal(r1.text, 'Hallo');
  assert.equal(r1.ok, true);

  const m2 = new Map([[3, 'A'], [4, 'B']]);
  const r2 = decodeShowOpText({ strings: [[0, 3, 0, 4]] }, { bytesPerCode: 2, map: m2 });
  assert.equal(r2.text, 'AB');
  assert.deepEqual(r2.codes, [3, 4]);

  const r3 = decodeShowOpText({ strings: [[0, 9]] }, { bytesPerCode: 2, map: m2 });
  assert.equal(r3.ok, false);
});

// ── Matching ──

function opsFrom(src, fontInfo) {
  const ops = interpretContentStreams([src]);
  for (const op of ops) {
    const d = decodeShowOpText(op, fontInfo);
    op.text = d.text;
    op.ok = d.ok;
    op.codes = d.codes;
  }
  return ops;
}

const WINFO = { bytesPerCode: 1, map: winAnsiMap() };

test('matchEditLines: unieke regel matcht over meerdere ops', () => {
  const src = 'BT /F1 12 Tf 1 0 0 1 100 700 Tm (Hal) Tj (lo daar) Tj 1 0 0 1 100 686 Tm (Tweede regel) Tj ET';
  const ops = opsFrom(src, WINFO);
  const res = matchEditLines(ops, [
    { x: 100, y: 700, text: 'Hallo daar', fontSize: 12, angle: 0 },
    { x: 100, y: 686, text: 'Tweede regel', fontSize: 12, angle: 0 },
  ]);
  assert.equal(res.ok, true);
  assert.deepEqual(res.lineMatches[0], [0, 1]);
  assert.deepEqual(res.lineMatches[1], [2]);
});

test('matchEditLines: witruimte-ongevoelig (losse woorden zonder spaties)', () => {
  const src = 'BT /F1 10 Tf 50 500 Td (Offerte:) Tj 80 0 Td (AC294) Tj ET';
  const ops = opsFrom(src, WINFO);
  const res = matchEditLines(ops, [
    { x: 50, y: 500, text: 'Offerte:\tAC294', fontSize: 10, angle: 0 },
  ]);
  assert.equal(res.ok, true);
  assert.deepEqual(res.lineMatches[0], [0, 1]);
});

test('matchEditLines: andere kolom op dezelfde baseline blijft buiten het venster', () => {
  const src = 'BT /F1 10 Tf 50 500 Td (Links) Tj 300 0 Td (Rechts) Tj ET';
  const ops = opsFrom(src, WINFO);
  const res = matchEditLines(ops, [
    { x: 350, y: 500, text: 'Rechts', fontSize: 10, angle: 0 },
  ]);
  assert.equal(res.ok, true);
  assert.deepEqual(res.lineMatches[0], [1]);
});

test('matchEditLines: geen match bij tekst die er niet staat', () => {
  const src = 'BT /F1 10 Tf 50 500 Td (Aanwezig) Tj ET';
  const ops = opsFrom(src, WINFO);
  const res = matchEditLines(ops, [
    { x: 50, y: 500, text: 'Afwezig', fontSize: 10, angle: 0 },
  ]);
  assert.equal(res.ok, false);
  assert.equal(res.lineMatches[0], null);
});

test('matchEditLines: dubbelzinnig (zelfde tekst op zelfde anker) → geen match', () => {
  // Twee identieke runs op exact dezelfde positie: onbeslisbaar → null.
  const src = 'BT /F1 10 Tf 1 0 0 1 50 500 Tm (Dubbel) Tj 1 0 0 1 50 500 Tm (Dubbel) Tj ET';
  const ops = opsFrom(src, WINFO);
  const res = matchEditLines(ops, [
    { x: 50, y: 500, text: 'Dubbel', fontSize: 10, angle: 0 },
  ]);
  assert.equal(res.ok, false);
});

test('matchEditLines: geroteerde tekst matcht op anker en hoek', () => {
  const src = 'BT /F1 10 Tf 0 1 -1 0 200 300 Tm (Verticaal) Tj ET';
  const ops = opsFrom(src, WINFO);
  const res = matchEditLines(ops, [
    { x: 200, y: 300, text: 'Verticaal', fontSize: 10, angle: 90 },
  ]);
  assert.equal(res.ok, true);
  const res2 = matchEditLines(ops, [
    { x: 200, y: 300, text: 'Verticaal', fontSize: 10, angle: 0 },
  ]);
  assert.equal(res2.ok, false);
});

test('matchEditLines: niet-decodeerbare op op de regel blokkeert het venster', () => {
  const src = 'BT /F1 10 Tf 50 500 Td (Voor) Tj (\x81) Tj (Na) Tj ET';
  const ops = opsFrom(src, WINFO);
  const res = matchEditLines(ops, [
    { x: 50, y: 500, text: 'Voor?Na', fontSize: 10, angle: 0 },
  ]);
  assert.equal(res.ok, false);
});

// ── Chain-veiligheid ──

test('checkChainSafety: verwijderen midden in een chain is onveilig', () => {
  const src = 'BT /F1 10 Tf 0 0 Td (a) Tj (b) Tj (c) Tj ET';
  const ops = interpretContentStreams([src]);
  assert.equal(checkChainSafety(ops, new Set([1])).safe, false);
  assert.equal(checkChainSafety(ops, new Set([1, 2])).safe, true);
  assert.equal(checkChainSafety(ops, new Set([0, 1, 2])).safe, true);
  // alleen de staart verwijderen is veilig
  assert.equal(checkChainSafety(ops, new Set([2])).safe, true);
});

// ── Splices ──

test('planSplices/applySplices: Tj verdwijnt, \' behoudt T*', () => {
  const src = "BT /F1 10 Tf 14 TL 10 100 Td (weg) Tj (ook weg) ' (blijft) Tj ET";
  const ops = interpretContentStreams([src]);
  const splices = planSplices(ops, [0, 1]);
  const out = applySplices(src, splices);
  assert.ok(!out.includes('(weg)'));
  assert.ok(!out.includes('(ook weg)'));
  assert.ok(out.includes('(blijft) Tj'));
  assert.ok(out.includes('T*'));
  // resultaat blijft parseerbaar en de resterende op staat één regel lager
  const ops2 = interpretContentStreams([out]);
  assert.equal(ops2.length, 1);
  assert.equal(String.fromCharCode(...ops2[0].strings[0]), 'blijft');
  assert.equal(ops2[0].y, 86); // T* uit ' behouden → baseline verschoven
});

test('planSplices: " behoudt Tw/Tc/T*', () => {
  const src = 'BT /F1 10 Tf 12 TL 0 50 Td 2.5 1.25 (weg) " (rest) Tj ET';
  const ops = interpretContentStreams([src]);
  const out = applySplices(src, planSplices(ops, [0]));
  assert.ok(/2\.5 Tw 1\.25 Tc T\*/.test(out));
  const ops2 = interpretContentStreams([out]);
  assert.equal(ops2.length, 1);
  assert.equal(ops2[0].y, 38);
});

test('applySplices: meerdere splices, aflopend toegepast', () => {
  const src = '(a) Tj (b) Tj (c) Tj';
  const spl = [
    { start: 0, end: 6, replacement: ' ' },
    { start: 14, end: 20, replacement: ' ' },
  ];
  assert.equal(applySplices(src, spl), '  (b) Tj  ');
});

// ── Her-encodering ──

test('encodeTextToCodes: WinAnsi-omkering', () => {
  const inv = invertUnicodeMap(winAnsiMap());
  const codes = encodeTextToCodes('Halló €', inv);
  assert.deepEqual(codes, [72, 97, 108, 108, 0xF3, 32, 0x80]);
  assert.equal(encodeTextToCodes('日本', inv), null);
});

test('encodeTextToCodes: subset beperkt tot gebruikte codes', () => {
  const inv = invertUnicodeMap(winAnsiMap());
  const used = new Set([72, 97, 108, 111]); // H a l o
  assert.deepEqual(
    encodeTextToCodes('Hallo', inv, { subset: true, usedCodes: used }),
    [72, 97, 108, 108, 111],
  );
  assert.equal(encodeTextToCodes('Hallo!', inv, { subset: true, usedCodes: used }), null);
});

test('codesToHexString: 1- en 2-byte-breedte', () => {
  assert.equal(codesToHexString([72, 105], 1), '4869');
  assert.equal(codesToHexString([3, 260], 2), '00030104');
});

test('isSubsetFontName', () => {
  assert.equal(isSubsetFontName('BAAAAA+UniviaProRegular'), true);
  assert.equal(isSubsetFontName('Arial-BoldMT'), false);
  assert.equal(isSubsetFontName(''), false);
});

// ── Fase B: fontfamilies, breedtes, tekst-state ──

test('fontVariantFromBaseName: subset, gewicht en suffixen', async () => {
  const { fontVariantFromBaseName } = await import('./content-stream-text.js');
  assert.deepEqual(fontVariantFromBaseName('BCDEEE+Calibri-Light'),
    { family: 'calibri', bold: false, italic: false });
  assert.deepEqual(fontVariantFromBaseName('Arial-BoldMT'),
    { family: 'arial', bold: true, italic: false });
  assert.deepEqual(fontVariantFromBaseName('ArialMT'),
    { family: 'arial', bold: false, italic: false });
  assert.deepEqual(fontVariantFromBaseName('AAAAAF+*Arial-BoldItalic-7365'),
    { family: 'arial', bold: true, italic: true });
  assert.deepEqual(fontVariantFromBaseName('TimesNewRomanPSMT'),
    { family: 'timesnew', bold: false, italic: false }); // genormaliseerde sleutel
  assert.deepEqual(fontVariantFromBaseName('BAAAAA+UniviaProRegular'),
    { family: 'univia', bold: false, italic: false });
});

test('parseWArray: beide W-vormen', async () => {
  const { parseWArray } = await import('./content-stream-text.js');
  const m = parseWArray([3, [500, 520, 540], 10, 12, 600]);
  assert.equal(m.get(3), 500);
  assert.equal(m.get(5), 540);
  assert.equal(m.get(10), 600);
  assert.equal(m.get(12), 600);
  assert.equal(m.has(6), false);
});

test('computeRunWidth: widths, Tc/Tw/Tz en 2-byte-codes', async () => {
  const { computeRunWidth } = await import('./content-stream-text.js');
  const widthOf = (c) => ({ 65: 700, 32: 250, 66: 500 }[c]);
  // (700+250+500)/1000 * 10 = 14.5
  assert.equal(computeRunWidth([65, 32, 66], widthOf, { size: 10 }), 14.5);
  // Tc telt per glyf, Tw alleen voor spatie (1-byte)
  assert.equal(
    computeRunWidth([65, 32, 66], widthOf, { size: 10, tc: 1, tw: 2 }),
    14.5 + 3 + 2,
  );
  // Tz schaalt het geheel
  assert.equal(computeRunWidth([65], widthOf, { size: 10, tz: 50 }), 3.5);
  // 2-byte: code 32 is een CID, geen spatie → geen Tw
  assert.equal(
    computeRunWidth([65, 32], widthOf, { size: 10, tw: 5, bytesPerCode: 2 }),
    9.5,
  );
  // onbekende code → missing-breedte
  assert.equal(computeRunWidth([99], widthOf, { size: 10, missing: 500 }), 5);
});

test('interpreter: Tc/Tw/Tz landen op de show-op', () => {
  const src = 'BT /F1 10 Tf 2 Tc 1.5 Tw 80 Tz 0 0 Td (x) Tj 0 Tc (y) Tj ET';
  const ops = interpretContentStreams([src]);
  assert.equal(ops[0].tc, 2);
  assert.equal(ops[0].tw, 1.5);
  assert.equal(ops[0].tz, 80);
  assert.equal(ops[1].tc, 0);
});

test('interpreter: " zet Tw/Tc vóór het tonen', () => {
  const src = 'BT /F1 10 Tf 12 TL 0 50 Td 3 1 (x) " ET';
  const ops = interpretContentStreams([src]);
  assert.equal(ops[0].tw, 3);
  assert.equal(ops[0].tc, 1);
});

// ── Integratie: match → splice → hertokenisatie ──

test('integratie: regel vervangen laat andere tekst intact', () => {
  const src = 'BT /F1 12 Tf 1 0 0 1 72 700 Tm (Onderwerp: offerte) Tj 1 0 0 1 72 686 Tm (Met vriendelijke groet) Tj ET';
  const ops = opsFrom(src, WINFO);
  const res = matchEditLines(ops, [
    { x: 72, y: 700, text: 'Onderwerp: offerte', fontSize: 12, angle: 0 },
  ]);
  assert.equal(res.ok, true);
  const removeSet = new Set(res.lineMatches[0]);
  assert.equal(checkChainSafety(ops, removeSet).safe, true);
  const out = applySplices(src, planSplices(ops, [...removeSet]));
  assert.ok(!out.includes('offerte'));
  assert.ok(out.includes('(Met vriendelijke groet) Tj'));
  const ops2 = interpretContentStreams([out]);
  assert.equal(ops2.length, 1);
  assert.equal(ops2[0].x, 72);
  assert.equal(ops2[0].y, 686);
});
