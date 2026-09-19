// Welke lagen het scherm tekent en welke een afdruk of export.

import assert from 'node:assert/strict';
import test from 'node:test';

import { weergaveLagen } from './uitvoer-lagen.js';

test('scherm: alles, inclusief selectie en schermlijndiktes', () => {
  assert.deepEqual(weergaveLagen(), {
    watermerken: true,
    tekstbewerkingen: true,
    markeringen: true,
    selectie: true,
    bewerkhulp: true,
    schermlijndikte: true,
  });
  assert.deepEqual(weergaveLagen({}), weergaveLagen());
  assert.deepEqual(weergaveLagen({ uitvoer: false }), weergaveLagen());
});

test('uitvoer: geen selectie, geen bewerkhulp, echte lijndiktes', () => {
  const lagen = weergaveLagen({ uitvoer: true });
  assert.equal(lagen.selectie, false);
  assert.equal(lagen.bewerkhulp, false);
  assert.equal(lagen.schermlijndikte, false);
  // Wat op papier hoort blijft staan.
  assert.equal(lagen.markeringen, true);
  assert.equal(lagen.watermerken, true);
  assert.equal(lagen.tekstbewerkingen, true);
});

test('zonder markeringen blijft de inhoud van het document staan', () => {
  const lagen = weergaveLagen({ uitvoer: true, markeringen: false });
  assert.equal(lagen.markeringen, false);
  assert.equal(lagen.watermerken, true);
  assert.equal(lagen.tekstbewerkingen, true);
  // Ook op het scherm (voorbeeld in de printdialoog) kan de laag uit.
  assert.equal(weergaveLagen({ markeringen: false }).markeringen, false);
  assert.equal(weergaveLagen({ markeringen: false }).selectie, true);
});
