import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyPageRotation,
  buildLineSegments,
  layoutSegmentsOnTabGrid,
  normalizeBulletText,
  normalizeRuns,
  runsPlainText,
  splitRunsIntoSegments,
  standardFontVariant,
  elementRectToCanvasPixels,
  getPageRotationMatrix,
  getTextLayerCssMatrix,
  invertPageRotation,
  restoreTextEditSnapshot,
  resolveTextEditLineStyle,
  resolveTextEditPageGeometry,
  sanitizeWinAnsiText,
  selectTextColor,
  textEditAngleFromTransform,
  textEditLineAnchor,
} from './text-edit-appearance.js';

test('page rotation matrix keeps PDF text attached for every quarter turn', () => {
  const width = 600;
  const height = 800;
  const point = { x: 100, y: 200 };

  assert.deepEqual(getPageRotationMatrix(width, height, 0), [1, 0, 0, 1, 0, 0]);
  assert.deepEqual(getPageRotationMatrix(width, height, 90), [0, 1, -1, 0, 800, 0]);
  assert.deepEqual(getPageRotationMatrix(width, height, 180), [-1, 0, 0, -1, 600, 800]);
  assert.deepEqual(getPageRotationMatrix(width, height, 270), [0, -1, 1, 0, 0, 600]);

  assert.deepEqual(applyPageRotation(point.x, point.y, width, height, 90), { x: 600, y: 100 });
  assert.deepEqual(applyPageRotation(point.x, point.y, width, height, 180), { x: 500, y: 600 });
  assert.deepEqual(applyPageRotation(point.x, point.y, width, height, 270), { x: 200, y: 500 });
});

test('rotated display coordinates invert to the original text position', () => {
  const width = 600;
  const height = 800;
  const original = { x: 123, y: 456 };

  for (const rotation of [0, 90, 180, 270]) {
    const displayed = applyPageRotation(original.x, original.y, width, height, rotation);
    assert.deepEqual(invertPageRotation(displayed.x, displayed.y, width, height, rotation), original);
  }
});

test('text layer matrix composes page rotation, zoom, and viewport offset', () => {
  assert.deepEqual(
    getTextLayerCssMatrix(600, 800, 90, 2, 10, 20),
    [0, 2, -2, 0, 1610, 20],
  );
  assert.deepEqual(
    getTextLayerCssMatrix(600, 800, 270, 1.5, -5, 12),
    [0, -1.5, 1.5, 0, -5, 912],
  );
});

test('text colour selection ignores white background and antialiased grey edges', () => {
  const blackGlyph = new Uint8ClampedArray([
    255, 255, 255, 255,
    188, 188, 188, 255,
    17, 17, 17, 255,
    110, 110, 110, 255,
  ]);
  assert.equal(selectTextColor(blackGlyph), '#000000');

  const redGlyph = new Uint8ClampedArray([
    255, 255, 255, 255,
    255, 170, 170, 255,
    214, 32, 40, 255,
  ]);
  assert.equal(selectTextColor(redGlyph), '#d62028');
});

test('text colour selection preserves colours on light and dark backgrounds', () => {
  assert.equal(selectTextColor(new Uint8ClampedArray([
    0, 0, 0, 255,
    0, 0, 0, 255,
    214, 32, 40, 255,
  ])), '#d62028');
  assert.equal(selectTextColor(new Uint8ClampedArray([
    255, 255, 255, 255,
    255, 255, 255, 255,
    51, 51, 51, 255,
  ])), '#333333');
  assert.equal(selectTextColor(new Uint8ClampedArray([
    255, 255, 255, 255,
    255, 255, 255, 255,
    244, 244, 244, 255,
  ])), '#f4f4f4');

  assert.equal(selectTextColor(new Uint8ClampedArray([
    255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255,
    255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  ]), '#000000', 3, 3), '#000000');
});

test('cancelling a live text edit restores the complete record snapshot', () => {
  const record = { pdfX: 12, pdfY: 30, color: '#ff0000', transient: true };
  restoreTextEditSnapshot(record, { pdfX: 10, pdfY: 20, color: '#000000' });
  assert.deepEqual(record, { pdfX: 10, pdfY: 20, color: '#000000' });
});

