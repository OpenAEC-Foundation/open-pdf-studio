// Getalopmaak van een maat (core/maat-opmaak.js): decimalen of voet-inch met
// een breuk, uit en naar de /D-reeks van een PDF-/Measure.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  maatEenheid, opmaakUitGetalopmaken, getalopmaakVoorBestand, opmaakVanMaat, maatTekst,
} from './maat-opmaak.js';

// Voet → inch met een breuk, zoals een ander tekenpakket het schrijft.
const voetInch = (D) => [
  { U: "'", C: 1, F: 'F', D }, { U: '"', C: 12, F: 'F', D },
];

test('eenheden: \' en " zijn voet en inch', () => {
  assert.equal(maatEenheid("'"), 'ft');
  assert.equal(maatEenheid('"'), 'in');
  assert.equal(maatEenheid('ft'), 'ft');
  assert.equal(maatEenheid('mm'), 'mm');
  assert.equal(maatEenheid(' m '), 'm');
});

test('opmaak uit /D: voet-inch met een breuk, ook hele inches', () => {
  assert.deepEqual(opmaakUitGetalopmaken(voetInch(1)), { unit: 'ft', fractie: 1 });
  assert.deepEqual(opmaakUitGetalopmaken(voetInch(4)), { unit: 'ft', fractie: 4 });
  assert.deepEqual(opmaakUitGetalopmaken(voetInch(16)), { unit: 'ft', fractie: 16 });
  // Alleen inches met een breuk: één opmaak in inches.
  assert.deepEqual(opmaakUitGetalopmaken([{ U: 'in', C: 1, F: 'F', D: 8 }]), { unit: 'in', fractie: 8, inch: true });
  assert.deepEqual(opmaakUitGetalopmaken([{ U: '"', C: 12, F: 'F', D: 16 }]), { unit: 'in', fractie: 16, inch: true });
});

test('alleen inches: tekst, en /D voor het bestand', () => {
  const voet = 26.5514 / 12;
  assert.equal(maatTekst(26.5514, 'in', { fractie: 16 }), `26 9/16"`);
  assert.equal(maatTekst(voet, 'ft', { fractie: 16, inch: true }), `26 9/16"`, 'viewport in voet die inches toont');
  assert.equal(maatTekst(26.5514, 'in', { fractie: 1 }), `27"`);
  assert.equal(maatTekst(0.2, 'in', { fractie: 16 }), `3/16"`);
  assert.equal(maatTekst(-26.5514, 'in', { fractie: 4 }), `-26 1/2"`);
  assert.equal(maatTekst(voet, 'ft', { fractie: 16 }), `2'-2 9/16"`, 'zonder inch: voet-inch');
  // Heen en terug.
  assert.deepEqual(getalopmaakVoorBestand('in', { fractie: 16 }), [{ U: '"', C: 1, F: 'F', D: 16, FD: true, SS: '' }]);
  assert.deepEqual(getalopmaakVoorBestand('ft', { fractie: 16, inch: true }), [{ U: '"', C: 12, F: 'F', D: 16, FD: true, SS: '' }]);
  assert.deepEqual(opmaakUitGetalopmaken(getalopmaakVoorBestand('in', { fractie: 4 })), { unit: 'in', fractie: 4, inch: true });
  // Een viewport die alleen inches toont, geeft dat door aan een maat op Automatisch.
  assert.deepEqual(opmaakVanMaat({ measurePrecision: 0 }, { fractie: 16, inch: true }, { eigenSchaal: false }), { fractie: 16, inch: true });
});

test('opmaak uit /D: decimaal is de noemer van de precisie', () => {
  assert.deepEqual(opmaakUitGetalopmaken([{ U: 'm', C: 1, D: 100 }]), { unit: 'm', decimalen: 2 });
  assert.deepEqual(opmaakUitGetalopmaken([{ U: 'mm', C: 1, F: 'D', D: 1 }]), { unit: 'mm', decimalen: 0 });
  // Een breuk bij een metrische eenheid kan niet: hele getallen.
  assert.deepEqual(opmaakUitGetalopmaken([{ U: 'mm', C: 1, F: 'F', D: 4 }]), { unit: 'mm', decimalen: 0 });
  assert.equal(opmaakUitGetalopmaken([]), null);
});

