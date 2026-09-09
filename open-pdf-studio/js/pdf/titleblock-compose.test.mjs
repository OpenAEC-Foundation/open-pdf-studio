import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName, decodePDFRawStream } from 'pdf-lib';

import { composeFrameWithTitleBlock, zichtbaarVak, KADER_MARGE_PT } from './titleblock-compose.js';

const R = new URL('../../src-tauri/resources/', import.meta.url);
const kader = readFileSync(new URL('kaders/grootformaat_a1_liggend.pdf', R));
const onderhoek = readFileSync(new URL('onderhoeken/openaec.pdf', R));

test('de meegeleverde onderhoek staat niet op de oorsprong (dat is precies het geval dat misging)', async () => {
  const d = await PDFDocument.load(onderhoek);
  const vak = zichtbaarVak(d.getPage(0));
  assert.ok(vak.left > 1000, `left=${vak.left}`);
  assert.ok(Math.abs((vak.right - vak.left) / (72 / 25.4) - 190) < 0.5, 'breedte 190 mm');
});

test('inbedding verschuift de inhoud naar de oorsprong en zet hem rechtsonder', async () => {
  const uit = await composeFrameWithTitleBlock(kader, onderhoek);
  const d = await PDFDocument.load(uit);
  const page = d.getPage(0);
  const xobjs = page.node.Resources().lookup(PDFName.of('XObject'));
  const namen = xobjs.keys();
  assert.equal(namen.length, 1, 'één ingebedde onderhoek');
  const form = d.context.lookup(xobjs.get(namen[0]));
  const bbox = form.dict.get(PDFName.of('BBox')).asArray().map(n => n.asNumber());
  const matrix = form.dict.get(PDFName.of('Matrix')).asArray().map(n => n.asNumber());
  // BBox omvat de oorspronkelijke inhoudscoördinaten; de matrix haalt ze naar (0,0).
  assert.ok(bbox[0] > 1000 && bbox[2] > bbox[0], `BBox ${bbox}`);
  assert.ok(Math.abs(matrix[4] + bbox[0]) < 1e-6 && Math.abs(matrix[5] + bbox[1]) < 1e-6, `Matrix ${matrix}`);
  // Geplaatst tegen de rechtermarge: x = velbreedte − marge − blokbreedte.
  const inhoud = Buffer.from(page.node.Contents ? '' : '').toString();
  const { width: vw } = page.getSize();
  const blokB = bbox[2] - bbox[0];
  const verwachtX = vw - KADER_MARGE_PT - blokB;
  const streams = page.node.Contents();
  const laatste = d.context.lookup(streams.get(streams.size() - 1));
  // De opgeslagen stream kan geflate't zijn: eerst decoderen.
  const bytes = laatste.dict.has(PDFName.of('Filter')) ? decodePDFRawStream(laatste).decode() : laatste.contents;
  const tekst = Buffer.from(bytes).toString('latin1');
  const m = tekst.match(/1 0 0 1 ([\d.]+) ([\d.]+) cm/);
  assert.ok(m, 'plaatsings-cm gevonden');
  assert.ok(Math.abs(parseFloat(m[1]) - verwachtX) < 0.01, `x ${m[1]} ≠ ${verwachtX}`);
  assert.ok(Math.abs(parseFloat(m[2]) - KADER_MARGE_PT) < 0.01, `y ${m[2]}`);
  void inhoud;
});
