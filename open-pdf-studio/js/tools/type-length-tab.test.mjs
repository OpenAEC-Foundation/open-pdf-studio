// Getypte afstand tijdens verplaatsen (#519): een getal beweegt precies die
// afstand langs de afgeleide richting; Tab wisselt tussen afstand en hoek.
// Echte state-store; Solid zoals in de app (zie ../core/app-test-hooks.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();

const til = await import('./type-length-input.js');
const { inferMove, createPointIndex } = await import('./inference-engine.js');

const typ = (s) => { for (const k of s) til.consumeKey(k); };
const pxPerUnit = () => {
  // Zelfde schaal als applyToEndpoint gebruikt: 10 eenheden langs +x.
  til.enterTypeLengthMode(0, 0);
  typ('10');
  const p = til.applyToEndpoint(0, 0, 1, 0);
  til.exitTypeLengthMode();
  return p.x / 10;
};

test('getypte afstand volgt de afgeleide richting (pool 45°), niet de rauwe cursor', () => {
  const k = pxPerUnit();
  const start = { x: 0, y: 0 };
  const rauw = { x: 100 * Math.cos(Math.PI / 4 + 0.03), y: 100 * Math.sin(Math.PI / 4 + 0.03) };
  const r = inferMove({
    start, cursor: rauw, pointIndex: createPointIndex([]), segmentQuery: () => [],
    tol: 4, polar: { incrementDeg: 45, toleranceDeg: 3 }, enable: { tracking: false, extension: false, parallel: false },
  });
  til.enterTypeLengthMode(0, 0);
  typ('50');
  const p = til.applyToEndpoint(start.x, start.y, r.x, r.y);
  assert.ok(p.constrained);
  assert.ok(Math.abs(Math.hypot(p.x, p.y) - 50 * k) < 1e-9);
  assert.ok(Math.abs(p.x - p.y) < 1e-9, 'precies op de 45°-straal');
  til.exitTypeLengthMode();
});

test('Tab: afstand → hoekveld → terug naar afstand, zonder de waarden te verliezen', () => {
  til.enterTypeLengthMode(0, 0);
  assert.equal(til.cycleTypeLengthField(), false, 'leeg: niets om te wisselen');
  typ('100');
  assert.equal(til.cycleTypeLengthField(), true);
  assert.equal(til.typeLengthBuffer(), '100<');
  assert.equal(til.typeLengthFocus(), 'end');
  typ('30');
  assert.equal(til.typeLengthBuffer(), '100<30');
  assert.equal(til.typeLengthFormat(), 'polar');
  // Terug naar de afstand: cijfers en Backspace bewerken het deel vóór '<'.
  assert.equal(til.cycleTypeLengthField(), true);
  assert.equal(til.typeLengthFocus(), 'dist');
  til.consumeKey('Backspace');
  typ('5');
  assert.equal(til.typeLengthBuffer(), '105<30');
  // En weer naar de hoek.
  til.cycleTypeLengthField();
  assert.equal(til.typeLengthFocus(), 'end');
  typ('5');
  assert.equal(til.typeLengthBuffer(), '105<305');
  // Escape wist alles en zet de focus terug.
  til.consumeKey('Escape');
  assert.equal(til.typeLengthBuffer(), '');
  assert.equal(til.typeLengthFocus(), 'end');
  til.exitTypeLengthMode();
});

test('Tab doet niets bij relatieve of absolute invoer', () => {
  til.enterTypeLengthMode(0, 0);
  typ('10,5');
  assert.equal(til.cycleTypeLengthField(), false);
  assert.equal(til.typeLengthBuffer(), '10,5');
  til.exitTypeLengthMode();
});
