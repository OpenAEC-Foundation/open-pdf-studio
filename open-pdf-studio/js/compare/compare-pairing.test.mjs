// Compare page pairing (#465): sheet numbers from the title block, page
// labels and content fingerprints; reordered and inserted sheets; manual
// correction of the pairing list.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractSheetNumber, pageTokens, pairPages, assignPair, indexPairs, orderPairs, jaccard, thumbSimilarity, thumbFromDensity,
} from './page-pairing.js';

const W = 1190, H = 842; // A3 landscape in points

// Text items of a drawing sheet: a title block bottom right with the sheet
// number, plus drawing text.
function sheetItems(sheetNo, words, { keyword = 'Sheet', project = 'P-2024' } = {}) {
  const items = [
    { str: 'Project', x: 900, y: 760, w: 40, h: 8 },
    { str: project, x: 960, y: 760, w: 40, h: 8 },
    { str: 'Scale 1:100', x: 900, y: 780, w: 60, h: 8 },
    { str: '12-03-2024', x: 1000, y: 780, w: 50, h: 8 },
  ];
  if (keyword) items.push({ str: keyword, x: 900, y: 800, w: 30, h: 8 });
  if (sheetNo) items.push({ str: sheetNo, x: 960, y: 798, w: 40, h: 14 });
  words.forEach((w, i) => items.push({ str: w, x: 50 + (i % 10) * 70, y: 50 + Math.floor(i / 10) * 20, w: 60, h: 8 }));
  return items;
}

const vocab = (seed, n = 30) => Array.from({ length: n }, (_, i) => `w${seed}x${i}`);

function page(index, sheet, seed, opts) {
  const items = sheetItems(sheet, vocab(seed), opts);
  return { index, label: null, sheet: extractSheetNumber(items, W, H), tokens: pageTokens(items), thumb: null };
}

test('sheet number from the title block, not the project number or the date', () => {
  assert.equal(extractSheetNumber(sheetItems('A-101', []), W, H), 'A-101');
  assert.equal(extractSheetNumber(sheetItems('S2.03', [], { keyword: 'Drawing no.' }), W, H), 'S2.03');
  assert.equal(extractSheetNumber(sheetItems('104', [], { keyword: 'Blad' }), W, H), '104');
  // "Sheet: E-12" in one text item.
  assert.equal(extractSheetNumber([{ str: 'Sheet: E-12', x: 950, y: 800, w: 80, h: 10 }], W, H), 'E-12');
  // A bare number without a keyword is no sheet number.
  assert.equal(extractSheetNumber([{ str: '17', x: 1100, y: 820, w: 10, h: 8 }], W, H), null);
  assert.equal(extractSheetNumber([], W, H), null);
});

test('inserted and reordered sheets pair on sheet number; unmatched pages are marked', () => {
  const oldPages = [page(1, 'A-100', 1), page(2, 'A-101', 2), page(3, 'A-102', 3), page(4, 'A-103', 4)];
  // New revision: A-105 inserted at 2, A-102 and A-103 swapped, A-101 removed.
  const newPages = [page(1, 'A-100', 1), page(2, 'A-105', 9), page(3, 'A-103', 4), page(4, 'A-102', 3)];
  const pairs = pairPages(oldPages, newPages);
  const matched = pairs.filter((p) => p.old && p.new).map((p) => [p.old, p.new, p.reason]);
  assert.deepEqual(matched, [[1, 1, 'sheet'], [4, 3, 'sheet'], [3, 4, 'sheet']]);
  assert.deepEqual(pairs.filter((p) => !p.old).map((p) => p.new), [2]);
  assert.deepEqual(pairs.filter((p) => !p.new).map((p) => p.old), [2]);
  // "Only in old" A-101 sits right after the pair of the page before it (A-100).
  assert.deepEqual(pairs.map((p) => [p.old, p.new]), [[1, 1], [2, null], [null, 2], [4, 3], [3, 4]]);
});

