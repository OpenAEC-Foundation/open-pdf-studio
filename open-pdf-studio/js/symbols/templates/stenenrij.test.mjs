// Stenenrij: steenmaten, voeg en aantal bepalen de rij; lagen verticaal,
// koppen en strekken horizontaal. Oudere symbolen met een vaste lagen- of
// koppenmaat en een totale maat blijven ongewijzigd renderen.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { stenenrijTemplate as tpl, layoutStenenrijMm } from './stenenrij.js';
import { assertBinnenBbox } from './binnen-bbox.testhulp.mjs';

const near = (a, b, msg) => assert.ok(Math.abs(a - b) <= 1e-9, `${msg}: ${a} != ${b}`);
const standaard = () => Object.fromEntries(tpl.params.map((p) => [p.key, p.default]));
const param = (key) => tpl.params.find((p) => p.key === key);

function rechthoek(cmd) {
  const xs = cmd.points.map((q) => q.x);
  const ys = cmd.points.map((q) => q.y);
  const lw = cmd.lineWidth;
  return {
    x: Math.min(...xs) - lw / 2,
    y: Math.min(...ys) - lw / 2,
    width: Math.max(...xs) - Math.min(...xs) + lw,
    height: Math.max(...ys) - Math.min(...ys) + lw,
  };
}

test('params: steenmaten, voeg, aantal en drie richtingen', () => {
  const keys = tpl.params.map((p) => p.key);
  for (const key of ['maatType', 'totaleMaat', 'voeg', 'steenbreedte']) {
    assert.ok(keys.includes(key), `bestaande param ${key} blijft`);
  }
  assert.equal(param('steenLengte').default, 210);
  assert.equal(param('steenbreedte').default, 100);
  assert.equal(param('steenHoogte').default, 50);
  assert.equal(param('voeg').default, 10);
  assert.ok(param('aantal').default > 0);
  assert.equal(param('maatType').default, 'lagenmaat');
  assert.deepEqual(param('maatType').options.map((o) => o.value), ['lagenmaat', 'koppenmaat', 'strekkenmaat']);
});

test('lagen: verticale rij, lagenmaat = steenhoogte + voeg', () => {
  const p = { maatType: 'lagenmaat', steenLengte: 210, steenbreedte: 100, steenHoogte: 50, voeg: 10, aantal: 10 };
  const L = layoutStenenrijMm(p);
  assert.equal(L.orientation, 'vertical');
  near(L.module, 60, 'lagenmaat');
  near(L.lagenmaat, 60, 'lagenmaat-veld');
  assert.equal(L.stones.length, 10);
  assert.ok(L.stones.every((s) => Math.abs(s.length - 50) < 1e-9), 'elke laag is een steenhoogte');
  near(L.stones[3].offset, 180, 'vierde laag begint op 3 x 60');
  assert.deepEqual(tpl.realSizeMm(p), { width: 100, height: 600 });
});

test('koppen: horizontale rij, koppenmaat = steenbreedte + voeg', () => {
  const p = { maatType: 'koppenmaat', steenLengte: 210, steenbreedte: 100, steenHoogte: 50, voeg: 10, aantal: 5 };
  const L = layoutStenenrijMm(p);
  assert.equal(L.orientation, 'horizontal');
  near(L.module, 110, 'koppenmaat');
  near(L.koppenmaat, 110, 'koppenmaat-veld');
  assert.equal(L.stones.length, 5);
  assert.ok(L.stones.every((s) => Math.abs(s.length - 100) < 1e-9), 'elke kop is een steenbreedte');
  assert.deepEqual(tpl.realSizeMm(p), { width: 550, height: 50 });
});

test('strekken: horizontale rij, strek = steenlengte + voeg', () => {
  const p = { maatType: 'strekkenmaat', steenLengte: 210, steenbreedte: 100, steenHoogte: 50, voeg: 10, aantal: 4 };
  const L = layoutStenenrijMm(p);
  assert.equal(L.orientation, 'horizontal');
  near(L.module, 220, 'strekkenmaat');
  near(L.strekkenmaat, 220, 'strekkenmaat-veld');
  assert.equal(L.stones.length, 4);
  assert.ok(L.stones.every((s) => Math.abs(s.length - 210) < 1e-9), 'elke strek is een steenlengte');
  assert.deepEqual(tpl.realSizeMm(p), { width: 880, height: 50 });
});

test('afwijkende steenmaten en voeg werken door in de maat', () => {
  const basis = { steenLengte: 240, steenbreedte: 115, steenHoogte: 71, voeg: 12, aantal: 3 };
  assert.deepEqual(tpl.realSizeMm({ ...basis, maatType: 'lagenmaat' }), { width: 115, height: 249 });
  assert.deepEqual(tpl.realSizeMm({ ...basis, maatType: 'koppenmaat' }), { width: 381, height: 71 });
  assert.deepEqual(tpl.realSizeMm({ ...basis, maatType: 'strekkenmaat' }), { width: 756, height: 71 });
});

test('richting (lagen, koppen, strekken) werkt als keuze naast maatType', () => {
  const basis = { steenLengte: 210, steenbreedte: 100, steenHoogte: 50, voeg: 10, aantal: 4 };
  for (const [richting, maatType] of [['lagen', 'lagenmaat'], ['koppen', 'koppenmaat'], ['strekken', 'strekkenmaat']]) {
    const viaRichting = layoutStenenrijMm({ ...basis, richting });
    const viaMaatType = layoutStenenrijMm({ ...basis, maatType });
    assert.equal(viaRichting.richting, richting);
    assert.equal(viaRichting.maatType, maatType);
    assert.deepEqual(viaRichting, viaMaatType);
  }
  // Een geldige richting gaat voor een afwijkend maatType.
  assert.equal(layoutStenenrijMm({ ...basis, maatType: 'lagenmaat', richting: 'strekken' }).orientation, 'horizontal');
});

