// Welke tekst een ingelezen tekstvak krijgt.
//
// De loader nam de regels die PDF.js uit de appearance haalt. Die kennen geen
// lege regel tussen alinea's en maken van elke zichtbare regelafbreking een
// harde afbreking. De echte tekst staat in /Contents (platte tekst, met \r\r
// tussen alinea's). Komt die op witruimte na overeen met wat de appearance
// toont, dan is hij de bron; anders blijft de appearance leidend.

import assert from 'node:assert/strict';
import test from 'node:test';

import { kiesTekstvakTekst } from './tekstvak-tekst.js';

const APPEARANCE = 'Bij JG Timmer verdien in ook € 22 bruto, maar\nwel € 28,30 netto (zie berekening)\nZou jij het bruto uurloon kunnen\nophogen?';
const CONTENTS = 'Bij JG Timmer verdien in ook € 22 bruto, maar wel € 28,30 netto (zie berekening)\r\rZou jij het bruto uurloon kunnen ophogen? ';

test('/Contents is de bron als hij overeenkomt: alinea’s met witregel, zonder harde afbrekingen', () => {
  assert.equal(kiesTekstvakTekst({ appearanceTekst: APPEARANCE, contents: CONTENTS }),
    'Bij JG Timmer verdien in ook € 22 bruto, maar wel € 28,30 netto (zie berekening)\n\nZou jij het bruto uurloon kunnen ophogen?');
});

test('een afwijkende /Contents (verouderd) laat de appearance leidend', () => {
  assert.equal(kiesTekstvakTekst({ appearanceTekst: 'Nieuwe tekst', contents: 'Oude tekst' }), 'Nieuwe tekst');
});

test('de appearance in WinAnsi met vervangtekens wijst /Contents (echte tekens) als bron aan', () => {
  assert.equal(kiesTekstvakTekst({ appearanceTekst: 'Prijs ? 5', contents: 'Prijs ₹ 5' }), 'Prijs ₹ 5');
});

test('zonder /Contents blijft de appearance', () => {
  assert.equal(kiesTekstvakTekst({ appearanceTekst: 'alleen dit', contents: '' }), 'alleen dit');
});

test('zonder appearance-tekst is /Contents de tekst', () => {
  assert.equal(kiesTekstvakTekst({ appearanceTekst: '', contents: 'regel 1\rregel 2' }), 'regel 1\nregel 2');
});

test('voorloopspaties die de appearance niet toont, vallen weg', () => {
  assert.equal(kiesTekstvakTekst({ appearanceTekst: 'Bouwbedrijf Boer BV', contents: ' Bouwbedrijf Boer BV' }), 'Bouwbedrijf Boer BV');
  assert.equal(kiesTekstvakTekst({ appearanceTekst: 'a\nb', contents: '  a\r  b' }), 'a\nb');
});

test('toont de appearance zelf voorloopspaties, dan blijven ze', () => {
  assert.equal(kiesTekstvakTekst({ appearanceTekst: '  ingesprongen', contents: '  ingesprongen' }), '  ingesprongen');
});

test('bij gemengde opmaak vallen voorloopspaties die de appearance niet toont ook uit de runs', async () => {
  const { runsZonderInspringing } = await import('./tekstvak-tekst.js');
  const runs = [[{ text: ' ', bold: false }, { text: 'Bouwbedrijf', bold: true }, { text: ' Boer BV', bold: false }]];
  assert.deepEqual(runsZonderInspringing(runs, 'Bouwbedrijf Boer BV'),
    [[{ text: 'Bouwbedrijf', bold: true }, { text: ' Boer BV', bold: false }]]);
  assert.equal(runsZonderInspringing(runs, ' Bouwbedrijf Boer BV'), runs, 'toont de appearance de spatie, dan blijft hij');
});
