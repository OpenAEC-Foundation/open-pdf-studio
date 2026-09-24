// Een maatketting verlengen of inkorten (#477): punten toevoegen tussen of
// buiten de bestaande hulplijnen, een hulplijn weghalen, en de totaalmaat die
// meegaat.

import assert from 'node:assert/strict';
import test from 'node:test';

import { leesKetting, puntToevoegen, puntVerwijderen, pasPlanToe, puntBij } from './maatketting-bewerken.js';

/** Een liggende ketting op y 50, gemeten punten op y 0: 0 - 100 - 250. */
function ketting({ metTotaal = true } = {}) {
  const seg = (id, a, b, einden) => ({
    id, type: 'measureDistance', startX: a, startY: 50, endX: b, endY: 50,
    leaderStartX: a, leaderStartY: 0, leaderEndX: b, leaderEndY: 0,
    opsMaatRol: 'chain', dimOvershootEnds: einden,
    opsAnkerStart: { annotationId: `w-${a}`, punt: 'start' }, opsAnkerEind: { annotationId: `w-${b}`, punt: 'end' },
    color: '#000000', fontSize: 7,
  });
  const maten = [seg('m1', 0, 100, 'start'), seg('m2', 100, 250, 'end')];
  if (metTotaal) {
    maten.push({
      id: 't', type: 'measureDistance', startX: 0, startY: 80, endX: 250, endY: 80,
      leaderStartX: 0, leaderStartY: 0, leaderEndX: 250, leaderEndY: 0,
      opsMaatRol: 'total', dimOvershootEnds: 'both',
      opsAnkerStart: { annotationId: 'w-0', punt: 'start' }, opsAnkerEind: { annotationId: 'w-250', punt: 'end' },
    });
  }
  return maten;
}

const xs = (k) => k.punten.map((p) => p.x);

test('een ketting lezen: punten op volgorde, segmenten en totaal', () => {
  const maten = ketting();
  const k = leesKetting([maten[1], maten[0]], maten[2]);   // volgorde maakt niet uit
  assert.deepEqual(xs(k), [0, 100, 250]);
  assert.deepEqual(k.segmenten.map((s) => s.id), ['m1', 'm2']);
  assert.equal(k.totaal.id, 't');
  assert.deepEqual(k.punten[1].anker, { annotationId: 'w-100', punt: 'end' });
  // Een andersom getekende maat telt gewoon mee.
  const om = { ...maten[1], startX: 250, endX: 100, leaderStartX: 250, leaderEndX: 100,
    opsAnkerStart: maten[1].opsAnkerEind, opsAnkerEind: maten[1].opsAnkerStart };
  assert.deepEqual(xs(leesKetting([maten[0], om], null)), [0, 100, 250]);
  assert.equal(leesKetting([], null), null);
});

test('een punt TUSSEN twee hulplijnen splitst dat segment', () => {
  const maten = ketting();
  const k = leesKetting(maten.slice(0, 2), maten[2]);
  const plan = puntToevoegen(k, { x: 180, y: 3 }, { annotationId: 'w-x', punt: 'langs' });
  assert.equal(plan.ok, true);
  // m2 (100-250) wordt 100-180; een nieuw segment 180-250 in de stijl van m2.
  const m2 = plan.wijzig.find((w) => w.id === 'm2');
  assert.equal(m2.geometrie.endX, 180);
  assert.equal(m2.geometrie.endY, 50, 'op de maatlijn van de ketting');
  assert.equal(m2.geometrie.leaderEndY, 3, 'de hulplijn begint bij het aangewezen punt');
  assert.deepEqual(m2.ankerEind, { annotationId: 'w-x', punt: 'langs' });
  assert.equal(m2.einden, 'none', 'm2 is nu een tussenstuk');
  assert.equal(plan.nieuw.length, 1);
  assert.equal(plan.nieuw[0].sjabloon, 'm2');
  assert.deepEqual([plan.nieuw[0].geometrie.startX, plan.nieuw[0].geometrie.endX], [180, 250]);
  assert.equal(plan.nieuw[0].einden, 'end');
  assert.deepEqual(plan.nieuw[0].ankerEind, { annotationId: 'w-250', punt: 'end' });
  // De totaalmaat blijft 0-250: niets te doen.
  assert.equal(plan.wijzig.some((w) => w.id === 't'), false);
  assert.deepEqual(plan.weg, []);
});

