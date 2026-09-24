// Wandjoin per uiteinde en per laag (#476).
//
// Aanleiding: in een demo werden gevels als losse lagen getekend (metselwerk
// 100, luchtspouw 40, isolatie 100, kalkzandsteen 120). In de hoek pakte de
// kruisende-hoekregel de dichtstbijzijnde wand van ELKE laag: de isolatie
// van de ene gevel verstekte tegen het metselwerk van de andere en stak erdoor.
// Hier staat de joinbeslissing als pure functie vast: per uiteinde aan/uit,
// een kruisende hoek alleen binnen dezelfde laag, en de handeling
// "hoek trimmen".

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  JOIN_TOL, LAAG_REIK_FACTOR,
  wandLaag, zelfdeLaag, joinToegestaan, magJoinen, dichtstbijzijndEind,
  zoekJoinPartner, zetJoin, hoekTrimPlan, pasTrimToe,
} from './wand-join.js';
import { kruisendeHoek } from './hoek-trim.js';

const MET = 'nen47-metselwerk-baksteen';
const KZS = 'nen47-metselwerk-kunststeen';
const ISO = 'isolatie';

let teller = 0;
function wand(sx, sy, ex, ey, extra = {}) {
  return {
    id: extra.id || `w${++teller}`, type: 'wall', page: 1,
    startX: sx, startY: sy, endX: ex, endY: ey,
    dikteMm: 100, hatchPattern: MET, ...extra,
  };
}
// In deze tests is 1 pt = 1 mm: de halve dikte is dikteMm / 2.
const halfW = (w) => (w.dikteMm || 100) / 2;
const rond = (p) => ({ x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 });

// ── laag en schakelaar ────────────────────────────────────────────────────

test('de laag is het materiaal; alle isolatiesoorten zijn één laag', () => {
  assert.equal(wandLaag({ hatchPattern: MET }), MET);
  assert.equal(wandLaag({ hatchPattern: 'isolatie', isolatieType: 'pir' }), 'isolatie');
  assert.equal(wandLaag({ hatchPattern: 'iso-steenwol' }), 'isolatie', 'oude iso-<soort>-waarde');
  assert.equal(wandLaag({}), 'none');
  assert.equal(wandLaag({ hatchPattern: 'none' }), 'none');
  assert.ok(zelfdeLaag({ hatchPattern: 'isolatie', isolatieType: 'eps' }, { hatchPattern: 'iso-pir' }));
  assert.ok(!zelfdeLaag({ hatchPattern: MET }, { hatchPattern: KZS }));
});

test('standaard mag elk uiteinde joinen; de vlag geldt alleen voor zijn eigen uiteinde', () => {
  const w = wand(0, 0, 100, 0);
  assert.equal(joinToegestaan(w, 'start'), true);
  assert.equal(joinToegestaan(w, 'end'), true);
  w.noJoinEnd = true;
  assert.equal(joinToegestaan(w, 'start'), true);
  assert.equal(joinToegestaan(w, 'end'), false);
});

test('een join vraagt dat BEIDE uiteinden het toestaan', () => {
  const a = wand(0, 0, 100, 0), b = wand(100, 0, 100, 100);
  assert.equal(magJoinen(a, 'end', b, 'start', 'samenvallend'), true);
  b.noJoinStart = true;
  assert.equal(magJoinen(a, 'end', b, 'start', 'samenvallend'), false);
  assert.equal(magJoinen(b, 'start', a, 'end', 'samenvallend'), false, 'symmetrisch');
});

test('samenvallende eindpunten verstekken ongeacht materiaal; een kruisende hoek alleen binnen de laag', () => {
  const a = wand(0, 0, 100, 0, { hatchPattern: MET });
  const b = wand(100, 0, 100, 100, { hatchPattern: 'nen47-beton-gewapend' });
  assert.equal(magJoinen(a, 'end', b, 'start', 'samenvallend'), true);
  assert.equal(magJoinen(a, 'end', b, 'start', 'kruisend'), false);
  b.hatchPattern = MET;
  assert.equal(magJoinen(a, 'end', b, 'start', 'kruisend'), true);
});

