// The pending-operations model of the Edit Pages organizer (#764).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  A4, normRotation, createPlan, keysOf, isPlanUnchanged, isStructureUnchanged, moveEntriesToGap,
  moveEntriesBy, moveEntriesToEdge, rotateEntries, wouldDeleteAll, deleteEntries, insertBlank,
  insertSource, blankSizeNeighbour, blankSizeFor, hasSplitAt, toggleSplit, splitAroundSelection,
  clearSplits, splitRanges, isValidPlan, pageMappingForPlan, deletedPages, treeOrderForPlan,
  remapBookmarksForPlan, shownSize, createHistory, pushHistory, undoHistory, redoHistory,
} from './page-edit-plan.js';

const pages = (plan) => plan.entries.map((e) => (e.kind === 'page' ? e.page : e.kind === 'blank' ? 'B' : `${e.source}:${e.index}`));

test('a new plan is the document as it is; Apply would do nothing', () => {
  const p = createPlan(3);
  assert.deepEqual(keysOf(p), ['p1', 'p2', 'p3']);
  assert.deepEqual(pages(p), [1, 2, 3]);
  assert.equal(isPlanUnchanged(p, 3), true);
  assert.equal(isStructureUnchanged(p, 3), true);
  assert.deepEqual(createPlan(0).entries, []);
});

test('rotations add up and wrap; a full turn is no change', () => {
  assert.equal(normRotation(-90), 270);
  assert.equal(normRotation(450), 90);
  let p = rotateEntries(createPlan(2), ['p1'], 90);
  assert.equal(p.entries[0].rotation, 90);
  assert.equal(isPlanUnchanged(p, 2), false);
  p = rotateEntries(p, ['p1'], -90);
  assert.equal(isPlanUnchanged(p, 2), true);
  p = rotateEntries(p, ['p1', 'p2'], 180);
  assert.deepEqual(p.entries.map((e) => e.rotation), [180, 180]);
  assert.equal(rotateEntries(p, [], 90), p, 'no selection: the same plan');
});

test('reorder moves the selection as a group; keyboard steps and edges', () => {
  const p = createPlan(5);
  assert.deepEqual(pages(moveEntriesToGap(p, ['p4', 'p5'], 1)), [1, 4, 5, 2, 3]);
  assert.deepEqual(pages(moveEntriesBy(p, ['p2'], 1)), [1, 3, 2, 4, 5]);
  assert.deepEqual(pages(moveEntriesToEdge(p, ['p3'], 'start')), [3, 1, 2, 4, 5]);
  assert.deepEqual(pages(moveEntriesToEdge(p, ['p1'], 'end')), [2, 3, 4, 5, 1]);
  assert.deepEqual(p.entries.map((e) => e.page), [1, 2, 3, 4, 5], 'the input plan is not changed');
});

test('delete removes entries; deleting every page is refused (no empty document)', () => {
  const p = createPlan(3);
  const { plan, refused } = deleteEntries(p, ['p2']);
  assert.equal(refused, false);
  assert.deepEqual(pages(plan), [1, 3]);
  assert.equal(wouldDeleteAll(plan, ['p1', 'p3']), true);
  const all = deleteEntries(plan, ['p1', 'p3']);
  assert.equal(all.refused, true);
  assert.equal(all.plan, plan, 'the plan stays as it was');
  // A new page alone may not be all that is left either.
  const b = insertBlank(createPlan(1), 1);
  assert.equal(deleteEntries(b.plan, ['p1', ...b.keys]).refused, true);
  assert.equal(deleteEntries(b.plan, ['p1']).refused, false, 'a blank page may stay as the only page');
  assert.equal(deleteEntries(p, ['zz']).plan, p, 'unknown keys: nothing happens');
});