test('without sheet numbers the content fingerprint pairs moved pages', () => {
  const plain = (i, seed) => {
    const items = sheetItems(null, vocab(seed), { keyword: null });
    return { index: i, label: null, sheet: null, tokens: pageTokens(items), thumb: null };
  };
  const oldPages = [plain(1, 1), plain(2, 2), plain(3, 3)];
  const newPages = [plain(1, 3), plain(2, 1), plain(3, 7), plain(4, 2)];
  const pairs = pairPages(oldPages, newPages);
  const m = Object.fromEntries(pairs.filter((p) => p.old && p.new).map((p) => [p.old, p.new]));
  assert.deepEqual(m, { 1: 2, 2: 4, 3: 1 });
  assert.ok(pairs.every((p) => !p.old || !p.new || p.reason === 'content'));
  assert.deepEqual(pairs.filter((p) => !p.old).map((p) => p.new), [3]);
});

test('own page labels pair pages when there are no sheet numbers', () => {
  const p = (index, label) => ({ index, label, sheet: null, tokens: new Set(), thumb: null });
  const pairs = pairPages([p(1, 'i'), p(2, 'ii'), p(3, '1')], [p(1, 'ii'), p(2, 'i'), p(3, 'iii'), p(4, '1')]);
  const m = pairs.filter((x) => x.old && x.new).map((x) => [x.old, x.new, x.reason]);
  assert.deepEqual(m.sort(), [[1, 2, 'label'], [2, 1, 'label'], [3, 4, 'label']].sort());
});

test('scans without text pair on their thumbnails', () => {
  const thumb = (seed) => {
    const d = new Float32Array(32 * 32);
    for (let i = 0; i < 60; i++) d[((seed * 31 + i * 17) * 7) % d.length] = 1;
    return thumbFromDensity(d, 32, 32, 16);
  };
  const p = (index, seed) => ({ index, label: null, sheet: null, tokens: new Set(), thumb: thumb(seed) });
  const pairs = pairPages([p(1, 1), p(2, 2)], [p(1, 2), p(2, 1)]);
  const m = Object.fromEntries(pairs.filter((x) => x.old && x.new).map((x) => [x.old, x.new]));
  assert.deepEqual(m, { 1: 2, 2: 1 });
  assert.ok(thumbSimilarity(thumb(1), thumb(1)) > 0.99);
});

test('empty pages fall back to the page order', () => {
  const p = (index) => ({ index, label: null, sheet: null, tokens: new Set(), thumb: null });
  const pairs = pairPages([p(1), p(2)], [p(1), p(2), p(3)]);
  assert.deepEqual(pairs.map((x) => [x.old, x.new, x.reason]), [[1, 1, 'index'], [2, 2, 'index'], [null, 3, 'only-new']]);
});

test('the user can correct the pairing list', () => {
  let rows = indexPairs(3, 3);
  // Pair old 1 with new 2: old 2 and new 1 lose their partner.
  rows = assignPair(rows, 1, 2);
  assert.deepEqual(rows.map((r) => [r.old, r.new]), [[null, 1], [1, 2], [2, null], [3, 3]]);
  assert.equal(rows.find((r) => r.old === 1).reason, 'manual');
  // Unpair old 3.
  rows = assignPair(rows, 3, null);
  assert.deepEqual(rows.filter((r) => r.old && r.new).map((r) => [r.old, r.new]), [[1, 2]]);
  assert.equal(rows.length, 5);
});

test('helpers: tokens, Jaccard, ordering of unmatched pages', () => {
  const t = pageTokens([{ str: 'Wall W-01, door 2350' }]);
  assert.ok(t.has('wall') && t.has('2350'));
  assert.equal(jaccard(new Set(['a', 'b']), new Set(['b', 'c'])), 1 / 3);
  assert.deepEqual(orderPairs([{ old: 2, new: 1 }], [1, 2, 3], [1]).map((r) => [r.old, r.new]), [[1, null], [2, 1], [3, null]]);
});
