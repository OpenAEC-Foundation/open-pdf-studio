// De tekenconventie van een blad (#1230): een blad in voet of inch tekent
// zoals een Amerikaanse plattegrond, een metrisch blad houdt de Nederlandse
// standaarden. De regel staat op een plek; hier ligt hij vast, met de
// metrische uitkomsten erbij zodat die niet ongemerkt meeveranderen.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONVENTIES, isImperiaalBlad, bladConventie, inchNaarMm,
  WAND_STANDAARD, wandStandaard, WANDDIKTES, wanddikteKeuzes, wanddikteKeuze, wanddikteLabel,
  OPENING_STANDAARD_IMPERIAAL, leesBreedteMm, breedteLabel,
} from './blad-conventie.js';
import { stelSchaalSysteemBronIn } from '../annotations/scale-presets.js';

test('imperiaal: de schaal op het punt staat in ft of in, of de voorkeur is Imperiaal', () => {
  assert.deepEqual(CONVENTIES, ['metric', 'imperial']);
  // De schaal beslist, ook als de voorkeur metrisch is.
  assert.equal(isImperiaalBlad({ pixelsPerUnit: 18, unit: 'ft' }, 'metric'), true);
  assert.equal(isImperiaalBlad({ pixelsPerUnit: 1.5, unit: 'in' }, 'metric'), true);
  assert.equal(isImperiaalBlad('ft', 'both'), true);
  // De voorkeur beslist, ook op een blad met een metrische schaal.
  assert.equal(isImperiaalBlad({ pixelsPerUnit: 0.0567, unit: 'mm' }, 'imperial'), true);
  assert.equal(isImperiaalBlad(null, 'imperial'), true);
  // Geen van beide: metrisch.
  for (const unit of ['mm', 'cm', 'm', 'pt', 'px', '']) {
    assert.equal(isImperiaalBlad({ pixelsPerUnit: 1, unit }, 'metric'), false, unit);
    assert.equal(isImperiaalBlad({ pixelsPerUnit: 1, unit }, 'both'), false, `${unit} (both)`);
  }
  assert.equal(isImperiaalBlad(null, 'metric'), false);
  assert.equal(isImperiaalBlad(undefined, 'onzin'), false);
  assert.equal(bladConventie('ft', 'metric'), 'imperial');
  assert.equal(bladConventie('mm', 'metric'), 'metric');
});

test('zonder meegegeven voorkeur geldt die van de app', () => {
  try {
    stelSchaalSysteemBronIn(() => 'imperial');
    assert.equal(isImperiaalBlad({ unit: 'mm' }), true);
    stelSchaalSysteemBronIn(() => 'metric');
    assert.equal(isImperiaalBlad({ unit: 'mm' }), false);
    assert.equal(isImperiaalBlad({ unit: 'ft' }), true);
  } finally {
    stelSchaalSysteemBronIn(null);
  }
  // Zonder bron (tests, voor het opstarten): niet imperiaal.
  assert.equal(isImperiaalBlad({ unit: 'mm' }), false);
});

test('een inch is precies 25,4 mm', () => {
  assert.equal(inchNaarMm(1), 25.4);
  assert.equal(inchNaarMm(6), 152.4);
  assert.equal(inchNaarMm(12), 304.8);
  assert.equal(inchNaarMm(4.875), 123.825);
  assert.equal(inchNaarMm(6.875), 174.625);
  assert.equal(inchNaarMm(1.75), 44.45);
});

test('de standaardwand: 6 inch zonder arcering op een imperiaal blad', () => {
  assert.deepEqual(wandStandaard(true), { dikteMm: 152.4, hatchPattern: 'none' });
  assert.equal(wandStandaard(true), WAND_STANDAARD.imperial);
});

test('metrisch blijft: de standaardwand is 100 mm metselwerk', () => {
  assert.deepEqual(wandStandaard(false), { dikteMm: 100, hatchPattern: 'nen47-metselwerk-baksteen' });
  assert.equal(wandStandaard(false), WAND_STANDAARD.metric);
});

