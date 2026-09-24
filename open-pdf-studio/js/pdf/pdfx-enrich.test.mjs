// PDF/X-verrijking (#239, #422): output-intent, XMP, TrimBox, /Info.
//
// Met "sRGB — geen omzetting" moet de uitvoer byte voor byte gelijk blijven
// aan wat de export vóór #422 schreef. De twee hashes hieronder zijn berekend
// met de code van toen (enrichForPdfX uit pdfx-export.js, ongewijzigd
// overgenomen) op precies deze vaste invoer, met een bevroren klok.

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { PDFDocument, PDFName, StandardFonts, rgb } from 'pdf-lib';

const FIXED = Date.UTC(2026, 0, 2, 3, 4, 5);
const RealDate = Date;
class FrozenDate extends RealDate {
  constructor(...a) {
    if (a.length) super(...a);
    else super(FIXED);
  }
  static now() {
    return FIXED;
  }
}
globalThis.Date = FrozenDate;

const { buildPdfxBytes } = await import('./pdfx-enrich.js');

async function fixture() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 100]);
  page.drawRectangle({ x: 10, y: 10, width: 50, height: 30, color: rgb(1, 0, 0) });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('PDF/X', { x: 70, y: 40, size: 12, font });
  return doc.save();
}

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('sRGB zonder omzetting: PDF/X-3 byte voor byte gelijk aan de export van vóór #422', async () => {
  const out = await buildPdfxBytes(await fixture(), { conformance: 'X-3', title: 'Vaste invoer' });
  assert.equal(out.length, 2710);
  assert.equal(sha(out), 'd6c3004f0fdd21a4e359e3139afdd36b3764eec4250d1cbcfa7b4801b74513a4');
});

test('sRGB zonder omzetting: PDF/X-4 byte voor byte gelijk aan de export van vóór #422', async () => {
  const out = await buildPdfxBytes(await fixture(), { conformance: 'X-4', title: 'Vaste invoer' });
  assert.equal(out.length, 2705);
  assert.equal(sha(out), 'd27d4b0b19a27c4fabdb006213dc7184a199409befaa031e581fe7a1caa5de3f');
});

test('met een CMYK-profiel: output-intent met N 4, de profielnaam en het profiel zelf', async () => {
  const profile = new Uint8Array(600).map((_, i) => (i * 7) & 0xff);
  const out = await buildPdfxBytes(await fixture(), {
    conformance: 'X-4',
    title: 'Vaste invoer',
    outputProfile: { bytes: profile, name: 'Gestreken papier 2026' },
  });
  const doc = await PDFDocument.load(out);
  const intents = doc.catalog.lookup(PDFName.of('OutputIntents'));
  assert.equal(intents.size(), 1);
  const intent = intents.lookup(0);
  assert.equal(intent.get(PDFName.of('S')).toString(), '/GTS_PDFX');
  assert.equal(intent.get(PDFName.of('OutputConditionIdentifier')).decodeText(), 'Gestreken papier 2026');
  assert.equal(intent.get(PDFName.of('Info')).decodeText(), 'Gestreken papier 2026');
  const icc = intent.lookup(PDFName.of('DestOutputProfile'));
  assert.equal(icc.dict.get(PDFName.of('N')).asNumber(), 4);
  assert.equal(icc.dict.get(PDFName.of('Filter')).toString(), '/FlateDecode');
  assert.deepEqual(new Uint8Array(inflateSync(icc.getContents())), profile);
  // XMP en TrimBox zoals bij sRGB.
  assert.ok(doc.catalog.get(PDFName.of('Metadata')));
  assert.ok(doc.getPage(0).node.get(PDFName.of('TrimBox')));
});

test('een profielnaam met niet-ASCII-tekens blijft leesbaar', async () => {
  const out = await buildPdfxBytes(await fixture(), {
    conformance: 'X-3',
    title: 'x',
    outputProfile: { bytes: new Uint8Array(8), name: 'Offset — geïllustreerd' },
  });
  const doc = await PDFDocument.load(out);
  const intent = doc.catalog.lookup(PDFName.of('OutputIntents')).lookup(0);
  assert.equal(intent.get(PDFName.of('OutputConditionIdentifier')).decodeText(), 'Offset — geïllustreerd');
});
