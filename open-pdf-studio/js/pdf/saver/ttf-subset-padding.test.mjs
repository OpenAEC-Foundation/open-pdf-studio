import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFName, PDFDict, decodePDFRawStream } from 'pdf-lib';
import { metTrueTypeUitlijning } from './ttf-subset-padding.js';

const bytes = new Uint8Array(readFileSync(new URL('../../../scripts/font-native-tests/fixtures/odd-glyphs.ttf', import.meta.url)));
async function subset(kit) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(kit);
  const f = await pdf.embedFont(bytes, { subset: true });
  const cid = parseInt(f.encodeText('A').asString().slice(0, 4), 16);
  pdf.addPage().drawText('A A', { font: f });
  const doc = await PDFDocument.load(await pdf.save());
  const font = doc.context.lookup(f.ref, PDFDict);
  const descendant = doc.context.lookup(font.lookup(PDFName.of('DescendantFonts')).get(0), PDFDict);
  const stream = descendant.lookup(PDFName.of('FontDescriptor'), PDFDict).lookup(PDFName.of('FontFile2'));
  return { font: fontkit.create(decodePDFRawStream(stream).decode()), cid };
}

test('odd TrueType glyph offsets survive subsetting with identical outlines', async () => {
  const original = fontkit.create(bytes);
  assert.ok(original.loca.offsets.some(n => n % 2), 'fixture exercises odd glyph boundaries');
  const expected = original.glyphForCodePoint(65).path.commands;
  const fixed = await subset(metTrueTypeUitlijning(fontkit));
  assert.deepEqual(fixed.font.getGlyph(fixed.cid).path.commands, expected);
  assert.ok(fixed.font.loca.offsets.every(n => n % 2 === 0));
  assert.deepEqual(fixed.font.getGlyph(0).path.commands, original.getGlyph(0).path.commands);
});

test('unpatched fontkit loses the odd boundary in its short loca table', async () => {
  const broken = await subset(fontkit);
  const expected = fontkit.create(bytes).glyphForCodePoint(65).path.commands;
  let actual;
  try { actual = broken.font.getGlyph(broken.cid).path.commands; } catch { actual = null; }
  assert.notDeepEqual(actual, expected, 'upstream bug remains reproduced by this fixture');
});