test('zetJoin zet de vlag aan of haalt hem weg (standaard = geen veld)', () => {
  const w = wand(0, 0, 100, 0);
  zetJoin(w, 'start', false);
  assert.equal(w.noJoinStart, true);
  assert.equal('noJoinEnd' in w, false);
  zetJoin(w, 'start', true);
  assert.equal('noJoinStart' in w, false, 'terug naar standaard: veld weg');
  zetJoin(w, 'end', false);
  assert.equal(w.noJoinEnd, true);
});

test('dichtstbijzijndEind kiest het uiteinde bij de klik', () => {
  const w = wand(0, 0, 100, 0);
  assert.equal(dichtstbijzijndEind(w, { x: 10, y: 3 }), 'start');
  assert.equal(dichtstbijzijndEind(w, { x: 90, y: -3 }), 'end');
  assert.equal(dichtstbijzijndEind(w, null), null, 'zonder klikpunt geen gok');
  assert.equal(dichtstbijzijndEind(w, { x: NaN, y: 0 }), null);
});

// ── partner zoeken: samenvallend ──────────────────────────────────────────

test('L-hoek met samenvallende eindpunten: join, tenzij één van beide uiteinden hem uitzet', () => {
  const a = wand(0, 0, 100, 0);
  const b = wand(100, 0, 100, 100);
  const wanden = [a, b];
  const p = zoekJoinPartner(a, 'end', wanden, halfW);
  assert.equal(p.wall, b);
  assert.equal(p.eind, 'start');
  assert.equal(p.soort, 'samenvallend');
  assert.deepEqual(p.far, { x: 100, y: 100 });
  assert.equal(p.at, undefined, 'samenvallend: geen verlegd hoekpunt');

  a.noJoinEnd = true;
  assert.equal(zoekJoinPartner(a, 'end', wanden, halfW), null, 'eigen uiteinde uit');
  assert.equal(zoekJoinPartner(b, 'start', wanden, halfW), null, 'de partner verstekt dan ook niet');
  delete a.noJoinEnd;

  b.noJoinStart = true;
  assert.equal(zoekJoinPartner(a, 'end', wanden, halfW), null, 'partner-uiteinde uit');
  assert.equal(zoekJoinPartner(b, 'start', wanden, halfW), null);
});

test('per uiteinde: join uit aan het eind laat het begin gewoon joinen', () => {
  const c = wand(0, 100, 0, 0);          // eindigt in (0,0)
  const a = wand(0, 0, 100, 0);          // begint in (0,0), eindigt in (100,0)
  const b = wand(100, 0, 100, 100);      // begint in (100,0)
  a.noJoinEnd = true;
  const wanden = [a, b, c];
  assert.equal(zoekJoinPartner(a, 'start', wanden, halfW)?.wall, c);
  assert.equal(zoekJoinPartner(a, 'end', wanden, halfW), null);
  assert.equal(zoekJoinPartner(b, 'start', wanden, halfW), null);
});

test('eindpunten binnen de tolerantie tellen als samenvallend', () => {
  const a = wand(0, 0, 100, 0);
  const b = wand(100 + JOIN_TOL * 0.9, 0, 100, 100);
  assert.equal(zoekJoinPartner(a, 'end', [a, b], halfW)?.soort, 'samenvallend');
});

test('bij meerdere samenvallende wanden wint dezelfde laag', () => {
  const a = wand(0, 0, 100, 0, { hatchPattern: KZS });
  const beton = wand(100, 0, 100, -100, { hatchPattern: 'nen47-beton-gewapend' });
  const kzs = wand(100, 0, 100, 100, { hatchPattern: KZS });
  assert.equal(zoekJoinPartner(a, 'end', [a, beton, kzs], halfW).wall, kzs);
  assert.equal(zoekJoinPartner(a, 'end', [a, kzs, beton], halfW).wall, kzs);
});

// ── partner zoeken: kruisende hoek ────────────────────────────────────────

test('kruisende hoek (einden passeren elkaar): alleen binnen dezelfde laag', () => {
  // a loopt tot x=130, b begint bij y=-20: de hartlijnen snijden in (100,0).
  const a = wand(0, 0, 130, 0, { hatchPattern: MET });
  const b = wand(100, -20, 100, 300, { hatchPattern: MET });
  const p = zoekJoinPartner(a, 'end', [a, b], halfW);
  assert.equal(p?.wall, b);
  assert.equal(p.soort, 'kruisend');
  assert.equal(p.eind, 'start');
  assert.deepEqual(rond(p.at), { x: 100, y: 0 });

  b.hatchPattern = ISO;
  assert.equal(zoekJoinPartner(a, 'end', [a, b], halfW), null, 'ander materiaal: geen join');
  b.hatchPattern = MET;
  b.noJoinStart = true;
  assert.equal(zoekJoinPartner(a, 'end', [a, b], halfW), null, 'partner-uiteinde uit');
});

