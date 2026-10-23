import assert from 'node:assert/strict';
import test from 'node:test';
import { kaderDikte, kaderKleur, kaderRechthoek, KADER_STANDAARD_KLEUR } from './afbeelding-kader.js';

test('kaderDikte: alleen een positieve dikte telt', () => {
  assert.equal(kaderDikte({ frameWidth: 3 }), 3);
  assert.equal(kaderDikte({ frameWidth: 0.5 }), 0.5);
  assert.equal(kaderDikte({}), 0);
  assert.equal(kaderDikte({ frameWidth: -2 }), 0);
  assert.equal(kaderDikte({ frameWidth: 'x' }), 0);
  assert.equal(kaderDikte(null), 0);
});

test('kaderKleur: een geldige hex, anders zwart', () => {
  assert.equal(kaderKleur({ frameColor: '#FF00aa' }), '#FF00aa');
  assert.equal(kaderKleur({ frameColor: 'red' }), KADER_STANDAARD_KLEUR);
  assert.equal(kaderKleur({}), KADER_STANDAARD_KLEUR);
});

test('kaderRechthoek: de lijn ligt een halve dikte binnen de rand', () => {
  assert.deepEqual(kaderRechthoek(100, 50, 4), { x: 2, y: 2, w: 96, h: 46 });
  assert.deepEqual(kaderRechthoek(3, 3, 10), { x: 5, y: 5, w: 0, h: 0 });
});
