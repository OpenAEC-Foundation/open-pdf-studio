// App redaction marks → areas in PDF space (#762).
import test from 'node:test';
import assert from 'node:assert/strict';
import { marksFromAnnotations, markCorners, fillOf, boundsTouchMarks, ocrWordTouches, isValidMark } from './marks.js';

const crop = { x: 0, y: 0, width: 600, height: 800 };

test('a mark becomes the quadrilateral the user sees (unrotated page)', () => {
  const { marks, invalid } = marksFromAnnotations([{ id: 'a', type: 'redaction', page: 1, x: 100, y: 50, width: 40, height: 20, overlayColor: '#ff0000' }], () => ({ rotation: 0, cropBox: crop }));
  assert.equal(invalid.length, 0);
  assert.equal(marks[0].pageIndex, 0);
  assert.deepEqual(marks[0].fill, [1, 0, 0]);
  const xs = marks[0].quad.map((p) => p[0]).sort((a, b) => a - b), ys = marks[0].quad.map((p) => p[1]).sort((a, b) => a - b);
  assert.deepEqual([xs[0], xs[3], ys[0], ys[3]], [100, 140, 730, 750]);
});

test('page rotation and the mark\'s own rotation are applied per corner', () => {
  // On a page shown rotated by 90°, the displayed page is 800 wide and 600 high.
  const ann = { type: 'redaction', page: 1, x: 0, y: 0, width: 10, height: 20 };
  const { marks } = marksFromAnnotations([ann], () => ({ rotation: 90, cropBox: crop }));
  const q = marks[0].quad;
  // All corners lie inside the page and the area is 10 × 20.
  for (const [x, y] of q) assert.ok(x >= 0 && x <= 600 && y >= 0 && y <= 800);
  const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
  assert.equal(Math.round((Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))), 200);
  const rot = markCorners({ x: 0, y: 0, width: 10, height: 10, rotation: 45 });
  assert.ok(Math.abs(Math.hypot(rot[0][0] - rot[2][0], rot[0][1] - rot[2][1]) - Math.hypot(10, 10)) < 1e-9);
  assert.ok(Math.abs(rot[0][1] - 5 + Math.SQRT2 * 5) < 1e-9, 'rotated about the centre');
});

test('invalid marks are reported, not skipped', () => {
  const pageInfo = (n) => (n === 1 ? { rotation: 0, cropBox: crop } : null);
  const bad = [
    { type: 'redaction', page: 1, x: 0, y: 0, width: 0, height: 10 },
    { type: 'redaction', page: 1, x: NaN, y: 0, width: 5, height: 10 },
    { type: 'redaction', page: 7, x: 0, y: 0, width: 5, height: 10 },
  ];
  const { marks, invalid } = marksFromAnnotations(bad, pageInfo);
  assert.equal(marks.length, 0);
  assert.equal(invalid.length, 3);
  assert.equal(isValidMark({ x: 1, y: 1, width: 1, height: 1 }), true);
});

test('annotation bounds and OCR words under a mark are found', () => {
  const m = [{ x: 100, y: 100, width: 50, height: 50 }];
  assert.equal(boundsTouchMarks({ x: 140, y: 140, width: 30, height: 30 }, m), true);
  assert.equal(boundsTouchMarks({ x: 160, y: 160, width: 30, height: 30 }, m), false);
  const quad = [[100, 650], [150, 650], [150, 700], [100, 700]];
  assert.equal(ocrWordTouches({ left: 120, top: 110, width: 20, height: 10 }, crop, [quad]), true);
  assert.equal(ocrWordTouches({ left: 300, top: 110, width: 20, height: 10 }, crop, [quad]), false);
  assert.deepEqual(fillOf('nonsense'), [0, 0, 0]);
});
