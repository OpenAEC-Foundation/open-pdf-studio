import assert from 'node:assert/strict';
import test from 'node:test';

import {
  svgRealSizeMm, stampPlacementSize, overrideStampMaat, symboolMaatSoort, ptPerPapierMm, PT_PER_PAPIER_MM,
} from './svg-real-size.js';
import { OVERRIDE_STAMP_DEFAULT_HEIGHT, SYMBOL_PAPER_HEIGHT_MM } from './stamp-defaults.js';

test('leest een werkelijke maat in mm van de SVG-root', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="65.0mm" height="14.0mm" viewBox="0 0 65 14">';
  assert.deepEqual(svgRealSizeMm(svg), { width: 65, height: 14 });
});

test('rekent cm, in en pt om naar mm', () => {
  assert.deepEqual(svgRealSizeMm('<svg width="6.5cm" height="1.4cm">'), { width: 65, height: 14 });
  assert.deepEqual(svgRealSizeMm('<svg width="1in" height="2in">'), { width: 25.4, height: 50.8 });
  assert.deepEqual(svgRealSizeMm('<svg width="72pt" height="144pt">'), { width: 25.4, height: 50.8 });
});

test('geeft null voor de meegeleverde symbolen (alleen viewBox, geen eenheid)', () => {
  assert.equal(svgRealSizeMm('<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">'), null);
});

test('geeft null voor eenheidloze (px-)maten — dat is geen werkelijke maat', () => {
  assert.equal(svgRealSizeMm('<svg width="64" height="64" viewBox="0 0 64 64">'), null);
});

test('geeft null voor procenten en voor rommel', () => {
  assert.equal(svgRealSizeMm('<svg width="100%" height="100%">'), null);
  assert.equal(svgRealSizeMm(''), null);
  assert.equal(svgRealSizeMm(null), null);
});

test('kijkt alleen naar de root, niet naar geneste elementen', () => {
  const svg = '<svg viewBox="0 0 64 64"><rect width="10mm" height="10mm"/></svg>';
  assert.equal(svgRealSizeMm(svg), null);
});

// --- plaatsingsmaat ---

test('werkelijke maat: mm x px-per-mm, ongeacht de standaardgrootte', () => {
  // 65 x 14 mm op een tekening waar 1 mm = 2 paginapixels
  const r = stampPlacementSize({ mm: { width: 65, height: 14 }, pxPerMm: 2, aspect: 65 / 14 });
  assert.deepEqual(r, { width: 130, height: 28 });
});

test('geen werkelijke maat: hoogte uit de standaard, breedte uit de aspect', () => {
  // FIX A: een niet-vierkante SVG mag niet in een vierkant geduwd worden
  const r = stampPlacementSize({ mm: null, pxPerMm: 2, aspect: 65 / 14, defaultHeight: 400 });
  assert.equal(r.height, 400);
  assert.equal(r.width, 1857); // 400 * 4.642...
});

test('geen werkelijke maat en aspect 1: blijft 400 x 400 (bestaande symbolen)', () => {
  const r = stampPlacementSize({ mm: null, pxPerMm: 2, aspect: 1, defaultHeight: 400 });
  assert.deepEqual(r, { width: 400, height: 400 });
});

test('valt terug op de standaardhoogte als px-per-mm onbekend is', () => {
  const r = stampPlacementSize({ mm: { width: 65, height: 14 }, pxPerMm: 0, aspect: 65 / 14, defaultHeight: 400 });
  assert.equal(r.height, 400);
  assert.equal(r.width, 1857);
});

test('negeert een onzinnige aspect', () => {
  const r = stampPlacementSize({ mm: null, pxPerMm: 0, aspect: NaN, defaultHeight: 400 });
  assert.deepEqual(r, { width: 400, height: 400 });
});

// --- regressie: de meegeleverde symbolen mogen NIET van gedrag veranderen ---

test('geen enkel meegeleverd NL-symbool declareert een werkelijke maat', async () => {
  const { NL_CATEGORIES } = await import('../solid/data/nlSymbolLibrary.js');
  const metMaat = [];
  for (const cat of NL_CATEGORIES) {
    for (const sym of cat.symbols) {
      if (sym.svg && svgRealSizeMm(sym.svg)) metMaat.push(`${cat.id}/${sym.id}`);
    }
  }
  // Zolang dit leeg is, raakt de werkelijke-maat-tak geen bestaand symbool.
  assert.deepEqual(metMaat, []);
});

test('een vierkant meegeleverd symbool komt nog steeds op 400 x 400', () => {
  const svg = '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="32" r="30"/></svg>';
  const r = stampPlacementSize({
    mm: svgRealSizeMm(svg),
    pxPerMm: 3.7795,            // gekalibreerde tekening: schaal is bekend
    aspect: 1,
    defaultHeight: 400,
  });
  assert.deepEqual(r, { width: 400, height: 400 });
});

