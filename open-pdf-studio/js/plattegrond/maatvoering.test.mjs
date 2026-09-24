import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ankerPunt, sparingKanten, maatGeometrie, maatketting, kettingUitWandstukken,
  herberekenMaat, herberekenMaten,
} from './maatvoering.js';
import { wandMetSparingen, sparingSymboolVak } from './sparing.js';

const K = 0.5;                       // paginapunten per mm
const wand = { id: 'w1', startX: 0, startY: 100, endX: 5000, endY: 100, dikteMm: 300 };
const bijna = (a, b, tol, wat) => assert.ok(Math.abs(a - b) <= tol, `${wat}: ${a} ≈ ${b}`);

/** De wandstukken van `wand` na het opknippen door een deur en een raam. */
function stukken(w = wand) {
  const { segmenten } = wandMetSparingen(w, [
    { id: 'd1', soort: 'deur', dagmaatMm: 900, hartMm: 2000 },
    { id: 'r1', soort: 'raam', dagmaatMm: 1200, hartMm: 6000 },
  ], K);
  return segmenten.map((s, i) => ({
    id: `w${i + 1}`, startX: s.startX, startY: s.startY, endX: s.endX, endY: s.endY,
  }));
}

test('een anker leest het punt uit de huidige toestand', () => {
  const index = new Map([['w1', wand]]);
  assert.deepEqual(ankerPunt({ annotationId: 'w1', punt: 'start' }, index), { x: 0, y: 100 });
  assert.deepEqual(ankerPunt({ annotationId: 'w1', punt: 'end' }, index), { x: 5000, y: 100 });
  assert.equal(ankerPunt({ annotationId: 'weg', punt: 'start' }, index), null);
  assert.equal(ankerPunt({ annotationId: 'w1', punt: 'onzin' }, index), null);
  assert.equal(ankerPunt(null, index), null);
  // Een gewoon object als index werkt net zo goed als een Map.
  assert.deepEqual(ankerPunt({ annotationId: 'w1', punt: 'start' }, { w1: wand }), { x: 0, y: 100 });
});

test('een anker op een dagkant van een sparing', () => {
  const { sparingen } = wandMetSparingen(wand, [{ id: 's1', soort: 'deur', dagmaatMm: 900, hartMm: 2000 }], K);
  const extra = { sparingen };
  assert.deepEqual(ankerPunt({ annotationId: 's1', punt: 'sparingVan' }, new Map(), extra), { x: 775, y: 100 });
  assert.deepEqual(ankerPunt({ annotationId: 's1', punt: 'sparingTot' }, new Map(), extra), { x: 1225, y: 100 });
  assert.deepEqual(ankerPunt({ annotationId: 's1', punt: 'sparingHart' }, new Map(), extra), { x: 1000, y: 100 });
  assert.equal(ankerPunt({ annotationId: 'weg', punt: 'sparingVan' }, new Map(), extra), null);
});

test('de dagkanten volgen uit het vak van het kozijn zelf', () => {
  const { sparingen } = wandMetSparingen(wand, [{ id: 's1', soort: 'deur', dagmaatMm: 900, hartMm: 2000 }], K);
  const vak = { id: 's1', ...sparingSymboolVak(sparingen[0]) };
  const kanten = sparingKanten(vak);
  assert.deepEqual(kanten.hart, { x: 1000, y: 100 });
  assert.deepEqual(kanten.van, { x: 775, y: 100 });
  assert.deepEqual(kanten.tot, { x: 1225, y: 100 });
  assert.equal(sparingKanten(null), null);

  // Een kozijn in een wand onder 90°: het vak is gedraaid meegegeven.
  const staand = { id: 's2', x: 0, y: 0, width: 400, height: 100, rotation: 90 };
  const k2 = sparingKanten(staand);
  assert.deepEqual(k2.hart, { x: 200, y: 50 });
  assert.ok(Math.abs(k2.van.x - 200) < 1e-9 && Math.abs(k2.van.y + 150) < 1e-9, `van: ${JSON.stringify(k2.van)}`);
  assert.ok(Math.abs(k2.tot.x - 200) < 1e-9 && Math.abs(k2.tot.y - 250) < 1e-9, `tot: ${JSON.stringify(k2.tot)}`);

  // En het anker vindt ze via de annotatie-index, zonder de wand te kennen.
  assert.deepEqual(
    ankerPunt({ annotationId: 's1', punt: 'sparingVan' }, new Map([['s1', vak]])),
    { x: 775, y: 100 },
  );
});

test('de maatlijn ligt naast wat hij meet, aan de aangewezen kant', () => {
  const g = maatGeometrie({ x: 0, y: 100 }, { x: 5000, y: 100 }, 500, K, 1);
  assert.deepEqual([g.startX, g.startY, g.endX, g.endY], [0, 350, 5000, 350]);
  assert.equal(g.lengteMm, 10000);
  const andersom = maatGeometrie({ x: 0, y: 100 }, { x: 5000, y: 100 }, 500, K, -1);
  assert.deepEqual([andersom.startY, andersom.endY], [-150, -150]);
  assert.equal(maatGeometrie({ x: 0, y: 0 }, { x: 0, y: 0 }, 100, K), null, 'nulmaat bestaat niet');
});

