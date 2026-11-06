import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paginaKnopen, volgendePaginaTreffer } from './miniatuur-zoeken.js';

const labels = ['S-101 BEGANE GROND', 'S-201 DOORSNEDE', null, 'V900', 'DETAIL S-2'];

test('knopen: label, of het nummer zonder label', () => {
  assert.deepEqual(paginaKnopen(3, labels).map(k => k.title), ['S-101 BEGANE GROND', 'S-201 DOORSNEDE', '3']);
  assert.deepEqual(paginaKnopen(2, null).map(k => k.title), ['1', '2']);
});

test('eerst "begint met", dan "bevat", rondgaand', () => {
  assert.equal(volgendePaginaTreffer(5, labels, 's-2'), 2);
  assert.equal(volgendePaginaTreffer(5, labels, 's-2', 2), 5);
  assert.equal(volgendePaginaTreffer(5, labels, 's-2', 5), 2);
});

test('hoofdletters tellen niet; nummer van een pagina zonder label', () => {
  assert.equal(volgendePaginaTreffer(5, labels, 'v9'), 4);
  assert.equal(volgendePaginaTreffer(5, labels, '3'), 3);
});

test('geen treffer of lege tekst: null', () => {
  assert.equal(volgendePaginaTreffer(5, labels, 'xyz'), null);
  assert.equal(volgendePaginaTreffer(5, labels, '   '), null);
  assert.equal(volgendePaginaTreffer(0, labels, 's'), null);
});
