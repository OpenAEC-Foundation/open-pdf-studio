// Een vlak-annotatie (meetvlak of getekend vlak) bestaat uit de buitenring
// `points` plus nul of meer extra ringen in `holes`. Vroeger telde ELKE extra
// ring als gat: de vulling ging met de even-oneven-regel en de oppervlakte trok
// elke ring af. Voor een donut klopt dat, maar voor een tweede deel naast of
// over het eerste niet — de gedeelde overlap viel uit de vulling en twee
// gelijke delen naast elkaar kwamen op 0 m² uit.
//
// Deze test legt de regel vast die scherm, oppervlakte, hoeveelheden en de
// opgeslagen appearance nu allemaal volgen (zie vlak-ringen.js).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  vlakRingen,
  ringenIndelen,
  ringenRichten,
  ringOmkeren,
  ringOppervlak,
  nettoVlakOppervlak,
  puntInVlak,
} from './vlak-ringen.js';
import { expandArcPoints } from './arc-points.js';

const rechthoek = (x, y, b, h) => [
  { x, y }, { x: x + b, y }, { x: x + b, y: y + h }, { x, y: y + h },
];

const GROOT = rechthoek(0, 0, 100, 100);

// ── indeling: gat of extra deel ─────────────────────────────────────────────

test('een ring binnen de buitenring is een gat', () => {
  const ringen = vlakRingen(GROOT, [rechthoek(20, 20, 40, 40)]);
  assert.deepEqual(ringenIndelen(ringen), [true, false]);
});

test('een ring naast de buitenring is een extra deel', () => {
  const ringen = vlakRingen(GROOT, [rechthoek(150, 0, 100, 100)]);
  assert.deepEqual(ringenIndelen(ringen), [true, true]);
});

test('een ring die de buitenring overlapt is een extra deel', () => {
  const ringen = vlakRingen(GROOT, [rechthoek(80, 80, 100, 100)]);
  assert.deepEqual(ringenIndelen(ringen), [true, true]);
});

test('een gat in een tweede deel is weer een gat', () => {
  const ringen = vlakRingen(GROOT, [
    rechthoek(150, 0, 100, 100),   // tweede deel
    rechthoek(170, 20, 40, 40),    // gat in dat tweede deel
  ]);
  assert.deepEqual(ringenIndelen(ringen), [true, true, false]);
});

test('een ring in een gat is weer een deel (drie lagen diep)', () => {
  const ringen = vlakRingen(GROOT, [
    rechthoek(10, 10, 80, 80),     // gat
    rechthoek(30, 30, 40, 40),     // eilandje in dat gat
  ]);
  assert.deepEqual(ringenIndelen(ringen), [true, false, true]);
});

test('een gat dat de buitenrand raakt blijft een gat', () => {
  // Alle hoekpunten van het gat liggen op of binnen de buitenring.
  const ringen = vlakRingen(GROOT, [[{ x: 0, y: 20 }, { x: 40, y: 20 }, { x: 40, y: 60 }, { x: 0, y: 60 }]]);
  assert.deepEqual(ringenIndelen(ringen), [true, false]);
});

test('ringen met minder dan drie punten tellen niet mee', () => {
  assert.equal(vlakRingen(GROOT, [[{ x: 1, y: 1 }, { x: 2, y: 2 }], null]).length, 1);
  assert.equal(vlakRingen(GROOT, undefined).length, 1);
  assert.equal(vlakRingen(null, [GROOT]).length, 0);
});

// ── richting: zodat de niet-nul-regel het juiste gebied vult ────────────────

test('delen krijgen dezelfde draairichting, gaten de tegengestelde', () => {
  const gericht = ringenRichten(GROOT, [rechthoek(20, 20, 40, 40), rechthoek(150, 0, 50, 50)]);
  assert.equal(gericht.length, 3);
  assert.deepEqual(gericht.map(r => r.additief), [true, false, true]);
  const teken = gericht.map(r => Math.sign(ringOppervlak(r.points)));
  assert.equal(teken[0], teken[2], 'beide delen draaien dezelfde kant op');
  assert.equal(teken[1], -teken[0], 'het gat draait de andere kant op');
});

test('zonder extra ringen blijft de buitenring ongewijzigd', () => {
  const gericht = ringenRichten(GROOT, undefined);
  assert.equal(gericht.length, 1);
  assert.equal(gericht[0].points, GROOT);
  assert.equal(gericht[0].additief, true);
});

