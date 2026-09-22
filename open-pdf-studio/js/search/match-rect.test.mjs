import test from 'node:test';
import assert from 'node:assert/strict';
import { matchFractions, matchBoxInPageFrame, boxToLayerPercent } from './match-rect.js';
import { getPageRotationMatrix } from '../text/text-edit-appearance.js';

const bijna = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
const LIGGEND = [0, 0, 841.89, 595.28];
const STAAND = [0, 0, 595.28, 841.89];

test('fracties: zonder meter het aandeel tekens', () => {
  assert.deepEqual(matchFractions('abcd', 1, 3), [0.25, 0.75]);
});

test('fracties: met meter de echte tekenbreedtes', () => {
  const breed = { W: 3, i: 1 };
  const meet = (s) => [...s].reduce((som, ch) => som + (breed[ch] || 2), 0);
  // 'Wii': W=3, i=1, i=1 → treffer 'ii' loopt van 3/5 tot 5/5
  assert.deepEqual(matchFractions('Wii', 1, 3, meet), [3 / 5, 1]);
});

test('liggende pagina, kleine tabelregel: markering op basislijn − ascent', () => {
  const box = matchBoxInPageFrame([6, 0, 0, 6, 64.5, 385.86], 89, 6, 0, 1, LIGGEND);
  bijna(box.x, 64.5);
  bijna(box.y, 595.28 - 385.86 - 0.8 * 6);
  bijna(box.w, 89);
  bijna(box.h, 6);
  assert.equal(box.angle, 0);
});

test('deel van een item: breedte volgt de fracties', () => {
  const box = matchBoxInPageFrame([6, 0, 0, 6, 64.5, 385.86], 90, 6, 0.1, 0.3, LIGGEND);
  bijna(box.x, 64.5 + 9);
  bijna(box.w, 18);
});

test('MediaBox met oorsprong ≠ 0: positie relatief aan de paginabox', () => {
  const view = [200, 100, 200 + 595.28, 100 + 841.89];
  const box = matchBoxInPageFrame([12, 0, 0, 12, 272, 800], 100, 12, 0, 1, view);
  bijna(box.x, 72);
  bijna(box.y, 941.89 - 800 - 9.6);
});

test('procenten: onafhankelijk van de laagschaal (50/100/175 %)', () => {
  const box = matchBoxInPageFrame([6, 0, 0, 6, 64.5, 385.86], 89, 6, 0, 1, LIGGEND);
  const pct = boxToLayerPercent(box, LIGGEND);
  for (const schaal of [0.5, 1, 1.75]) {
    const laagB = 841.89 * schaal;
    const laagH = 595.28 * schaal;
    bijna((pct.left / 100) * laagB, 64.5 * schaal);
    bijna((pct.top / 100) * laagH, (595.28 - 385.86 - 4.8) * schaal);
    bijna((pct.width / 100) * laagB, 89 * schaal);
    bijna((pct.height / 100) * laagH, 6 * schaal);
  }
});

test('gedraaide tekst (90° tegen de klok in): hoek en linkerbovenhoek', () => {
  const box = matchBoxInPageFrame([0, 12, -12, 0, 300, 400], 50, 12, 0, 1, STAAND);
  bijna(box.angle, -Math.PI / 2);
  bijna(box.x, 300 - 9.6);
  bijna(box.y, 841.89 - 400);
  bijna(box.w, 50);
  bijna(box.h, 12);
});

// Hoeken van een CSS-box (linksboven x,y, breedte w langs de tekst, hoogte h,
// draaiing angle om de linkerbovenhoek) in het laagkader.
function hoekpunten(box) {
  const c = Math.cos(box.angle);
  const s = Math.sin(box.angle);
  const p = (u, v) => [box.x + u * c - v * s, box.y + u * s + v * c];
  return [p(0, 0), p(box.w, 0), p(0, box.h), p(box.w, box.h)];
}
const aabb = (pts) => {
  const xs = pts.map((q) => q[0]);
  const ys = pts.map((q) => q[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};

// Weergave volgens pdf.js (PageViewport, schaal 1) voor een user-space punt.
function pdfjsWeergave(x, y, [x0, y0, x1, y1], rot) {
  switch (rot) {
    case 90: return [y - y0, x - x0];
    case 180: return [x1 - x, y - y0];
    case 270: return [y1 - y, x1 - x];
    default: return [x - x0, y1 - y];
  }
}

for (const rot of [0, 90, 180, 270]) {
  test(`gedraaide pagina ${rot}° (+ verschoven MediaBox): laagdraaiing geeft de pdf.js-weergave`, () => {
    const view = [50, -30, 50 + 595.28, -30 + 841.89];
    const W = view[2] - view[0];
    const H = view[3] - view[1];
    const [bx, by, s, breedte] = [122, 670, 14, 80];
    const box = matchBoxInPageFrame([s, 0, 0, s, bx, by], breedte, s, 0, 1, view);
    // De tekstlaag draait zichzelf met deze matrix (vectormodus en de
    // data-main-rotation-CSS van de PDF.js-laag doen hetzelfde).
    const [a, b, c, d, e, f] = getPageRotationMatrix(W, H, rot);
    const gemeten = aabb(hoekpunten(box).map(([u, v]) => [a * u + c * v + e, b * u + d * v + f]));
    const verwacht = aabb([[bx, by - 0.2 * s], [bx + breedte, by - 0.2 * s], [bx, by + 0.8 * s], [bx + breedte, by + 0.8 * s]]
      .map(([x, y]) => pdfjsWeergave(x, y, view, rot)));
    gemeten.forEach((v, i) => bijna(v, verwacht[i], 1e-6));
  });
}

test('geen geometrie: null in plaats van een markering op 0,0', () => {
  assert.equal(matchBoxInPageFrame(null, 10, 10, 0, 1, LIGGEND), null);
  assert.equal(matchBoxInPageFrame([1, 0, 0, 1, 0, 0], 10, 10, 0, 1, null), null);
  assert.equal(matchBoxInPageFrame([1, 0, 0, 1, 0, 0], 10, 10, 0, 1, [0, 0, 0, 0]), null);
});
