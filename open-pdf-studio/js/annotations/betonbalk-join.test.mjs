import assert from 'node:assert/strict';
import test from 'node:test';

import { buildBetonbalk, findJoinTarget, CROSS_REIK_FACTOR } from './betonbalk.js';

const HW = 10; // halve balkbreedte in app-px

function balk(id, sx, sy, ex, ey) {
  return { type: 'betonbalk', id, page: 1, startX: sx, startY: sy, endX: ex, endY: ey };
}
function alsAnder(b, halfWidth = HW) {
  return [{ points: [{ x: b.startX, y: b.startY }, { x: b.endX, y: b.endY }], halfWidth }];
}
function geom(eigen, ander) {
  return buildBetonbalk(eigen, { halfWidth: HW, others: alsAnder(ander) });
}
const rond = (p) => ({ x: Math.round(p.x), y: Math.round(p.y) });
const laatste = (arr) => rond(arr[arr.length - 1]);

// De verwachte verstekhoek voor een haakse aansluiting van twee balken van
// gelijke breedte: binnenrand op 90, buitenrand op 110.
const VERSTEK_LINKS = { x: 90, y: 10 };
const VERSTEK_RECHTS = { x: 110, y: -10 };

test('hoek waarbij de punten exact aansluiten geeft verstek', () => {
  const g = geom(balk('a', 0, 0, 100, 0), balk('b', 100, 0, 100, 100));
  assert.equal(g.joinedEnd, true);
  assert.deepEqual(laatste(g.edges.left), VERSTEK_LINKS);
  assert.deepEqual(laatste(g.edges.right), VERSTEK_RECHTS);
  assert.equal(g.caps.length, 1, 'de eindkap hoort te vervallen bij een join');
});

test('hoek waarbij de balk voorbij het snijpunt doorsteekt wordt getrimd', () => {
  // Dit is het geval uit de praktijk: los getekende balken die elkaar bij de
  // hoek passeren. Zonder trim bleven beide randen doorlopen.
  const g = geom(balk('a', 0, 0, 130, 0), balk('b', 100, -40, 100, 100));
  assert.equal(g.joinedEnd, true);
  assert.deepEqual(laatste(g.edges.left), VERSTEK_LINKS);
  assert.deepEqual(laatste(g.edges.right), VERSTEK_RECHTS);
  assert.equal(g.caps.length, 1);
  // De teken-hartlijn stopt op het snijpunt, niet op het geklikte uiteinde.
  assert.deepEqual(rond(g.center[g.center.length - 1]), { x: 100, y: 0 });
});

test('hoek waarbij de balk te kort blijft wordt doorgetrokken', () => {
  const g = geom(balk('a', 0, 0, 80, 0), balk('b', 100, 0, 100, 100));
  assert.equal(g.joinedEnd, true);
  assert.deepEqual(laatste(g.edges.left), VERSTEK_LINKS);
  assert.deepEqual(laatste(g.edges.right), VERSTEK_RECHTS);
});

test('schuine kruisende hoek wordt eveneens getrimd', () => {
  const g = geom(balk('a', 0, 0, 130, 0), balk('b', 100, -30, 180, 80));
  assert.equal(g.joinedEnd, true);
  assert.equal(g.caps.length, 1);
  // Bij een schuine hoek ligt het verstekpunt verder naar buiten, maar de
  // hartlijn eindigt exact op het snijpunt van de twee hartlijnen.
  assert.deepEqual(rond(g.center[g.center.length - 1]), { x: 122, y: 0 });
});

test('een echte kruising midden op een balk wordt NIET afgekapt', () => {
  // Veiligheidsgrens: bij het snijpunt ligt geen uiteinde van de doelbalk,
  // dus dit is een bewuste kruising en geen hoek.
  const g = geom(balk('a', 0, 0, 130, 0), balk('b', 100, -200, 100, 200));
  assert.equal(g.joinedEnd, false);
  assert.equal(g.caps.length, 2, 'beide eindkappen blijven staan');
  assert.deepEqual(laatste(g.edges.left), { x: 130, y: 10 });
});

test('buiten de reikwijdte blijft de hoek onaangeroerd', () => {
  const ver = CROSS_REIK_FACTOR * HW + 30;
  const g = geom(balk('a', 0, 0, 100 + ver, 0), balk('b', 100, -40, 100, 100));
  assert.equal(g.joinedEnd, false, 'ver voorbij het snijpunt is geen hoek meer');
});

test('findJoinTarget kiest een exacte hoek boven een kruising', () => {
  const doel = alsAnder(balk('b', 100, 0, 100, 100));
  const t = findJoinTarget({ x: 100, y: 0 }, HW, doel, { x: 0, y: 0 });
  assert.equal(t.kind, 'corner');
});

test('findJoinTarget zonder eigen richting valt terug op het oude gedrag', () => {
  // ownFar ontbreekt → geen kruis-detectie (achterwaarts compatibel).
  const doel = alsAnder(balk('b', 100, -40, 100, 100));
  const t = findJoinTarget({ x: 130, y: 0 }, HW, doel);
  assert.ok(!t || t.kind !== 'cross');
});
