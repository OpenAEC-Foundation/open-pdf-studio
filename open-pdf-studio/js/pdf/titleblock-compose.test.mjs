import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName, decodePDFRawStream } from 'pdf-lib';

import { composeFrameWithTitleBlock, zichtbaarVak, KADER_MARGE_PT, schaalDa, veldTransform } from './titleblock-compose.js';

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

// --- invulvelden ----------------------------------------------------------
//
// De onderhoek draagt zijn invulbare waarden als FreeText-annotaties
// (projectnaam, schaal, datum, ...). embedPage walst de pagina plat tot een
// XObject en gooit annotaties weg, dus zonder extra werk houd je een bladhoofd
// over met lege hokjes en niets om in te typen.

test('de onderhoek draagt zijn invulvelden als FreeText-annotaties', async () => {
  const d = await PDFDocument.load(onderhoek);
  const annots = d.getPage(0).node.lookup(PDFName.of('Annots'));
  assert.ok(annots && annots.size() >= 10, `verwachtte invulvelden, kreeg ${annots ? annots.size() : 0}`);
});

test('na samenstellen staan de invulvelden als annotatie op het vel', async () => {
  const uit = await composeFrameWithTitleBlock(kader, onderhoek);
  const d = await PDFDocument.load(uit);
  const page = d.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'geen annotaties op het samengestelde vel');
  const namen = [];
  for (let i = 0; i < annots.size(); i++) {
    const a = d.context.lookup(annots.get(i));
    const t = a.get(PDFName.of('T'));
    if (t) namen.push(t.decodeText ? t.decodeText() : t.value);
  }
  for (const verwacht of ['projectnaam', 'schaal', 'datum_eerste', 'auteur', 'projectnr']) {
    assert.ok(namen.includes(verwacht), `veld '${verwacht}' ontbreekt; gevonden: ${namen.join(', ')}`);
  }
});

test('de invulvelden liggen binnen het vel, rechtsonder bij het bladhoofd', async () => {
  const uit = await composeFrameWithTitleBlock(kader, onderhoek);
  const d = await PDFDocument.load(uit);
  const page = d.getPage(0);
  const { width: vw, height: vh } = page.getSize();
  const annots = page.node.lookup(PDFName.of('Annots'));
  for (let i = 0; i < annots.size(); i++) {
    const a = d.context.lookup(annots.get(i));
    const r = a.get(PDFName.of('Rect')).asArray().map((n) => n.asNumber());
    assert.ok(r[0] >= 0 && r[1] >= 0 && r[2] <= vw && r[3] <= vh, `veld valt buiten het vel: ${r}`);
    // Het bladhoofd staat rechtsonder: elk veld hoort in de rechterhelft en de onderste helft.
    assert.ok(r[0] > vw / 2, `veld niet in de rechterhelft: ${r}`);
    assert.ok(r[3] < vh / 2, `veld niet in de onderste helft: ${r}`);
  }
});

test('een onderhoek zonder invulvelden stelt gewoon samen', async () => {
  const kaal = await PDFDocument.create();
  const kp = kaal.addPage([200, 100]);
  kp.drawRectangle({ x: 5, y: 5, width: 190, height: 90 });   // pdf-lib kan een pagina zonder inhoud niet inbedden
  const uit = await composeFrameWithTitleBlock(kader, await kaal.save());
  const d = await PDFDocument.load(uit);
  assert.equal(d.getPageCount(), 1);
});

test('schaalDa schaalt alleen de puntgrootte, niet de rest van de opmaak', () => {
  assert.equal(schaalDa('0 g /Helv 9 Tf', 0.5), '0 g /Helv 4.5 Tf');
  assert.equal(schaalDa('0 0 1 rg /F1 12 Tf', 2), '0 0 1 rg /F1 24 Tf');
  assert.equal(schaalDa('0 g /Helv 9 Tf', 1), '0 g /Helv 9 Tf', 'factor 1 laat alles staan');
  assert.equal(schaalDa(null, 0.5), null);
});

test('veldTransform legt een bronpunt op dezelfde plek als het lijnwerk', () => {
  const vak = { left: 100, bottom: 50, right: 300, top: 150 };
  const naar = veldTransform({ vak, factor: 0.5, doelX: 1000, doelY: 20 });
  // De linkerbenedenhoek van het vak valt op de plaatsingshoek.
  assert.deepEqual(naar(100, 50), { x: 1000, y: 20 });
  // De rechterbovenhoek op factor x de afmetingen daarvandaan.
  assert.deepEqual(naar(300, 150), { x: 1100, y: 70 });
});
