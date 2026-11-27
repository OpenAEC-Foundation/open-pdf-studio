// Openingen die bij een wand horen (#1229): waar de band open is, hoe een
// opening binnen de wand blijft, en het terugvinden van wand en kozijn na
// het laden.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  wandOpeningen, heeftOpeningen, klemAfstandMm, pasOpeningenIn, openingIntervallen,
  overlaptOpening, herkoppelOpeningen, nieuweOpeningSleutel,
} from './wand-openingen.js';

const deur = (afstandMm, breedteMm = 900, extra = {}) => ({
  id: extra.id || `d${afstandMm}`, key: extra.key || `k${afstandMm}`,
  afstandMm, breedteMm, soort: 'deur', zijde: 1, ...extra,
});

test('alleen bruikbare openingen tellen', () => {
  assert.deepEqual(wandOpeningen({}), []);
  assert.deepEqual(wandOpeningen({ openingen: 'x' }), []);
  assert.deepEqual(wandOpeningen(null), []);
  const goed = deur(1000);
  assert.deepEqual(wandOpeningen({ openingen: [goed, null, { afstandMm: 5 }, { breedteMm: 0, afstandMm: 5 }, { breedteMm: 900 }] }), [goed]);
  assert.equal(heeftOpeningen({ openingen: [goed] }), true);
  assert.equal(heeftOpeningen({ openingen: [] }), false);
  assert.equal(heeftOpeningen({ type: 'wall' }), false, 'een wand uit een ouder bestand heeft geen lijst');
});

test('een opening blijft binnen de wand', () => {
  assert.equal(klemAfstandMm(4000, 900, 2000), 2000);
  assert.equal(klemAfstandMm(4000, 900, 100), 450, 'niet voor het beginpunt');
  assert.equal(klemAfstandMm(4000, 900, 3900), 3550, 'niet voorbij het eindpunt');
  assert.equal(klemAfstandMm(4000, 900, -500), 450);
  assert.equal(klemAfstandMm(600, 900, 100), 300, 'breder dan de wand: in het midden');
});

test('inpassen: afstand tot het begin blijft, tenzij de wand te kort wordt', () => {
  // Past gewoon: niets verandert, de invoer blijft ongemoeid.
  const lijst = [deur(3000), deur(1000)];
  const uit = pasOpeningenIn(5000, lijst);
  assert.deepEqual(uit.map((o) => o.afstandMm), [1000, 3000], 'op volgorde langs de wand');
  assert.deepEqual(lijst.map((o) => o.afstandMm), [3000, 1000]);
  assert.notEqual(uit[0], lijst[1], 'nieuwe objecten');

  // De wand wordt korter dan de plaats van de deur: de deur schuift terug.
  assert.deepEqual(pasOpeningenIn(2000, [deur(3000)]).map((o) => o.afstandMm), [1550]);
  // Twee deuren: de achterste schuift terug en duwt de voorste niet weg zolang het past.
  assert.deepEqual(pasOpeningenIn(3200, [deur(1000), deur(3000)]).map((o) => o.afstandMm), [1000, 2750]);
  // Nog korter: ze schuiven tegen elkaar aan in plaats van over elkaar heen.
  assert.deepEqual(pasOpeningenIn(2000, [deur(1000), deur(3000)]).map((o) => o.afstandMm), [650, 1550]);
  // Past het geheel niet meer, dan blijft elke opening op zichzelf op de wand.
  const krap = pasOpeningenIn(1200, [deur(1000), deur(3000)]);
  for (const o of krap) assert.ok(o.afstandMm - 450 >= -1e-9 && o.afstandMm + 450 <= 1200 + 1e-9);
  // Een opening die voor het beginpunt zou vallen.
  assert.deepEqual(pasOpeningenIn(5000, [deur(100)]).map((o) => o.afstandMm), [450]);
});

test('de open stukken van de band, in paginapunten', () => {
  const K = 0.5;                                   // paginapunten per mm
  // Wand van 5000 mm = 2500 pt; deur 900 breed op 2000 mm.
  assert.deepEqual(openingIntervallen(2500, [deur(2000)], K), [{ t0: 775, t1: 1225, id: 'd2000' }]);
  // Twee openingen, ongesorteerd aangeleverd.
  assert.deepEqual(
    openingIntervallen(2500, [deur(4000, 1200), deur(1000)], K).map((i) => [i.t0, i.t1]),
    [[275, 725], [1700, 2300]],
  );
  // Verder dan de wand lang is: het gat schuift terug, het valt niet half buiten de wand.
  assert.deepEqual(openingIntervallen(1000, [deur(3000)], K).map((i) => [i.t0, i.t1]), [[550, 1000]]);
  // Geen schaal of geen lengte: geen gaten.
  assert.deepEqual(openingIntervallen(2500, [deur(2000)], 0), []);
  assert.deepEqual(openingIntervallen(0, [deur(2000)], K), []);
  assert.deepEqual(openingIntervallen(2500, [], K), []);
  assert.deepEqual(openingIntervallen(2500, undefined, K), []);
  // Twee openingen die tegen elkaar liggen worden één gat.
  assert.deepEqual(openingIntervallen(2500, [deur(1000), deur(1900)], K).map((i) => [i.t0, i.t1]), [[275, 1175]]);
});

