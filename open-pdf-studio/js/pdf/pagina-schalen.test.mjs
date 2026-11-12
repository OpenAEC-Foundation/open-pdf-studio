import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseerSchaal, paginaSchaal, metPaginaSchaal, herschikSchalen, kiesPaginaSchaal } from './pagina-schalen.js';

test('normaliseerSchaal reads the usual ways of writing a scale', () => {
  assert.equal(normaliseerSchaal('1:100'), '1:100');
  assert.equal(normaliseerSchaal(' 1 : 50 '), '1:50');
  assert.equal(normaliseerSchaal('1/20'), '1:20');
  assert.equal(normaliseerSchaal('200'), '1:200');
  assert.equal(normaliseerSchaal('2.5'), '1:2.5');
  assert.equal(normaliseerSchaal(''), null);
  assert.equal(normaliseerSchaal('abc'), null);
  assert.equal(normaliseerSchaal('0'), null);
  assert.equal(normaliseerSchaal('2:1'), null);
});

test('metPaginaSchaal sets and clears without touching the original', () => {
  const oud = { 1: { scaleRatio: '1:50', unit: 'mm', method: 'manual' } };
  const nieuw = metPaginaSchaal(oud, [2, 3], '1:100', 'auto-detect');
  assert.equal(oud[2], undefined);
  assert.deepEqual(nieuw[2], { scaleRatio: '1:100', unit: 'mm', method: 'auto-detect' });
  assert.equal(nieuw[1].scaleRatio, '1:50');
  const leeg = metPaginaSchaal(nieuw, [1, 2], null);
  assert.deepEqual(Object.keys(leeg), ['3']);
  assert.equal(paginaSchaal({ pageScales: leeg }, 3).scaleRatio, '1:100');
  assert.equal(paginaSchaal({ pageScales: leeg }, 1), null);
});

test('herschikSchalen moves scales with their pages and drops deleted ones', () => {
  const s = { 1: { scaleRatio: '1:100' }, 2: { scaleRatio: '1:20' }, 3: { scaleRatio: '1:5' } };
  // page 2 deleted, 3 becomes 2
  assert.deepEqual(herschikSchalen(s, { 1: 1, 2: null, 3: 2 }, 2), { 1: s[1], 2: s[3] });
  // swapped
  assert.deepEqual(herschikSchalen(s, { 1: 2, 2: 1, 3: 3 }, 3), { 1: s[2], 2: s[1], 3: s[3] });
  assert.equal(herschikSchalen(null, { 1: 1 }, 1), null);
});

test('kiesPaginaSchaal prefers the scale next to SCALE', () => {
  const r = kiesPaginaSchaal([
    { text: 'DETAIL A 1:20' }, { text: 'DETAIL B 1:20' }, { text: 'SCALE' }, { text: '1:100 @ A1' },
  ]);
  assert.equal(r.ratio, 100);
  assert.deepEqual(r.alle.sort(), ['1:100', '1:20']);
});

test('kiesPaginaSchaal falls back to the most frequent, reads pdf.js str items, and split text', () => {
  assert.equal(kiesPaginaSchaal([{ str: '1:50' }, { str: 'x 1:50' }, { str: '1:10' }]).ratio, 50);
  assert.equal(kiesPaginaSchaal([{ text: 'SCALE 1 : 200' }]).ratio, 200);
  assert.equal(kiesPaginaSchaal([{ text: 'no scale here' }, { text: 'TIME 12:30' }]), null);
  assert.equal(kiesPaginaSchaal([]), null);
});
