// OCR die een gescande pagina doorzoekbaar moet maken (#880). Gemelde klacht:
// OCR meldt "klaar", maar de gescande pagina's worden niet doorzoekbaar.
//
// - Plaatsing: de herkende woorden staan in de getoonde (gedraaide)
//   paginaruimte. Op een pagina met /Rotate 90/180/270 schreef de tekstlaag ze
//   eerst alsof de pagina ongedraaid was: de tekst viel naast de pagina.
// - Een echte scan (alleen een beeld, inhoud zonder q/Q, bronnen geërfd van de
//   paginaboom): het beeld blijft en de tekst is te vinden, in MuPDF en pdf.js.
// - Stand: tot het opslaan staan de woorden alleen in het geheugen; zoeken in
//   de app neemt ze dan mee (metOcrWoorden), en niet dubbel zodra ze in het
//   bestand staan.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import * as mupdf from 'mupdf';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, degrees } from 'pdf-lib';
import { embedOcrFont, writeOcrTextLayer, writeOcrLayers } from './saver/ocr-text-layer.js';
import {
  ocrWoordPlaatsing, ocrPaginaSignaturen, ongeschrevenOcrWoorden, heeftOngeschrevenOcr, metOcrWoorden,
} from './ocr-laag.js';
import { matchBoxInPageFrame } from '../search/match-rect.js';

const FONT = readFileSync(new URL('../../public/pdfjs/web/standard_fonts/LiberationSans-Regular.ttf', import.meta.url));

/** Waar MuPDF `woord` vindt, als { x0, y0, x1, y1 } in de getoonde pagina, en de paginamaat. */
function vind(bytes, woord, i = 0) {
  const pagina = mupdf.Document.openDocument(bytes, 'application/pdf').loadPage(i);
  const [bx0, by0, bx1, by1] = pagina.getBounds();
  const treffers = pagina.search(woord);
  if (!treffers.length) return { treffer: null, breed: bx1 - bx0, hoog: by1 - by0 };
  const q = treffers[0][0];
  const xs = [q[0], q[2], q[4], q[6]];
  const ys = [q[1], q[3], q[5], q[7]];
  return {
    treffer: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) },
    breed: bx1 - bx0,
    hoog: by1 - by0,
  };
}

/** Een woord in de getoonde ruimte rechtsboven op een pagina van 200x300 (gedraaid of niet). */
function woordRechtsboven(rot) {
  const breed = rot % 180 ? 300 : 200;
  return { text: 'Hello', left: breed - 80, top: 20, width: 50, height: 12 };
}

async function paginaMetLaag(rot, opties) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 300]);
  page.setRotation(degrees(rot));
  const font = await embedOcrFont(doc, FONT);
  writeOcrTextLayer(page, [woordRechtsboven(rot)], font, opties);
  return new Uint8Array(await doc.save());
}

for (const rot of [0, 90, 180, 270]) {
  test(`gedraaide pagina (/Rotate ${rot}): het woord staat waar het herkend werd, op de pagina`, async () => {
    const w = woordRechtsboven(rot);
    const { treffer, breed, hoog } = vind(await paginaMetLaag(rot), 'Hello');
    assert.ok(treffer, 'het woord is te vinden');
    assert.ok(treffer.x0 >= 0 && treffer.y0 >= 0 && treffer.x1 <= breed && treffer.y1 <= hoog,
      `binnen de pagina ${breed}x${hoog}: ${JSON.stringify(treffer)}`);
    assert.ok(Math.abs(treffer.x0 - w.left) < 2, `links ${treffer.x0} ~ ${w.left}`);
    assert.ok(Math.abs(treffer.x1 - (w.left + w.width)) < 2, `rechts ${treffer.x1} ~ ${w.left + w.width}`);
    assert.ok(treffer.y1 > w.top && treffer.y0 < w.top + w.height, `regel ${treffer.y0}-${treffer.y1} rond ${w.top}`);
    assert.ok(treffer.x1 - treffer.x0 > treffer.y1 - treffer.y0, 'de tekst loopt horizontaal in de weergave');
  });
}

test('zo ging het eerst: op een gedraaide pagina viel de tekst naast de pagina', async () => {
  // rotation: 0 = de oude omrekening, die de draaiing van de pagina negeerde.
  for (const rot of [90, 270]) {
    const { treffer, breed, hoog } = vind(await paginaMetLaag(rot, { rotation: 0 }), 'Hello');
    const opPagina = treffer && treffer.x0 >= 0 && treffer.y0 >= 0 && treffer.x1 <= breed && treffer.y1 <= hoog;
    assert.equal(opPagina, false, `rot ${rot}: ${JSON.stringify(treffer)}`);
  }
});

