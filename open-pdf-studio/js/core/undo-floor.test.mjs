// Pure tests for the shared-session undo floor.
//
// The rule these pin down: when an agent draws through the MCP bridge while a
// person redlines the same document, both land on one undo stack. The floor
// marks a finished agent batch as settled so the person's Ctrl-Z stops there
// instead of walking back through the drawing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { undoableDepth, canUndoAt, clampFloor, floorAfterTrim } from './undo-floor.js';

test('with no floor set, the whole stack is undoable', () => {
  assert.equal(undoableDepth(5, 0), 5);
  assert.equal(canUndoAt(5, 0), true);
  assert.equal(canUndoAt(0, 0), false);
});

test('a floor hides everything below it', () => {
  // The agent drew 40 shapes and committed; the person has since drawn 2.
  assert.equal(undoableDepth(42, 40), 2, 'only the person\'s own two are reachable');
  assert.equal(canUndoAt(42, 40), true);

  // The person undoes both. Now Ctrl-Z must stop, not eat the agent's work.
  assert.equal(undoableDepth(40, 40), 0);
  assert.equal(canUndoAt(40, 40), false);
});

test('a floor above the stack length never yields negative depth', () => {
  // Reachable briefly after a trim, and a negative depth would make canUndo
  // true again — the exact bug the floor exists to prevent.
  assert.equal(undoableDepth(3, 10), 0);
  assert.equal(canUndoAt(3, 10), false);
});

test('non-numeric inputs degrade to "nothing settled" rather than throwing', () => {
  assert.equal(undoableDepth(undefined, undefined), 0);
  assert.equal(undoableDepth(5, undefined), 5);
  assert.equal(undoableDepth(5, NaN), 5);
  assert.equal(undoableDepth(-2, 0), 0);
});

test('clampFloor with no argument means "settle everything drawn so far"', () => {
  assert.equal(clampFloor(undefined, 40), 40);
  assert.equal(clampFloor(undefined, 0), 0);
});

test('clampFloor(0) clears the floor, handing undo back to the person', () => {
  assert.equal(clampFloor(0, 40), 0);
  assert.equal(canUndoAt(40, clampFloor(0, 40)), true);
});

test('clampFloor keeps the floor inside the stack', () => {
  assert.equal(clampFloor(99, 40), 40, 'cannot settle past the top');
  assert.equal(clampFloor(-5, 40), 0, 'cannot settle below the bottom');
  assert.equal(clampFloor(NaN, 40), 0);
});

test('trimming the oldest command shifts the floor down with it', () => {
  // At MAX_UNDO_STACK pushUndo() drops the bottom entry, so every depth above
  // it shifts by one. A floor that ignored this would start protecting the
  // wrong commands part-way through a long session.
  assert.equal(floorAfterTrim(40), 39);
  assert.equal(floorAfterTrim(1), 0);
  assert.equal(floorAfterTrim(0), 0, 'never goes negative');
  assert.equal(floorAfterTrim(undefined), 0);
});

test('a restored session clamps the floor to its empty stack', () => {
  // Regression. A reload restores annotations but NOT the command history, so
  // the stack comes back empty. Restoring the stored floor (say 40) leaves it
  // above the stack: the person then draws one mark, stack length is 1, and
  // undoableDepth(1, 40) is 0 — their own new work is silently un-undoable.
  //
  // Reproduced in a real browser before this clamp existed: after a refresh,
  // Ctrl-Z did nothing on a freshly drawn annotation.
  const restoredFloor = clampFloor(40, 0);
  assert.equal(restoredFloor, 0, 'the floor cannot exceed the stack it indexes');

  // The person draws one mark after the reload — it must be undoable.
  assert.equal(canUndoAt(1, restoredFloor), true);
  assert.equal(undoableDepth(1, restoredFloor), 1);
});

test('a trim keeps the same commands protected', () => {
  // 42 commands, floor at 40: the person owns the top 2.
  let stack = 42;
  let floor = 40;
  assert.equal(undoableDepth(stack, floor), 2);

  // Push one more past the cap: the oldest is dropped, so length is unchanged
  // and the floor shifts down. The person should still own exactly 3 now
  // (their original 2 plus the new one).
  stack = 42;
  floor = floorAfterTrim(floor);
  assert.equal(undoableDepth(stack, floor), 3);
});
