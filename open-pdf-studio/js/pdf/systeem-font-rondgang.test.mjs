// #1066: real saver, IPC face selection, embedded AP and DA resources.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { PDFName, PDFDict, decodePDFRawStream } from 'pdf-lib';
import * as mupdf from 'mupdf';
import { leegBlad, opslaan, woordenboeken, laad } from './rondgang.testhulp.mjs';
const text = process.env.OPDS_TEST_FONT_TEXT || 'A A';
const data = new Uint8Array(readFileSync(process.env.OPDS_TEST_FONT_FACE || new URL('../../scripts/font-native-tests/fixtures/installed.ttf', import.meta.url)));

test('textbox and callout embed the requested collection face in AP and DA', async () => {
  const requests = [];
  const annotations = ['textbox', 'callout'].map((type, i) => ({
    id: `font-${i}`, page: 1, type, x: 60, y: 60 + i * 100, width: 220, height: 60,
    text, fontSize: 18, fontFamily: 'Collection Family', rotation: 0,
    strokeColor: '#000000', fillColor: null, textColor: '#000000', lineWidth: 1, opacity: 1,
    ...(type === 'callout' ? { points: [{ x: 20, y: 240 }, { x: 40, y: 190 }, { x: 60, y: 190 }] } : {}),
  }));
  const bytes = await opslaan(await leegBlad(), annotations, { impl: {
    isTauri: () => true,
    invoke: async (command, args) => {
      if (command === 'systeem_lettertype_zoeken') return { pad: '/fonts/family.ttc', gezicht: 1, exact: true, insluitbaar: true, subset: true };
      if (command === 'systeem_lettertype_lezen') { requests.push(args); return data; }
    },
  } });
  assert.deepEqual(requests, [{ pad: '/fonts/family.ttc', gezicht: 1 }]);
  const dicts = await woordenboeken(bytes);
  const doc = dicts.doc;
  const dr = doc.catalog.lookup(PDFName.of('AcroForm'), PDFDict).lookup(PDFName.of('DR'), PDFDict).lookup(PDFName.of('Font'), PDFDict);
  for (const { dict } of dicts) {
    const ap = dict.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N'));
    const fonts = ap.dict.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('Font'), PDFDict);
    const daName = /\/(\S+) [\d.]+ Tf/.exec(dict.lookup(PDFName.of('DA')).decodeText())[1];
    const ref = dr.get(PDFName.of(daName));
    const embedded = doc.context.lookup(ref, PDFDict);
    assert.equal(embedded.get(PDFName.of('Subtype')).toString(), '/Type0', 'DA resolves to the embedded font, not an unembedded name');
    assert.equal(fonts.get(PDFName.of(daName)).toString(), ref.toString(), 'AP and DA share a font');
    const cid = doc.context.lookup(embedded.lookup(PDFName.of('DescendantFonts')).get(0), PDFDict);
    const fd = cid.lookup(PDFName.of('FontDescriptor'), PDFDict);
    assert.ok(fd.get(PDFName.of('FontFile2')) || fd.get(PDFName.of('FontFile3')));
    assert.ok(cid.lookup(PDFName.of('W')).size());
    const content = Buffer.from(decodePDFRawStream(ap).decode()).toString('latin1');
    assert.match(content, /<[0-9A-F]+> Tj/);
  }
  const reopened = await laad(bytes);
  assert.equal(reopened.length, 2);
  assert.ok(reopened.every(a => a.text === text && a.fontFamily === 'Collection Family'), JSON.stringify(reopened.map(a => ({text:a.text,font:a.fontFamily}))));
  const rendered = mupdf.Document.openDocument(bytes, 'application/pdf');
  const pixmap = rendered.loadPage(0).toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, true);
  assert.ok(pixmap.getPixels().some(v => v < 200), 'independent renderer paints glyphs');
  if (process.env.OPDS_TEST_FONT_PDF) writeFileSync(process.env.OPDS_TEST_FONT_PDF, bytes);
  pixmap.destroy(); rendered.destroy();
});