// Zoals scanners schrijven: een paginagroot beeld zonder q/Q (de cm blijft
// staan), bronnen en paginamaat geërfd van de paginaboom, en een CropBox die
// niet op 0,0 begint.
function scanPdf() {
  const obj = [];
  const stroom = (dict, data) => `<< ${dict} /Length ${data.length} >>\nstream\n${data}\nendstream`;
  obj.push([1, '<< /Type /Catalog /Pages 2 0 R >>']);
  obj.push([2, '<< /Type /Pages /Kids [3 0 R] /Count 1 /Resources << /XObject << /Im0 5 0 R >> >> /MediaBox [0 0 220 320] >>']);
  obj.push([3, '<< /Type /Page /Parent 2 0 R /CropBox [10 10 210 310] /Contents 4 0 R >>']);
  obj.push([4, stroom('', '220 0 0 320 0 0 cm /Im0 Do')]);
  obj.push([5, stroom('/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8', '\xc0\xc0\xc0\xc0')]);
  let uit = '%PDF-1.7\n';
  const plek = [];
  for (const [n, inhoud] of obj) { plek[n] = uit.length; uit += `${n} 0 obj\n${inhoud}\nendobj\n`; }
  const xref = uit.length;
  uit += `xref\n0 6\n0000000000 65535 f \n${plek.slice(1).map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('')}`;
  uit += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(uit, 'latin1'));
}

test('een echte scan: het beeld blijft, de tekst staat op haar plek en pdf.js vindt haar', async () => {
  const pdf = await PDFDocument.load(scanPdf());
  const woorden = [{ text: 'Fundering', left: 20, top: 40, width: 70, height: 12 }, { text: 'peil', left: 100, top: 40, width: 30, height: 12 }];
  const uitkomst = await writeOcrLayers(pdf, pdf.getPages(), { ocrResults: { 1: woorden } }, { loadFontBytes: async () => FONT });
  assert.deepEqual(uitkomst.layerPages, [1]);
  const bytes = new Uint8Array(await pdf.save());

  const { treffer } = vind(bytes, 'Fundering');
  assert.ok(treffer, 'MuPDF vindt het woord');
  assert.ok(Math.abs(treffer.x0 - 20) < 2 && treffer.y1 > 40 && treffer.y0 < 52, `op het herkende vak: ${JSON.stringify(treffer)}`);

  // Het beeld (licht grijs) is er nog: de pagina is niet leeg geworden.
  const pagina = mupdf.Document.openDocument(bytes, 'application/pdf').loadPage(0);
  const pixels = pagina.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceGray, false, true).getPixels();
  const grijs = [...pixels].filter((v) => v > 150 && v < 230).length / pixels.length;
  assert.ok(grijs > 0.9, `het beeld bedekt de pagina nog (${grijs})`);

  // De zoektocht van de app leest de tekst met pdf.js.
  const taak = getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 });
  const doc = await taak.promise;
  const tekst = (await (await doc.getPage(1)).getTextContent()).items.map((i) => i.str).join(' ');
  assert.match(tekst, /Fundering/);
  assert.match(tekst, /peil/);
  await taak.destroy();
});

test('de draaiing van de app bij deze save telt niet mee: de woorden zijn zonder haar herkend', async () => {
  const opslaan = async (pageRotations) => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([200, 300]);
    // Zoals saver.js: de draaiing van de app staat al op de pagina als de OCR-laag komt.
    if (pageRotations[1]) page.setRotation(degrees(pageRotations[1]));
    await writeOcrLayers(pdf, pdf.getPages(), { ocrResults: { 1: [woordRechtsboven(0)] }, pageRotations },
      { loadFontBytes: async () => FONT });
    return new Uint8Array(await pdf.save());
  };
  // Zelfde plek op de ongedraaide pagina, dus na 90 graden draaien rechtsonder...
  const recht = vind(await opslaan({}), 'Hello').treffer;
  const gedraaid = vind(await opslaan({ 1: 90 }), 'Hello').treffer;
  assert.ok(recht && gedraaid);
  // (x, y) op de ongedraaide pagina komt na 90 graden rechtsom op (300 - y, x).
  assert.ok(Math.abs(gedraaid.x1 - (300 - recht.y0)) < 2 && Math.abs(gedraaid.y0 - recht.x0) < 2,
    `${JSON.stringify(recht)} -> ${JSON.stringify(gedraaid)}`);
});

