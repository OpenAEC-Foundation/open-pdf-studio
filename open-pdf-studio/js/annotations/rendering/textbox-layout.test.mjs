import assert from 'node:assert/strict';
import test from 'node:test';

import { layoutTextboxLines, textboxLineRuns, hasMixedRuns, runsToText, pasRegelafstandAanDoos } from './textbox-layout.js';

// Meetfunctie: 10 per teken, vet 12 per teken.
const meet = (t, bold) => t.length * (bold ? 12 : 10);
const tekst = (lines) => lines.map(l => l.chunks.map(c => c.text).join('')).join('|');

test('zonder runs: één run per regel in de basisstijl', () => {
  const r = textboxLineRuns({ text: 'a\n\nb', fontBold: true });
  assert.deepEqual(r, [[{ text: 'a', bold: true, italic: false }], [], [{ text: 'b', bold: true, italic: false }]]);
});

test('verouderde runs (tekst gewijzigd) worden genegeerd', () => {
  const ann = { text: 'nieuw', textRuns: [[{ text: 'oud', bold: true }]] };
  assert.deepEqual(textboxLineRuns(ann), [[{ text: 'nieuw', bold: false, italic: false }]]);
  assert.equal(hasMixedRuns(ann), false);
});

test('regelafbraak per woord, identiek aan het oude gedrag bij één stijl', () => {
  const lines = layoutTextboxLines({ text: 'een twee drie vier' }, 95, meet);
  // "een twee" = 8 tekens = 80; "een twee drie" = 130 > 95 → afbreken.
  assert.equal(tekst(lines), 'een twee|drie vier');
  assert.equal(lines[0].width, 80);
});

test('vet woord midden in een regel wordt een eigen chunk en meet zwaarder', () => {
  const ann = { text: 'wanden: 10-100', textRuns: [[{ text: 'wanden', bold: true }, { text: ': 10-100' }]] };
  assert.equal(hasMixedRuns(ann), true);
  const lines = layoutTextboxLines(ann, 1000, meet);
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0].chunks.map(c => [c.text, c.bold]), [['wanden', true], [': 10-100', false]]);
  assert.equal(lines[0].width, 6 * 12 + 8 * 10);
});

test('afbreken houdt de opmaak van het afgebroken woord', () => {
  const ann = { text: 'aa bb cc', textRuns: [[{ text: 'aa bb ' }, { text: 'cc', bold: true }]] };
  const lines = layoutTextboxLines(ann, 55, meet); // "aa bb" = 50 past; "aa bb cc" niet
  assert.equal(tekst(lines), 'aa bb|cc');
  assert.equal(lines[1].chunks[0].bold, true);
});

test('lege regels blijven lege regels; spaties aan het regeleinde tellen niet', () => {
  const lines = layoutTextboxLines({ text: 'a \n\nb' }, 1000, meet);
  assert.equal(lines.length, 3);
  assert.deepEqual(lines[1], { chunks: [], width: 0 });
  assert.equal(lines[0].width, 10);
});

test('runsToText is de inverse van de run-regels', () => {
  const runs = [[{ text: 'x', bold: true }, { text: 'y' }], [], [{ text: 'z' }]];
  assert.equal(runsToText(runs), 'xy\n\nz');
});

test('CJK-tekst breekt per teken af (geen spaties tussen "woorden")', () => {
  // Zonder spaties is een hele CJK-zin één onafbreekbaar "woord" tenzij elk
  // teken zijn eigen afbreekpunt is — anders overschrijdt de regel maxWidth
  // in plaats van af te breken zoals andere editors doen.
  const lines = layoutTextboxLines({ text: '土壤地面須種植地被植物及灌木以容許車道闊度最多達' }, 100, meet);
  assert.ok(lines.length > 1, 'CJK-tekst moet over meerdere regels afbreken');
  for (const l of lines) assert.ok(l.width <= 100, `regel "${tekst([l])}" (${l.width}) overschrijdt maxWidth`);
});

test('CJK- en Latijnse tekst gemengd: Latijnse woorden blijven heel, CJK breekt per teken', () => {
  const lines = layoutTextboxLines({ text: 'max 4米車道' }, 45, meet);
  // "max 4米" = 6 tekens = 60 > 45, dus "max" (30) + "4米" moet apart.
  assert.ok(lines.length > 1);
  assert.equal(lines[0].chunks.map(c => c.text).join(''), 'max');
});