test('standaardwaarden: 16 lagen van 60 mm', () => {
  const p = standaard();
  const L = layoutStenenrijMm(p);
  assert.equal(L.valid, true);
  assert.equal(p.aantal, 16);
  assert.equal(L.stones.length, 16);
  assert.deepEqual(tpl.realSizeMm(p), { width: 100, height: 960 });
  // Zonder params gelden dezelfde standaardwaarden.
  assert.deepEqual(tpl.realSizeMm({}), tpl.realSizeMm(p));
  assert.deepEqual(tpl.realSizeMm(), tpl.realSizeMm(p));
});

test('aantal 0: de totale maat bepaalt de rij, de laatste steen wordt afgeknipt', () => {
  const p = { maatType: 'strekkenmaat', steenLengte: 210, steenHoogte: 50, voeg: 10, aantal: 0, totaleMaat: 500 };
  const L = layoutStenenrijMm(p);
  assert.equal(L.stones.length, 3);
  near(L.stones.at(-1).length, 60, 'afgeknipte laatste strek');
  assert.deepEqual(tpl.realSizeMm(p), { width: 500, height: 50 });
  // Ongeldig aantal valt terug op de totale maat; een gebroken aantal wordt afgerond.
  assert.equal(layoutStenenrijMm({ ...p, aantal: -3 }).totaleMaat, 500);
  assert.equal(layoutStenenrijMm({ ...p, aantal: 'x' }).totaleMaat, 500);
  assert.equal(layoutStenenrijMm({ ...p, aantal: 2.6 }).stones.length, 3);
  assert.equal(layoutStenenrijMm({ ...p, aantal: 2.6 }).totaleMaat, 660);
});

test('oud symbool (vaste lagen-/koppenmaat en totale maat) rendert ongewijzigd', () => {
  const lagen = { maatType: 'lagenmaat', totaleMaat: 440, lagenmaat: 100, koppenmaat: 110, voeg: 10, steenbreedte: 100 };
  const L = layoutStenenrijMm(lagen);
  assert.equal(L.orientation, 'vertical');
  assert.equal(L.stones.length, 5);
  near(L.stones[0].length, 90, 'steenhoogte = lagenmaat - voeg');
  near(L.stones.at(-1).length, 40, 'laatste laag afgeknipt');
  assert.deepEqual(tpl.realSizeMm(lagen), { width: 100, height: 440 });

  const koppen = { maatType: 'koppenmaat', totaleMaat: 350, lagenmaat: 62.5, koppenmaat: 120, voeg: 10, steenbreedte: 100 };
  const K = layoutStenenrijMm(koppen);
  assert.equal(K.orientation, 'horizontal');
  assert.equal(K.stones.length, 3);
  near(K.stones[0].length, 110, 'kopbreedte = koppenmaat - voeg');
  assert.deepEqual(tpl.realSizeMm(koppen), { width: 350, height: 100 });

  // Een voeg die de vaste modulemaat opvult blijft ongeldig en tekent niets.
  const ongeldig = { ...lagen, voeg: 100 };
  assert.equal(layoutStenenrijMm(ongeldig).valid, false);
  assert.deepEqual(tpl.render(ongeldig, { x: 0, y: 0, width: 100, height: 440 }), []);
});

test('render: een gesloten rechthoek per steen, op schaal en binnen de bbox', () => {
  const k = 0.5;
  for (const maatType of ['lagenmaat', 'koppenmaat', 'strekkenmaat']) {
    const p = { maatType, steenLengte: 210, steenbreedte: 100, steenHoogte: 50, voeg: 10, aantal: 6 };
    const L = layoutStenenrijMm(p);
    const mm = tpl.realSizeMm(p);
    const bbox = { x: 13, y: 7, width: mm.width * k, height: mm.height * k };
    const cmds = tpl.render(p, bbox);
    assert.equal(cmds.length, 6, maatType);
    assert.ok(cmds.every((c) => c.kind === 'polyline' && c.close && c.role === 'steen'));
    assertBinnenBbox(cmds, bbox, maatType);
    const eerste = rechthoek(cmds[0]);
    const tweede = rechthoek(cmds[1]);
    if (L.orientation === 'vertical') {
      near(eerste.height, 50 * k, 'laaghoogte op schaal');
      near(eerste.width, 100 * k, 'laagbreedte op schaal');
      // Opbouw vanaf de onderzijde: de eerste laag ligt onderaan.
      near(eerste.y + eerste.height, bbox.y + bbox.height, 'eerste laag onderaan');
      near(eerste.y - tweede.y, 60 * k, 'hart-op-hart = lagenmaat');
    } else {
      near(eerste.width, L.body * k, 'steenlengte in de rij op schaal');
      near(eerste.height, 50 * k, 'steenhoogte op schaal');
      near(eerste.x, bbox.x, 'rij begint links');
      near(tweede.x - eerste.x, L.module * k, 'hart-op-hart = modulemaat');
    }
  }
});

test('grote aantallen schakelen naar een begrensde weergave', () => {
  const p = { maatType: 'lagenmaat', steenHoogte: 50, voeg: 10, aantal: 5000 };
  const L = layoutStenenrijMm(p);
  assert.equal(L.stoneCount, 5000);
  assert.equal(L.lod, true);
  assert.ok(tpl.render(p, { x: 0, y: 0, width: 10, height: 3000 }).length <= 260);
});