test('DOM text bounds are converted to canvas backing pixels', () => {
  const canvasRect = { left: 20, top: 40, width: 400, height: 300 };
  const textRect = { left: 120, top: 115, right: 220, bottom: 145 };

  assert.deepEqual(
    elementRectToCanvasPixels(textRect, canvasRect, 800, 600),
    { x: 200, y: 150, width: 200, height: 60 },
  );
});

test('page geometry combines intrinsic and user rotation', () => {
  assert.deepEqual(
    resolveTextEditPageGeometry({ widthPt: 600, heightPt: 800, rotation: 90 }, 800, 600, 90),
    { pageWidth: 600, pageHeight: 800, rotation: 180, displayWidth: 600, displayHeight: 800,
      offsetXPt: 0, offsetYPt: 0 },
  );
});

test('WinAnsi sanitizer keeps encodable text untouched', () => {
  const { text, replaced } = sanitizeWinAnsiText('Prijs € 1.200,00 — "citaat" … één ligne');
  assert.equal(text, 'Prijs € 1.200,00 — "citaat" … één ligne');
  assert.deepEqual(replaced, []);
});

test('WinAnsi sanitizer replaces non-encodable characters with close equivalents', () => {
  const { text, replaced } = sanitizeWinAnsiText('u ≤ h/300 → ok ﬁjn');
  assert.equal(text, 'u <= h/300 -> ok fijn');
  assert.deepEqual(replaced, ['≤', '→', 'ﬁ']);
});

test('WinAnsi sanitizer falls back to ? for unmapped characters', () => {
  const { text, replaced } = sanitizeWinAnsiText('hobЬi �');
  assert.equal(text, 'hob?i ?');
  assert.deepEqual(replaced, ['Ь', '�']);
  // Newlines survive (line splitting happens before drawing)
  assert.equal(sanitizeWinAnsiText('a\nb').text, 'a\nb');
});

test('WinAnsi sanitizer keeps the base letter of a diacritic it cannot encode', () => {
  // Latin Extended letters decompose to a WinAnsi base, so the word stays
  // readable instead of collapsing to '?'.
  assert.equal(sanitizeWinAnsiText('M\u0101ori wh\u0101nau').text, 'Maori whanau');
  assert.equal(sanitizeWinAnsiText('\u0100\u0101 \u0112\u0113 \u012a\u012b \u014c\u014d \u016a\u016b').text, 'Aa Ee Ii Oo Uu');
  // 'C with caron' has no WinAnsi slot so it degrades to 'C'; 's with caron'
  // is in WINANSI_EXTRA and survives untouched.
  assert.equal(sanitizeWinAnsiText('\u010ce\u0161tina').text, 'Ce\u0161tina');

  // Stroke and dotless letters have no decomposition, so they are mapped.
  assert.equal(sanitizeWinAnsiText('\u0141\u00f3d\u017a').text, 'L\u00f3dz');
  assert.equal(sanitizeWinAnsiText('\u0110\u00e0 N\u1eb5ng').text, 'D\u00e0 Nang');
  assert.equal(sanitizeWinAnsiText('\u0131\u011f\u015f').text, 'igs');

  // Non-Latin scripts still have no sensible base letter.
  assert.equal(sanitizeWinAnsiText('\u042c').text, '?');
});

test('text angle is derived from the span matrix and snapped to right angles', () => {
  assert.equal(textEditAngleFromTransform([11, 0, 0, 11, 100, 200]), 0);
  // 90° CCW authored text (as on /Rotate 90 pages): [0, fs, -fs, 0]
  assert.equal(textEditAngleFromTransform([0, 10.017, -10.017, 0, 538, 971]), 90);
  assert.equal(textEditAngleFromTransform([-9, 0, 0, -9, 0, 0]), 180);
  assert.equal(textEditAngleFromTransform([0, -12, 12, 0, 0, 0]), 270);
  // Garbage in, safe default out
  assert.equal(textEditAngleFromTransform(null), 0);
  assert.equal(textEditAngleFromTransform([0, 0, 0, 0]), 0);
});

