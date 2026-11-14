// #701: rekenwerk van de snelle rasterexport — tegels, rotatie, budget en
// volgorde — plus bronwachters op de aansluiting in exporter.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  tegelRaster, draaiMatrix, maakPixelPoort, maakVolgorde,
  spreidOverWorkers, WORKER_BITMAP_BYTES, ZWARE_INHOUD_BYTES,
} from './raster-export-plan.js';

const lees = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

function dektPrecies(tegels, w, h) {
  const gezien = new Uint8Array(w * h);
  for (const t of tegels) {
    for (let y = t.py; y < t.py + t.ph; y++) {
      for (let x = t.px; x < t.px + t.pw; x++) gezien[y * w + x]++;
    }
  }
  return gezien.every((n) => n === 1);
}

test('tegels: een A4 op 300 dpi is één tegel', () => {
  assert.deepEqual(tegelRaster(2480, 3508), [{ px: 0, py: 0, pw: 2480, ph: 3508 }]);
});

test('tegels: een A0 op 300 dpi past in weinig tegels die elk in het workergeheugen passen', () => {
  const w = 9933, h = 14043;
  const tegels = tegelRaster(w, h);
  assert.ok(tegels.length <= 12, `${tegels.length} tegels`);
  for (const t of tegels) {
    // De worker rondt naar boven af: ook met een pixel extra moet hij passen.
    assert.ok((t.pw + 1) * (t.ph + 1) * 4 <= WORKER_BITMAP_BYTES, JSON.stringify(t));
  }
  // Volledige dekking zonder overlap, op een verkleinde maat gecontroleerd.
  const klein = tegelRaster(w / 10, h / 10, WORKER_BITMAP_BYTES / 100);
  assert.ok(dektPrecies(klein, Math.floor(w / 10), Math.floor(h / 10)));
});

test('tegels: dekking zonder gaten of overlap bij ongelijke resten', () => {
  for (const [w, h, cap] of [[101, 57, 4 * 30 * 30], [7, 300, 4 * 20 * 20], [1, 1, 64]]) {
    const tegels = tegelRaster(w, h, cap);
    assert.ok(dektPrecies(tegels, w, h), `${w}x${h}`);
  }
});

// Past de matrix toe op een punt.
const pas = ([a, b, c, d, e, f], x, y) => [a * x + c * y + e, b * x + d * y + f];

test('rotatie: hoeken van het ongedraaide beeld komen waar PDF.js ze zet (met de klok mee)', () => {
  const w0 = 200, h0 = 100;
  assert.deepEqual(pas(draaiMatrix(0, w0, h0), 10, 20), [10, 20]);
  // 90°: linksboven → rechtsboven; het beeld wordt h0 breed.
  assert.deepEqual(pas(draaiMatrix(90, w0, h0), 0, 0), [100, 0]);
  assert.deepEqual(pas(draaiMatrix(90, w0, h0), w0, h0), [0, 200]);
  // 180°: linksboven → rechtsonder.
  assert.deepEqual(pas(draaiMatrix(180, w0, h0), 0, 0), [200, 100]);
  // 270°: rechtsboven → linksboven.
  assert.deepEqual(pas(draaiMatrix(270, w0, h0), w0, 0), [0, 0]);
  assert.deepEqual(pas(draaiMatrix(270, w0, h0), 0, 0), [0, 200]);
  // Negatief en boven 360 rekenen als hun rest.
  assert.deepEqual(draaiMatrix(-90, w0, h0), draaiMatrix(270, w0, h0));
  assert.deepEqual(draaiMatrix(450, w0, h0), draaiMatrix(90, w0, h0));
});

test('budget: hooguit maxPaginas tegelijk en binnen het pixelbudget; één grote mag alleen', async () => {
  const poort = maakPixelPoort({ maxPaginas: 2, maxPixels: 100 });
  const v1 = await poort.neem(40);
  const v2 = await poort.neem(40);
  let derde = false;
  const p3 = poort.neem(10).then((v) => { derde = true; return v; });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(derde, false, 'derde pagina wacht op het aantal');
  v1();
  const v3 = await p3;
  assert.equal(derde, true);
  v2(); v3();
  assert.deepEqual(poort.bezet, { paginas: 0, pixels: 0 });
  // Groter dan het hele budget: mag, maar alleen.
  const groot = await poort.neem(500);
  let klein = false;
  const pk = poort.neem(1).then((v) => { klein = true; return v; });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(klein, false);
  groot();
  (await pk)();
  groot(); // dubbel vrijgeven telt niet
  assert.deepEqual(poort.bezet, { paginas: 0, pixels: 0 });
});

test('volgorde: resultaten komen in paginavolgorde vrij', () => {
  const v = maakVolgorde();
  v.zet(2, 'c');
  assert.deepEqual(v.afnemen(), []);
  v.zet(0, 'a');
  assert.deepEqual(v.afnemen(), ['a']);
  v.zet(1, 'b');
  assert.deepEqual(v.afnemen(), ['b', 'c']);
  assert.equal(v.volgende, 3);
});

test('spreiding: extreem zware inhoud blijft op één worker', () => {
  assert.equal(spreidOverWorkers(0), true);
  assert.equal(spreidOverWorkers(ZWARE_INHOUD_BYTES), true);
  assert.equal(spreidOverWorkers(ZWARE_INHOUD_BYTES + 1), false);
});

// ── Bronwachters ──