test('de diktelijst op een imperiaal blad: de vijf Amerikaanse maten', () => {
  const lijst = wanddikteKeuzes(true);
  assert.deepEqual(lijst.map((k) => k.label), [
    '4-7/8" partition', '6"', '6-7/8" partition', '8" CMU', '12" CMU',
  ]);
  // Opgeslagen in millimeters, exact omgerekend.
  assert.deepEqual(lijst.map((k) => k.dikteMm), [123.825, 152.4, 174.625, 203.2, 304.8]);
  assert.deepEqual(WANDDIKTES.imperial.map((k) => k.inch), [4.875, 6, 6.875, 8, 12]);
  // De toevoeging is te vertalen.
  const nl = wanddikteKeuzes(true, (soort) => ({ partition: 'scheidingswand', cmu: 'betonblok' }[soort]));
  assert.equal(nl[0].label, '4-7/8" scheidingswand');
  assert.equal(nl[3].label, '8" betonblok');
  assert.equal(nl[1].label, '6"');
});

test('metrisch blijft: de diktelijst is 100 / 150 / 200 / 300 mm', () => {
  const lijst = wanddikteKeuzes(false);
  assert.deepEqual(lijst.map((k) => k.dikteMm), [100, 150, 200, 300]);
  assert.deepEqual(lijst.map((k) => k.label), ['100 mm', '150 mm', '200 mm', '300 mm']);
});

test('een dikte terugvinden in de lijst, of als eigen maat tonen', () => {
  assert.equal(wanddikteKeuze(152.4, true).label, '6"');
  assert.equal(wanddikteKeuze(152.4, false), null, '6 inch staat niet in de metrische lijst');
  assert.equal(wanddikteKeuze(100, false).label, '100 mm');
  assert.equal(wanddikteKeuze(100, true), null);
  assert.equal(wanddikteLabel(203.2, true), '8" CMU');
  assert.equal(wanddikteLabel(139.7, true), '5-1/2"', 'een eigen maat in inches');
  assert.equal(wanddikteLabel(100, true), '3.937"', 'een metrische maat op een imperiaal blad');
  assert.equal(wanddikteLabel(120, false), '120 mm');
  assert.equal(wanddikteLabel(152.4, false), '152.4 mm');
});

test('deur en raam op een imperiaal blad: 36 en 48 inch, blad 1-3/4 inch', () => {
  assert.equal(OPENING_STANDAARD_IMPERIAAL.deur.breedteMm, 914.4);
  assert.equal(OPENING_STANDAARD_IMPERIAAL.deur.bladDikteMm, 44.45);
  assert.equal(OPENING_STANDAARD_IMPERIAAL.raam.breedteMm, 1219.2);
});

test('een getypte breedte op een imperiaal blad: een kaal getal is inches', () => {
  assert.equal(leesBreedteMm('32', true), 812.8);
  assert.equal(leesBreedteMm(' 36 ', true), 914.4);
  assert.equal(leesBreedteMm(32, true), 812.8);
  assert.equal(leesBreedteMm('32.5', true), 825.5);
  assert.equal(leesBreedteMm('32,5', true), 825.5, 'een komma mag ook');
});

test('een getypte breedte in voet en inch', () => {
  const gevallen = [
    [`3'-0"`, 36], [`2'-8"`, 32], [`3'`, 36], [`2' 8"`, 32], [`2'-8 1/2"`, 32.5],
    [`2'8"`, 32], [`0'-30"`, 30], [`30"`, 30], [`2 ft 8 in`, 32],
  ];
  for (const [tekst, inch] of gevallen) {
    assert.equal(leesBreedteMm(tekst, true), inchNaarMm(inch), `${tekst} imperiaal`);
    // Ook op een metrisch blad is een voet-inchmaat wat er staat.
    assert.equal(leesBreedteMm(tekst, false), inchNaarMm(inch), `${tekst} metrisch`);
  }
});

test('metrisch blijft: een kaal getal is millimeters', () => {
  assert.equal(leesBreedteMm('32', false), 32);
  assert.equal(leesBreedteMm('900', false), 900);
  assert.equal(leesBreedteMm('930,5', false), 930.5);
  assert.equal(leesBreedteMm(1200, false), 1200);
});

test('onzin, nul en negatief geven geen breedte', () => {
  for (const imperiaal of [true, false]) {
    for (const tekst of ['', '   ', 'abc', '0', '-5', `2'-8 x`, `6 3/0"`, null, undefined, {}, NaN]) {
      assert.equal(leesBreedteMm(tekst, imperiaal), null, `${String(tekst)} (${imperiaal})`);
    }
  }
});

test('een breedte als tekst voor het blad', () => {
  assert.equal(breedteLabel(914.4, true), '36"');
  assert.equal(breedteLabel(825.5, true), '32-1/2"');
  assert.equal(breedteLabel(900, false), '900 mm');
  assert.equal(breedteLabel(NaN, true), '');
});