test('de demo: twee gevels uit losse lagen sluiten per laag, geen laag steekt door een andere', () => {
  // Pakket van buiten naar binnen: metselwerk 100 (hart 50), spouw 40 (geen
  // wand), isolatie 100 (hart 190), kalkzandsteen 120 (hart 300). Beide
  // gevels zijn tot de BUITENHOEK (0,0) getekend.
  const lagen = [
    { mat: MET, dikte: 100, hart: 50 },
    { mat: ISO, dikte: 100, hart: 190 },
    { mat: KZS, dikte: 120, hart: 300 },
  ];
  const noord = lagen.map((l) => wand(0, l.hart, 5000, l.hart, { hatchPattern: l.mat, dikteMm: l.dikte, id: `n-${l.mat}` }));
  const west = lagen.map((l) => wand(l.hart, 0, l.hart, 5000, { hatchPattern: l.mat, dikteMm: l.dikte, id: `w-${l.mat}` }));
  const alle = [...noord, ...west];
  lagen.forEach((l, i) => {
    const p = zoekJoinPartner(noord[i], 'start', alle, halfW);
    assert.ok(p, `${l.mat}: vindt een partner`);
    assert.equal(p.wall, west[i], `${l.mat}: sluit op dezelfde laag van de andere gevel`);
    assert.deepEqual(rond(p.at), { x: l.hart, y: l.hart }, `${l.mat}: hoekpunt op de eigen laaghartlijnen`);
    const terug = zoekJoinPartner(west[i], 'start', alle, halfW);
    assert.equal(terug.wall, noord[i], `${l.mat}: wederzijds`);
  });

  // Ter vergelijking de oude regel (elke wand, reikwijdte 4x): de isolatie
  // koos het metselwerk van de andere gevel — dat was de fout.
  const iso = noord[1];
  const oud = west
    .map((o) => ({ o, k: kruisendeHoek({ x: iso.startX, y: iso.startY }, { x: iso.endX, y: iso.endY },
      { x: o.startX, y: o.startY }, { x: o.endX, y: o.endY }, halfW(iso), halfW(o)) }))
    .filter((r) => r.k)
    .sort((a, b) => a.k.score - b.k.score)[0];
  assert.equal(oud.o.hatchPattern, MET, 'oude regel: isolatie op metselwerk');
});

test('ook tot de BINNENHOEK getekende lagen sluiten per laag', () => {
  // Binnenhoek (360,360); de lagen lopen vanaf daar naar buiten weg.
  const lagen = [
    { mat: MET, dikte: 100, hart: 50 },
    { mat: ISO, dikte: 100, hart: 190 },
    { mat: KZS, dikte: 120, hart: 300 },
  ];
  const noord = lagen.map((l) => wand(360, l.hart, 5000, l.hart, { hatchPattern: l.mat, dikteMm: l.dikte }));
  const west = lagen.map((l) => wand(l.hart, 360, l.hart, 5000, { hatchPattern: l.mat, dikteMm: l.dikte }));
  const alle = [...noord, ...west];
  lagen.forEach((l, i) => {
    const p = zoekJoinPartner(noord[i], 'start', alle, halfW);
    assert.equal(p?.wall, west[i], `${l.mat}`);
    assert.deepEqual(rond(p.at), { x: l.hart, y: l.hart });
  });
});

test('een losse wand snijdt niet in een hoek die al met samenvallende eindpunten dicht is', () => {
  // Binnenblad-hoek: twee kalkzandsteenwanden 120 met samenvallende
  // eindpunten in (300,300). Een binnenwand van kalkzandsteen stopt 400 mm
  // verderop tegen het binnenblad (T-aansluiting vlak bij de hoek).
  const a = wand(300, 300, 5000, 300, { hatchPattern: KZS, dikteMm: 120 });
  const b = wand(300, 300, 300, 5000, { hatchPattern: KZS, dikteMm: 120 });
  const binnen = wand(700, 360, 700, 3000, { hatchPattern: KZS, dikteMm: 100 });
  const alle = [a, b, binnen];
  assert.equal(zoekJoinPartner(binnen, 'start', alle, halfW), null);
  assert.equal(zoekJoinPartner(a, 'start', alle, halfW).wall, b, 'de hoek zelf blijft verstekt');
});

