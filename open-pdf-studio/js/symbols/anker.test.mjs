import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ANKERS, ankerPunt, vakUitAnker, vakMetVastAnker,
  maatAnkerVoor, vakNaMaatwijziging, ankerArgument, voegParamsSamen,
} from './anker.js';

const dichtbij = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} != ${b}`);
const puntGelijk = (p, q, msg) => { dichtbij(p.x, q.x, `${msg} x`); dichtbij(p.y, q.y, `${msg} y`); };

// Vak 100 breed, 40 hoog, midden op (150, 220).
const VAK = { x: 100, y: 200, width: 100, height: 40 };

test('de ankernamen zijn de vaste set van de MCP-kant', () => {
  assert.deepEqual(Object.keys(ANKERS).sort(), ['back', 'back-left', 'back-right', 'center']);
});

test('ongedraaid: de achterkant is de bovenrand van het vak', () => {
  puntGelijk(ankerPunt(VAK, 0, 'center'), { x: 150, y: 220 }, 'midden');
  puntGelijk(ankerPunt(VAK, 0, 'back'), { x: 150, y: 200 }, 'achter-midden');
  puntGelijk(ankerPunt(VAK, 0, 'back-left'), { x: 100, y: 200 }, 'achter-links');
  puntGelijk(ankerPunt(VAK, 0, 'back-right'), { x: 200, y: 200 }, 'achter-rechts');
});

test('draaien: 90 graden legt de achterkant rechts, 180 onder, 270 links', () => {
  // Canvasrotatie met de klok mee (y naar beneden), om het midden.
  puntGelijk(ankerPunt(VAK, 90, 'back'), { x: 170, y: 220 }, '90');
  puntGelijk(ankerPunt(VAK, 180, 'back'), { x: 150, y: 240 }, '180');
  puntGelijk(ankerPunt(VAK, 270, 'back'), { x: 130, y: 220 }, '270');
  // Achter-links draait mee: bij 90 graden rechtsboven.
  puntGelijk(ankerPunt(VAK, 90, 'back-left'), { x: 170, y: 170 }, '90 achter-links');
});

test('vakUitAnker legt het gevraagde punt precies op de plek, bij elke hoek', () => {
  for (const rot of [0, 30, 90, 135, 180, 270, -45]) {
    for (const anker of Object.keys(ANKERS)) {
      const doel = { x: 321.5, y: 87.25 };
      const vak = vakUitAnker(doel, 60, 25, rot, anker);
      assert.equal(vak.width, 60);
      assert.equal(vak.height, 25);
      puntGelijk(ankerPunt(vak, rot, anker), doel, `${anker} @ ${rot}`);
    }
  }
});

test('vakMetVastAnker: een nieuwe maat houdt het ankerpunt op zijn plaats', () => {
  for (const rot of [0, 90, 200]) {
    const oud = ankerPunt(VAK, rot, 'back-left');
    const nieuw = vakMetVastAnker(VAK, rot, 180, 60, 'back-left');
    assert.equal(nieuw.width, 180);
    assert.equal(nieuw.height, 60);
    puntGelijk(ankerPunt(nieuw, rot, 'back-left'), oud, `rot ${rot}`);
  }
  // Midden als anker: het middelpunt blijft staan.
  const m = vakMetVastAnker(VAK, 45, 10, 10, 'center');
  puntGelijk({ x: m.x + 5, y: m.y + 5 }, { x: 150, y: 220 }, 'midden blijft');
});

test('een onbekend anker valt terug op het midden', () => {
  puntGelijk(ankerPunt(VAK, 0, 'nergens'), { x: 150, y: 220 }, 'terugval');
  const vak = vakUitAnker({ x: 0, y: 0 }, 10, 20, 0, undefined);
  assert.deepEqual(vak, { x: -5, y: -10, width: 10, height: 20 });
});

test('maatAnkerVoor: het template kiest zijn eigen vaste punt, alleen in plaats van het midden', () => {
  const closet = { maatAnker: () => 'back' };
  assert.equal(maatAnkerVoor(closet, {}, 'center'), 'back');
  assert.equal(maatAnkerVoor(closet, {}, 'topleft'), 'topleft');
  assert.equal(maatAnkerVoor({}, {}, 'center'), 'center');
  assert.equal(maatAnkerVoor(null, {}), 'center');
  // Een onbekend antwoord van het template: de gewone regel.
  assert.equal(maatAnkerVoor({ maatAnker: () => 'ergens' }, {}, 'center'), 'center');
  // De parameters gaan mee (spiegelen verandert het punt).
  const aanrecht = { maatAnker: (p) => (p.spiegelen ? 'back-right' : 'back-left') };
  assert.equal(maatAnkerVoor(aanrecht, { spiegelen: true }), 'back-right');
});

test('vakNaMaatwijziging: een aanrecht dat 90 graden gedraaid is groeit vanaf zijn begin', () => {
  const vak = { x: 0, y: 0, width: 300, height: 60 };
  const begin = ankerPunt(vak, 90, 'back-left');
  const nieuw = vakNaMaatwijziging(vak, 90, 420, 60, 'back-left');
  puntGelijk(ankerPunt(nieuw, 90, 'back-left'), begin, 'begin blijft');
  assert.equal(nieuw.width, 420);
  // 'topleft' is de oude regel: x/y blijven.
  assert.deepEqual(vakNaMaatwijziging(vak, 90, 420, 70, 'topleft'), { x: 0, y: 0, width: 420, height: 70 });
});

test('ankerArgument: leeg is het midden, onbekend is een fout met de geldige namen', () => {
  assert.deepEqual(ankerArgument(undefined), { ok: true, anker: 'center' });
  assert.deepEqual(ankerArgument('back'), { ok: true, anker: 'back' });
  const fout = ankerArgument('front');
  assert.equal(fout.ok, false);
  assert.match(fout.error, /center, back, back-left, back-right/);
  assert.equal(ankerArgument(3).ok, false);
});

test('voegParamsSamen: bijwerken houdt wat niet genoemd wordt', () => {
  const oud = { lengte: 3000, onderdelen: [{ soort: 'spoelbak', vanaf: 0 }] };
  const uit = voegParamsSamen(oud, { lengte: 3600 });
  assert.deepEqual(uit, { lengte: 3600, onderdelen: [{ soort: 'spoelbak', vanaf: 0 }] });
  assert.notEqual(uit, oud);
  assert.deepEqual(voegParamsSamen(undefined, { a: 1 }), { a: 1 });
  assert.deepEqual(voegParamsSamen(oud, null), oud);
});
