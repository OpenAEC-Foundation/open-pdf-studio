// Rekenregels van Markeren in tekstmodus (#927).

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  leesMarkeerModus, modusNaKlik, lijnRaaktRect, aaneengeslotenReeksen, woordGrenzen,
  dichtsteLetter, hoortBijLabel, labelBereik, quadLangsTekst,
} from './tekst-markeren.js';
import { isSchuin, quadHoek } from '../annotations/markering-quads.js';

const dichtbij = (a, b, msg, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('de modus: alleen text of area; een klik zet aan of wisselt', () => {
  assert.equal(leesMarkeerModus('text'), 'text');
  for (const v of ['area', null, undefined, '', 'iets']) assert.equal(leesMarkeerModus(v), 'area');
  assert.equal(modusNaKlik(false, 'text'), 'text', 'uit: de laatst gekozen modus gaat aan');
  assert.equal(modusNaKlik(false, 'area'), 'area');
  assert.equal(modusNaKlik(true, 'text'), 'area', 'aan: wisselen');
  assert.equal(modusNaKlik(true, 'area'), 'text');
});

test('lijnRaaktRect: kruisen, ernaast en binnen de marge', () => {
  const r = { left: 100, top: 100, right: 160, bottom: 112 };
  assert.equal(lijnRaaktRect({ x1: 90, y1: 106, x2: 200, y2: 106 }, r), true, 'erdoorheen');
  assert.equal(lijnRaaktRect({ x1: 90, y1: 130, x2: 200, y2: 130 }, r), false, 'eronder');
  assert.equal(lijnRaaktRect({ x1: 90, y1: 115, x2: 200, y2: 115 }, r, 4), true, 'binnen de marge');
  assert.equal(lijnRaaktRect({ x1: 0, y1: 0, x2: 300, y2: 0 }, r), false, 'erboven');
  assert.equal(lijnRaaktRect({ x1: 130, y1: 0, x2: 130, y2: 300 }, r), true, 'loodrecht erdoor');
});

test('aaneengeslotenReeksen: één reeks per aaneengesloten stuk', () => {
  assert.deepEqual(aaneengeslotenReeksen([true, true, false, true, false, false, true, true, true]), [[0, 1], [3, 3], [6, 8]]);
  assert.deepEqual(aaneengeslotenReeksen([false, false]), []);
  assert.deepEqual(aaneengeslotenReeksen([]), []);
});

test('woordGrenzen: tekst tussen spaties', () => {
  const t = '150X6.0SHS x 5730 LENGTH';
  assert.deepEqual(woordGrenzen(t, 3), [0, 10]);
  assert.equal(t.slice(...woordGrenzen(t, 3)), '150X6.0SHS');
  assert.equal(t.slice(...woordGrenzen(t, 11)), 'x');
  assert.equal(t.slice(...woordGrenzen(t, t.length - 1)), 'LENGTH');
  assert.equal(woordGrenzen(t, 10), null, 'een spatie');
  assert.equal(woordGrenzen(t, 99), null);
});

test('dichtsteLetter: het dichtste gemeten midden, spaties tellen niet', () => {
  const middens = [{ x: 0, y: 0 }, null, { x: 20, y: 0 }, { x: 30, y: 0 }];
  assert.equal(dichtsteLetter(middens, 11, 0), 2);
  assert.equal(dichtsteLetter(middens, -5, 3), 0);
  assert.equal(dichtsteLetter([null, null], 0, 0), -1);
});

// Woorden in de eigen ruimte van de tekstlaag: letterhoogte 10.
const woord = (x, y, len, t = 0, h = 10) => ({ x, y, t, len, h });

test('hoortBijLabel: zelfde regel en hoek, ongeveer een letter ertussen', () => {
  const issued = woord(100, 200, 60);
  assert.equal(hoortBijLabel(issued, woord(166, 200, 30)), true, 'het volgende woord');
  assert.equal(hoortBijLabel(woord(166, 200, 30), issued), true, 'ook terug');
  assert.equal(hoortBijLabel(issued, woord(200, 200, 30)), false, 'te ver weg');
  assert.equal(hoortBijLabel(issued, woord(166, 214, 30)), false, 'de regel eronder');
  assert.equal(hoortBijLabel(issued, woord(166, 200, 30, 0.5)), false, 'een andere hoek');
  assert.equal(hoortBijLabel(issued, woord(166, 200, 30, 0, 30)), false, 'veel groter');
  // Schuin label: dezelfde regels langs de leesrichting.
  const t = Math.PI / 6, ux = Math.cos(t), uy = Math.sin(t);
  const a = woord(100, 100, 60, t);
  assert.equal(hoortBijLabel(a, woord(100 + 66 * ux, 100 + 66 * uy, 30, t)), true, 'schuin, het volgende woord');
  assert.equal(hoortBijLabel(a, woord(100 + 66 * ux - 14 * uy, 100 + 66 * uy + 14 * ux, 30, t)), false, 'schuin, de regel eronder');
});

test('labelBereik: de buurwoorden die erbij horen, in bestandsvolgorde', () => {
  const maten = [
    woord(100, 50, 80), // ander label erboven
    woord(100, 200, 60), // ISSUED
    woord(166, 200, 25), // FOR
    woord(197, 200, 70), // APPROVAL
    woord(400, 200, 40), // ver weg
  ];
  assert.deepEqual(labelBereik(maten, 2), [1, 3]);
  assert.deepEqual(labelBereik(maten, 1), [1, 3]);
  assert.deepEqual(labelBereik(maten, 4), [4, 4]);
  assert.deepEqual(labelBereik(maten, 0), [0, 0]);
});

test('quadLangsTekst: liggende tekst geeft het tekstvak zelf', () => {
  // Vijf letters van 10 px breed vanaf x 100, letterhoogte 12 (de span is 50 x 12).
  const midden = (i) => ({ x: 105 + 10 * i, y: 206 });
  const q = quadLangsTekst({ p0: midden(0), p1: midden(4), stappen: 4, letters: 5, lLok: 50, hLok: 12, q0: midden(1), q1: midden(3) });
  const verwacht = [{ x: 110, y: 200 }, { x: 140, y: 200 }, { x: 110, y: 212 }, { x: 140, y: 212 }];
  q.forEach((p, i) => { dichtbij(p.x, verwacht[i].x, `p${i + 1} x`); dichtbij(p.y, verwacht[i].y, `p${i + 1} y`); });
  assert.equal(isSchuin(q), false);
});

test('quadLangsTekst: schuine tekst geeft een gedraaide quad langs de tekst', () => {
  const t = Math.PI / 6, ux = Math.cos(t), uy = Math.sin(t);
  // Op het scherm 2x vergroot: letters 20 px uit elkaar, de span lokaal 50 x 12.
  const midden = (i) => ({ x: 300 + 20 * i * ux, y: 300 + 20 * i * uy });
  const q = quadLangsTekst({ p0: midden(0), p1: midden(4), stappen: 4, letters: 5, lLok: 50, hLok: 12, q0: midden(0), q1: midden(4) });
  assert.equal(isSchuin(q), true);
  dichtbij(quadHoek(q), 30, 'langs de tekst', 1e-6);
  dichtbij(Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y), 100, 'lengte: vijf letters', 1e-6);
  dichtbij(Math.hypot(q[2].x - q[0].x, q[2].y - q[0].y), 24, 'hoogte: 12 x 2', 1e-6);
  // De middenlijn loopt door de lettermiddens; boven ligt tegen de normaal in.
  dichtbij((q[0].x + q[2].x) / 2, midden(0).x - 10 * ux, 'midden begin x', 1e-6);
  assert.ok(q[0].y < q[2].y, 'boven boven onder');
});

test('quadLangsTekst: zonder richting geen quad', () => {
  const p = { x: 1, y: 1 };
  assert.equal(quadLangsTekst({ p0: p, p1: p, stappen: 3, letters: 4, lLok: 40, hLok: 10, q0: p, q1: p }), null);
  assert.equal(quadLangsTekst({ p0: p, p1: { x: 5, y: 1 }, stappen: 0, letters: 1, lLok: 40, hLok: 10, q0: p, q1: p }), null);
});
