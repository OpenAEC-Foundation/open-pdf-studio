import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MM_PER_PUNT, eenheidPerPuntUitNoemer, noemerUitEenheidPerPunt, leesSchaal,
  schaalUitKalibratie, afstandPt, omtrekPt, oppervlaktePt2, naarEenheid,
  naarEenheidKwadraat, formatteer, meetAfstand,
} from './meten.js';

const bijna = (a, b, marge = 1e-9) => assert.ok(Math.abs(a - b) < marge, `${a} != ${b}`);

test('1:100 in millimeters is 35,2778 mm per punt', () => {
  bijna(eenheidPerPuntUitNoemer(100, 'mm'), 100 * MM_PER_PUNT, 1e-12);
  bijna(eenheidPerPuntUitNoemer(100, 'mm'), 35.27777777777778, 1e-9);
});

test('dezelfde schaal in meters is duizend maal kleiner', () => {
  bijna(eenheidPerPuntUitNoemer(100, 'm'), 0.03527777777777778, 1e-12);
});

test('de weg terug levert dezelfde noemer op', () => {
  for (const noemer of [1, 20, 50, 100, 1250]) {
    for (const eenheid of ['mm', 'cm', 'm', 'in', 'ft']) {
      bijna(noemerUitEenheidPerPunt(eenheidPerPuntUitNoemer(noemer, eenheid), eenheid), noemer, 1e-9);
    }
  }
});

test('een onbekende eenheid of een noemer van nul wordt geweigerd', () => {
  assert.throws(() => eenheidPerPuntUitNoemer(100, 'el'), /onbekende eenheid/);
  assert.throws(() => eenheidPerPuntUitNoemer(0, 'mm'), /groter dan 0/);
});

test('een schaal uit een attribuut lezen', () => {
  assert.equal(leesSchaal('1:50', 'mm').noemer, 50);
  assert.equal(leesSchaal('1/50', 'mm').noemer, 50);
  assert.equal(leesSchaal(' 1 : 50 ', 'mm').noemer, 50);
  assert.equal(leesSchaal('2:100', 'mm').noemer, 50);
  bijna(leesSchaal('35.28', 'mm').eenheidPerPunt, 35.28);
  bijna(leesSchaal('35,28', 'mm').eenheidPerPunt, 35.28);
});

test('een lege of onzinnige schaal levert niets op in plaats van een fout', () => {
  assert.equal(leesSchaal(null), null);
  assert.equal(leesSchaal(''), null);
  assert.equal(leesSchaal('   '), null);
  assert.equal(leesSchaal('kaas'), null);
  assert.equal(leesSchaal('1:0'), null);
  assert.equal(leesSchaal('-3'), null);
});

test('kalibreren: een lijn van 100 pt die 3,5 meter is', () => {
  const s = schaalUitKalibratie(100, 3.5, 'm');
  bijna(s.eenheidPerPunt, 0.035);
  bijna(s.noemer, 0.035 * 1000 / MM_PER_PUNT, 1e-9);
  assert.equal(s.eenheid, 'm');
});

test('kalibreren weigert een lijn zonder lengte', () => {
  assert.throws(() => schaalUitKalibratie(0, 1000, 'mm'), /lengtePt/);
  assert.throws(() => schaalUitKalibratie(100, 0, 'mm'), /echteWaarde/);
});

test('afstand, omtrek en oppervlakte', () => {
  bijna(afstandPt({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  const vierkant = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  bijna(omtrekPt(vierkant, true), 40);
  bijna(omtrekPt(vierkant, false), 30);
  bijna(oppervlaktePt2(vierkant), 100);
});

test('de oppervlakte is onafhankelijk van de richting waarin je hem tekent', () => {
  const rechtsom = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
  const linksom = [...rechtsom].reverse();
  bijna(oppervlaktePt2(rechtsom), oppervlaktePt2(linksom));
});

test('te weinig punten geeft nul, geen fout', () => {
  assert.equal(oppervlaktePt2([{ x: 0, y: 0 }, { x: 1, y: 1 }]), 0);
  assert.equal(omtrekPt([{ x: 0, y: 0 }]), 0);
  assert.equal(omtrekPt(null), 0);
});

test('omrekenen naar de echte wereld', () => {
  const s = leesSchaal('1:100', 'mm');
  bijna(naarEenheid(10, s.eenheidPerPunt), 352.7777777777778, 1e-9);
  bijna(naarEenheidKwadraat(10, s.eenheidPerPunt), 10 * s.eenheidPerPunt ** 2, 1e-9);
});

test('een maat opschrijven hangt niet van de taal af', () => {
  assert.equal(formatteer(1234.5678, 'mm', 2), '1234.57 mm');
  assert.equal(formatteer(1234.5678, 'm', 0), '1235 m');
  assert.equal(formatteer(12, 'mm', 2, true), '12.00 mm²');
  assert.equal(formatteer(12, 'mm', -5), '12 mm');
});

test('meetAfstand levert lengte, waarde en tekst in één keer', () => {
  const s = leesSchaal('1:100', 'mm');
  const r = meetAfstand({ x: 0, y: 0 }, { x: 100, y: 0 }, s, 1);
  bijna(r.lengtePt, 100);
  bijna(r.waarde, 3527.777777777778, 1e-9);
  assert.equal(r.tekst, '3527.8 mm');
  assert.equal(r.eenheid, 'mm');
});

test('zonder schaal meet je in punten', () => {
  const r = meetAfstand({ x: 0, y: 0 }, { x: 0, y: 8 }, null, 0);
  assert.equal(r.tekst, '8 mm');
  bijna(r.lengtePt, 8);
});
