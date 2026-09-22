// Unit-test voor de maatgelijk-kernlogica van de Schikken-groep "Grootte"
// (arr-same-size / arr-same-width / arr-same-height, issue #313).
//
// Test de pure geometrie in js/annotations/size-matching.js rechtstreeks in
// Node — de UI-klik zelf wordt door de Fase-A-rooktest gedekt.
//
// Gebruik:  node scripts/test-arrange-same-size.mjs

import assert from 'node:assert/strict';
import { resizeAnnotationToBounds, matchAnnotationSizes } from '../js/annotations/size-matching.js';

let passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  console.log(`  PASS  ${name}`);
}

function rect(id, x, y, w, h, extra = {}) {
  return { id, type: 'rect', x, y, width: w, height: h, ...extra };
}
function boundsOf(a) {
  return { x: a.x, y: a.y, width: a.width, height: a.height };
}
function entriesOf(anns, boundsFn = boundsOf) {
  return anns.map(a => ({ ann: a, b: boundsFn(a) }));
}

console.log('test-arrange-same-size');

// ── sameSize: rechthoek-model ──────────────────────────────────────────────

ok('sameSize maakt rechthoeken even groot als de referentie (laatst geselecteerde)', () => {
  const a = rect('a', 10, 10, 50, 20);
  const b = rect('b', 100, 40, 80, 60);
  const ref = rect('ref', 200, 200, 120, 90);
  const changed = matchAnnotationSizes(entriesOf([a, b, ref]), ref, { width: true, height: true });
  assert.deepEqual(changed.map(c => c.id), ['a', 'b']);
  assert.equal(a.width, 120); assert.equal(a.height, 90);
  assert.equal(b.width, 120); assert.equal(b.height, 90);
  // Posities (linksboven-anker) blijven staan
  assert.equal(a.x, 10); assert.equal(a.y, 10);
  assert.equal(b.x, 100); assert.equal(b.y, 40);
  // Referentie zelf ongewijzigd
  assert.equal(ref.width, 120); assert.equal(ref.height, 90);
  assert.equal(ref.x, 200); assert.equal(ref.y, 200);
});

ok('sameWidth wijzigt alleen de breedte', () => {
  const a = rect('a', 10, 10, 50, 20);
  const ref = rect('ref', 0, 0, 120, 90);
  matchAnnotationSizes(entriesOf([a, ref]), ref, { width: true });
  assert.equal(a.width, 120);
  assert.equal(a.height, 20);
});

ok('sameHeight wijzigt alleen de hoogte', () => {
  const a = rect('a', 10, 10, 50, 20);
  const ref = rect('ref', 0, 0, 120, 90);
  matchAnnotationSizes(entriesOf([a, ref]), ref, { height: true });
  assert.equal(a.width, 50);
  assert.equal(a.height, 90);
});

// ── Vergrendelde en referentie-annotaties ──────────────────────────────────

ok('vergrendelde annotaties worden overgeslagen', () => {
  const a = rect('a', 10, 10, 50, 20, { locked: true });
  const b = rect('b', 60, 10, 30, 30);
  const ref = rect('ref', 0, 0, 100, 100);
  const changed = matchAnnotationSizes(entriesOf([a, b, ref]), ref, { width: true, height: true });
  assert.deepEqual(changed.map(c => c.id), ['b']);
  assert.equal(a.width, 50); assert.equal(a.height, 20);
});

ok('geen wijziging wanneer de referentie niet in de selectie zit', () => {
  const a = rect('a', 10, 10, 50, 20);
  const b = rect('b', 60, 10, 30, 30);
  const missing = rect('x', 0, 0, 9, 9);
  const changed = matchAnnotationSizes(entriesOf([a, b]), missing, { width: true, height: true });
  assert.deepEqual(changed, []);
  assert.equal(a.width, 50); assert.equal(b.width, 30);
});

// ── Lijn-model: eindpunten schalen vanaf linksboven-anker ──────────────────

