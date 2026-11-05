import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  draaiVak, ocrLezing, moetGedraaidLezen, kiesBesteOcrLezing, vakNaarOcrDraaiing,
  OCR_DRAAIINGEN, OCR_GOED_GENOEG, OCR_MARGE,
} from './pagina-labels.js';

// #954: verticale tekst in een tekeningstempel. Bij 0° geeft OCR niets of
// onzin; de pagina wordt dan ook 90° en 270° gedraaid gelezen en de zekerste
// lezing wint.

const woord = (text, left, top, width, height, confidence) => ({ text, left, top, width, height, confidence });

test('ocrLezing: tekst binnen het vak en zekerheid gewogen naar tekens', () => {
  const vak = { x: 0, y: 0, width: 100, height: 20 };
  const l = ocrLezing([
    woord('A-101', 10, 5, 30, 10, 90),
    woord('X', 50, 5, 5, 10, 40),
    woord('buiten', 10, 50, 30, 10, 99),
  ], vak, 0);
  assert.equal(l.tekst, 'A-101 X');
  assert.equal(l.score, (5 * 90 + 1 * 40) / 6);
  assert.equal(l.graden, 0);
  // Zekerheid geklemd op 0..100; zonder zekerheid: score null.
  assert.equal(ocrLezing([woord('B', 1, 1, 5, 5, 250)], vak).score, 100);
  assert.equal(ocrLezing([woord('B', 1, 1, 5, 5)], vak).score, null);
  assert.deepEqual(ocrLezing([], vak), { tekst: '', score: null, graden: 0 });
});

test('moetGedraaidLezen: alleen bij leeg of onzeker', () => {
  assert.equal(moetGedraaidLezen({ tekst: '', score: null }), true);
  assert.equal(moetGedraaidLezen({ tekst: '|', score: OCR_GOED_GENOEG - 1 }), true);
  assert.equal(moetGedraaidLezen({ tekst: 'A-101', score: OCR_GOED_GENOEG }), false);
  // Oude woorden zonder zekerheid (eerder opgeslagen OCR): niet opnieuw lezen.
  assert.equal(moetGedraaidLezen({ tekst: 'A-101', score: null }), false);
});

test('kiesBesteOcrLezing: ongedraaid wint, tenzij een draaiing duidelijk zekerder is', () => {
  const nul = { tekst: 'l1l', score: 40, graden: 0 };
  const negentig = { tekst: 'A-101', score: 92, graden: 90 };
  const tweezeventig = { tekst: '101-V', score: 35, graden: 270 };
  assert.equal(kiesBesteOcrLezing([nul, negentig, tweezeventig]), negentig);
  assert.equal(kiesBesteOcrLezing([nul, tweezeventig]), nul);
  assert.equal(kiesBesteOcrLezing([{ ...nul, score: 60 }, { ...negentig, score: 60 + OCR_MARGE }]).graden, 0);
  assert.equal(kiesBesteOcrLezing([{ ...nul, score: 60 }, { ...negentig, score: 61 + OCR_MARGE }]).graden, 90);
  // Leeg bij 0°: de gedraaide lezing; de zekerste van 90/270.
  assert.equal(kiesBesteOcrLezing([{ tekst: '', score: null, graden: 0 }, tweezeventig, negentig]), negentig);
  assert.equal(kiesBesteOcrLezing([{ tekst: '', score: null, graden: 0 }, tweezeventig]), tweezeventig);
  assert.equal(kiesBesteOcrLezing([{ tekst: '', score: null }, { tekst: '', score: null }]), null);
  assert.equal(kiesBesteOcrLezing([]), null);
  assert.deepEqual(OCR_DRAAIINGEN, [90, 270]);
});

test('vakNaarOcrDraaiing: vak uit app-ruimte landt in de ruimte van de gedraaide OCR', () => {
  // Pagina met /Rotate: 200 x 100; vak in die ruimte.
  const W = 200, H = 100;
  const basis = { x: 150, y: 10, width: 15, height: 80 }; // smal en hoog: verticale tekst
  for (const extra of [0, 90, 180, 270]) {
    const app = draaiVak(basis, W, H, extra);
    for (const graden of [0, 90, 180, 270]) {
      assert.deepEqual(vakNaarOcrDraaiing(app, W, H, extra, graden), draaiVak(basis, W, H, graden), `extra ${extra}, graden ${graden}`);
    }
  }
});

test('verticaal bladnummer: de 90\u00B0-lezing wint en leest in de juiste volgorde', () => {
  const W = 200, H = 100;
  const vak = { x: 180, y: 10, width: 15, height: 80 }; // app zonder extra draaiing
  // Bij 0°: Tesseract geeft losse onzin met lage zekerheid.
  const bij0 = [woord('|', 184, 20, 3, 10, 31), woord('_', 184, 60, 3, 10, 22)];
  // Gedraaid 90° rechtsom: de regel ligt; twee woorden van links naar rechts.
  const regel = draaiVak({ x: 182, y: 15, width: 10, height: 70 }, W, H, 90);
  const bij90 = [
    woord('A-101', regel.x, regel.y, regel.width / 2 - 2, regel.height, 93),
    woord('rev.B', regel.x + regel.width / 2, regel.y, regel.width / 2, regel.height, 88),
  ];
  const bij270 = [woord('8\u02D9^\u0259', 15, 5, 70, 10, 28)];
  const lezingen = [ocrLezing(bij0, vak, 0)];
  assert.equal(moetGedraaidLezen(lezingen[0]), true);
  lezingen.push(ocrLezing(bij90, vakNaarOcrDraaiing(vak, W, H, 0, 90), 90));
  lezingen.push(ocrLezing(bij270, vakNaarOcrDraaiing(vak, W, H, 0, 270), 270));
  const beste = kiesBesteOcrLezing(lezingen);
  assert.equal(beste.graden, 90);
  assert.equal(beste.tekst, 'A-101 rev.B');
});
