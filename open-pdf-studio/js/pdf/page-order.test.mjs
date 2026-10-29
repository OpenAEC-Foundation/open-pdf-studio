// Page order model of the page organizer (#763): moving a group of pages to
// a gap, keyboard moves, edge positions, and the mappings page-manager.js
// applies to annotations and bookmarks.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  identityOrder, isIdentityOrder, isPageOrder, moveGroupToGap, gapForDrop, isNoOpGap,
  moveSelectionBy, moveSelectionToEdge, rangeInOrder, pageMappingForOrder,
  remapBookmarkPages, gapFromRects, stepRow,
} from './page-order.js';

const O = identityOrder(6); // [1..6]

test('identity order and validation', () => {
  assert.deepEqual(O, [1, 2, 3, 4, 5, 6]);
  assert.equal(isIdentityOrder(O), true);
  assert.equal(isIdentityOrder([2, 1]), false);
  assert.equal(isPageOrder([3, 1, 2], 3), true);
  assert.equal(isPageOrder([1, 1, 2], 3), false, 'a page twice');
  assert.equal(isPageOrder([1, 2], 3), false, 'a page missing');
  assert.equal(isPageOrder([0, 1, 2], 3), false, 'out of range');
  assert.equal(isPageOrder([1, 2, 3.5], 3), false);
});

test('a single page moves to a gap counted before the move', () => {
  assert.deepEqual(moveGroupToGap(O, [2], 5), [1, 3, 4, 5, 2, 6]);
  assert.deepEqual(moveGroupToGap(O, [5], 1), [1, 5, 2, 3, 4, 6]);
});

test('a group keeps its relative order and lands together, also when not contiguous', () => {
  assert.deepEqual(moveGroupToGap(O, [2, 3], 6), [1, 4, 5, 6, 2, 3]);
  assert.deepEqual(moveGroupToGap(O, [5, 2], 0), [2, 5, 1, 3, 4, 6], 'order of the document, not of the click');
  assert.deepEqual(moveGroupToGap(O, [1, 4, 6], 3), [2, 3, 1, 4, 6, 5]);
});

test('edge positions: the start, the end, and gaps out of range are clamped', () => {
  assert.deepEqual(moveGroupToGap(O, [4], 0), [4, 1, 2, 3, 5, 6]);
  assert.deepEqual(moveGroupToGap(O, [1], 6), [2, 3, 4, 5, 6, 1]);
  assert.deepEqual(moveGroupToGap(O, [3], 99), [1, 2, 4, 5, 6, 3]);
  assert.deepEqual(moveGroupToGap(O, [3], -4), [3, 1, 2, 4, 5, 6]);
  assert.deepEqual(moveSelectionToEdge(O, [3, 5], 'start'), [3, 5, 1, 2, 4, 6]);
  assert.deepEqual(moveSelectionToEdge(O, [3, 5], 'end'), [1, 2, 4, 6, 3, 5]);
  assert.deepEqual(moveGroupToGap(O, [], 2), O, 'nothing selected: nothing moves');
});

test('the input order is not changed', () => {
  const order = [1, 2, 3];
  moveGroupToGap(order, [1], 3);
  moveSelectionBy(order, [1], 1);
  assert.deepEqual(order, [1, 2, 3]);
});

test('drop gaps: in front of or after the target; gaps next to the selection change nothing', () => {
  const order = [3, 1, 2];
  assert.equal(gapForDrop(order, 1, 'before'), 1);
  assert.equal(gapForDrop(order, 1, 'after'), 2);
  assert.equal(gapForDrop(order, 9, 'after'), -1);
  assert.equal(isNoOpGap(O, [2, 3], 1), true);
  assert.equal(isNoOpGap(O, [2, 3], 2), true);
  assert.equal(isNoOpGap(O, [2, 3], 3), true);
  assert.equal(isNoOpGap(O, [2, 3], 4), false);
  assert.equal(isNoOpGap(O, [2, 4], 3), false, 'closing up a split selection is a change');
});