test('exporter: PDFium-pad met terugval op PDF.js, en de oude maat en volgorde', () => {
  const src = lees('./exporter.js').replace(/\r\n/g, '\n');
  // export-document.test.mjs knipt exportAsImages tot aan deze kop: niets ertussen.
  const kop = src.indexOf('/**\n * Export pages as a rasterized PDF');
  const beeldExport = src.indexOf('export async function exportAsImages');
  assert.ok(kop > beeldExport);
  assert.doesNotMatch(src.slice(beeldExport + 10, kop), /\nexport /);
  const fn = src.slice(src.indexOf('export async function rasterPaginaCanvas'), src.indexOf('export async function exportAnnotationAsImage'));
  // Zelfde viewport als het oude pad: paginarotatie plus extra rotatie.
  assert.match(fn, /const rotation = \(page\.rotate \+ extraRotation\) % 360;/);
  assert.match(fn, /breedte: Math\.floor\(viewport\.width\), hoogte: Math\.floor\(viewport\.height\)/);
  // Markeringslaag uit dezelfde tekening als altijd.
  assert.match(fn, /renderMarkeringenOffscreen\(pageNum, exportScale, viewport\)/);
  // Terugval: PDFium faalt → PDF.js.
  assert.match(fn, /renderPageOffscreen\(pageNum, exportScale, \{ tijden \}\)/);
  const exp = src.slice(src.indexOf('export async function exportAsRasterPdf'), src.indexOf('export async function rasterPaginaCanvas'));
  assert.match(exp, /pdfiumRasterBeschikbaar\(doc\)/, 'zonder pool het oude pad');
  assert.match(exp, /kiesRasterMotor\(doc, pageNum, poolKlaar\)/, 'motor per pagina');
  assert.match(exp, /maakVolgorde\(\)/, 'pagina\'s in volgorde in de PDF');
  assert.match(exp, /annuleren: \(\) => annuleer\.abort\(\)/, 'annuleerknop');
  assert.match(exp, /if \(annuleer\.signal\.aborted\) return null;/, 'geannuleerd: niets schrijven');
});

test('raster-export: tegels zonder extra rotatie en zonder dunne lijnen', () => {
  const src = lees('./raster-export.js');
  assert.match(src, /rotation: 0,/);
  assert.match(src, /thinLines: false,/);
  assert.match(src, /invoke\('render_pdf_page_region'/);
  assert.match(src, /invoke\('worker_pool_ready'\)/);
  // Zware pagina's via PDFium, lichte via PDF.js; zonder pool altijd PDF.js.
  const kies = src.slice(src.indexOf('export async function kiesRasterMotor'));
  assert.match(kies, /if \(!poolKlaar\) return 'pdfjs';/);
  assert.match(kies, /isHeavyBytes\(await pageContentBytes\(doc\.filePath, pageNum\)\) \? 'pdfium' : 'pdfjs'/);
});

// Afdrukken rendert alleen het deel van de pagina dat op het vel komt: de
// PDFium-route haalt dan alleen de tegels op die dat deel raken.
const { tegelsVoorDeel } = await import('./raster-export-plan.js');

test('deel: zonder rotatie alleen de tegels die het deel raken', () => {
  const tegels = [
    { px: 0, py: 0, pw: 100, ph: 100 }, { px: 100, py: 0, pw: 100, ph: 100 },
    { px: 0, py: 100, pw: 100, ph: 100 }, { px: 100, py: 100, pw: 100, ph: 100 },
  ];
  const m = draaiMatrix(0, 200, 200);
  assert.deepEqual(tegelsVoorDeel(tegels, m, { x: 10, y: 10, breedte: 50, hoogte: 50 }), [tegels[0]]);
  assert.deepEqual(tegelsVoorDeel(tegels, m, { x: 90, y: 110, breedte: 20, hoogte: 20 }), [tegels[2], tegels[3]]);
  assert.deepEqual(tegelsVoorDeel(tegels, m, { x: 100, y: 0, breedte: 100, hoogte: 100 }), [tegels[1]], 'aanliggen is niet raken');
  assert.deepEqual(tegelsVoorDeel(tegels, m, null), tegels, 'zonder deel alle tegels');
});

test('deel: met extra rotatie telt de plek van de tegel in de gedraaide pagina', () => {
  // Ongedraaid 300 breed, 100 hoog, drie tegels naast elkaar. Na 90° met de
  // klok mee is de pagina 100 breed en 300 hoog: de linker tegel staat
  // bovenaan, de rechter onderaan.
  const tegels = [{ px: 0, py: 0, pw: 100, ph: 100 }, { px: 100, py: 0, pw: 100, ph: 100 }, { px: 200, py: 0, pw: 100, ph: 100 }];
  const m90 = draaiMatrix(90, 300, 100);
  assert.deepEqual(tegelsVoorDeel(tegels, m90, { x: 0, y: 0, breedte: 100, hoogte: 50 }), [tegels[0]]);
  assert.deepEqual(tegelsVoorDeel(tegels, m90, { x: 20, y: 250, breedte: 10, hoogte: 10 }), [tegels[2]]);
  const m270 = draaiMatrix(270, 300, 100);
  assert.deepEqual(tegelsVoorDeel(tegels, m270, { x: 0, y: 0, breedte: 100, hoogte: 50 }), [tegels[2]], '270°: de rechter tegel staat bovenaan');
  const m180 = draaiMatrix(180, 300, 100);
  assert.deepEqual(tegelsVoorDeel(tegels, m180, { x: 0, y: 0, breedte: 50, hoogte: 100 }), [tegels[2]]);
});
