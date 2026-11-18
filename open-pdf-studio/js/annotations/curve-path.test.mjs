// Paden met krommen (#1169): het model en het rekenwerk van curve-path.js.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  segmentCount, isCurve, hasCurves, normalizeCurves, setCurves,
  segmentCubic, lineAsCubic, cubicToCurve, cubicPoint, splitCubic,
  flattenCubic, flattenPath, cubicLength, pathLength, signedPathArea, pathArea,
  nearestOnCubic, nearestOnPath, cubicBounds, pathBounds, pointInPath,
  setSegmentCurve, bendSegment, insertNode, deleteNode, nodeHandles,
  isSmoothNode, moveHandle, transformCurves, rotateCurves, reversePath, tracePath,
} from './curve-path.js';

const bijna = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

// Een kwartcirkel met straal r om (0, 0), van (r, 0) naar (0, r), in de
// gebruikelijke Bezier-benadering (afwijking van de echte cirkel < 0,03 %).
const K = 0.5522847498307936;
function kwartcirkel(r) {
  return {
    points: [{ x: r, y: 0 }, { x: 0, y: r }],
    curves: [{ c1x: 0, c1y: K * r, c2x: K * r, c2y: 0 }],
  };
}

// Een vierkant van 100 met een afgeronde hoek (straal 20) rechtsonder:
// rechte en kromme segmenten in een gesloten pad.
function vierkantMetRonding() {
  const points = [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 80, y: 100 }, { x: 0, y: 100 },
  ];
  const curves = [null, null, { c1x: 0, c1y: K * 20, c2x: K * 20, c2y: 0 }, null, null];
  return { points, curves };
}

test('een pad zonder krommen heeft geen curves-veld', () => {
  assert.equal(normalizeCurves(undefined, 3), undefined);
  assert.equal(normalizeCurves([null, null, null], 3), undefined);
  assert.equal(normalizeCurves([null, { c1x: NaN, c1y: 0, c2x: 0, c2y: 0 }], 2), undefined);
  const ann = { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], curves: [null] };
  const voor = JSON.stringify({ points: ann.points });
  setCurves(ann, ann.curves, false);
  assert.equal('curves' in ann, false);
  assert.equal(JSON.stringify(ann), voor, 'het model is dat van voorheen');
});

test('normalizeCurves geeft een plek per segment en schone krommen', () => {
  const uit = normalizeCurves([{ c1x: 1, c1y: 2, c2x: 3, c2y: 4, extra: 9 }], 3);
  assert.deepEqual(uit, [{ c1x: 1, c1y: 2, c2x: 3, c2y: 4 }, null, null]);
  assert.equal(segmentCount(4, false), 3);
  assert.equal(segmentCount(4, true), 4);
  assert.equal(segmentCount(1, true), 0);
  assert.equal(isCurve(null), false);
  assert.equal(hasCurves([null, uit[0]]), true);
  assert.equal(hasCurves([]), false);
});

test('segmentCubic maakt de stuurpunten absoluut; het sluitende segment loopt terug naar de eerste knoop', () => {
  const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
  const curves = [null, null, { c1x: 0, c1y: 5, c2x: -5, c2y: 0 }];
  assert.equal(segmentCubic(points, curves, 0, true), null);
  assert.equal(segmentCubic(points, curves, 2, false), null, 'open pad heeft geen derde segment');
  assert.deepEqual(segmentCubic(points, curves, 2, true), {
    p0: { x: 10, y: 10 }, p1: { x: 10, y: 15 }, p2: { x: -5, y: 0 }, p3: { x: 0, y: 0 },
  });
});

test('splitCubic: de twee delen beschrijven dezelfde kromme', () => {
  const bez = { p0: { x: 0, y: 0 }, p1: { x: 30, y: 80 }, p2: { x: 90, y: -40 }, p3: { x: 120, y: 20 } };
  const [l, r] = splitCubic(bez, 0.3);
  for (const u of [0, 0.25, 0.5, 0.75, 1]) {
    const a = cubicPoint(l, u), b = cubicPoint(bez, 0.3 * u);
    assert.ok(bijna(a.x, b.x) && bijna(a.y, b.y), `links ${u}`);
    const c = cubicPoint(r, u), d = cubicPoint(bez, 0.3 + 0.7 * u);
    assert.ok(bijna(c.x, d.x) && bijna(c.y, d.y), `rechts ${u}`);
  }
});