test('de gemelde CAD-SVG (65 x 14 mm) komt op ware maat binnen', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="65.0mm" height="14.0mm" viewBox="0 0 65 14">';
  const mm = svgRealSizeMm(svg);
  assert.deepEqual(mm, { width: 65, height: 14 });
  // 1:1-tekening, 1 mm = 3.7795 paginapixels (96 dpi)
  const r = stampPlacementSize({ mm, pxPerMm: 3.7795, aspect: 65 / 14, defaultHeight: 400 });
  assert.equal(Math.round(r.width), 246);
  assert.equal(Math.round(r.height), 53);
  // en de verhouding blijft kloppen
  assert.ok(Math.abs(r.width / r.height - 65 / 14) < 1e-9);
});

// Issue #357: de spookafbeelding onder de cursor (tools/text-tool.js) en de
// echte plaatsing (stamps.js) delen overrideStampMaat. Deze tests leggen vast
// dat die ene berekening de gekozen schaal meeneemt.
const PALET_SYMBOOL = {
  stampSvg: '<svg viewBox="0 0 64 32" xmlns="http://www.w3.org/2000/svg"><rect width="64" height="32"/></svg>',
  stampPaperHeightMm: SYMBOL_PAPER_HEIGHT_MM,
};
// Hoogte van een paletsymbool op een pagina met /UserUnit 1.
const PALET_H = SYMBOL_PAPER_HEIGHT_MM * PT_PER_PAPIER_MM;
const bijna = (a, b, tekst = '') => assert.ok(Math.abs(a - b) <= 0.006, `${tekst}: ${a} is not ${b}`);

test('overrideStampMaat: zonder schaal de bekende paletmaat', () => {
  for (const r of [
    overrideStampMaat(PALET_SYMBOOL, { pxPerMm: 0, aspect: 2 }),
    overrideStampMaat(PALET_SYMBOOL, { pxPerMm: 0, aspect: 2, schaal: 1 }),
  ]) {
    bijna(r.height, PALET_H, 'hoogte');
    bijna(r.width, 2 * PALET_H, 'breedte');
  }
});

test('overrideStampMaat: de gekozen schaal werkt op voorbeeld en plaatsing gelijk', () => {
  for (const schaal of [0.25, 0.5, 2, 3]) {
    const r = overrideStampMaat(PALET_SYMBOOL, { pxPerMm: 0, aspect: 2, schaal });
    bijna(r.height, PALET_H * schaal, `hoogte bij ${schaal}`);
    bijna(r.width, 2 * PALET_H * schaal, `breedte bij ${schaal}`);
  }
});

test('overrideStampMaat: ook een symbool met een werkelijke maat schaalt mee', () => {
  const ov = { stampSvg: '<svg width="65mm" height="14mm" viewBox="0 0 65 14">' };
  const eenmaal = overrideStampMaat(ov, { pxPerMm: 2, aspect: 65 / 14, schaal: 1 });
  const tweemaal = overrideStampMaat(ov, { pxPerMm: 2, aspect: 65 / 14, schaal: 2 });
  assert.deepEqual(eenmaal, { width: 130, height: 28 });
  assert.deepEqual(tweemaal, { width: 260, height: 56 });
});

test('overrideStampMaat: zonder hoogte valt hij terug op de stempelstandaard', () => {
  // Het voorbeeld viel hier eerder terug op de paletmaat (400) terwijl de
  // plaatsing 800 gebruikte: twee verschillende maten voor hetzelfde stempel.
  const r = overrideStampMaat({ stampImage: 'data:image/png;base64,' }, { pxPerMm: 0, aspect: 1 });
  assert.deepEqual(r, { width: OVERRIDE_STAMP_DEFAULT_HEIGHT, height: OVERRIDE_STAMP_DEFAULT_HEIGHT });
});

