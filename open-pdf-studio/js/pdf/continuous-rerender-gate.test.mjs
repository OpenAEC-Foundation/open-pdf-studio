// Unit-tests voor de generatie-/schaalpoort van de doorlopende re-render.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRerenderGate } from './continuous-rerender-gate.js';

test('token blijft geldig zolang schaal en generatie gelijk blijven', () => {
  const gate = createRerenderGate();
  const t = gate.begin(1.5);
  assert.equal(gate.isCurrent(t, 1.5), true);
  assert.equal(gate.isCurrent(t, 1.5), true); // herhaald checken mag
});

test('schaalwijziging invalideert het token', () => {
  const gate = createRerenderGate();
  const t = gate.begin(1.5);
  assert.equal(gate.isCurrent(t, 1.75), false);
});

test('een nieuwe run invalideert het vorige token, ook bij gelijke schaal', () => {
  const gate = createRerenderGate();
  const t1 = gate.begin(2);
  const t2 = gate.begin(2);
  assert.equal(gate.isCurrent(t1, 2), false);
  assert.equal(gate.isCurrent(t2, 2), true);
});

test('overlappende runs: alleen het laatste token is geldig', () => {
  const gate = createRerenderGate();
  const tokens = [gate.begin(1), gate.begin(1.2), gate.begin(1.44)];
  assert.deepEqual(tokens.map((t) => gate.isCurrent(t, t.scale)), [false, false, true]);
});

test('gates staan los van elkaar', () => {
  const a = createRerenderGate();
  const b = createRerenderGate();
  const ta = a.begin(1);
  b.begin(9); // andere gate mag ta niet raken
  assert.equal(a.isCurrent(ta, 1), true);
});