test('flattenCubic blijft binnen de tolerantie', () => {
  const { points, curves } = kwartcirkel(100);
  const bez = segmentCubic(points, curves, 0, false);
  for (const tol of [1, 0.1, 0.01]) {
    const pts = [bez.p0, ...flattenCubic(bez, tol)];
    // Elk punt van de kromme ligt binnen tol van de veellijn.
    let slechtste = 0;
    for (let k = 0; k <= 400; k++) {
      const p = cubicPoint(bez, k / 400);
      let d = Infinity;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const dx = b.x - a.x, dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
        d = Math.min(d, Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y));
      }
      slechtste = Math.max(slechtste, d);
    }
    assert.ok(slechtste <= tol, `tolerantie ${tol}: afwijking ${slechtste}`);
    assert.deepEqual(pts[pts.length - 1], bez.p3, 'eindigt op de eindknoop');
  }
  assert.ok(flattenCubic(bez, 0.01).length > flattenCubic(bez, 1).length, 'fijner = meer punten');
});

test('flattenPath: recht blijft de knopen, gesloten herhaalt de eerste niet', () => {
  const recht = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
  assert.deepEqual(flattenPath(recht, undefined), recht);
  assert.deepEqual(flattenPath(recht, undefined, { closed: true }), recht);
  const { points, curves } = vierkantMetRonding();
  const vlak = flattenPath(points, curves, { closed: true, tolerance: 0.05 });
  assert.ok(vlak.length > points.length);
  assert.deepEqual(vlak[0], points[0]);
  assert.notDeepEqual(vlak[vlak.length - 1], points[0]);
  // Alle knopen komen in volgorde terug.
  let zoek = 0;
  for (const p of vlak) if (zoek < points.length && bijna(p.x, points[zoek].x) && bijna(p.y, points[zoek].y)) zoek++;
  assert.equal(zoek, points.length);
});

test('cubicLength: een rechte kromme heeft de lengte van de koorde, een kwartcirkel bijna die van de cirkel', () => {
  const recht = lineAsCubic({ x: 0, y: 0 }, { x: 30, y: 40 });
  assert.ok(bijna(cubicLength(recht), 50, 1e-9));
  const { points, curves } = kwartcirkel(100);
  const len = cubicLength(segmentCubic(points, curves, 0, false));
  // De Bezier-benadering van de kwartcirkel is 157,0796…·(1 ± 3e-4).
  assert.ok(Math.abs(len - Math.PI * 50) < 0.05, `lengte ${len}`);
  // Tegen een brute referentie (200 000 lijnstukjes): binnen de tolerantie.
  const bez = { p0: { x: 0, y: 0 }, p1: { x: 30, y: 80 }, p2: { x: 90, y: -40 }, p3: { x: 120, y: 20 } };
  let ref = 0, vorige = bez.p0;
  for (let k = 1; k <= 200000; k++) {
    const p = cubicPoint(bez, k / 200000);
    ref += Math.hypot(p.x - vorige.x, p.y - vorige.y);
    vorige = p;
  }
  assert.ok(Math.abs(cubicLength(bez, 1e-6) - ref) < 1e-5, `${cubicLength(bez)} vs ${ref}`);
});

test('pathLength telt rechte en kromme segmenten op', () => {
  const { points, curves } = vierkantMetRonding();
  const boog = cubicLength(segmentCubic(points, curves, 2, true));
  assert.ok(bijna(pathLength(points, curves, { closed: true }), 100 + 80 + boog + 80 + 100, 1e-6));
  assert.ok(bijna(pathLength(points, curves, { closed: false }), 100 + 80 + boog + 80, 1e-6));
  assert.equal(pathLength(points, undefined, { closed: true }), 100 + 80 + Math.hypot(20, 20) + 80 + 100);
});