test('/D voor het bestand: voet → inch met /F, of één decimale opmaak', () => {
  assert.deepEqual(getalopmaakVoorBestand('ft', { fractie: 16 }), [
    { U: "'", C: 1, F: 'F', D: 16, FD: true, SS: '-' },
    { U: '"', C: 12, F: 'F', D: 16, FD: true, SS: '' },
  ]);
  assert.deepEqual(getalopmaakVoorBestand('m', { decimalen: 3 }), [{ U: 'm', C: 1, D: 1000 }]);
  // Heen en terug.
  for (const fractie of [1, 2, 4, 8, 16, 32, 64]) {
    assert.deepEqual(opmaakUitGetalopmaken(getalopmaakVoorBestand('ft', { fractie })), { unit: 'ft', fractie });
  }
});

test('opmaak van een maat: drie standen van measureFraction', () => {
  const vp = { fractie: 16 };
  // Een breuk: altijd.
  assert.deepEqual(opmaakVanMaat({ measureFraction: 8, measurePrecision: 2 }, vp), { fractie: 8 });
  assert.deepEqual(opmaakVanMaat({ measureFraction: 8 }, vp, { eigenSchaal: false }), { fractie: 8 });
  // 0: uitdrukkelijk decimaal, ook op een blad met een breuk en zonder eigen schaal.
  assert.deepEqual(opmaakVanMaat({ measureFraction: 0, measurePrecision: 2 }, vp, { eigenSchaal: false }), { decimaal: true, decimalen: 2 });
  assert.deepEqual(opmaakVanMaat({ measureFraction: 0 }, vp, { eigenSchaal: false }), { decimaal: true });
  // Niet gezet (automatisch): eigen schaal → eigen decimalen; anders de viewport.
  assert.deepEqual(opmaakVanMaat({ measurePrecision: 3 }, vp), { decimalen: 3 });
  assert.deepEqual(opmaakVanMaat({ measurePrecision: 0 }, vp, { eigenSchaal: false }), { fractie: 16 });
  assert.deepEqual(opmaakVanMaat({ measurePrecision: 0 }, { decimalen: 1 }, { eigenSchaal: false }), { decimalen: 1 });
  assert.deepEqual(opmaakVanMaat({ measurePrecision: 0 }, null, { eigenSchaal: false }), {});
  assert.deepEqual(opmaakVanMaat({}, null), {});
});

test('uitdrukkelijk decimaal gaat voor de voorkeur voet-inch', () => {
  const voorkeur = { formaat: 'feetInch', precisie: 16 };
  const v = 26.5514 / 12;
  assert.equal(maatTekst(v, 'ft', { decimaal: true }, { voorkeur }), '2.21 ft');
  assert.equal(maatTekst(v, 'ft', { decimaal: true, decimalen: 1 }, { voorkeur }), '2.2 ft');
  assert.equal(maatTekst(v, 'ft', {}, { voorkeur }), `2'-2 9/16"`);
});

test('tekst: voet-inch per breuk, decimalen per eenheid, mm heel', () => {
  // 26,551" — de rechthoek uit het voorbeeldbestand, 1 pt langer.
  const voet = 26.5514 / 12;
  assert.equal(maatTekst(voet, 'ft', { fractie: 1 }), `2'-3"`);
  assert.equal(maatTekst(voet, 'ft', { fractie: 4 }), `2'-2 1/2"`);
  assert.equal(maatTekst(voet, 'ft', { fractie: 16 }), `2'-2 9/16"`);
  assert.equal(maatTekst(voet, "'", { fractie: 16 }), `2'-2 9/16"`, "' telt als voet");
  assert.equal(maatTekst(voet, 'ft', {}), '2.21 ft');
  assert.equal(maatTekst(voet, 'ft', { decimalen: 3 }), '2.213 ft');
  // De voorkeur voet-inch geldt zonder eigen decimalen.
  assert.equal(maatTekst(voet, 'ft', {}, { voorkeur: { formaat: 'feetInch', precisie: 8 } }), `2'-2 1/2"`);
  assert.equal(maatTekst(voet, 'ft', { decimalen: 1 }, { voorkeur: { formaat: 'feetInch', precisie: 8 } }), '2.2 ft');
  // Metrisch: zoals voorheen.
  assert.equal(maatTekst(1234.56, 'mm', { decimalen: 2 }), '1235');
  assert.equal(maatTekst(1234.56, 'mm', {}, { maatlijn: false }), '1235 mm');
  assert.equal(maatTekst(1.2345, 'm', {}), '1.23 m');
  assert.equal(maatTekst(12.345, 'cm', {}), '12.3 cm');
  // Een breuk bij een metrische eenheid doet niets.
  assert.equal(maatTekst(1.2345, 'm', { fractie: 16 }), '1.23 m');
});