test('line anchors follow the text direction for rotated runs', () => {
  // Horizontal text: next line straight down (PDF y decreases)
  assert.deepEqual(textEditLineAnchor(100, 500, 1, 12, 0), { x: 100, y: 488 });
  // 90° CCW text: next line moves in +x (perpendicular to reading direction)
  const a = textEditLineAnchor(538, 971, 1, 12, 90);
  assert.ok(Math.abs(a.x - 550) < 1e-9 && Math.abs(a.y - 971) < 1e-9);
  const b = textEditLineAnchor(100, 500, 2, 10, 180);
  assert.ok(Math.abs(b.x - 100) < 1e-9 && Math.abs(b.y - 520) < 1e-9);
});

test('per-line styles resolve with record-level fallback', () => {
  const edit = {
    fontFamily: 'Helvetica-Bold',
    fontSize: 11,
    color: '#3399cc',
    loadedFontName: 'g_d0_f1',
    lineStyles: [
      { fontFamily: 'Helvetica-Bold', fontSize: 11, color: '#3399cc', loadedFontName: 'g_d0_f1' },
      { fontFamily: 'Helvetica', fontSize: 9.96, color: '#000000', loadedFontName: 'g_d0_f2' },
    ],
  };
  // Line 0: heading style; line 1: body style
  assert.equal(resolveTextEditLineStyle(edit, 0).color, '#3399cc');
  assert.equal(resolveTextEditLineStyle(edit, 1).fontFamily, 'Helvetica');
  assert.equal(resolveTextEditLineStyle(edit, 1).fontSize, 9.96);
  // Extra lines beyond the original block reuse the last known line style
  assert.equal(resolveTextEditLineStyle(edit, 5).color, '#000000');
  // Records without lineStyles keep the uniform record style (old records,
  // panel overrides)
  const uniform = { fontFamily: 'TimesRoman', fontSize: 12, color: '#112233' };
  assert.deepEqual(resolveTextEditLineStyle(uniform, 3), {
    fontFamily: 'TimesRoman', fontSize: 12, color: '#112233', loadedFontName: '',
  });
});

test('line segments: a wide gap becomes a tab with preserved column x', () => {
  // Tekst.pdf-patroon: "Offerte:" + brede spatie-span + "AC294" op x=228.05
  const { text, segments } = buildLineSegments([
    { text: 'Offerte:', pdfX: 156.05, pdfY: 548.7, pdfWidth: 38.313, fontSize: 11 },
    { text: ' ', pdfX: 194.363, pdfY: 548.7, pdfWidth: 33.687, fontSize: 11 },
    { text: 'AC294', pdfX: 228.05, pdfY: 548.7, pdfWidth: 34.408, fontSize: 11 },
  ]);
  assert.equal(text, 'Offerte:	AC294');
  assert.equal(segments.length, 2);
  assert.equal(segments[0].text, 'Offerte:');
  assert.equal(segments[1].text, 'AC294');
  assert.equal(segments[1].x, 228.05);
  assert.ok(Math.abs(segments[1].start - 72) < 1e-9);
  assert.equal(segments[1].spanStart, 2);
});

test('line segments: ordinary word spacing stays a single run of text', () => {
  const { text, segments } = buildLineSegments([
    { text: 'Geachte', pdfX: 100, pdfY: 500, pdfWidth: 40, fontSize: 11 },
    { text: ' ', pdfX: 140, pdfY: 500, pdfWidth: 3, fontSize: 11 },
    { text: 'heer', pdfX: 143, pdfY: 500, pdfWidth: 22, fontSize: 11 },
  ]);
  assert.equal(text, 'Geachte heer');
  assert.equal(segments, null);
});

test('line segments: rotated runs measure the gap along the baseline', () => {
  // 90 graden CCW: leesrichting is +y, kolomafstand zit in pdfY.
  const { text, segments } = buildLineSegments([
    { text: 'Label', pdfX: 500, pdfY: 100, pdfWidth: 30, fontSize: 10 },
    { text: 'Waarde', pdfX: 500, pdfY: 180, pdfWidth: 35, fontSize: 10 },
  ], 90);
  assert.equal(text, 'Label	Waarde');
  assert.equal(segments.length, 2);
  assert.ok(Math.abs(segments[1].start - 80) < 1e-9);
});

