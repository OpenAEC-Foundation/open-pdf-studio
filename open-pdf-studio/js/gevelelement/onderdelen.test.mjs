import assert from 'node:assert/strict';
import test from 'node:test';

import { indeling } from './indeling.js';
import {
  onderdelen, volgendOnderdeel, geldigOnderdeel, onderdeelOp, zelfdeOnderdeel, mogelijkheden,
} from './onderdelen.js';

const DRIE = indeling({
  lengte: 3600,
  stijlen: [{ pos: 1200 }, { pos: 2400 }],
  panelen: ['glas', 'deur', 'glas'],
}, 'vliesgevel');

const S = (index) => ({ soort: 'stijl', index });
const P = (index) => ({ soort: 'paneel', index });

test('Tab-volgorde: eerst alle stijlen van begin tot eind, dan alle panelen', () => {
  assert.deepEqual(onderdelen(DRIE), [S(0), S(1), S(2), S(3), P(0), P(1), P(2)]);
});

test('Tab loopt de ring rond en komt terug bij het geheel', () => {
  const gezien = [];
  let nu = null;
  for (let i = 0; i < 8; i++) {
    nu = volgendOnderdeel(DRIE, nu, 1);
    gezien.push(nu);
  }
  assert.deepEqual(gezien, [S(0), S(1), S(2), S(3), P(0), P(1), P(2), null]);
  assert.deepEqual(volgendOnderdeel(DRIE, null, 1), S(0), 'daarna opnieuw bij de eerste stijl');
});

test('Shift+Tab loopt achteruit, ook vanuit het geheel', () => {
  assert.deepEqual(volgendOnderdeel(DRIE, null, -1), P(2), 'vanuit het geheel naar het laatste paneel');
  assert.deepEqual(volgendOnderdeel(DRIE, P(0), -1), S(3), 'van het eerste paneel terug naar het eindkader');
  assert.equal(volgendOnderdeel(DRIE, S(0), -1), null, 'vóór de eerste stijl ligt het geheel');
});

test('met de aanwijzer boven het element begint Tab bij het onderdeel eronder', () => {
  assert.deepEqual(volgendOnderdeel(DRIE, null, 1, P(1)), P(1));
  assert.deepEqual(volgendOnderdeel(DRIE, null, -1, S(2)), S(2));
  // Is er al een onderdeel geselecteerd, dan telt de aanwijzer niet meer.
  assert.deepEqual(volgendOnderdeel(DRIE, S(1), 1, P(1)), S(2));
  // Een verouderd onderdeel (na een bewerking) begint opnieuw.
  assert.deepEqual(volgendOnderdeel(DRIE, S(9), 1), S(0));
});

test('onderdeel onder de aanwijzer: stijl binnen zijn breedte, anders het paneel', () => {
  assert.deepEqual(onderdeelOp(DRIE, 20), S(0), 'in het beginkader (0..50)');
  assert.deepEqual(onderdeelOp(DRIE, 600), P(0));
  assert.deepEqual(onderdeelOp(DRIE, 1190), S(1), 'in stijl 1 (1175..1225)');
  assert.deepEqual(onderdeelOp(DRIE, 1170), P(0), 'net ernaast: nog het paneel');
  assert.deepEqual(onderdeelOp(DRIE, 1170, 10), S(1), 'met speling wint de stijl');
  assert.deepEqual(onderdeelOp(DRIE, 3000), P(2));
  assert.equal(onderdeelOp(DRIE, -30), null);
  assert.equal(onderdeelOp(DRIE, 3700), null);
});

test('geldigheid en vergelijking van onderdelen', () => {
  assert.deepEqual(geldigOnderdeel(DRIE, S(3)), S(3));
  assert.equal(geldigOnderdeel(DRIE, S(4)), null);
  assert.equal(geldigOnderdeel(DRIE, P(3)), null);
  assert.equal(geldigOnderdeel(DRIE, { soort: 'rand', index: 0 }), null);
  assert.equal(geldigOnderdeel(DRIE, null), null);
  assert.ok(zelfdeOnderdeel(null, null));
  assert.ok(zelfdeOnderdeel(S(1), { soort: 'stijl', index: 1 }));
  assert.ok(!zelfdeOnderdeel(S(1), P(1)));
});

test('wat kan er met een onderdeel: kader niet verschuiven of verwijderen', () => {
  assert.deepEqual(mogelijkheden(DRIE, S(1)), { verschuiven: true, verwijderen: true, wisselStijl: true, wisselPaneel: false });
  assert.deepEqual(mogelijkheden(DRIE, S(0)), { verschuiven: false, verwijderen: false, wisselStijl: true, wisselPaneel: false });
  assert.deepEqual(mogelijkheden(DRIE, S(3)), { verschuiven: false, verwijderen: false, wisselStijl: true, wisselPaneel: false });
  assert.deepEqual(mogelijkheden(DRIE, P(1)), { verschuiven: false, verwijderen: false, wisselStijl: false, wisselPaneel: true });
  assert.equal(mogelijkheden(DRIE, null).wisselPaneel, false);
});