test('overlap met een andere opening', () => {
  const anderen = [deur(2000)];                    // 1550 .. 2450
  assert.equal(overlaptOpening(2400, 900, anderen), true);
  assert.equal(overlaptOpening(1200, 900, anderen), true);
  assert.equal(overlaptOpening(2000, 100, anderen), true, 'er middenin');
  assert.equal(overlaptOpening(2900, 900, anderen), false, 'precies ertegenaan is geen overlap');
  assert.equal(overlaptOpening(1100, 900, anderen), false);
  assert.equal(overlaptOpening(2000, 900, []), false);
});

test('sleutels zijn uniek', () => {
  const sleutels = new Set(Array.from({ length: 200 }, nieuweOpeningSleutel));
  assert.equal(sleutels.size, 200);
});

test('na het laden vinden wand en kozijn elkaar terug op hun sleutel', () => {
  // De lader geeft elke annotatie een nieuw id; de wand kent alleen de sleutels.
  const wand = {
    id: 'nieuw-wand', type: 'wall', page: 1,
    openingen: [{ key: 'k-deur', afstandMm: 2000, breedteMm: 900, soort: 'deur', zijde: 1 },
      { key: 'k-raam', afstandMm: 6000, breedteMm: 1200, soort: 'raam', zijde: -1 }],
  };
  const deurSymbool = { id: 'nieuw-deur', type: 'parametricSymbol', symbolId: 'door', page: 1, params: { hostWallId: 'oud-wand', hostKey: 'k-deur', width: 900 } };
  const raamSymbool = { id: 'nieuw-raam', type: 'parametricSymbol', symbolId: 'window', page: 1, params: { hostWallId: 'oud-wand', hostKey: 'k-raam', width: 1200 } };
  const los = { id: 'los', type: 'parametricSymbol', symbolId: 'door', page: 1, params: { hostWallId: 'run:0:0', width: 900 } };
  assert.equal(herkoppelOpeningen([wand, los, raamSymbool, deurSymbool]), 2);
  assert.deepEqual(wand.openingen.map((o) => o.id), ['nieuw-deur', 'nieuw-raam']);
  assert.equal(deurSymbool.params.hostWallId, 'nieuw-wand');
  assert.equal(raamSymbool.params.hostWallId, 'nieuw-wand');
  assert.equal(los.params.hostWallId, 'run:0:0', 'een kozijn uit een ouder bestand blijft los');
  assert.equal(wand.openingen[1].zijde, -1);
});

test('een opening zonder kozijn vervalt; andere pagina telt niet', () => {
  const wand = {
    id: 'w', type: 'wall', page: 1,
    openingen: [{ key: 'weg', afstandMm: 1000, breedteMm: 900 }, { key: 'elders', afstandMm: 3000, breedteMm: 900 }],
  };
  const elders = { id: 's', type: 'parametricSymbol', symbolId: 'door', page: 2, params: { hostKey: 'elders' } };
  assert.equal(herkoppelOpeningen([wand, elders]), 0);
  assert.equal(wand.openingen, undefined, 'de wand is weer gewoon dicht');
  assert.equal(elders.params.hostWallId, undefined);
});

test('twee symbolen met dezelfde sleutel: ieder hoogstens bij een wand', () => {
  const a = { id: 'wa', type: 'wall', page: 1, openingen: [{ key: 'k', afstandMm: 1000, breedteMm: 900 }] };
  const b = { id: 'wb', type: 'wall', page: 1, openingen: [{ key: 'k', afstandMm: 1000, breedteMm: 900 }] };
  const s1 = { id: 's1', type: 'parametricSymbol', symbolId: 'door', page: 1, params: { hostKey: 'k' } };
  const s2 = { id: 's2', type: 'parametricSymbol', symbolId: 'door', page: 1, params: { hostKey: 'k' } };
  assert.equal(herkoppelOpeningen([a, b, s1, s2]), 2);
  assert.equal(a.openingen[0].id, 's1');
  assert.equal(b.openingen[0].id, 's2');
});

test('een document zonder gehoste openingen blijft onaangeroerd', () => {
  const wand = { id: 'w', type: 'wall', page: 1, startX: 0 };
  const deurSymbool = { id: 'd', type: 'parametricSymbol', symbolId: 'door', page: 1, params: { hostWallId: 'run:0:0', hostAfstandMm: 2000 } };
  const voor = JSON.stringify([wand, deurSymbool]);
  assert.equal(herkoppelOpeningen([wand, deurSymbool]), 0);
  assert.equal(JSON.stringify([wand, deurSymbool]), voor);
});