ok('lijn wordt geschaald zodat de bounding-boxbreedte klopt', () => {
  const line = { id: 'l', type: 'line', startX: 100, startY: 50, endX: 200, endY: 150 };
  const b = { x: 100, y: 50, width: 100, height: 100 };
  const didChange = resizeAnnotationToBounds(line, b, 50, null);
  assert.equal(didChange, true);
  assert.equal(line.startX, 100);
  assert.equal(line.endX, 150);   // 100 + (200-100) * 0.5
  assert.equal(line.startY, 50);  // hoogte onaangetast
  assert.equal(line.endY, 150);
});

ok('horizontale lijn (hoogte 0): hoogte-doel wordt genegeerd, geen wijziging', () => {
  const line = { id: 'l', type: 'line', startX: 0, startY: 10, endX: 100, endY: 10 };
  const b = { x: 0, y: 10, width: 100, height: 0 };
  const didChange = resizeAnnotationToBounds(line, b, null, 40);
  assert.equal(didChange, false);
  assert.equal(line.startY, 10); assert.equal(line.endY, 10);
});

// ── Polylijn: punten schalen én opgeslagen bounds bijwerken ────────────────

ok('polylijn-punten schalen mee en bounds worden herberekend', () => {
  const poly = {
    id: 'p', type: 'polyline',
    points: [{ x: 0, y: 0 }, { x: 100, y: 50 }, { x: 40, y: 80 }],
    x: 0, y: 0, width: 100, height: 80,
  };
  const b = { x: 0, y: 0, width: 100, height: 80 };
  resizeAnnotationToBounds(poly, b, 200, 40);
  assert.deepEqual(poly.points, [{ x: 0, y: 0 }, { x: 200, y: 25 }, { x: 80, y: 40 }]);
  assert.equal(poly.width, 200);
  assert.equal(poly.height, 40);
});

// ── Vrije-hand pad ─────────────────────────────────────────────────────────

ok('draw-pad schaalt vanaf het bounds-anker', () => {
  const draw = { id: 'd', type: 'draw', path: [{ x: 10, y: 10 }, { x: 30, y: 50 }] };
  const b = { x: 10, y: 10, width: 20, height: 40 };
  resizeAnnotationToBounds(draw, b, 40, 20);
  assert.deepEqual(draw.path, [{ x: 10, y: 10 }, { x: 50, y: 30 }]);
});

// ── Typen zonder zinnige resize ────────────────────────────────────────────

ok('arc en measureAngle blijven ongewijzigd', () => {
  const arc = { id: 'a', type: 'arc', centerX: 50, centerY: 50, radius: 20 };
  const didChange = resizeAnnotationToBounds(arc, { x: 30, y: 30, width: 40, height: 40 }, 80, 80);
  assert.equal(didChange, false);
  assert.equal(arc.radius, 20);
});

ok('gelijke doelmaat = geen wijziging gemeld', () => {
  const a = rect('a', 10, 10, 120, 90);
  const ref = rect('ref', 0, 0, 120, 90);
  const changed = matchAnnotationSizes(entriesOf([a, ref]), ref, { width: true, height: true });
  assert.deepEqual(changed, []);
});

ok('een lijn als referentie (hoogte 0) geeft een rechthoek nooit hoogte 0', () => {
  const a = rect('a', 10, 10, 120, 90);
  const lijn = { id: 'l', type: 'line', startX: 0, startY: 50, endX: 200, endY: 50 };
  const entries = [{ ann: a, b: boundsOf(a) }, { ann: lijn, b: { x: 0, y: 50, width: 200, height: 0 } }];
  const changed = matchAnnotationSizes(entries, lijn, { width: true, height: true });
  assert.deepEqual(changed, [a]);
  assert.equal(a.width, 200);
  assert.ok(a.height > 0, `hoogte ${a.height}`);
});

ok('een kleine referentie (0,3 pt) wordt wel gewoon overgenomen', () => {
  const a = rect('a', 10, 10, 120, 90);
  const ref = rect('ref', 0, 0, 0.3, 0.2);
  matchAnnotationSizes(entriesOf([a, ref]), ref, { width: true, height: true });
  assert.equal(a.width, 0.3);
  assert.equal(a.height, 0.2);
});

console.log(`\n${passed} tests geslaagd.`);
