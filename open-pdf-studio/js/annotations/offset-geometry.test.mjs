import assert from 'node:assert/strict';
import test from 'node:test';

import { offsetProps, canOffset } from './offset-geometry.js';

const dichtbij = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const punt = (p, x, y) => dichtbij(p.x, x) && dichtbij(p.y, y);
const lijnPunt = (l, welk, x, y) => dichtbij(l[welk === 'start' ? 'startX' : 'endX'], x)
  && dichtbij(l[welk === 'start' ? 'startY' : 'endY'], y);

test('offset: rechthoek groeit naar buiten', () => {
  const box = { type: 'box', x: 10, y: 20, width: 100, height: 50 };
  const r = offsetProps(box, 10, { x: 500, y: 500 });
  assert.deepEqual(r, { x: 0, y: 10, width: 120, height: 70 });
});

test('offset: rechthoek krimpt als het klikpunt binnen valt', () => {
  const box = { type: 'box', x: 10, y: 20, width: 100, height: 50 };
  const r = offsetProps(box, 10, { x: 50, y: 40 });
  assert.deepEqual(r, { x: 20, y: 30, width: 80, height: 30 });
});

test('offset: krimpen voorbij nul levert null (afstand te groot)', () => {
  const box = { type: 'box', x: 0, y: 0, width: 50, height: 50 };
  assert.equal(offsetProps(box, 40, { x: 10, y: 10 }), null);
  // Nog net te klein → ook null (onder de minimale maat)
  assert.equal(offsetProps({ type: 'box', x: 0, y: 0, width: 2, height: 2 }, 0.8, { x: 1, y: 1 }), null);
});

test('offset: cirkel concentrisch groter (zelfde middelpunt)', () => {
  const c = { type: 'circle', x: 100, y: 100, width: 40, height: 40 };
  const r = offsetProps(c, 5, { x: 400, y: 400 });
  assert.equal(r.x, 95);
  assert.equal(r.width, 50);
  assert.equal(r.height, 50);
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  assert.ok(dichtbij(cx, 120) && dichtbij(cy, 120));
});

test('offset: lijn loodrecht naar de kant van het klikpunt', () => {
  const lijn = { type: 'line', startX: 0, startY: 0, endX: 100, endY: 0 };
  const boven = offsetProps(lijn, 10, { x: 50, y: -5 });
  assert.ok(lijnPunt(boven, 'start', 0, -10));
  assert.ok(lijnPunt(boven, 'end', 100, -10));
  const onder = offsetProps(lijn, 10, { x: 50, y: 5 });
  assert.ok(lijnPunt(onder, 'start', 0, 10));
  assert.ok(lijnPunt(onder, 'end', 100, 10));
});

test('offset: schuine lijn blijft even lang en evenwijdig', () => {
  const lijn = { type: 'line', startX: 0, startY: 0, endX: 30, endY: 40 };
  const r = offsetProps(lijn, 5, { x: -20, y: 20 });
  assert.ok(r);
  const origLen = 50;
  const nuLen = Math.hypot(r.endX - r.startX, r.endY - r.startY);
  assert.ok(dichtbij(origLen, nuLen));
  // Evenwijdig: zelfde richtingsvector
  assert.ok(dichtbij(r.endX - r.startX, 30) && dichtbij(r.endY - r.startY, 40));
});

test('offset: gesloten polyhoek (vierkant) gaat naar buiten', () => {
  const poly = {
    type: 'polyline',
    points: [
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 0, y: 0 },
    ],
    x: 0, y: 0, width: 100, height: 100,
  };
  const r = offsetProps(poly, 10, { x: 400, y: 50 });
  assert.ok(r);
  assert.ok(punt(r.points[0], -10, -10), `punt0 = ${JSON.stringify(r.points[0])}`);
  assert.ok(punt(r.points[1], 110, -10));
  assert.ok(punt(r.points[2], 110, 110));
  assert.ok(punt(r.points[3], -10, 110));
  // Gesloten ring blijft gesloten (herhaald eerste punt)
  assert.equal(r.points.length, 5);
  assert.ok(punt(r.points[4], -10, -10));
  // bbox meetelt voor selectie/hit-testing
  assert.equal(r.x, -10);
  assert.equal(r.width, 120);
});

test('offset: gesloten polyhoek met klikpunt binnenin krimpt', () => {
  const poly = {
    type: 'polyline',
    points: [
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 0, y: 0 },
    ],
    x: 0, y: 0, width: 100, height: 100,
  };
  const r = offsetProps(poly, 10, { x: 50, y: 50 });
  assert.ok(punt(r.points[0], 10, 10));
  assert.ok(punt(r.points[2], 90, 90));
});

test('offset: open polylijn schuift loodrecht mee (hoek blijft haaks)', () => {
  const poly = { type: 'polyline', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] };
  const r = offsetProps(poly, 10, { x: 50, y: -10 });
  assert.ok(r);
  assert.ok(punt(r.points[0], 0, -10));
  assert.ok(punt(r.points[1], 110, -10));
  assert.ok(punt(r.points[2], 110, 100));
  assert.equal(r.points.length, 3);
});

test('offset: onondersteunde types leveren null, maar melden het wel', () => {
  const maat = { type: 'measureArea', x: 0, y: 0, width: 10, height: 10, points: [] };
  assert.equal(offsetProps(maat, 5, { x: 100, y: 100 }), null);
  assert.equal(canOffset(maat), false);

  const box = { type: 'box', x: 0, y: 0, width: 10, height: 10 };
  assert.equal(canOffset(box), true);
  assert.equal(offsetProps(box, -5, { x: 100, y: 100 }), null, 'negatieve afstand');
  assert.equal(offsetProps(box, NaN, { x: 100, y: 100 }), null, 'NaN afstand');
});
