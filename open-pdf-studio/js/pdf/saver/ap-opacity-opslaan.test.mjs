// Een vlak met 40% doorzichtigheid moet ook in lezers die de opgeslagen
// appearance tonen (i.p.v. hem uit /CA op te bouwen) op 40% staan.
import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFDict, decodePDFRawStream } from 'pdf-lib';

import { attachVectorAP } from './vector-ap.js';
import { buildFilledAreaAP } from './appearance-vectors.js';

const RECT = [100, 100, 200, 200];

async function opgeslagen(ca, fillAlpha) {
  const doc = await PDFDocument.create();
  const context = doc.context;
  const annot = context.obj({ Type: 'Annot', Subtype: 'Polygon', Rect: RECT, ...(ca === undefined ? {} : { CA: ca }) });
  const built = fillAlpha === undefined
    ? buildFilledAreaAP({
      points: [{ x: 10, y: 10 }, { x: 60, y: 10 }, { x: 60, y: 60 }],
      holes: [], X: (x) => 100 + x, Y: (y) => 100 + y,
      fillColorHex: '#ff00ff', strokeColorHex: '#ff0000', heeftRand: true,
      lineWidth: 1, borderStyle: 'solid',
    })
    : { content: 'q\n/GSf gs\n1 0 1 rg\n10 10 m\n60 10 l\n60 60 l\nh\nf\nQ\n', fillAlpha };
  attachVectorAP(context, annot, built, RECT);
  const heropend = await PDFDocument.load(await doc.save());
  // Terug uit de opgeslagen bytes: het eerste (enige) vorm-XObject.
  let form = null;
  for (const [, obj] of heropend.context.enumerateIndirectObjects()) {
    if (obj.dict?.get(PDFName.of('Subtype'))?.toString() === '/Form') form = obj;
  }
  const inhoud = Buffer.from(decodePDFRawStream(form).decode()).toString('latin1');
  const res = form.dict.lookup(PDFName.of('Resources'), PDFDict);
  const gs = res.get(PDFName.of('ExtGState'));
  const gsd = gs && heropend.context.lookup(gs, PDFDict);
  const staat = (naam) => {
    const d = gsd?.lookupMaybe(PDFName.of(naam), PDFDict);
    return d && { ca: d.get(PDFName.of('ca'))?.asNumber(), CA: d.get(PDFName.of('CA'))?.asNumber() };
  };
  return { inhoud, GSo: staat('GSo'), GSf: staat('GSf'), heeftGs: !!gsd };
}

test('met /CA 0,4 begint de appearance met /GSo gs en bevat de alfa voor vulling en lijn', async () => {
  const r = await opgeslagen(0.4);
  assert.ok(r.inhoud.startsWith('/GSo gs\n'), r.inhoud.slice(0, 40));
  assert.deepEqual(r.GSo, { ca: 0.4, CA: 0.4 });
});

test('zonder /CA of met /CA 1 blijft de appearance onveranderd', async () => {
  for (const ca of [undefined, 1]) {
    const r = await opgeslagen(ca);
    assert.ok(!r.inhoud.includes('/GSo gs'));
    assert.equal(r.heeftGs, false);
  }
});

test('aparte vul-alfa wordt met de algemene vermenigvuldigd', async () => {
  const r = await opgeslagen(0.5, 0.5);
  assert.deepEqual(r.GSo, { ca: 0.5, CA: 0.5 });
  assert.equal(r.GSf.ca, 0.25);
});
