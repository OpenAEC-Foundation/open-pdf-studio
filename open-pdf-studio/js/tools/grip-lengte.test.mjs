import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCoordBuffer, beperkEindpunt } from './coord-invoer.js';
import {
  gripLengteEindpunten,
  pixelsPerEenheidVoor,
  nieuwEindpuntVoorInvoer,
  isGripLengteStartToets,
} from './grip-lengte.js';

const dichtbij = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// 1:100 in mm: 1 pt papier = 25.4/72 mm papier = 100 × dat in werkelijkheid.
const PX_PER_MM_1_100 = 72 / 25.4 / 100;

test('parse: lengte, relatief, polair, absoluut, ongeldig', () => {
  assert.deepEqual(parseCoordBuffer('2500'), { kind: 'length', a: 2500, b: null });
  assert.deepEqual(parseCoordBuffer('12.5'), { kind: 'length', a: 12.5, b: null });
  assert.deepEqual(parseCoordBuffer('100,50'), { kind: 'cartesian', a: 100, b: 50 });
  assert.deepEqual(parseCoordBuffer('100<90'), { kind: 'polar', a: 100, b: 90 });
  assert.deepEqual(parseCoordBuffer('=10,20'), { kind: 'absolute', a: 10, b: 20 });
  assert.equal(parseCoordBuffer('1.2.3').kind, 'invalid');
  assert.equal(parseCoordBuffer('').kind, 'empty');
});

test('beperkEindpunt: lengte langs de richting vast punt → cursor', () => {
  const p = beperkEindpunt(parseCoordBuffer('10'), 0, 0, 3, 4, 2);
  assert.ok(dichtbij(p.x, 12) && dichtbij(p.y, 16));
  assert.equal(p.constrained, true);
});

test('beperkEindpunt: zonder invoer blijft de cursor', () => {
  const p = beperkEindpunt(parseCoordBuffer(''), 0, 0, 3, 4, 2);
  assert.deepEqual(p, { x: 3, y: 4, constrained: false });
});

test('beperkEindpunt: relatief en polair in eenheden', () => {
  const r = beperkEindpunt(parseCoordBuffer('10,-5'), 1, 1, 0, 0, 2);
  assert.ok(dichtbij(r.x, 21) && dichtbij(r.y, -9));
  const p = beperkEindpunt(parseCoordBuffer('10<90'), 0, 0, 5, 5, 1);
  assert.ok(dichtbij(p.x, 0) && dichtbij(p.y, -10));
});

test('gripLengteEindpunten: maatlijn met hulplijnen sleept de hulplijn-tip', () => {
  const ann = {
    type: 'measureDistance', startX: 0, startY: -18, endX: 100, endY: -18,
    leaderStartX: 0, leaderStartY: 0, leaderEndX: 100, leaderEndY: 0,
  };
  assert.deepEqual(gripLengteEindpunten(ann, 'leader_end'), { vast: { x: 0, y: 0 }, beweeg: { x: 100, y: 0 } });
  assert.deepEqual(gripLengteEindpunten(ann, 'leader_start'), { vast: { x: 100, y: 0 }, beweeg: { x: 0, y: 0 } });
  // De binnenste handvatten verschuiven alleen de maatlijn-offset: geen lengte.
  assert.equal(gripLengteEindpunten(ann, 'line_end'), null);
  assert.equal(gripLengteEindpunten(ann, 'label_move'), null);
});

test('gripLengteEindpunten: maatlijn zonder hulplijnen, lijn en pijl', () => {
  const zonder = { type: 'measureDistance', startX: 1, startY: 2, endX: 3, endY: 4 };
  assert.deepEqual(gripLengteEindpunten(zonder, 'line_end'), { vast: { x: 1, y: 2 }, beweeg: { x: 3, y: 4 } });
  const lijn = { type: 'line', startX: 1, startY: 2, endX: 3, endY: 4 };
  assert.deepEqual(gripLengteEindpunten(lijn, 'line_start'), { vast: { x: 3, y: 4 }, beweeg: { x: 1, y: 2 } });
  assert.ok(gripLengteEindpunten({ ...lijn, type: 'arrow' }, 'line_end'));
  assert.equal(gripLengteEindpunten({ ...lijn, type: 'line' }, 'line_mid'), null);
  assert.equal(gripLengteEindpunten({ type: 'polyline', points: [] }, 'polyline_node_1'), null);
  assert.equal(gripLengteEindpunten(null, 'line_end'), null);
});

test('pixelsPerEenheidVoor: eigen schaal van de maatlijn gaat voor', () => {
  assert.equal(pixelsPerEenheidVoor({ type: 'measureDistance', measureScale: 0.5 }, 7), 2);
  assert.equal(pixelsPerEenheidVoor({}, 7), 7);
  assert.equal(pixelsPerEenheidVoor({ type: 'line', measureScale: 0.5 }, 7), 7);
  assert.equal(pixelsPerEenheidVoor({}, 0), 1);
});

test('nieuwEindpuntVoorInvoer: 2500 mm bij 1:100 langs de huidige richting', () => {
  const vast = { x: 100, y: 200 };
  const p = nieuwEindpuntVoorInvoer('2500', vast, { x: 100 + 30, y: 200 + 40 }, PX_PER_MM_1_100);
  const lengtePx = Math.hypot(p.x - vast.x, p.y - vast.y);
  assert.ok(dichtbij(lengtePx / PX_PER_MM_1_100, 2500, 1e-6));
  // Richting behouden (3:4).
  assert.ok(dichtbij((p.x - vast.x) * 4, (p.y - vast.y) * 3, 1e-6));
});

test('nieuwEindpuntVoorInvoer: richting valt samen met vast punt → terugvalrichting', () => {
  const p = nieuwEindpuntVoorInvoer('10', { x: 0, y: 0 }, { x: 0, y: 0 }, 1, { x: 0, y: -5 });
  assert.ok(dichtbij(p.x, 0) && dichtbij(p.y, -10));
});

test('nieuwEindpuntVoorInvoer: ongeldige of lege invoer geeft null', () => {
  assert.equal(nieuwEindpuntVoorInvoer('', { x: 0, y: 0 }, { x: 1, y: 0 }, 1), null);
  assert.equal(nieuwEindpuntVoorInvoer('1.2.3', { x: 0, y: 0 }, { x: 1, y: 0 }, 1), null);
  assert.equal(nieuwEindpuntVoorInvoer('0', { x: 0, y: 0 }, { x: 1, y: 0 }, 1), null);
});

test('isGripLengteStartToets: cijfers en invoertekens starten, letters niet', () => {
  for (const k of ['0', '5', '9', '.', '-', '=']) assert.equal(isGripLengteStartToets(k), true, k);
  for (const k of ['a', 'Enter', 'Escape', ',', '<', 'Shift']) assert.equal(isGripLengteStartToets(k), false, k);
});