test('pathArea: exact voor rechte paden, en voor een ronding gelijk aan vierkant min hoek plus kwartschijf', () => {
  const vierkant = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  assert.equal(pathArea(vierkant, undefined), 10000);
  assert.equal(signedPathArea(vierkant.slice().reverse(), undefined), -10000);
  const { points, curves } = vierkantMetRonding();
  const a = pathArea(points, curves);
  // 10000 − 20² + (kwartschijf met straal 20 ≈ π·20²/4, Bezier-benadering).
  const verwacht = 10000 - 400 + Math.PI * 400 / 4;
  assert.ok(Math.abs(a - verwacht) < 0.15, `oppervlakte ${a} vs ${verwacht}`);
  // Tegen het vlakgemaakte pad met een zeer fijne tolerantie.
  const vlak = flattenPath(points, curves, { closed: true, tolerance: 1e-4 });
  assert.ok(Math.abs(a - pathArea(vlak, undefined)) < 1e-2);
  // Een volle cirkel uit vier krommen.
  const r = 50;
  const cirkel = [{ x: r, y: 0 }, { x: 0, y: r }, { x: -r, y: 0 }, { x: 0, y: -r }];
  const ck = [
    { c1x: 0, c1y: K * r, c2x: K * r, c2y: 0 },
    { c1x: -K * r, c1y: 0, c2x: 0, c2y: K * r },
    { c1x: 0, c1y: -K * r, c2x: -K * r, c2y: 0 },
    { c1x: K * r, c1y: 0, c2x: 0, c2y: -K * r },
  ];
  assert.ok(Math.abs(pathArea(cirkel, ck) - Math.PI * r * r) / (Math.PI * r * r) < 1e-3);
});

test('nearestOnCubic en nearestOnPath vinden het dichtstbijzijnde punt', () => {
  const { points, curves } = kwartcirkel(100);
  const bez = segmentCubic(points, curves, 0, false);
  const r = nearestOnCubic(bez, 100, 100);
  assert.ok(Math.abs(r.t - 0.5) < 1e-4, `t ${r.t}`);
  assert.ok(Math.abs(r.distance - (Math.SQRT2 * 100 - Math.hypot(r.x, r.y))) < 1e-6);
  assert.ok(Math.abs(Math.hypot(r.x, r.y) - 100) < 0.05, 'op de boog');
  assert.equal(nearestOnCubic(bez, 200, -50).t, 0, 'voorbij het begin: de beginknoop');
  const pad = vierkantMetRonding();
  const n = nearestOnPath(pad.points, pad.curves, 97, 97, { closed: true });
  assert.equal(n.segment, 2);
  assert.equal(n.curve, true);
  const m = nearestOnPath(pad.points, pad.curves, 50, -3, { closed: true });
  assert.equal(m.segment, 0);
  assert.equal(m.curve, false);
  assert.ok(bijna(m.distance, 3) && bijna(m.t, 0.5));
  const sluit = nearestOnPath(pad.points, pad.curves, -2, 50, { closed: true });
  assert.equal(sluit.segment, 4);
  assert.equal(nearestOnPath(pad.points, pad.curves, -2, 50, { closed: false }).segment !== 4, true);
  assert.equal(nearestOnPath([{ x: 0, y: 0 }], undefined, 1, 1), null);
});

test('cubicBounds en pathBounds nemen de buik van de kromme mee', () => {
  const bez = { p0: { x: 0, y: 0 }, p1: { x: 0, y: 100 }, p2: { x: 100, y: 100 }, p3: { x: 100, y: 0 } };
  const g = cubicBounds(bez);
  assert.ok(bijna(g.minX, 0) && bijna(g.maxX, 100) && bijna(g.minY, 0) && bijna(g.maxY, 75));
  const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
  const curves = [{ c1x: 0, c1y: 100, c2x: 0, c2y: 100 }];
  assert.deepEqual(pathBounds(points, undefined), { minX: 0, minY: 0, maxX: 100, maxY: 0 });
  assert.ok(bijna(pathBounds(points, curves).maxY, 75));
  assert.equal(pathBounds([], undefined), null);
});