test('voorbeeld en plaatsing gebruiken dezelfde maatbron', async () => {
  const { readFileSync } = await import('node:fs');
  const bron = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');
  for (const pad of ['./stamps.js', '../tools/tools/text-tool.js']) {
    const code = bron(pad);
    assert.match(code, /overrideStampMaat\(/, `${pad} rekent niet via overrideStampMaat`);
    assert.match(code, /schaal:\s*huidigeSymboolSchaal\(\)/, `${pad} geeft de symboolschaal niet mee`);
  }
});

// --- #983: annotatiesymbolen op papiermaat, symbolen op werkelijke maat ------

test('maatsoort: paletsymbool = papier, SVG met echte maat = werkelijk, rest = standaard', () => {
  assert.equal(symboolMaatSoort(PALET_SYMBOOL), 'papier');
  assert.equal(symboolMaatSoort({ ...PALET_SYMBOOL, stampSvg: '<svg width="600mm" height="600mm" viewBox="0 0 6 6">' }), 'werkelijk');
  assert.equal(symboolMaatSoort({ stampSvg: PALET_SYMBOOL.stampSvg }), 'standaard');
  assert.equal(symboolMaatSoort({ stampImage: 'data:image/png;base64,' }), 'standaard');
  assert.equal(symboolMaatSoort(null), 'standaard');
});

test('#983: een annotatiesymbool heeft op 1x op elke tekeningschaal dezelfde papiermaat', () => {
  // Paginaeenheden per werkelijke mm op 1:1, 1:50, 1:100 en 1:500, en zonder schaal.
  const maten = [PT_PER_PAPIER_MM, PT_PER_PAPIER_MM / 50, PT_PER_PAPIER_MM / 100, PT_PER_PAPIER_MM / 500, 0]
    .map((pxPerMm) => overrideStampMaat(PALET_SYMBOOL, { pxPerMm, aspect: 1, schaal: 1 }));
  for (const r of maten) {
    bijna(r.height, PALET_H, 'hoogte');
    bijna(r.width, PALET_H, 'breedte');
  }
  // Op papier: SYMBOL_PAPER_HEIGHT_MM millimeter.
  bijna(maten[1].height / PT_PER_PAPIER_MM, SYMBOL_PAPER_HEIGHT_MM, 'papier-mm');
});

test('#983: een zinnige papiermaat, kleiner dan een ruimte op een A3-plattegrond 1:50', () => {
  assert.ok(SYMBOL_PAPER_HEIGHT_MM >= 5 && SYMBOL_PAPER_HEIGHT_MM <= 15, `${SYMBOL_PAPER_HEIGHT_MM} mm`);
  // Een kamer van 3 m op 1:50 is 60 mm papier: het symbool past er ruim in.
  const kamer = 3000 * (PT_PER_PAPIER_MM / 50);
  const r = overrideStampMaat(PALET_SYMBOOL, { pxPerMm: PT_PER_PAPIER_MM / 50, aspect: 1, schaal: 1 });
  assert.ok(r.height < kamer / 4, `${r.height} pt tegen een kamer van ${kamer} pt`);
});

test('#983: de papiermaat rekent met de /UserUnit van de pagina', () => {
  bijna(ptPerPapierMm(1), PT_PER_PAPIER_MM, 'UserUnit 1');
  bijna(ptPerPapierMm(2), PT_PER_PAPIER_MM / 2, 'UserUnit 2');
  bijna(ptPerPapierMm(0), PT_PER_PAPIER_MM, 'onzin');
  const r = overrideStampMaat(PALET_SYMBOOL, { pxPerMm: 0, aspect: 1, ptPerMmPapier: ptPerPapierMm(2) });
  bijna(r.height, PALET_H / 2, 'hoogte op UserUnit 2');
});

test('#983: de symboolschaal werkt op de papiermaat', () => {
  const r = overrideStampMaat(PALET_SYMBOOL, { pxPerMm: PT_PER_PAPIER_MM / 50, aspect: 1, schaal: 2 });
  bijna(r.height, 2 * PALET_H, 'hoogte bij 2x');
});

test('#983: een symbool op werkelijke maat volgt de tekeningschaal (ongewijzigd)', () => {
  // Een SVG van 600 x 600 mm (bv. een meubelstuk) uit het palet.
  const ov = { ...PALET_SYMBOOL, stampSvg: '<svg width="600mm" height="600mm" viewBox="0 0 6 6">' };
  const op50 = overrideStampMaat(ov, { pxPerMm: PT_PER_PAPIER_MM / 50, aspect: 1, schaal: 1 });
  const op100 = overrideStampMaat(ov, { pxPerMm: PT_PER_PAPIER_MM / 100, aspect: 1, schaal: 1 });
  bijna(op50.height, 600 * PT_PER_PAPIER_MM / 50, '1:50');
  bijna(op100.height, 600 * PT_PER_PAPIER_MM / 100, '1:100');
  // Zonder tekeningschaal valt hij terug op de papiermaat van het palet.
  bijna(overrideStampMaat(ov, { pxPerMm: 0, aspect: 1 }).height, PALET_H, 'zonder schaal');
});

test('#983: een extensie-stempel zonder papiermaat houdt zijn hoogte in paginaeenheden', () => {
  const r = overrideStampMaat({ stampSvg: PALET_SYMBOOL.stampSvg, stampHeight: 120 }, { pxPerMm: PT_PER_PAPIER_MM / 50, aspect: 2 });
  assert.deepEqual(r, { width: 240, height: 120 });
});

test('#983: het palet plaatst stempels als annotatiesymbool op papiermaat', async () => {
  const { readFileSync } = await import('node:fs');
  const palet = readFileSync(new URL('../solid/components/SymbolPalette.jsx', import.meta.url), 'utf8');
  assert.match(palet, /stampPaperHeightMm: SYMBOL_PAPER_HEIGHT_MM/);
  assert.doesNotMatch(palet, /stampHeight:/);
  for (const pad of ['./stamps.js', '../tools/tools/text-tool.js']) {
    const code = readFileSync(new URL(pad, import.meta.url), 'utf8');
    assert.match(code, /ptPerMmPapier:\s*stampPtPerPapierMm\(page\)/, `${pad} geeft de papiermaat van de pagina niet mee`);
  }
});