test('een punt BUITEN de ketting maakt hem langer, en de totaalmaat past zich aan', () => {
  const maten = ketting();
  const k = leesKetting(maten.slice(0, 2), maten[2]);
  const na = puntToevoegen(k, { x: 400, y: 0 });
  assert.equal(na.nieuw.length, 1);
  assert.deepEqual([na.nieuw[0].geometrie.startX, na.nieuw[0].geometrie.endX], [250, 400]);
  assert.equal(na.nieuw[0].einden, 'end');
  assert.equal(na.nieuw[0].sjabloon, 'm2');
  assert.equal(na.wijzig.find((w) => w.id === 'm2').einden, 'none', 'm2 geeft zijn uitloop af');
  const t = na.wijzig.find((w) => w.id === 't');
  assert.deepEqual([t.geometrie.startX, t.geometrie.endX, t.geometrie.startY], [0, 400, 80], 'totaal op zijn eigen lijn');

  const voor = puntToevoegen(k, { x: -60, y: 0 });
  assert.deepEqual([voor.nieuw[0].geometrie.startX, voor.nieuw[0].geometrie.endX], [-60, 0]);
  assert.equal(voor.nieuw[0].einden, 'start');
  assert.equal(voor.nieuw[0].sjabloon, 'm1');
  assert.equal(voor.wijzig.find((w) => w.id === 'm1').einden, 'none');
  assert.equal(voor.wijzig.find((w) => w.id === 't').geometrie.startX, -60);
});

test('een punt op een bestaande hulplijn verandert niets', () => {
  const maten = ketting();
  const plan = puntToevoegen(leesKetting(maten.slice(0, 2), maten[2]), { x: 100.2, y: 10 });
  assert.equal(plan.ok, false);
  assert.match(plan.fout, /already/);
});

test('een losse maat die je verlengt wordt een ketting', () => {
  const los = { ...ketting()[0], dimOvershootEnds: undefined, opsMaatRol: undefined };
  const plan = puntToevoegen(leesKetting([los], null), { x: 160, y: 0 });
  assert.equal(plan.nieuw.length, 1);
  assert.equal(plan.wijzig.find((w) => w.id === 'm1').einden, 'start');
  assert.equal(plan.nieuw[0].einden, 'end');
  assert.equal(plan.nieuw[0].rol, 'chain');
  // Er was geen totaalmaat, en er komt er ook geen bij.
  assert.equal(plan.wijzig.length + plan.nieuw.length, 2);
});

test('een tussenliggende hulplijn weghalen voegt twee segmenten samen', () => {
  const maten = ketting();
  const k = leesKetting(maten.slice(0, 2), maten[2]);
  const plan = puntVerwijderen(k, 1);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.weg, ['m2', 't'], 'een segment over: de totaalmaat is dan dubbel');
  const m1 = plan.wijzig.find((w) => w.id === 'm1');
  assert.deepEqual([m1.geometrie.startX, m1.geometrie.endX], [0, 250]);
  assert.deepEqual(m1.ankerEind, { annotationId: 'w-250', punt: 'end' });
  assert.equal(m1.einden, 'both');
});

test('een buitenste hulplijn weghalen maakt de ketting korter', () => {
  // Drie segmenten: 0 - 100 - 250 - 400.
  const maten = ketting();
  const k0 = leesKetting(maten.slice(0, 2), maten[2]);
  const langer = pasPlanToe(maten, puntToevoegen(k0, { x: 400, y: 0 }), () => 'm3');
  const k = leesKetting(langer.filter((m) => m.opsMaatRol !== 'total'), langer.find((m) => m.opsMaatRol === 'total'));
  assert.deepEqual(xs(k), [0, 100, 250, 400]);
  const plan = puntVerwijderen(k, 0);
  assert.deepEqual(plan.weg, ['m1']);
  assert.equal(plan.wijzig.find((w) => w.id === 'm2').einden, 'start');
  assert.equal(plan.wijzig.find((w) => w.id === 't').geometrie.startX, 100);
  // Een ketting van een maat kan niet korter.
  const los = leesKetting([maten[0]], null);
  assert.equal(puntVerwijderen(los, 0).ok, false);
  assert.equal(puntVerwijderen(k, 9).ok, false, 'onbekend punt');
});

test('pasPlanToe werkt een lijst maten bij zoals de app dat doet', () => {
  const maten = ketting();
  const plan = puntToevoegen(leesKetting(maten.slice(0, 2), maten[2]), { x: 180, y: 0 });
  const na = pasPlanToe(maten, plan, () => 'nieuw-1');
  const nieuw = na.find((m) => m.id === 'nieuw-1');
  assert.equal(nieuw.color, '#000000', 'dezelfde opmaak als zijn buur');
  assert.equal(nieuw.fontSize, 7);
  assert.equal(nieuw.opsMaatRol, 'chain');
  assert.equal(nieuw.startX, 180);
  assert.equal(na.length, 4);
});

test('een hulplijn aanwijzen: bij het gemeten punt of ergens langs de hulplijn', () => {
  const maten = ketting();
  const k = leesKetting(maten.slice(0, 2), maten[2]);
  assert.equal(puntBij(k, { x: 101, y: 1 }), 1, 'bij het wandvlak');
  assert.equal(puntBij(k, { x: 98, y: 30 }), 1, 'halverwege de hulplijn');
  assert.equal(puntBij(k, { x: 175, y: 30 }), -1, 'midden tussen twee hulplijnen');
  assert.equal(puntBij(k, { x: 250, y: 60 }, 6), -1, 'voorbij de maatlijn telt niet');
});
