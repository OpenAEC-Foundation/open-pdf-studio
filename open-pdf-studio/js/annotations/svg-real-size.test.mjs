import assert from 'node:assert/strict';
import test from 'node:test';

import { svgRealSizeMm, stampPlacementSize } from './svg-real-size.js';

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
