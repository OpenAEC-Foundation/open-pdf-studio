// Het font van een tekstvak-appearance (#512). Een niet-standaard font als
// /SegoeUI zonder /FontDescriptor vervangt MuPDF door een schreefletter (Times);
// met een FontDescriptor zonder Serif-vlag kiest het een schreefloze letter.
// De 14 standaardfonts hebben geen FontDescriptor nodig.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName } from 'pdf-lib';

import { tekstvakFontDict } from './utils.js';

const veld = (doc, dict, naam) => doc.context.lookup(dict.get(PDFName.of(naam)));

test('een standaardfont blijft een kaal Type1-font', async () => {
  const doc = await PDFDocument.create();
  const font = tekstvakFontDict(doc.context, 'Helvetica-Bold');
  assert.equal(veld(doc, font, 'BaseFont').asString(), '/Helvetica-Bold');
  assert.equal(font.get(PDFName.of('FontDescriptor')), undefined);
});

test('een ander font krijgt een schreefloze FontDescriptor', async () => {
  const doc = await PDFDocument.create();
  const font = tekstvakFontDict(doc.context, 'SegoeUI');
  assert.equal(veld(doc, font, 'BaseFont').asString(), '/SegoeUI');
  const fd = veld(doc, font, 'FontDescriptor');
  assert.equal(veld(doc, fd, 'FontName').asString(), '/SegoeUI');
  const vlaggen = veld(doc, fd, 'Flags').asNumber();
  assert.equal(vlaggen & 32, 32, 'niet-symbolisch');
  assert.equal(vlaggen & 2, 0, 'geen schreef');
  assert.equal(veld(doc, fd, 'ItalicAngle').asNumber(), 0);
});

test('vet en cursief staan in de FontDescriptor', async () => {
  const doc = await PDFDocument.create();
  const fd = veld(doc, tekstvakFontDict(doc.context, 'SegoeUI-BoldItalic'), 'FontDescriptor');
  const vlaggen = veld(doc, fd, 'Flags').asNumber();
  assert.equal(vlaggen & 64, 64, 'cursief');
  assert.equal(vlaggen & 262144, 262144, 'vet');
  assert.ok(veld(doc, fd, 'ItalicAngle').asNumber() < 0);
});

test('een schreeffont krijgt de Serif-vlag, zodat de vervanger ook een schreefletter is', async () => {
  const doc = await PDFDocument.create();
  for (const naam of ['Georgia', 'Cambria-Bold', 'Garamond', 'BookAntiqua', 'PalatinoLinotype', 'TimesNewRoman', 'Constantia']) {
    const vlaggen = veld(doc, veld(doc, tekstvakFontDict(doc.context, naam), 'FontDescriptor'), 'Flags').asNumber();
    assert.equal(vlaggen & 2, 2, `${naam} heeft schreven`);
  }
});

test('een monospace-font krijgt de FixedPitch-vlag', async () => {
  const doc = await PDFDocument.create();
  for (const naam of ['Consolas', 'CourierNew', 'LucidaConsole', 'CascadiaMono']) {
    const vlaggen = veld(doc, veld(doc, tekstvakFontDict(doc.context, naam), 'FontDescriptor'), 'Flags').asNumber();
    assert.equal(vlaggen & 1, 1, `${naam} is monospace`);
  }
});

test('een schreefloos font houdt beide vlaggen uit', async () => {
  const doc = await PDFDocument.create();
  for (const naam of ['SegoeUI', 'Calibri', 'Verdana', 'MicrosoftSansSerif', 'OpenSans']) {
    const vlaggen = veld(doc, veld(doc, tekstvakFontDict(doc.context, naam), 'FontDescriptor'), 'Flags').asNumber();
    assert.equal(vlaggen & 3, 0, `${naam} is schreefloos en proportioneel`);
  }
});
