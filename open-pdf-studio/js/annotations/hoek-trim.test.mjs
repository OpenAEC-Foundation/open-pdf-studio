import assert from 'node:assert/strict';
import test from 'node:test';

import { kruisendeHoek, kruisendeHoekReik, CROSS_REIK_MIN } from './hoek-trim.js';

const P = (x, y) => ({ x, y });

test('reikwijdte schaalt met de breedte maar zakt niet onder de ondergrens', () => {
  assert.equal(kruisendeHoekReik(1, 1), CROSS_REIK_MIN);
  assert.equal(kruisendeHoekReik(10, 5), 40);
  assert.equal(kruisendeHoekReik(5, 10), 40);
});

test('vindt het hoekpunt als beide uiteinden er vlak bij liggen', () => {
  // Eigen element loopt van (0,0) naar (130,0); het andere van (100,-40)
  // naar (100,100). Hartlijnen snijden in (100,0).
  const k = kruisendeHoek(P(130, 0), P(0, 0), P(100, -40), P(100, 100), 10, 10);
  assert.ok(k, 'hoek hoort gevonden te worden');
  assert.deepEqual({ x: Math.round(k.at.x), y: Math.round(k.at.y) }, { x: 100, y: 0 });
  // Het verre uiteinde is het uiteinde dat NIET bij het hoekpunt ligt.
  assert.deepEqual(k.far, P(100, 100));
});

test('kiest het uiteinde dat het dichtst bij het hoekpunt ligt', () => {
  // Het andere element loopt van (100,100) naar (100,-40): far moet nu de
  // andere kant op wijzen dan in de vorige test.
  const k = kruisendeHoek(P(130, 0), P(0, 0), P(100, 100), P(100, -40), 10, 10);
  assert.deepEqual(k.far, P(100, 100));
});

test('geen hoek bij een kruising midden op het andere element', () => {
  const k = kruisendeHoek(P(130, 0), P(0, 0), P(100, -200), P(100, 200), 10, 10);
  assert.equal(k, null, 'daar ligt geen uiteinde bij het snijpunt');
});

test('geen hoek als het eigen uiteinde te ver voorbij het snijpunt ligt', () => {
  const k = kruisendeHoek(P(300, 0), P(0, 0), P(100, -40), P(100, 100), 10, 10);
  assert.equal(k, null);
});

test('werkt ook als het eigen uiteinde nog vóór het snijpunt ligt', () => {
  const k = kruisendeHoek(P(80, 0), P(0, 0), P(100, -20), P(100, 100), 10, 10);
  assert.ok(k);
  assert.deepEqual({ x: Math.round(k.at.x), y: Math.round(k.at.y) }, { x: 100, y: 0 });
});

test('evenwijdige elementen geven geen hoek', () => {
  assert.equal(kruisendeHoek(P(100, 0), P(0, 0), P(0, 20), P(100, 20), 10, 10), null);
});

test('ontbrekende of ontaarde invoer geeft null', () => {
  assert.equal(kruisendeHoek(null, P(0, 0), P(0, 0), P(1, 1), 5, 5), null);
  assert.equal(kruisendeHoek(P(1, 1), P(1, 1), P(0, 0), P(1, 1), 5, 5), null, 'nul-lengte eigen richting');
});