test('plaatsing: beginpunt op de onderrand, tekstrichting volgt de draaiing', () => {
  const cropBox = { x: 10, y: 20, width: 200, height: 300 };
  const w = { left: 30, top: 40, width: 50, height: 10 };
  assert.deepEqual(ocrWoordPlaatsing(w, { rotation: 0, cropBox }), { x: 40, y: 270, cos: 1, sin: 0, grootte: 10 });
  const r90 = ocrWoordPlaatsing(w, { rotation: 90, cropBox });
  assert.deepEqual([r90.cos, r90.sin], [0, 1]);
  assert.deepEqual([r90.x, r90.y], [10 + 50, 20 + 30]);
  assert.deepEqual(ocrWoordPlaatsing(w, { rotation: -90, cropBox }).sin, -1, '-90 is 270');
});

test('stand: herkende woorden tellen als niet opgeslagen tot de saver ze schreef', () => {
  const woorden = [{ text: 'Fundering', left: 20, top: 40, width: 70, height: 12 }];
  const doc = { ocrResults: { 1: woorden, 2: [] } };
  assert.deepEqual(ongeschrevenOcrWoorden(doc, 1).map((w) => w.text), ['Fundering']);
  assert.deepEqual(ongeschrevenOcrWoorden(doc, 2), []);
  assert.equal(heeftOngeschrevenOcr(doc), true);

  doc.ocrLaagInBestand = ocrPaginaSignaturen(doc.ocrResults, [1]);
  assert.deepEqual(ongeschrevenOcrWoorden(doc, 1), [], 'opgeslagen: staat in het bestand');
  assert.equal(heeftOngeschrevenOcr(doc), false);

  doc.ocrResults[1] = [{ ...woorden[0], text: 'Funderingen' }];
  assert.deepEqual(ongeschrevenOcrWoorden(doc, 1).map((w) => w.text), ['Funderingen'], 'opnieuw herkend: weer uit het geheugen');
  assert.deepEqual(ongeschrevenOcrWoorden({ ocrResults: { 1: [{ text: ' ', left: 0, top: 0, width: 1, height: 1 }, { text: 'x', left: NaN, top: 0, width: 1, height: 1 }] } }, 1), [],
    'lege of onbruikbare woorden niet');
});

test('zoeken: de woorden komen achter de paginatekst, met een markering op het woord', () => {
  const view = [0, 0, 200, 300];
  const pageData = { pageNum: 1, text: 'Kop', items: [{ str: 'Kop', startPos: 0, endPos: 3 }], view, rotation: 0 };
  const doc = { ocrResults: { 1: [{ text: 'Fundering', left: 20, top: 40, width: 70, height: 12 }, { text: 'peil', left: 100, top: 40, width: 30, height: 12 }] } };
  const metOcr = metOcrWoorden(pageData, doc);
  assert.equal(metOcr.text, 'Kop Fundering peil');
  assert.equal(pageData.text, 'Kop', 'het origineel (de cache) blijft');
  const item = metOcr.items.find((i) => i.str === 'Fundering');
  assert.equal(metOcr.text.slice(item.startPos, item.endPos), 'Fundering');
  const box = matchBoxInPageFrame(item.transform, item.width, item.height, 0, 1, view);
  assert.ok(Math.abs(box.x - 20) < 0.01 && Math.abs(box.w - 70) < 0.01, JSON.stringify(box));
  assert.ok(box.y >= 40 - 0.01 && box.y < 52, `bovenkant ${box.y}`);
  assert.equal(box.angle, 0);

  doc.ocrLaagInBestand = ocrPaginaSignaturen(doc.ocrResults);
  assert.equal(metOcrWoorden(pageData, doc), pageData, 'opgeslagen: pdf.js leest ze al uit het bestand, niet dubbel');
});

test('bedrading: zoeken gebruikt metOcrWoorden en de saver houdt bij wat er in het bestand staat', () => {
  const lees = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');
  const zoeken = lees('../search/find-controller.js');
  assert.equal((zoeken.match(/zoekPaginaAlleBronnen\(metOcrWoorden\(pageData, doc\)/g) || []).length, 2);
  assert.match(zoeken, /rotation: page\.rotate \|\| 0/);
  assert.match(lees('../search/document-search-service.js'), /metOcrWoorden\(pdfTekst, doc\)/);
  assert.match(lees('./saver.js'), /activeDoc\.ocrLaagInBestand = ocrUitkomst\.pageSignatures/);
  assert.match(lees('./ocr-review-service.js'), /doc\.ocrLaagInBestand = ocrPaginaSignaturen\(complete\)/);
});
