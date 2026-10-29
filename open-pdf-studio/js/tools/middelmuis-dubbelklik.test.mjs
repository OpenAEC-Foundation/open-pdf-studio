import assert from 'node:assert/strict';
import test from 'node:test';

import { maakMiddelmuisDubbelklik, DUBBELKLIK_TIJD_MS, DUBBELKLIK_MARGE_PX } from './middelmuis-dubbelklik.js';

// Geïnjecteerde klok: elke stap zet de tijd expliciet, geen echte timers.
function maak(o = {}) {
  let t = 1000;
  const dk = maakMiddelmuisDubbelklik({ nu: () => t, ...o });
  return { dk, op: (ms) => { t = 1000 + ms; } };
}

test('twee snelle middelklikken op dezelfde plek: dubbelklik bij het tweede loslaten', () => {
  const { dk, op } = maak();
  op(0); dk.druk(100, 100);
  op(60); assert.equal(dk.los(100, 100), false);
  op(150); dk.druk(101, 100);
  op(200); assert.equal(dk.los(101, 101), true);
});

test('standaardwaarden: 500 ms en een kleine marge', () => {
  assert.equal(DUBBELKLIK_TIJD_MS, 500);
  assert.ok(DUBBELKLIK_MARGE_PX > 0 && DUBBELKLIK_MARGE_PX <= 8);
});

test('timing: tweede druk na de dubbelkliktijd begint een nieuwe reeks', () => {
  const { dk, op } = maak();
  op(0); dk.druk(0, 0);
  op(50); dk.los(0, 0);
  op(501); dk.druk(0, 0);
  op(550); assert.equal(dk.los(0, 0), false);
  // ...en die nieuwe reeks kan zelf weer een dubbelklik worden.
  op(650); dk.druk(0, 0);
  op(700); assert.equal(dk.los(0, 0), true);
});

test('timing: precies op de grens telt nog mee', () => {
  const { dk, op } = maak();
  op(0); dk.druk(0, 0);
  op(100); dk.los(0, 0);
  op(500); dk.druk(0, 0);
  op(520); assert.equal(dk.los(0, 0), true);
});

test('timing: een lang ingehouden tweede druk is geen klik', () => {
  const { dk, op } = maak();
  op(0); dk.druk(0, 0);
  op(50); dk.los(0, 0);
  op(100); dk.druk(0, 0);
  op(700); assert.equal(dk.los(0, 0), false);
});

test('timing: een lang ingehouden eerste druk telt niet als eerste klik', () => {
  const { dk, op } = maak();
  op(0); dk.druk(0, 0);
  op(600); dk.los(0, 0);
  op(650); dk.druk(0, 0);
  op(700); assert.equal(dk.los(0, 0), false);
});

test('bewegingsmarge: binnen de marge ja, erbuiten nee', () => {
  let m = maak({ margePx: 4 });
  m.op(0); m.dk.druk(10, 10);
  m.op(40); m.dk.beweeg(13, 10);
  m.op(50); m.dk.los(13, 10);
  m.op(100); m.dk.druk(12, 12);
  m.op(150); assert.equal(m.dk.los(12, 12), true);

  m = maak({ margePx: 4 });
  m.op(0); m.dk.druk(10, 10);
  m.op(50); m.dk.los(10, 10);
  m.op(100); m.dk.druk(20, 10); // tweede klik te ver van de eerste
  m.op(150); assert.equal(m.dk.los(20, 10), false);
});

test('middelsleep (pan) breekt af, ook als die met een snelle klik begint', () => {
  const { dk, op } = maak();
  op(0); dk.druk(50, 50);
  op(40); dk.los(50, 50);
  op(90); dk.druk(50, 50); // snelle tweede druk...
  op(120); dk.beweeg(60, 55); // ...maar daarna slepen = pan
  op(150); dk.beweeg(80, 70);
  op(200); assert.equal(dk.los(80, 70), false);
  assert.equal(dk.fase, 'rust');
});

test('slepen tijdens de eerste druk breekt de reeks ook af', () => {
  const { dk, op } = maak();
  op(0); dk.druk(0, 0);
  op(30); dk.beweeg(30, 0);
  op(60); dk.los(30, 0);
  op(100); dk.druk(30, 0);
  op(150); assert.equal(dk.los(30, 0), false);
});

test('derde klik herhaalt het gebaar niet; een vierde maakt een nieuwe dubbelklik', () => {
  const { dk, op } = maak();
  const uitkomsten = [];
  for (let i = 0; i < 4; i++) {
    op(i * 100); dk.druk(0, 0);
    op(i * 100 + 40); uitkomsten.push(dk.los(0, 0));
  }
  assert.deepEqual(uitkomsten, [false, true, false, true]);
});

test('reset (pointercancel/blur) wist een half afgemaakte reeks', () => {
  const { dk, op } = maak();
  op(0); dk.druk(0, 0);
  op(40); dk.los(0, 0);
  dk.reset();
  op(80); dk.druk(0, 0);
  op(120); assert.equal(dk.los(0, 0), false);
});

test('loslaten zonder druk doet niets', () => {
  const { dk } = maak();
  assert.equal(dk.los(0, 0), false);
  assert.equal(dk.fase, 'rust');
});
