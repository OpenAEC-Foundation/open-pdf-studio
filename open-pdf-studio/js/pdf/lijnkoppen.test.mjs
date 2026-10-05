// Lijnkoppen van pijlen naar /LE en terug. Een stijl die /LE niet kent
// ('stealth') gaat als de dichtstbijzijnde /LE-naam het bestand in, plus de
// exacte stijl in /OPS_LineHeads, zodat de kop na heropenen dezelfde is.

import assert from 'node:assert/strict';
import test from 'node:test';

import { kopNaarLE, koppenUitBestand, koppenSleutel } from './lijnkoppen.js';

test('elke kop van het lint heeft een /LE-naam', () => {
  assert.equal(kopNaarLE('open'), 'OpenArrow');
  assert.equal(kopNaarLE('closed'), 'ClosedArrow');
  assert.equal(kopNaarLE('stealth'), 'OpenArrow');
  assert.equal(kopNaarLE('openReversed'), 'ROpenArrow');
  assert.equal(kopNaarLE('none'), 'None');
  assert.equal(kopNaarLE(undefined), 'None');
});

test('alleen een kop die /LE niet exact kent, krijgt de eigen sleutel', () => {
  assert.equal(koppenSleutel('none', 'open'), null);
  assert.equal(koppenSleutel('none', 'stealth'), 'none,stealth');
});

test('de eigen sleutel gaat voor /LE', () => {
  assert.deepEqual(koppenUitBestand(['None', 'OpenArrow'], 'none,stealth'), { startHead: 'none', endHead: 'stealth' });
  assert.deepEqual(koppenUitBestand(['ClosedArrow', 'Circle'], null), { startHead: 'closed', endHead: 'circle' });
  assert.deepEqual(koppenUitBestand([], undefined), { startHead: 'none', endHead: 'none' });
});

test('een onbekende waarde in de eigen sleutel valt terug op /LE', () => {
  assert.deepEqual(koppenUitBestand(['None', 'OpenArrow'], 'none,raket'), { startHead: 'none', endHead: 'open' });
});

test('een /LE die een ander programma wijzigde, gaat voor een oude sleutel', () => {
  assert.deepEqual(koppenUitBestand(['None', 'ClosedArrow'], 'none,stealth'), { startHead: 'none', endHead: 'closed' });
  assert.deepEqual(koppenUitBestand(['Circle', 'OpenArrow'], 'none,stealth'), { startHead: 'circle', endHead: 'stealth' });
  assert.deepEqual(koppenUitBestand(['None', 'None'], 'stealth,stealth'), { startHead: 'none', endHead: 'none' });
});