test('runs: normalize merges equal styles and drops empties', () => {
  assert.deepEqual(normalizeRuns([
    { text: 'foo', bold: true }, { text: '', bold: false },
    { text: 'bar', bold: true }, { text: 'x', bold: false, italic: true },
  ]), [
    { text: 'foobar', bold: true, italic: false },
    { text: 'x', bold: false, italic: true },
  ]);
  assert.equal(runsPlainText([{ text: 'a' }, { text: 'b' }]), 'ab');
});

test('runs: tab splitting distributes runs over segments', () => {
  const segs = splitRunsIntoSegments([
    { text: 'Offerte:', bold: false, italic: false },
    { text: '	AC', bold: true, italic: false },
    { text: '294', bold: true, italic: false },
  ], 2);
  assert.equal(segs.length, 2);
  assert.deepEqual(segs[0], [{ text: 'Offerte:', bold: false, italic: false }]);
  assert.deepEqual(segs[1], [{ text: 'AC294', bold: true, italic: false }]);
  // Doorbroken structuur: aantal segmenten klopt niet meer
  assert.equal(splitRunsIntoSegments([{ text: 'geen tab' }], 2), null);
});

test('standard font variant combines family class with run flags', () => {
  assert.equal(standardFontVariant('Helvetica', true, false), 'Helvetica-Bold');
  assert.equal(standardFontVariant('Helvetica-Bold', false, true), 'Helvetica-Oblique');
  assert.equal(standardFontVariant('TimesRoman-Italic', true, true), 'TimesRoman-BoldItalic');
  assert.equal(standardFontVariant('Courier-BoldOblique', false, false), 'Courier');
  assert.equal(standardFontVariant('', false, false), 'Helvetica');
});

test('tab grid: a typed tab lands the next segment on the block grid', () => {
  const measure = (t) => t.length * 6; // 6pt per teken (mock)
  const laid = layoutSegmentsOnTabGrid(['Stalen drijflichaam ', '27 x 6,5 meter'], {
    grid: 72, baseDx: 0, measure,
  });
  assert.equal(laid[0].dx, 0);
  // 20 tekens * 6 = 120 -> volgende stop = 144
  assert.equal(laid[1].dx, 144);
});

test('tab grid: multiple tabs advance stop by stop; empty segment still advances', () => {
  const measure = (t) => t.length * 10;
  const laid = layoutSegmentsOnTabGrid(['ab', '', 'x'], { grid: 36, baseDx: 5, measure });
  assert.equal(laid[0].dx, 5);
  assert.equal(laid[1].dx, 5 + 36);  // na 20pt tekst -> stop 36
  assert.equal(laid[2].dx, 5 + 72);  // leeg segment: pen blijft op 36 -> stop 72
});

test('tab grid: default grid applies when grid is missing', () => {
  const laid = layoutSegmentsOnTabGrid(['a', 'b'], { grid: 0, baseDx: 0, measure: () => 4 });
  assert.equal(laid[1].dx, 36);
});

test('bullet glyphs normalize to a readable WinAnsi-safe bullet', () => {
  assert.equal(normalizeBulletText(' Help with hobbies'), '• Help with hobbies');
  assert.equal(normalizeBulletText('● item'), '• item');
  assert.equal(normalizeBulletText('gewone tekst'), 'gewone tekst');
  // de bullet zelf overleeft de WinAnsi-sanering
  assert.equal(sanitizeWinAnsiText('• punt').text, '• punt');
});

test('runs: color splits merging and survives normalize', () => {
  const runs = normalizeRuns([
    { text: 'aa', bold: false },
    { text: 'bb', bold: false, color: '#ff0000' },
    { text: 'cc', bold: false, color: '#ff0000' },
  ]);
  assert.equal(runs.length, 2);
  assert.equal(runs[1].text, 'bbcc');
  assert.equal(runs[1].color, '#ff0000');
});

test('runs: color survives tab splitting into segments', () => {
  const segs = splitRunsIntoSegments([
    { text: 'Datum:\t', bold: false, italic: false, color: '#000000' },
    { text: '16 april', bold: false, italic: false, color: '#ff0000' },
    { text: ' 2026', bold: false, italic: false, color: '#000000' },
  ], 2);
  assert.equal(segs[1].length, 2);
  assert.equal(segs[1][0].color, '#ff0000');
  assert.equal(segs[1][1].color, '#000000');
});

