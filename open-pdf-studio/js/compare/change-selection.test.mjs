// Selecting several changes in the compare change list (#1149): Ctrl+click,
// Shift+click ranges, select all, per kind, and what stays selectable.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectableOrder, clickSelection, selectionState, setAll, pruneSelection, isSelectable,
} from './change-selection.js';

// The change list as the detection gives it: sorted by position, kinds mixed.
const mk = (id, type, source = 'pixel') => ({ id, type, source });
const list = [
  mk('a1', 'added'), mk('r1', 'removed'), mk('m1', 'modified'), mk('a2', 'added'),
  mk('r2', 'removed'), mk('a3', 'added'), mk('n1', 'added', 'annotation'), mk('m2', 'modified'), mk('v1', 'removed', 'vector'),
];
const ids = (x) => [...x].map((c) => c.id);
const by = (id) => list.find((c) => c.id === id);
const order = selectableOrder(list, { added: true, removed: true, modified: true });
const start = () => ({ selected: new Set(), anchor: null });

test('the order is that of the list on screen: per kind, annotations left out', () => {
  assert.deepEqual(ids(order), ['a1', 'a2', 'a3', 'r1', 'r2', 'v1', 'm1', 'm2']);
  assert.equal(isSelectable(by('n1')), false);
  assert.equal(isSelectable(null), false);
  // A kind that is switched off is not in the order.
  assert.deepEqual(ids(selectableOrder(list, { added: true, removed: false, modified: true })), ['a1', 'a2', 'a3', 'm1', 'm2']);
  // A change of an unknown kind is listed with the modified ones.
  assert.deepEqual(ids(selectableOrder([mk('x', 'weird'), mk('a', 'added')])), ['a', 'x']);
  assert.deepEqual(selectableOrder(null), []);
});

test('a plain click shows the change and keeps the selection', () => {
  const s = { selected: new Set([by('a1'), by('r1')]), anchor: by('r1') };
  const r = clickSelection(s, by('m1'), {}, order);
  assert.equal(r.focus, true);
  assert.deepEqual(ids(r.selected), ['a1', 'r1']);
  assert.equal(r.anchor, by('m1'));
  // The state that was passed in is not changed.
  assert.deepEqual(ids(s.selected), ['a1', 'r1']);
});

test('Ctrl+click adds a change and takes it out again, without showing it', () => {
  let s = start();
  for (const id of ['a2', 'm1', 'r2']) {
    const r = clickSelection(s, by(id), { ctrl: true }, order);
    assert.equal(r.focus, false);
    s = r;
  }
  assert.deepEqual(ids(s.selected).sort(), ['a2', 'm1', 'r2']);
  s = clickSelection(s, by('m1'), { ctrl: true }, order);
  assert.deepEqual(ids(s.selected).sort(), ['a2', 'r2']);
  assert.equal(s.anchor, by('m1'));
  // The check box does the same.
  s = clickSelection(s, by('m1'), { checkbox: true }, order);
  assert.ok(s.selected.has(by('m1')));
  assert.equal(s.focus, false);
});

test('Shift+click selects the range from the last clicked change, across kinds, in list order', () => {
  let s = clickSelection(start(), by('a2'), { ctrl: true }, order);
  s = clickSelection(s, by('r2'), { shift: true }, order);
  assert.deepEqual(ids(s.selected), ['a2', 'a3', 'r1', 'r2']);
  assert.equal(s.focus, false);
  // The anchor stays: a second Shift+click moves the other end, upwards too.
  assert.equal(s.anchor, by('a2'));
  s = clickSelection(s, by('a1'), { shift: true }, order);
  assert.deepEqual(ids(s.selected).sort(), ['a1', 'a2', 'a3', 'r1', 'r2']);
  // After a plain click the range starts there.
  s = clickSelection({ selected: new Set(), anchor: s.anchor }, by('m1'), {}, order);
  s = clickSelection(s, by('m2'), { shift: true }, order);
  assert.deepEqual(ids(s.selected), ['m1', 'm2']);
});

test('Shift+click without an earlier click selects from the top of the list', () => {
  const s = clickSelection(start(), by('r1'), { shift: true }, order);
  assert.deepEqual(ids(s.selected), ['a1', 'a2', 'a3', 'r1']);
  assert.equal(s.anchor, by('a1'));
  // An anchor that is no longer in the list (its kind was switched off) counts as none.
  const narrowed = selectableOrder(list, { added: false });
  const t = clickSelection({ selected: new Set(), anchor: by('a2') }, by('r2'), { shift: true }, narrowed);
  assert.deepEqual(ids(t.selected), ['r1', 'r2']);
});

test('Shift+click on the check box selects a range as well; Ctrl+Shift adds to what is selected', () => {
  let s = clickSelection(start(), by('m2'), { ctrl: true }, order);
  s = clickSelection(s, by('a1'), { ctrl: true }, order);
  s = clickSelection(s, by('a3'), { shift: true, ctrl: true, checkbox: true }, order);
  assert.deepEqual(ids(s.selected).sort(), ['a1', 'a2', 'a3', 'm2']);
});

test('an annotation change is never selected; clicking it still shows it', () => {
  const s = clickSelection(start(), by('n1'), { ctrl: true }, order);
  assert.equal(s.selected.size, 0);
  const r = clickSelection(start(), by('n1'), {}, order);
  assert.equal(r.focus, true);
  assert.equal(r.anchor, null);
  const range = clickSelection({ selected: new Set(), anchor: by('a1') }, by('n1'), { shift: true }, order);
  assert.equal(range.selected.size, 0);
});

test('select all, none, and per kind; the state for the tri-state check boxes', () => {
  assert.equal(selectionState(new Set(), order), 'none');
  const all = setAll(new Set(), order, true);
  assert.equal(all.size, 8);
  assert.equal(selectionState(all, order), 'all');
  assert.ok(!all.has(by('n1')));
  // One kind off: the rest stays.
  const removed = order.filter((c) => c.type === 'removed');
  const fewer = setAll(all, removed, false);
  assert.deepEqual(ids(fewer), ['a1', 'a2', 'a3', 'm1', 'm2']);
  assert.equal(selectionState(fewer, order), 'some');
  assert.equal(selectionState(fewer, removed), 'none');
  assert.equal(selectionState(fewer, order.filter((c) => c.type === 'added')), 'all');
  assert.equal(setAll(fewer, order, false).size, 0);
  // An empty list has nothing selected.
  assert.equal(selectionState(new Set(), []), 'none');
  // setAll gives a new set.
  assert.notEqual(setAll(all, order, true), all);
});

test('the selection drops what the list no longer shows', () => {
  const all = setAll(new Set(), order, true);
  const narrowed = selectableOrder(list, { added: true, removed: false, modified: true });
  assert.deepEqual(ids(pruneSelection(all, narrowed)), ['a1', 'a2', 'a3', 'm1', 'm2']);
  assert.equal(pruneSelection(null, narrowed).size, 0);
});

test('selecting a thousand changes at once stays one selection', () => {
  const many = Array.from({ length: 1000 }, (_, i) => mk(`c${i}`, i % 3 === 0 ? 'added' : i % 3 === 1 ? 'removed' : 'modified'));
  const o = selectableOrder(many);
  let s = clickSelection(start(), o[0], {}, o);
  s = clickSelection(s, o[o.length - 1], { shift: true }, o);
  assert.equal(s.selected.size, 1000);
  assert.equal(selectionState(s.selected, o), 'all');
});
