import assert from 'node:assert/strict';
import test from 'node:test';

import { computeUndoLastPoint } from './filled-area-undo.js';

test('undo removes only the last point of the current contour', () => {
  const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
  const result = computeUndoLastPoint(points);
  assert.equal(result.changed, true);
  assert.deepEqual(result.points, [{ x: 0, y: 0 }, { x: 10, y: 0 }]);
});

test('undoing does not reach into a separately-tracked contour (caller passes only the active one)', () => {
  // computeUndoLastPoint only ever sees the array it's handed — a completed
  // hole or the outer contour, tracked separately by the caller in
  // state.filledAreaHoles / state.filledAreaOuterPoints, is never passed in
  // while a different contour (e.g. a new hole) is being drawn.
  const activeHolePoints = [{ x: 1, y: 1 }, { x: 2, y: 2 }];
  const completedOuter = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }];
  const result = computeUndoLastPoint(activeHolePoints);
  assert.deepEqual(result.points, [{ x: 1, y: 1 }]);
  assert.deepEqual(completedOuter, [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }]);
});

test('undo on an empty contour is a no-op', () => {
  const result = computeUndoLastPoint([]);
  assert.equal(result.changed, false);
  assert.deepEqual(result.points, []);
});

test('undo on a null/undefined contour is a no-op', () => {
  const result = computeUndoLastPoint(null);
  assert.equal(result.changed, false);
  assert.deepEqual(result.points, []);
});

test('reArmTypeLength is true only when the resulting contour is empty', () => {
  const oneLeft = computeUndoLastPoint([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
  assert.equal(oneLeft.reArmTypeLength, false);

  const noneLeft = computeUndoLastPoint([{ x: 0, y: 0 }]);
  assert.equal(noneLeft.reArmTypeLength, true);
});