// ── Fase C: reflow en uitlijningsdetectie ──

test('reflowBlockLines: te brede bewerkte regel wrapt vanaf de eerste wijziging', async () => {
  const { reflowBlockLines } = await import('./text-edit-appearance.js');
  const measure = (t) => t.length * 10; // 10pt per teken
  const orig = ['aaa bbb ccc', 'ddd eee fff', 'ggg'];
  const nieuw = ['aaa bbb ccc', 'ddd eee EXTRA WOORDEN fff', 'ggg'];
  const r = reflowBlockLines(orig, nieuw, { maxWidth: 120, measure });
  assert.equal(r.changed, true);
  // regel 0 (ongewijzigd) blijft exact staan
  assert.equal(r.lines[0], 'aaa bbb ccc');
  // alle gereflowde regels passen binnen de blokbreedte
  for (const l of r.lines.slice(1)) assert.ok(measure(l) <= 120, l);
  // alle woorden blijven aanwezig, in volgorde
  assert.equal(r.lines.slice(1).join(' '), 'ddd eee EXTRA WOORDEN fff ggg');
});

test('reflowBlockLines: geen reflow als alles past of niets wijzigde', async () => {
  const { reflowBlockLines } = await import('./text-edit-appearance.js');
  const measure = (t) => t.length * 10;
  const orig = ['aaa', 'bbb'];
  assert.equal(reflowBlockLines(orig, ['aaa', 'bbX'], { maxWidth: 100, measure }).changed, false);
  assert.equal(reflowBlockLines(orig, ['aaa', 'bbb'], { maxWidth: 10, measure }).changed, false);
});

test('reflowBlockLines: overflow gerapporteerd, niets afgekapt', async () => {
  const { reflowBlockLines } = await import('./text-edit-appearance.js');
  const measure = (t) => t.length * 10;
  const orig = ['korte regel'];
  const nieuw = ['woord1 woord2 woord3 woord4 woord5 woord6'];
  const r = reflowBlockLines(orig, nieuw, { maxWidth: 140, measure });
  assert.equal(r.changed, true);
  assert.ok(r.overflow >= 1);
  assert.equal(r.lines.join(' '), nieuw[0]); // geen woord verloren
});

test('reflowBlockLines: lege regel in de staart blokkeert samenvoegen', async () => {
  const { reflowBlockLines } = await import('./text-edit-appearance.js');
  const measure = (t) => t.length * 10;
  const orig = ['a', '', 'b'];
  const nieuw = ['a VEEL TE LANGE REGEL HIER', '', 'b'];
  assert.equal(reflowBlockLines(orig, nieuw, { maxWidth: 50, measure }).changed, false);
});

test('detectBlockAlignment: links, rechts en uitgevuld', async () => {
  const { detectBlockAlignment } = await import('./text-edit-appearance.js');
  // links: gelijke x, variabele breedte
  assert.equal(detectBlockAlignment([
    { x: 50, width: 200 }, { x: 50, width: 180 }, { x: 50, width: 120 },
  ]), 'left');
  // rechts: gelijke rechterrand, variabele linkerrand
  assert.equal(detectBlockAlignment([
    { x: 100, width: 150 }, { x: 130, width: 120 }, { x: 80, width: 170 },
  ]), 'right');
  // uitgevuld: links én rechts strak, laatste regel korter
  assert.equal(detectBlockAlignment([
    { x: 50, width: 200 }, { x: 50, width: 200 }, { x: 50, width: 90 },
  ]), 'justify');
  // te weinig regels → links
  assert.equal(detectBlockAlignment([{ x: 50, width: 200 }]), 'left');
});