test('pointInPath volgt de kromme', () => {
  const { points, curves } = vierkantMetRonding();
  assert.equal(pointInPath(points, curves, 50, 50), true);
  // Net buiten de rechte afsnijding maar binnen de ronding.
  assert.equal(pointInPath(points, curves, 92, 92), true);
  assert.equal(pointInPath(points, undefined, 92, 92), false);
  assert.equal(pointInPath(points, curves, 98, 98), false);
});

test('setSegmentCurve: omzetten naar een kromme laat de vorm eerst recht, en terug haalt het veld weg', () => {
  const points = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }];
  const krom = setSegmentCurve(points, undefined, 0, false, true);
  assert.deepEqual(krom, [{ c1x: 10, c1y: 0, c2x: -10, c2y: 0 }, null]);
  assert.ok(bijna(pathLength(points, krom), 60, 1e-9));
  assert.equal(setSegmentCurve(points, krom, 0, false, false), undefined);
  assert.equal(setSegmentCurve(points, krom, 2, false, true), null, 'open pad: geen sluitend segment');
  assert.equal(setSegmentCurve(points, krom, 2, true, true).length, 3);
  // Een bestaande kromme blijft bij nogmaals omzetten wat hij was.
  const gebogen = [{ c1x: 1, c1y: 2, c2x: 3, c2y: 4 }, null];
  assert.deepEqual(setSegmentCurve(points, gebogen, 0, false, true), gebogen);
});

test('bendSegment: het gegrepen punt volgt de muis, de knopen blijven staan', () => {
  const points = [{ x: 0, y: 0 }, { x: 90, y: 0 }, { x: 90, y: 60 }];
  for (const t of [0.2, 0.5, 0.8]) {
    const voor = cubicPoint(lineAsCubic(points[0], points[1]), t);
    const krom = bendSegment(points, undefined, 0, false, t, 7, -12);
    const na = cubicPoint(segmentCubic(points, krom, 0, false), t);
    assert.ok(bijna(na.x, voor.x + 7, 1e-9) && bijna(na.y, voor.y - 12, 1e-9), `t ${t}`);
    assert.equal(krom[1], null);
  }
  // Een bestaande kromme verder buigen.
  const eerst = bendSegment(points, undefined, 0, false, 0.5, 0, 20);
  const verder = bendSegment(points, eerst, 0, false, 0.5, 0, 10);
  assert.ok(bijna(cubicPoint(segmentCubic(points, verder, 0, false), 0.5).y, 30, 1e-9));
  assert.equal(bendSegment(points, undefined, 5, false, 0.5, 1, 1), null);
});

test('insertNode: een kromme wordt exact gedeeld, een recht segment krijgt een knoop op de lijn', () => {
  const { points, curves } = vierkantMetRonding();
  const voorLengte = pathLength(points, curves, { closed: true });
  const voorOpp = pathArea(points, curves);
  const uit = insertNode(points, curves, 2, 0.4, true);
  assert.equal(uit.index, 3);
  assert.equal(uit.points.length, 6);
  assert.equal(uit.curves.length, 6);
  assert.ok(uit.curves[2] && uit.curves[3], 'twee krommen');
  assert.ok(bijna(pathLength(uit.points, uit.curves, { closed: true }), voorLengte, 1e-6));
  assert.ok(bijna(pathArea(uit.points, uit.curves), voorOpp, 1e-6));
  // De nieuwe knoop is vloeiend: de vorm heeft daar geen knik.
  assert.equal(isSmoothNode(uit.points, uit.curves, 3, true), true);
  const recht = insertNode(points, curves, 0, 0.25, true);
  assert.deepEqual(recht.points[1], { x: 25, y: 0 });
  assert.equal(recht.curves[0], null);
  assert.equal(recht.curves[1], null);
  assert.ok(recht.curves[3], 'de kromme is een plek opgeschoven');
  // Het sluitende segment.
  const sluit = insertNode(points, curves, 4, 0.5, true);
  assert.deepEqual(sluit.points[5], { x: 0, y: 50 });
  assert.equal(insertNode(points, curves, 4, 0.5, false), null);
  // Zonder krommen blijft het veld weg.
  assert.equal(insertNode(points, undefined, 0, 0.5, true).curves, undefined);
});

