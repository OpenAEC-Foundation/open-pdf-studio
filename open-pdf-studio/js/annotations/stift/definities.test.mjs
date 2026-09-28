import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SOORTEN, soortInfo, vormVoorSoort, ifcVoorSoort, mmNaarPt, volgendeLetter,
  maakDefinitie, standaardSet, valideerDefinitie, valideerLijst, schrijfOpgeslagen, leesOpgeslagen,
} from './definities.js';

test('elf soorten in de volgorde van de spec, met tekenwijze en IFC', () => {
  assert.deepEqual(SOORTEN.map((s) => s.id), [
    'bestaandeWand', 'nieuweWand', 'stabiliteitswand', 'liggerStaal', 'liggerHout', 'latei',
    'vloer', 'kolom', 'fundering', 'paal', 'sparing',
  ]);
  assert.equal(vormVoorSoort('vloer'), 'pijl');
  assert.equal(vormVoorSoort('kolom'), 'punt');
  assert.equal(vormVoorSoort('sparing'), 'kruis');
  assert.equal(vormVoorSoort('latei'), 'lijn');
  assert.equal(vormVoorSoort('onbekend'), 'lijn');
  assert.equal(ifcVoorSoort('kolom'), 'IfcColumn');
  assert.equal(ifcVoorSoort('fundering'), 'IfcFooting');
  assert.equal(ifcVoorSoort('sparing'), 'IfcOpeningElement');
  assert.equal(ifcVoorSoort('paal'), 'IfcPile');
  assert.equal(soortInfo('xyz'), null);
});

test('millimeters op papier naar punten', () => {
  assert.equal(mmNaarPt(25.4), 72);
  assert.ok(Math.abs(mmNaarPt(1.4) - 3.9685) < 1e-3);
});

test('de startset: één definitie per soort, vaste id, standaardwaarden uit 3052', () => {
  const set = standaardSet();
  assert.equal(set.length, 11);
  assert.deepEqual(set[0], {
    id: 'sd-std-bestaandeWand', soort: 'bestaandeWand', omschrijving: 'Bestaande wand',
    kleur: '#000000', lijnsoort: 'gestreept', dikteMm: 1.4,
  });
  const vloer = set.find((d) => d.soort === 'vloer');
  assert.equal(vloer.letter, 'A');
  assert.equal(vloer.dikteMm, 0.35);
  const kolom = set.find((d) => d.soort === 'kolom');
  assert.equal(kolom.puntvorm, 'vierkant');
  assert.equal(kolom.maatMm, 4);
  assert.equal(set.find((d) => d.soort === 'paal').puntvorm, 'cirkel');
  assert.equal(set.find((d) => d.soort === 'sparing').dikteMm, 0.7);
  assert.deepEqual(standaardSet(), set, 'deterministisch');
});

test('een nieuwe vloerdefinitie krijgt de eerste vrije letter', () => {
  const a = maakDefinitie('vloer', { id: 'a' });
  const b = maakDefinitie('vloer', { id: 'b', bestaande: [a] });
  const c = maakDefinitie('vloer', { id: 'c', bestaande: [a, { soort: 'vloer', letter: 'C' }, b] });
  assert.deepEqual([a.letter, b.letter, c.letter], ['A', 'B', 'D']);
  const alle = Array.from({ length: 26 }, (_, i) => ({ soort: 'vloer', letter: String.fromCharCode(65 + i) }));
  assert.equal(volgendeLetter(alle), 'AA');
});

test('valideren vult aan met de waarden van de soort en klemt onzin', () => {
  assert.equal(valideerDefinitie(null), null);
  assert.equal(valideerDefinitie([1]), null);
  const d = valideerDefinitie({ id: ' x ', soort: 'kolom', omschrijving: '  HEA120  ', kleur: '#00ff00',
    dikteMm: -3, puntvorm: 'ster', maatMm: 7, extra: 'weg' });
  assert.deepEqual(d, { id: 'x', soort: 'kolom', omschrijving: 'HEA120', kleur: '#00FF00',
    lijnsoort: 'doorgetrokken', dikteMm: 0.35, puntvorm: 'vierkant', maatMm: 7 });
  const onbekend = valideerDefinitie({ id: 'y', soort: 'ruimteschip', kleur: 'rood', lijnsoort: 'golf' });
  assert.equal(onbekend.soort, 'nieuweWand');
  assert.equal(onbekend.omschrijving, 'Nieuwe wand');
  assert.equal(onbekend.kleur, '#FF0000');
  assert.equal(onbekend.lijnsoort, 'gestreept');
  assert.equal(valideerDefinitie({ id: 'v', soort: 'vloer', letter: 'b' }).letter, 'B');
  assert.equal(valideerDefinitie({ id: 'v', soort: 'vloer', letter: 'ABC' }).letter, 'A');
  assert.match(valideerDefinitie({ soort: 'latei' }).id, /^sd-/);
});

test('een lijst: dubbele id valt weg, rommel ook', () => {
  const lijst = valideerLijst([{ id: 'a', soort: 'latei' }, 'rommel', { id: 'a', soort: 'paal' }, { id: 'b', soort: 'paal' }]);
  assert.deepEqual(lijst.map((d) => [d.id, d.soort]), [['a', 'latei'], ['b', 'paal']]);
  assert.deepEqual(valideerLijst(null), []);
});

test('opgeslagen vorm: versie 1, en terug', () => {
  const set = standaardSet();
  const opgeslagen = schrijfOpgeslagen(set);
  assert.equal(opgeslagen.versie, 1);
  assert.deepEqual(leesOpgeslagen(JSON.parse(JSON.stringify(opgeslagen))), set);
  assert.deepEqual(leesOpgeslagen(set), set, 'een kale lijst telt als versie 1');
  assert.deepEqual(leesOpgeslagen('onzin'), []);
  assert.deepEqual(leesOpgeslagen({ versie: 1 }), []);
});
