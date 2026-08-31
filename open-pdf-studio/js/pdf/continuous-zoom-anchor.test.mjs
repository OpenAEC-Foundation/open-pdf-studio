// Unit-tests voor de pure zoom-ankerberekening van de doorlopende weergave.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchorScrollCorrection, pickAnchorPageIndex } from './continuous-zoom-anchor.js';

// Hulp: pas de correctie toe en geef de nieuwe schermpositie van het
// content-punt dat vóór de zoom onder het anker lag. Na `scroll += d`
// verschuift alle content -d, dus het punt hoort weer exact op het anker.
function screenAfter(anchor, before, after) {
  const { dx, dy } = anchorScrollCorrection(anchor, before, after);
  const fx = (anchor.x - before.left) / before.width;
  const fy = (anchor.y - before.top) / before.height;
  return {
    x: (after.left - dx) + fx * after.width,
    y: (after.top - dy) + fy * after.height,
  };
}

test('anker binnen de pagina blijft exact onder de cursor (inzoomen)', () => {
  const anchor = { x: 500, y: 419 };
  const before = { left: 284, top: 160, width: 892, height: 1263 };
  // ×1.155, linker-verankerde groei zoals width:max-content na #336
  const after = { left: 284, top: 160, width: 1030, height: 1459 };
  const p = screenAfter(anchor, before, after);
  assert.ok(Math.abs(p.x - anchor.x) < 1e-9);
  assert.ok(Math.abs(p.y - anchor.y) < 1e-9);
});

test('anker blijft staan bij uitzoomen met horizontale scroll', () => {
  const anchor = { x: 652, y: 507 };
  const before = { left: -202, top: 1487, width: 1786, height: 1263 };
  const after = { left: -150, top: 1300, width: 1546, height: 1093 };
  const p = screenAfter(anchor, before, after);
  assert.ok(Math.abs(p.x - anchor.x) < 1e-9);
  assert.ok(Math.abs(p.y - anchor.y) < 1e-9);
});

test('anker in de gap (fractie buiten [0,1]) extrapoleert continu', () => {
  const anchor = { x: 300, y: 2000 }; // onder de pagina-onderrand
  const before = { left: 250, top: 160, width: 800, height: 1000 };
  const after = { left: 250, top: 160, width: 1000, height: 1250 };
  const p = screenAfter(anchor, before, after);
  assert.ok(Math.abs(p.x - anchor.x) < 1e-9);
  assert.ok(Math.abs(p.y - anchor.y) < 1e-9);
});

test('degenerate rect geeft nulcorrectie', () => {
  assert.deepEqual(
    anchorScrollCorrection({ x: 1, y: 2 }, { left: 0, top: 0, width: 0, height: 0 },
      { left: 0, top: 0, width: 10, height: 10 }),
    { dx: 0, dy: 0 });
  assert.deepEqual(anchorScrollCorrection(null, {}, {}), { dx: 0, dy: 0 });
});

test('geen verschil in rects → geen correctie', () => {
  const r = { left: 10, top: 20, width: 100, height: 200 };
  assert.deepEqual(anchorScrollCorrection({ x: 50, y: 90 }, r, { ...r }), { dx: 0, dy: 0 });
});

test('pickAnchorPageIndex: anker binnen een pagina wint', () => {
  const rects = [
    { top: 0, bottom: 100 },
    { top: 120, bottom: 220 },
    { top: 240, bottom: 340 },
  ];
  assert.equal(pickAnchorPageIndex(rects, 150), 1);
  assert.equal(pickAnchorPageIndex(rects, 50), 0);
  assert.equal(pickAnchorPageIndex(rects, 340), 2);
});

test('pickAnchorPageIndex: anker in de gap kiest de dichtstbijzijnde', () => {
  const rects = [
    { top: 0, bottom: 100 },
    { top: 120, bottom: 220 },
  ];
  assert.equal(pickAnchorPageIndex(rects, 105), 0);  // 5px onder p1, 15px boven p2
  assert.equal(pickAnchorPageIndex(rects, 115), 1);
  assert.equal(pickAnchorPageIndex(rects, -50), 0);  // boven alles
  assert.equal(pickAnchorPageIndex(rects, 9999), 1); // onder alles
});

test('pickAnchorPageIndex: lege lijst geeft -1', () => {
  assert.equal(pickAnchorPageIndex([], 100), -1);
});
