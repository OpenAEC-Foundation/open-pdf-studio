// Welke lintgroepen krijgen tekst bij hun knoppen? Zo veel als er passen:
// eerst de gewone groepen van links naar rechts, daarna de groepen die uit
// zichzelf alleen pictogrammen tonen. Past zelfs alles-smal niet, dan volgt
// het overloopmenu (elders).

import assert from 'node:assert/strict';
import test from 'node:test';

import { kiesLintIndeling } from './lint-indeling.js';

const gewoon = (smal, metTekst) => ({ smal, metTekst, compact: false });
const compact = (smal, metTekst) => ({ smal, metTekst, compact: true });

test('alles krijgt tekst als het past', () => {
  const r = kiesLintIndeling(1000, [gewoon(50, 200), compact(180, 600), gewoon(60, 150)]);
  assert.deepEqual(r, { tekst: [true, true, true], past: true });
});

test('past niet alles, dan eerst de gewone groepen van links naar rechts', () => {
  const r = kiesLintIndeling(540, [gewoon(50, 200), compact(180, 600), gewoon(60, 150)]);
  assert.deepEqual(r, { tekst: [true, false, true], past: true });
});

test('een groep die niet past wordt overgeslagen, een latere die wel past krijgt tekst', () => {
  const r = kiesLintIndeling(330, [gewoon(50, 300), gewoon(60, 100)]);
  assert.deepEqual(r, { tekst: [false, true], past: true });
});

test('compacte groepen pas na alle gewone groepen', () => {
  const r = kiesLintIndeling(420, [compact(100, 300), gewoon(50, 250)]);
  assert.deepEqual(r, { tekst: [false, true], past: true });
});

test('past zelfs alles-smal niet, dan nergens tekst en past is false', () => {
  const r = kiesLintIndeling(100, [gewoon(50, 200), gewoon(60, 150)]);
  assert.deepEqual(r, { tekst: [false, false], past: false });
});

test('een groep zonder winst (zelfde breedte) telt als met tekst', () => {
  const r = kiesLintIndeling(100, [gewoon(40, 40), gewoon(60, 150)]);
  assert.deepEqual(r, { tekst: [true, false], past: true });
});

test('korte knopnaam: de titel zonder uitleg tussen haakjes of na een streep', async () => {
  const { korteKnopnaam } = await import('./lint-indeling.js');
  assert.equal(korteKnopnaam('Polylijn (dubbelklik om te voltooien)'), 'Polylijn');
  assert.equal(korteKnopnaam('Rechthoek — klik en typ dan bijv. 100,50'), 'Rechthoek');
  assert.equal(korteKnopnaam('Vrije hand'), 'Vrije hand');
  assert.equal(korteKnopnaam(undefined), '');
});