test('een kruising midden op een wand is geen hoek, ook niet binnen de laag', () => {
  const a = wand(0, 0, 130, 0);
  const b = wand(100, -2000, 100, 2000);
  assert.equal(zoekJoinPartner(a, 'end', [a, b], halfW), null);
});

test('de reikwijdte binnen de laag is ruimer dan de oude 4x maar niet onbegrensd', () => {
  assert.ok(LAAG_REIK_FACTOR > 4);
  const h = 50;
  const reik = LAAG_REIK_FACTOR * h;
  const binnen = wand(0, 0, 1000, 0);
  const net = wand(reik - 1, reik - 1, reik - 1, 3000);   // eigen uiteinde net binnen bereik
  assert.ok(zoekJoinPartner(net, 'start', [binnen, net], halfW), 'net binnen bereik');
  const buiten = wand(0, 0, 1000, 0);
  const ver = wand(reik + 1, reik + 1, reik + 1, 3000);
  assert.equal(zoekJoinPartner(ver, 'start', [buiten, ver], halfW), null, 'net buiten bereik');
});

test('hoek-trim geeft door welk uiteinde van het andere element bij de hoek ligt', () => {
  const k = kruisendeHoek({ x: 130, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: -40 }, 10, 10);
  assert.equal(k.eind, 'end');
  const k2 = kruisendeHoek({ x: 130, y: 0 }, { x: 0, y: 0 }, { x: 100, y: -40 }, { x: 100, y: 100 }, 10, 10);
  assert.equal(k2.eind, 'start');
  // Een grotere reikfactor vangt een verder weg liggende hoek.
  assert.equal(kruisendeHoek({ x: 200, y: 0 }, { x: 0, y: 0 }, { x: 100, y: -40 }, { x: 100, y: 100 }, 10, 10), null);
  assert.ok(kruisendeHoek({ x: 200, y: 0 }, { x: 0, y: 0 }, { x: 100, y: -40 }, { x: 100, y: 100 }, 10, 10, { reikFactor: 12 }));
});

// ── hoek trimmen ──────────────────────────────────────────────────────────

test('hoek trimmen met twee wanden: beide dichtstbijzijnde uiteinden naar het snijpunt, ook bij ander materiaal', () => {
  const a = wand(0, 0, 130, 0, { hatchPattern: MET });
  const b = wand(100, 60, 100, 500, { hatchPattern: 'nen47-beton-gewapend' });
  const plan = hoekTrimPlan([a, b], halfW);
  assert.deepEqual(plan.map((z) => ({ id: z.id, eind: z.eind, ...rond(z) })), [
    { id: a.id, eind: 'end', x: 100, y: 0 },
    { id: b.id, eind: 'start', x: 100, y: 0 },
  ]);
});

test('hoek trimmen met het hele pakket geselecteerd: per laag een hoek, nooit tussen lagen', () => {
  const lagen = [
    { mat: MET, dikte: 100, hart: 50 },
    { mat: ISO, dikte: 100, hart: 190 },
    { mat: KZS, dikte: 120, hart: 300 },
  ];
  const noord = lagen.map((l) => wand(0, l.hart, 5000, l.hart, { hatchPattern: l.mat, dikteMm: l.dikte }));
  const west = lagen.map((l) => wand(l.hart, 0, l.hart, 5000, { hatchPattern: l.mat, dikteMm: l.dikte }));
  const plan = hoekTrimPlan([...noord, ...west], halfW);
  assert.equal(plan.length, 6, 'drie hoeken, twee uiteinden per hoek');
  lagen.forEach((l, i) => {
    for (const w of [noord[i], west[i]]) {
      const z = plan.find((p) => p.id === w.id);
      assert.equal(z.eind, 'start');
      assert.deepEqual(rond(z), { x: l.hart, y: l.hart }, `${l.mat}`);
    }
  });
});

