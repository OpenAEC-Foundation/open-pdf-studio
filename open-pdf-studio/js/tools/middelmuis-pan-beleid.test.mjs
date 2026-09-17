import assert from 'node:assert/strict';
import test from 'node:test';

import { middelmuisActie } from './middelmuis-pan-beleid.js';

// Middelmuisknop ingedrukt, verder geen knoppen: een gewone pan-start.
const basis = { button: 1, buttons: 4, binnenWeergave: true, inVergelijking: false, alPannen: false };

test('middelknop in het weergavegebied start een pan, ongeacht waar de klik begint', () => {
  assert.equal(middelmuisActie(basis), 'pan');
  // buttons ontbreekt (bijv. een auxclick): nog steeds een pan-kandidaat.
  assert.equal(middelmuisActie({ ...basis, buttons: undefined }), 'pan');
});

test('andere knoppen worden niet aangeraakt', () => {
  assert.equal(middelmuisActie({ ...basis, button: 0, buttons: 1 }), 'negeer');
  assert.equal(middelmuisActie({ ...basis, button: 2, buttons: 2 }), 'negeer');
});

test('buiten het weergavegebied (tabbladen, lint, panelen) geen ingreep', () => {
  assert.equal(middelmuisActie({ ...basis, binnenWeergave: false }), 'negeer');
});

test('vergelijkingsweergave houdt haar eigen pan-afhandeling', () => {
  assert.equal(middelmuisActie({ ...basis, inVergelijking: true }), 'negeer');
});

test('tijdens een lopende bewerking met links of rechts: alleen autoscroll blokkeren', () => {
  assert.equal(middelmuisActie({ ...basis, buttons: 1 | 4 }), 'blokkeer');
  assert.equal(middelmuisActie({ ...basis, buttons: 2 | 4 }), 'blokkeer');
});

test('een pan die al loopt wordt niet opnieuw gestart', () => {
  assert.equal(middelmuisActie({ ...basis, alPannen: true }), 'blokkeer');
});
