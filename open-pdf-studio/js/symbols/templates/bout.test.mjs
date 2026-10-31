// Parametrische bout / moer: maten per maat (M6–M24), werkelijke maat per
// aanzicht, getekende omvang = realSizeMm, snappunten en de tekenwijze
// (drie zeskantvlakken, afschuinkrommen, draad volgens ISO 6410).
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

test('parameters en standaardwaarden blijven gelijk', () => {
  const p = Object.fromEntries(boutTemplate.params.map((q) => [q.key, q.default]));
  assert.deepEqual(p, { maat: 'M12', aanzicht: 'bout', ringPlattegrond: true, lengte: 120, schaal: 1 });
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
        const p = { maat, aanzicht, lengte: 60, ringPlattegrond, schaal: 1 };
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
  const p = { maat: 'M12', aanzicht: 'bout', lengte: 120, schaal: 1 };
  const mm = boutTemplate.realSizeMm(p);
  const cmds = boutTemplate.render(p, { x: 0, y: 0, width: mm.width, height: mm.height });
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
  const pts = boutTemplate.snapPoints({}, bbox);
  assert.equal(pts.length, 9);
  assert.deepEqual(pts[0], { kind: 'center', x: 60, y: 35 });
  const hoeken = pts.filter((q) => q.kind === 'endpoint').map((q) => `${q.x},${q.y}`).sort();
  assert.deepEqual(hoeken, ['10,20', '10,50', '110,20', '110,50']);
  const middens = pts.filter((q) => q.kind === 'midpoint').map((q) => `${q.x},${q.y}`).sort();
  assert.deepEqual(middens, ['10,35', '110,35', '60,20', '60,50']);
});
