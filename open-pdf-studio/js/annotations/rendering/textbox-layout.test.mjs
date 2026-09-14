import assert from 'node:assert/strict';
import test from 'node:test';

import { layoutTextboxLines, textboxLineRuns, hasMixedRuns, runsToText } from './textbox-layout.js';

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
  // in plaats van af te breken zoals Acrobat.
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
