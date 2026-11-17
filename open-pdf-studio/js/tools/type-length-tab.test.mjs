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

// ── Voet, inch en breuken in de directe invoer (#1145) ─────────────────────

test('typed feet and inches are taken key by key and converted to the scale unit', () => {
  const k = pxPerUnit();
  assert.equal(til.typeLengthUnit(), 'mm', 'without a scale the unit is mm');
  til.enterTypeLengthMode(0, 0);
  typ(`1'-6 1/2"`);
  assert.equal(til.typeLengthBuffer(), `1'-6 1/2"`);
  assert.equal(til.typeLengthFormat(), 'length');
  // 18,5 inch = 469,9 mm, ook al is de eenheid van de schaal metrisch.
  const p = til.applyToEndpoint(0, 0, 1, 0);
  assert.ok(p.constrained);
  assert.ok(Math.abs(p.x - 469.9 * k) < 1e-9);
  const r = til.consumeKey('Enter');
  assert.equal(r.committed, true);
  assert.ok(Math.abs(r.length - 469.9) < 1e-9);
  til.exitTypeLengthMode();
});

test('a half-typed feet-inch length is invalid and Enter does not commit it', () => {
  til.enterTypeLengthMode(0, 0);
  typ(`6 3/`);
  assert.equal(til.typeLengthFormat(), 'invalid');
  assert.equal(til.consumeKey('Enter').handled, false);
  typ(`8"`);
  assert.equal(til.typeLengthFormat(), 'length');
  // Backspace haalt het inchteken weer weg: een breuk zonder teken raadt de app niet.
  til.consumeKey('Backspace');
  assert.equal(til.typeLengthFormat(), 'invalid');
  til.exitTypeLengthMode();
});

test('feet and inches per field: relative, polar distance, never the angle', () => {
  til.enterTypeLengthMode(0, 0);
  typ(`1',-6"`);
  assert.equal(til.typeLengthBuffer(), `1',-6"`);
  assert.equal(til.typeLengthFormat(), 'cartesian');
  til.clearTypeLengthBuffer();
  typ(`2'<45'`);
  assert.equal(til.typeLengthBuffer(), `2'<45`, 'no feet mark in the angle');
  assert.equal(til.typeLengthFormat(), 'polar');
  // Tab naar de afstand: daar mag het inchdeel erbij.
  til.cycleTypeLengthField();
  typ(` 6"`);
  assert.equal(til.typeLengthBuffer(), `2' 6"<45`);
  assert.equal(til.typeLengthFormat(), 'polar');
  til.clearTypeLengthBuffer();
  // Een spatie of een teken zonder getal ervoor doet niets.
  assert.equal(til.consumeKey(' ').handled, false);
  assert.equal(til.consumeKey("'").handled, false);
  til.exitTypeLengthMode();
});