test('deleteNode: een net ingevoegde knoop weghalen geeft (vrijwel) de oude kromme terug', () => {
  const { points, curves } = vierkantMetRonding();
  const met = insertNode(points, curves, 2, 0.5, true);
  const terug = deleteNode(met.points, met.curves, met.index, true);
  assert.equal(terug.points.length, 5);
  assert.deepEqual(terug.points, points);
  for (const k of ['c1x', 'c1y', 'c2x', 'c2y']) {
    assert.ok(Math.abs(terug.curves[2][k] - curves[2][k]) < 1e-6, `${k}: ${terug.curves[2][k]} vs ${curves[2][k]}`);
  }
  // Tussen twee rechte segmenten: recht.
  const recht = deleteNode(points, curves, 0, true);
  assert.equal(recht.points.length, 4);
  assert.deepEqual(recht.points[0], { x: 100, y: 0 });
  assert.equal(recht.curves.length, 4);
  assert.ok(recht.curves[1], 'de kromme schuift een plek op');
  assert.equal(recht.curves[3], null);
  // Een knoop aan een kromme: het samengevoegde segment is een kromme.
  const krom = deleteNode(points, curves, 2, true);
  assert.ok(krom.curves[1]);
  assert.equal(krom.curves.filter(Boolean).length, 1);
  // Uiteinden van een open pad.
  const open = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }];
  const ok = [{ c1x: 1, c1y: 5, c2x: -1, c2y: 5 }, null];
  assert.equal(deleteNode(open, ok, 0, false).curves, undefined);
  assert.deepEqual(deleteNode(open, ok, 2, false).curves, [ok[0]]);
  // Ondergrens.
  assert.equal(deleteNode(open.slice(0, 2), undefined, 0, false), null);
  assert.equal(deleteNode(open, undefined, 0, true), null);
  assert.equal(deleteNode(open, undefined, 7, false), null);
});

test('nodeHandles en isSmoothNode', () => {
  const points = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }];
  const curves = [{ c1x: 10, c1y: 10, c2x: -15, c2y: -15 }, { c1x: 20, c1y: 20, c2x: -5, c2y: 5 }];
  const h = nodeHandles(points, curves, 1, false);
  assert.deepEqual(h.in, { segment: 0, which: 2, dx: -15, dy: -15, x: 35, y: -15 });
  assert.deepEqual(h.out, { segment: 1, which: 1, dx: 20, dy: 20, x: 70, y: 20 });
  assert.equal(isSmoothNode(points, curves, 1, false), true);
  assert.equal(nodeHandles(points, curves, 0, false).in, null, 'open pad: het begin heeft geen inkomend stuurpunt');
  assert.equal(isSmoothNode(points, curves, 0, false), false);
  const hoek = [curves[0], { c1x: 20, c1y: -20, c2x: -5, c2y: 5 }];
  assert.equal(isSmoothNode(points, hoek, 1, false), false);
  // Gesloten: knoop 0 krijgt het sluitende segment als inkomend.
  const dicht = [null, null, { c1x: 0, c1y: 9, c2x: 0, c2y: 7 }];
  assert.deepEqual(nodeHandles(points, dicht, 0, true).in, { segment: 2, which: 2, dx: 0, dy: 7, x: 0, y: 7 });
});