test('een omgekeerde ring beschrijft dezelfde vorm, ook met een boogsegment', () => {
  const ring = [
    { x: 0, y: 0 },
    { x: 60, y: 0, arc: true, bulge: 0.4 },
    { x: 60, y: 40 },
    { x: 0, y: 40 },
  ];
  const om = ringOmkeren(ring);
  assert.equal(om.length, ring.length);
  // Zelfde oppervlak, tegengestelde draairichting.
  const a = ringOppervlak(ring);
  const b = ringOppervlak(om);
  assert.ok(Math.abs(Math.abs(a) - Math.abs(b)) < 1e-6, `${a} vs ${b}`);
  assert.equal(Math.sign(a), -Math.sign(b));
  // En dezelfde puntenwolk: de boog buigt naar dezelfde kant.
  const heen = expandArcPoints(ring).map(p => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).sort();
  const terug = expandArcPoints(om).map(p => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).sort();
  assert.deepEqual(terug, heen);
});

// ── oppervlakte ─────────────────────────────────────────────────────────────

test('een gat trekt af van de oppervlakte', () => {
  assert.equal(nettoVlakOppervlak(GROOT, [rechthoek(20, 20, 40, 40)]), 100 * 100 - 40 * 40);
});

test('twee delen naast elkaar tellen op (vroeger: 0)', () => {
  assert.equal(nettoVlakOppervlak(GROOT, [rechthoek(150, 0, 100, 100)]), 2 * 100 * 100);
});

test('overlappende delen tellen elk hun eigen oppervlak mee', () => {
  // Vastgelegde keuze: losse delen worden opgeteld, een gedeelde overlap telt
  // dus één keer per deel. Voor een exacte oppervlakte laat je delen elkaar
  // niet overlappen.
  assert.equal(nettoVlakOppervlak(GROOT, [rechthoek(80, 80, 100, 100)]), 2 * 100 * 100);
});

test('een gat in een tweede deel trekt van dat deel af', () => {
  const opp = nettoVlakOppervlak(GROOT, [rechthoek(150, 0, 100, 100), rechthoek(170, 20, 40, 40)]);
  assert.equal(opp, 100 * 100 + 100 * 100 - 40 * 40);
});

test('een extra ring die de buitenring omsluit maakt de buitenring het gat', () => {
  // De indeling kijkt naar de nesting, niet naar de volgorde: wie binnen ligt
  // is het gat. Zo blijft een donut een donut, ongeacht welke ring als eerste
  // getekend is.
  const opp = nettoVlakOppervlak(rechthoek(20, 20, 10, 10), [rechthoek(0, 0, 100, 100)]);
  assert.equal(opp, 100 * 100 - 10 * 10);
});

test('twee ringen op dezelfde plek heffen elkaar op, nooit negatief', () => {
  assert.equal(nettoVlakOppervlak(GROOT, [GROOT.map(p => ({ ...p }))]), 0);
});

// ── raakvlak: waar ligt de vulling? ─────────────────────────────────────────

test('een punt in het gat ligt buiten het vlak, een punt in de ring erbinnen', () => {
  const gaten = [rechthoek(20, 20, 40, 40)];
  assert.equal(puntInVlak(10, 10, GROOT, gaten), true);
  assert.equal(puntInVlak(40, 40, GROOT, gaten), false);
  assert.equal(puntInVlak(500, 500, GROOT, gaten), false);
});

test('beide delen naast elkaar zijn gevuld', () => {
  const gaten = [rechthoek(150, 0, 100, 100)];
  assert.equal(puntInVlak(50, 50, GROOT, gaten), true);
  assert.equal(puntInVlak(200, 50, GROOT, gaten), true);
  assert.equal(puntInVlak(125, 50, GROOT, gaten), false);
});

test('de overlap van twee delen blijft gevuld (de fout uit #457)', () => {
  const gaten = [rechthoek(80, 80, 100, 100)];
  assert.equal(puntInVlak(50, 50, GROOT, gaten), true);
  assert.equal(puntInVlak(90, 90, GROOT, gaten), true, 'de overlap hoort gevuld te blijven');
  assert.equal(puntInVlak(150, 150, GROOT, gaten), true);
});