test('buildLineSegments: uniforme woordspatiëring is geen kolomstructuur', async () => {
  const { buildLineSegments } = await import('./text-edit-appearance.js');
  // zes woorden met (vrijwel) gelijke brede gaps — uitgevulde regel
  const items = [];
  let x = 50;
  for (const w of ['een', 'twee', 'drie', 'vier', 'vijf', 'zes']) {
    const breedte = w.length * 6;
    items.push({ text: w, pdfX: x, pdfY: 700, pdfWidth: breedte, fontSize: 11 });
    x += breedte + 9; // gap 9pt ≈ 0.8×fs: boven de tab-drempel, maar uniform
  }
  const r = buildLineSegments(items, 0);
  assert.equal(r.segments, null);
  assert.equal(r.text, 'een twee drie vier vijf zes');
});

test('buildLineSegments: échte kolommen (2 segmenten) blijven tabs', async () => {
  const { buildLineSegments } = await import('./text-edit-appearance.js');
  const items = [
    { text: 'Offerte:', pdfX: 50, pdfY: 700, pdfWidth: 40, fontSize: 11 },
    { text: 'AC294', pdfX: 130, pdfY: 700, pdfWidth: 35, fontSize: 11 },
  ];
  const r = buildLineSegments(items, 0);
  assert.equal(r.text, 'Offerte:\tAC294');
  assert.equal(r.segments.length, 2);
});

test('buildLineSegments: veel segmenten met wisselende gaps blijven kolommen', async () => {
  const { buildLineSegments } = await import('./text-edit-appearance.js');
  const items = [
    { text: 'A', pdfX: 50, pdfY: 700, pdfWidth: 10, fontSize: 10 },
    { text: 'B', pdfX: 90, pdfY: 700, pdfWidth: 10, fontSize: 10 },   // gap 30
    { text: 'C', pdfX: 110, pdfY: 700, pdfWidth: 10, fontSize: 10 },  // gap 10
    { text: 'D', pdfX: 200, pdfY: 700, pdfWidth: 10, fontSize: 10 },  // gap 80
  ];
  const r = buildLineSegments(items, 0);
  assert.ok(r.text.includes('\t'));
});

test('buildLineSegments: pieces-concatenatie == regeltekst (alle modi)', async () => {
  const { buildLineSegments } = await import('./text-edit-appearance.js');
  const concat = (r) => (r.pieces || []).map(p => p.text).join('');
  // kolommen (tab)
  const kolommen = buildLineSegments([
    { text: 'Offerte:', pdfX: 50, pdfY: 700, pdfWidth: 40, fontSize: 11 },
    { text: 'AC294', pdfX: 130, pdfY: 700, pdfWidth: 35, fontSize: 11 },
  ]);
  assert.equal(concat(kolommen), kolommen.text);
  // doorlopend met woordspaties-spans
  const doorlopend = buildLineSegments([
    { text: 'Hallo', pdfX: 50, pdfY: 700, pdfWidth: 30, fontSize: 11 },
    { text: ' ', pdfX: 80, pdfY: 700, pdfWidth: 3, fontSize: 11 },
    { text: 'wereld', pdfX: 83, pdfY: 700, pdfWidth: 35, fontSize: 11 },
  ]);
  assert.equal(concat(doorlopend), doorlopend.text);
  assert.equal(doorlopend.text, 'Hallo wereld');
  // gespatieerde tekst (uniforme gaps → spaties)
  const items = [];
  let x = 50;
  for (const w of ['een', 'twee', 'drie', 'vier', 'vijf', 'zes']) {
    const b = w.length * 6;
    items.push({ text: w, pdfX: x, pdfY: 700, pdfWidth: b, fontSize: 11 });
    x += b + 9;
  }
  const gespatieerd = buildLineSegments(items);
  assert.equal(gespatieerd.segments, null);
  assert.equal(concat(gespatieerd), gespatieerd.text);
  // item-indexen verwijzen naar de juiste bron
  assert.equal(gespatieerd.pieces[0].item, 0);
  assert.equal(gespatieerd.pieces[1].item, 1);
  // enkel item
  const enkel = buildLineSegments([{ text: 'solo', pdfX: 1, pdfY: 2, pdfWidth: 20, fontSize: 10 }]);
  assert.equal(concat(enkel), 'solo');
});