test('moveHandle: vloeiend draait de overkant mee en houdt zijn lengte; los blijft de overkant staan', () => {
  const points = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }];
  const curves = [{ c1x: 10, c1y: 10, c2x: -15, c2y: 0 }, { c1x: 20, c1y: 0, c2x: -5, c2y: 5 }];
  const los = moveHandle(points, curves, 1, 1, false, 0, 30);
  assert.deepEqual(los[1], { c1x: 0, c1y: 30, c2x: -5, c2y: 5 });
  assert.deepEqual(los[0], curves[0]);
  assert.equal(isSmoothNode(points, los, 1, false), false);
  const vloeiend = moveHandle(points, curves, 1, 1, false, 0, 30, { smooth: true });
  assert.ok(bijna(vloeiend[0].c2x, 0) && bijna(vloeiend[0].c2y, -15), JSON.stringify(vloeiend[0]));
  assert.equal(isSmoothNode(points, vloeiend, 1, false), true);
  // Het tweede stuurpunt van segment 0 hoort bij dezelfde knoop.
  const andersom = moveHandle(points, curves, 0, 2, false, -30, 0, { smooth: true });
  assert.ok(bijna(andersom[1].c1x, 20) && bijna(andersom[1].c1y, 0));
  // Geen overkant (uiteinde van een open pad): alleen het eigen stuurpunt.
  const eind = moveHandle(points, curves, 0, 1, false, 3, 4, { smooth: true });
  assert.deepEqual(eind[0], { c1x: 3, c1y: 4, c2x: -15, c2y: 0 });
  assert.equal(moveHandle(points, [null, null], 0, 1, false, 1, 1), null);
});

test('transformCurves, rotateCurves en reversePath', () => {
  const curves = [{ c1x: 10, c1y: 0, c2x: 0, c2y: -5 }, null];
  const gedraaid = rotateCurves(curves, 90);
  assert.ok(bijna(gedraaid[0].c1x, 0) && bijna(gedraaid[0].c1y, 10));
  assert.ok(bijna(gedraaid[0].c2x, 5) && bijna(gedraaid[0].c2y, 0));
  assert.equal(gedraaid[1], null);
  assert.deepEqual(transformCurves(curves, -1, 0, 0, 2)[0], { c1x: -10, c1y: 0, c2x: -0, c2y: -10 });
  // Draaien en terugdraaien.
  const terug = rotateCurves(rotateCurves(curves, 37), -37);
  assert.ok(bijna(terug[0].c1x, 10) && bijna(terug[0].c2y, -5));

  const { points, curves: vk } = vierkantMetRonding();
  for (const closed of [true, false]) {
    const om = reversePath(points, vk, closed);
    assert.ok(bijna(pathLength(om.points, om.curves, { closed }), pathLength(points, vk, { closed }), 1e-6), `lengte, closed=${closed}`);
    const a = flattenPath(points, vk, { closed, tolerance: 0.01 });
    const b = flattenPath(om.points, om.curves, { closed, tolerance: 0.01 });
    const g1 = pathBounds(a), g2 = pathBounds(b);
    assert.ok(bijna(g1.maxX, g2.maxX, 1e-9) && bijna(g1.maxY, g2.maxY, 1e-9));
  }
  assert.ok(bijna(signedPathArea(points, vk), -signedPathArea(...Object.values(reversePath(points, vk, true))), 1e-6));
  assert.equal(reversePath(points, undefined, true).curves, undefined);
});

test('tracePath zet lijnen en krommen op de context en sluit een gesloten pad', () => {
  const log = [];
  const ctx = {
    moveTo: (x, y) => log.push(['M', x, y]),
    lineTo: (x, y) => log.push(['L', x, y]),
    bezierCurveTo: (...a) => log.push(['C', ...a]),
    closePath: () => log.push(['Z']),
  };
  const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
  tracePath(ctx, points, [null, { c1x: 2, c1y: 0, c2x: 0, c2y: -2 }], false);
  assert.deepEqual(log, [['M', 0, 0], ['L', 10, 0], ['C', 12, 0, 10, 8, 10, 10]]);
  log.length = 0;
  tracePath(ctx, points, undefined, true);
  assert.deepEqual(log, [['M', 0, 0], ['L', 10, 0], ['L', 10, 10], ['Z']]);
  log.length = 0;
  tracePath(ctx, points, [null, null, { c1x: 0, c1y: 4, c2x: 4, c2y: 0 }], true);
  assert.deepEqual(log[log.length - 2], ['C', 10, 14, 4, 0, 0, 0]);
  assert.deepEqual(log[log.length - 1], ['Z']);
});

test('cubicToCurve en lineAsCubic zijn elkaars tegenhanger', () => {
  const bez = lineAsCubic({ x: 0, y: 0 }, { x: 9, y: 3 });
  assert.deepEqual(cubicToCurve(bez), { c1x: 3, c1y: 1, c2x: -3, c2y: -1 });
});