test('insert puts blank pages and the pages of a dropped PDF at the gap', () => {
  const a = insertBlank(createPlan(3), 1, 2);
  assert.deepEqual(pages(a.plan), [1, 'B', 'B', 2, 3]);
  assert.equal(a.keys.length, 2);
  assert.notEqual(a.keys[0], a.keys[1]);
  // External PDF dropped between page 2 and 3 (gap 3 in the plan above).
  const b = insertSource(a.plan, 4, 's1', 3);
  assert.deepEqual(pages(b.plan), [1, 'B', 'B', 2, 's1:0', 's1:1', 's1:2', 3]);
  assert.deepEqual(b.keys, b.plan.entries.slice(4, 7).map((e) => e.key));
  // At the very end and at the start; gaps outside the plan are clamped.
  assert.deepEqual(pages(insertSource(createPlan(2), 99, 's', 1).plan), [1, 2, 's:0']);
  assert.deepEqual(pages(insertSource(createPlan(2), -5, 's', 1).plan), ['s:0', 1, 2]);
  assert.equal(insertSource(createPlan(2), 1, 's', 0).plan.entries.length, 2, 'an empty PDF adds nothing');
  // Keys stay unique across inserts.
  const keys = keysOf(b.plan);
  assert.equal(new Set(keys).size, keys.length);
});

test('a blank page takes the size of the page next to it, the same way up', () => {
  const p = insertBlank(insertBlank(createPlan(2), 0).plan, 3).plan; // B 1 2 B
  assert.equal(blankSizeNeighbour(p.entries, 0).page, 1, 'nothing in front: the page after it');
  assert.equal(blankSizeNeighbour(p.entries, 3).page, 2, 'the page in front of it');
  assert.equal(blankSizeNeighbour(insertBlank(createPlan(0), 0).plan.entries, 0), null);
  assert.deepEqual(blankSizeFor({ width: 300, height: 500 }, 0), { width: 300, height: 500 });
  assert.deepEqual(blankSizeFor({ width: 300, height: 500 }, 90), { width: 500, height: 300 });
  assert.deepEqual(blankSizeFor({ width: 300, height: 500 }, 360 + 180), { width: 300, height: 500 });
  assert.deepEqual(blankSizeFor(null), { ...A4 });
  assert.deepEqual(shownSize(300, 500, 270), { width: 500, height: 300 });
});

test('split marks: toggled per gap, never at the edges, the parts as page ranges', () => {
  let p = createPlan(6);
  assert.equal(toggleSplit(p, 0), p, 'no mark in front of the first page');
  assert.equal(toggleSplit(p, 6), p, 'no mark after the last page');
  p = toggleSplit(toggleSplit(p, 4), 2);
  assert.equal(hasSplitAt(p, 2), true);
  assert.equal(hasSplitAt(p, 3), false);
  assert.deepEqual(splitRanges(p), [{ start: 1, eind: 2 }, { start: 3, eind: 4 }, { start: 5, eind: 6 }]);
  assert.equal(isStructureUnchanged(p, 6), true, 'split marks do not change the document');
  assert.equal(isPlanUnchanged(p, 6), false, 'but Apply has something to do');
  p = toggleSplit(p, 2);
  assert.deepEqual(splitRanges(p), [{ start: 1, eind: 4 }, { start: 5, eind: 6 }]);
  assert.deepEqual(splitRanges(clearSplits(p)), []);
  assert.deepEqual(splitRanges(createPlan(3)), [], 'no marks: nothing to split');
});

test('split marks stay with their gap when pages move or are deleted', () => {
  let p = toggleSplit(createPlan(5), 3); // 1 2 3 | 4 5
  // Deleting the page after the mark moves the mark to the next page.
  p = deleteEntries(p, ['p4']).plan;
  assert.deepEqual(splitRanges(p), [{ start: 1, eind: 3 }, { start: 4, eind: 4 }]);
  // A mark that would end up in front of the first page goes.
  const q = moveEntriesToEdge(toggleSplit(createPlan(3), 1), ['p2'], 'start');
  assert.deepEqual(q.splits, []);
  // Inserting pages in front of a marked page keeps the mark in front of it.
  const r = insertBlank(toggleSplit(createPlan(3), 2), 2).plan; // 1 2 B | 3
  assert.deepEqual(splitRanges(r), [{ start: 1, eind: 3 }, { start: 4, eind: 4 }]);
});

test('batch split: every run of selected pages becomes a part of its own', () => {
  const p = splitAroundSelection(createPlan(7), ['p3', 'p4', 'p6']);
  assert.deepEqual(splitRanges(p), [
    { start: 1, eind: 2 }, { start: 3, eind: 4 }, { start: 5, eind: 5 }, { start: 6, eind: 6 }, { start: 7, eind: 7 },
  ]);
  assert.deepEqual(splitRanges(splitAroundSelection(createPlan(3), ['p1'])), [{ start: 1, eind: 1 }, { start: 2, eind: 3 }]);
});