test('pdfDeltaFromScreenDelta: inverse van de nudge-mapping bij alle rotaties', async () => {
  const { pdfDeltaFromScreenDelta, getPageRotationMatrix } = await import('./text-edit-appearance.js');
  const scale = 1.5;
  for (const rot of [0, 90, 180, 270]) {
    const m = getPageRotationMatrix(595, 842, rot);
    const [a, b, c, d] = m;
    for (const [dxPdf, dyPdf] of [[3, 0], [0, 4], [-2, 7]]) {
      // voorwaartse mapping zoals nudgeActiveTextEdit
      const unrotDy = -dyPdf;
      const sx = (a * dxPdf + c * unrotDy) * scale;
      const sy = (b * dxPdf + d * unrotDy) * scale;
      const terug = pdfDeltaFromScreenDelta(sx, sy, scale, m);
      assert.ok(Math.abs(terug.dx - dxPdf) < 1e-9, `rot ${rot} dx`);
      assert.ok(Math.abs(terug.dy - dyPdf) < 1e-9, `rot ${rot} dy`);
    }
  }
  // rotatie 0: scherm-y omlaag = pdf-y omlaag (dy negatief bij sy positief)
  const r0 = pdfDeltaFromScreenDelta(15, 30, 1.5, getPageRotationMatrix(595, 842, 0));
  assert.equal(r0.dx, 10);
  assert.equal(r0.dy, -20);
});

test('nieuwTekstblokRecord: vorm van een nieuw-blok-record', async () => {
  const { nieuwTekstblokRecord, textEditLineAnchor } = await import('./text-edit-appearance.js');
  const r = nieuwTekstblokRecord({ page: 3, pdfX: 120, pdfY: 500, fontSize: 14 });
  assert.equal(r.originalText, ''); // geen origineel → geen knip/afdekvlak
  assert.equal(r.numOriginalLines, 0);
  assert.equal(r._pendingNew, true);
  assert.equal(r.fontFamily, 'Helvetica');
  assert.equal(r.lineSpacing, 14 * 1.2);
  // meerregelige emissie gebruikt de bestaande regelafstand-ankers
  const l1 = textEditLineAnchor(r.pdfX, r.pdfY, 1, r.lineSpacing, 0);
  assert.equal(l1.x, 120);
  assert.ok(Math.abs(l1.y - (500 - 16.8)) < 1e-9);
});

test('userSpaceToApp/appToUserSpace: verschoven MediaBox (CAD-plot)', async () => {
  const { resolveTextEditPageGeometry, userSpaceToApp, appToUserSpace } =
    await import('./text-edit-appearance.js');
  // MediaBox [-846.24 -595.26 846.24 595.26] → breedte 1692.48, hoogte 1190.52
  const g = resolveTextEditPageGeometry(
    { widthPt: 1692.48, heightPt: 1190.52, rotation: 0, offsetXPt: -846.24, offsetYPt: -595.26 },
    1692.48, 1190.52, 0,
  );
  assert.equal(g.offsetXPt, -846.24);
  // tekst op user-space (-146.43, 217.32) ligt binnen de pagina in app-ruimte
  const a = userSpaceToApp(-146.4306, 217.32151, g);
  assert.ok(a.x > 0 && a.x < g.pageWidth, `app x binnen pagina: ${a.x}`);
  assert.ok(a.y > 0 && a.y < g.pageHeight, `app y binnen pagina: ${a.y}`);
  assert.ok(Math.abs(a.x - 699.81) < 0.01);
  assert.ok(Math.abs(a.y - 377.94) < 0.01);
  // round-trip
  const u = appToUserSpace(a.x, a.y, g);
  assert.ok(Math.abs(u.x - (-146.4306)) < 1e-6);
  assert.ok(Math.abs(u.y - 217.32151) < 1e-6);
});

test('userSpaceToApp: gewone (0,0)-pagina blijft de oude formule', async () => {
  const { resolveTextEditPageGeometry, userSpaceToApp } = await import('./text-edit-appearance.js');
  const g = resolveTextEditPageGeometry({ widthPt: 595, heightPt: 842, rotation: 0 }, 595, 842, 0);
  assert.equal(g.offsetXPt, 0);
  const a = userSpaceToApp(100, 700, g);
  assert.equal(a.x, 100);
  assert.equal(a.y, 142);
});
