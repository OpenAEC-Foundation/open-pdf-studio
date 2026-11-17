// Voet, inch en breuken in de directe lengte-invoer tijdens het tekenen en
// het slepen van een handvat (#1145): welke toetsen de buffer aanneemt en wat
// de buffer daarna betekent in de eenheid van de schaal.
import assert from 'node:assert/strict';
import test from 'node:test';

import { magVoetInchTeken } from './voet-inch-toets.js';
import { parseCoordBuffer, beperkEindpunt, maatVormEindpunt } from './coord-invoer.js';
import { nieuwEindpuntVoorInvoer, eenheidVoor } from './grip-lengte.js';

/** Typt de tekst toets voor toets; geeft terug wat de buffer aannam. */
function typ(tekst) {
  let veld = '';
  for (const key of tekst) {
    if (/[0-9.]/.test(key) || magVoetInchTeken(veld, key)) veld += key;
  }
  return veld;
}

test('the buffer takes every key of a feet-inch length', () => {
  for (const tekst of [`12'`, `6"`, `12' 6"`, `12'-6 3/8"`, `12'-6-3/8"`, `6 3/8"`, `3/8"`, `1.5'`, `6.25"`, `12'6"`]) {
    assert.equal(typ(tekst), tekst, tekst);
  }
});

test('keys that cannot belong to a length are refused', () => {
  assert.equal(magVoetInchTeken('', "'"), false, 'no feet mark without a number');
  assert.equal(magVoetInchTeken('', ' '), false, 'a space never starts the entry');
  assert.equal(magVoetInchTeken('', '-'), false, 'the minus sign is not handled here');
  assert.equal(magVoetInchTeken('12', '-'), false, 'no hyphen in a bare number');
  assert.equal(magVoetInchTeken(`12'`, "'"), false);
  assert.equal(magVoetInchTeken(`6"`, '"'), false);
  assert.equal(magVoetInchTeken(`6"`, ' '), false);
  assert.equal(magVoetInchTeken('3/8', '/'), false);
  assert.equal(magVoetInchTeken('12 ', ' '), false);
  assert.equal(magVoetInchTeken('12', 'a'), false);
});

test('a typed length is converted to the unit of the scale', () => {
  assert.deepEqual(parseCoordBuffer(`12'-6"`, 'ft'), { kind: 'length', a: 12.5, b: null });
  assert.deepEqual(parseCoordBuffer(`12'-6"`, 'in'), { kind: 'length', a: 150, b: null });
  assert.deepEqual(parseCoordBuffer(`6 3/8"`, 'in'), { kind: 'length', a: 6.375, b: null });
  assert.deepEqual(parseCoordBuffer(`1"`, 'mm'), { kind: 'length', a: 25.4, b: null });
  assert.deepEqual(parseCoordBuffer(`1.5'`, 'ft'), { kind: 'length', a: 1.5, b: null });
  // Een kaal getal blijft de eenheid van de schaal.
  assert.deepEqual(parseCoordBuffer('12', 'ft'), { kind: 'length', a: 12, b: null });
  assert.deepEqual(parseCoordBuffer('12 ', 'ft'), { kind: 'length', a: 12, b: null });
});

test('relative and polar entries take feet and inches per field', () => {
  assert.deepEqual(parseCoordBuffer(`12'-6",-3'`, 'ft'), { kind: 'cartesian', a: 12.5, b: -3 });
  assert.deepEqual(parseCoordBuffer(`10'<45`, 'ft'), { kind: 'polar', a: 10, b: 45 });
  // De hoek is geen lengte, en een absolute coördinaat ook niet.
  assert.equal(parseCoordBuffer(`10<4'`, 'ft').kind, 'invalid');
  assert.equal(parseCoordBuffer(`=10',20`, 'ft').kind, 'invalid');
});

test('half-typed or ambiguous entries are invalid, not guessed', () => {
  for (const buf of [`12' 6 3/`, `12 6"`, `6 3/8`, `6.5 3/8"`, `12'6'`]) {
    assert.equal(parseCoordBuffer(buf, 'ft').kind, 'invalid', buf);
  }
  // Zonder eenheid (een factor, of een aanroeper die geen schaal kent) is een
  // voet-inchmaat geen getal.
  assert.equal(parseCoordBuffer(`12'`).kind, 'invalid');
  assert.equal(parseCoordBuffer(`12'`, 'px').kind, 'invalid');
});

test('the endpoint lands at the typed feet-inch length', () => {
  // 1/8" = 1'-0": 1 ft werkelijk = 9 pt papier.
  const pxPerFt = 9;
  const p = beperkEindpunt(parseCoordBuffer(`12'-6"`, 'ft'), 0, 0, 10, 0, pxPerFt);
  assert.ok(Math.abs(p.x - 112.5) < 1e-9 && p.y === 0 && p.constrained);
  // Dezelfde maat bij een metrische schaal 1:100 in mm.
  const pxPerMm = 72 / 25.4 / 100;
  const q = beperkEindpunt(parseCoordBuffer(`12'-6"`, 'mm'), 0, 0, 10, 0, pxPerMm);
  assert.ok(Math.abs(q.x - 150 * 25.4 * pxPerMm) < 1e-9);
  const v = maatVormEindpunt(parseCoordBuffer(`2',1'-6"`, 'ft'), 0, 0, 5, 5, pxPerFt);
  assert.ok(Math.abs(v.x - 18) < 1e-9 && Math.abs(v.y - 13.5) < 1e-9);
});

test('dragging a grip: the typed feet-inch length in the unit of the dimension', () => {
  const maat = { type: 'measureDistance', measureScale: 1 / 9, measureUnit: 'ft' };
  assert.equal(eenheidVoor(maat, 'mm'), 'ft');
  assert.equal(eenheidVoor({ type: 'line' }, 'in'), 'in');
  assert.equal(eenheidVoor({ type: 'line' }, undefined), 'mm');
  const doel = nieuwEindpuntVoorInvoer(`2'-6"`, { x: 0, y: 0 }, { x: 0, y: 5 }, 9, null, 'ft');
  assert.ok(Math.abs(doel.x) < 1e-9 && Math.abs(doel.y - 22.5) < 1e-9);
  // Zonder eenheid blijft het gedrag van voorheen: geen voet-inch.
  assert.equal(nieuwEindpuntVoorInvoer(`2'-6"`, { x: 0, y: 0 }, { x: 0, y: 5 }, 9), null);
});
