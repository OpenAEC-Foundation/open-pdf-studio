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

test('different title fonts match in both directions, but a different number does not', () => {
  for (const [sourceH, targetH] of [[8.5, 11.5], [11.5, 8.5]]) {
    const source = [v('A', 10, 10, sourceH), v('S4.01', 0, 20, sourceH)];
    const target = [v('A', 110, 110, targetH), v('S1.01', 100, 125, 8.5)];
    const unrelated = [v('B', 310, 110, targetH), v('S1.01', 300, 125, 8.5)];
    const p = kiesPlekken(new Map([[2, [...target, ...unrelated]]]), { page: 1, woorden: source, blad: 'S1.01' }, 2);
    assert.equal(p[0].aantal, 1); assert.deepEqual(p[0].vakken, target);
  }
});
test('same-sheet match excludes clicked bubble and unrelated copies of its sheet number', () => {
  const clicked = [v('A', 10, 10), v('S4.01', 0, 20)];
  const title = [v('A', 110, 110, 11.5), v('S4.01', 100, 125)];
  const other = [v('B', 310, 110), v('S4.01', 300, 120)];
  const p = kiesPlekken(new Map([[1, [...clicked, ...title, ...other]]]), { page: 1, woorden: clicked, blad: 'S4.01' }, 1);
  assert.deepEqual(p[0].vakken, title);
});
test('all matching places are retained, including more than forty instances', () => {
  const target = Array.from({ length: 45 }, (_, i) => [v('A', i * 100, 10), v('S1.01', i * 100 - 10, 20)]).flat();
  const p = kiesPlekken(new Map([[2, target]]), { page: 1, woorden: [v('A', 0, 0), v('S4.01', -10, 10)], blad: 'S1.01' }, 2);
  assert.equal(p[0].aantal, 45); assert.equal(p[0].vakken.length, 90);
});
test('page labels retain letters and control characters are removed safely', () => {
  assert.equal(bladVanLabel('\u0000S3.01 - DETAILS'), 'S3.01');
  assert.equal(bladVanLabel('DETAILS'), null);
});
import { leesLinkTekst, tekstVakken, woordenOnder } from './link-doelmarkering.js';
test('text cache shares concurrent reads and stops a superseded lookup', async () => {
  let release, calls = 0, valid = true;
  const wait = new Promise(r => { release = r; });
  const pdf = { numPages: 2, async getPage() { calls++; await wait; return { view: [0,0,100,100], async getTextContent() { return { items: [] }; } }; } };
  const first = leesLinkTekst(pdf, () => valid); const second = leesLinkTekst(pdf);
  valid = false; release();
  assert.equal(await first, null); assert.equal((await second).size, 2);
  assert.equal((await leesLinkTekst(pdf)).size, 2); assert.equal(calls, 2);
  const otherPdf = { ...pdf }; await leesLinkTekst(otherPdf); assert.equal(calls, 4);
});
test('failed page reads can be retried without poisoning the cache', async () => {
  let calls = 0;
  const pdf = { numPages: 1, async getPage() { if (++calls === 1) throw Error('read failed'); return { view: [0,0,100,100], async getTextContent() { return { items: [] }; } }; } };
  await assert.rejects(leesLinkTekst(pdf), /read failed/);
  assert.equal((await leesLinkTekst(pdf)).size, 1); assert.equal(calls, 2);
});
test('link rectangles and text boxes share a nonzero CropBox frame', () => {
  const view = [100,200,300,400];
  const boxes = tekstVakken([{ str: 'A', transform: [10,0,0,10,120,370], width: 8, height: 10 }], view);
  assert.deepEqual(woordenOnder(boxes, [115,365,135,385], view), boxes);
  assert.deepEqual(woordenOnder(boxes, [200,220,230,250], view), []);
});
