import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kiesPlekken, bladVanLabel, bladVanPagina } from './link-doelmarkering.js';

const v = (str, x, y, h = 8) => ({ str, x, y, w: str.length * h * 0.6, h, angle: 0 });
const mark = (a, x, y, b = 'X') => [v(a, x, y), v(b, x - 2, y + 10)];

test('number and sheet together: "3" over the sheet clicked from, on every page', () => {
  // Clicked: the detail title 3 / S1.01 on S4.01. Plans carry 3 / S4.01;
  // page 2 also has 3 / S4.02 (another detail), page 4 a title 3 / S1.01.
  const paginas = new Map([
    [1, [...mark('3', 100, 100).map((x, i) => (i ? { ...x, str: 'S1.01' } : x)), v('S4.01', 900, 800, 14)]],
    [2, [...mark('3', 200, 200).map((x, i) => (i ? { ...x, str: 'S4.01' } : x)), ...mark('3', 400, 200).map((x, i) => (i ? { ...x, str: 'S4.02' } : x)), v('S1.01', 900, 800, 14)]],
    [3, [...mark('3', 300, 300).map((x, i) => (i ? { ...x, str: 'S4.01' } : x)), ...mark('5', 500, 300).map((x, i) => (i ? { ...x, str: 'S4.01' } : x)), v('S1.02', 900, 800, 14)]],
    [4, [...mark('3', 100, 100).map((x, i) => (i ? { ...x, str: 'S1.01' } : x)), v('S4.02', 900, 800, 14)]],
  ]);
  const plekken = kiesPlekken(paginas, { page: 1, woorden: [v('3', 0, 0), v('S1.01', 0, 10)], blad: 'S4.01' }, 2);
  assert.deepEqual(plekken.map((p) => [p.page, p.aantal]), [[2, 1], [3, 1]]);
  assert.deepEqual(plekken[0].vakken.map((x) => x.str).sort(), ['3', 'S4.01']);
});

test('no sheet number: the rarest word on the link page', () => {
  const paginas = new Map([[1, []], [2, [...mark('FD01', 100, 100), v('NOTE', 10, 10)]]]);
  const p = kiesPlekken(paginas, { page: 1, woorden: [v('FD01', 0, 0)], blad: null }, 2);
  assert.deepEqual(p.map((x) => x.page), [2]);
});

test('sheet numbers from names and pages', () => {
  assert.equal(bladVanLabel('S3.01 - STRUCTURAL DETAILS'), 'S3.01');
  assert.equal(bladVanLabel('12'), null);
  assert.equal(bladVanPagina([v('S1.02', 0, 0, 8), v('S3.01', 900, 800, 14), v('NOTE', 0, 0, 20)]), 'S3.01');
});