test('elk wandstuk levert twee verankerde kettingpunten', () => {
  const punten = kettingUitWandstukken(stukken());
  assert.equal(punten.length, 6, 'drie stukken, elk een begin en een einde');
  assert.deepEqual(punten.map((p) => [p.anker.annotationId, p.anker.punt]), [
    ['w1', 'start'], ['w1', 'end'], ['w2', 'start'], ['w2', 'end'], ['w3', 'start'], ['w3', 'end'],
  ]);
  assert.deepEqual(punten[1], { x: 775, y: 100, anker: { annotationId: 'w1', punt: 'end' } });
  assert.deepEqual(kettingUitWandstukken(null), []);
});

test('een maatketting langs een gevel: penant, dagmaat, penant, plus een totaalmaat', () => {
  const { maten } = maatketting(kettingUitWandstukken(stukken()), {
    pxPerMm: K, offsetMm: 500, zijde: 1,
  });
  assert.equal(maten.length, 6, '5 tussenmaten + 1 totaalmaat');
  const tussen = maten.filter((m) => m.rol === 'tussenmaat');
  assert.deepEqual(tussen.map((m) => Math.round(m.lengteMm)), [1550, 900, 2950, 1200, 3400]);
  bijna(tussen.reduce((s, m) => s + m.lengteMm, 0), 10000, 1e-6, 'som van de tussenmaten');
  // De dagmaten zijn de gaten TUSSEN de wandstukken.
  assert.deepEqual(tussen[1].ankerStart, { annotationId: 'w1', punt: 'end' });
  assert.deepEqual(tussen[1].ankerEind, { annotationId: 'w2', punt: 'start' });

  const totaal = maten.find((m) => m.rol === 'totaalmaat');
  assert.equal(totaal.lengteMm, 10000);
  assert.equal(totaal.startY, 100 + 850 * K, 'de totaalmaat ligt een regel verder naar buiten');
  assert.deepEqual(totaal.ankerStart, { annotationId: 'w1', punt: 'start' });
  assert.deepEqual(totaal.ankerEind, { annotationId: 'w3', punt: 'end' });
});

test('één tussenmaat krijgt geen dubbele totaalmaat', () => {
  const { maten } = maatketting(kettingUitWandstukken([wand]), { pxPerMm: K });
  assert.equal(maten.length, 1);
  assert.equal(maten[0].rol, 'tussenmaat');
});

test('de maat schuift mee als de wand verschuift', () => {
  const [g] = maatketting(kettingUitWandstukken([wand]), { pxPerMm: K, offsetMm: 500 }).maten;
  const maat = { id: 'm1', ...g, offsetMm: 500, zijde: 1 };

  assert.equal(herberekenMaat(maat, new Map([['w1', wand]]), { pxPerMm: K }).status, 'ongewijzigd');

  const verschoven = { ...wand, startY: 400, endY: 400 };
  const r = herberekenMaat(maat, new Map([['w1', verschoven]]), { pxPerMm: K });
  assert.equal(r.status, 'bijgewerkt');
  assert.deepEqual(r.patch, { startX: 0, startY: 650, endX: 5000, endY: 650 });
  assert.equal(r.lengteMm, 10000);

  // En de maat verandert als de gevel langer wordt.
  const langer = { ...wand, endX: 6000 };
  assert.equal(herberekenMaat(maat, new Map([['w1', langer]]), { pxPerMm: K }).lengteMm, 12000);
});

test('een anker dat wegvalt maakt de maat los, niet stuk', () => {
  const [g] = maatketting(kettingUitWandstukken([wand]), { pxPerMm: K, offsetMm: 500 }).maten;
  const maat = { id: 'm1', ...g, offsetMm: 500, zijde: 1 };
  const r = herberekenMaat(maat, new Map(), { pxPerMm: K });
  assert.equal(r.status, 'losgeraakt');
  assert.equal(r.patch, undefined, 'de bestaande geometrie blijft staan');
});

test('een hele set maten in één keer herberekenen', () => {
  const stuk = stukken();
  const maten = maatketting(kettingUitWandstukken(stuk), { pxPerMm: K, offsetMm: 500 }).maten
    .map((m, i) => ({ id: `m${i}`, ...m, offsetMm: m.rol === 'totaalmaat' ? 850 : 500, zijde: 1 }));
  assert.equal(maten.length, 6);

  const verschoven = stuk.map((w) => ({ ...w, startY: w.startY + 200, endY: w.endY + 200 }));
  const index = new Map(verschoven.map((w) => [w.id, w]));
  const uit = herberekenMaten(maten, index, { pxPerMm: K });
  assert.equal(uit.bijgewerkt.length, 6);
  assert.equal(uit.losgeraakt.length, 0);
  assert.equal(uit.ongewijzigd, 0);
  for (const b of uit.bijgewerkt) {
    assert.equal(b.patch.startY - 200, maten.find((m) => m.id === b.id).startY);
  }

  // Valt het eerste wandstuk weg, dan raken alleen de maten die eraan hingen
  // los; de rest wordt gewoon bijgewerkt.
  index.delete('w1');
  const zonder = herberekenMaten(maten, index, { pxPerMm: K });
  assert.equal(zonder.losgeraakt.length, 3);
  assert.equal(zonder.bijgewerkt.length, 3);
});