test('index remapping: old page to new page, deleted pages and the page-tree rewrite', () => {
  let p = createPlan(5);
  p = moveEntriesToGap(p, ['p5'], 0);           // 5 1 2 3 4
  p = deleteEntries(p, ['p2', 'p4']).plan;       // 5 1 3
  p = insertBlank(p, 1).plan;                    // 5 B 1 3
  p = insertSource(p, 4, 'x', 2).plan;           // 5 B 1 3 x0 x1
  assert.deepEqual(pageMappingForPlan(p, 5), { 1: 3, 2: null, 3: 4, 4: null, 5: 1 });
  assert.deepEqual(deletedPages(p, 5), [2, 4]);
  const { added, order, removeCount } = treeOrderForPlan(p, 5);
  // New pages are appended as 6 (blank), 7, 8 (x); deleted pages go last.
  assert.deepEqual(added.map((e) => e.kind), ['blank', 'file', 'file']);
  assert.deepEqual(order, [5, 6, 1, 3, 7, 8, 2, 4]);
  assert.equal(removeCount, 2);
  assert.equal(order.length, 5 + added.length, 'a page order over every page');
});

test('a plan is valid only for its document and the PDFs it uses', () => {
  const p = insertSource(createPlan(3), 1, 's1', 2).plan;
  assert.equal(isValidPlan(p, 3, { s1: 2 }), true);
  assert.equal(isValidPlan(p, 3, {}), false, 'unknown source');
  assert.equal(isValidPlan(p, 3, { s1: 1 }), false, 'source has fewer pages');
  assert.equal(isValidPlan(p, 2, { s1: 2 }), false, 'page 3 is not in a 2-page document');
  assert.equal(isValidPlan({ entries: [], splits: [], seq: 0 }, 3), false, 'never an empty document');
  const dubbel = { entries: [{ key: 'a', kind: 'page', page: 1 }, { key: 'b', kind: 'page', page: 1 }], splits: [] };
  assert.equal(isValidPlan(dubbel, 2), false, 'a page twice');
  assert.equal(isValidPlan({ entries: [{ key: 'a', kind: 'video' }], splits: [] }, 1), false);
});

test('bookmarks follow their page; one on a deleted page moves to the next page that stays', () => {
  const p = deleteEntries(moveEntriesToGap(createPlan(4), ['p4'], 0), ['p2', 'p3']).plan; // 4 1
  const mapping = pageMappingForPlan(p, 4);
  const bm = [
    { id: 'a', page: 1, parentId: null }, { id: 'b', page: 2, parentId: 'a' },
    { id: 'c', page: 3 }, { id: 'd', page: 4 }, { id: 'e', page: 9 },
  ];
  assert.deepEqual(remapBookmarksForPlan(bm, mapping, 4).map((b) => [b.id, b.page, b.parentId]), [
    ['a', 2, null], ['b', 1, 'a'], ['c', 1, undefined], ['d', 1, undefined], ['e', 9, undefined],
  ]);
  // Nothing stays after it: the previous page that stays.
  const q = deleteEntries(createPlan(3), ['p3']).plan;
  assert.equal(remapBookmarksForPlan([{ id: 'x', page: 3 }], pageMappingForPlan(q, 3), 3)[0].page, 2);
  assert.equal(remapBookmarksForPlan(null, {}, 0), null);
});

test('pending history: undo and redo inside the organizer, Cancel needs none of it', () => {
  const a = createPlan(3);
  let h = createHistory(a);
  const b = rotateEntries(a, ['p1'], 90);
  const c = deleteEntries(b, ['p2']).plan;
  h = pushHistory(pushHistory(h, b), c);
  assert.equal(h.present, c);
  assert.equal(pushHistory(h, c), h, 'the same plan records nothing');
  assert.equal(pushHistory(h, moveEntriesBy(c, ['p1'], -1)), h, 'a move that changes nothing records nothing');
  h = undoHistory(h);
  assert.equal(h.present, b);
  h = undoHistory(undoHistory(h));
  assert.equal(h.present, a, 'undo stops at the start');
  h = redoHistory(h);
  assert.equal(h.present, b);
  h = pushHistory(h, moveEntriesBy(b, ['p3'], -1));
  assert.deepEqual(h.future, [], 'a new edit drops the redo');
  assert.equal(redoHistory(h), h);
});