test('zonder runs: annotation.fontUnderline/fontStrikethrough komen in de basisstijl terecht', () => {
  const r = textboxLineRuns({ text: 'a', fontUnderline: true });
  assert.deepEqual(r, [[{ text: 'a', bold: false, italic: false, underline: true }]]);
  const r2 = textboxLineRuns({ text: 'a', fontStrikethrough: true });
  assert.deepEqual(r2, [[{ text: 'a', bold: false, italic: false, strikethrough: true }]]);
});

test('alleen de eerste regel onderstreept (externe /RC-kop): per-chunk underline, geen box-brede vlag', () => {
  const ann = {
    text: 'Kop\nrest',
    textRuns: [[{ text: 'Kop', underline: true }], [{ text: 'rest' }]],
  };
  assert.equal(hasMixedRuns(ann), true);
  const lines = layoutTextboxLines(ann, 1000, meet);
  assert.equal(lines[0].chunks[0].underline, true);
  assert.equal(lines[1].chunks[0].underline, undefined);
});

test('afbreken houdt underline/strikethrough van het afgebroken woord vast', () => {
  const ann = { text: 'aa bb cc', textRuns: [[{ text: 'aa bb ' }, { text: 'cc', underline: true, strikethrough: true }]] };
  const lines = layoutTextboxLines(ann, 55, meet);
  assert.equal(tekst(lines), 'aa bb|cc');
  assert.equal(lines[1].chunks[0].underline, true);
  assert.equal(lines[1].chunks[0].strikethrough, true);
});

test('inladen: onwaarschijnlijke regelafstand wordt passend gemaakt, de doos groeit niet', () => {
  // Kaartlabel: 4pt met line-height:18.4pt (4,6x) in een doos van 9pt, rand 0,5pt.
  const r = pasRegelafstandAanDoos({ lineSpacing: 4.6, fontSize: 4, boxHeight: 9, padding: 0.5, neededHeight: 1 + 18.4 });
  assert.equal(r.height, 9);
  assert.equal(r.lineSpacing, 2);
});

test('inladen: past de inhoud al, dan verandert er niets', () => {
  assert.deepEqual(
    pasRegelafstandAanDoos({ lineSpacing: undefined, fontSize: 10, boxHeight: 30, padding: 1, neededHeight: 14 }),
    { lineSpacing: undefined, height: 30 },
  );
  assert.deepEqual(
    pasRegelafstandAanDoos({ lineSpacing: 4.6, fontSize: 4, boxHeight: 30, padding: 0, neededHeight: 18.4 }),
    { lineSpacing: 4.6, height: 30 },
  );
});

test('inladen: normale regelafstand in een te krappe doos groeit zoals voorheen', () => {
  // Twee regels 12pt x 1,2 plus rand 1 in een doos van 20.
  assert.deepEqual(
    pasRegelafstandAanDoos({ lineSpacing: 1.2, fontSize: 12, boxHeight: 20, padding: 1, neededHeight: 30.8 }),
    { lineSpacing: 1.2, height: 30.8 },
  );
  assert.deepEqual(
    pasRegelafstandAanDoos({ lineSpacing: 2, fontSize: 10, boxHeight: 25, padding: 0, neededHeight: 40 }),
    { lineSpacing: 2, height: 40 },
  );
});

test('inladen: onwaarschijnlijke afstand die ook op 1x niet past, groeit met de standaardafstand', () => {
  // Drie regels 10pt met afstand 4 hebben 120 nodig; in een doos van 20 past ook 1x (30) niet.
  const r = pasRegelafstandAanDoos({ lineSpacing: 4, fontSize: 10, boxHeight: 20, padding: 0, neededHeight: 120 });
  assert.equal(r.lineSpacing, 1.2);
  assert.equal(r.height, 36);
});

test('inladen: zonder geldige lettergrootte blijft het oude groeigedrag', () => {
  assert.deepEqual(
    pasRegelafstandAanDoos({ lineSpacing: 4.6, fontSize: 0, boxHeight: 9, padding: 0, neededHeight: 19 }),
    { lineSpacing: 4.6, height: 19 },
  );
});
