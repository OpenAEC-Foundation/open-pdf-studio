import assert from 'node:assert/strict';
import test from 'node:test';

import {
  opleggingTemplate, puntlastTemplate, qlastTemplate,
  beddingsverenTemplate, windverbandTemplate, scharnierVerbindingTemplate,
} from './constructie-symbolen.js';
import {
  bouwkraanTemplate, draaicirkelTemplate, parkeervakTemplate, bouwkeetTemplate,
} from './bouwplaats-symbolen.js';

const BBOX = { x: 10, y: 20, width: 200, height: 100 };
const ALLE = [
  opleggingTemplate, puntlastTemplate, qlastTemplate, beddingsverenTemplate,
  windverbandTemplate, scharnierVerbindingTemplate,
  bouwkraanTemplate, draaicirkelTemplate, parkeervakTemplate, bouwkeetTemplate,
];

function defaults(t) {
  const p = {};
  for (const par of t.params || []) p[par.key] = par.default;
  return p;
}

test('elke template rendert commando\'s binnen een redelijke bbox-marge', () => {
  for (const t of ALLE) {
    const cmds = t.render(defaults(t), BBOX);
    assert.ok(Array.isArray(cmds) && cmds.length > 0, `${t.id}: geen commando's`);
    for (const c of cmds) {
      assert.ok(typeof c.kind === 'string', `${t.id}: commando zonder kind`);
      const xs = [];
      const ys = [];
      if (c.kind === 'line') { xs.push(c.x1, c.x2); ys.push(c.y1, c.y2); }
      if (c.kind === 'circle') { xs.push(c.cx - c.r, c.cx + c.r); ys.push(c.cy - c.r, c.cy + c.r); }
      if (c.kind === 'text') { xs.push(c.x); ys.push(c.y); }
      if (Array.isArray(c.points)) for (const p of c.points) { xs.push(p.x); ys.push(p.y); }
      for (const v of [...xs, ...ys]) assert.ok(Number.isFinite(v), `${t.id}: niet-eindige coördinaat`);
      // Kleine marge voor arceringen/pijlpunten net buiten de bbox.
      for (const v of xs) assert.ok(v >= BBOX.x - 25 && v <= BBOX.x + BBOX.width + 25, `${t.id}: x=${v} ver buiten bbox`);
      for (const v of ys) assert.ok(v >= BBOX.y - 25 && v <= BBOX.y + BBOX.height + 25, `${t.id}: y=${v} ver buiten bbox`);
    }
  }
});

test('oplegging: drie typen geven verschillende geometrie', () => {
  const scharnier = JSON.stringify(opleggingTemplate.render({ type: 'scharnier' }, BBOX));
  const rol = JSON.stringify(opleggingTemplate.render({ type: 'rol' }, BBOX));
  const inklemming = JSON.stringify(opleggingTemplate.render({ type: 'inklemming' }, BBOX));
  assert.notEqual(scharnier, rol);
  assert.notEqual(scharnier, inklemming);
  assert.ok(rol.includes('"circle"'), 'rol-oplegging hoort rollen (cirkels) te hebben');
});

test('lasten tonen hun waarde in het label', () => {
  const f = puntlastTemplate.render({ kracht: 25 }, BBOX).find((c) => c.kind === 'text');
  assert.equal(f.text, 'F = 25 kN');
  const q = qlastTemplate.render({ q: 7.5 }, BBOX).find((c) => c.kind === 'text');
  assert.equal(q.text, 'q = 7.5 kN/m');
});

test('beddingsveren volgen het aantal-parameter', () => {
  const veren = (n) => beddingsverenTemplate.render({ aantal: n }, BBOX)
    .filter((c) => c.kind === 'polyline').length;
  assert.equal(veren(3), 3);
  assert.equal(veren(8), 8);
});

test('windverband: enkel laat één diagonaal weg', () => {
  const kruis = windverbandTemplate.render({ type: 'kruis' }, BBOX);
  const enkel = windverbandTemplate.render({ type: 'enkel' }, BBOX);
  assert.equal(kruis.length - enkel.length, 1);
});

test('werkelijke maat: kraan/draaicirkel = diameter, parkeervak/keet = b×l', () => {
  assert.deepEqual(bouwkraanTemplate.realSizeMm({ straal: 30 }), { width: 60000, height: 60000 });
  assert.deepEqual(draaicirkelTemplate.realSizeMm({ straal: 12.5 }), { width: 25000, height: 25000 });
  assert.deepEqual(parkeervakTemplate.realSizeMm({ breedte: 2500, lengte: 5000 }), { width: 2500, height: 5000 });
  assert.deepEqual(bouwkeetTemplate.realSizeMm({ breedte: 3000, lengte: 8000 }), { width: 8000, height: 3000 });
});

test('q-last werkelijke lengte volgt de lengte-parameter', () => {
  assert.equal(qlastTemplate.realSizeMm({ lengte: 4500 }).width, 4500);
});

test('snap-punten liggen binnen of op de bbox', () => {
  for (const t of ALLE) {
    if (!t.snapPoints) continue;
    for (const p of t.snapPoints(defaults(t), BBOX)) {
      assert.ok(p.x >= BBOX.x && p.x <= BBOX.x + BBOX.width, `${t.id}: snap-x buiten bbox`);
      assert.ok(p.y >= BBOX.y && p.y <= BBOX.y + BBOX.height, `${t.id}: snap-y buiten bbox`);
    }
  }
});