test('keyboard: the selection steps left and right as a block and stops at the edges', () => {
  assert.deepEqual(moveSelectionBy(O, [3, 4], -1), [1, 3, 4, 2, 5, 6]);
  assert.deepEqual(moveSelectionBy(O, [3, 4], 1), [1, 2, 5, 3, 4, 6]);
  assert.deepEqual(moveSelectionBy(O, [1], -1), O, 'first page stays first');
  assert.deepEqual(moveSelectionBy(O, [6], 1), O, 'last page stays last');
  assert.deepEqual(moveSelectionBy(O, [1, 3], -1), [1, 3, 2, 4, 5, 6], 'the page at the edge stays, the other moves');
  assert.deepEqual(moveSelectionBy(O, [5, 6], 1), O);
  let order = O;
  for (let i = 0; i < 10; i++) order = moveSelectionBy(order, [4], -1);
  assert.deepEqual(order, [4, 1, 2, 3, 5, 6]);
});

test('Shift+click ranges follow the order as shown', () => {
  const order = [3, 1, 4, 2];
  assert.deepEqual(rangeInOrder(order, 1, 2), [1, 4, 2]);
  assert.deepEqual(rangeInOrder(order, 2, 3), [3, 1, 4, 2]);
  assert.deepEqual(rangeInOrder(order, 9, 4), [4], 'unknown anchor: the page alone');
});

test('page mapping and bookmarks follow the new order', () => {
  const mapping = pageMappingForOrder([3, 1, 4, 2]);
  assert.deepEqual(mapping, { 3: 1, 1: 2, 4: 3, 2: 4 });
  const bookmarks = [
    { id: 'a', title: 'Intro', page: 1, parentId: null, sortOrder: 0 },
    { id: 'b', title: 'Detail', page: 3, parentId: 'a', sortOrder: 0 },
    { id: 'c', title: 'Odd', page: 9, parentId: null, sortOrder: 1 },
  ];
  const out = remapBookmarkPages(bookmarks, mapping);
  assert.deepEqual(out.map((b) => [b.id, b.page, b.parentId, b.sortOrder]), [['a', 2, null, 0], ['b', 1, 'a', 0], ['c', 9, null, 1]]);
  assert.equal(bookmarks[0].page, 1, 'the input is not changed');
  assert.equal(remapBookmarkPages(undefined, mapping), undefined);
});

test('the gap under the pointer in a wrapping grid', () => {
  // Two rows of three 100x140 tiles, 10px apart.
  const rects = [];
  for (let i = 0; i < 5; i++) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    rects.push({ left: col * 110, right: col * 110 + 100, top: row * 150, bottom: row * 150 + 140 });
  }
  assert.equal(gapFromRects(rects, 10, 50), 0, 'left half of the first tile');
  assert.equal(gapFromRects(rects, 90, 50), 1, 'right half of the first tile');
  assert.equal(gapFromRects(rects, 105, 50), 1, 'in the gap between tiles: nearest tile');
  assert.equal(gapFromRects(rects, 300, 70), 3, 'right half of the last tile of the row');
  assert.equal(gapFromRects(rects, 5, 200), 3, 'start of the second row');
  assert.equal(gapFromRects(rects, 320, 200), 5, 'empty space after the last tile: the end');
  assert.equal(gapFromRects(rects, 20, 145), 0, 'between rows: the nearest row');
  assert.equal(gapFromRects([], 1, 1), 0);
});

test('stepping a row up or down in the grid', () => {
  assert.equal(stepRow(4, 10, 3, -1), 1);
  assert.equal(stepRow(4, 10, 3, 1), 7);
  assert.equal(stepRow(8, 10, 3, 1), 9, 'clamped to the last tile');
  assert.equal(stepRow(1, 10, 3, -1), 0);
});