test('hoek trimmen slaat evenwijdige wanden en te ver weg liggende paren over', () => {
  const a = wand(0, 0, 1000, 0), b = wand(0, 200, 1000, 200);
  assert.deepEqual(hoekTrimPlan([a, b], halfW), [], 'evenwijdig');
  // Drie wanden (dus binnen de laag): een loodrechte wand ver weg telt niet.
  const c = wand(5000, 3000, 5000, 9000);
  assert.deepEqual(hoekTrimPlan([a, b, c], halfW), []);
});

test('hoek trimmen verlengt ook, en verschuift altijd het uiteinde bij het snijpunt', () => {
  // Het snijpunt ligt vóór het begin van a: het begin schuift erheen (a wordt
  // langer); het verre uiteinde blijft staan, dus a klapt nooit om.
  const a = wand(0, 0, 100, 0);
  const b = wand(-50, -100, -50, 100);
  const plan = hoekTrimPlan([a, b], halfW);
  const za = plan.find((z) => z.id === a.id);
  assert.equal(za?.eind, 'start', 'het dichtstbijzijnde uiteinde verschuift, niet het verre');
  assert.deepEqual(rond(za), { x: -50, y: 0 });
});

test('een gesloten ring van vier gevels (zelfde laag) krijgt vier hoeken', () => {
  const n = wand(0, 0, 1000, 0), o = wand(990, -20, 990, 800);
  const z = wand(1010, 790, -10, 790), w = wand(5, 810, 5, 10);
  const plan = hoekTrimPlan([n, o, z, w], halfW);
  assert.equal(plan.length, 8);
  const sleutels = new Set(plan.map((p) => `${p.id}:${p.eind}`));
  assert.equal(sleutels.size, 8, 'elk uiteinde één keer');
});

test('pasTrimToe verplaatst het uiteinde en zet de join daar weer aan', () => {
  const a = wand(0, 0, 130, 0, { noJoinEnd: true, noJoinStart: true });
  pasTrimToe(a, [{ id: a.id, eind: 'end', x: 100, y: 0 }, { id: 'ander', eind: 'start', x: 5, y: 5 }]);
  assert.equal(a.endX, 100);
  assert.equal(a.endY, 0);
  assert.equal('noJoinEnd' in a, false, 'hoek trimmen = een nette hoek, dus join aan');
  assert.equal(a.noJoinStart, true, 'het andere uiteinde blijft zoals het was');
  assert.equal(a.startX, 0);
});

// ── teksten ───────────────────────────────────────────────────────────────

test('rechtsklikmenu en eigenschappenpaneel hebben hun teksten in het Engels en het Nederlands', async () => {
  const { readFileSync } = await import('node:fs');
  const lees = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');
  for (const taal of ['en', 'nl']) {
    const ctx = JSON.parse(lees(`../i18n/locales/${taal}/context.json`));
    const eig = JSON.parse(lees(`../i18n/locales/${taal}/properties.json`));
    for (const [waar, tekst] of [
      ['annotation.wallJoinAllow', ctx.annotation?.wallJoinAllow],
      ['annotation.wallJoinDisallow', ctx.annotation?.wallJoinDisallow],
      ['multiSelect.trimWallCorners', ctx.multiSelect?.trimWallCorners],
      ['wall.joinAtStart', eig.wall?.joinAtStart],
      ['wall.joinAtEnd', eig.wall?.joinAtEnd],
      ['wall.joinHint', eig.wall?.joinHint],
    ]) {
      assert.equal(typeof tekst, 'string', `${taal}: ${waar}`);
      assert.ok(tekst.trim(), `${taal}: ${waar} leeg`);
    }
  }
  const menu = lees('../solid/components/ContextMenu.jsx');
  for (const k of ['annotation.wallJoinAllow', 'annotation.wallJoinDisallow', 'multiSelect.trimWallCorners']) {
    assert.ok(menu.includes(`t('${k}')`), `ContextMenu gebruikt ${k}`);
  }
  const paneel = lees('../solid/components/properties-panel/WallSection.jsx');
  for (const k of ['wall.joinAtStart', 'wall.joinAtEnd', 'wall.joinHint']) {
    assert.ok(paneel.includes(`t('${k}')`), `WallSection gebruikt ${k}`);
  }
});
