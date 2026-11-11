// Parametrische bout / moer: maten per maat (M6–M24), werkelijke maat per
// aanzicht, getekende omvang = realSizeMm, snappunten en de tekenwijze
// (drie zeskantvlakken, afschuinkrommen, draad volgens ISO 6410), en de
// moer met ring op het draadeind (klemlengte, draadlengte, begrenzing).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  boutTemplate, BOUT_MATEN, zeskantHoekmaat, kernDiameter, draadLengte,
} from './bout.js';
import { puntenVan, assertBinnenBbox } from './binnen-bbox.testhulp.mjs';

const MATEN = ['M6', 'M8', 'M10', 'M12', 'M16', 'M20', 'M22', 'M24'];
const AANZICHTEN = ['bout', 'doorsteek', 'plattegrond', 'moer-boven', 'zeskant'];
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} != ${b}`);

function omvang(cmds) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of cmds) {
    for (const [x, y] of puntenVan(c)) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

test('parameters en standaardwaarden', () => {
  const p = Object.fromEntries(boutTemplate.params.map((q) => [q.key, q.default]));
  assert.deepEqual(p, {
    maat: 'M12', aanzicht: 'bout', ringPlattegrond: true, lengte: 120,
    moer: true, ring: true, klemlengte: 0, draadlengte: 0, schaal: 1,
  });
  const soort = Object.fromEntries(boutTemplate.params.map((q) => [q.key, q.type]));
  assert.equal(soort.moer, 'boolean');
  assert.equal(soort.ring, 'boolean');
  assert.equal(soort.klemlengte, 'number');
  assert.equal(soort.draadlengte, 'number');
  assert.deepEqual(boutTemplate.params[0].options, MATEN);
  const views = boutTemplate.params[1].options.map((o) => o.value);
  assert.deepEqual(views, AANZICHTEN);
});

test('BOUT_MATEN: zeskant-, moer-, spoed- en ringmaten (ISO 7089)', () => {
  assert.deepEqual(Object.keys(BOUT_MATEN), MATEN);
  const ring = { M6: [12, 1.6], M8: [16, 1.6], M10: [20, 2], M12: [24, 2.5], M16: [30, 3], M20: [37, 3], M22: [39, 3], M24: [44, 4] };
  for (const naam of MATEN) {
    const g = BOUT_MATEN[naam];
    assert.equal(g.d, Number(naam.slice(1)), naam);
    assert.ok(g.s > g.d && g.k > 0.5 * g.d && g.m > 0.7 * g.d, `${naam} kop/moer plausibel`);
    assert.deepEqual([g.ringD, g.ringT], ring[naam], `${naam} ring`);
    assert.ok(g.P > 0 && kernDiameter(g) < g.d && kernDiameter(g) > 0.75 * g.d, `${naam} kerndiameter`);
  }
  near(kernDiameter(BOUT_MATEN.M12), 12 - 1.22687 * 1.75, 1e-9, 'd3 M12');
  near(zeskantHoekmaat(19), 19 / Math.cos(Math.PI / 6), 1e-12, 'e = s / cos 30°');
});

test('draadlengte volgens ISO 4014, korte bouten volledig van draad', () => {
  const g = BOUT_MATEN.M12;
  assert.equal(draadLengte(g, 100), 30);
  assert.equal(draadLengte(g, 150), 36);
  assert.equal(draadLengte(g, 250), 49);
  assert.equal(draadLengte(g, 33), 33, 'schacht < d/2 → volledig draad');
});

test('realSizeMm per aanzicht en maat', () => {
  for (const maat of MATEN) {
    const g = BOUT_MATEN[maat];
    const e = zeskantHoekmaat(g.s);
    const hZij = Math.max(e, g.ringD);
    const r = (aanzicht, extra = {}) => boutTemplate.realSizeMm({ maat, aanzicht, lengte: 80, schaal: 1, ...extra });
    assert.deepEqual(r('bout'), { width: g.k + g.ringT + 80, height: hZij }, `${maat} bout`);
    const ds = r('doorsteek');
    near(ds.width, g.k + 2 * g.ringT + 80 + g.m + 0.6 * g.d, 1e-9, `${maat} doorsteek breedte`);
    assert.equal(ds.height, hZij);
    assert.deepEqual(r('moer-boven'), { width: e, height: e });
    assert.deepEqual(r('zeskant'), { width: e, height: e });
    assert.deepEqual(r('plattegrond', { ringPlattegrond: false }), { width: e, height: e });
    const met = r('plattegrond', { ringPlattegrond: true });
    assert.equal(met.width, Math.max(e, g.ringD));
    assert.equal(met.height, met.width);
    const half = r('bout', { schaal: 0.5 });
    near(half.width, (g.k + g.ringT + 80) / 2, 1e-9, `${maat} schaal`);
  }
  // Onbekende maat/lengte vallen terug op M12 en 10·d.
  assert.deepEqual(boutTemplate.realSizeMm({ maat: 'M99', lengte: 'x' }),
    boutTemplate.realSizeMm({ maat: 'M12', lengte: 120 }));
});

test('getekende omvang = realSizeMm en alles binnen de bbox', () => {
  for (const maat of MATEN) {
    for (const aanzicht of AANZICHTEN) {
      for (const ringPlattegrond of [true, false]) {
        // De moer-opties wisselen mee: de omvang hangt er niet van af.
        const p = { maat, aanzicht, lengte: 60, ringPlattegrond, moer: ringPlattegrond, ring: maat !== 'M10', schaal: 1 };
        const mm = boutTemplate.realSizeMm(p);
        const k = 3;
        const bbox = { x: 7, y: 11, width: mm.width * k, height: mm.height * k };
        const cmds = boutTemplate.render(p, bbox);
        assertBinnenBbox(cmds, bbox, `${maat} ${aanzicht}`);
        const o = omvang(cmds);
        const tol = 1e-6 * k * 100;
        near(o.x, bbox.x, tol, `${maat} ${aanzicht} links`);
        near(o.width, bbox.width, tol, `${maat} ${aanzicht} breedte`);
        // Een bovenaanzicht ligt met de hoeken links/rechts: verticaal is
        // het zeskant s hoog (platte kanten), de ring kan hoger zijn.
        const g = BOUT_MATEN[maat];
        const boven = ['plattegrond', 'moer-boven', 'zeskant'].includes(aanzicht);
        const metRing = aanzicht === 'plattegrond' && ringPlattegrond;
        const h = boven ? Math.max(g.s, metRing ? g.ringD : 0) * k : bbox.height;
        near(o.y, bbox.y + (bbox.height - h) / 2, tol, `${maat} ${aanzicht} boven`);
        near(o.height, h, tol, `${maat} ${aanzicht} hoogte`);
      }
    }
  }
});

test('zijaanzicht: drie zeskantvlakken, afschuinkrommen, ring, draad en punt', () => {
  const g = BOUT_MATEN.M12;
  const e = zeskantHoekmaat(g.s);
  const p = { maat: 'M12', aanzicht: 'bout', lengte: 120, moer: false, schaal: 1 };
  const mm = boutTemplate.realSizeMm(p);
  const cmds = boutTemplate.render(p, { x: 0, y: 0, width: mm.width, height: mm.height });
  assert.ok(!cmds.some((c) => c.role === 'moer'), 'moer uit: alleen de bout');
  assert.equal(cmds.filter((c) => c.role === 'ring').length, 1, 'alleen de ring onder de kop');
  const yMid = mm.height / 2;
  const kop = cmds.find((c) => c.role === 'boutkop');
  assert.equal(kop.kind, 'polyline');
  assert.ok(kop.close);
  const ys = kop.points.map((q) => q.y);
  near(Math.max(...ys) - Math.min(...ys), e, 1e-9, 'kop over de hoeken');
  const detail = cmds.filter((c) => c.role === 'boutkop-detail');
  const facet = detail.filter((c) => c.kind === 'line');
  assert.equal(facet.length, 2, 'twee vlaklijnen');
  assert.deepEqual(facet.map((c) => c.y1 - yMid).sort((a, b) => a - b).map((v) => +v.toFixed(9)),
    [-e / 4, e / 4].map((v) => +v.toFixed(9)), 'middenvlak = e/2');
  const krommen = detail.filter((c) => c.kind === 'polyline');
  assert.equal(krommen.length, 3, 'afschuinkromme per zichtbaar vlak');
  // Middenkromme raakt het kopvlak in het midden en wijkt bij de hoeken terug.
  const midden = krommen[0].points;
  near(midden[6].x, 0, 1e-9, 'kromme raakt het kopvlak');
  near(midden[0].x, ((e - g.s) / 2) * Math.tan(Math.PI / 6), 1e-9, 'terugwijking bij de hoek');
  assert.ok(detail.every((c) => c.lineWidthFactor > 0 && c.lineWidthFactor < 1));

  const ring = cmds.find((c) => c.role === 'ring');
  const rx = ring.points.map((q) => q.x), ry = ring.points.map((q) => q.y);
  near(Math.max(...rx) - Math.min(...rx), g.ringT, 1e-9, 'ringdikte');
  near(Math.max(...ry) - Math.min(...ry), g.ringD, 1e-9, 'ringdiameter');

  const draad = cmds.filter((c) => c.role === 'draad');
  assert.equal(draad.length, 2, 'twee dunne kernlijnen');
  assert.ok(draad.every((c) => !c.dash && c.lineWidthFactor === 0.5), 'dun en doorgetrokken');
  const b = draadLengte(g, mm.width - g.k);
  near(draad[0].x2 - draad[0].x1, b, 1e-9, 'draadlengte b = 2d + 6');
  near(Math.abs(draad[0].y1 - draad[1].y1), kernDiameter(g), 1e-9, 'kerndiameter');
  const eind = cmds.find((c) => c.role === 'draadeinde');
  near(eind.x1, mm.width - b, 1e-9, 'draadeinde-lijn');
  near(Math.abs(eind.y2 - eind.y1), g.d, 1e-9, 'draadeinde over de buitendiameter');
  const as = cmds.find((c) => c.role === 'hartlijn');
  assert.ok(Array.isArray(as.dash) && as.dash.length === 4, 'streep-punt hartlijn');

  // Korte bout: volledig draad, geen draadeinde-lijn.
  const kort = boutTemplate.render({ ...p, lengte: 20 }, { x: 0, y: 0, width: 100, height: 40 });
  assert.ok(!kort.some((c) => c.role === 'draadeinde'));
  assert.equal(kort.filter((c) => c.role === 'draad').length, 2);
});

// Zijaanzicht 1:1 in een bbox op de oorsprong: x = afstand langs de as (mm).
function zij(extra = {}) {
  const p = { maat: 'M12', aanzicht: 'bout', lengte: 120, schaal: 1, ...extra };
  const mm = boutTemplate.realSizeMm(p);
  const bbox = { x: 0, y: 0, width: mm.width, height: mm.height };
  const cmds = boutTemplate.render(p, bbox);
  const bereik = (c) => {
    const xs = puntenVan(c).map((q) => q[0]);
    return [Math.min(...xs), Math.max(...xs)];
  };
  const ringen = cmds.filter((c) => c.role === 'ring').map(bereik).sort((a, b) => a[0] - b[0]);
  const moer = cmds.filter((c) => c.role === 'moer').map(bereik)[0];
  return { p, mm, bbox, cmds, ringen, moer, snap: boutTemplate.snapPoints(p, bbox) };
}

test('standaard zijaanzicht: ring en moer op het draadeind, twee spoeden uitstekend', () => {
  const g = BOUT_MATEN.M12;
  const { mm, cmds, ringen, moer } = zij();
  const tip = mm.width;
  assert.equal(cmds.filter((c) => c.role === 'boutkop').length, 1);
  assert.equal(cmds.filter((c) => c.role === 'moer').length, 1, 'één moer');
  assert.equal(cmds.filter((c) => c.role === 'moer-detail' && c.kind === 'polyline').length, 6, 'moer aan beide zijden afgeschuind');
  assert.equal(ringen.length, 2, 'ring onder de kop en onder de moer');
  near(moer[1], tip - 2 * g.P, 1e-9, 'twee spoeden draad voorbij de moer');
  near(moer[1] - moer[0], g.m, 1e-9, 'moerhoogte');
  near(ringen[1][1], moer[0], 1e-9, 'ring sluit aan op de moer');
  near(ringen[1][1] - ringen[1][0], g.ringT, 1e-9, 'ringdikte');
  // De omvang verandert niet door de moer: ze zit op de bout zelf.
  assert.deepEqual(mm, boutTemplate.realSizeMm({ maat: 'M12', aanzicht: 'bout', lengte: 120, moer: false }));
  // Draad volgens ISO 6410: kernlijnen dun en doorgetrokken, in de klemlengte
  // en in het uitstekende eind; het draadeinde een dikke dwarslijn.
  const draad = cmds.filter((c) => c.role === 'draad');
  assert.equal(draad.length, 4);
  assert.ok(draad.every((c) => !c.dash && c.lineWidthFactor === 0.5));
  const b = draadLengte(g, tip - g.k);
  const eind = cmds.filter((c) => c.role === 'draadeinde');
  assert.equal(eind.length, 1);
  near(eind[0].x1, tip - b, 1e-9, 'draadeinde op de normlengte');
  assert.ok(!eind[0].lineWidthFactor || eind[0].lineWidthFactor >= 1, 'dikke lijn');
  near(Math.abs(eind[0].y2 - eind[0].y1), g.d, 1e-9, 'over de buitendiameter');
  assert.ok(eind[0].x1 < ringen[1][0], 'draadeinde zichtbaar vóór de ring');
  // Niets van de schacht loopt door de moer of de ring heen.
  for (const c of cmds.filter((q) => q.role === 'schacht' || q.role === 'draad')) {
    const xs = puntenVan(c).map((q) => q[0]);
    const a = Math.min(...xs), z = Math.max(...xs);
    assert.ok(z <= ringen[1][0] + 1e-9 || a >= moer[1] - 1e-9, `${c.role} ${a}..${z} door de moer`);
  }
});

test('ring onder de moer is een losse optie', () => {
  const g = BOUT_MATEN.M12;
  const { mm, ringen, moer } = zij({ ring: false });
  assert.equal(ringen.length, 1, 'alleen de ring onder de kop');
  near(moer[1], mm.width - 2 * g.P, 1e-9, 'moer blijft op het draadeind');
});

test('klemlengte bepaalt de plaats van de moer en is begrensd', () => {
  const g = BOUT_MATEN.M12;
  const onderRing = g.k + g.ringT;              // onderkant van de ring onder de kop
  const b = draadLengte(g, 120 + g.ringT);      // 30
  const vrij = zij({ klemlengte: 100 });
  near(vrij.ringen[1][0] - onderRing, 100, 1e-9, 'klemlengte = onderkant kop-ring tot bovenkant moer-ring');
  near(vrij.moer[0], onderRing + 100 + g.ringT, 1e-9, 'moer achter de ring');
  // Te groot: de moer blijft binnen het bouteinde.
  const ver = zij({ klemlengte: 500 });
  near(ver.moer[1], ver.mm.width, 1e-9, 'moer niet voorbij het bouteinde');
  // Te klein: de moer komt niet op het gladde deel van de schacht.
  const kort = zij({ klemlengte: 5 });
  near(kort.moer[0], kort.mm.width - b, 1e-9, 'moer begint op het draadeinde');
  // Zonder ring geldt dezelfde begrenzing.
  const kaal = zij({ klemlengte: 5, ring: false });
  near(kaal.moer[0], kaal.mm.width - b, 1e-9, 'zonder ring');
  // Standaard (0 of leeg) = twee spoeden uitstekend.
  for (const klemlengte of [0, '', undefined, 'x', -4]) {
    const s = zij({ klemlengte });
    near(s.moer[1], s.mm.width - 2 * g.P, 1e-9, `auto bij ${klemlengte}`);
  }
  // Alle maten en lengtes: de moer ligt binnen de bout en, als de draad lang
  // genoeg is voor de moer, geheel op de draad.
  for (const maat of MATEN) {
    for (const lengte of [40, 60, 120, 300]) {
      for (const klemlengte of [0, 1, 30, 1000]) {
        for (const draadlengte of [0, 25, 1000]) {
          const s = zij({ maat, lengte, klemlengte, draadlengte });
          const naam = `${maat} l=${lengte} klem=${klemlengte} draad=${draadlengte}`;
          const gm = BOUT_MATEN[maat];
          assertBinnenBbox(s.cmds, s.bbox, naam);
          assert.ok(s.moer[1] <= s.mm.width + 1e-9, `${naam}: moer voorbij het bouteinde`);
          assert.ok(s.moer[0] >= gm.k + gm.ringT - 1e-9, `${naam}: moer in de kop`);
          const eind = s.cmds.find((c) => c.role === 'draadeinde');
          if (eind && (draadlengte !== 25 || gm.m <= 25)) {
            assert.ok(s.moer[0] >= eind.x1 - 1e-9, `${naam}: moer op het gladde deel`);
          }
        }
      }
    }
  }
});

test('een bout die te kort is voor de moer wordt zonder moer getekend', () => {
  const s = zij({ maat: 'M24', lengte: 15 });
  assert.equal(s.moer, undefined);
  assert.equal(s.ringen.length, 1);
  assertBinnenBbox(s.cmds, s.bbox, 'M24 kort');
  assert.ok(!s.snap.some((q) => q.role === 'moer'));
});

test('draadlengte: eigen waarde, 0 of leeg = normwaarde, begrensd tot de boutlengte', () => {
  const g = BOUT_MATEN.M12;
  const draadVanaf = (extra) => {
    const s = zij({ moer: false, ...extra });
    const eind = s.cmds.find((c) => c.role === 'draadeinde');
    return eind ? s.mm.width - eind.x1 : null;
  };
  near(draadVanaf({ draadlengte: 60 }), 60, 1e-9, 'eigen draadlengte');
  for (const draadlengte of [0, '', undefined, 'x', -10]) {
    near(draadVanaf({ draadlengte }), draadLengte(g, 120 + g.ringT), 1e-9, `norm bij ${draadlengte}`);
  }
  // Langer dan de bout: draad over de hele schacht, geen draadeinde-lijn.
  const vol = zij({ moer: false, draadlengte: 500 });
  assert.equal(draadVanaf({ draadlengte: 500 }), null);
  const kern = vol.cmds.filter((c) => c.role === 'draad');
  assert.equal(kern.length, 2);
  near(kern[0].x1, g.k + g.ringT, 1e-9, 'draad vanaf de ring onder de kop');
  near(kern[0].x2, vol.mm.width, 1e-9, 'tot het bouteinde');
  // Ook in het doorsteek-aanzicht.
  const ds = zij({ aanzicht: 'doorsteek', draadlengte: 80 });
  near(ds.mm.width - ds.cmds.find((c) => c.role === 'draadeinde').x1, 80, 1e-9, 'doorsteek');
});

test('doorsteek: zelfde beeld als voorheen, de moer-opties gelden daar niet', () => {
  const g = BOUT_MATEN.M20;
  const basis = { maat: 'M20', aanzicht: 'doorsteek', lengte: 150 };
  const oud = zij(basis);
  const onderRing = g.k + g.ringT;
  near(oud.ringen[1][0], onderRing + 150, 1e-9, 'klemlengte = lengte');
  near(oud.moer[0], onderRing + 150 + g.ringT, 1e-9, 'moer');
  near(oud.mm.width - oud.moer[1], 0.6 * g.d, 1e-9, 'uitstekend draadeind 0,6·d');
  const tip = oud.mm.width;
  near(oud.cmds.find((c) => c.role === 'draadeinde').x1, tip - draadLengte(g, tip - g.k), 1e-9, 'draadeinde');
  // Opgeslagen symbolen kennen de nieuwe params niet; uitzetten verandert niets.
  const uit = zij({ ...basis, moer: false, ring: false, klemlengte: 20 });
  assert.deepEqual(uit.cmds, oud.cmds);
});

test('doorsteek: moer aan beide zijden afgeschuind, tweede ring', () => {
  const p = { maat: 'M20', aanzicht: 'doorsteek', lengte: 150, schaal: 1 };
  const mm = boutTemplate.realSizeMm(p);
  const cmds = boutTemplate.render(p, { x: 0, y: 0, width: mm.width, height: mm.height });
  assert.equal(cmds.filter((c) => c.role === 'moer').length, 1);
  assert.equal(cmds.filter((c) => c.role === 'moer-detail' && c.kind === 'polyline').length, 6);
  assert.equal(cmds.filter((c) => c.role === 'ring').length, 2);
  assert.equal(cmds.filter((c) => c.role === 'draad').length, 4, 'draad in de klemlengte en het uitsteekeind');
});

test('bovenaanzichten: afschuincirkel, ring en draad volgens ISO 6410', () => {
  const g = BOUT_MATEN.M16;
  const e = zeskantHoekmaat(g.s);
  const bbox = { x: 0, y: 0, width: 100, height: 100 };
  const moer = boutTemplate.render({ maat: 'M16', aanzicht: 'moer-boven' }, bbox);
  const S = 100 / e;
  near(moer.find((c) => c.role === 'afschuining').r, (g.s / 2) * S, 1e-9, 'afschuincirkel over de platte kanten');
  near(moer.find((c) => c.role === 'draadkern').r, (kernDiameter(g) / 2) * S, 1e-9, 'kerncirkel');
  const boog = moer.find((c) => c.kind === 'arc');
  assert.equal(boog.role, 'draad');
  near(boog.r, (g.d / 2) * S, 1e-9, 'driekwartcirkel op de buitendiameter');
  near(boog.a1 - boog.a0, 1.5 * Math.PI, 1e-12, 'driekwart');
  assert.ok(boog.lineWidthFactor < 1, 'dun');

  const metRing = boutTemplate.render({ maat: 'M16', aanzicht: 'plattegrond', ringPlattegrond: true }, bbox);
  const zonderRing = boutTemplate.render({ maat: 'M16', aanzicht: 'plattegrond', ringPlattegrond: false }, bbox);
  near(metRing.find((c) => c.role === 'ring').r, 50, 1e-9, 'ring vult de bbox');
  assert.ok(!zonderRing.some((c) => c.role === 'ring'));
  for (const cmds of [metRing, zonderRing]) {
    assert.ok(cmds.some((c) => c.role === 'boutkop' && c.kind === 'polyline'));
    assert.ok(cmds.some((c) => c.role === 'afschuining'));
  }
  const zes = boutTemplate.render({ maat: 'M16', aanzicht: 'zeskant' }, bbox);
  near(zes.find((c) => c.role === 'gat').r, (g.d / 2) * S, 1e-9, 'boorgat');
});

test('bestaande annotatie met de oude maat blijft binnen haar bbox', () => {
  // Oude realSizeMm: hoogte 2,2·d, ringdikte 0,15·d.
  const bbox = { x: 5, y: 5, width: 7.5 + 1.8 + 120, height: 26.4 };
  const cmds = boutTemplate.render({ maat: 'M12', aanzicht: 'bout', lengte: 120 }, bbox);
  assertBinnenBbox(cmds, bbox, 'oude bout-bbox');
});

test('snappunten: midden, hoeken en middens van de bbox-randen', () => {
  const bbox = { x: 10, y: 20, width: 100, height: 30 };
  const pts = boutTemplate.snapPoints({ aanzicht: 'plattegrond' }, bbox);
  assert.equal(pts.length, 9);
  assert.deepEqual(pts[0], { kind: 'center', x: 60, y: 35 });
  const hoeken = pts.filter((q) => q.kind === 'endpoint').map((q) => `${q.x},${q.y}`).sort();
  assert.deepEqual(hoeken, ['10,20', '10,50', '110,20', '110,50']);
  const middens = pts.filter((q) => q.kind === 'midpoint').map((q) => `${q.x},${q.y}`).sort();
  assert.deepEqual(middens, ['10,35', '110,35', '60,20', '60,50']);
});

test('snappunten zijaanzicht: onderkant kop, draadeinde, moer en bouteinde op de as', () => {
  const g = BOUT_MATEN.M12;
  const s = zij();
  const yAs = s.mm.height / 2;
  // De bbox-punten blijven vooraan staan.
  assert.deepEqual(s.snap.slice(0, 9), boutTemplate.snapPoints({ aanzicht: 'zeskant' }, s.bbox));
  const extra = s.snap.slice(9);
  assert.deepEqual(extra.map((q) => q.role), ['kop-onder', 'draadeinde', 'moer', 'bouteinde']);
  assert.ok(extra.every((q) => q.kind === 'endpoint' && Math.abs(q.y - yAs) < 1e-9), 'op de hartlijn');
  const bij = Object.fromEntries(extra.map((q) => [q.role, q.x]));
  near(bij['kop-onder'], g.k, 1e-9, 'onderkant kop');
  near(bij.draadeinde, s.cmds.find((c) => c.role === 'draadeinde').x1, 1e-9, 'overgang glad/draad');
  near(bij.moer, s.moer[0], 1e-9, 'aanlegvlak van de moer');
  near(bij.bouteinde, s.mm.width, 1e-9, 'bouteinde');
  // Zonder moer geen moerpunt; volledig draad: draadeinde onder de kop.
  const kaal = zij({ moer: false, draadlengte: 999 });
  assert.deepEqual(kaal.snap.slice(9).map((q) => q.role), ['kop-onder', 'draadeinde', 'bouteinde']);
  near(kaal.snap[10].x, g.k, 1e-9, 'volledig draad');
  // Verschoven en geschaalde bbox, doorsteek-aanzicht.
  const p = { maat: 'M16', aanzicht: 'doorsteek', lengte: 80 };
  const mm = boutTemplate.realSizeMm(p);
  const bbox = { x: 10, y: 20, width: mm.width * 2, height: mm.height * 2 };
  const pts = boutTemplate.snapPoints(p, bbox).slice(9);
  const moer = boutTemplate.render(p, bbox).find((c) => c.role === 'moer');
  near(pts.find((q) => q.role === 'moer').x, Math.min(...moer.points.map((q) => q.x)), 1e-9, 'moer doorsteek');
  near(pts.find((q) => q.role === 'bouteinde').x, bbox.x + bbox.width, 1e-9, 'bouteinde doorsteek');
  near(pts.find((q) => q.role === 'kop-onder').x, bbox.x + BOUT_MATEN.M16.k * 2, 1e-9, 'kop doorsteek');
});
